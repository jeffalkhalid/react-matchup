-- ============================================================================
-- Tournois montante / descente -- les fonctions serveur.
--
-- LE SQL FAIT AUTORITE. `lib/tournament.ts` en est le miroir d'affichage.
-- `tournament_generate_round` et `tournament_standings` reproduisent
-- exactement `initialCourts` / `pairUp` / `nextCourts` / `standings` de ce
-- module ; le test de parite de la Task 4 interdit la divergence.
--
-- Conventions de ce fichier :
--   * Toutes les fonctions RENVOIENT un jsonb `{ok:true, ...}` ou
--     `{ok:false, reason:'...'}`. Aucune ne leve d'exception pour un refus
--     metier. Deux raisons :
--       - piege plpgsql : un INSERT suivi d'un RAISE EXCEPTION dans la meme
--         transaction est annule ; une fonction qui doit refuser ET laisser
--         une trace ne peut donc pas lever ;
--       - uniformite cote client : un appelant qui lit `data.reason` pour un
--         refus et `error.message` pour un autre finit toujours par en
--         oublier un.
--     Les raisons possibles sont listees au-dessus de chaque fonction ; la
--     Task 5 doit les traduire toutes, `feature_disabled` compris.
--   * SECURITY DEFINER + SET search_path = public partout.
--   * REVOKE ALL ... FROM PUBLIC, anon, authenticated -- nommer les trois.
--     Piege des droits Supabase, deja paye dans ce depot : revoquer a PUBLIC
--     ne retire PAS les droits directs de anon et authenticated.
--   * AUCUNE ecriture dans `tournament_participants` : la table est un index
--     derive maintenu par le trigger `tournament_teams_sync_participants`.
--     Ecrire dedans recreerait la derive que ce trigger existe pour empecher.
--   * AUCUNE ecriture dans `games`, ni dans le declencheur ELO, ni dans le
--     blocage anti-chevauchement +/-2h. C'est toute la raison d'etre de
--     l'architecture separee.
--   * ORDRE DES VERROUS, partout : la ligne `tournaments` d'ABORD (FOR
--     UPDATE), les autres lignes ensuite. C'est ce qui serialise les
--     inscriptions concurrentes sur la derniere place libre, et ce qui evite
--     les interblocages entre deux fonctions qui touchent aux memes joueurs.
--
-- ⚠️ INVARIANT DE LECTURE DE `tournament_teams` -- a lire avant d'ecrire la
-- moindre requete sur cette table, y compris dans les taches suivantes.
--
--   UN BINOME PEUT EXISTER SANS AVOIR DE PLACE. Deux joueurs en liste
--   d'attente peuvent s'apparier (c'est utile : ils avancent ensemble), et
--   leur binome est une VRAIE ligne de `tournament_teams`, indiscernable d'un
--   binome assis si on ne regarde que cette table -- elle ne porte AUCUNE
--   information de place, et il a ete decide de ne pas l'y dupliquer.
--
--   AUCUN lecteur de `tournament_teams` ne peut donc se passer de la jointure
--   vers `tournament_registrations` avec `waitlist_position IS NULL` sur les
--   DEUX joueurs. Un `SELECT ... FROM tournament_teams WHERE tournament_id = ?`
--   nu placerait sur l'echelle, et sur un terrain, un binome qui n'est jamais
--   entre dans le tournoi. Vaut pour le placement initial, la generation des
--   tours, le classement et tout affichage.
--
-- ⚠️ ETAT DU FICHIER. La section « inscription et appariement » ci-dessous est
-- ecrite pour le schema livre (tournaments.sql) : inscription INDIVIDUELLE,
-- places comptees EN JOUEURS (court_count x 4), statuts BROUILLON ->
-- INSCRIPTIONS_OUVERTES -> COMPLET -> CHECK_IN -> PRET -> EN_COURS -> TERMINE
-- -> CLASSEMENT_VALIDE.
-- La section « deroulement d'une rotation » qui la suit est ecrite pour ce
-- meme schema : `tournament_start`, `tournament_enter_score`,
-- `tournament_resolve_dispute`, `tournament_forfeit`,
-- `tournament_generate_round` et `tournament_reopen_match`. Le SENS DES
-- PALIERS y a ete redresse au passage -- LE TERRAIN 1 EST LE MEILLEUR, on
-- monte vers lui -- dans `fn_tournament_ladder` comme dans le placement
-- initial, qui faisaient tous deux l'inverse et se repondaient, donc ne
-- paraissaient faux ni l'un ni l'autre isolement.
--
-- La section « classement, rotation finale, cloture » qui la termine ecrit
-- `tournament_standings`, `tournament_final_round`, `tournament_final_stakes`
-- (Task 13 -- la lecture DURABLE de l'enjeu de la rotation de classement,
-- ouverte a tout joueur), `tournament_close` et `tournament_validate`, contre
-- les memes statuts et la meme convention de paliers. LA HIERARCHIE DE
-- CLASSEMENT y est ecrite une fois pour toutes : palier -> victoires ->
-- difference de jeux -> jeux gagnes -> confrontation directe agregee ->
-- identifiant.
--
-- Task 13 ajoute aussi trois remedes REVERSIBLES/IRREVERSIBLES aux etats sans
-- sortie (section ANNULATION en fin de fichier, et `tournament_reopen_registrations`
-- / `tournament_remove_registration` plus haut) : `tournament_cancel` (sortie
-- universelle, ANNULE terminal), `tournament_reopen_registrations` (retour
-- CHECK_IN/PRET -> inscriptions) et `tournament_remove_registration`
-- (l'organisateur retire une inscription).
--
-- IL NE RESTE PLUS AUCUNE FONCTION DU MODELE PRECEDENT. Les trois qui
-- survivaient, gelees et sans droit d'execution, ont ete soldees :
-- `tournament_confirm_score` est SUPPRIMEE (perimee par le modele -- un score
-- est acquis par la CONCORDANCE de deux saisies OPPOSEES, il n'y a plus
-- d'etape de confirmation), `tournament_standings` et `tournament_close` sont
-- REECRITES. Le bloc « SURFACE GELEE » qui terminait ce fichier n'a plus
-- d'objet et a disparu avec elles : toute fonction encore ici est appelable
-- et a son GRANT.
-- ============================================================================
BEGIN;

-- pg_net + supabase_vault : requis par `fn_tournament_registration_notify`
-- (declencheur en fin de fichier), meme motif que `cancel_game_notify.sql` /
-- `defi_server_notifs.sql`. Idempotent -- sans effet si deja crees ailleurs.
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- ----------------------------------------------------------------------------
-- Helper interne : le bareme de points.
--
-- `points_scale` est un objet {rang: points} A RANGS PARTIELS, par exemple
-- {"1":20,"2":15,"3":10,"5":5}. REGLE D'INTERPRETATION : un rang prend les
-- points du SEUIL DEFINI LE PLUS PROCHE EN DESSOUS OU EGAL A LUI.
--   rang 1 -> seuil 1 -> 20
--   rang 2 -> seuil 2 -> 15
--   rang 3 -> seuil 3 -> 10
--   rang 4 -> seuil 3 -> 10   (pas de seuil 4 : on prend le 3)
--   rang 5 -> seuil 5 ->  5
--   rang 6 -> seuil 5 ->  5
--   rang 7 et au-dela -> seuil 5 ->  5
-- Si aucun seuil n'est <= au rang (bareme qui ne commence pas a 1), le rang
-- vaut 0 point.
--
-- ⚠️ PAS DE POINTS NEGATIFS -- ce module ne DECIDE de rien la-dessus, il
-- applique juste ce que `tournaments.points_scale` (CHECK) et `tournament_create`
-- (refus `invalid_points_scale`) imposent en amont : « un tournoi ne punit
-- pas, il classe ». Une version anterieure de ce commentaire affirmait le
-- contraire (« les points peuvent etre negatifs, c'est voulu ») -- deux
-- reponses a la meme question, l'une dans une CHECK, l'autre dans un
-- commentaire ; la CHECK fait foi et le commentaire etait perime.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_tournament_points(p_scale jsonb, p_rank int)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT round((kv.value)::numeric)::int
      FROM jsonb_each_text(
             CASE WHEN jsonb_typeof(p_scale) = 'object' THEN p_scale ELSE '{}'::jsonb END
           ) AS kv
     WHERE kv.key ~ '^[0-9]+$'
       AND kv.key::int <= p_rank
     ORDER BY kv.key::int DESC
     LIMIT 1
  ), 0);
$$;

REVOKE ALL ON FUNCTION public.fn_tournament_points(jsonb, int) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Helper interne : QUI A GAGNE. Une seule definition, pour tout le fichier.
--
-- ⚠️ ON SE FIE A `forfeited_team`, JAMAIS AU SCORE. Un forfait s'inscrit
-- `tournaments.forfeit_games` DES DEUX COTES (0-0 par defaut) : re-deduire le
-- vainqueur des jeux rendrait « B gagne » a tous les coups, y compris quand
-- c'est B qui a declare forfait -- et ferait alors MONTER le forfaitaire.
-- Le marqueur est la seule verite, le score n'en est que l'affichage.
--
-- Hors forfait, la regle est celle de `nextCourts` : `gamesA > gamesB`. Une
-- egalite -- que `tournament_enter_score` refuse en amont (`draw_not_allowed`)
-- -- tombe donc du cote de B, exactement comme le moteur TypeScript l'ecrit :
-- « si il survenait quand meme, ce test le traite comme une victoire de B --
-- choix explicite, pas un oubli ». Un score encore NULL fait pareil, par le
-- coalesce ; le seul appelant filtre de toute facon les matchs non confirmes.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_tournament_a_won(
  p_forfeited uuid, p_team_a uuid, p_games_a int, p_games_b int)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
-- PAS de SECURITY DEFINER, contrairement au reste du fichier : cette fonction
-- est PURE -- aucun acces a une table, aucune ligne a lire sous les droits de
-- personne. Le definer n'y apporterait rien et elargirait la surface pour rien.
-- `SET search_path` reste : il fige la resolution des noms.
SET search_path = public
AS $$
  SELECT CASE
           -- forfeited_team = team_a -> A a perdu ; sinon c'est B qui a
           -- declare forfait, donc A a gagne. La CHECK du schema garantit que
           -- forfeited_team vaut team_a ou team_b, jamais un tiers.
           WHEN p_forfeited IS NOT NULL THEN p_forfeited IS DISTINCT FROM p_team_a
           ELSE coalesce(p_games_a > p_games_b, false)
         END;
$$;

REVOKE ALL ON FUNCTION public.fn_tournament_a_won(uuid, uuid, int, int) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Helper interne : LES BINOMES QUI ONT REELLEMENT UNE PLACE.
--
-- L'invariant de tete de fichier, ecrit UNE FOIS et une seule.
-- `tournament_teams` ne porte AUCUNE information de siege : deux joueurs en
-- liste d'attente peuvent s'apparier, et leur binome y a une ligne
-- indiscernable de celle d'un binome assis. Tout lecteur doit donc joindre
-- `tournament_registrations` et exiger `waitlist_position IS NULL` SUR LES
-- DEUX joueurs.
--
-- La forme heritee de `tournament_generate_round` sautait cette jointure : elle
-- comptait, placait et faisait jouer des binomes qui n'etaient jamais entres
-- dans le tournoi. C'est precisement pour ca qu'elle avait ete gelee. Les
-- lecteurs de l'echelle passent desormais tous par ici, ce qui rend l'oubli
-- impossible plutot que deconseille.
--
-- `withdrawn` est EXCLU : un binome forfait quitte l'echelle, et son
-- adversaire du tour suivant se retrouve seul sur son palier -- il y recoit un
-- bye, ce que veut la spec.
--
-- `team_level` est la note de placement de `initialCourts` : la MOYENNE DES
-- DEUX NIVEAUX, et non le niveau de la moyenne des ELO -- l'echelle
-- ELO -> niveau est concave, les deux nombres ne sont pas le meme.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_tournament_seated_teams(p_tournament uuid)
RETURNS TABLE (team_id uuid, player1_id uuid, player2_id uuid,
               start_court int, team_level numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tt.id, tt.player1_id, tt.player2_id, tt.start_court,
         (public.elo_to_level(coalesce(p1.elo_score, 1000))
        + public.elo_to_level(coalesce(p2.elo_score, 1000))) / 2.0
    FROM public.tournament_teams tt
    JOIN public.tournament_registrations r1
      ON r1.tournament_id = tt.tournament_id AND r1.player_id = tt.player1_id
    JOIN public.tournament_registrations r2
      ON r2.tournament_id = tt.tournament_id AND r2.player_id = tt.player2_id
    JOIN public.players p1 ON p1.id = tt.player1_id
    JOIN public.players p2 ON p2.id = tt.player2_id
   WHERE tt.tournament_id      = p_tournament
     AND NOT tt.withdrawn
     AND r1.waitlist_position IS NULL
     AND r2.waitlist_position IS NULL;
$$;

REVOKE ALL ON FUNCTION public.fn_tournament_seated_teams(uuid) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Helper interne : Y A-T-IL LITIGE SUR CE MATCH ?
--
-- Un litige n'est PAS une colonne : c'est un fait qui se lit dans
-- `tournament_match_entries`. Deux joueurs de binomes OPPOSES ont saisi, et
-- ils ne disent pas la meme chose. Le stocker en plus serait une seconde
-- verite a garder synchronisee de la premiere -- la derive deja payee avec
-- `spots_available` dans ce depot.
--
-- Deux coequipiers qui divergent ne font PAS litige : leur desaccord se regle
-- entre eux, et le score reste simplement non acquis. Deux coequipiers
-- d'accord ne valident rien non plus -- c'est la meme regle, vue de l'autre
-- cote : seule une saisie ADVERSE compte.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_tournament_match_dispute(p_match uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.tournament_matches m
      JOIN public.tournament_teams ta
        ON ta.tournament_id = m.tournament_id AND ta.id = m.team_a
      JOIN public.tournament_teams tb
        ON tb.tournament_id = m.tournament_id AND tb.id = m.team_b
      JOIN public.tournament_match_entries ea
        ON ea.match_id = m.id AND ea.player_id IN (ta.player1_id, ta.player2_id)
      JOIN public.tournament_match_entries eb
        ON eb.match_id = m.id AND eb.player_id IN (tb.player1_id, tb.player2_id)
     WHERE m.id = p_match
       AND (ea.games_a, ea.games_b) IS DISTINCT FROM (eb.games_a, eb.games_b)
  );
$$;

REVOKE ALL ON FUNCTION public.fn_tournament_match_dispute(uuid) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Helper interne : l'etat de l'echelle A L'ENTREE du tour p_round.
--
-- Port exact du repli (fold) que fait `lib/tournament.ts` :
--   courts_0 = initialCourts(teams)            -> `tournament_teams.start_court`
--   courts_k = nextCourts(courts_{k-1}, matchs du tour k, courtCount)
--
-- L'astuce qui evite une CTE recursive : `nextCourts` ne modifie QUE les
-- equipes qui ont joue ce tour-la, et laisse les autres exactement ou elles
-- etaient (`out = new Map(courts)` puis `continue` sur les byes). Le report
-- est donc l'identite, et le palier d'une equipe a l'entree du tour r vaut :
--   le mouvement produit par le DERNIER tour < r ou elle apparait,
--   ou `start_court` si elle n'apparait dans aucun.
-- C'est mathematiquement le meme resultat que le repli, sans recursion.
--
-- ⚠️ SENS DU MOUVEMENT. LE TERRAIN 1 EST LE MEILLEUR, ON MONTE VERS LUI :
--     gagnant -> greatest(1, court_no - 1)            (Math.max(1, court - 1))
--     perdant -> least(court_count, court_no + 1)     (Math.min(cc, court + 1))
--   La version precedente de ce helper faisait exactement l'INVERSE : elle
--   datait de la convention abandonnee, ou le DERNIER terrain etait le plus
--   fort. Elle a ete corrigee ici, avec `tournament_generate_round` qui
--   placait les plus forts au dernier palier -- les deux se repondaient, donc
--   aucune ne paraissait fausse isolement.
--
-- Les trois cas, dans l'ordre du moteur :
--   * bye (`team_b IS NULL`) : l'equipe ne bouge pas ;
--   * match reel : qui a gagne se lit dans `fn_tournament_a_won`, c'est-a-dire
--     dans `forfeited_team` D'ABORD et dans les jeux ensuite ;
--   * match reel NON CONFIRME : ignore -- l'equipe reste ou elle est. C'est le
--     report d'identite du TypeScript. Sans ce filtre, `games_a > games_b` sur
--     deux NULL vaudrait « B gagne » et ferait descendre une equipe sur un
--     match que personne n'a encore joue. `tournament_generate_round`
--     interdisant deja d'avancer sur un tour incomplet, le cas n'est pas
--     atteignable : c'est une ceinture, pas une divergence.
--
-- Les equipes forfait ET les binomes SANS PLACE sont ecartes par
-- `fn_tournament_seated_teams` -- voir l'invariant en tete de fichier.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_tournament_ladder(p_tournament uuid, p_round int)
RETURNS TABLE (team_id uuid, court int, bye_count int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cc AS (
    SELECT t.court_count FROM public.tournaments t WHERE t.id = p_tournament
  ),
  joues AS (
    SELECT m.round_no, m.court_no, m.team_a, m.team_b,
           public.fn_tournament_a_won(m.forfeited_team, m.team_a,
                                      m.games_a, m.games_b) AS a_won
      FROM public.tournament_matches m
     WHERE m.tournament_id = p_tournament
       AND m.round_no      < p_round
       AND m.team_a       IS NOT NULL
       AND m.team_b       IS NOT NULL
       AND m.confirmed_at IS NOT NULL
  ),
  mv AS (
    -- Le camp A.
    SELECT j.round_no, j.team_a AS mv_team,
           CASE WHEN j.a_won THEN greatest(1, j.court_no - 1)
                ELSE              least((SELECT court_count FROM cc), j.court_no + 1)
           END AS mv_court
      FROM joues j
    UNION ALL
    -- Le camp B, exactement symetrique.
    SELECT j.round_no, j.team_b,
           CASE WHEN j.a_won THEN least((SELECT court_count FROM cc), j.court_no + 1)
                ELSE              greatest(1, j.court_no - 1)
           END
      FROM joues j
    UNION ALL
    -- Le bye : l'equipe reste sur son palier. Redondant avec le report
    -- d'identite (un bye a lieu la ou l'equipe est deja), mais ecrit pour que
    -- les trois cas du moteur se lisent dans le helper.
    SELECT b.round_no, b.team_a, b.court_no
      FROM public.tournament_matches b
     WHERE b.tournament_id = p_tournament
       AND b.round_no      < p_round
       AND b.team_b       IS NULL
       AND b.team_a       IS NOT NULL
  ),
  last_mv AS (
    -- Le DERNIER tour ou l'equipe apparait. `row_number()` plutot que
    -- `DISTINCT ON` : la colonne de tri `round_no` n'a pas besoin de figurer
    -- dans la liste de sortie, et l'ordre est total (round_no puis court).
    SELECT z.mv_team, z.mv_court
      FROM (
        SELECT mv.mv_team, mv.mv_court,
               row_number() OVER (PARTITION BY mv.mv_team
                                  ORDER BY mv.round_no DESC, mv.mv_court DESC) AS rn
          FROM mv
      ) z
     WHERE z.rn = 1
  ),
  byes AS (
    SELECT b.team_a AS bye_team, count(*)::int AS n
      FROM public.tournament_matches b
     WHERE b.tournament_id = p_tournament
       AND b.round_no      < p_round
       AND b.team_b       IS NULL
       AND b.team_a       IS NOT NULL
     GROUP BY b.team_a
  )
  SELECT st.s_team,
         COALESCE(lm.mv_court, st.s_start)::int,
         COALESCE(bc.n, 0)::int
    FROM public.fn_tournament_seated_teams(p_tournament)
           AS st(s_team, s_p1, s_p2, s_start, s_level)
    LEFT JOIN last_mv lm ON lm.mv_team  = st.s_team
    LEFT JOIN byes    bc ON bc.bye_team = st.s_team
   -- Une equipe sans `start_court` et sans mouvement n'a jamais ete placee :
   -- le tournoi n'a pas encore demarre pour elle. On ne l'invente pas sur un
   -- palier.
   WHERE COALESCE(lm.mv_court, st.s_start) IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.fn_tournament_ladder(uuid, int) FROM PUBLIC, anon, authenticated;

-- ############################################################################
-- SECTION CREATION (Task 11)
--
-- `public.tournaments` ne portait, avant cette tache, AUCUNE voie d'ecriture :
-- une seule policy `SELECT` (`tournaments_read`, tournaments.sql), aucune
-- policy `INSERT`, et aucune RPC. L'ecran d'organisation
-- (`app/(tabs)/admin.tsx`) et `createTournament()` (`lib/tournaments.ts`)
-- appelaient donc un contrat qui n'existait nulle part.
--
-- CHOIX : une RPC, pas une policy d'ecriture. C'est le moule de tout ce
-- fichier -- SECURITY DEFINER, refus nommes, sujet jamais un parametre -- et
-- ca garde le controle des valeurs a la creation (bareme sans points
-- negatifs, plage de niveau coherente...) au meme endroit que tout le reste,
-- plutot que dans une CHECK par colonne qui ne validerait pas les
-- combinaisons.
--
-- ⚠️ `createTournament()` (lib/tournaments.ts), ECRITE AVANT cette tache et
-- QUE CETTE TACHE NE MODIFIE PAS, fait aujourd'hui un `INSERT` DIRECT sur
-- `public.tournaments` -- PAS un appel RPC. Cette fonction existe donc pour
-- rendre l'ECRITURE possible (le contrat, les refus nommes, les valeurs
-- posees par le serveur) et pour que ses PARAMETRES correspondent exactement
-- a ce que `createTournament()` envoie -- mais tant que ce module continue de
-- faire un `INSERT` brut plutot que `supabase.rpc('tournament_create', ...)`,
-- il continuera de heurter l'absence de policy `INSERT` sur `tournaments`.
-- Combler ce dernier pas (appeler cette RPC au lieu d'inserer en direct)
-- appartient au client, pas a ce fichier -- voir le rapport de Task 11.
-- ############################################################################

-- ============================================================================
-- tournament_create(p_name, p_starts_at, p_court_count, p_round_count,
--                    p_club_id, p_level_min, p_level_max, p_price_mad,
--                    p_points_scale)
--
-- Cree un tournoi et le PUBLIE dans le meme geste : statut
-- `INSCRIPTIONS_OUVERTES` ecrit directement, JAMAIS `BROUILLON` -- pour la
-- meme raison que documentee dans `createTournament()` cote client : aucune
-- fonction de ce fichier ne fait jamais passer un tournoi de `BROUILLON` a
-- `INSCRIPTIONS_OUVERTES`, donc un tournoi cree en `BROUILLON` resterait bloque
-- pour toujours -- personne ne pourrait plus jamais s'y inscrire.
--
-- `created_by` est TOUJOURS `current_player_id()`, jamais un parametre --
-- meme moule que tout le fichier : le sujet d'une ecriture n'est jamais dit
-- par l'appelant. Le champ `createdBy` que `TournamentCreateInput` porte cote
-- client est donc IGNORE par cette RPC si jamais elle finissait par etre
-- appelee avec ; le serveur ne fait confiance qu'a la session authentifiee.
--
-- `ends_at` n'est jamais ecrit ici, pour la raison documentee cote client :
-- `tournament_close` pose `ends_at = COALESCE(ends_at, now())`, une date
-- posee a la creation y survivrait et afficherait une heure de fin estimee a
-- la place de l'heure reelle de cloture.
--
-- VALIDATIONS, toutes AVANT toute ecriture :
--   * nom non vide (`invalid_name`) ;
--   * date de debut fournie (`invalid_starts_at`) ;
--   * terrains et rotations des entiers strictement positifs
--     (`invalid_court_count`, `invalid_round_count`) ;
--   * prix affiche positif ou nul (`invalid_price`) ;
--   * plage de niveau coherente -- bornes non negatives, min <= max quand les
--     deux sont donnes (`invalid_level_range`) ;
--   * club existant s'il est donne (`club_not_found`) ;
--   * bareme de points SANS VALEUR NEGATIVE (`invalid_points_scale`), LA MEME
--     regle que la CHECK de `tournaments.points_scale` -- un refus NOMME ici
--     plutot qu'une violation de contrainte brute renvoyee au client. `NULL`
--     reprend le bareme par defaut de la colonne.
--
-- Refus : feature_disabled, not_authenticated, invalid_name,
--         invalid_starts_at, invalid_court_count, invalid_round_count,
--         invalid_price, invalid_level_range, club_not_found,
--         invalid_points_scale.
-- Appelable par : tout joueur connecte -- il devient l'organisateur.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_create(
  p_name         text,
  p_starts_at    timestamptz,
  p_court_count  int,
  p_round_count  int,
  p_club_id      uuid    DEFAULT NULL,
  p_level_min    numeric DEFAULT NULL,
  p_level_max    numeric DEFAULT NULL,
  p_price_mad    int     DEFAULT 0,
  p_points_scale jsonb   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me    uuid := public.current_player_id();
  v_scale jsonb;
  v_id    uuid;
BEGIN
  ---------------------------------------------------------------------------
  -- CONTROLES -- aucune ecriture avant la fin de cette section.
  ---------------------------------------------------------------------------
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_name');
  END IF;
  IF p_starts_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_starts_at');
  END IF;
  -- Plafonds (Task 12), MEME regle que la CHECK de `tournaments.court_count` /
  -- `round_count' : sans eux, `court_count * 4` (fn_tournament_open_seats)
  -- deborde l'int a la premiere inscription -- `integer out of range` brut,
  -- au lieu de ce refus nomme, des la creation.
  IF p_court_count IS NULL OR p_court_count <= 0 OR p_court_count > 20 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_court_count');
  END IF;
  IF p_round_count IS NULL OR p_round_count <= 0 OR p_round_count > 20 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_round_count');
  END IF;
  IF p_price_mad IS NULL OR p_price_mad < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_price');
  END IF;
  IF (p_level_min IS NOT NULL AND p_level_min < 0)
     OR (p_level_max IS NOT NULL AND p_level_max < 0)
     OR (p_level_min IS NOT NULL AND p_level_max IS NOT NULL
         AND p_level_min > p_level_max) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_level_range');
  END IF;
  IF p_club_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.clubs WHERE id = p_club_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'club_not_found');
  END IF;

  -- Bareme : reprend le defaut de la colonne quand rien n'est donne, et
  -- applique EN AMONT la meme regle que sa CHECK -- un refus nomme, pas une
  -- violation de contrainte brute.
  --
  -- FORME, pas seulement signe (Task 12) : `@.type() != "number"` avant le
  -- `@ < 0`, sinon `{"1":"abc"}`, `{"1":true}` ou `{"1":{"a":1}}` passaient
  -- tous les trois -- un comparateur `< 0` sur un type incompatible rend
  -- "inconnu" en mode tolerant, jamais vrai, donc aucun ne violait la CHECK
  -- d'origine. Le bareme atteignait alors `fn_tournament_points`, dont le
  -- `round((kv.value)::numeric)` levait une erreur SQL brute AU MILIEU de
  -- `tournament_close` -- transaction annulee, tournoi coince en EN_COURS,
  -- et aucune RPC ne permettait de corriger `points_scale` apres coup. Fermer
  -- cette porte ICI, a la creation, rend cet etat inatteignable plutot que
  -- d'avoir a ecrire un chemin de reparation.
  v_scale := COALESCE(p_points_scale,
    '{"1":100,"2":80,"3":65,"4":55,"5":45,"6":35,"7":25,"8":15}'::jsonb);
  IF jsonb_typeof(v_scale) <> 'object'
     OR jsonb_path_exists(v_scale, '$.* ? (@.type() != "number" || @ < 0)') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_points_scale');
  END IF;

  ---------------------------------------------------------------------------
  -- ECRITURE.
  ---------------------------------------------------------------------------
  INSERT INTO public.tournaments
         (name, club_id, starts_at, level_min, level_max, court_count,
          round_count, price_mad, points_scale, status, created_by)
  VALUES (btrim(p_name), p_club_id, p_starts_at, p_level_min, p_level_max,
          p_court_count, p_round_count, p_price_mad, v_scale,
          'INSCRIPTIONS_OUVERTES', v_me)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_create(
  text, timestamptz, int, int, uuid, numeric, numeric, int, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_create(
  text, timestamptz, int, int, uuid, numeric, numeric, int, jsonb)
  TO authenticated;

-- ############################################################################
-- SECTION INSCRIPTION ET APPARIEMENT (Task 3)
--
-- Regles portees ici, dans l'ordre du brief :
--   * s'inscrire A DEUX cree le binome tout de suite -- pas d'etat d'attente ;
--   * s'inscrire SEUL prend une place et publie le joueur comme cherchant un
--     partenaire, avec son cote et son mode (open_to_join) ;
--   * REJOINDRE un joueur ouvert forme le binome d'un geste ; sinon une
--     demande part, et ACCEPTER une demande REFUSE automatiquement les autres ;
--   * AUCUNE demande ne retient de place -- les deux joueurs occupent deja la
--     leur, donc une demande jamais repondue n'immobilise rien. C'est
--     exactement ce qui rend le mode « sur accord » sans danger, et pourquoi
--     il n'existe AUCUN etat d'inscription « en attente » : une place retenue
--     par un binome non confirme est la derive deja payee avec
--     `spots_available` ;
--   * DEFAIRE un binome rend les deux joueurs seuls EN GARDANT chacun sa
--     place, son rang de file et son mode de consentement -- personne n'est
--     ejecte, ni reouvert malgre lui, parce qu'un partenaire s'est ravise ;
--   * AU-DELA DES PLACES (court_count x 4, comptees EN JOUEURS), l'inscription
--     entre en liste d'attente ordonnee par date ; quand des sieges se
--     liberent, la file avance a concurrence des sieges disponibles.
--
-- LA FILE, en trois regles qui tiennent ensemble :
--   1. un binome avance ENTIER ou pas du tout -- jamais un membre assis et
--      l'autre en attente ;
--   2. un binome est aussi loin dans la file que son membre LE PLUS RECULE
--      (`fn_tournament_align_waitlist`) : s'apparier en attendant est permis,
--      et ne fait gagner aucun rang a personne ;
--   3. un groupe trop grand pour les sieges restants est DEPASSE, pas
--      bloquant : il garde son rang et passe des que la place existe, mais il
--      ne laisse pas un siege vide au coup d'envoi.
--
-- Les places sont un NOMBRE DE JOUEURS : `court_count x 4`. Rien de derive
-- n'est stocke -- deux fonctions le recalculent a la lecture, et elles ne
-- disent pas la meme chose : `fn_tournament_open_seats` (sieges vides, ce que
-- la file consomme) et `fn_tournament_free_places` (ce qu'un NOUVEL inscrit
-- obtiendrait tout de suite : zero des que quelqu'un attend).
--
-- AUCUNE de ces fonctions n'ecrit dans `tournament_participants` : cette table
-- est l'index derive maintenu par le declencheur pose dans tournaments.sql.
-- On ecrit `tournament_teams`, le declencheur fait le reste -- et c'est LUI
-- qui garantit « un joueur, un seul binome par tournoi » (sa PK), ce dont les
-- filets `EXCEPTION WHEN unique_violation` ci-dessous dependent.
--
-- `open_to_join` est un MODE DE CONSENTEMENT, et rien d'autre : « peut-on me
-- prendre d'un geste, ou faut-il mon accord ». Il ne dit pas « je cherche un
-- partenaire » -- ca, c'est l'absence de ligne dans `tournament_participants`.
-- SEUL SON PROPRIETAIRE LE CHANGE : aucune fonction de ce fichier ne le force,
-- ni a l'inscription a deux, ni en defaisant un binome, ni en se desinscrivant.
--
-- `tournament_registrations` n'a PAS de team_id : l'equipe d'un inscrit se lit
-- par JOIN vers `tournament_participants`. Aucun code ci-dessous ne tente d'en
-- garder une seconde copie.
-- ############################################################################

-- Les deux fonctions de l'ancien modele disparaissent : `tournament_register`
-- inscrivait un BINOME (places comptees en binomes, colonne `max_teams`
-- aujourd'hui absente) et `tournament_withdraw(p_team)` etait le forfait EN
-- COURS de tournoi, ecrit avant que le schema ne porte `forfeited_team` /
-- `tournaments.forfeit_games`, et sur des colonnes (`entered_by`,
-- `confirmed_by`) qui n'existent plus. On les SUPPRIME explicitement :
--   * une base ou l'ancienne version aurait ete appliquee garderait sinon une
--     surcharge morte a cote de la nouvelle ;
--   * `tournament_withdraw(uuid)` ne peut pas etre remplacee par CREATE OR
--     REPLACE -- Postgres refuse de renommer un parametre d'entree
--     (p_team -> p_tournament) et la migration echouerait a l'application.
-- Le forfait EN COURS de tournoi a depuis ete ecrit, sous son propre nom et
-- avec sa propre signature : `tournament_forfeit(p_tournament, p_team)`, plus
-- bas dans la section « deroulement d'une rotation ». Il passe par
-- `tournament_matches.forfeited_team` + `tournaments.forfeit_games`, jamais par
-- un 0-6 code en dur.
DROP FUNCTION IF EXISTS public.tournament_register(uuid, uuid);
DROP FUNCTION IF EXISTS public.tournament_withdraw(uuid);

-- ----------------------------------------------------------------------------
-- Les DEMANDES d'appariement (mode « sur accord »).
--
-- La table vit ici et non dans tournaments.sql, qui est fige : c'est cette
-- section qui introduit le mode « sur accord », donc elle apporte son support.
--
-- Ce qu'elle N'EST PAS : une reservation. Une demande ne prend aucune place,
-- et peut rester sans reponse sans rien immobiliser. Les deux joueurs qu'elle
-- relie sont DEJA inscrits -- les deux cles etrangeres composites vers
-- `tournament_registrations` le rendent litteralement impossible autrement, et
-- leur ON DELETE CASCADE fait disparaitre les demandes d'un joueur qui se
-- desinscrit, sans ligne morte a nettoyer.
--
-- L'index unique PARTIEL sur 'pending' autorise l'historique (un joueur
-- refuse, l'autre redemande plus tard) tout en interdisant deux demandes
-- vivantes entre les deux memes joueurs.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tournament_join_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  from_player   uuid NOT NULL REFERENCES public.players(id),
  to_player     uuid NOT NULL REFERENCES public.players(id),
  -- 'pending' : sans reponse. 'accepted' : a forme le binome. 'declined' :
  -- refusee par son destinataire, OU refusee automatiquement parce que l'un
  -- des deux joueurs a forme un binome par ailleurs.
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','accepted','declined')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  responded_at  timestamptz,
  CHECK (from_player <> to_player),
  FOREIGN KEY (tournament_id, from_player)
    REFERENCES public.tournament_registrations(tournament_id, player_id) ON DELETE CASCADE,
  FOREIGN KEY (tournament_id, to_player)
    REFERENCES public.tournament_registrations(tournament_id, player_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS tournament_join_requests_one_pending
  ON public.tournament_join_requests (tournament_id, from_player, to_player)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS tournament_join_requests_inbox
  ON public.tournament_join_requests (tournament_id, to_player)
  WHERE status = 'pending';

ALTER TABLE public.tournament_join_requests ENABLE ROW LEVEL SECURITY;

-- Lecture RESTREINTE aux deux interesses, contrairement aux autres tables de
-- tournoi qui sont en lecture ouverte : un tournoi est un evenement public,
-- « qui a demande a qui » ne l'est pas. Toute ECRITURE passe par les RPC
-- ci-dessous (SECURITY DEFINER), jamais en direct.
-- Le sous-select sur players plutot que public.current_player_id() : c'est le
-- motif dominant des policies de ce depot, et il ne depend pas des droits
-- d'execution d'une fonction.
DROP POLICY IF EXISTS tournament_join_requests_read ON public.tournament_join_requests;
CREATE POLICY tournament_join_requests_read ON public.tournament_join_requests
  FOR SELECT TO authenticated USING (
    from_player IN (SELECT id FROM public.players WHERE user_id = auth.uid()::text)
    OR to_player IN (SELECT id FROM public.players WHERE user_id = auth.uid()::text)
  );

-- ----------------------------------------------------------------------------
-- Helper interne : le score de COTE, port EXACT de scoreSide() (lib/compat.ts).
--
--   const norm = s => !s ? 'mixte' : s==='left'||s==='Gauche' ? 'gauche'
--                                  : s==='right'||s==='Droit' ? 'droit' : 'mixte';
--   if (a==='mixte' || b==='mixte') return 5;          // l'un des deux flexible
--   if (complementaires)            return 10;
--   return 2;                                          // meme cote
--
-- L'ORDRE DES TESTS EST REPRIS TEL QUEL, et il compte : « l'un des deux est
-- flexible » est examine AVANT « complementaires ». Les valeurs de
-- `tournament_registrations.side` ('left','right','both') tombent
-- naturellement dans cette normalisation : 'both' n'est ni 'left' ni 'right',
-- donc 'mixte', donc 5 -- aucune table de correspondance a maintenir.
-- NULL -> 'mixte' aussi : `NULL IN (...)` vaut NULL, donc le CASE tombe dans
-- son ELSE, ce qui reproduit le `!s` du TypeScript.
--
-- Toute evolution de scoreSide() doit etre reportee ICI, et reciproquement.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_tournament_side_score(p_a text, p_b text)
RETURNS int
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH n AS (
    SELECT CASE WHEN p_a IN ('left','Gauche')  THEN 'gauche'
                WHEN p_a IN ('right','Droit')  THEN 'droit'
                ELSE 'mixte' END AS a,
           CASE WHEN p_b IN ('left','Gauche')  THEN 'gauche'
                WHEN p_b IN ('right','Droit')  THEN 'droit'
                ELSE 'mixte' END AS b
  )
  SELECT CASE
           WHEN a = 'mixte' OR b = 'mixte'                    THEN 5
           WHEN (a = 'gauche' AND b = 'droit')
             OR (a = 'droit'  AND b = 'gauche')               THEN 10
           ELSE 2
         END
    FROM n;
$$;

REVOKE ALL ON FUNCTION public.fn_tournament_side_score(text, text) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Helper interne : « niveaux proches », port EXACT de scoreElo() (lib/compat.ts).
--   ecart <= 75 -> 40 ; <= 150 -> 32 ; <= 250 -> 20 ; <= 400 -> 10 ; sinon 0.
-- Meme motif que le cote : la regle existe deja cote TypeScript, on la reprend
-- au lieu d'en ecrire une seconde qui divergerait. 1000 est l'ELO par defaut
-- du depot (cf. elo_on_validate.sql), pour un joueur sans score.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_tournament_elo_score(p_a numeric, p_b numeric)
RETURNS int
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
           WHEN abs(coalesce(p_a, 1000) - coalesce(p_b, 1000)) <=  75 THEN 40
           WHEN abs(coalesce(p_a, 1000) - coalesce(p_b, 1000)) <= 150 THEN 32
           WHEN abs(coalesce(p_a, 1000) - coalesce(p_b, 1000)) <= 250 THEN 20
           WHEN abs(coalesce(p_a, 1000) - coalesce(p_b, 1000)) <= 400 THEN 10
           ELSE 0
         END;
$$;

REVOKE ALL ON FUNCTION public.fn_tournament_elo_score(numeric, numeric) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- DEUX comptages, et ils ne disent pas la meme chose. Les confondre a produit
-- un mensonge d'affichage (« il reste une place » alors que tout arrivant
-- tombait en file), donc ils portent desormais deux noms.
--
-- `fn_tournament_open_seats` -- les SIEGES VIDES, brut :
--   sieges = tournaments.court_count x 4  (jamais stocke, toujours derive)
--   pris   = les inscriptions qui ne sont PAS en liste d'attente
-- C'est le nombre que la FILE consomme quand elle avance. Une inscription est
-- la seule chose qui occupe un siege : ni une demande, ni un binome -- un
-- binome n'est qu'une relation entre deux places deja prises.
--
-- `fn_tournament_free_places` -- les places qu'un NOUVEL INSCRIT obtiendrait
-- IMMEDIATEMENT. Vaut zero des que quelqu'un attend, quel que soit le nombre
-- de sieges vides : ces sieges appartiennent a la file, pas au prochain
-- arrivant. C'est la seule lecture qu'un ecran peut afficher honnetement, et
-- c'est elle qui pilote le statut INSCRIPTIONS_OUVERTES / COMPLET.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_tournament_open_seats(p_tournament uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.court_count * 4
       - (SELECT count(*)
            FROM public.tournament_registrations r
           WHERE r.tournament_id = t.id
             AND r.waitlist_position IS NULL)::int
    FROM public.tournaments t
   WHERE t.id = p_tournament;
$$;

REVOKE ALL ON FUNCTION public.fn_tournament_open_seats(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_tournament_free_places(p_tournament uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
           WHEN EXISTS (SELECT 1
                          FROM public.tournament_registrations r
                         WHERE r.tournament_id = p_tournament
                           AND r.waitlist_position IS NOT NULL)
           THEN 0
           ELSE public.fn_tournament_open_seats(p_tournament)
         END;
$$;

REVOKE ALL ON FUNCTION public.fn_tournament_free_places(uuid) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Helper interne : le statut suit la capacite, entre INSCRIPTIONS_OUVERTES et
-- COMPLET, et RIEN D'AUTRE PAR DEFAUT. La clause de garde est ce qui empeche ce
-- helper de faire reculer un tournoi depuis CHECK_IN, PRET, EN_COURS ou
-- au-dela : la machine a etats appartient a l'organisateur, ce helper ne fait
-- QUE refleter « reste-t-il une place », jamais decider seul de rouvrir.
--
-- Il lit `fn_tournament_free_places`, PAS `fn_tournament_open_seats` : le
-- statut annonce ce qu'un nouvel inscrit obtiendrait, et avec une file en
-- cours, il n'obtient rien. Un tournoi qui affiche INSCRIPTIONS_OUVERTES
-- pendant que tout arrivant tombe en liste d'attente est un mensonge
-- d'affichage.
--
-- ⚠️ `p_allow_reopen` (Task 12) -- ELARGIT LA FENETRE, NE DUPLIQUE PAS LA
-- REGLE. La relecture de branche a trouve un CHECK_IN sans issue : une fois le
-- pointage ouvert, RIEN ne pouvait plus repasser un tournoi en
-- INSCRIPTIONS_OUVERTES, meme quand il manque un binome et que personne n'a
-- encore ete pointe. Le remede est `tournament_reopen_registrations`, mais
-- elle NE DOIT PAS ecrire `status` elle-meme -- ce helper reste le SEUL
-- ecrivain du statut de capacite, sans quoi deux fonctions pourraient un jour
-- calculer « ouvert ou complet » differemment.
--
-- Le defaut (`false`) NE CHANGE RIEN au comportement existant : tous les
-- autres appelants de ce fichier (`tournament_register`, `tournament_join`,
-- `tournament_respond_join`, `fn_tournament_promote_waitlist`, etc.)
-- continuent d'appeler SANS ce parametre, donc avec la fenetre d'origine.
-- SEUL `tournament_reopen_registrations` passe `true` -- explicitement, pour
-- UN geste explicite de l'organisateur. Sans ce distinguo, elargir purement et
-- simplement la fenetre a CHECK_IN/PRET aurait fait qu'un simple retrait
-- pendant le pointage (qui appelle aussi `fn_tournament_promote_waitlist`,
-- donc ce helper) aurait pu repasser le tournoi en INSCRIPTIONS_OUVERTES tout
-- seul -- une reouverture EN EFFET DE BORD, jamais demandee par personne.
-- ----------------------------------------------------------------------------
-- Ajouter un parametre CHANGE la signature : Postgres creerait une SURCHARGE a
-- cote de l'ancienne (uuid) plutot que de la remplacer, et un appel a un seul
-- argument deviendrait AMBIGU entre les deux. On supprime l'ancienne d'abord.
DROP FUNCTION IF EXISTS public.fn_tournament_sync_capacity_status(uuid);

CREATE OR REPLACE FUNCTION public.fn_tournament_sync_capacity_status(
  p_tournament   uuid,
  p_allow_reopen boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target text;
BEGIN
  v_target := CASE WHEN coalesce(public.fn_tournament_free_places(p_tournament), 0) > 0
                   THEN 'INSCRIPTIONS_OUVERTES' ELSE 'COMPLET' END;
  UPDATE public.tournaments
     SET status = v_target
   WHERE id = p_tournament
     AND (
           status IN ('INSCRIPTIONS_OUVERTES','COMPLET')
           OR (p_allow_reopen AND status IN ('CHECK_IN','PRET'))
         )
     AND status <> v_target;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_tournament_sync_capacity_status(uuid, boolean) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Helper interne : UN BINOME EST AUSSI LOIN DANS LA FILE QUE SON MEMBRE LE
-- PLUS RECULE.
--
-- Deux joueurs en attente ont le droit de s'apparier -- c'est meme utile, ils
-- avanceront ensemble. Mais sans cette regle, le #40 qui rejoint le #3 se
-- retrouverait promu avec lui : la file serait doublee par 36 personnes d'un
-- seul geste. Aligner les deux positions sur la PLUS GRANDE rend le saut
-- impossible PAR CONSTRUCTION, plutot que par un garde-fou qu'il faudrait
-- penser a ecrire dans chaque fonction de promotion.
--
-- Les deux membres partagent alors UNE position : un binome occupe un rang,
-- pas deux, et la file le voit comme un bloc. Si le binome se defait, les deux
-- gardent ce rang commun et redeviennent deux candidats independants de meme
-- rang -- aucun des deux n'a rien gagne au passage.
--
-- Binome assis (les deux positions NULL) : le WHERE ne selectionne rien, la
-- fonction ne fait rien. Le cas mixte (un assis, un en attente) n'existe pas,
-- `waitlist_mismatch` le refuse en amont.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_tournament_align_waitlist(
  p_tournament uuid, p_a uuid, p_b uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tournament_registrations r
     SET waitlist_position = (
           SELECT max(r2.waitlist_position)
             FROM public.tournament_registrations r2
            WHERE r2.tournament_id = p_tournament
              AND r2.player_id IN (p_a, p_b))
   WHERE r.tournament_id = p_tournament
     AND r.player_id IN (p_a, p_b)
     AND r.waitlist_position IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_tournament_align_waitlist(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Helper interne : refuser toutes les demandes VIVANTES qui touchent l'un des
-- deux joueurs -- appele des qu'un binome se forme, par quelque chemin que ce
-- soit (rejoindre, accepter, appariement automatique).
--
-- C'est la mise en oeuvre de « accepter une demande refuse automatiquement les
-- autres recues » -- en plus large, et volontairement : une demande ENVOYEE
-- par un joueur qui vient de trouver un partenaire est tout aussi morte qu'une
-- demande recue. La laisser vivante offrirait a son destinataire un bouton
-- « accepter » qui ne peut plus aboutir qu'a un refus.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_tournament_close_pending_requests(
  p_tournament uuid, p_a uuid, p_b uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int;
BEGIN
  WITH d AS (
    UPDATE public.tournament_join_requests
       SET status = 'declined', responded_at = now()
     WHERE tournament_id = p_tournament
       AND status = 'pending'
       AND (from_player IN (p_a, p_b) OR to_player IN (p_a, p_b))
    RETURNING 1
  )
  SELECT count(*)::int INTO v_n FROM d;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_tournament_close_pending_requests(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Helper interne : LA FILE AVANCE.
--
-- Appele apres TOUTE mutation d'inscription -- pas seulement apres un retrait.
-- Un siege peut se liberer sans que personne ne parte : il suffit qu'un
-- binome, trop grand pour le dernier siege, aille en file et laisse ce siege
-- au solo suivant. N'appeler la promotion que sur le chemin du retrait
-- laissait ce siege vide pour de bon.
--
-- Elle est IDEMPOTENTE : sans siege vide, ou sans file, elle ne fait rien.
-- L'appeler « pour rien » ne coute qu'une lecture, alors qu'oublier de
-- l'appeler coute un joueur au tournoi. Elle finit toujours par
-- `fn_tournament_sync_capacity_status`, donc un appelant qui l'invoque N'A PAS
-- a synchroniser le statut ensuite.
--
-- Regle du brief : « quand des places se liberent, la file avance a
-- concurrence des sieges disponibles », dans l'ORDRE.
--
-- Un GROUPE est l'unite qui avance : un joueur seul, ou les DEUX membres d'un
-- binome. Un binome ne se coupe jamais en deux -- un joueur assis dont le
-- partenaire attend serait un binome a moitie inscrit, exactement l'etat
-- batard que ce chantier refuse. Et comme `fn_tournament_align_waitlist`
-- donne aux deux membres la MEME position, un groupe occupe un rang unique :
-- il n'y a pas de coequipier a aller chercher trente rangs plus loin.
--
-- Ruling: UN GROUPE TROP GRAND EST DEPASSE, PAS BLOQUANT. Si la tete est un
-- binome qui reclame 2 sieges et qu'un seul est libre, on ne s'arrete pas --
-- on continue a descendre la file et le premier joueur seul qui rentre prend
-- le siege. Le binome GARDE SA POSITION et passe devant tout le monde des que
-- deux sieges existent en meme temps.
--   * s'arreter laisserait un siege VIDE au coup d'envoi, ce qui coute un
--     joueur au tournoi -- le prix est paye par l'organisateur et par les 15
--     autres, pour proteger un rang ;
--   * le binome n'est ni coupe, ni recule, ni penalise : il n'est depasse que
--     par ce qui tient dans un espace ou lui ne tient pas.
-- Contrepartie assumee, ecrite ici pour qu'elle ne surprenne personne : si les
-- sieges se liberent un par un et qu'il reste des joueurs seuls derriere, un
-- binome peut se faire depasser plusieurs fois. C'est le prix du siege jamais
-- vide.
--
-- Les positions ne sont PAS renumerotees apres une promotion : seul l'ORDRE
-- compte, et laisser des trous evite de reecrire toute la file a chaque
-- mouvement. `waitlist_position IS NULL` = j'ai ma place ; sinon j'attends.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_tournament_promote_waitlist(p_tournament uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seats    int;
  v_cand     uuid;
  v_group    uuid[];
  v_size     int;
  v_promoted int := 0;
BEGIN
  -- On parcourt la file DANS L'ORDRE. Le curseur travaille sur l'instantane
  -- pris a l'ouverture de la boucle : un joueur promu en cours de route (comme
  -- coequipier, ou par son propre tour) y figure encore, d'ou le CONTINUE qui
  -- verifie qu'il attend toujours.
  FOR v_cand IN
    SELECT r.player_id
      FROM public.tournament_registrations r
     WHERE r.tournament_id = p_tournament
       AND r.waitlist_position IS NOT NULL
     ORDER BY r.waitlist_position, r.registered_at, r.player_id
  LOOP
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM public.tournament_registrations r
       WHERE r.tournament_id = p_tournament
         AND r.player_id = v_cand
         AND r.waitlist_position IS NOT NULL);

    -- Les SIEGES VIDES, pas `fn_tournament_free_places` : ici c'est justement
    -- la file qui les consomme, et cette derniere vaudrait zero tant qu'elle
    -- n'est pas vide -- personne n'avancerait jamais.
    v_seats := public.fn_tournament_open_seats(p_tournament);
    EXIT WHEN v_seats IS NULL OR v_seats <= 0;

    -- Le groupe indissociable : le candidat, plus son coequipier s'il en a un
    -- ET qu'il attend lui aussi. Le coequipier se lit dans
    -- tournament_participants -- l'inscription, elle, ne porte aucun team_id.
    SELECT coalesce(array_agg(r.player_id), ARRAY[]::uuid[]) INTO v_group
      FROM public.tournament_registrations r
     WHERE r.tournament_id = p_tournament
       AND r.waitlist_position IS NOT NULL
       AND (r.player_id = v_cand
            OR r.player_id IN (
                 SELECT mate.player_id
                   FROM public.tournament_participants me
                   JOIN public.tournament_participants mate
                     ON mate.tournament_id = me.tournament_id
                    AND mate.team_id       = me.team_id
                  WHERE me.tournament_id = p_tournament
                    AND me.player_id     = v_cand));

    v_size := coalesce(array_length(v_group, 1), 0);
    CONTINUE WHEN v_size = 0;         -- ceinture : ne peut pas arriver
    CONTINUE WHEN v_size > v_seats;   -- trop grand pour ce qui reste : on passe

    UPDATE public.tournament_registrations
       SET waitlist_position = NULL
     WHERE tournament_id = p_tournament
       AND player_id = ANY(v_group);

    v_promoted := v_promoted + v_size;
  END LOOP;

  PERFORM public.fn_tournament_sync_capacity_status(p_tournament);
  RETURN v_promoted;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_tournament_promote_waitlist(uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- tournament_register(p_tournament, p_side, p_open_to_join, p_partner)
--
-- S'inscrire, seul ou a deux. A deux, le binome est cree DANS LE MEME APPEL --
-- pas d'etat d'attente, pas de place retenue par un binome non confirme.
--
-- p_side est OBLIGATOIRE et vaut pour CE tournoi : le cote se declare le soir
-- meme, pas dans le profil (on s'adapte a son partenaire d'un soir). La
-- colonne est NOT NULL sans defaut, et cette fonction refuse AVANT d'ecrire
-- plutot que de deviner : un cote par defaut serait un cote FAUX, pas une
-- absence de cote.
--
-- Le partenaire designe est inscrit SANS AUCUNE DECLARATION FAITE EN SON NOM :
-- cote 'both' (« pas de contrainte », et non un cote devine -- recopier celui
-- de l'invitant ou le deduire du profil lui preterait un choix qu'il n'a pas
-- fait) et `open_to_join` ecrit EXPLICITEMENT a `false` -- PAS le defaut de la
-- colonne (qui est `true`). Un partenaire invite n'a rien demande, et la
-- direction sure d'un consentement qu'il n'a pas donne est FERMEE : ouvert, il
-- serait joignable en un geste par n'importe qui des que ce binome se defait,
-- pour un tournoi dont il n'a meme pas encore ete prevenu (cf.
-- `fn_tournament_registration_notify` plus bas, qui l'en previent).
-- `open_to_join` est un MODE DE CONSENTEMENT : seul
-- son proprietaire le change, jamais une fonction appelee par un tiers, et
-- jamais un effet de bord.
--
-- `open_to_join` ne dit PAS « je cherche un partenaire » -- ca, c'est
-- l'absence de ligne dans `tournament_participants`, et c'est deja ecrit
-- quelque part. Il dit seulement « on peut me prendre d'un geste, ou faut-il
-- mon accord ». D'ou : l'inscription a deux ne le met pas a false (le binome
-- suffit a me rendre indisponible), et defaire un binome ne le remet pas a
-- true.
--
-- Places : court_count x 4, EN JOUEURS. Au-dela, l'inscription entre en file.
-- Un binome entre en file ENTIER (2 places d'un coup) ou pas du tout, et un
-- nouvel inscrit ne passe JAMAIS devant une file existante : `free_places`
-- vaut zero des que quelqu'un attend, meme s'il reste des sieges vides.
--
-- Refus : feature_disabled, not_authenticated, tournament_not_found,
--         tournament_not_open, invalid_side, already_registered,
--         invalid_partner, partner_not_found, partner_already_registered.
-- Appelable par : tout joueur connecte, pour lui-meme.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_register(
  p_tournament   uuid,
  p_side         text,
  p_open_to_join boolean DEFAULT true,
  p_partner      uuid    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me      uuid := public.current_player_id();
  v_status  text;
  v_free    int;
  v_need    int := 1;
  v_last    int := 0;
  v_seated  boolean;
  v_team    uuid;
BEGIN
  ---------------------------------------------------------------------------
  -- CONTROLES -- aucune ecriture avant la fin de cette section. Un refus ne
  -- leve pas, donc rien ne serait annule : un INSERT place ici laisserait sa
  -- ligne derriere lui ET annoncerait un refus.
  ---------------------------------------------------------------------------
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;
  IF p_side IS NULL OR p_side NOT IN ('left','right','both') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_side');
  END IF;

  -- FOR UPDATE : serialise TOUT ce qui touche a ce tournoi. Deux inscriptions
  -- simultanees ne peuvent pas lire la meme derniere place libre, et deux
  -- appariements simultanes ne peuvent pas se croiser.
  SELECT t.status INTO v_status
    FROM public.tournaments t WHERE t.id = p_tournament FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  -- COMPLET accepte encore : au-dela des places on entre en file d'attente,
  -- ce n'est pas un refus. A partir de CHECK_IN, les inscriptions sont closes.
  IF v_status NOT IN ('INSCRIPTIONS_OUVERTES','COMPLET') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_open');
  END IF;

  IF EXISTS (SELECT 1 FROM public.tournament_registrations r
              WHERE r.tournament_id = p_tournament AND r.player_id = v_me) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_registered');
  END IF;

  IF p_partner IS NOT NULL THEN
    IF p_partner = v_me THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_partner');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = p_partner) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'partner_not_found');
    END IF;
    -- Deja inscrit : il a peut-etre deja un binome, ou attend une reponse.
    -- Dans tous les cas on ne l'inscrit pas une seconde fois -- c'est
    -- `tournament_join` qui sert a rejoindre un deja-inscrit.
    IF EXISTS (SELECT 1 FROM public.tournament_registrations r
                WHERE r.tournament_id = p_tournament AND r.player_id = p_partner) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'partner_already_registered');
    END IF;
    v_need := 2;
  END IF;

  -- `free_places` (et non `open_seats`) : il vaut deja zero quand une file
  -- existe, donc ce seul test porte les DEUX regles -- ne pas doubler la file,
  -- et ne s'asseoir que si le groupe ENTIER tient.
  v_free := public.fn_tournament_free_places(p_tournament);
  v_seated := (coalesce(v_free, 0) >= v_need);
  IF NOT v_seated THEN
    SELECT coalesce(max(r.waitlist_position), 0) INTO v_last
      FROM public.tournament_registrations r
     WHERE r.tournament_id = p_tournament;
  END IF;

  ---------------------------------------------------------------------------
  -- ECRITURES -- toutes dans LE MEME sous-bloc. Une violation annule le
  -- sous-bloc ENTIER (mon inscription, celle du partenaire, le binome) et rend
  -- un refus : jamais une inscription a moitie ecrite.
  ---------------------------------------------------------------------------
  BEGIN
    -- Mon mode de consentement est celui que J'AI demande, avec ou sans
    -- partenaire : ce n'est pas a l'inscription d'en decider pour moi.
    INSERT INTO public.tournament_registrations
           (tournament_id, player_id, side, open_to_join, waitlist_position)
    VALUES (p_tournament, v_me, p_side,
            coalesce(p_open_to_join, true),
            CASE WHEN v_seated THEN NULL ELSE v_last + 1 END);

    IF p_partner IS NOT NULL THEN
      -- MEME position que moi, et non v_last + 2 : un binome occupe UN rang
      -- dans la file et avance en bloc (cf. fn_tournament_align_waitlist).
      --
      -- open_to_join = FALSE, explicitement, et NON le defaut de la colonne :
      -- il n'a rien demande, et le defaut sur est FERME. Ouvert, il serait
      -- joignable en un geste par n'importe qui des que ce binome se defait --
      -- un consentement qu'il n'a jamais donne, a un tournoi dont il n'a
      -- meme pas encore ete prevenu (cf. `fn_tournament_registration_notify`
      -- plus bas, qui l'en previent). Il l'ouvre lui-meme, quand il veut, par
      -- `tournament_set_open_to_join`.
      INSERT INTO public.tournament_registrations
             (tournament_id, player_id, side, open_to_join, waitlist_position)
      VALUES (p_tournament, p_partner, 'both', false,
              CASE WHEN v_seated THEN NULL ELSE v_last + 1 END);

      -- Le declencheur de tournaments.sql remplit tournament_participants et
      -- fait echouer ici, sur sa PK, tout joueur deja engage dans un autre
      -- binome de ce tournoi.
      INSERT INTO public.tournament_teams (tournament_id, player1_id, player2_id)
      VALUES (p_tournament, v_me, p_partner)
      RETURNING id INTO v_team;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    -- Course perdue : quelqu'un s'est inscrit ou apparie entre nos controles
    -- et nos ecritures. Tout le sous-bloc est annule -- et on regarde QUI a
    -- collisionne, parce que dire « tu es deja inscrit » a quelqu'un qui ne
    -- l'est pas l'enverrait chercher une inscription inexistante.
    IF EXISTS (SELECT 1 FROM public.tournament_registrations r
                WHERE r.tournament_id = p_tournament AND r.player_id = v_me)
       OR EXISTS (SELECT 1 FROM public.tournament_participants tp
                   WHERE tp.tournament_id = p_tournament AND tp.player_id = v_me) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'already_registered');
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'partner_already_registered');
  END;

  -- APRES l'ecriture, jamais avant. Une inscription peut LIBERER un siege pour
  -- quelqu'un d'autre : un binome qui ne tient pas dans le dernier siege part
  -- en file, et ce siege revient alors au premier solo qui attend. Sans cet
  -- appel, il restait vide jusqu'au coup d'envoi.
  -- (La promotion synchronise le statut elle-meme : pas de second appel.)
  PERFORM public.fn_tournament_promote_waitlist(p_tournament);

  RETURN jsonb_build_object(
    'ok', true,
    'team_id', v_team,
    'waitlisted', NOT v_seated,
    'waitlist_position', CASE WHEN v_seated THEN NULL ELSE v_last + 1 END);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_register(uuid, text, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_register(uuid, text, boolean, uuid) TO authenticated;

-- ============================================================================
-- fn_tournament_registration_notify -- LE PARTENAIRE INVITE EST PREVENU.
--
-- Ce que la spec exige, et que ce fichier ne tenait pas avant cette tache :
-- « le partenaire est notifie et peut defaire le binome ». Sans ce
-- declencheur, N'IMPORTE QUEL joueur connecte pouvait appeler
--     tournament_register(tournoi, son_cote, son_mode, <mon_id>)
-- et inscrire quelqu'un d'autre a un tournoi AFFICHANT UN PRIX, avec un cote
-- 'both' que la personne n'a pas declare, deja engagee dans un binome -- sans
-- qu'aucune ligne ne l'en informe. Au check-in elle restait un 'pending' qui
-- ne se presente jamais, et l'organisateur decouvrait le trou le soir meme.
--
-- Pourquoi c'est un DECLENCHEUR et non un appel fait par `tournament_register`
-- elle-meme : ce depot notifie par DECLENCHEUR + pg_net -> edge function
-- `send-push` (motif de `cancel_game_notify.sql` / `defi_server_notifs.sql` /
-- `match_reminders.sql`), jamais depuis une RPC appelee par le client -- une
-- notification poussee par le client se perd des que le client se ferme.
--
-- AFTER INSERT ON `tournament_registrations` FOR EACH ROW : pousse a
-- `NEW.player_id` quand `NEW.player_id <> current_player_id()`, c'est-a-dire
-- quand la ligne vient d'etre creee POUR LUI PAR UN AUTRE -- le SEUL cas que
-- `tournament_register` produit avec `p_partner` (ma propre ligne, dans le
-- meme appel, a toujours `player_id = current_player_id()` et ne notifie donc
-- personne : je sais deja que je viens de m'inscrire). `current_player_id()`
-- reste le bon joueur ici -- `auth.uid()` est le JWT de la session, pas le
-- proprietaire de la fonction SECURITY DEFINER qui a fait l'INSERT.
--
-- Le message porte : qui l'a inscrit, quel tournoi, le PRIX AFFICHE, et
-- qu'il peut defaire le binome (`tournament_leave_team`) ou se desinscrire
-- (`tournament_withdraw`) -- plus une invitation a declarer son cote
-- (`tournament_set_side`, Task 11), laisse a 'both' faute de declaration.
--
-- ⚠️ RESTE UNE PLACE VACANTE, DELIBEREMENT LAISSEE : les DEMANDES
-- d'appariement (`tournament_join_requests`) ne notifient toujours pas leur
-- destinataire ni leur demandeur. Une demande, contrairement a une inscription
-- imposee, N'ENGAGE NI PLACE NI PRIX -- son destinataire la decouvre au pire
-- en rouvrant l'ecran -- donc ce manque n'a pas le meme caractere urgent, et
-- l'ecrire reste a faire (`fn_tournament_join_request_notify`, meme motif :
-- AFTER INSERT prevenir `to_player`, AFTER UPDATE vers 'accepted'/'declined'
-- prevenir `from_player`).
--
-- ⚠️ LA PROMOTION DEPUIS LA LISTE D'ATTENTE, AJOUTEE ICI (Task 12), PAS DANS
-- UN DECLENCHEUR A PART. La relecture de branche a trouve `fn_tournament_
-- promote_waitlist` MUETTE : elle fait `SET waitlist_position = NULL` et rien
-- d'autre, et le SEUL declencheur pose jusqu'ici etait AFTER INSERT -- une
-- promotion est un UPDATE, qui ne le croise jamais. Un joueur qui passe de la
-- file au tournoi ne l'apprenait qu'en rouvrant l'ecran, pour un evenement
-- DATE avec un PRIX affiche -- la meme urgence que le partenaire invite
-- ci-dessus, donc la meme fonction : un second declencheur (AFTER UPDATE,
-- distingue par un WHEN a la creation) appelle CETTE fonction, qui branche
-- sur `TG_OP` pour choisir le message. Un troisieme fichier ne ferait que
-- dupliquer `v_tname` / `v_price` / `v_key` / `v_url`.
--
-- Le WHEN du declencheur (`OLD.waitlist_position IS NOT NULL AND
-- NEW.waitlist_position IS NULL`) est la SEULE ecriture qui declenche ce
-- bloc : le seul autre ecrivain de `waitlist_position`,
-- `fn_tournament_align_waitlist`, ne le passe JAMAIS a NULL -- il aligne deux
-- positions non NULL sur la plus grande. Ce bloc ne peut donc se declencher
-- que par une authentique promotion.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_tournament_registration_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me     uuid := public.current_player_id();
  v_by     text;
  v_tname  text;
  v_price  int;
  v_key    text;
  v_url    text := 'https://icshhobxeppttgayxmba.supabase.co/functions/v1/send-push';
  v_title  text;
  v_body   text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Seul le cas produit par `tournament_register(..., p_partner)` : une
    -- ligne creee POUR quelqu'un d'autre. Ma propre inscription ne notifie
    -- personne.
    IF v_me IS NULL OR NEW.player_id = v_me THEN RETURN NEW; END IF;
  END IF;
  -- TG_OP = 'UPDATE' : le WHEN du declencheur a deja filtre -- on est
  -- forcement dans le cas d'une promotion.

  SELECT t.name, t.price_mad INTO v_tname, v_price
    FROM public.tournaments t WHERE t.id = NEW.tournament_id;
  IF v_tname IS NULL THEN RETURN NEW; END IF;

  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
  IF v_key IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' THEN
    v_title := '🏆 Une place s''est liberee';
    v_body  := 'Tu as maintenant ta place a « ' || v_tname || ' »'
               || CASE WHEN coalesce(v_price, 0) > 0
                       THEN ' (' || v_price || ' MAD affiches)' ELSE '' END
               || '.';
  ELSE
    SELECT name INTO v_by FROM public.players WHERE id = v_me;
    v_title := '🏆 Inscrit·e a un tournoi';
    v_body  := coalesce(v_by, 'Un joueur') || ' t''a inscrit·e a « ' || v_tname || ' »'
               || CASE WHEN coalesce(v_price, 0) > 0
                       THEN ' (' || v_price || ' MAD affiches)' ELSE '' END
               || '. Tu peux defaire le binome, te desinscrire, ou declarer ton cote.';
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
    body    := jsonb_build_object(
                 'playerIds', to_jsonb(ARRAY[NEW.player_id]),
                 'title', v_title,
                 'body',  v_body,
                 'data',  jsonb_build_object('type', 'tournament', 'tournamentId', NEW.tournament_id))
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_tournament_registration_notify() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tournament_registration_notify ON public.tournament_registrations;
CREATE TRIGGER trg_tournament_registration_notify
  AFTER INSERT ON public.tournament_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_tournament_registration_notify();

-- Second declencheur (Task 12), meme fonction : la promotion depuis la liste
-- d'attente. Voir l'en-tete de `fn_tournament_registration_notify` ci-dessus.
DROP TRIGGER IF EXISTS trg_tournament_registration_promoted ON public.tournament_registrations;
CREATE TRIGGER trg_tournament_registration_promoted
  AFTER UPDATE ON public.tournament_registrations
  FOR EACH ROW
  WHEN (OLD.waitlist_position IS NOT NULL AND NEW.waitlist_position IS NULL)
  EXECUTE FUNCTION public.fn_tournament_registration_notify();

-- ============================================================================
-- tournament_join(p_tournament, p_player)
--
-- Rejoindre un inscrit. Si sa fiche est OUVERTE, le binome se forme d'un
-- geste ; sinon une DEMANDE part, qu'il accepte ou refuse -- et cette demande
-- ne retient AUCUNE place : les deux joueurs occupent deja la leur.
--
-- Une inscription n'a pas d'identifiant propre : sa cle est naturelle,
-- (tournament_id, player_id). Le brief l'appelle `p_registration` ; ce sont
-- ici les deux colonnes de cette cle, faute d'un id de substitution -- en
-- inventer un donnerait une seconde identite a la meme ligne.
--
-- Refus : feature_disabled, not_authenticated, tournament_not_found,
--         tournament_not_open, invalid_partner, not_registered,
--         partner_not_found, already_in_team, partner_already_registered,
--         waitlist_mismatch, not_open_to_join.
-- Appelable par : tout joueur connecte, inscrit a ce tournoi.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_join(p_tournament uuid, p_player uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me     uuid := public.current_player_id();
  v_status text;
  v_mine   public.tournament_registrations%ROWTYPE;
  v_target public.tournament_registrations%ROWTYPE;
  v_team   uuid;
  v_req    uuid;
  v_closed int;
BEGIN
  ---------------------------------------------------------------------------
  -- CONTROLES -- avant toute ecriture.
  ---------------------------------------------------------------------------
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;
  IF p_player IS NULL OR p_player = v_me THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_partner');
  END IF;

  SELECT t.status INTO v_status
    FROM public.tournaments t WHERE t.id = p_tournament FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  -- On s'apparie jusqu'au lancement : un binome se fait et se defait tant que
  -- le tournoi n'a pas commence.
  IF v_status NOT IN ('INSCRIPTIONS_OUVERTES','COMPLET','CHECK_IN','PRET') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_open');
  END IF;

  SELECT * INTO v_mine FROM public.tournament_registrations r
   WHERE r.tournament_id = p_tournament AND r.player_id = v_me;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_registered');
  END IF;

  SELECT * INTO v_target FROM public.tournament_registrations r
   WHERE r.tournament_id = p_tournament AND r.player_id = p_player;
  IF NOT FOUND THEN
    -- Pas inscrit (ou plus) a CE tournoi : il n'y a personne a rejoindre.
    RETURN jsonb_build_object('ok', false, 'reason', 'partner_not_found');
  END IF;

  IF EXISTS (SELECT 1 FROM public.tournament_participants tp
              WHERE tp.tournament_id = p_tournament AND tp.player_id = v_me) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_in_team');
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_participants tp
              WHERE tp.tournament_id = p_tournament AND tp.player_id = p_player) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'partner_already_registered');
  END IF;

  -- Un binome ne peut pas enjamber la file : un joueur assis et un joueur en
  -- attente formeraient une equipe dont une moitie seulement a sa place, et
  -- qui au lancement jouerait avec un joueur qui n'en a pas.
  IF (v_mine.waitlist_position IS NULL) <> (v_target.waitlist_position IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'waitlist_mismatch');
  END IF;

  ---------------------------------------------------------------------------
  -- CHEMIN 1 : fiche ouverte -> le binome se forme tout de suite.
  ---------------------------------------------------------------------------
  IF v_target.open_to_join THEN
    BEGIN
      INSERT INTO public.tournament_teams (tournament_id, player1_id, player2_id)
      VALUES (p_tournament, v_me, p_player)
      RETURNING id INTO v_team;
    EXCEPTION WHEN unique_violation THEN
      -- La PK de tournament_participants a parle : l'un des deux vient d'etre
      -- apparie ailleurs.
      RETURN jsonb_build_object('ok', false, 'reason', 'already_in_team');
    END;

    -- Deux joueurs en attente qui s'apparient prennent tous deux la position
    -- du plus recule : sans ca, le dernier de la file entrerait avec le
    -- premier venu et doublerait tout le monde.
    PERFORM public.fn_tournament_align_waitlist(p_tournament, v_me, p_player);

    v_closed := public.fn_tournament_close_pending_requests(p_tournament, v_me, p_player);

    -- Meme regle que partout : toute mutation d'inscription fait tourner la
    -- file. Ce chemin-ci ne libere aucun siege, donc l'appel ne fera
    -- probablement rien -- mais « toujours » se retient, « sauf ici » s'oublie,
    -- et c'est un oubli de ce genre qui laissait un siege vide.
    PERFORM public.fn_tournament_promote_waitlist(p_tournament);

    RETURN jsonb_build_object('ok', true, 'mode', 'team',
                              'team_id', v_team, 'requests_closed', v_closed);
  END IF;

  ---------------------------------------------------------------------------
  -- CHEMIN 2 : fiche « sur accord » -> une demande part. Aucune place bougee.
  ---------------------------------------------------------------------------
  SELECT jr.id INTO v_req
    FROM public.tournament_join_requests jr
   WHERE jr.tournament_id = p_tournament
     AND jr.from_player   = v_me
     AND jr.to_player     = p_player
     AND jr.status        = 'pending';
  IF FOUND THEN
    -- Deja demande, toujours sans reponse : c'est le sens litteral de
    -- `not_open_to_join` -- ce joueur ne se rejoint pas d'un geste, et sa
    -- reponse est ce qu'on attend. L'ecran montre la demande en cours plutot
    -- que d'en empiler une seconde.
    RETURN jsonb_build_object('ok', false, 'reason', 'not_open_to_join',
                              'request_id', v_req);
  END IF;

  BEGIN
    INSERT INTO public.tournament_join_requests (tournament_id, from_player, to_player)
    VALUES (p_tournament, v_me, p_player)
    RETURNING id INTO v_req;
  EXCEPTION WHEN unique_violation THEN
    -- Course sur l'index unique partiel : la demande existe deja, on la rend.
    SELECT jr.id INTO v_req
      FROM public.tournament_join_requests jr
     WHERE jr.tournament_id = p_tournament
       AND jr.from_player   = v_me
       AND jr.to_player     = p_player
       AND jr.status        = 'pending';
    RETURN jsonb_build_object('ok', false, 'reason', 'not_open_to_join',
                              'request_id', v_req);
  END;

  RETURN jsonb_build_object('ok', true, 'mode', 'request', 'request_id', v_req);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_join(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_join(uuid, uuid) TO authenticated;

-- ============================================================================
-- tournament_respond_join(p_request, p_accept)
--
-- Le destinataire repond. ACCEPTER forme le binome ET REFUSE AUTOMATIQUEMENT
-- toutes les autres demandes vivantes qui le touchent, lui ou son nouveau
-- partenaire -- sans quoi un ecran offrirait un « accepter » qui ne peut plus
-- aboutir.
--
-- Aucune place ne bouge : les deux joueurs avaient deja la leur, avant comme
-- apres. C'est toute la raison pour laquelle une demande peut rester sans
-- reponse sans consequence.
--
-- Refus : feature_disabled, not_authenticated, request_not_found,
--         tournament_not_found, tournament_not_open, already_in_team,
--         partner_already_registered, waitlist_mismatch.
-- Appelable par : le DESTINATAIRE de la demande, personne d'autre.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_respond_join(p_request uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me     uuid := public.current_player_id();
  v_req    public.tournament_join_requests%ROWTYPE;
  v_status text;
  v_mine   public.tournament_registrations%ROWTYPE;
  v_from   public.tournament_registrations%ROWTYPE;
  v_team   uuid;
  v_closed int;
BEGIN
  ---------------------------------------------------------------------------
  -- CONTROLES -- avant toute ecriture.
  ---------------------------------------------------------------------------
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- Une demande qui ne m'est pas adressee, ou deja repondue, est traitee comme
  -- inexistante : meme refus, aucune information rendue sur son existence.
  --
  -- PREMIERE lecture SANS VERROU, uniquement pour connaitre le tournoi.
  -- L'ORDRE DES VERROUS EST TOUJOURS LE MEME DANS CE FICHIER : le tournoi
  -- d'abord, les lignes ensuite. Verrouiller la demande ici, puis attendre le
  -- tournoi, croiserait `tournament_join` -- qui tient le tournoi et va
  -- chercher les demandes -- et les deux se bloqueraient mutuellement.
  SELECT * INTO v_req FROM public.tournament_join_requests jr
   WHERE jr.id = p_request AND jr.to_player = v_me AND jr.status = 'pending';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'request_not_found');
  END IF;

  SELECT t.status INTO v_status
    FROM public.tournaments t WHERE t.id = v_req.tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  IF v_status NOT IN ('INSCRIPTIONS_OUVERTES','COMPLET','CHECK_IN','PRET') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_open');
  END IF;

  -- Le tournoi est a nous : on peut relire la demande SOUS VERROU. Si elle a
  -- ete repondue entre les deux lectures (l'autre moitie d'une demande
  -- croisee, un refus automatique), elle n'est plus 'pending' et le refus
  -- tombe ici, avant toute ecriture.
  SELECT * INTO v_req FROM public.tournament_join_requests jr
   WHERE jr.id = p_request AND jr.to_player = v_me AND jr.status = 'pending'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'request_not_found');
  END IF;

  ---------------------------------------------------------------------------
  -- REFUS : rien d'autre que la demande elle-meme ne change.
  ---------------------------------------------------------------------------
  IF p_accept IS NOT TRUE THEN
    UPDATE public.tournament_join_requests
       SET status = 'declined', responded_at = now()
     WHERE id = v_req.id;
    RETURN jsonb_build_object('ok', true, 'accepted', false);
  END IF;

  -- Les deux inscriptions existent forcement -- les cles etrangeres composites
  -- de la table des demandes l'imposent, et une desinscription emporte la
  -- demande. On les lit pour la file d'attente.
  SELECT * INTO v_mine FROM public.tournament_registrations r
   WHERE r.tournament_id = v_req.tournament_id AND r.player_id = v_me;
  SELECT * INTO v_from FROM public.tournament_registrations r
   WHERE r.tournament_id = v_req.tournament_id AND r.player_id = v_req.from_player;

  IF EXISTS (SELECT 1 FROM public.tournament_participants tp
              WHERE tp.tournament_id = v_req.tournament_id AND tp.player_id = v_me) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_in_team');
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_participants tp
              WHERE tp.tournament_id = v_req.tournament_id
                AND tp.player_id = v_req.from_player) THEN
    -- Le demandeur s'est apparie ailleurs entre-temps -- typiquement une
    -- demande croisee, qu'il a acceptee le premier.
    RETURN jsonb_build_object('ok', false, 'reason', 'partner_already_registered');
  END IF;
  IF (v_mine.waitlist_position IS NULL) <> (v_from.waitlist_position IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'waitlist_mismatch');
  END IF;

  ---------------------------------------------------------------------------
  -- ECRITURES.
  ---------------------------------------------------------------------------
  BEGIN
    INSERT INTO public.tournament_teams (tournament_id, player1_id, player2_id)
    VALUES (v_req.tournament_id, v_req.from_player, v_me)
    RETURNING id INTO v_team;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_in_team');
  END;

  -- Meme regle de file que dans `tournament_join` : le binome recule au rang
  -- de son membre le plus recule.
  PERFORM public.fn_tournament_align_waitlist(
            v_req.tournament_id, v_me, v_req.from_player);

  -- Refuse TOUT ce qui reste vivant autour des deux joueurs, la demande
  -- courante comprise...
  v_closed := public.fn_tournament_close_pending_requests(
                v_req.tournament_id, v_me, v_req.from_player);
  -- ... puis rend a la demande courante son vrai statut.
  UPDATE public.tournament_join_requests
     SET status = 'accepted', responded_at = now()
   WHERE id = v_req.id;

  PERFORM public.fn_tournament_promote_waitlist(v_req.tournament_id);

  RETURN jsonb_build_object('ok', true, 'accepted', true, 'team_id', v_team,
                            'requests_closed', greatest(v_closed - 1, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_respond_join(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_respond_join(uuid, boolean) TO authenticated;

-- ============================================================================
-- tournament_leave_team(p_tournament)
--
-- Defaire son binome. Les DEUX joueurs redeviennent seuls EN GARDANT chacun sa
-- place : personne n'est ejecte du tournoi parce que son partenaire s'est
-- ravise. Aucune place ne se libere, donc aucune file n'avance et le statut ne
-- bouge pas.
--
-- Supprimer la ligne de `tournament_teams` suffit : le declencheur de
-- tournaments.sql retire les deux lignes de `tournament_participants`. On n'y
-- touche jamais directement.
--
-- `open_to_join` n'est PAS remis a true : c'est un mode de consentement qui
-- appartient a son proprietaire. Un joueur qui s'etait declare « sur accord »
-- et qui defait son binome reste « sur accord » -- le remettre a ouvert
-- inverserait en silence, depuis une fonction appelee pour autre chose, le
-- seul choix qu'il avait exprime.
--
-- Refus : feature_disabled, not_authenticated, tournament_not_found,
--         tournament_not_open, matches_already_generated, not_registered,
--         not_in_team.
-- Appelable par : l'un OU l'autre des deux joueurs du binome.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_leave_team(p_tournament uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me     uuid := public.current_player_id();
  v_status text;
  v_team   uuid;
  v_mate   uuid;
BEGIN
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT t.status INTO v_status
    FROM public.tournaments t WHERE t.id = p_tournament FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  -- « Un binome se defait a tout moment AVANT LE LANCEMENT ». Apres, un binome
  -- ne change plus de joueur, sauf intervention de l'organisateur.
  IF v_status NOT IN ('INSCRIPTIONS_OUVERTES','COMPLET','CHECK_IN','PRET') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_open');
  END IF;

  -- Des que les matchs sont tires, la composition ne bouge plus. Le controle
  -- n'est pas theorique : les cles composites de `tournament_matches` vers
  -- `tournament_teams` ne sont PAS ON DELETE CASCADE, donc le DELETE plus bas
  -- leverait un `foreign_key_violation` NON CAPTURE -- une erreur SQL brute
  -- rendue au client, a la place du `{ok:false, reason}` que tout ce fichier
  -- promet. Le statut PRET est accepte par cette fonction, et rien n'interdit
  -- a la tache « deroulement » d'y generer le premier tour : le garde-fou
  -- appartient donc a ICI, pas a la tache qui creera la condition.
  IF EXISTS (SELECT 1 FROM public.tournament_matches m
              WHERE m.tournament_id = p_tournament) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'matches_already_generated');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tournament_registrations r
                  WHERE r.tournament_id = p_tournament AND r.player_id = v_me) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_registered');
  END IF;

  SELECT tp.team_id INTO v_team
    FROM public.tournament_participants tp
   WHERE tp.tournament_id = p_tournament AND tp.player_id = v_me;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_team');
  END IF;

  SELECT tp.player_id INTO v_mate
    FROM public.tournament_participants tp
   WHERE tp.tournament_id = p_tournament AND tp.team_id = v_team
     AND tp.player_id <> v_me;

  ---------------------------------------------------------------------------
  -- ECRITURES.
  ---------------------------------------------------------------------------
  -- Le DELETE est la SEULE ecriture : le declencheur retire les deux lignes de
  -- `tournament_participants`, et l'absence de ligne suffit a dire « ces deux
  -- joueurs cherchent un partenaire ». Ni les places ni les positions de file
  -- ne bougent (les deux gardent leur rang commun), et surtout pas
  -- `open_to_join`, qui n'appartient qu'a son proprietaire.
  DELETE FROM public.tournament_teams WHERE id = v_team;

  -- Ici l'appel n'est PAS decoratif : un binome en attente qui se defait
  -- devient deux candidats de taille 1, et un siege qui ne pouvait pas
  -- accueillir le binome peut accueillir l'un d'eux.
  PERFORM public.fn_tournament_promote_waitlist(p_tournament);

  RETURN jsonb_build_object('ok', true, 'team_id', v_team, 'partner_id', v_mate);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_leave_team(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_leave_team(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- Helper interne : LE CORPS DU RETRAIT -- partage par `tournament_withdraw`
-- (le joueur, pour lui-meme) et `tournament_remove_registration` (Task 12 :
-- l'organisateur, sur un tiers). Chacun verifie le sujet et le statut A SA
-- MANIERE -- `current_player_id()` contre `p_player` pour l'un,
-- `tournaments.created_by` pour l'autre -- puis delegue ICI la MEME suite :
-- defaire le binome eventuel, retirer l'inscription, avancer la file,
-- synchroniser la capacite. Un seul endroit qui sait ce que « partir » veut
-- dire, pas deux qui pourraient un jour diverger.
--
-- SUPPOSE DEJA VERIFIE PAR L'APPELANT : le tournoi existe et est VERROUILLE
-- (FOR UPDATE), son statut autorise le retrait, aucun match n'est tire
-- (`matches_already_generated`), et l'inscription du joueur vise EXISTE
-- (`not_registered`). Ce helper n'est pas accorde et ne refait donc aucun de
-- ces controles : il n'est atteignable que par les deux RPC ci-dessous, qui
-- les font toutes AVANT de l'appeler.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_tournament_withdraw_player(
  p_tournament uuid, p_player uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_was_wl   boolean;
  v_team     uuid;
  v_mate     uuid;
  v_promoted int := 0;
BEGIN
  SELECT r.waitlist_position IS NOT NULL INTO v_was_wl
    FROM public.tournament_registrations r
   WHERE r.tournament_id = p_tournament AND r.player_id = p_player;

  SELECT tp.team_id INTO v_team
    FROM public.tournament_participants tp
   WHERE tp.tournament_id = p_tournament AND tp.player_id = p_player;
  IF FOUND THEN
    SELECT tp.player_id INTO v_mate
      FROM public.tournament_participants tp
     WHERE tp.tournament_id = p_tournament AND tp.team_id = v_team
       AND tp.player_id <> p_player;
  END IF;

  ---------------------------------------------------------------------------
  -- ECRITURES.
  ---------------------------------------------------------------------------
  -- Le binome se defait, et c'est tout : le partenaire garde sa place, son
  -- rang de file s'il en avait un, et son mode de consentement.
  IF v_team IS NOT NULL THEN
    DELETE FROM public.tournament_teams WHERE id = v_team;
  END IF;

  DELETE FROM public.tournament_registrations
   WHERE tournament_id = p_tournament AND player_id = p_player;

  -- Une seule regle, sans exception a retenir : apres toute mutation
  -- d'inscription, la file tourne. Partir depuis la file ne libere aucun
  -- siege, la promotion ne fera alors rien -- et elle synchronise le statut
  -- dans tous les cas.
  v_promoted := public.fn_tournament_promote_waitlist(p_tournament);

  RETURN jsonb_build_object('ok', true,
                            'was_waitlisted', coalesce(v_was_wl, false),
                            'partner_id', v_mate, 'promoted', v_promoted);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_tournament_withdraw_player(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- tournament_withdraw(p_tournament)
--
-- Quitter le tournoi AVANT le lancement. Ma place se libere et la file avance.
-- Si j'avais un binome, il se defait d'abord : mon partenaire reste inscrit,
-- SEUL, AVEC SA PLACE -- il n'est pas puni de mon changement d'avis.
--
-- Supprimer l'inscription emporte mes demandes en cours (ON DELETE CASCADE des
-- cles composites de tournament_join_requests) : aucune ligne morte.
--
-- ⚠️ Ce n'est PAS le forfait en cours de tournoi, qui marque
-- `tournament_teams.withdrawn` et solde les matchs restants -- celui-la
-- s'appelle `tournament_forfeit(p_team)`, plus bas dans la section
-- « deroulement d'une rotation ». Et ce n'est pas non plus le retrait par
-- l'ORGANISATEUR, sur un tiers -- `tournament_remove_registration`,
-- juste apres -- meme suite (`fn_tournament_withdraw_player` ci-dessus),
-- sujet et garde d'autorite differents.
--
-- `open_to_join` du partenaire laisse n'est PAS touche, pour la meme raison
-- que dans `tournament_leave_team` : c'est son consentement, pas le mien.
--
-- Refus : feature_disabled, not_authenticated, tournament_not_found,
--         tournament_not_open, matches_already_generated, not_registered.
-- Appelable par : tout joueur connecte, pour lui-meme.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_withdraw(p_tournament uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me     uuid := public.current_player_id();
  v_status text;
BEGIN
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT t.status INTO v_status
    FROM public.tournaments t WHERE t.id = p_tournament FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  IF v_status NOT IN ('INSCRIPTIONS_OUVERTES','COMPLET','CHECK_IN','PRET') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_open');
  END IF;

  -- Meme garde-fou que dans `tournament_leave_team`, et pour la meme raison :
  -- `tournament_matches` reference `tournament_teams` SANS ON DELETE CASCADE.
  -- Une fois les matchs tires, partir n'est plus une desinscription mais un
  -- forfait, qui appartient a `tournament_forfeit`.
  IF EXISTS (SELECT 1 FROM public.tournament_matches m
              WHERE m.tournament_id = p_tournament) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'matches_already_generated');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tournament_registrations r
                  WHERE r.tournament_id = p_tournament AND r.player_id = v_me) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_registered');
  END IF;

  ---------------------------------------------------------------------------
  -- ECRITURES -- deleguees a `fn_tournament_withdraw_player`, partagee avec
  -- `tournament_remove_registration` : meme suite exacte.
  ---------------------------------------------------------------------------
  RETURN public.fn_tournament_withdraw_player(p_tournament, v_me);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_withdraw(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_withdraw(uuid) TO authenticated;

-- ============================================================================
-- tournament_remove_registration(p_tournament, p_player)
--
-- L'ORGANISATEUR RETIRE UNE INSCRIPTION. Le recours qui manquait au troisieme
-- defaut grave trouve en relecture de branche : `tournament_register(...,
-- p_partner)` permet a N'IMPORTE QUEL inscrit d'ajouter un tiers arbitraire
-- (voir son en-tete), et jusqu'ici SEUL ce tiers pouvait se retirer lui-meme
-- (`tournament_withdraw`) -- un attaquant pouvait inscrire une victime, se
-- desinscrire LUI (sa propre ligne, jamais celle de la victime), et
-- recommencer : il sature les sieges sans que l'organisateur ait la moindre
-- prise. `tournament_mark_no_show` ne libere pas non plus le siege -- il ne
-- fait que consigner une absence.
--
-- ⚠️ TRANCHE ASSUMEE : inscrire quelqu'un reste possible, et la boucle
-- decrite ci-dessus reste possible techniquement -- l'interdire casserait
-- l'inscription a deux, une fonctionnalite voulue. Ce que cette fonction
-- ajoute, c'est le RECOURS : l'organisateur peut desormais nettoyer, ce qui
-- rend la boucle REVERSIBLE au lieu d'irreversible. Un risque residuel assume
-- pour une fonctionnalite eteinte par defaut.
--
-- MEME SUITE QUE `tournament_withdraw`, PAR LE MEME HELPER
-- (`fn_tournament_withdraw_player`, juste au-dessus) -- binome eventuel
-- defait, inscription retiree, file avancee, capacite synchronisee -- pour
-- que cette regle ne soit jamais ecrite qu'a un seul endroit. Seuls le SUJET
-- (un parametre, pas `current_player_id()`) et le garde d'autorite
-- (l'organisateur, pas le joueur lui-meme) different.
--
-- MEME GARDE-FOU que `tournament_withdraw` sur les matchs deja tires
-- (`matches_already_generated`) : une fois le tableau publie,
-- `tournament_matches` reference le binome SANS ON DELETE CASCADE, et
-- retirer l'inscription casserait la reference. Passe ce point, le recours de
-- l'organisateur est `tournament_forfeit`, qui SOLDE plutot que de RETIRER.
--
-- Refus : feature_disabled, not_authenticated, tournament_not_found,
--         not_the_organizer, tournament_not_open, matches_already_generated,
--         not_registered.
-- Appelable par : l'ORGANISATEUR (tournaments.created_by) seul.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_remove_registration(
  p_tournament uuid, p_player uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := public.current_player_id();
  v_t  public.tournaments%ROWTYPE;
BEGIN
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  IF v_t.created_by <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_the_organizer');
  END IF;
  IF v_t.status NOT IN ('INSCRIPTIONS_OUVERTES','COMPLET','CHECK_IN','PRET') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_open');
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_matches m
              WHERE m.tournament_id = p_tournament) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'matches_already_generated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tournament_registrations r
                  WHERE r.tournament_id = p_tournament AND r.player_id = p_player) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_registered');
  END IF;

  ---------------------------------------------------------------------------
  -- ECRITURES -- deleguees a `fn_tournament_withdraw_player`, partagee avec
  -- `tournament_withdraw` : meme suite exacte.
  ---------------------------------------------------------------------------
  RETURN public.fn_tournament_withdraw_player(p_tournament, p_player);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_remove_registration(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_remove_registration(uuid, uuid) TO authenticated;

-- ============================================================================
-- tournament_check_in(p_tournament)
--
-- Confirmer sa presence le jour J. Les trois jetons sont ceux du schema, mot
-- pour mot : 'pending' (par defaut), 'checked_in', 'no_show'.
--
-- Un joueur marque 'no_show' qui arrive en retard peut se pointer : le
-- check-in n'est pas une sanction, il dit qui est la MAINTENANT. Marquer un
-- absent 'no_show' est un geste d'ORGANISATEUR, qui n'appartient pas a cette
-- fonction -- le brief ne lui donne qu'un parametre, le tournoi.
--
-- Refus : feature_disabled, not_authenticated, tournament_not_found,
--         tournament_not_open, not_registered.
-- Appelable par : tout joueur connecte, pour lui-meme.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_check_in(p_tournament uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me     uuid := public.current_player_id();
  v_status text;
  v_reg    public.tournament_registrations%ROWTYPE;
  v_rows   int;
BEGIN
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- Pas de FOR UPDATE : ce chemin ne touche a aucune place, seulement a ma
  -- propre ligne d'inscription.
  SELECT t.status INTO v_status
    FROM public.tournaments t WHERE t.id = p_tournament;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  -- Le check-in a sa fenetre : ni avant qu'elle ne s'ouvre, ni apres le coup
  -- d'envoi.
  IF v_status NOT IN ('CHECK_IN','PRET') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_open');
  END IF;

  SELECT * INTO v_reg FROM public.tournament_registrations r
   WHERE r.tournament_id = p_tournament AND r.player_id = v_me;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_registered');
  END IF;
  -- En liste d'attente, on ne se pointe pas : il n'y a pas de place a
  -- confirmer.
  IF v_reg.waitlist_position IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_registered');
  END IF;

  UPDATE public.tournament_registrations
     SET check_in_status = 'checked_in'
   WHERE tournament_id = p_tournament AND player_id = v_me;

  -- Un `{ok:true}` rendu pour un UPDATE a zero ligne serait un mensonge : la
  -- ligne a pu disparaitre entre la lecture et l'ecriture (desinscription
  -- concurrente), et l'ecran afficherait « present » pour personne.
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_registered');
  END IF;

  RETURN jsonb_build_object('ok', true, 'check_in_status', 'checked_in');
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_check_in(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_check_in(uuid) TO authenticated;

-- ============================================================================
-- tournament_open_check_in(p_tournament)
--
-- L'ORGANISATEUR ouvre le pointage : `INSCRIPTIONS_OUVERTES` ou `COMPLET` ->
-- `CHECK_IN`. Sans cette fonction, aucun `UPDATE ... SET status = 'CHECK_IN'`
-- n'existait dans tout ce fichier -- le pointage etait en lecture seule alors
-- que `check_in_status` prevoit deja `pending | checked_in | no_show`.
--
-- FACULTATIF, pas obligatoire : `tournament_start` accepte encore de lancer
-- directement depuis `INSCRIPTIONS_OUVERTES` ou `COMPLET` (« lancer quand
-- meme », documente sur cette fonction) -- ouvrir le pointage n'est donc pas
-- une etape que ce chantier rend incontournable, seulement possible. `PRET`
-- n'a symetriquement aucune transition qui y mene : la machine a etats de
-- `tournaments.sql` l'accepte partout ou `CHECK_IN` l'est, mais rien dans le
-- brief de cette tache n'exige un geste distinct pour l'atteindre, et en
-- inventer un serait une transition que la spec ne demande pas.
--
-- Refus : feature_disabled, not_authenticated, tournament_not_found,
--         not_the_organizer, tournament_not_open.
-- Appelable par : l'ORGANISATEUR (tournaments.created_by) seul.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_open_check_in(p_tournament uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me   uuid := public.current_player_id();
  v_t    public.tournaments%ROWTYPE;
  v_rows int;
BEGIN
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  IF v_t.created_by <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_the_organizer');
  END IF;
  IF v_t.status NOT IN ('INSCRIPTIONS_OUVERTES','COMPLET') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_open');
  END IF;

  UPDATE public.tournaments SET status = 'CHECK_IN' WHERE id = p_tournament;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    -- La ligne est verrouillee et a ete lue juste au-dessus : zero ligne est
    -- un etat impossible, pas un refus metier. On LEVE, ce qui annule tout.
    RAISE EXCEPTION 'tournament_open_check_in: le tournoi % a disparu sous le verrou',
      p_tournament;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', 'CHECK_IN');
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_open_check_in(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_open_check_in(uuid) TO authenticated;

-- ============================================================================
-- tournament_reopen_registrations(p_tournament)
--
-- L'ORGANISATEUR ROUVRE LES INSCRIPTIONS : CHECK_IN / PRET -> retour au
-- statut de capacite reel (INSCRIPTIONS_OUVERTES ou COMPLET, selon qu'il reste
-- une place). C'est le remede au premier defaut grave trouve en relecture de
-- branche : `tournament_open_check_in` est une porte a SENS UNIQUE tant que
-- cette fonction n'existe pas -- un organisateur qui l'ouvre trop tot (3
-- inscrits solos sur 4 terrains, par exemple) ne peut plus jamais revenir
-- inscrire le binome manquant. Le tournoi restait alors en CHECK_IN POUR
-- TOUJOURS : les inscriptions fermees, `tournament_autopair` incapable de
-- former un quatrieme binome sans un quatrieme joueur, `tournament_start`
-- refusant `not_enough_teams`.
--
-- LE CHOIX EST LA REVERSIBILITE, PAS UNE GARDE SUPPLEMENTAIRE : interdire
-- d'ouvrir le pointage tant que les places ne sont pas toutes prises punirait
-- un geste tout a fait legitime (un organisateur qui veut voir qui est deja
-- la). Ce qui manquait n'etait pas une garde a l'entree, c'etait une porte de
-- sortie.
--
-- ⚠️ ELLE NE DUPLIQUE PAS LA REGLE DE STATUT, ET N'ECRIT JAMAIS `status`
-- ELLE-MEME. `fn_tournament_sync_capacity_status` reste le SEUL ecrivain du
-- statut de capacite -- cette RPC se contente de l'appeler avec
-- `p_allow_reopen => true`, le seul appel de tout ce fichier a le faire. Tous
-- les autres appelants (`tournament_register`, `tournament_join`,
-- `fn_tournament_promote_waitlist`, etc.) continuent d'appeler SANS ce
-- parametre : leur comportement ne change pas d'un bit, et un retrait pendant
-- le pointage ne rouvre toujours rien tout seul -- seul CE geste explicite de
-- l'organisateur le fait.
--
-- CE QU'ELLE NE FAIT PAS : elle ne touche a AUCUNE inscription, AUCUN binome,
-- AUCUN jeton de check-in. `check_in_status` de chacun reste ce qu'il etait --
-- rouvrir les inscriptions n'efface pas qui s'etait deja pointe present ou
-- absent. Si le tournoi redevient COMPLET (aucune place libre), rien n'empeche
-- l'organisateur de rouvrir le pointage a nouveau via `tournament_open_check_in`.
--
-- Refus : feature_disabled, not_authenticated, tournament_not_found,
--         not_the_organizer, tournament_not_in_check_in.
-- Appelable par : l'ORGANISATEUR (tournaments.created_by) seul.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_reopen_registrations(p_tournament uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me     uuid := public.current_player_id();
  v_t      public.tournaments%ROWTYPE;
  v_status text;
BEGIN
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  IF v_t.created_by <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_the_organizer');
  END IF;
  IF v_t.status NOT IN ('CHECK_IN','PRET') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_in_check_in');
  END IF;

  PERFORM public.fn_tournament_sync_capacity_status(p_tournament, true);

  SELECT status INTO v_status FROM public.tournaments WHERE id = p_tournament;
  RETURN jsonb_build_object('ok', true, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_reopen_registrations(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_reopen_registrations(uuid) TO authenticated;

-- ============================================================================
-- tournament_mark_no_show(p_tournament, p_player)
--
-- L'ORGANISATEUR marque un joueur ABSENT : « qui est la, qui manque » (cahier
-- du pointage). C'est le pendant organisateur de `tournament_check_in`, sur
-- la MEME fenetre de statut -- le pointage n'a de sens qu'entre son ouverture
-- et le coup d'envoi.
--
-- `p_player` est un PARAMETRE ici, volontairement, contrairement au reste du
-- fichier : ce n'est PAS un geste que le sujet fait sur lui-meme (comme
-- `tournament_check_in`), c'est un geste que l'organisateur fait sur UN
-- AUTRE -- exactement comme `tournament_forfeit(p_tournament, p_team)` plus
-- bas ne peut pas non plus avoir pour sujet `current_player_id()`.
--
-- Pas de FOR UPDATE sur `tournaments` : ce chemin ne touche a aucun siege,
-- aucune position de file, aucun binome -- seulement une colonne de la ligne
-- d'inscription du joueur vise, meme raisonnement que `tournament_check_in`
-- et `tournament_set_open_to_join`.
--
-- ECRASE UN `checked_in` SANS CONDITION -- ce n'est PAS un oubli : c'est le
-- meme geste que `tournament_check_in`, qui ecrit `checked_in` sans regarder
-- l'etat de depart non plus (le check-in n'est pas une sanction ni une
-- progression, il dit qui est la MAINTENANT). Un `checked_in` marque `no_show`
-- par erreur se renverse par le MEME chemin qui l'a marque present :
-- `tournament_check_in`, appele par le joueur lui-meme, qui n'exige pas non
-- plus un `check_in_status` de depart particulier -- seulement une PLACE.
--
-- ⚠️ `waitlist_position IS NULL` EXIGE (Task 12) : un joueur EN FILE n'a pas
-- de siege a ne pas occuper, donc rien a marquer absent. Sans cette exigence,
-- la relecture de branche a trouve un joueur en file marque `no_show` A VIE --
-- `tournament_check_in` (le seul chemin qui renverse un `no_show`) refuse tout
-- joueur en liste d'attente, quel que soit son `check_in_status`, donc rien ne
-- pouvait plus jamais le faire redevenir `pending`.
--
-- Refus : feature_disabled, not_authenticated, tournament_not_found,
--         not_the_organizer, tournament_not_open, not_registered.
-- Appelable par : l'ORGANISATEUR (tournaments.created_by) seul.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_mark_no_show(p_tournament uuid, p_player uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me      uuid := public.current_player_id();
  v_status  text;
  v_creator uuid;
  v_rows    int;
BEGIN
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT t.status, t.created_by INTO v_status, v_creator
    FROM public.tournaments t WHERE t.id = p_tournament;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  IF v_me <> v_creator THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_the_organizer');
  END IF;
  IF v_status NOT IN ('CHECK_IN','PRET') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_open');
  END IF;

  -- `AND waitlist_position IS NULL` : un joueur en file ne compte pas comme
  -- "registered" pour ce geste, exactement la convention deja posee par
  -- `tournament_check_in` pour la meme raison (pas de siege, rien a pointer).
  UPDATE public.tournament_registrations
     SET check_in_status = 'no_show'
   WHERE tournament_id = p_tournament AND player_id = p_player
     AND waitlist_position IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_registered');
  END IF;

  RETURN jsonb_build_object('ok', true, 'player_id', p_player, 'check_in_status', 'no_show');
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_mark_no_show(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_mark_no_show(uuid, uuid) TO authenticated;

-- ============================================================================
-- tournament_set_open_to_join(p_tournament, p_open)
--
-- Changer SON mode de consentement : « on peut me prendre d'un geste » (true)
-- ou « il me faut mon accord » (false).
--
-- Sans cette fonction, la regle « seul le joueur change `open_to_join` » n'etait
-- tenue qu'au negatif : plus rien ne l'ecrasait, mais son proprietaire n'avait
-- aucun moyen d'y toucher apres l'inscription. Un partenaire invite (inscrit
-- ferme, cf. `tournament_register`) serait reste ferme a vie.
--
-- AUCUN parametre `p_player` -- volontairement. Le sujet est toujours
-- `auth.uid()`, et il n'existe donc aucun chemin par lequel quelqu'un change
-- le consentement d'un autre. C'est la meme raison qui fait que ce fichier n'a
-- pas de `tournament_register_someone_else`.
--
-- `already_in_team` quand le joueur a deja un partenaire : le mode ne decrit
-- que la facon dont on peut ME PRENDRE comme partenaire, et il n'y a rien a
-- decrire quand je n'en cherche plus. Refuser plutot qu'ecrire sans effet
-- evite qu'un ecran affiche un interrupteur qui ne change rien de visible.
--
-- Refus : feature_disabled, not_authenticated, tournament_not_found,
--         tournament_not_open, already_in_team, not_registered.
-- Appelable par : tout joueur connecte, POUR LUI-MEME uniquement.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_set_open_to_join(
  p_tournament uuid, p_open boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me     uuid := public.current_player_id();
  v_status text;
  v_rows   int;
BEGIN
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- Pas de FOR UPDATE : ce chemin ne touche aucun siege, aucune position de
  -- file, aucun binome -- seulement une colonne de ma propre ligne.
  SELECT t.status INTO v_status
    FROM public.tournaments t WHERE t.id = p_tournament;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  -- Le mode ne sert qu'a se faire trouver un partenaire : passe le lancement,
  -- il ne veut plus rien dire.
  IF v_status NOT IN ('INSCRIPTIONS_OUVERTES','COMPLET','CHECK_IN','PRET') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_open');
  END IF;

  IF EXISTS (SELECT 1 FROM public.tournament_participants tp
              WHERE tp.tournament_id = p_tournament AND tp.player_id = v_me) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_in_team');
  END IF;

  -- L'unique ecriture, et elle n'ecrit rien si la ligne n'existe pas : un
  -- UPDATE a zero ligne ne laisse aucune trace derriere lui, la discipline
  -- « tout controle precede toute ecriture » reste entiere.
  -- `coalesce(p_open, false)` : un appelant qui n'envoie rien n'a rien demande,
  -- et la direction sure d'un consentement est FERMEE -- la meme que pour le
  -- partenaire invite dans `tournament_register`. Ouvrir sur une absence de
  -- valeur serait consentir a la place de quelqu'un.
  UPDATE public.tournament_registrations
     SET open_to_join = coalesce(p_open, false)
   WHERE tournament_id = p_tournament AND player_id = v_me;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_registered');
  END IF;

  RETURN jsonb_build_object('ok', true, 'open_to_join', coalesce(p_open, false));
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_set_open_to_join(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_set_open_to_join(uuid, boolean) TO authenticated;

-- ============================================================================
-- tournament_set_side(p_tournament, p_side)
--
-- Changer SON cote. Le pendant manquant de `tournament_set_open_to_join`, et
-- exige par la MEME regle de consentement : le cote appartient au joueur. Un
-- partenaire invite par `tournament_register(..., p_partner)` recoit un cote
-- 'both' qu'il n'a pas declare (cf. l'en-tete de `tournament_register`), et
-- n'avait jusqu'ici AUCUN recours dans l'app -- ni RPC, ni policy `UPDATE` sur
-- `tournament_registrations`.
--
-- AUCUN parametre `p_player` -- meme raison que `tournament_set_open_to_join` :
-- le sujet est toujours `auth.uid()`, et il n'existe donc aucun chemin par
-- lequel quelqu'un declare le cote d'un autre.
--
-- A LA DIFFERENCE de `open_to_join`, le cote reste SIGNIFIANT une fois en
-- binome -- c'est un cote de TERRAIN (gauche/droit), pas un mode de recherche
-- de partenaire, donc `already_in_team` ne s'applique pas ici : changer de
-- cote au sein d'un binome deja forme reste un geste qui veut dire quelque
-- chose. Ce qui borne le changement, c'est le TIRAGE : une fois les matchs
-- generes, meme garde-fou nomme que `tournament_leave_team` et
-- `tournament_withdraw` (`matches_already_generated`, teste directement sur
-- `tournament_matches` plutot que sur le statut -- le placement initial de
-- `tournament_start` s'appuie deja sur le cote implicitement via le niveau du
-- binome, pas sur `side`, donc rien n'exige de figer plus tot).
--
-- ⚠️ SIGNATURE GELEE (Task 12) : `tournament_set_side(uuid, text)` est
-- branchee cote client independamment de ce fichier -- le corps peut changer,
-- pas les parametres.
--
-- GARDE DE STATUT AJOUTEE (Task 12), alignee sur son jumeau
-- `tournament_set_open_to_join` qui l'a toujours eue : sans elle, un joueur
-- pouvait changer de cote y compris TERMINE ou CLASSEMENT_VALIDE, tant
-- qu'aucun match n'avait ete tire -- notamment le trou trace en relecture de
-- branche, un EN_COURS a `current_round = 0` (des forfaits en cascade avant
-- la premiere rotation) ou `tournament_matches` reste vide. `tournament_not_open`,
-- meme raison que le jumeau, pour la meme fenetre de statuts.
--
-- Refus : feature_disabled, not_authenticated, invalid_side,
--         tournament_not_found, tournament_not_open,
--         matches_already_generated, not_registered.
-- Appelable par : tout joueur connecte, POUR LUI-MEME uniquement.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_set_side(p_tournament uuid, p_side text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me     uuid := public.current_player_id();
  v_status text;
  v_rows   int;
BEGIN
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;
  IF p_side IS NULL OR p_side NOT IN ('left','right','both') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_side');
  END IF;

  -- Pas de FOR UPDATE : ce chemin ne touche aucun siege, aucune position de
  -- file, aucun binome -- seulement une colonne de ma propre ligne.
  SELECT t.status INTO v_status FROM public.tournaments t WHERE t.id = p_tournament;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  -- Meme fenetre que `tournament_set_open_to_join` : le cote ne sert qu'a se
  -- faire trouver ou placer un partenaire, il ne veut plus rien dire une fois
  -- le tournoi clos, valide ou annule.
  IF v_status NOT IN ('INSCRIPTIONS_OUVERTES','COMPLET','CHECK_IN','PRET') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_open');
  END IF;

  -- Meme garde-fou que `tournament_leave_team` / `tournament_withdraw`, et
  -- pour la meme raison de fond : une fois les matchs tires, le tableau est
  -- publie sur la base des cotes declares a cet instant-la -- le changer
  -- romprait la coherence de ce qui a deja ete montre.
  IF EXISTS (SELECT 1 FROM public.tournament_matches m
              WHERE m.tournament_id = p_tournament) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'matches_already_generated');
  END IF;

  UPDATE public.tournament_registrations
     SET side = p_side
   WHERE tournament_id = p_tournament AND player_id = v_me;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_registered');
  END IF;

  RETURN jsonb_build_object('ok', true, 'side', p_side);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_set_side(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_set_side(uuid, text) TO authenticated;

-- ============================================================================
-- tournament_autopair(p_tournament)
--
-- Apparier, au lancement, les joueurs restes seuls : NIVEAUX PROCHES et COTES
-- COMPLEMENTAIRES. Les deux notes sont les fonctions deja ecrites en
-- TypeScript, portees telles quelles (fn_tournament_side_score,
-- fn_tournament_elo_score) : on ne reecrit pas une seconde regle de cote qui
-- divergerait de `scoreSide()`.
--
-- Glouton : a chaque tour de boucle, LE meilleur couple encore possible est
-- forme, puis la boucle recommence sur ce qui reste. Ce n'est pas l'optimum
-- global d'un couplage maximal -- c'est deterministe, lisible, et sur huit
-- joueurs au plus, l'ecart avec l'optimum est sans consequence sportive.
-- Departages, dans l'ordre : la note totale, puis l'ecart d'ELO brut, puis
-- l'anciennete d'inscription, puis les identifiants -- deux executions sur les
-- memes donnees rendent le meme resultat.
--
-- ⚠️ `check_in_status` N'EST PLUS LU ICI (Task 12) -- LA REGLE UNIQUE DE «
-- QUI EST PRESENT ». La relecture de branche a trouve trois lecteurs de
-- presence qui ne repondaient pas la meme chose : `fn_tournament_open_seats`
-- compte le siege d'un `no_show` comme occupe, cette fonction l'ECARTAIT de
-- l'appariement, et `tournament_start` / `fn_tournament_seated_teams` ne
-- regardaient `check_in_status` NULLE PART -- un binome dont un joueur est
-- `no_show` jouait quand meme des qu'il en avait un.
--
-- LA REGLE RETENUE, ET POURQUOI : `check_in_status` est PUREMENT INFORMATIF --
-- il dit qui s'est deja pointe, jamais qui a le droit de jouer ou d'etre
-- assis. C'est deja ce que documente `tournament_check_in` (« le check-in
-- n'est pas une sanction, il dit qui est la MAINTENANT ») et deja ce que
-- font DEUX DES TROIS lecteurs -- `fn_tournament_open_seats` (le siege reste
-- pris, l'absent peut encore arriver) et `tournament_start` /
-- `fn_tournament_seated_teams` (le binome joue, exactement comme un binome
-- dont personne ne s'est jamais pointe). La seule fonction qui derogeait a
-- cette regle etait CELLE-CI. La retirer de l'exclusion, plutot que
-- d'inventer une exclusion symetrique dans les deux autres, evite de toucher
-- `fn_tournament_seated_teams` -- le lecteur central de l'echelle, du
-- classement et de la cloture, dont l'invariant en tete de fichier NE PORTE
-- QUE sur `waitlist_position`, jamais sur `check_in_status`. Le seul cout
-- assume : un joueur marque absent PEUT desormais recevoir un partenaire par
-- appariement automatique, comme n'importe quel autre joueur assis --
-- coherent, puisque son siege est deja compte comme pris et que son binome
-- jouera de toute facon s'il en forme un.
--
-- LE VRAI RETRAIT D'UN ABSENT reste une decision d'organisateur EXPLICITE,
-- prise APRES coup : `tournament_forfeit` (en cours de tournoi) ou
-- `tournament_remove_registration` (avant le tirage), jamais un effet de bord
-- de l'appariement.
--
-- NOMBRE IMPAIR : le joueur qui reste sans partenaire ne joue pas et retourne
-- EN TETE de la liste d'attente (positions existantes decalees). Sa place se
-- libere, mais on N'AVANCE PAS la file : promouvoir maintenant ferait entrer
-- un joueur qui n'aurait plus personne a qui s'apparier. Un nombre impair de
-- BINOMES, lui, ne pose aucun probleme -- le bye tournant s'en charge.
--
-- Les joueurs EN LISTE D'ATTENTE ne sont pas apparies : ils n'ont pas de
-- place, et un binome sans place est precisement le piege signale en tete de
-- fichier.
--
-- `open_to_join` n'est PAS lu ici, et ce n'est pas un oubli : ce mode dit
-- « peut-on me prendre d'un geste, ou faut-il mon accord », et l'accord a deja
-- ete donne -- en s'inscrivant a un tournoi dont l'appariement automatique au
-- coup d'envoi est la regle. Le respecter ici laisserait sur le carreau, sans
-- partenaire et sans tournoi, exactement les joueurs les plus prudents.
--
-- Refus : feature_disabled, not_authenticated, tournament_not_found,
--         not_the_organizer, tournament_not_open, matches_already_generated,
--         already_in_team.
-- Appelable par : l'ORGANISATEUR (tournaments.created_by) seul.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_autopair(p_tournament uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me      uuid := public.current_player_id();
  v_status  text;
  v_creator uuid;
  v_a       uuid;
  v_b       uuid;
  v_teams   int := 0;
  v_alone   uuid[] := ARRAY[]::uuid[];
  v_shift   int;
BEGIN
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT t.status, t.created_by INTO v_status, v_creator
    FROM public.tournaments t WHERE t.id = p_tournament FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  IF v_me <> v_creator THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_the_organizer');
  END IF;
  -- INSCRIPTIONS_OUVERTES ACCEPTE (Task 12), ALIGNE SUR `tournament_start` --
  -- qui l'accepte deja, explicitement, pour le tournoi qui ne se remplit
  -- jamais (« demarrer a sept binomes »). L'exclure ici forcait l'organisateur
  -- d'un tel tournoi a franchir `tournament_open_check_in` -- alors une porte
  -- a sens unique (defaut n°1 de la relecture de branche) -- SEULEMENT pour
  -- pouvoir apparier ses solos avant de demarrer. Les deux gardes ensemble
  -- transformaient un geste legitime en piege ; ils disent maintenant la meme
  -- chose.
  IF v_status NOT IN ('INSCRIPTIONS_OUVERTES','COMPLET','CHECK_IN','PRET') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_open');
  END IF;
  -- Les matchs tires figent la composition : apparier apres coup creerait des
  -- binomes que le premier tour ignore.
  IF EXISTS (SELECT 1 FROM public.tournament_matches m
              WHERE m.tournament_id = p_tournament) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'matches_already_generated');
  END IF;

  ---------------------------------------------------------------------------
  -- ECRITURES -- toutes dans le meme sous-bloc : si un appariement echoue,
  -- AUCUN n'est conserve. Un appariement automatique a moitie fait, dont
  -- l'organisateur devrait deviner ce qui a ete decide, serait pire qu'un
  -- refus net.
  ---------------------------------------------------------------------------
  BEGIN
    LOOP
      WITH solo AS (
        SELECT r.player_id, r.side, r.registered_at,
               coalesce(p.elo_score, 1000)::numeric AS elo
          FROM public.tournament_registrations r
          JOIN public.players p ON p.id = r.player_id
         WHERE r.tournament_id      = p_tournament
           AND r.waitlist_position IS NULL
           AND NOT EXISTS (SELECT 1 FROM public.tournament_participants tp
                            WHERE tp.tournament_id = p_tournament
                              AND tp.player_id     = r.player_id)
      )
      SELECT a.player_id, b.player_id INTO v_a, v_b
        FROM solo a
        JOIN solo b ON b.player_id > a.player_id
       ORDER BY (public.fn_tournament_elo_score(a.elo, b.elo)
               + public.fn_tournament_side_score(a.side, b.side)) DESC,
                abs(a.elo - b.elo) ASC,
                greatest(a.registered_at, b.registered_at) ASC,
                a.player_id, b.player_id
       LIMIT 1;
      EXIT WHEN NOT FOUND;

      INSERT INTO public.tournament_teams (tournament_id, player1_id, player2_id)
      VALUES (p_tournament, v_a, v_b);

      PERFORM public.fn_tournament_close_pending_requests(p_tournament, v_a, v_b);
      v_teams := v_teams + 1;
    END LOOP;

    -- Ce qui reste : au plus un joueur (chaque tour de boucle en retire deux),
    -- mais on traite le cas general sans y compter.
    SELECT coalesce(array_agg(r.player_id ORDER BY r.registered_at, r.player_id),
                    ARRAY[]::uuid[])
      INTO v_alone
      FROM public.tournament_registrations r
     WHERE r.tournament_id      = p_tournament
       AND r.waitlist_position IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.tournament_participants tp
                        WHERE tp.tournament_id = p_tournament
                          AND tp.player_id     = r.player_id);

    v_shift := coalesce(array_length(v_alone, 1), 0);
    IF v_shift > 0 THEN
      -- On decale la file existante pour leur laisser la TETE, puis on les y
      -- range dans l'ordre de leur inscription.
      UPDATE public.tournament_registrations
         SET waitlist_position = waitlist_position + v_shift
       WHERE tournament_id = p_tournament
         AND waitlist_position IS NOT NULL;

      UPDATE public.tournament_registrations r
         SET waitlist_position = pos.i
        FROM (SELECT p AS player_id, i
                FROM unnest(v_alone) WITH ORDINALITY AS u(p, i)) pos
       WHERE r.tournament_id = p_tournament
         AND r.player_id     = pos.player_id;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_in_team');
  END;

  -- Volontairement PAS de fn_tournament_promote_waitlist ici : la place
  -- liberee par un joueur impair ne doit pas faire entrer quelqu'un qui
  -- n'aurait personne pour l'accompagner.
  PERFORM public.fn_tournament_sync_capacity_status(p_tournament);

  RETURN jsonb_build_object('ok', true, 'teams_created', v_teams,
                            'left_alone', to_jsonb(v_alone));
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_autopair(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_autopair(uuid) TO authenticated;

-- ############################################################################
-- SECTION DEROULEMENT D'UNE ROTATION (Task 4)
--
-- Ce que ces fonctions reproduisent, sans jamais deriver de `lib/tournament.ts` :
--   * `initialCourts` -- le placement initial, dans `tournament_start` ;
--   * `nextCourts`    -- le sens du mouvement, dans `fn_tournament_ladder` ;
--   * `pairUp`        -- l'appariement et le bye du palier impair, dans
--                        `tournament_generate_round`.
-- Le tableau de parite du rapport de tache tient la ligne a ligne.
--
-- LES REGLES DE SAISIE, telles que le brief les pose :
--   * n'importe lequel des QUATRE joueurs saisit, une ligne par saisie
--     (`tournament_match_entries`, une ligne par joueur, corrigeable) ;
--   * le score est ACQUIS des que deux joueurs de binomes OPPOSES saisissent
--     le meme score -- c'est la concordance qui vaut accord, il n'y a plus
--     d'etape de confirmation a declencher ;
--   * deux COEQUIPIERS d'accord ne valident RIEN ;
--   * deux joueurs OPPOSES qui divergent ouvrent un LITIGE, et
--     `tournament_resolve_dispute` le tranche -- l'organisateur seul ;
--   * un score a EGALITE est refuse (`draw_not_allowed`) : le point decisif
--     s'inscrit comme un jeu (6-5) ;
--   * le FORFAIT contourne ce refus -- il ecrit `tournaments.forfeit_games`
--     (0 par defaut) DES DEUX COTES et marque `forfeited_team`. C'est ce
--     marqueur, et lui seul, qui dit qui a gagne : ne jamais re-deduire le
--     resultat des jeux d'un forfait.
--
-- QUI PEUT QUOI. Les quatre joueurs d'un match saisissent leur score. Tout le
-- reste -- demarrer, tirer une rotation, trancher un litige, prononcer un
-- forfait, rouvrir un match -- appartient a l'ORGANISATEUR, identifie par
-- `tournaments.created_by` compare a `current_player_id()`, exactement comme
-- `tournament_autopair` de la section precedente. Le sujet n'est JAMAIS un
-- parametre.
--
-- L'ETAT « LITIGE » N'EST PAS UNE COLONNE. Il se lit dans les saisies
-- (`fn_tournament_match_dispute`). Le stocker serait une seconde verite a
-- garder synchronisee de la premiere.
-- ############################################################################

-- ============================================================================
-- tournament_start(p_tournament)
--
-- LE COUP D'ENVOI. Elle fige la composition, arrete le nombre de terrains
-- REELLEMENT en jeu, pose le PLACEMENT INITIAL et passe le tournoi en
-- EN_COURS. Elle ne cree AUCUN match : la premiere rotation est tiree par
-- `tournament_generate_round`, comme les cinq suivantes -- une seule fonction
-- sait apparier, donc il n'y a qu'un seul endroit ou l'appariement peut etre
-- faux.
--
-- LE PLACEMENT INITIAL, port de `initialCourts` :
--   tri des binomes par niveau DECROISSANT, l'identifiant departageant a
--   niveau egal ; le i-eme (a partir de 0) va au palier floor(i / 2) + 1.
--   Les deux plus forts au TERRAIN 1, qui est le meilleur.
-- Le niveau d'un binome est la moyenne des niveaux de ses deux joueurs
-- (`fn_tournament_seated_teams`).
--
-- LE NOMBRE DE TERRAINS. `tournaments.court_count` est saisi a la creation
-- comme une CAPACITE prevue (binomes = terrains x 2, places = terrains x 4).
-- Au coup d'envoi il devient le nombre de terrains REELS : ceil(binomes / 2),
-- borne par la capacite. Sans cela, le plafond de descente
-- (`least(court_count, court + 1)`) designerait un terrain vide et le
-- classement de la rotation finale compterait des creneaux qui n'existent
-- pas. Il ne peut que RETRECIR -- les binomes assis ne depassent jamais la
-- capacite.
--
-- CE QU'ELLE NE FAIT PAS : elle ne touche pas au check-in. Un binome dont un
-- joueur est 'no_show' est place comme les autres ; l'organisateur le sort par
-- `tournament_forfeit`, qui est le chemin nomme pour ca. Ecarter ici un binome
-- au check-in le ferait DISPARAITRE du tableau sans un mot, ce que la spec
-- interdit -- et ce que l'organisateur ne pourrait pas defaire.
--
-- Refus : feature_disabled, not_authenticated, tournament_not_found,
--         not_the_organizer, tournament_not_open, already_started,
--         tournament_over, matches_already_generated, not_enough_teams.
-- Appelable par : l'ORGANISATEUR (tournaments.created_by) seul.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_start(p_tournament uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me    uuid := public.current_player_id();
  v_t     public.tournaments%ROWTYPE;
  v_teams int;
  v_cc    int;
  v_rows  int;
BEGIN
  ---------------------------------------------------------------------------
  -- CONTROLES -- aucune ecriture avant la fin de cette section. Un refus ne
  -- leve pas, donc rien ne serait annule : une ecriture placee ici resterait
  -- en base derriere un {ok:false}.
  ---------------------------------------------------------------------------
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  IF v_t.created_by <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_the_organizer');
  END IF;
  IF v_t.status = 'EN_COURS' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_started');
  END IF;
  IF v_t.status IN ('TERMINE','CLASSEMENT_VALIDE') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_over');
  END IF;
  -- INSCRIPTIONS_OUVERTES est accepte, et ce n'est pas un relachement : un
  -- tournoi qui ne se remplit pas GARDE ce statut (le helper de capacite ne
  -- le passe a COMPLET que lorsqu'il ne reste plus une place). L'exclure
  -- rendrait impossible de demarrer a sept binomes -- exactement la soiree
  -- que le bye tournant existe pour absorber. Seul BROUILLON est refuse :
  -- rien n'y est encore publie.
  IF v_t.status NOT IN ('INSCRIPTIONS_OUVERTES','COMPLET','CHECK_IN','PRET') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_open');
  END IF;
  -- Ceinture : des matchs sans statut EN_COURS voudraient dire que quelqu'un
  -- a ecrit `tournament_matches` en direct. On ne re-place pas par-dessus.
  IF EXISTS (SELECT 1 FROM public.tournament_matches m
              WHERE m.tournament_id = p_tournament) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'matches_already_generated');
  END IF;

  SELECT count(*)::int INTO v_teams
    FROM public.fn_tournament_seated_teams(p_tournament);
  IF v_teams < 2 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_enough_teams',
                              'teams', v_teams);
  END IF;

  -- ceil(v_teams / 2) en arithmetique entiere, borne par la capacite prevue.
  -- Pour un nombre PAIR de binomes -- le seul cas que `initialCourts` accepte
  -- cote TypeScript -- ceil(n/2) = n/2 : aucune divergence possible sur le
  -- domaine ou la parite est testable.
  v_cc := least(v_t.court_count, ((v_teams + 1) / 2)::int);

  ---------------------------------------------------------------------------
  -- ECRITURES
  ---------------------------------------------------------------------------
  UPDATE public.tournaments
     SET court_count   = v_cc,
         current_round = 0,
         status        = 'EN_COURS'
   WHERE id = p_tournament;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    -- La ligne est verrouillee et a ete lue juste au-dessus : zero ligne est
    -- un etat impossible, pas un refus metier. On LEVE, ce qui annule tout.
    RAISE EXCEPTION 'tournament_start: le tournoi % a disparu sous le verrou',
      p_tournament;
  END IF;

  -- `initialCourts` : le plus fort au Terrain 1.
  WITH ord AS (
    SELECT s.s_team,
           (row_number() OVER (ORDER BY s.s_level DESC, s.s_team ASC) - 1) AS i
      FROM public.fn_tournament_seated_teams(p_tournament)
             AS s(s_team, s_p1, s_p2, s_start, s_level)
  )
  UPDATE public.tournament_teams tt
     SET start_court = (ord.i / 2)::int + 1
    FROM ord
   WHERE tt.tournament_id = p_tournament
     AND tt.id            = ord.s_team;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Ceinture : un binome qui N'A PAS de place (liste d'attente) ou qui s'est
  -- retire ne doit garder aucun palier d'une tentative anterieure. Sans ca,
  -- `fn_tournament_ladder` le verrait reapparaitre sur l'echelle le jour ou
  -- sa place se libere en cours de soiree.
  UPDATE public.tournament_teams tt
     SET start_court = NULL
   WHERE tt.tournament_id = p_tournament
     AND tt.start_court IS NOT NULL
     AND NOT EXISTS (SELECT 1
                       FROM public.fn_tournament_seated_teams(p_tournament)
                              AS s(s_team, s_p1, s_p2, s_start, s_level)
                      WHERE s.s_team = tt.id);

  RETURN jsonb_build_object('ok', true, 'teams', v_teams, 'placed', v_rows,
                            'court_count', v_cc, 'round_count', v_t.round_count);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_start(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_start(uuid) TO authenticated;

-- ============================================================================
-- tournament_enter_score(p_match, p_games_a, p_games_b)
--
-- N'IMPORTE LEQUEL DES QUATRE JOUEURS SAISIT. Une ligne par saisie dans
-- `tournament_match_entries`, corrigeable (l'UNIQUE (match_id, player_id) en
-- fait une mise a jour, jamais un empilement).
--
-- ⚠️ CONTRAT D'ORIENTATION DU SCORE, SANS EXCEPTION :
--   `p_games_a` est TOUJOURS le score de `team_a` DU MATCH, et `p_games_b`
--   celui de `team_b` DU MATCH -- quel que soit le joueur qui saisit, et quel
--   que soit son camp.
-- Rien dans ce SQL ne peut le verifier : deux adversaires qui inversent tous
-- les deux saisissent le MEME score a l'envers, concordent, et acquierent un
-- resultat inverse que personne ne verra jamais. La garantie est donc a la
-- charge de l'ECRAN de saisie, et c'est une exigence dure : il nomme les deux
-- camps (les binomes, tels que le match les porte) et n'ecrit JAMAIS
-- « vous / eux », ni ne reordonne les colonnes pour mettre le joueur en
-- premier. Vaut pour l'ecran de saisie comme pour l'ecran d'organisation.
--
-- L'ACQUISITION est automatique et n'a pas d'etape a elle : des que deux
-- joueurs de binomes OPPOSES ont saisi le MEME score, le match est acquis
-- (`games_a`, `games_b`, `confirmed_at`). C'est pourquoi il n'y a plus de
-- `tournament_confirm_score` : la concordance EST la confirmation.
--   * deux COEQUIPIERS d'accord ne valident rien -- la recherche de
--     concordance ne regarde que les saisies du binome ADVERSE ;
--   * deux joueurs OPPOSES qui divergent ouvrent un LITIGE. Le litige n'est
--     pas une colonne, c'est l'etat que `fn_tournament_match_dispute` lit
--     dans les saisies ; il se tranche par `tournament_resolve_dispute`.
--
-- Le retour porte `state` : 'recorded' (saisie prise, rien d'acquis),
-- 'confirmed' (score acquis), 'disputed' (l'adversaire dit autre chose).
--
-- `draw_not_allowed` : le moteur TypeScript traite games_a = games_b comme une
-- victoire de B et note que le cas est « valide en amont, pas ici ». C'est
-- ici, l'amont. Le FORFAIT, qui ecrit legitimement 0-0, ne passe pas par cette
-- fonction : il a la sienne.
--
-- LE SCORE EST BORNE DES DEUX COTES. En dessous : un jeu negatif n'existe pas
-- (`invalid_score`). Au-dessus : 20 jeux par camp (`score_out_of_range`),
-- largement au-dessus de tout ce qu'une rotation de quinze minutes produit. Ce
-- plafond n'est pas du zele -- un `66-3` fauté au clavier devient ACQUIS des
-- que l'adversaire saisit la meme chose, et ne se defait plus que par
-- `tournament_reopen_match`, qui detruit toutes les rotations posterieures.
--
-- Refus : feature_disabled, not_authenticated, match_not_found,
--         tournament_not_found, tournament_not_live, bye_match,
--         already_confirmed, not_a_participant, invalid_score,
--         score_out_of_range, draw_not_allowed.
-- Appelable par : les quatre joueurs des deux binomes du match.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_enter_score(p_match uuid, p_games_a int, p_games_b int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me       uuid := public.current_player_id();
  v_tid      uuid;
  v_tstat    text;
  v_m        public.tournament_matches%ROWTYPE;
  v_my_team  uuid;
  v_opp_team uuid;
  v_accord   int;
  v_ecart    int;
  v_rows     int;
  v_state    text;
BEGIN
  ---------------------------------------------------------------------------
  -- CONTROLES -- aucune ecriture avant la fin de cette section.
  ---------------------------------------------------------------------------
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- ORDRE DES VERROUS : la ligne `tournaments` D'ABORD, les autres ensuite.
  -- Cette premiere lecture du match est SANS verrou et ne sert qu'a savoir
  -- quelle ligne de tournoi verrouiller ; tout ce qui decide se relit apres.
  SELECT m.tournament_id INTO v_tid
    FROM public.tournament_matches m WHERE m.id = p_match;
  IF v_tid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'match_not_found');
  END IF;

  SELECT t.status INTO v_tstat
    FROM public.tournaments t WHERE t.id = v_tid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  IF v_tstat <> 'EN_COURS' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_live');
  END IF;

  SELECT * INTO v_m FROM public.tournament_matches WHERE id = p_match FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'match_not_found');
  END IF;
  IF v_m.team_a IS NULL OR v_m.team_b IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bye_match');
  END IF;
  IF v_m.confirmed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_confirmed');
  END IF;

  SELECT tt.id INTO v_my_team
    FROM public.tournament_teams tt
   WHERE tt.tournament_id = v_tid
     AND tt.id IN (v_m.team_a, v_m.team_b)
     AND (tt.player1_id = v_me OR tt.player2_id = v_me);
  IF v_my_team IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_participant');
  END IF;
  v_opp_team := CASE WHEN v_my_team = v_m.team_a THEN v_m.team_b ELSE v_m.team_a END;

  IF p_games_a IS NULL OR p_games_b IS NULL OR p_games_a < 0 OR p_games_b < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_score');
  END IF;
  -- Le plafond : 20 jeux par camp. Une rotation de quinze minutes n'en produit
  -- jamais plus de neuf ou dix ; 20 laisse toute la marge utile et arrete la
  -- faute de frappe, qui coute une reouverture de tour a la reparer.
  IF p_games_a > 20 OR p_games_b > 20 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'score_out_of_range',
                              'max_games', 20);
  END IF;
  IF p_games_a = p_games_b THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'draw_not_allowed');
  END IF;

  ---------------------------------------------------------------------------
  -- ECRITURES
  ---------------------------------------------------------------------------
  INSERT INTO public.tournament_match_entries
         (tournament_id, match_id, player_id, games_a, games_b)
  VALUES (v_tid, p_match, v_me, p_games_a, p_games_b)
  ON CONFLICT (match_id, player_id) DO UPDATE
    SET games_a    = EXCLUDED.games_a,
        games_b    = EXCLUDED.games_b,
        entered_at = now();

  -- Les saisies du binome ADVERSE, et elles seules : combien disent la meme
  -- chose que moi, combien disent autre chose.
  SELECT (count(*) FILTER (WHERE e.games_a =  p_games_a AND e.games_b =  p_games_b))::int,
         (count(*) FILTER (WHERE e.games_a <> p_games_a OR  e.games_b <> p_games_b))::int
    INTO v_accord, v_ecart
    FROM public.tournament_match_entries e
    JOIN public.tournament_teams tt
      ON tt.tournament_id = v_tid
     AND tt.id            = v_opp_team
     AND (tt.player1_id = e.player_id OR tt.player2_id = e.player_id)
   WHERE e.match_id = p_match;

  IF v_accord > 0 THEN
    -- ACQUIS. `forfeited_team` remis a NULL : ce match est joue, pas forfait.
    UPDATE public.tournament_matches
       SET games_a        = p_games_a,
           games_b        = p_games_b,
           forfeited_team = NULL,
           confirmed_at   = now()
     WHERE id = p_match;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      -- La ligne est verrouillee depuis le controle : zero ligne est un etat
      -- impossible, pas un refus metier. On leve, ce qui annule la saisie.
      RAISE EXCEPTION 'tournament_enter_score: le match % a disparu sous le verrou',
        p_match;
    END IF;
    v_state := 'confirmed';
  ELSIF v_ecart > 0 THEN
    v_state := 'disputed';
  ELSE
    v_state := 'recorded';
  END IF;

  RETURN jsonb_build_object('ok', true, 'match_id', p_match,
                            'state', v_state,
                            'confirmed', v_state = 'confirmed',
                            'games_a', p_games_a, 'games_b', p_games_b);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_enter_score(uuid, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_enter_score(uuid, int, int) TO authenticated;

-- ============================================================================
-- tournament_resolve_dispute(p_match, p_games_a, p_games_b)
--
-- L'ORGANISATEUR TRANCHE. Deux joueurs de binomes opposes ont saisi deux
-- scores differents ; personne sur le terrain ne peut departager, et le tour
-- suivant ne peut pas se tirer tant que ce match n'est pas acquis. Cette
-- fonction pose le score qui fait foi et ACQUIERT le match.
--
-- ELLE EXIGE UN LITIGE REEL (`fn_tournament_match_dispute`). Sans ce garde,
-- elle serait un pouvoir general d'ecrire n'importe quel score par-dessus les
-- joueurs, ce qui n'est pas ce que le brief lui donne. Consequence assumee, et
-- ecrite ici pour qu'elle ne surprenne pas : un match ou UN SEUL camp a saisi
-- (l'autre est parti sans rien dire) n'est PAS un litige -- il se solde par
-- `tournament_forfeit`, ou la soiree se cloture au dernier tour complet.
--
-- Elle ne touche PAS aux tours posterieurs, et n'a pas a le faire : un match
-- en litige n'est pas acquis, et `tournament_generate_round` refuse d'avancer
-- sur un tour incomplet. Aucun tour posterieur ne peut donc exister.
--
-- Les saisies des joueurs ne sont PAS effacees : elles restent la trace de ce
-- qui a ete declare, a cote de la decision. La decision, elle, ne s'ecrit pas
-- comme une saisie -- l'organisateur n'est pas forcement inscrit au tournoi,
-- et `tournament_match_entries` n'accepte que des inscrits (cle etrangere).
--
-- ⚠️ MEME CONTRAT D'ORIENTATION que `tournament_enter_score` : `p_games_a` est
-- le score de `team_a` DU MATCH, `p_games_b` celui de `team_b` DU MATCH. Ici
-- plus qu'ailleurs -- c'est une decision d'arbitre, elle ne sera contredite
-- par personne. Et meme plafond de 20 jeux par camp.
--
-- Refus : feature_disabled, not_authenticated, match_not_found,
--         tournament_not_found, not_the_organizer, tournament_not_live,
--         bye_match, already_confirmed, no_dispute, invalid_score,
--         score_out_of_range, draw_not_allowed.
-- Appelable par : l'ORGANISATEUR (tournaments.created_by) seul.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_resolve_dispute(
  p_match uuid, p_games_a int, p_games_b int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me   uuid := public.current_player_id();
  v_tid  uuid;
  v_t    public.tournaments%ROWTYPE;
  v_m    public.tournament_matches%ROWTYPE;
  v_rows int;
BEGIN
  ---------------------------------------------------------------------------
  -- CONTROLES -- aucune ecriture avant la fin de cette section.
  ---------------------------------------------------------------------------
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT m.tournament_id INTO v_tid
    FROM public.tournament_matches m WHERE m.id = p_match;
  IF v_tid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'match_not_found');
  END IF;

  SELECT * INTO v_t FROM public.tournaments WHERE id = v_tid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  IF v_t.created_by <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_the_organizer');
  END IF;
  IF v_t.status <> 'EN_COURS' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_live');
  END IF;

  SELECT * INTO v_m FROM public.tournament_matches WHERE id = p_match FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'match_not_found');
  END IF;
  IF v_m.team_a IS NULL OR v_m.team_b IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bye_match');
  END IF;
  IF v_m.confirmed_at IS NOT NULL THEN
    -- Un score deja acquis se defait par `tournament_reopen_match`, jamais en
    -- l'ecrasant : la reouverture, elle, invalide les tours posterieurs.
    RETURN jsonb_build_object('ok', false, 'reason', 'already_confirmed');
  END IF;
  IF NOT public.fn_tournament_match_dispute(p_match) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_dispute');
  END IF;

  IF p_games_a IS NULL OR p_games_b IS NULL OR p_games_a < 0 OR p_games_b < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_score');
  END IF;
  IF p_games_a > 20 OR p_games_b > 20 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'score_out_of_range',
                              'max_games', 20);
  END IF;
  IF p_games_a = p_games_b THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'draw_not_allowed');
  END IF;

  ---------------------------------------------------------------------------
  -- ECRITURES
  ---------------------------------------------------------------------------
  UPDATE public.tournament_matches
     SET games_a        = p_games_a,
         games_b        = p_games_b,
         forfeited_team = NULL,
         confirmed_at   = now()
   WHERE id = p_match;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'tournament_resolve_dispute: le match % a disparu sous le verrou',
      p_match;
  END IF;

  RETURN jsonb_build_object('ok', true, 'match_id', p_match,
                            'games_a', p_games_a, 'games_b', p_games_b);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_resolve_dispute(uuid, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_resolve_dispute(uuid, int, int) TO authenticated;

-- ============================================================================
-- tournament_confirm_score(p_match) -- SUPPRIMEE, et non plus gelee.
--
-- Elle etait PERIMEE PAR LE MODELE, pas seulement par le schema : un score est
-- acquis des que deux joueurs de binomes OPPOSES saisissent le meme score
-- (`tournament_enter_score` ci-dessus). Il n'y a plus d'etape de confirmation
-- a declencher, donc plus aucun role pour cette fonction -- et son corps
-- ecrivait `entered_by` / `confirmed_by`, colonnes que `tournament_matches` ne
-- porte plus : elle aurait leve une erreur SQL BRUTE au premier appel, la ou
-- tout ce fichier promet `{ok:false, reason}`.
--
-- Le DROP est explicite et RESTE : une base ou l'ancienne version a ete
-- appliquee garderait sinon une fonction morte, sans droit d'execution
-- aujourd'hui mais qu'un GRANT malheureux pourrait rallumer demain.
-- ============================================================================
DROP FUNCTION IF EXISTS public.tournament_confirm_score(uuid);

-- ============================================================================
-- tournament_forfeit(p_tournament, p_team)
--
-- LE FORFAIT EN COURS DE TOURNOI -- un binome quitte la soiree. A ne pas
-- confondre avec `tournament_withdraw(p_tournament)`, qui est la desinscription
-- AVANT le coup d'envoi, faite par le joueur pour lui-meme.
--
-- Deux effets, et pas un de plus :
--   1. le binome sort de l'echelle (`tournament_teams.withdrawn`) : il n'est
--      plus place, plus apparie, et son adversaire du tour suivant se
--      retrouve seul sur son palier -- il y recoit un bye, ce que veut la spec ;
--   2. ses matchs REELS non acquis, tous tours confondus, sont soldes :
--      `tournaments.forfeit_games` (0 par defaut) DES DEUX COTES, et
--      `forfeited_team` marque le camp forfaitaire.
--
-- ⚠️ LE MARQUEUR, PAS LE SCORE. Un forfait s'inscrit a EGALITE (0-0 par
-- defaut) : le score ne dit RIEN de qui a gagne. Seul `forfeited_team` le dit,
-- et c'est ce que lit `fn_tournament_a_won`, donc l'echelle. Re-deduire le
-- resultat des jeux ferait monter le forfaitaire une fois sur deux. La CHECK
-- de `tournament_matches` autorise l'egalite EXACTEMENT dans ce cas, et le
-- refus `draw_not_allowed` de la saisie ne s'applique donc pas ici : c'est le
-- contournement prevu par la spec, pas une exception oubliee.
--
-- LES MATCHS DEJA ACQUIS NE SONT PAS TOUCHES. Un binome qui a joue trois tours
-- avant de partir garde ses trois resultats : ils ont eu lieu. Aucun score
-- confirme n'est jamais detruit hors de `tournament_reopen_match`.
--
-- Le BYE eventuel du binome au tour courant est laisse en place : il ne porte
-- aucun score, il ne fausse rien, et l'effacer ferait disparaitre le binome du
-- tableau du tour -- ce que la spec interdit. L'echelle, elle, ne le reprendra
-- pas au tour suivant.
--
-- IL N'Y A PAS DE RETOUR EN ARRIERE dans cette surface : un forfait prononce
-- par erreur ne se defait pas ici. C'est un manque connu, pas un oubli -- le
-- defaire supposerait de rendre au binome son palier, ce que seule une
-- reouverture de tour saurait faire proprement.
--
-- ⚠️ LE BINOME DOIT AVOIR UNE PLACE (`team_not_seated`). Lire
-- `tournament_teams` pour verifier qu'il existe NE SUFFIT PAS : deux joueurs en
-- LISTE D'ATTENTE qui s'apparient y ont une ligne parfaitement reelle, et
-- indiscernable de celle d'un binome assis (cf. l'invariant en tete de
-- fichier). C'est la seule fonction de cette section qui ECRIT a partir d'un
-- identifiant de binome fourni par l'appelant, donc la seule ou l'oubli se paie
-- comptant.
--
-- Refus : feature_disabled, not_authenticated, tournament_not_found,
--         not_the_organizer, tournament_not_live, team_not_found,
--         already_withdrawn, team_not_seated.
-- Appelable par : l'ORGANISATEUR (tournaments.created_by) seul.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_forfeit(p_tournament uuid, p_team uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me      uuid := public.current_player_id();
  v_t       public.tournaments%ROWTYPE;
  v_with    boolean;
  v_settled int;
  v_rows    int;
BEGIN
  ---------------------------------------------------------------------------
  -- CONTROLES -- aucune ecriture avant la fin de cette section.
  ---------------------------------------------------------------------------
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- ORDRE DES VERROUS : le tournoi d'abord, le binome ensuite.
  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  IF v_t.created_by <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_the_organizer');
  END IF;
  -- AVANT le coup d'envoi, on ne forfait pas : on se desinscrit
  -- (`tournament_withdraw`), ou l'organisateur defait le binome. APRES la
  -- cloture, le classement est fige et se rouvre par un autre chemin.
  IF v_t.status <> 'EN_COURS' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_live');
  END IF;

  SELECT tt.withdrawn INTO v_with
    FROM public.tournament_teams tt
   WHERE tt.tournament_id = p_tournament
     AND tt.id            = p_team
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'team_not_found');
  END IF;
  IF v_with THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_withdrawn');
  END IF;
  -- ⚠️ INVARIANT DE LECTURE DE `tournament_teams`. La lecture ci-dessus prouve
  -- que le binome EXISTE, pas qu'il a une PLACE : un binome forme par deux
  -- joueurs en liste d'attente a une ligne tout aussi reelle. Sans ce
  -- controle, un identifiant de ce genre poserait `withdrawn = true` --
  -- IRREVERSIBLEMENT, defaire un forfait n'existe pas dans cette surface --
  -- sur un binome qui n'est jamais entre dans le tournoi, ne solderait aucun
  -- match, et la fonction repondrait `ok:true` sur un non-evenement.
  IF NOT EXISTS (SELECT 1
                   FROM public.fn_tournament_seated_teams(p_tournament)
                          AS s(s_team, s_p1, s_p2, s_start, s_level)
                  WHERE s.s_team = p_team) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'team_not_seated');
  END IF;

  ---------------------------------------------------------------------------
  -- ECRITURES
  ---------------------------------------------------------------------------
  UPDATE public.tournament_teams
     SET withdrawn = true
   WHERE tournament_id = p_tournament
     AND id            = p_team;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'tournament_forfeit: le binome % a disparu sous le verrou', p_team;
  END IF;

  -- Les matchs REELS (team_b NOT NULL : on ne « forfait » pas un bye, il n'y a
  -- personne a qui attribuer la victoire) et NON ACQUIS, tous tours confondus.
  UPDATE public.tournament_matches m
     SET games_a        = v_t.forfeit_games,
         games_b        = v_t.forfeit_games,
         forfeited_team = p_team,
         confirmed_at   = now()
   WHERE m.tournament_id = p_tournament
     AND m.team_b       IS NOT NULL
     AND m.confirmed_at IS NULL
     AND (m.team_a = p_team OR m.team_b = p_team);
  GET DIAGNOSTICS v_settled = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'team_id', p_team,
                            'matches_settled', v_settled,
                            'forfeit_games', v_t.forfeit_games);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_forfeit(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_forfeit(uuid, uuid) TO authenticated;

-- ============================================================================
-- fn_tournament_generate_round(p_tournament, p_final_round) -- LE MOTEUR.
--
-- L'appariement d'une rotation, port de `pairUp` de `lib/tournament.ts` --
-- QUE CE FICHIER N'ACCORDE A PERSONNE (Task 12, cf. le paragraphe ⚠️
-- ci-dessous). Deux facades PUBLIQUES l'appellent avec un `p_final_round`
-- different : `tournament_generate_round(p_tournament)`, juste apres, qui
-- l'appelle TOUJOURS a `false` ; et `tournament_final_round`, plus bas dans le
-- fichier, seul appelant legitime a le passer a `true`.
--
-- ⚠️ POURQUOI CE MOTEUR N'EST ACCORDE A PERSONNE. La version precedente
-- accordait `tournament_generate_round(uuid, boolean)` A L'IDENTIQUE cote
-- organisateur, en ne comptant que sur le DEFAUT du parametre (`false`) pour
-- proteger la rotation de classement : rien n'empechait un organisateur
-- d'appeler la fonction avec `p_final_round => true` directement, et de tirer
-- la rotation de classement SANS jamais passer par `tournament_final_round` --
-- donc sans jamais calculer ni annoncer `stakes`. `tournament_final_round`
-- refusait alors `final_round_already_generated` : l'enjeu par terrain
-- n'etait plus annoncable de la soiree. Un GRANT ne sait pas distinguer QUI
-- appelle ; seul le fait de ne pas l'accorder le peut. La logique
-- d'appariement reste donc ICI, jamais accordee directement -- les deux
-- entrees publiques ne sont que des FACADES qui decident, chacune a sa
-- maniere, de la valeur de `p_final_round`.
--
-- Port de `pairUp` de `lib/tournament.ts` ; le palier de chaque binome A
-- L'ENTREE du tour vient de `fn_tournament_ladder`, qui est le port de
-- `nextCourts` (et, au tour 1, du `start_court` pose par `tournament_start`,
-- port de `initialCourts`).
--
-- REGLE DU BYE, identique a `pairUp` : un palier a un nombre IMPAIR d'equipes
-- donne un bye a celle qui en a recu le MOINS jusqu'ici, l'identifiant
-- departageant a egalite ; les autres se rencontrent. Un palier porte 1, 2 ou
-- 3 equipes -- jamais plus : il recoit au plus le perdant du palier du dessus,
-- au plus le gagnant du palier du dessous, et garde au plus une equipe qui
-- vient d'y faire un bye. AUCUNE equipe n'est jamais laissee sans ligne.
--
-- ELLE REFUSE TANT QUE LE TOUR COURANT N'EST PAS ENTIEREMENT ACQUIS, et rend
-- alors la LISTE DES MATCHS MANQUANTS sous la cle `missing` -- avec de quoi
-- les NOMMER a l'ecran (le terrain, les deux binomes et leurs joueurs), pas
-- seulement des identifiants que l'ecran devrait aller resoudre lui-meme.
-- Chaque entree porte aussi `entries` (combien de joueurs ont saisi) et
-- `disputed` : « personne n'a saisi » et « les deux camps se contredisent » ne
-- se reglent pas du tout de la meme facon, et l'organisateur doit voir lequel
-- des deux il a devant lui.
--
-- Les BYES sont exclus de ce controle : personne ne peut confirmer un match
-- sans adversaire.
--
-- ELLE ECRIT `tournament_movements` : une ligne par binome et par tour, avec
-- le palier d'ou il vient, celui ou il va, et le sens. C'est ce qui permet
-- d'afficher « T4 -> T3 (monte) -> T2 (monte) » sans recalculer l'historique.
-- Convention : la ligne du tour r dit OU LE BINOME JOUE AU TOUR r
-- (`court_after`) et d'ou il arrive (`court_before`, son palier au tour r-1,
-- ou son `start_court` au tour 1). Elle se joint donc directement au match du
-- meme tour. LE TERRAIN 1 ETANT LE MEILLEUR, 'UP' est un numero qui DIMINUE.
--
-- Refus : feature_disabled, not_authenticated, tournament_not_found,
--         not_the_organizer, tournament_not_started, tournament_over,
--         round_incomplete (avec `missing`), round_already_generated,
--         not_enough_teams, not_the_final_round (la DERNIERE rotation se tire
--         par `tournament_final_round`).
-- Appelable par : PERSONNE directement -- voir le paragraphe ⚠️ ci-dessus. Les
-- deux facades publiques (`tournament_generate_round`, `tournament_final_round`)
-- restent, elles, reservees a l'ORGANISATEUR (tournaments.created_by).
-- ============================================================================
-- Ajouter un parametre CHANGE la signature : Postgres creerait une SURCHARGE a
-- cote de l'ancienne, et PostgREST ne saurait plus laquelle appeler. On
-- supprime explicitement l'ancienne -- celle d'avant le parametre, ET celle
-- accordee directement a l'organisateur (Task 12, cf. ⚠️ ci-dessus).
DROP FUNCTION IF EXISTS public.tournament_generate_round(uuid);
DROP FUNCTION IF EXISTS public.tournament_generate_round(uuid, boolean);

CREATE OR REPLACE FUNCTION public.fn_tournament_generate_round(
  p_tournament   uuid,
  p_final_round  boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me       uuid := public.current_player_id();
  v_t        public.tournaments%ROWTYPE;
  v_round    int;
  v_placed   int;
  v_jouables int;
  v_missing  jsonb;
  v_created  int;
  v_byes     int;
  v_moves    int;
  v_rows     int;
BEGIN
  ---------------------------------------------------------------------------
  -- CONTROLES -- aucune ecriture avant la fin de cette section. Les evaluer
  -- APRES l'insertion des matchs ne marcherait pas : un refus renvoie
  -- {ok:false} SANS lever, donc sans rollback -- il laisserait derriere lui
  -- un tour entier de matchs qu'il vient d'annoncer refuse.
  ---------------------------------------------------------------------------
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  IF v_t.created_by <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_the_organizer');
  END IF;
  IF v_t.status IN ('TERMINE','CLASSEMENT_VALIDE') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_over');
  END IF;
  -- Le placement initial appartient a `tournament_start`. Sans lui, aucun
  -- binome n'a de `start_court` et l'echelle serait vide : on le dit, plutot
  -- que de rendre « pas assez d'equipes » a un tournoi qui en a huit.
  IF v_t.status <> 'EN_COURS' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_started');
  END IF;

  v_round := v_t.current_round + 1;
  IF v_round > v_t.round_count THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_over');
  END IF;
  -- LA DERNIERE ROTATION EST LA ROTATION DE CLASSEMENT, et elle se tire par
  -- `tournament_final_round`. Tirer le meme tour ici produirait EXACTEMENT les
  -- memes matchs -- l'appariement est le meme, c'est ce qu'on en fait ensuite
  -- qui differe -- mais sans l'enjeu de chaque terrain (`stakes`), que l'ecran
  -- n'a alors aucun moyen de reconstituer. Deux chemins pour le meme tour,
  -- dont un qui ment par omission : on nomme le refus et on renvoie a la
  -- bonne fonction. `tournament_final_round` passe `p_final_round => true` et
  -- traverse ce garde -- il n'y a toujours qu'UNE fonction qui apparie.
  -- COALESCE et non `NOT p_final_round` seul : un client qui envoie
  -- `p_final_round: null` rendrait `NOT NULL` = NULL, le IF ne serait pas
  -- pris, et la rotation de classement se tirerait sans ses `stakes`.
  IF v_round = v_t.round_count AND NOT COALESCE(p_final_round, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_the_final_round',
                              'round', v_round,
                              'round_count', v_t.round_count,
                              'use', 'tournament_final_round');
  END IF;

  -- Un tour ne se tire JAMAIS sur des scores incomplets : les paliers du tour
  -- suivant se deduisent des resultats du tour courant.
  IF v_t.current_round >= 1 THEN
    SELECT jsonb_agg(x.j ORDER BY x.court_no) INTO v_missing FROM (
      SELECT m.court_no,
             jsonb_build_object(
               'match_id',     m.id,
               'round_no',     m.round_no,
               'court_no',     m.court_no,
               'team_a',       m.team_a,
               'team_b',       m.team_b,
               'team_a_label', nullif(concat_ws(' & ', a1.name, a2.name), ''),
               'team_b_label', nullif(concat_ws(' & ', b1.name, b2.name), ''),
               'entries',      (SELECT count(*)::int
                                  FROM public.tournament_match_entries e
                                 WHERE e.match_id = m.id),
               'disputed',     public.fn_tournament_match_dispute(m.id)
             ) AS j
        FROM public.tournament_matches m
        JOIN public.tournament_teams ta ON ta.tournament_id = m.tournament_id
                                       AND ta.id           = m.team_a
        JOIN public.tournament_teams tb ON tb.tournament_id = m.tournament_id
                                       AND tb.id           = m.team_b
        JOIN public.players a1 ON a1.id = ta.player1_id
        JOIN public.players a2 ON a2.id = ta.player2_id
        JOIN public.players b1 ON b1.id = tb.player1_id
        JOIN public.players b2 ON b2.id = tb.player2_id
       WHERE m.tournament_id = p_tournament
         AND m.round_no      = v_t.current_round
         AND m.team_b       IS NOT NULL
         AND m.confirmed_at IS NULL
    ) x;
    IF v_missing IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'round_incomplete',
                                'round', v_t.current_round,
                                'missing', v_missing);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.tournament_matches m
              WHERE m.tournament_id = p_tournament AND m.round_no = v_round) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'round_already_generated');
  END IF;

  -- Compter les equipes ne suffit PAS : deux equipes restantes peuvent etre
  -- seules chacune sur son palier, ce qui donne deux byes et AUCUN match. Un
  -- bye ne fait bouger personne, donc tous les tours suivants se
  -- regenereraient a l'identique, sans qu'un jeu soit joue et sans que le
  -- classement bouge -- une soiree qui tourne a vide en annoncant ok:true. La
  -- vraie condition est qu'au moins UN palier porte deux equipes ou plus.
  SELECT count(*)::int INTO v_placed
    FROM public.fn_tournament_ladder(p_tournament, v_round);

  SELECT count(*)::int INTO v_jouables
    FROM (SELECT l.court
            FROM public.fn_tournament_ladder(p_tournament, v_round) l
           GROUP BY l.court
          HAVING count(*) >= 2) z;

  IF v_jouables = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_enough_teams',
                              'teams_left', v_placed);
  END IF;

  -- Un palier a plus de trois equipes est IMPOSSIBLE (cf. l'en-tete). Si ca
  -- arrive, l'echelle est corrompue en amont : on LEVE, ce qui annule tout.
  -- `pairUp` fait exactement pareil cote TypeScript (« Echelle corrompue »).
  -- Abandonner la quatrieme en silence -- ce que faisaient les deux
  -- implementations avant -- est la facon la plus sure de ne jamais trouver
  -- le bug.
  IF EXISTS (SELECT 1
               FROM public.fn_tournament_ladder(p_tournament, v_round) l
              GROUP BY l.court
             HAVING count(*) > 3) THEN
    RAISE EXCEPTION 'tournament_ladder_corrupt: un palier porte plus de trois equipes (tournoi %, tour %)',
      p_tournament, v_round;
  END IF;

  ---------------------------------------------------------------------------
  -- ECRITURES
  ---------------------------------------------------------------------------
  -- `pairUp` : sur chaque palier, les equipes sont triees par nombre de byes
  -- deja recus CROISSANT puis par identifiant CROISSANT -- jamais par ordre
  -- d'insertion, pour que SQL et TypeScript apparient a l'identique.
  WITH st AS (
    SELECT l.team_id, l.court, l.bye_count
      FROM public.fn_tournament_ladder(p_tournament, v_round) l
  ),
  ranked AS (
    SELECT st.team_id, st.court,
           row_number() OVER (PARTITION BY st.court
                              ORDER BY st.bye_count ASC, st.team_id ASC) AS pos,
           count(*)     OVER (PARTITION BY st.court)                     AS n
      FROM st
  ),
  ins AS (
    INSERT INTO public.tournament_matches (tournament_id, round_no, court_no, team_a, team_b)
    -- 1. Le bye des paliers IMPAIRS. pos = 1, c'est-a-dire l'equipe qui a recu
    --    le MOINS de byes jusqu'ici, l'identifiant departageant : le bye
    --    tournant de la spec. Un palier a 1 equipe et un palier a 3 passent
    --    tous deux par ici (`tri[0]` du TypeScript).
    SELECT p_tournament, v_round, r.court, r.team_id, NULL::uuid
      FROM ranked r
     WHERE r.n % 2 = 1 AND r.pos = 1
    UNION ALL
    -- 2. Le match, entre les deux equipes qui suivent : pos 2 contre pos 3 sur
    --    un palier impair (`reste = tri.slice(1)`), pos 1 contre pos 2 sur un
    --    palier pair. Rien n'est jamais abandonne, puisqu'un palier ne porte
    --    jamais plus de 3 equipes.
    SELECT p_tournament, v_round, a.court, a.team_id, b.team_id
      FROM ranked a
      JOIN ranked b ON b.court = a.court AND b.pos = a.pos + 1
     WHERE a.pos = CASE WHEN a.n % 2 = 1 THEN 2 ELSE 1 END
    RETURNING (team_b IS NULL) AS is_bye
  )
  SELECT (count(*) FILTER (WHERE NOT ins.is_bye))::int,
         (count(*) FILTER (WHERE     ins.is_bye))::int
    INTO v_created, v_byes
    FROM ins;

  -- Le parcours, tour par tour. `fn_tournament_ladder` ne lit que les tours
  -- STRICTEMENT ANTERIEURS a son argument : l'appeler ici, apres l'insertion,
  -- rend exactement le meme resultat qu'avant. Au tour 1, l'appel a `0` ne
  -- trouve aucun match et rend le `start_court` de chacun -- tout le monde
  -- part donc en 'STAY', ce qui est la verite : personne n'a encore bouge.
  INSERT INTO public.tournament_movements
         (tournament_id, team_id, round_no, court_before, court_after, movement)
  SELECT p_tournament, cur.team_id, v_round,
         COALESCE(prev.court, cur.court),
         cur.court,
         CASE WHEN cur.court < COALESCE(prev.court, cur.court) THEN 'UP'
              WHEN cur.court > COALESCE(prev.court, cur.court) THEN 'DOWN'
              ELSE 'STAY' END
    FROM public.fn_tournament_ladder(p_tournament, v_round) cur
    LEFT JOIN public.fn_tournament_ladder(p_tournament, greatest(v_round - 1, 0)) prev
      ON prev.team_id = cur.team_id
  ON CONFLICT (tournament_id, team_id, round_no) DO UPDATE
    SET court_before = EXCLUDED.court_before,
        court_after  = EXCLUDED.court_after,
        movement     = EXCLUDED.movement;
  GET DIAGNOSTICS v_moves = ROW_COUNT;

  UPDATE public.tournaments
     SET current_round = v_round
   WHERE id = p_tournament;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'fn_tournament_generate_round: le tournoi % a disparu sous le verrou',
      p_tournament;
  END IF;

  RETURN jsonb_build_object('ok', true, 'round', v_round,
                            'matches', v_created, 'byes', v_byes,
                            'movements', v_moves,
                            'court_count', v_t.court_count);
END;
$$;

-- PAS de GRANT : ce moteur n'est jamais appele directement par un client,
-- cf. le paragraphe ⚠️ en tete de fonction.
REVOKE ALL ON FUNCTION public.fn_tournament_generate_round(uuid, boolean) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- tournament_generate_round(p_tournament)
--
-- LA FACADE ORDINAIRE (Task 12). Appelle le moteur ci-dessus avec
-- `p_final_round => false`, TOUJOURS -- il n'y a plus de parametre a cote qui
-- pourrait dire le contraire, ce qui est exactement ce que corrige cette
-- tache. Refuse donc systematiquement de tirer la derniere rotation
-- (`not_the_final_round`, rendu par le moteur), quel que soit l'appelant :
-- seule `tournament_final_round`, ci-dessous, sait l'atteindre.
--
-- Refus, appelable par : voir `fn_tournament_generate_round` ci-dessus -- tous
-- ses controles s'appliquent ici aussi, cette facade ne fait qu'imposer
-- `p_final_round`.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_generate_round(p_tournament uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.fn_tournament_generate_round(p_tournament, false);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_generate_round(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_generate_round(uuid) TO authenticated;

-- ============================================================================
-- tournament_reopen_match(p_match)
--
-- LE SEUL CHEMIN qui defait un score acquis. Il est explicite, reserve a
-- l'organisateur, et il coute cher : rouvrir un match SUPPRIME tous les tours
-- POSTERIEURS et ramene `current_round` au tour du match rouvert. Ces tours
-- ont ete apparies a partir d'un resultat qu'on vient de declarer faux ; les
-- garder produirait une echelle fausse, donc un classement faux. La douleur de
-- retirer les rotations suivantes est le prix, et il est assume par la spec.
--
-- CE QUI EST DETRUIT, et rien d'autre :
--   * les matchs des tours > au tour rouvert (leurs saisies partent avec eux,
--     par le ON DELETE CASCADE de `tournament_match_entries`) ;
--   * les mouvements des tours > au tour rouvert. Celui du tour rouvert RESTE :
--     le placement du tour r ne depend pas du resultat du tour r ;
--   * les saisies DU match rouvert. Les garder rendrait le match
--     instantanement re-acquis a la premiere saisie adverse concordante --
--     avec le score qu'on vient justement de declarer faux ;
--   * `tournament_results`, s'il avait ete fige : un classement calcule a
--     partir de donnees fausses est precisement ce qu'on repare.
-- Les tours ANTERIEURS et leurs scores ne sont jamais touches.
--
-- UN FORFAIT NE SE ROUVRE PAS ICI (`forfeited_match`). Un forfait n'est pas un
-- score : c'est une sortie d'echelle (`tournament_teams.withdrawn`). Effacer
-- le score en laissant le binome retire rendrait le match injouable et
-- introuvable -- un refus nomme vaut mieux qu'une moitie d'annulation. Defaire
-- un forfait n'appartient pas a cette surface ; c'est un manque connu.
--
-- Refus : feature_disabled, not_authenticated, match_not_found,
--         tournament_not_found, not_the_organizer, already_validated,
--         tournament_not_started, bye_match, not_confirmed, forfeited_match.
-- Appelable par : l'ORGANISATEUR (tournaments.created_by) seul.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_reopen_match(p_match uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me      uuid := public.current_player_id();
  v_tid     uuid;
  v_t       public.tournaments%ROWTYPE;
  v_m       public.tournament_matches%ROWTYPE;
  v_deleted int;
  v_moves   int;
  v_entries int;
  v_rows    int;
BEGIN
  ---------------------------------------------------------------------------
  -- CONTROLES -- aucune ecriture avant la fin de cette section. Ici plus
  -- qu'ailleurs : les ecritures de cette fonction sont des SUPPRESSIONS.
  ---------------------------------------------------------------------------
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- ORDRE DES VERROUS : le tournoi d'abord. Cette premiere lecture du match
  -- est SANS verrou et ne sert qu'a savoir quelle ligne de tournoi verrouiller.
  SELECT m.tournament_id INTO v_tid
    FROM public.tournament_matches m WHERE m.id = p_match;
  IF v_tid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'match_not_found');
  END IF;

  SELECT * INTO v_t FROM public.tournaments WHERE id = v_tid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  IF v_t.created_by <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_the_organizer');
  END IF;
  -- CLASSEMENT_VALIDE : les points sont credites et le tournoi est entre dans
  -- « Mon parcours ». Les reprendre n'appartient pas a cette fonction.
  IF v_t.status = 'CLASSEMENT_VALIDE' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_validated');
  END IF;
  IF v_t.status NOT IN ('EN_COURS','TERMINE') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_started');
  END IF;

  SELECT * INTO v_m FROM public.tournament_matches WHERE id = p_match FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'match_not_found');
  END IF;
  IF v_m.team_a IS NULL OR v_m.team_b IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bye_match');
  END IF;
  IF v_m.confirmed_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_confirmed');
  END IF;
  IF v_m.forfeited_team IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forfeited_match');
  END IF;

  ---------------------------------------------------------------------------
  -- ECRITURES
  ---------------------------------------------------------------------------
  DELETE FROM public.tournament_matches
   WHERE tournament_id = v_tid
     AND round_no      > v_m.round_no;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  DELETE FROM public.tournament_movements
   WHERE tournament_id = v_tid
     AND round_no      > v_m.round_no;
  GET DIAGNOSTICS v_moves = ROW_COUNT;

  DELETE FROM public.tournament_match_entries
   WHERE match_id = p_match;
  GET DIAGNOSTICS v_entries = ROW_COUNT;

  -- NULL, et non 0-0 : la colonne est nullable et « NULL tant que personne n'a
  -- saisi » est ce que le schema dit. Un 0-0 ecrit ici serait un score a
  -- egalite sans `forfeited_team`, que la CHECK de la table refuse.
  UPDATE public.tournament_matches
     SET games_a        = NULL,
         games_b        = NULL,
         forfeited_team = NULL,
         confirmed_at   = NULL
   WHERE id = p_match;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'tournament_reopen_match: le match % a disparu sous le verrou',
      p_match;
  END IF;

  DELETE FROM public.tournament_results WHERE tournament_id = v_tid;

  UPDATE public.tournaments
     SET current_round = v_m.round_no,
         status        = 'EN_COURS',
         -- `tournament_close` pose `ends_at` et personne ne le defaisait :
         -- apres reouverture puis re-cloture, le tournoi gardait l'heure de la
         -- PREMIERE cloture, anterieure aux matchs rejoues. Le tournoi
         -- reprend, il n'a donc plus de fin.
         ends_at       = NULL
   WHERE id = v_tid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'tournament_reopen_match: le tournoi % a disparu sous le verrou',
      v_tid;
  END IF;

  RETURN jsonb_build_object('ok', true, 'round', v_m.round_no,
                            'deleted_matches', v_deleted,
                            'deleted_movements', v_moves,
                            'deleted_entries', v_entries);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_reopen_match(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_reopen_match(uuid) TO authenticated;

-- ############################################################################
-- SECTION CLASSEMENT, ROTATION DE CLASSEMENT, CLOTURE (Task 5)
--
-- Quatre fonctions, et la fin du tournoi :
--   * `tournament_standings`   -- le classement, provisoire ou borne ;
--   * `tournament_final_round` -- la rotation de CLASSEMENT (la derniere) ;
--   * `tournament_close`       -- fige `tournament_results`, statut TERMINE ;
--   * `tournament_validate`    -- statut CLASSEMENT_VALIDE, les points comptent.
--
-- LA HIERARCHIE DE CLASSEMENT, une fois pour toutes (spec §8, et
-- `standings()` de `lib/tournament.ts` qui en est le miroir) :
--
--     0. l'ABANDON               -- `withdrawn`, croissant : un binome qui a
--                                   quitte la soiree passe DERRIERE tous ceux
--                                   qui l'ont finie. ⚠️ CETTE CLE N'EXISTE QUE
--                                   DANS LE SQL : le moteur TypeScript ne la
--                                   connait pas encore (cf. l'avertissement
--                                   au-dessus de `tournament_standings`) ;
--     1. le PALIER atteint       -- le plus PETIT terrain jamais atteint,
--                                   croissant : le Terrain 1 est le meilleur ;
--     2. les VICTOIRES           -- decroissant ;
--     3. la DIFFERENCE de jeux   -- decroissant ;
--     4. les JEUX GAGNES         -- decroissant ;
--     5. la CONFRONTATION DIRECTE agregee -- decroissant ;
--     6. l'identifiant           -- croissant, pour que l'ordre soit TOTAL.
--
-- Le palier prime sur tout le reste : un binome qui s'est maintenu en haut
-- devance un binome qui a accumule des jeux en bas. C'est le sens meme du
-- format.
--
-- ⚠️ L'ABANDON PASSE AVANT LE PALIER, et c'est la seule cle au-dessus de lui.
-- Un binome parti garde `best_court` -- le meilleur palier de son passage --
-- donc un tres bon rang s'il est parti de haut : sans cette cle, il devancait
-- des binomes qui ont joue toute la soiree, a l'ecran ET a la remise des
-- points. Il DESCEND donc en bas du classement IMMEDIATEMENT, pendant la
-- soiree, a l'ecran que tout le monde regarde -- pas seulement a la cloture.
-- C'est ce qui garde UNE SEULE source de verite : le classement affiche
-- pendant la soiree et le classement fige a la cloture rangent les binomes
-- partis au meme endroit -- en bas. Un binome parti n'occupe donc jamais un
-- creneau de la rotation de classement, meme s'il figure encore dans son
-- tableau : `fn_tournament_final_slots` l'ecarte, et il retombe ici.
--
-- LE SENS DU PALIER. Le Terrain 1 est le MEILLEUR, donc le palier d'un binome
-- est le MINIMUM des terrains ou il a joue, et il se trie CROISSANT. La
-- version precedente de cette fonction prenait un `max(court_no)` trie DESC --
-- juste sous la convention abandonnee, faux depuis le redressement des paliers
-- -- et placait le binome qui gagne tout DERRIERE celui qui perd tout.
--
-- LA SENTINELLE. Un binome qui n'a joue AUCUN match reel dans la borne n'a pas
-- de palier : `min()` rend NULL, et le tri le renvoie EN DERNIER
-- (`NULLS LAST`). Le moteur TypeScript ecrit `bestCourt = Infinity` pour la
-- meme raison exactement. Un `COALESCE(..., 0)` le mettrait PREMIER.
--
-- LES VICTOIRES PASSENT PAR `fn_tournament_a_won`. Un forfait s'ecrit 0-0 des
-- deux cotes : re-deduire le vainqueur des jeux crediterait la victoire au
-- camp B a tous les coups, forfaitaire compris. Le marqueur `forfeited_team`
-- est la seule verite, et il n'est lu qu'a un seul endroit de ce fichier.
--
-- L'INVARIANT DE LECTURE DE `tournament_teams` (en-tete du fichier) vaut ICI
-- AUSSI : deux joueurs en liste d'attente peuvent former un binome, dont la
-- ligne est indiscernable de celle d'un binome assis. Le classement joint donc
-- `tournament_registrations` et exige `waitlist_position IS NULL` sur les DEUX
-- joueurs. Il ne peut PAS passer par `fn_tournament_seated_teams`, qui exclut
-- en plus les `withdrawn`, que le classement doit GARDER : un binome qui a
-- declare forfait en cours de soiree reste au classement avec les matchs qu'il
-- a joues (le moteur part de `teams`, pas des matchs, et le faire disparaitre
-- serait mentir sur la soiree).
-- ############################################################################

-- ============================================================================
-- tournament_standings(p_tournament, p_max_round DEFAULT NULL) RETURNS jsonb
--
-- Le classement. Port de `standings()` de `lib/tournament.ts` -- port
-- DELIBERE, pas un appel : le SQL fait autorite, le TypeScript est le miroir
-- d'affichage, et le test de parite de la Task 6 interdit la divergence.
--
-- ⚠️ `withdrawn` EST LA PREMIERE CLE DE TRI, ET LE MOTEUR LA PARTAGE. Ce bloc
-- a longtemps annonce une divergence VOULUE : le moteur declarait
-- `TeamState.withdrawn` sans jamais le consulter, et triait donc un binome
-- parti au milieu des autres, sur le palier qu'il avait atteint avant de s'en
-- aller. LA TACHE 6 A FAIT L'ALIGNEMENT, dans ce sens-la et pas l'autre :
-- `standings()` (`lib/tournament.ts:210`) lit desormais le champ
-- (`lib/tournament.ts:216`) et le trie en tete (`lib/tournament.ts:264`),
-- exactement comme le `row_number()` ci-dessous. La cle entre aussi dans le
-- `dense_rank()` du GROUPE d'ex aequo des deux cotes : un binome parti et un
-- binome present ne partagent jamais un groupe, meme a statistiques
-- identiques.
--
-- CE QUI INTERDIT DESORMAIS LA DIVERGENCE, c'est
-- `lib/__tests__/tournamentParite.test.ts` : un corpus fige de 8 binomes sur
-- 6 rotations, dont les valeurs attendues sont celles de CETTE fonction, et
-- ou un binome parti a la MEILLEURE difference de jeux de la soiree au
-- MEILLEUR palier -- sans cette cle il serait premier, il est septieme. Si le
-- moteur reperd la cle, ce test tombe. LE SQL RESTE L'AUTORITE : on ne
-- « corrige » jamais ce fichier vers le TypeScript, on ramene le TypeScript
-- ici, et on met le corpus a jour.
--
--   * UNE LIGNE PAR BINOME ASSIS, forfaits (`withdrawn`) COMPRIS ; un binome
--     sans aucun match dans la borne y figure avec des compteurs a zero. Le
--     classement ne fait jamais disparaitre personne ;
--   * seuls les matchs CONFIRMES et A DEUX BINOMES comptent. Un bye n'est ni
--     une victoire ni une defaite, ne rapporte aucun jeu, ne compte pas comme
--     match joue et ne pose aucun palier : personne ne peut le confirmer ;
--   * la CONFRONTATION DIRECTE est un SCALAIRE, pas un comparateur : pour
--     chaque binome, les jeux pris aux AUTRES binomes de son groupe d'ex aequo
--     moins ceux qu'il leur a concedes, sur TOUTES leurs rencontres. Un
--     comparateur deux a deux coincide sur un groupe de DEUX mais laisse un
--     CYCLE des trois (m bat n, n bat a, a bat m) : ce n'est plus un ordre
--     total, et SQL et TypeScript rendraient alors deux classements differents
--     sur la meme soiree. Le scalaire est transitif par construction ;
--   * le GROUPE d'ex aequo porte sur les CINQ cles qui precedent la
--     confrontation -- abandon, palier, victoires, difference, jeux gagnes --
--     et pas une de moins : un groupe trop large ferait entrer dans l'agregat
--     des matchs sans rapport avec le duel reellement lie, et pourrait
--     inverser l'ordre des deux binomes concernes.
--
-- `p_max_round` BORNE le calcul aux tours <= a cette valeur ; NULL (le defaut)
-- compte tous les matchs confirmes. IL NE SUPPRIME JAMAIS DE LIGNE : un binome
-- dont tous les matchs sont au-dela de la borne reste au classement, a zero.
-- C'est le pendant exact du parametre `maxRound` du moteur, et c'est ce que
-- `tournament_close` lui passe (le dernier tour COMPLET).
--
-- Forme renvoyee :
--   {ok:true, standings:[{team_id, player1_id, player2_id, withdrawn, played,
--                         wins, losses, games_won, games_lost, games_avg,
--                         diff, best_court, h2h, rank}, ...]}
--
-- La cle `highest_court` de la version precedente DISPARAIT, elle ne se
-- renomme pas : elle portait le terrain le plus HAUT en numero, c'est-a-dire
-- le PIRE. `best_court` porte l'inverse, et vaut `null` pour un binome qui n'a
-- jamais joue. Aucun ecran ne lit encore l'une ou l'autre (Tasks 6 et 8).
--
-- Refus : feature_disabled, tournament_not_found.
-- Appelable par : tout joueur connecte -- un tournoi est un evenement public,
-- et cette fonction ne fait que LIRE.
-- ============================================================================
-- Ajouter un parametre CHANGE la signature : Postgres creerait une SURCHARGE
-- au lieu de remplacer. On supprime explicitement l'ancienne signature.
DROP FUNCTION IF EXISTS public.tournament_standings(uuid);

CREATE OR REPLACE FUNCTION public.tournament_standings(
  p_tournament uuid,
  p_max_round  int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tournaments WHERE id = p_tournament) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;

  WITH assis AS (
    -- L'invariant de lecture de `tournament_teams`, ecrit ici plutot que pris
    -- a `fn_tournament_seated_teams`, qui filtre en plus les `withdrawn` --
    -- que le classement doit garder.
    SELECT tt.id AS team_id, tt.player1_id, tt.player2_id, tt.withdrawn
      FROM public.tournament_teams tt
      JOIN public.tournament_registrations r1
        ON r1.tournament_id = tt.tournament_id AND r1.player_id = tt.player1_id
      JOIN public.tournament_registrations r2
        ON r2.tournament_id = tt.tournament_id AND r2.player_id = tt.player2_id
     WHERE tt.tournament_id      = p_tournament
       AND r1.waitlist_position IS NULL
       AND r2.waitlist_position IS NULL
  ),
  pm AS (
    SELECT m.team_a, m.team_b, m.games_a, m.games_b, m.court_no,
           public.fn_tournament_a_won(m.forfeited_team, m.team_a,
                                      m.games_a, m.games_b) AS a_won
      FROM public.tournament_matches m
     WHERE m.tournament_id = p_tournament
       AND m.confirmed_at IS NOT NULL
       AND m.team_a       IS NOT NULL
       AND m.team_b       IS NOT NULL
       AND (p_max_round IS NULL OR m.round_no <= p_max_round)
  ),
  per_team AS (
    SELECT p.team_a AS team_id, p.games_a AS gw, p.games_b AS gl, p.court_no,
           CASE WHEN p.a_won THEN 1 ELSE 0 END AS win
      FROM pm p
    UNION ALL
    SELECT p.team_b,            p.games_b,      p.games_a,      p.court_no,
           CASE WHEN p.a_won THEN 0 ELSE 1 END
      FROM pm p
  ),
  agg AS (
    SELECT t.team_id, t.player1_id, t.player2_id, t.withdrawn,
           count(pt.team_id)::int          AS played,
           COALESCE(sum(pt.win),  0)::int  AS wins,
           COALESCE(sum(pt.gw),   0)::int  AS games_won,
           COALESCE(sum(pt.gl),   0)::int  AS games_lost,
           -- La sentinelle : NULL, pas 0. Aucun match reel = aucun palier.
           min(pt.court_no)::int           AS best_court
      FROM assis t
      LEFT JOIN per_team pt ON pt.team_id = t.team_id
     GROUP BY t.team_id, t.player1_id, t.player2_id, t.withdrawn
  ),
  scored AS (
    SELECT a.*, (a.played - a.wins) AS losses, (a.games_won - a.games_lost) AS diff
      FROM agg a
  ),
  grp AS (
    -- Le groupe d'ex aequo : exactement les binomes que les cles precedant la
    -- confrontation directe n'ont pas departages -- `withdrawn` COMPRIS, qui
    -- est desormais la premiere. Un binome parti et un binome present ne sont
    -- donc JAMAIS dans le meme groupe, meme a statistiques identiques : leur
    -- eventuelle rencontre n'a plus a les departager, l'abandon l'a fait.
    -- `dense_rank()` traite les NULL comme pairs, donc les binomes sans palier
    -- se groupent entre eux -- comme le moteur, ou `Infinity` est une valeur
    -- comme une autre.
    SELECT s.*,
           dense_rank() OVER (ORDER BY s.withdrawn  ASC,
                                       s.best_court ASC NULLS LAST,
                                       s.wins       DESC,
                                       s.diff       DESC,
                                       s.games_won  DESC) AS tie_grp
      FROM scored s
  ),
  h2h_agg AS (
    -- Somme sur TOUTES les rencontres internes au groupe. Un match donne ne
    -- s'apparie qu'a un seul `y` (son adversaire), donc rien n'est compte deux
    -- fois ; un binome seul dans son groupe n'a aucun `y`, donc 0.
    SELECT x.team_id,
           COALESCE(sum(CASE WHEN p.team_a = x.team_id THEN p.games_a - p.games_b
                             ELSE                           p.games_b - p.games_a END), 0)::int AS h2h
      FROM grp x
      LEFT JOIN grp y ON y.tie_grp = x.tie_grp AND y.team_id <> x.team_id
      LEFT JOIN pm  p ON (p.team_a = x.team_id AND p.team_b = y.team_id)
                      OR (p.team_b = x.team_id AND p.team_a = y.team_id)
     GROUP BY x.team_id
  ),
  final AS (
    SELECT g.*, h.h2h,
           row_number() OVER (ORDER BY g.withdrawn  ASC,
                                       g.best_court ASC NULLS LAST,
                                       g.wins       DESC,
                                       g.diff       DESC,
                                       g.games_won  DESC,
                                       h.h2h        DESC,
                                       g.team_id    ASC)::int AS rank
      FROM grp g JOIN h2h_agg h ON h.team_id = g.team_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'team_id',     f.team_id,
           'player1_id',  f.player1_id,
           'player2_id',  f.player2_id,
           'withdrawn',   f.withdrawn,
           'played',      f.played,
           'wins',        f.wins,
           'losses',      f.losses,
           'games_won',   f.games_won,
           'games_lost',  f.games_lost,
           -- Moyenne de jeux gagnes par match joue. EXPOSEE POUR L'AFFICHAGE,
           -- JAMAIS UTILISEE AU TRI : le classement se fait au TOTAL, des deux
           -- cotes. Une moyenne recompenserait un binome qui abandonne apres
           -- deux beaux matchs, et le cas qui la motivait -- la soiree qui
           -- deborde -- est regle a la source par `tournament_close`, qui
           -- cloture au dernier tour COMPLET.
           'games_avg',   CASE WHEN f.played > 0
                               THEN round(f.games_won::numeric / f.played, 3)
                               ELSE 0 END,
           'diff',        f.diff,
           'best_court',  f.best_court,
           'h2h',         f.h2h,
           'rank',        f.rank
         ) ORDER BY f.rank), '[]'::jsonb)
    INTO v_out
    FROM final f;

  RETURN jsonb_build_object('ok', true, 'standings', v_out,
                            'max_round', p_max_round);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_standings(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_standings(uuid, int) TO authenticated;

-- ----------------------------------------------------------------------------
-- Helper interne : LE CLASSEMENT FINAL, CRENEAU PAR CRENEAU.
--
-- UNE SEULE REGLE, UN SEUL ENDROIT. Deux fonctions ont besoin du meme calcul :
-- `tournament_close`, pour ecrire le rang de chacun, et
-- `tournament_final_round`, pour annoncer a l'ecran l'enjeu de chaque terrain.
-- Elles le faisaient chacune de leur cote, et elles ont diverge des que la
-- renumerotation contigue est apparue : la cloture ecrivait 2 et 3 la ou
-- l'ecran avait promis 3 et 4. Le creneau brut `(terrain-1)*2+1` N'EST PLUS le
-- rang final -- il ne l'est que quand tous les terrains portent un match.
--
-- CE QU'ELLE REND, une ligne par place a distribuer :
--   * `court_no`   : le terrain d'ou vient le creneau, NULL pour un non-place ;
--   * `role`       : 'winner' | 'loser' (terrain a match), 'bye' (terrain a bye
--                    SEUL), 'unplaced' (binome que le tour ne place pas) ;
--   * `team_id`    : le binome, des qu'il est connu. NULL pour 'winner' et
--                    'loser' tant que le match n'est pas acquis -- c'est l'etat
--                    normal a la GENERATION du tour, ou l'enjeu est connu mais
--                    pas le vainqueur. La cloture, elle, n'appelle cette
--                    fonction que sur un tour COMPLET : aucun NULL n'y survit ;
--   * `final_rank` : le rang CONTIGU, de 1 a N.
--
-- LA RENUMEROTATION CONTIGUE. Les creneaux bruts ont des trous (un terrain a
-- bye n'en remplit qu'un) et il y en a deux par terrain meme quand il reste
-- moins de deux binomes par terrain. Un bareme qui va du rang 1 au rang 8 ne
-- peut pas sauter le rang 4 : ces points-la ne seraient jamais attribues, et
-- tous les rangs suivants recevraient moins que leur du. Les creneaux bruts ne
-- servent donc qu'a ORDONNER ; le rang se COMPTE.
--
-- CE QUI DEPEND DU RESULTAT, ET CE QUI N'EN DEPEND PAS. Le rang attache a un
-- creneau ne depend que de la FORME du tour -- quels terrains portent un
-- match, lesquels un bye, combien de binomes ne sont pas places. Seul le NOM
-- du binome qui prend ce rang depend du resultat. C'est ce qui permet a la
-- meme fonction de servir avant et apres les matchs.
--
--   `p_max_round`   : la borne du classement provisoire, qui ordonne les
--                     non-places entre eux (le dernier tour COMPLET).
--   `p_final_round` : le tour de CLASSEMENT dont on lit les creneaux. NULL =
--                     il n'y en a pas eu : personne n'est place, tout le monde
--                     passe par le classement provisoire, et le rang final est
--                     le rang provisoire. Le cas se traite tout seul, sans
--                     branche.
--
-- L'ordre relatif des non-places est STABLE EN PRATIQUE entre la generation du
-- tour et la cloture -- ils n'y jouent aucun match, donc ni leurs jeux, ni
-- leurs victoires, ni leur palier ne changent -- mais PAS garanti, et la
-- premiere version de ce commentaire l'affirmait a tort. La confrontation
-- directe n'est pas une statistique PERSONNELLE : elle se calcule sur le
-- groupe d'ex aequo, et un binome PLACE, lui, change de statistiques au
-- dernier tour. Trois binomes a egalite, A et B non places, C place : a la
-- borne `v_round - 1`, A a battu C et B a perdu contre C, donc A devant B ; a
-- la borne `v_round`, la victoire de C le sort du groupe, A et B tombent tous
-- deux a `h2h = 0` et se departagent par `team_id` -- l'ordre peut s'inverser.
-- Sans effet visible aujourd'hui : les rangs des non-places ne sont annonces
-- nulle part avant la cloture, seule leur ABSENCE de creneau l'est.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_tournament_final_slots(
  p_tournament  uuid,
  p_max_round   int,
  p_final_round int DEFAULT NULL
)
RETURNS TABLE (court_no int, role text, team_id uuid, final_rank int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_standings jsonb;
BEGIN
  -- ⚠️ `tournament_standings` PEUT REFUSER (`{ok:false, reason:...}`), et ce
  -- helper est le SEUL endroit du fichier ou un tel refus n'etait pas
  -- propage : un `COALESCE(... -> 'standings', '[]')` muet le remplacait par
  -- un tableau vide, et l'exclusion des binomes partis disparaissait en
  -- silence -- les creneaux bruts sortaient tels quels. En pratique
  -- inatteignable (les deux appelants, `tournament_close` et
  -- `tournament_final_round`, ont deja verifie `fn_tournaments_enabled()` et
  -- l'existence du tournoi avant d'arriver ici), mais un garde qui masque ce
  -- qu'il detecte est pire qu'aucun garde : on LEVE plutot que d'inventer un
  -- classement vide.
  v_standings := public.tournament_standings(p_tournament, p_max_round);
  IF NOT COALESCE((v_standings->>'ok')::boolean, false) THEN
    RAISE EXCEPTION
      'fn_tournament_final_slots: tournament_standings a refuse (%) pour le tournoi %',
      v_standings->>'reason', p_tournament;
  END IF;

  RETURN QUERY
  WITH st AS (
    SELECT (e->>'team_id')::uuid       AS s_team,
           (e->>'rank')::int           AS prov_rank,
           (e->>'withdrawn')::boolean  AS s_withdrawn
      FROM jsonb_array_elements(COALESCE(v_standings -> 'standings', '[]'::jsonb)) AS e
  ),
  fr AS (
    -- Les lignes du tour de classement. Sur un palier qui porte un match ET un
    -- bye (trois equipes, ce que le format autorise apres un forfait),
    -- `pref = 1` retient le MATCH : c'est lui qui dispute les deux creneaux du
    -- terrain. Le binome du bye ne dispute AUCUNE place et repart en
    -- 'unplaced'.
    SELECT m.court_no, m.team_a, m.team_b, m.confirmed_at,
           public.fn_tournament_a_won(m.forfeited_team, m.team_a,
                                      m.games_a, m.games_b) AS a_won,
           row_number() OVER (PARTITION BY m.court_no
                              ORDER BY (m.team_b IS NOT NULL) DESC) AS pref
      FROM public.tournament_matches m
     WHERE p_final_round IS NOT NULL
       AND m.tournament_id = p_tournament
       AND m.round_no      = p_final_round
  ),
  bruts AS (
    SELECT f.court_no, 'winner'::text AS role,
           CASE WHEN f.confirmed_at IS NULL THEN NULL
                WHEN f.a_won             THEN f.team_a
                ELSE                          f.team_b END AS team_id,
           ((f.court_no - 1) * 2 + 1)::int AS slot
      FROM fr f WHERE f.pref = 1 AND f.team_b IS NOT NULL
    UNION ALL
    SELECT f.court_no, 'loser',
           CASE WHEN f.confirmed_at IS NULL THEN NULL
                WHEN f.a_won             THEN f.team_b
                ELSE                          f.team_a END,
           ((f.court_no - 1) * 2 + 2)::int
      FROM fr f WHERE f.pref = 1 AND f.team_b IS NOT NULL
    UNION ALL
    -- Un bye SEUL sur son palier dispute bien une place : la meilleure des
    -- deux du terrain. L'autre creneau reste vacant, et la renumerotation le
    -- refermera.
    SELECT f.court_no, 'bye', f.team_a, ((f.court_no - 1) * 2 + 1)::int
      FROM fr f WHERE f.pref = 1 AND f.team_b IS NULL AND f.team_a IS NOT NULL
  ),
  places AS (
    -- ⚠️ UN BINOME PARTI N'OCCUPE JAMAIS UN CRENEAU. Un forfait prononce APRES
    -- la generation de la rotation de classement laisse le binome dans le
    -- tableau du tour : `tournament_forfeit` solde son match (`forfeited_team`)
    -- et `fn_tournament_a_won` le declare perdant -- il prendrait donc le
    -- creneau PERDANT de son terrain, c'est-a-dire le rang 2 sur 8 s'il etait
    -- au Terrain 1, alors que l'ecran l'a montre DERNIER toute la soiree
    -- (`withdrawn` est la premiere cle du classement). Il repart donc dans les
    -- non-places, ou `prov_rank` le met en bas, quel que soit le tour ou il est
    -- parti. Son creneau devient vacant et la renumerotation le referme ; le
    -- creneau du VAINQUEUR de ce match n'est pas touche.
    --
    -- `team_id` NULL (match pas encore acquis, cas normal a la generation)
    -- traverse : on ne sait pas encore qui prendra la place, et il n'y a rien
    -- a exclure.
    SELECT b.court_no, b.role, b.team_id, b.slot
      FROM bruts b
      LEFT JOIN st s ON s.s_team = b.team_id
     WHERE NOT COALESCE(s.s_withdrawn, false)
  ),
  engages AS (
    -- Les binomes que le tour PLACE, que le resultat soit connu ou non. C'est
    -- ce filtre -- et non `places.team_id` -- qui evite de compter deux fois un
    -- binome dont le match n'est pas encore acquis : il a son creneau, il n'est
    -- donc pas 'unplaced', meme si on ignore encore s'il sera gagnant.
    -- Les binomes PARTIS en sont exclus, exactement comme ci-dessus : leur
    -- creneau n'existe pas, donc ils doivent tomber dans les non-places.
    SELECT z.e_team FROM (
      SELECT f.team_a AS e_team FROM fr f WHERE f.pref = 1 AND f.team_b IS NOT NULL
      UNION ALL
      SELECT f.team_b            FROM fr f WHERE f.pref = 1 AND f.team_b IS NOT NULL
      UNION ALL
      SELECT f.team_a            FROM fr f
       WHERE f.pref = 1 AND f.team_b IS NULL AND f.team_a IS NOT NULL
    ) z
     WHERE NOT EXISTS (SELECT 1 FROM st s
                        WHERE s.s_team = z.e_team AND s.s_withdrawn)
  ),
  plafond AS (
    -- Le plus grand creneau attribue : le PLANCHER de tout ce qui suit. Aucun
    -- binome non place ne passe devant un binome que le tour a departage sur le
    -- terrain -- un terrain reduit a un bye libere un creneau BAS, et c'est
    -- exactement la forme d'echelle que produit un forfait.
    SELECT COALESCE(max(p.slot), 0)::int AS top FROM places p
  ),
  reste AS (
    -- Les non-places, dans l'ordre du classement provisoire. Celui-ci trie
    -- deja les binomes partis (`withdrawn`) en DERNIER, sur sa premiere cle :
    -- inutile de le refaire ici, et le refaire serait une deuxieme regle a
    -- garder synchronisee de la premiere.
    SELECT NULL::int AS court_no, 'unplaced'::text AS role, s.s_team AS team_id,
           ((SELECT top FROM plafond)
             + row_number() OVER (ORDER BY s.prov_rank))::int AS slot
      FROM st s
     WHERE NOT EXISTS (SELECT 1 FROM engages g WHERE g.e_team = s.s_team)
  ),
  attribue AS (
    SELECT p.court_no, p.role, p.team_id, p.slot FROM places p
    UNION ALL
    SELECT r.court_no, r.role, r.team_id, r.slot FROM reste r
  )
  SELECT a.court_no, a.role, a.team_id,
         row_number() OVER (ORDER BY a.slot)::int
    FROM attribue a;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_tournament_final_slots(uuid, int, int) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- tournament_final_round(p_tournament)
--
-- LA ROTATION DE CLASSEMENT -- la derniere du tournoi (spec §9). Apres
-- l'avant-derniere rotation, les mouvements sont faits une derniere fois et
-- LES POSITIONS SONT FIGEES : la derniere rotation ne fait plus monter ni
-- descendre, elle CLASSE. Chaque terrain y joue pour DEUX PLACES :
--
--     Terrain 1 -> places 1 et 2      Terrain 3 -> places 5 et 6
--     Terrain 2 -> places 3 et 4      Terrain 4 -> places 7 et 8
--
--   place du gagnant = (terrain - 1) * 2 + 1
--   place du perdant = (terrain - 1) * 2 + 2
--
-- Ce sont des CRENEAUX FIXES par terrain, pas un compteur qui avance au fil
-- des resultats : un terrain sans adversaire (bye) ne decale jamais les places
-- des terrains suivants, il laisse seulement son propre creneau de perdant
-- vacant.
--
-- ⚠️ MAIS LE CRENEAU N'EST PAS LE RANG. Les creneaux vacants sont REFERMES par
-- une renumerotation contigue 1..N (`fn_tournament_final_slots`) : un bareme
-- qui va du rang 1 au rang 8 ne peut pas sauter le rang 4, ces points ne
-- seraient jamais attribues et tous les rangs suivants recevraient moins que
-- leur du. Sur une echelle ou le Terrain 1 ne porte qu'un bye, le Terrain 2 ne
-- joue donc PAS pour les places 3 et 4, mais pour les places 2 et 3.
--
-- ⚠️ LE MOTEUR SUIT CETTE REGLE DEPUIS LA TACHE 6. Ce bloc a longtemps
-- annonce une divergence : `finalRanking()` rendait les creneaux BRUTS et son
-- test affirmait `[1,2,3,5,6,7,8]`, avec un commentaire disant que le rang 4
-- n'etait pas recycle. C'etait la regle d'avant, et elle etait fausse.
-- `finalRanking()` (`lib/tournament.ts:328`) est desormais un port de
-- `fn_tournament_final_slots`, CTE par CTE : elle renumerote de facon contigue
-- (`lib/tournament.ts:389`), ecarte des creneaux les binomes partis
-- (`lib/tournament.ts:351`), et laisse le MATCH prendre les deux creneaux d'un
-- palier a trois. Le test qui affirmait les creneaux bruts a ete reecrit.
--
-- CE QUI INTERDIT DESORMAIS LA DIVERGENCE, c'est
-- `lib/__tests__/tournamentParite.test.ts`, dont le corpus produit justement
-- une echelle a creneaux troues -- deux terrains reduits a un bye, un palier a
-- trois, un binome parti dans le tableau du dernier tour -- et compare le
-- resultat aux rangs que CETTE fonction calcule. Ne pas « corriger » ce
-- fichier vers le TypeScript : c'est le TypeScript qu'on ramene ici.
--
-- C'est `tournament_close` qui ECRIT ces rangs, et cette fonction qui les
-- ANNONCE -- toutes deux par le MEME helper, pour que le CALCUL ne puisse plus
-- diverger entre les deux.
--
-- ⚠️ CE QUE CETTE PARITE NE GARANTIT PAS : que l'enjeu annonce ICI soit encore
-- exact au moment ou `tournament_close` s'execute. Entre les deux, un binome
-- peut partir (`tournament_forfeit`) -- et un forfait prononce APRES cette
-- annonce retire ce binome de son creneau (cf. le commentaire de
-- `fn_tournament_final_slots`), ce qui DECALE les rangs de tous les binomes
-- qui le suivaient. Ce decalage est VOULU, et TOUJOURS FAVORABLE : personne ne
-- recoit pire que le rang promis ici, sauf le partant lui-meme -- qui tombe en
-- bas, ce qui est precisement le correctif que ce comportement existe pour
-- produire. Ce tour n'est jamais REANNONCE ici apres un forfait -- cette
-- fonction ne s'execute qu'une fois, a la generation.
--
-- ⚠️ Task 13 : `tournament_final_stakes(p_tournament)`, plus bas dans ce
-- fichier, EXPOSE DESORMAIS `stakes` EN LECTURE DURABLE -- c'est elle que les
-- ecrans consomment, jamais `stakes` capture dans CETTE reponse-ci. Elle
-- n'A PAS le probleme de peremption decrit ci-dessus : parce qu'elle relit
-- `fn_tournament_final_slots` (donc `tournament_standings`, donc `withdrawn`)
-- A CHAQUE APPEL plutot que de rejouer une capture figee, un forfait
-- prononce apres la generation de la rotation de classement s'y reflete
-- IMMEDIATEMENT -- exactement l'inverse d'une valeur perimee.
--
-- ELLE N'APPARIE PAS ELLE-MEME. L'appariement d'un tour a UN seul domicile
-- dans ce fichier -- `tournament_generate_round` -- et le dupliquer ici serait
-- se donner deux endroits ou l'appariement peut etre faux, dont un que
-- personne ne relirait. Elle l'appelle donc, avec `p_final_round => true` :
-- c'est le SEUL appel qui passe ce drapeau, et `tournament_generate_round`
-- refuse la derniere rotation a tous les autres (`not_the_final_round`). Un
-- seul appariement, un seul chemin vers la rotation de classement.
--
-- La rotation de classement se TIRE exactement comme les autres : les binomes
-- entrent sur le palier ou les resultats de la rotation precedente les ont
-- laisses, et s'y rencontrent. Ce qui la distingue n'est pas son tirage, c'est
-- ce qu'on en FAIT ensuite -- aucun tour apres elle, et un classement lu aux
-- creneaux.
--
-- CE QU'ELLE AJOUTE A `tournament_generate_round`, et qui justifie qu'elle
-- existe :
--   1. elle REFUSE de tirer autre chose que la DERNIERE rotation
--      (`not_yet_the_final_round`) -- l'organisateur qui appelle « rotation de
--      classement » au tour 3 recoit un refus nomme, pas un tour 3 ordinaire ;
--   2. elle rend l'ENJEU de chaque terrain (`stakes`), pour que l'ecran puisse
--      afficher « Terrain 2 : places 3 et 4 » sans recalculer la regle de son
--      cote.
--
-- LA SOIREE QUI DEBORDE N'EST PAS SON PROBLEME. Si la rotation de classement
-- n'a pas lieu -- terrain repris, binome parti, il est tard -- il n'y a rien a
-- faire ici : `tournament_close` cloture alors sur le classement provisoire de
-- la derniere rotation COMPLETE, et les points sont attribues normalement
-- (spec §9). Raccourcir le tournoi pour avancer la rotation de classement
-- reviendrait a ecrire `round_count`, donc a changer la forme du tournoi en
-- cours de soiree : ce n'est pas demande, et ce n'est pas fait.
--
-- Refus : feature_disabled, not_authenticated, tournament_not_found,
--         not_the_organizer, tournament_not_started, tournament_over,
--         final_round_already_generated, not_yet_the_final_round -- plus ceux
--         de `tournament_generate_round`, rendus TELS QUELS (round_incomplete
--         avec sa liste `missing`, round_already_generated, not_enough_teams).
-- Appelable par : l'ORGANISATEUR (tournaments.created_by) seul.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_final_round(p_tournament uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me     uuid := public.current_player_id();
  v_t      public.tournaments%ROWTYPE;
  v_round  int;
  v_gen    jsonb;
  v_stakes jsonb;
BEGIN
  ---------------------------------------------------------------------------
  -- CONTROLES -- aucune ecriture avant la fin de cette section, et l'appel a
  -- `tournament_generate_round` en est une. Un refus renvoie {ok:false} SANS
  -- lever, donc sans rollback : un garde place apres l'appel laisserait
  -- derriere lui le tour qu'il vient d'annoncer refuse.
  ---------------------------------------------------------------------------
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- ORDRE DES VERROUS : la ligne `tournaments` d'abord. `tournament_generate_round`
  -- reprendra le meme verrou dans la MEME transaction, ce qui est re-entrant.
  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  IF v_t.created_by <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_the_organizer');
  END IF;
  IF v_t.status IN ('TERMINE','CLASSEMENT_VALIDE') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_over');
  END IF;
  IF v_t.status <> 'EN_COURS' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_started');
  END IF;

  -- La rotation de classement est la DERNIERE : celle qui porte le numero
  -- `round_count`. Deux refus distincts, parce qu'ils ne se corrigent pas de
  -- la meme facon : elle est deja tiree (il faut jouer, pas re-tirer), ou il
  -- reste des rotations ordinaires avant elle (il faut les jouer d'abord).
  IF EXISTS (SELECT 1 FROM public.tournament_matches m
              WHERE m.tournament_id = p_tournament
                AND m.round_no      = v_t.round_count) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'final_round_already_generated',
                              'round', v_t.round_count);
  END IF;

  v_round := v_t.current_round + 1;
  IF v_round <> v_t.round_count THEN
    -- Refus SYMETRIQUE de celui de `tournament_generate_round`, et nomme
    -- autrement a dessein : la, « ce tour EST le dernier, passe par moi » ;
    -- ici, « ce tour n'est PAS encore le dernier, passe par elle ». Le meme
    -- mot pour les deux sens ferait afficher un message a l'envers un jour
    -- sur deux.
    RETURN jsonb_build_object('ok', false, 'reason', 'not_yet_the_final_round',
                              'round', v_round,
                              'round_count', v_t.round_count,
                              'use', 'tournament_generate_round');
  END IF;

  ---------------------------------------------------------------------------
  -- ECRITURES -- entierement deleguees au MOTEUR (`fn_tournament_generate_round`,
  -- jamais a la facade `tournament_generate_round` : c'est elle qui refuserait
  -- `p_final_round => true` a tout appelant, cette fonction-ci comprise, si on
  -- l'appelait par erreur). Il refait ses propres controles (tour courant
  -- entierement acquis, palier a plus de trois equipes, etc.) : son refus est
  -- rendu TEL QUEL, avec sa liste `missing`, que l'ecran sait deja afficher.
  ---------------------------------------------------------------------------
  v_gen := public.fn_tournament_generate_round(p_tournament, true);
  IF NOT COALESCE((v_gen->>'ok')::boolean, false) THEN
    RETURN v_gen;
  END IF;

  -- L'enjeu de chaque terrain, LU AU MEME ENDROIT QUE LA CLOTURE
  -- (`fn_tournament_final_slots`). Le creneau brut `(terrain-1)*2+1` n'est PAS
  -- le rang final des qu'un terrain ne porte qu'un bye : l'annoncer ici ferait
  -- promettre « places 3 et 4 » a un terrain que la cloture classera 2e et 3e.
  -- La borne du classement provisoire est le tour PRECEDENT : le tour qu'on
  -- vient de tirer n'a evidemment aucun resultat.
  --
  -- Un bye qui PARTAGE son palier avec un match ne dispute aucune place : le
  -- helper ne lui donne ni 'bye' ni 'winner', donc `rank_win` reste NUL et
  -- l'ecran n'annonce rien -- au lieu de promettre a trois binomes deux places
  -- dont une deux fois.
  WITH slots AS (
    SELECT * FROM public.fn_tournament_final_slots(
                     p_tournament, v_round - 1, v_round)
  )
  SELECT jsonb_agg(jsonb_build_object(
           'match_id',  m.id,
           'court_no',  m.court_no,
           'team_a',    m.team_a,
           'team_b',    m.team_b,
           'rank_win',  w.final_rank,
           'rank_lose', l.final_rank
         ) ORDER BY m.court_no ASC, (m.team_b IS NULL) ASC)
    INTO v_stakes
    FROM public.tournament_matches m
    LEFT JOIN slots w ON w.court_no = m.court_no
                     AND w.role     = CASE WHEN m.team_b IS NULL THEN 'bye'
                                           ELSE 'winner' END
    LEFT JOIN slots l ON l.court_no = m.court_no
                     AND l.role     = 'loser'
                     AND m.team_b  IS NOT NULL
   WHERE m.tournament_id = p_tournament
     AND m.round_no      = v_round;

  RETURN v_gen || jsonb_build_object('final_round', true,
                                     'stakes', COALESCE(v_stakes, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_final_round(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_final_round(uuid) TO authenticated;

-- ============================================================================
-- tournament_final_stakes(p_tournament)
--
-- LECTURE DURABLE DE L'ENJEU DE LA ROTATION DE CLASSEMENT (Task 13). Le trou
-- trouvé en relecture de branche : `tournament_final_round` ci-dessus rend
-- `stakes` (l'enjeu de chaque terrain -- quel rang se joue en gagnant, en
-- perdant), mais UNIQUEMENT dans SA propre réponse, à l'ORGANISATEUR qui vient
-- de l'appeler. Rien ne les PERSISTE : perdus au premier rechargement d'écran,
-- et invisibles à tout joueur qui n'est pas l'organisateur au moment précis de
-- l'appel -- alors que c'est le moment le plus important de la soirée : « le
-- Terrain 2 joue les places 3 et 4 », tous les joueurs doivent pouvoir le
-- lire, pas seulement celui qui a tiré la rotation.
--
-- MÊME MOULE QUE `tournament_standings` : une LECTURE, ouverte à TOUT
-- authentifié -- aucun contrôle d'organisateur ici, l'enjeu d'une soirée
-- n'appartient à personne en particulier, contrairement au GESTE qui la tire.
--
-- UNE SEULE RÈGLE, UN SEUL ENDROIT : s'appuie sur `fn_tournament_final_slots`,
-- EXACTEMENT comme `tournament_final_round` s'appuie dessus pour construire son
-- propre `stakes` -- même CTE, même jointure, même mise en forme. Rien ici ne
-- recalcule un rang ; recalculer serait exactement le risque que l'appelant de
-- cette tâche a refusé de prendre côté client.
--
-- CE QUE `drawn` DIT. La rotation de classement n'a pas forcément été tirée --
-- tournoi qui n'en est pas encore là, ou qui ne l'atteindra jamais (soirée
-- écourtée, cf. l'en-tête de `tournament_final_round`, section « LA SOIRÉE QUI
-- DÉBORDE »). Ce n'est PAS un refus : interroger un tournoi qui n'en est pas
-- encore là est un usage tout à fait normal (l'écran organisateur à chaque
-- tour, la fiche d'un joueur avant la dernière rotation). `drawn:false` le dit
-- EXPLICITEMENT, avec `stakes:[]` -- pour qu'un écran ne confonde jamais
-- « pas encore tirée » avec « tirée, mais rien à annoncer ».
--
-- Refus : feature_disabled, tournament_not_found.
-- Appelable par : tout joueur authentifié (lecture seule, comme
-- `tournament_standings`).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_final_stakes(p_tournament uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t      public.tournaments%ROWTYPE;
  v_drawn  boolean;
  v_stakes jsonb;
BEGIN
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;

  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;

  -- La rotation de classement, si elle existe, porte TOUJOURS le numéro
  -- `round_count` (même définition que `tournament_final_round` ci-dessus).
  v_drawn := EXISTS (SELECT 1 FROM public.tournament_matches m
                       WHERE m.tournament_id = p_tournament
                         AND m.round_no      = v_t.round_count);
  IF NOT v_drawn THEN
    RETURN jsonb_build_object('ok', true, 'drawn', false,
                              'final_round', v_t.round_count, 'stakes', '[]'::jsonb);
  END IF;

  -- MÊME REQUÊTE que le bloc final de `tournament_final_round` : les créneaux
  -- du tour de classement déjà tiré, à la MÊME borne de classement provisoire
  -- (le tour qui le précède).
  WITH slots AS (
    SELECT * FROM public.fn_tournament_final_slots(
                     p_tournament, v_t.round_count - 1, v_t.round_count)
  )
  SELECT jsonb_agg(jsonb_build_object(
           'match_id',  m.id,
           'court_no',  m.court_no,
           'team_a',    m.team_a,
           'team_b',    m.team_b,
           'rank_win',  w.final_rank,
           'rank_lose', l.final_rank
         ) ORDER BY m.court_no ASC, (m.team_b IS NULL) ASC)
    INTO v_stakes
    FROM public.tournament_matches m
    LEFT JOIN slots w ON w.court_no = m.court_no
                     AND w.role     = CASE WHEN m.team_b IS NULL THEN 'bye'
                                           ELSE 'winner' END
    LEFT JOIN slots l ON l.court_no = m.court_no
                     AND l.role     = 'loser'
                     AND m.team_b  IS NOT NULL
   WHERE m.tournament_id = p_tournament
     AND m.round_no      = v_t.round_count;

  RETURN jsonb_build_object('ok', true, 'drawn', true, 'final_round', v_t.round_count,
                            'stakes', COALESCE(v_stakes, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_final_stakes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_final_stakes(uuid) TO authenticated;

-- ============================================================================
-- tournament_close(p_tournament)
--
-- LA CLOTURE. Elle fige le classement dans `tournament_results` -- UNE LIGNE
-- PAR JOUEUR, donc DEUX PAR BINOME, avec LES MEMES POINTS pour les deux
-- coequipiers -- applique `points_scale`, et passe le tournoi en TERMINE.
-- C'est cette table que lit « Mon parcours » ; tant que le tournoi tourne, le
-- classement se CALCULE et ne se stocke pas.
--
-- LES POINTS NE COMPTENT PAS ENCORE. La cloture les CALCULE et les ECRIT, mais
-- le tournoi n'entre dans « Mon parcours » qu'au passage en CLASSEMENT_VALIDE,
-- que seule `tournament_validate` prononce. C'est le dernier regard de
-- l'organisateur sur son classement, et il n'a de sens que si TERMINE ne
-- credite rien.
--
-- D'OU VIENT LE RANG FINAL -- les deux cas de la spec §9 :
--
--   1. LA ROTATION DE CLASSEMENT A EU LIEU (le tour `round_count` est tire ET
--      entierement acquis). Le rang vient de ses CRENEAUX FIXES : le gagnant
--      du terrain N prend (N-1)*2+1, son perdant (N-1)*2+2. Les statistiques
--      des rotations precedentes restent enregistrees mais NE LE REMPLACENT
--      PAS -- c'est la regle du format, et c'est ce qui fait que la derniere
--      rotation se joue vraiment.
--
--   2. ELLE N'A PAS EU LIEU -- soiree qui deborde, terrain repris, binome
--      parti. Le rang final est LE CLASSEMENT PROVISOIRE de la derniere
--      rotation COMPLETE -- exactement celui que l'ecran affiche, rang pour
--      rang, `withdrawn` en bas compris -- et les points sont attribues
--      NORMALEMENT. Un tournoi ecourte compte.
--
-- LES CRENEAUX VACANTS, ET CE QU'ON N'EN FAIT PAS. Un terrain qui n'a joue
-- qu'un bye ne remplit que son creneau de gagnant ; un terrain absent du tour
-- n'en remplit aucun ; et un binome PARTI n'en occupe jamais un, meme s'il
-- figure encore dans le tableau du tour (un forfait prononce apres la
-- generation solde son match, et il en ressortirait « perdant » donc classe
-- 2e sur 8 s'il etait au Terrain 1). Il retombe dans les non-places, donc en
-- bas -- la ou le classement affiche le montre depuis qu'il est parti.
--
-- Les binomes qui restent -- byes d'un palier a trois,
-- forfaits, binomes jamais places -- prennent des numeros STRICTEMENT
-- SUPERIEURS au plus grand creneau attribue, dans l'ordre du classement
-- provisoire.
--
-- LES ABANDONS PASSENT DERNIERS parmi ces non-places, mais ce n'est PAS ecrit
-- ici : `tournament_standings` trie deja `withdrawn` en PREMIERE cle, donc le
-- classement provisoire les met en bas de lui-meme. Une deuxieme regle a cet
-- endroit serait une deuxieme verite a garder synchronisee de la premiere --
-- et c'est exactement ce qui a fait diverger l'ecran de la cloture.
--
-- ⚠️ ILS NE COMBLENT PAS LES TROUS. La premiere version leur donnait les plus
-- petits numeros libres, et c'etait un defaut GRAVE : un terrain reduit a un
-- bye libere un creneau BAS, et c'est precisement la forme d'echelle qu'un
-- forfait produit. Un binome parti a la troisieme rotation, qui garde le
-- meilleur palier de son passage, ressortait 4e sur une echelle 2-1-3-1 et 2e
-- sur une echelle 1-2-2-2 -- devant les binomes qui ont joue ET GAGNE la
-- rotation de classement. La rotation de classement departage sur le terrain ;
-- personne ne passe devant son verdict.
--
-- Sur un palier qui porte a la fois un match et un bye -- trois equipes, ce
-- que le format autorise apres un forfait -- LE MATCH prend les deux creneaux
-- du terrain, et le binome du bye repart apres tous les creneaux. Il n'a
-- dispute aucune place ce tour-la.
--
-- LES RANGS SONT ENSUITE RENUMEROTES 1..N, l'ordre preserve. Les creneaux ont
-- des trous, et il y en a deux par terrain meme quand il reste moins de deux
-- binomes par terrain : un rang 8 sur un tournoi a six binomes se lirait comme
-- deux places manquantes, et `points_scale` distribuerait des points de bas de
-- tableau a personne. Personne ne sort du classement, deux binomes n'ont
-- jamais le meme rang -- sans quoi `points_scale` recompenserait deux fois la
-- meme place -- et le dernier rang est toujours le nombre de binomes.
--
-- ⚠️ TOUT CE QUI PRECEDE EST CALCULE PAR `fn_tournament_final_slots`, PAS ICI.
-- C'est le meme helper qui a annonce ces rangs a l'ecran au moment de tirer la
-- rotation de classement (`tournament_final_round.stakes`). Les deux
-- fonctions le calculaient chacune de son cote, et elles ont diverge des que
-- la renumerotation contigue est apparue : l'ecran promettait « places 3 et
-- 4 », la cloture ecrivait 2 et 3.
--
-- ON NE CLOTURE JAMAIS AU MILIEU D'UN TOUR. La cloture se fait au DERNIER TOUR
-- COMPLET : le classement est BORNE a ce tour, ce qui egalise les nombres de
-- matchs joues sans corriger apres coup par une moyenne. Meme definition, au
-- mot pres, que `lastCompleteRound()` cote TypeScript -- le PREMIER tour
-- incomplet moins un, ce qui reste juste meme si une reouverture a laisse un
-- trou plus haut.
--
-- BORNE, PAS SUPPRIME. Une version precedente effacait les matchs des tours
-- posterieurs. C'etait destructeur pour de vrai : `tournament_matches` est le
-- SEUL endroit ou un score existe -- `tournament_results` n'en garde que des
-- agregats, et `tournament_reopen_match` ne peut pas rouvrir une ligne
-- supprimee. Trois terrains sur quatre finissent le tour 3, la quatrieme paire
-- s'en va sans confirmer, l'organisateur cloture : six joueurs perdaient leur
-- score reel, sans retour possible. Les lignes restent donc en base ; seul le
-- CALCUL les ignore, via le plafond passe a `tournament_standings`.
--
-- `current_round` revient au dernier tour complet : c'est un marqueur de la ou
-- le classement a ete coupe, pas une destruction. Les matchs du tour entame
-- sont toujours la, lisibles, et rouvrables.
--
-- UNE SEULE SOURCE POUR LES CHIFFRES : `tournament_standings`, celle-la meme
-- que l'ecran affiche. Deux calculs, meme tres proches, finiraient par
-- diverger -- et le jour ou ils divergeraient, c'est le classement fige qui
-- aurait raison contre l'ecran que les joueurs ont vu toute la soiree.
--
-- Refus : feature_disabled, not_authenticated, tournament_not_found,
--         not_the_organizer, already_validated, already_finished,
--         tournament_not_started, no_complete_round, no_teams.
-- Appelable par : le createur du tournoi, et lui seul.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_close(p_tournament uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me      uuid := public.current_player_id();
  v_t       public.tournaments%ROWTYPE;
  v_st      jsonb;
  v_rows    int;
  v_lignes  int;      -- lignes ecrites dans tournament_results
  v_partiel int;      -- premier tour ou un match reel n'est pas confirme
  v_dernier int;      -- dernier tour COMPLET, sur lequel on cloture
  v_ignores int;      -- matchs laisses de cote par le plafond (jamais supprimes)
  v_final   boolean;  -- la rotation de classement a-t-elle eu lieu ?
  v_rank    jsonb;
BEGIN
  ---------------------------------------------------------------------------
  -- CONTROLES -- aucune ecriture avant la fin de cette section. Un refus
  -- renvoie {ok:false} SANS lever, donc sans rollback : un garde place apres
  -- une ecriture laisserait la ligne derriere lui.
  ---------------------------------------------------------------------------
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  IF v_t.created_by <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_the_organizer');
  END IF;
  -- CLASSEMENT_VALIDE : le classement est credite. Le defaire n'appartient pas
  -- a cette fonction (`tournament_reopen_match` est le chemin, et il refuse
  -- aussi un tournoi valide).
  IF v_t.status = 'CLASSEMENT_VALIDE' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_validated');
  END IF;
  IF v_t.status = 'TERMINE' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_finished');
  END IF;
  IF v_t.status <> 'EN_COURS' OR v_t.current_round < 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_started');
  END IF;

  -- Le dernier tour COMPLET. Un tour est complet quand tous ses matchs REELS
  -- sont confirmes ; les byes ne se confirment pas et n'entrent pas dans le
  -- controle. `tournament_generate_round` interdisant deja d'avancer sur un
  -- tour incomplet, seul le dernier tour peut etre partiel -- mais on prend le
  -- PREMIER tour incomplet plutot que le dernier, ce qui reste juste meme si
  -- une reouverture a laisse un trou plus haut.
  SELECT min(x.round_no) INTO v_partiel
    FROM public.tournament_matches x
   WHERE x.tournament_id = p_tournament
     AND x.team_b       IS NOT NULL
     AND x.confirmed_at IS NULL;

  v_dernier := COALESCE(v_partiel - 1, v_t.current_round);

  IF v_dernier < 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_complete_round');
  END IF;

  -- LA ROTATION DE CLASSEMENT A-T-ELLE EU LIEU ? Elle porte le numero
  -- `round_count` : elle a eu lieu si le dernier tour COMPLET est celui-la, et
  -- si elle porte effectivement des matchs. Une rotation de classement tiree
  -- mais inachevee ne compte pas -- `v_dernier` vaut alors `round_count - 1`
  -- et on retombe, sans rien de special a ecrire, sur le classement
  -- provisoire de la derniere rotation complete.
  v_final := (v_dernier = v_t.round_count)
             AND EXISTS (SELECT 1 FROM public.tournament_matches m
                          WHERE m.tournament_id = p_tournament
                            AND m.round_no      = v_t.round_count);

  -- Combien de matchs le plafond laisse de cote. On les COMPTE pour le dire a
  -- l'organisateur ; on ne les touche pas.
  SELECT count(*)::int INTO v_ignores
    FROM public.tournament_matches x
   WHERE x.tournament_id = p_tournament
     AND x.round_no      > v_dernier;

  v_st := public.tournament_standings(p_tournament, v_dernier);
  IF NOT COALESCE((v_st->>'ok')::boolean, false) THEN
    RETURN v_st;
  END IF;

  -- Un classement VIDE est une impasse, pas une cloture. L'INSERT n'ecrirait
  -- aucune ligne, le tournoi passerait quand meme TERMINE, et il n'en
  -- sortirait plus jamais : `tournament_validate` refuserait `no_results` pour
  -- toujours, et `tournament_reopen_match` exige un match confirme et non
  -- forfait pour rendre le tournoi a EN_COURS. On refuse AVANT d'ecrire.
  IF jsonb_array_length(COALESCE(v_st->'standings', '[]'::jsonb)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_teams');
  END IF;

  -- ETAT IMPOSSIBLE, PAS REFUS METIER : un creneau sans binome. `v_final`
  -- garantit que tous les matchs reels du tour de classement sont acquis, donc
  -- que le helper connait le nom de chaque gagnant et de chaque perdant. Si
  -- ca arrivait quand meme, il faut LEVER : ecarter la ligne en silence
  -- retirerait un rang du milieu de la suite 1..N -- le trou meme que la
  -- renumerotation existe pour empecher, et que `points_scale` traduirait en
  -- points jamais distribues. Un garde qui masque ce qu'il detecte est pire
  -- qu'aucun garde.
  IF EXISTS (SELECT 1
               FROM public.fn_tournament_final_slots(
                      p_tournament, v_dernier,
                      CASE WHEN v_final THEN v_dernier END) f
              WHERE f.team_id IS NULL) THEN
    -- Deux litteraux separes par un saut de ligne : SQL les concatene, ce qui
    -- garde la ligne lisible sans couper le message.
    RAISE EXCEPTION
      'tournament_close: creneau sans binome au tour % du tournoi %'
      ' -- un match de la rotation de classement n''est pas acquis',
      v_dernier, p_tournament;
  END IF;

  ---------------------------------------------------------------------------
  -- ECRITURES
  ---------------------------------------------------------------------------
  WITH st AS (
    SELECT (e->>'team_id')::uuid AS team_id,
           (e->>'played')::int     AS played,
           (e->>'wins')::int       AS wins,
           (e->>'games_won')::int  AS games_won,
           (e->>'games_lost')::int AS games_lost
      FROM jsonb_array_elements(v_st->'standings') AS e
  ),
  finale AS (
    -- LE RANG FINAL VIENT DU HELPER, pas d'un calcul local : c'est le meme que
    -- `tournament_final_round` a annonce a l'ecran. `p_final_round` vaut NULL
    -- quand la rotation de classement n'a pas eu lieu -- personne n'est alors
    -- place, et le rang final EST le rang provisoire, sans branche ici.
    --
    -- Aucun filtre sur `team_id` : un creneau sans binome a deja fait lever
    -- plus haut. Le filtrer ICI retirerait un rang du MILIEU de la suite
    -- 1..N -- exactement le trou que la renumerotation existe pour empecher,
    -- et que `points_scale` traduirait en points jamais distribues.
    SELECT f.team_id, f.final_rank
      FROM public.fn_tournament_final_slots(
             p_tournament, v_dernier,
             CASE WHEN v_final THEN v_dernier END) f
  )
  INSERT INTO public.tournament_results
    (tournament_id, team_id, player_id, final_rank, played, wins,
     games_won, games_lost, points)
  SELECT p_tournament,
         f.team_id,
         pl.player_id,
         f.final_rank,
         s.played,
         s.wins,
         s.games_won,
         s.games_lost,
         -- LES DEUX JOUEURS D'UN BINOME RECOIVENT LES MEMES POINTS : le rang
         -- appartient au binome, la ligne au joueur.
         public.fn_tournament_points(v_t.points_scale, f.final_rank)
    FROM finale f
    JOIN st s ON s.team_id = f.team_id
    JOIN public.tournament_teams tt ON tt.tournament_id = p_tournament
                                   AND tt.id            = f.team_id
    CROSS JOIN LATERAL unnest(ARRAY[tt.player1_id, tt.player2_id]) AS pl(player_id)
  ON CONFLICT (tournament_id, player_id) DO UPDATE
    SET team_id    = EXCLUDED.team_id,
        final_rank = EXCLUDED.final_rank,
        played     = EXCLUDED.played,
        wins       = EXCLUDED.wins,
        games_won  = EXCLUDED.games_won,
        games_lost = EXCLUDED.games_lost,
        points     = EXCLUDED.points;
  -- Zero ligne serait un mensonge : le classement rendu ok:true sans qu aucun
  -- resultat ne soit fige. On compte, et on le dit.
  GET DIAGNOSTICS v_lignes = ROW_COUNT;

  UPDATE public.tournaments
     SET status        = 'TERMINE',
         current_round = v_dernier,
         ends_at       = COALESCE(ends_at, now())
   WHERE id = p_tournament;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    -- La ligne est verrouillee et a ete lue plus haut : zero ligne est un etat
    -- impossible, pas un refus metier. On LEVE, ce qui annule tout.
    RAISE EXCEPTION 'tournament_close: le tournoi % a disparu sous le verrou',
      p_tournament;
  END IF;

  -- Le podium tel qu'il vient d'etre fige -- relu de la table, pas reconstruit
  -- de tete : ce qui est rendu est ce qui est en base.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'team_id',    z.team_id,
           'final_rank', z.final_rank,
           'played',     z.played,
           'wins',       z.wins,
           'games_won',  z.games_won,
           'games_lost', z.games_lost,
           'points',     z.points
         ) ORDER BY z.final_rank), '[]'::jsonb)
    INTO v_rank
    FROM (SELECT DISTINCT r.team_id, r.final_rank, r.played, r.wins,
                          r.games_won, r.games_lost, r.points
            FROM public.tournament_results r
           WHERE r.tournament_id = p_tournament) z;

  RETURN jsonb_build_object('ok', true,
                            'results', v_lignes,
                            'closed_at_round', v_dernier,
                            'final_round_played', v_final,
                            'ignored_matches', v_ignores,
                            'ranking', v_rank,
                            'standings', v_st->'standings');
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_close(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_close(uuid) TO authenticated;

-- ============================================================================
-- tournament_validate(p_tournament)
--
-- LE DERNIER GESTE : TERMINE -> CLASSEMENT_VALIDE. C'est LA SEULE ETAPE OU LES
-- POINTS COMPTENT, et ou le tournoi entre dans « Mon parcours » (spec §14).
--
-- ELLE NE RECALCULE RIEN, ET ELLE N'ECRIT AUCUN POINT. `tournament_close` a
-- deja fige le rang, les compteurs et les points dans `tournament_results` ;
-- « crediter » n'est pas une addition quelque part, c'est le fait que ces
-- lignes DEVIENNENT LISIBLES comme acquises. Il n'existe volontairement AUCUN
-- cumul denormalise cote joueur : « Mon parcours » (Task 9) somme
-- `tournament_results` en ne retenant que les tournois CLASSEMENT_VALIDE. Un
-- total stocke sur `players` serait une seconde verite a garder synchronisee
-- d'une premiere -- la derive deja payee dans ce depot avec `spots_available`
-- -- et il faudrait la defaire a chaque reouverture de score.
--
-- Rien ici ne touche a `games`, a l'ELO, ni au classement general de l'appli :
-- les points de tournoi sont un classement A PART, c'est toute la raison d'etre
-- de l'architecture separee.
--
-- Recalculer avant de valider n'est pas non plus son role : si le classement
-- fige ne convient pas, le chemin est `tournament_reopen_match` (qui efface
-- `tournament_results` et rend le tournoi a EN_COURS), puis une nouvelle
-- cloture. Valider est un ACCORD, pas un calcul.
--
-- Refus : feature_disabled, not_authenticated, tournament_not_found,
--         not_the_organizer, already_validated, tournament_not_finished,
--         no_results.
-- Appelable par : le createur du tournoi, et lui seul.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_validate(p_tournament uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me      uuid := public.current_player_id();
  v_t       public.tournaments%ROWTYPE;
  v_joueurs int;
  v_points  int;
  v_rows    int;
BEGIN
  ---------------------------------------------------------------------------
  -- CONTROLES -- aucune ecriture avant la fin de cette section.
  ---------------------------------------------------------------------------
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  IF v_t.created_by <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_the_organizer');
  END IF;
  IF v_t.status = 'CLASSEMENT_VALIDE' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_validated');
  END IF;
  -- On ne valide que ce qui est CLOS. Valider depuis EN_COURS sauterait la
  -- cloture, donc `tournament_results` : le tournoi entrerait dans
  -- « Mon parcours » sans une seule ligne de resultat.
  IF v_t.status <> 'TERMINE' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_finished',
                              'status', v_t.status);
  END IF;

  SELECT count(*)::int, COALESCE(sum(r.points), 0)::int
    INTO v_joueurs, v_points
    FROM public.tournament_results r
   WHERE r.tournament_id = p_tournament;

  -- Ceinture : un tournoi TERMINE sans resultat serait une cloture qui a menti.
  -- Mieux vaut le dire que valider un classement vide.
  IF v_joueurs = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_results');
  END IF;

  ---------------------------------------------------------------------------
  -- ECRITURES
  ---------------------------------------------------------------------------
  UPDATE public.tournaments
     SET status = 'CLASSEMENT_VALIDE'
   WHERE id = p_tournament;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'tournament_validate: le tournoi % a disparu sous le verrou',
      p_tournament;
  END IF;

  RETURN jsonb_build_object('ok', true,
                            'players', v_joueurs,
                            'points_total', v_points);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_validate(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_validate(uuid) TO authenticated;

-- ############################################################################
-- SECTION ANNULATION (Task 12)
--
-- Une seule fonction : le remede GENERAL aux etats sans sortie qu'une
-- relecture de branche a trouves -- un CHECK_IN sans le moindre binome, un
-- EN_COURS a `current_round = 0` apres des forfaits en cascade avant la
-- premiere rotation, ou tout autre blocage qu'aucune fonction specifique de ce
-- fichier ne sait defaire. Plutot que d'ajouter une garde a l'ouverture du
-- pointage ou au demarrage -- ce qui punirait un geste legitime, l'organisateur
-- qui ouvre le pointage tot ou qui accepte des forfaits avant le premier tirage
-- -- on donne toujours une porte de sortie : une soiree doit TOUJOURS pouvoir
-- etre abandonnee.
-- ############################################################################

-- ============================================================================
-- tournament_cancel(p_tournament)
--
-- L'ORGANISATEUR ABANDONNE LA SOIREE : n'importe quel etat NON VALIDE ->
-- ANNULE, statut TERMINAL.
--
-- ATTEIGNABLE DEPUIS TOUT ETAT NON VALIDE -- BROUILLON, INSCRIPTIONS_OUVERTES,
-- COMPLET, CHECK_IN, PRET, EN_COURS, TERMINE -- MAIS PAS DEPUIS
-- CLASSEMENT_VALIDE (`already_validated`) : les points sont deja credites et
-- le tournoi est deja entre dans « Mon parcours » de chaque joueur, ce que ce
-- fichier ne defait NULLE PART -- meme `tournament_reopen_match` le refuse.
-- Annuler un tournoi valide laisserait des points credites sans tournoi pour
-- les justifier. `already_cancelled` protege symetriquement contre un second
-- appel sur un tournoi deja annule.
--
-- CE QU'ELLE NE FAIT PAS : elle ne touche a AUCUNE autre table -- ni les
-- inscriptions, ni les binomes, ni les matchs, ni `tournament_results`. Un
-- tournoi annule garde toute sa trace, exactement comme il etait au moment de
-- l'abandon ; seul son statut change. Aucune autre fonction de ce fichier
-- n'accepte `ANNULE` dans la moindre liste de statuts autorises -- il est donc
-- reellement TERMINAL, sans qu'aucune garde supplementaire n'ait ete ajoutee
-- ailleurs pour le garantir.
--
-- Refus : feature_disabled, not_authenticated, tournament_not_found,
--         not_the_organizer, already_cancelled, already_validated.
-- Appelable par : l'ORGANISATEUR (tournaments.created_by) seul.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_cancel(p_tournament uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me   uuid := public.current_player_id();
  v_t    public.tournaments%ROWTYPE;
  v_rows int;
BEGIN
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  IF v_t.created_by <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_the_organizer');
  END IF;
  IF v_t.status = 'ANNULE' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_cancelled');
  END IF;
  IF v_t.status = 'CLASSEMENT_VALIDE' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_validated');
  END IF;

  ---------------------------------------------------------------------------
  -- ECRITURE -- la seule de cette fonction.
  ---------------------------------------------------------------------------
  UPDATE public.tournaments SET status = 'ANNULE' WHERE id = p_tournament;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'tournament_cancel: le tournoi % a disparu sous le verrou',
      p_tournament;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', 'ANNULE');
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_cancel(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_cancel(uuid) TO authenticated;

-- ============================================================================
-- FIN DU FICHIER -- il n'y a PLUS DE SURFACE GELEE.
--
-- Le bloc qui suivait ici retirait le droit d'execution des trois dernieres
-- fonctions du modele precedent. Les trois ont disparu :
--   * `tournament_confirm_score` -- SUPPRIMEE (`DROP FUNCTION`, plus haut) :
--     perimee par le modele lui-meme, un score est acquis des que deux joueurs
--     de binomes OPPOSES saisissent le meme ;
--   * `tournament_standings` et `tournament_close` -- REECRITES ci-dessus,
--     contre les statuts reels (EN_COURS / TERMINE / CLASSEMENT_VALIDE) et
--     contre la hierarchie de classement du format : palier -> victoires ->
--     difference -> jeux gagnes -> confrontation directe.
--
-- Toute fonction de ce fichier a donc desormais son `REVOKE ALL ... FROM
-- PUBLIC, anon, authenticated` suivi, pour celles qui sont appelables, de son
-- `GRANT EXECUTE ... TO authenticated`. Aucune ne reste inerte.
-- ============================================================================

COMMIT;

NOTIFY pgrst, 'reload schema';
