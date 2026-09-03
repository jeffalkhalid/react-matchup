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
-- Il RESTE trois fonctions du modele PRECEDENT : `tournament_confirm_score`
-- (perimee par le modele : un score est acquis par la CONCORDANCE de deux
-- saisies opposees, il n'y a plus d'etape de confirmation), et
-- `tournament_standings` / `tournament_close`, que la tache « classement,
-- rotation finale, cloture » doit reecrire. Elles ecrivent les colonnes
-- `entered_by` / `confirmed_by`, que `tournament_matches` ne porte plus, et
-- les statuts 'open', 'live', 'finished', 'cancelled', que la contrainte CHECK
-- de `tournaments` refuse. Elles s'INSTALLENT sans erreur (plpgsql ne verifie
-- pas les identifiants a la creation) mais ECHOUERAIENT A L'EXECUTION --
-- raison pour laquelle leur droit d'execution est RETIRE en fin de fichier,
-- dans le bloc « SURFACE GELEE », jusqu'a leur reecriture.
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- Helper interne : le bareme de points.
--
-- `points_scale` est un objet {rang: points} A RANGS PARTIELS, par exemple
-- {"1":20,"2":15,"3":10,"5":5,"7":-2}. REGLE D'INTERPRETATION : un rang prend
-- les points du SEUIL DEFINI LE PLUS PROCHE EN DESSOUS OU EGAL A LUI.
--   rang 1 -> seuil 1 -> 20
--   rang 2 -> seuil 2 -> 15
--   rang 3 -> seuil 3 -> 10
--   rang 4 -> seuil 3 -> 10   (pas de seuil 4 : on prend le 3)
--   rang 5 -> seuil 5 ->  5
--   rang 6 -> seuil 5 ->  5
--   rang 7 -> seuil 7 -> -2
--   rang 8 et au-dela -> seuil 7 -> -2
-- Si aucun seuil n'est <= au rang (bareme qui ne commence pas a 1), le rang
-- vaut 0 point. Les points peuvent etre negatifs, c'est voulu.
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
-- COMPLET, et RIEN D'AUTRE. La clause `status IN (...)` est la garantie que ce
-- helper ne peut pas faire reculer un tournoi depuis CHECK_IN, PRET, EN_COURS
-- ou au-dela : la machine a etats appartient a l'organisateur, ce helper ne
-- fait que refleter « reste-t-il une place ».
--
-- Il lit `fn_tournament_free_places`, PAS `fn_tournament_open_seats` : le
-- statut annonce ce qu'un nouvel inscrit obtiendrait, et avec une file en
-- cours, il n'obtient rien. Un tournoi qui affiche INSCRIPTIONS_OUVERTES
-- pendant que tout arrivant tombe en liste d'attente est un mensonge
-- d'affichage.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_tournament_sync_capacity_status(p_tournament uuid)
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
     AND status IN ('INSCRIPTIONS_OUVERTES','COMPLET')
     AND status <> v_target;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_tournament_sync_capacity_status(uuid) FROM PUBLIC, anon, authenticated;

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
-- fait) et `open_to_join` a la VALEUR PAR DEFAUT de la colonne, ecrit
-- litteralement `DEFAULT`. `open_to_join` est un MODE DE CONSENTEMENT : seul
-- son proprietaire le change, jamais une fonction appelee par un tiers, et
-- jamais un effet de bord. Voir le bloc [PLACE VACANTE] plus bas : il doit
-- etre PREVENU de cette inscription.
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
      -- meme pas encore ete prevenu (cf. le bloc [PLACE VACANTE] ci-dessous).
      -- Il l'ouvre lui-meme, quand il veut, par
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
-- [PLACE VACANTE] fn_tournament_registration_notify -- LE PARTENAIRE DOIT
-- ETRE PREVENU. Rien ne le previent aujourd'hui, et c'est un manque, pas un
-- choix.
--
-- Ce que la spec exige et que ce fichier ne tient pas : « le partenaire est
-- notifie et peut defaire le binome ». En l'etat, N'IMPORTE QUEL joueur
-- connecte peut appeler
--     tournament_register(tournoi, son_cote, son_mode, <mon_id>)
-- et je me retrouve inscrit a un tournoi AFFICHANT UN PRIX, avec un cote
-- 'both' que je n'ai pas declare, deja engage dans un binome -- et rien, pas
-- une ligne, ne me l'apprend. Au check-in je suis un 'pending' qui ne se
-- presente jamais, et l'organisateur decouvre le trou le soir meme.
--
-- Pourquoi ce n'est PAS ecrit dans les fonctions ci-dessus : ce depot notifie
-- par DECLENCHEUR + pg_net -> edge function `send-push` (motif de
-- `defi_server_notifs.sql` / `match_reminders.sql`), jamais depuis une RPC
-- appelee par le client -- une notification poussee par le client se perd des
-- que le client se ferme. Le manque appartient donc a un declencheur, pas a
-- `tournament_register`.
--
-- A ECRIRE (tache d'integration) :
--   * `fn_tournament_registration_notify` -- AFTER INSERT ON
--     `tournament_registrations` FOR EACH ROW : pousser a NEW.player_id quand
--     `NEW.player_id <> public.current_player_id()`, c'est-a-dire quand la
--     ligne a ete creee POUR LUI PAR UN AUTRE (le seul cas produit par
--     `tournament_register` avec p_partner). auth.uid() reste lisible dans un
--     declencheur appele depuis une fonction SECURITY DEFINER : c'est le JWT
--     de la session, pas le proprietaire de la fonction.
--     Message attendu : qui l'a inscrit, quel tournoi, le PRIX AFFICHE, et
--     qu'il peut defaire le binome (`tournament_leave_team`) ou se desinscrire
--     (`tournament_withdraw`) -- plus une invitation a declarer son cote,
--     laisse a 'both' faute de declaration.
--   * `fn_tournament_join_request_notify` -- AFTER INSERT ON
--     `tournament_join_requests` : prevenir `to_player` qu'une demande
--     l'attend ; et AFTER UPDATE vers 'accepted'/'declined' : prevenir
--     `from_player` de la reponse.
-- ============================================================================

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
-- appartient a la tache « deroulement » et devra s'appeler
-- `tournament_forfeit(p_team)`.
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
  v_me       uuid := public.current_player_id();
  v_status   text;
  v_reg      public.tournament_registrations%ROWTYPE;
  v_team     uuid;
  v_mate     uuid;
  v_promoted int := 0;
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
  -- forfait, qui appartient a `tournament_forfeit` (cf. [PLACE VACANTE]).
  IF EXISTS (SELECT 1 FROM public.tournament_matches m
              WHERE m.tournament_id = p_tournament) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'matches_already_generated');
  END IF;

  SELECT * INTO v_reg FROM public.tournament_registrations r
   WHERE r.tournament_id = p_tournament AND r.player_id = v_me;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_registered');
  END IF;

  SELECT tp.team_id INTO v_team
    FROM public.tournament_participants tp
   WHERE tp.tournament_id = p_tournament AND tp.player_id = v_me;
  IF FOUND THEN
    SELECT tp.player_id INTO v_mate
      FROM public.tournament_participants tp
     WHERE tp.tournament_id = p_tournament AND tp.team_id = v_team
       AND tp.player_id <> v_me;
  END IF;

  ---------------------------------------------------------------------------
  -- ECRITURES.
  ---------------------------------------------------------------------------
  -- Le binome se defait, et c'est tout : mon partenaire garde sa place, son
  -- rang de file s'il en avait un, et son mode de consentement.
  IF v_team IS NOT NULL THEN
    DELETE FROM public.tournament_teams WHERE id = v_team;
  END IF;

  DELETE FROM public.tournament_registrations
   WHERE tournament_id = p_tournament AND player_id = v_me;

  -- Une seule regle, sans exception a retenir : apres toute mutation
  -- d'inscription, la file tourne. Partir depuis la file ne libere aucun
  -- siege, la promotion ne fera alors rien -- et elle synchronise le statut
  -- dans tous les cas.
  v_promoted := public.fn_tournament_promote_waitlist(p_tournament);

  RETURN jsonb_build_object('ok', true,
                            'was_waitlisted', v_reg.waitlist_position IS NOT NULL,
                            'partner_id', v_mate, 'promoted', v_promoted);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_withdraw(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_withdraw(uuid) TO authenticated;

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
-- Les joueurs marques 'no_show' sont ECARTES, et LAISSES TELS QUELS : les
-- apparier reviendrait a composer un binome autour d'un absent, et leur
-- retirer leur place est une decision d'organisateur (remplacement), pas un
-- effet de bord de l'appariement.
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
  IF v_status NOT IN ('COMPLET','CHECK_IN','PRET') THEN
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
           AND r.check_in_status   <> 'no_show'
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
       AND r.check_in_status   <> 'no_show'
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
-- tournament_confirm_score(p_match)  -- ⚠️ GELEE, ET PERIMEE PAR LE MODELE.
--
-- Un score est desormais acquis des que deux joueurs de binomes OPPOSES
-- saisissent le meme score (`tournament_enter_score` ci-dessus) : il n'y a
-- plus d'etape de confirmation a declencher, donc plus de role pour cette
-- fonction. Elle est laissee ici, inerte et sans droit d'execution (cf. le
-- bloc « SURFACE GELEE » en fin de fichier), plutot que supprimee : sa
-- disparition appartient a la tache qui aura fini de reecrire cette surface.
-- NE PAS l'appeler, NE PAS lui reposer de GRANT.
--
-- La confirmation vient de l'ADVERSAIRE : le binome qui a saisi ne peut pas
-- se confirmer lui-meme.
--
-- Refus : feature_disabled, not_authenticated, match_not_found, bye_match,
--         already_confirmed, no_score_entered, not_a_participant,
--         cannot_confirm_own.
-- Appelable par : les deux joueurs du binome QUI N'A PAS saisi.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_confirm_score(p_match uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me      uuid := public.current_player_id();
  v_m       public.tournament_matches%ROWTYPE;
  v_my_team uuid;
  v_author  uuid;   -- le binome de celui qui a saisi
BEGIN
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
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
  IF v_m.entered_by IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_score_entered');
  END IF;

  SELECT tt.id INTO v_my_team
    FROM public.tournament_teams tt
   WHERE tt.id IN (v_m.team_a, v_m.team_b)
     AND (tt.player1_id = v_me OR tt.player2_id = v_me);
  IF v_my_team IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_participant');
  END IF;

  SELECT tt.id INTO v_author
    FROM public.tournament_teams tt
   WHERE tt.id IN (v_m.team_a, v_m.team_b)
     AND (tt.player1_id = v_m.entered_by OR tt.player2_id = v_m.entered_by);
  IF v_author IS NOT NULL AND v_author = v_my_team THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cannot_confirm_own');
  END IF;

  UPDATE public.tournament_matches
     SET confirmed_by = v_me,
         confirmed_at = now()
   WHERE id = p_match;

  RETURN jsonb_build_object('ok', true, 'match_id', p_match);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_confirm_score(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_confirm_score(uuid) TO authenticated;
-- ⚠️ Ce GRANT est RETIRE en fin de fichier (bloc « SURFACE GELEE »). Il est
-- laisse ici pour que la fonction gelee reste lisible telle qu'elle etait.

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
-- tournament_generate_round(p_tournament)
--
-- Tire la rotation suivante. Port de `pairUp` de `lib/tournament.ts` ; le
-- palier de chaque binome A L'ENTREE du tour vient de `fn_tournament_ladder`,
-- qui est le port de `nextCourts` (et, au tour 1, du `start_court` pose par
-- `tournament_start`, port de `initialCourts`).
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
--         not_enough_teams.
-- Appelable par : l'ORGANISATEUR (tournaments.created_by) seul.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_generate_round(p_tournament uuid)
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
    RAISE EXCEPTION 'tournament_generate_round: le tournoi % a disparu sous le verrou',
      p_tournament;
  END IF;

  RETURN jsonb_build_object('ok', true, 'round', v_round,
                            'matches', v_created, 'byes', v_byes,
                            'movements', v_moves,
                            'court_count', v_t.court_count);
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
         status        = 'EN_COURS'
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

-- ============================================================================
-- tournament_standings(p_tournament, p_max_round DEFAULT NULL) RETURNS jsonb
--
-- ⚠️⚠️ GELEE. A REECRIRE PAR LA TACHE « classement, rotation finale, cloture ».
-- CE QUI SUIT EST LA LISTE EXACTE DE CE QUI EST FAUX. Le commentaire d'origine
-- (« Port EXACT de standings() ») est conserve dessous parce qu'il documente
-- l'INTENTION, mais il ne decrit plus le comportement du moteur : NE PAS s'y
-- fier.
--
--   1. ⚠️ LE SIGNE DU PALIER EST INVERSE, ET C'EST LE PLUS GRAVE. Le corps
--      calcule `highest_court = max(court_no)` et trie dessus en DESC. C'etait
--      juste sous la convention abandonnee, ou le DERNIER terrain etait le
--      meilleur. Depuis le redressement des paliers (tache « deroulement »),
--      LE TERRAIN 1 EST LE MEILLEUR : le moteur calcule
--      `bestCourt = Math.min(court)` et trie CROISSANT. Tel quel, ce SQL place
--      le binome qui gagne tout et atteint le Terrain 1 DERRIERE celui qui perd
--      tout et reste au Terrain 4. A remplacer par un `min(court_no)` trie ASC.
--
--   2. ⚠️ LE PALIER N'EST PLUS UN DEPARTAGE, C'EST LA PREMIERE CLE. Le SQL
--      trie : jeux gagnes -> difference -> confrontation -> palier. Le moteur
--      trie : palier -> VICTOIRES -> difference -> jeux gagnes ->
--      confrontation -> id. La hierarchie entiere est a refaire, pas a
--      retoucher.
--
--   3. ⚠️ IL N'Y A AUCUN COMPTAGE DE VICTOIRES. `Standing.wins` n'a pas
--      d'equivalent ici -- ni colonne, ni cle de tri. C'est un critere ENTIER
--      qui manque, en DEUXIEME position. (Et c'est aussi pourquoi le defaut de
--      forfait corrige dans `fn_tournament_ladder` n'existe PAS ici : ce corps
--      ne deduit aucun vainqueur de `games_a > games_b`. Le jour ou les
--      victoires seront comptees, elles devront passer par
--      `fn_tournament_a_won` -- `forfeited_team` d'abord, les jeux ensuite --
--      sans quoi un forfait 0-0 crediterait la victoire au camp B quel que
--      soit le forfaitaire.)
--
--   4. ⚠️ IL LIT `tournament_teams` EN DIRECT, sans la jointure a
--      `tournament_registrations` avec `waitlist_position IS NULL` sur les DEUX
--      joueurs -- l'invariant en tete de fichier. Un binome forme par deux
--      joueurs en LISTE D'ATTENTE apparaitrait au classement, avec `played = 0`.
--      `fn_tournament_seated_teams` existe desormais pour ca. Attention : il
--      exclut aussi `withdrawn`, alors que le classement doit GARDER les
--      forfaits (le moteur part de `teams`) -- la tache 5 aura besoin de la
--      jointure sans ce filtre-la.
--
--   5. La sentinelle du palier : le moteur donne `bestCourt = Infinity` a un
--      binome qui n'a joue AUCUN match reel, pour qu'il ne se retrouve pas
--      premier faute d'avoir jamais ete note. Le SQL ecrit `COALESCE(..., 0)`,
--      qui sous un tri croissant le mettrait DEVANT tout le monde.
--
--   6. Le groupe d'ex aequo de la confrontation directe (`dense_rank()`) porte
--      sur deux cles (jeux gagnes, difference). Le moteur en utilise QUATRE :
--      palier, victoires, difference, jeux gagnes -- exactement celles qui
--      precedent la confrontation. Un groupe trop large fait entrer dans
--      l'agregat des matchs sans rapport avec le duel reellement lie.
--
-- Ce qui reste VRAI dans le commentaire d'origine ci-dessous : la confrontation
-- directe AGREGE toutes les rencontres (durement acquis, a garder), les byes
-- n'entrent pas au classement, et `p_max_round` BORNE sans rien supprimer.
--
-- ---------------------------------------------------------------------------
-- Commentaire d'origine, conserve pour l'intention :
--
-- Port EXACT de `standings()` de `lib/tournament.ts`.
--   * une ligne par binome INSCRIT, forfaits compris (le TypeScript part de
--     `teams`, pas des matchs) ;
--   * seuls les matchs CONFIRMES et a deux binomes comptent (un bye n'entre
--     jamais dans le classement) ;
--   * tri : jeux gagnes DESC, puis difference DESC, puis confrontation
--     directe, puis palier le plus haut atteint DESC, puis id ASC ;
--   * la confrontation directe AGREGE toutes les rencontres entre les deux
--     binomes, jamais la premiere trouvee -- les revanches sont la norme dans
--     cette echelle, et sommer rend le resultat independant de l'ordre des
--     lignes.
--
-- `p_max_round` borne le classement aux tours <= a cette valeur ; NULL (le
-- defaut) compte tous les matchs confirmes. C est le pendant exact du
-- parametre `maxRound` de `standings()` cote TypeScript, pour qu un rejeu de
-- parite puisse borner les deux cotes de la meme facon. `tournament_close`
-- lui passe le dernier tour COMPLET.
--
-- Forme renvoyee :
--   {ok:true, standings:[{team_id, player1_id, player2_id, withdrawn, played,
--                         games_won, games_lost, games_avg, diff,
--                         highest_court, h2h, rank}, ...]}
--
-- Refus : feature_disabled, tournament_not_found.
-- Appelable par : tout joueur connecte (un tournoi est un evenement public).
-- ============================================================================
-- Ajouter un parametre CHANGE la signature : Postgres creerait une SURCHARGE
-- au lieu de remplacer. On supprime explicitement l ancienne signature.
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

  WITH pm AS (
    SELECT m.team_a, m.team_b, m.games_a, m.games_b, m.court_no
      FROM public.tournament_matches m
     WHERE m.tournament_id = p_tournament
       AND m.confirmed_at IS NOT NULL
       AND m.team_a IS NOT NULL
       AND m.team_b IS NOT NULL
       AND (p_max_round IS NULL OR m.round_no <= p_max_round)
  ),
  per_team AS (
    SELECT p.team_a AS team_id, p.games_a AS gw, p.games_b AS gl, p.court_no FROM pm p
    UNION ALL
    SELECT p.team_b,            p.games_b,      p.games_a,      p.court_no FROM pm p
  ),
  agg AS (
    SELECT tt.id AS team_id, tt.player1_id, tt.player2_id, tt.withdrawn,
           count(pt.team_id)::int                AS played,
           COALESCE(sum(pt.gw), 0)::int          AS games_won,
           COALESCE(sum(pt.gl), 0)::int          AS games_lost,
           COALESCE(max(pt.court_no), 0)::int    AS highest_court
      FROM public.tournament_teams tt
      LEFT JOIN per_team pt ON pt.team_id = tt.id
     WHERE tt.tournament_id = p_tournament
     GROUP BY tt.id, tt.player1_id, tt.player2_id, tt.withdrawn
  ),
  scored AS (
    SELECT a.*, (a.games_won - a.games_lost) AS diff FROM agg a
  ),
  grp AS (
    -- Le groupe d'ex aequo : exactement les binomes que le comparateur du
    -- TypeScript n'a pas encore departages quand il en arrive a la
    -- confrontation directe.
    SELECT s.*, dense_rank() OVER (ORDER BY s.games_won DESC, s.diff DESC) AS tie_grp
      FROM scored s
  ),
  h2h_agg AS (
    SELECT x.team_id,
           COALESCE(sum(CASE WHEN p.team_a = x.team_id THEN p.games_a - p.games_b
                             ELSE                            p.games_b - p.games_a END), 0)::int AS h2h
      FROM grp x
      LEFT JOIN grp y  ON y.tie_grp = x.tie_grp AND y.team_id <> x.team_id
      LEFT JOIN pm p ON (p.team_a = x.team_id AND p.team_b = y.team_id)
                         OR (p.team_b = x.team_id AND p.team_a = y.team_id)
     GROUP BY x.team_id
  ),
  final AS (
    SELECT g.*, h.h2h,
           row_number() OVER (ORDER BY g.games_won DESC,
                                       g.diff DESC,
                                       h.h2h DESC,
                                       g.highest_court DESC,
                                       g.team_id ASC)::int AS rank
      FROM grp g JOIN h2h_agg h ON h.team_id = g.team_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'team_id',       f.team_id,
           'player1_id',    f.player1_id,
           'player2_id',    f.player2_id,
           'withdrawn',     f.withdrawn,
           'played',        f.played,
           'games_won',     f.games_won,
           'games_lost',    f.games_lost,
           -- Moyenne de jeux gagnes par match joue. EXPOSEE POUR L AFFICHAGE,
           -- JAMAIS UTILISEE AU TRI : le classement se fait au TOTAL de jeux
           -- gagnes, des deux cotes. Arbitrage rendu : une moyenne
           -- recompenserait un binome qui abandonne apres deux beaux matchs,
           -- et le cas qui la motivait -- la soiree qui deborde -- est reglee
           -- a la source par `tournament_close`, qui cloture au dernier tour
           -- COMPLET.
           'games_avg',     CASE WHEN f.played > 0
                                 THEN round(f.games_won::numeric / f.played, 3)
                                 ELSE 0 END,
           'diff',          f.diff,
           'highest_court', f.highest_court,
           'h2h',           f.h2h,
           'rank',          f.rank
         ) ORDER BY f.rank), '[]'::jsonb)
    INTO v_out
    FROM final f;

  RETURN jsonb_build_object('ok', true, 'standings', v_out);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_standings(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_standings(uuid, int) TO authenticated;

-- ============================================================================
-- tournament_close(p_tournament)
--
-- Fige le classement dans `tournament_results` -- UNE LIGNE PAR JOUEUR, donc
-- deux par binome -- applique `points_scale`, et passe le tournoi en
-- `finished`. C'est cette table que lit "Mon parcours" ; tant que le tournoi
-- tourne, le classement se CALCULE et ne se stocke pas.
--
-- ON NE CLOTURE JAMAIS AU MILIEU D UN TOUR. La cloture se fait au DERNIER
-- TOUR COMPLET : le classement est BORNE a ce tour, ce qui egalise les
-- nombres de matchs joues sans corriger apres coup par une moyenne.
--
-- BORNE, PAS SUPPRIME. Une version precedente effacait les matchs des tours
-- posterieurs. C etait destructeur pour de vrai : `tournament_matches` est le
-- SEUL endroit ou un score existe -- `tournament_results` n en garde que des
-- agregats, et `tournament_reopen_match` ne peut pas rouvrir une ligne
-- supprimee. Trois terrains sur quatre finissent le tour 3, la quatrieme
-- paire s en va sans confirmer, l organisateur cloture : six joueurs
-- perdaient leur score reel, sans retour possible. Les lignes restent donc en
-- base ; seul le CALCUL les ignore, via le plafond passe a
-- `tournament_standings`.
--
-- `current_round` revient au dernier tour complet : c est un marqueur de la
-- ou le classement a ete coupe, pas une destruction. Les matchs du tour
-- entame sont toujours la, lisibles, et rouvrables.
--
-- Refus : feature_disabled, not_authenticated, tournament_not_found,
--         not_the_organizer, already_finished, tournament_cancelled,
--         tournament_not_started, no_complete_round.
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
  v_partiel int;   -- premier tour ou un match reel n est pas confirme
  v_dernier int;   -- dernier tour COMPLET, sur lequel on cloture
  v_purges  int;   -- matchs laisses de cote par le plafond (jamais supprimes)
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
  IF v_t.status = 'finished' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_finished');
  END IF;
  IF v_t.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_cancelled');
  END IF;
  IF v_t.current_round < 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_started');
  END IF;

  -- Le dernier tour COMPLET. Un tour est complet quand tous ses matchs REELS
  -- sont confirmes ; les byes ne se confirment pas et n entrent pas dans le
  -- controle. `tournament_generate_round` interdisant deja d avancer sur un
  -- tour incomplet, seul le dernier tour peut etre partiel -- mais on prend le
  -- PREMIER tour incomplet plutot que le dernier, ce qui reste juste meme si
  -- une reouverture a laisse un trou plus haut. Meme definition, au mot pres,
  -- que `lastCompleteRound()` cote TypeScript.
  SELECT min(x.round_no) INTO v_partiel
    FROM public.tournament_matches x
   WHERE x.tournament_id = p_tournament
     AND x.team_b IS NOT NULL
     AND x.confirmed_at IS NULL;

  v_dernier := COALESCE(v_partiel - 1, v_t.current_round);

  IF v_dernier < 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_complete_round');
  END IF;

  -- Combien de matchs le plafond laisse de cote. On les COMPTE pour le dire a
  -- l organisateur ; on ne les touche pas.
  SELECT count(*)::int INTO v_purges
    FROM public.tournament_matches x
   WHERE x.tournament_id = p_tournament
     AND x.round_no > v_dernier;

  -- Une seule source pour le classement : la fonction que l ecran affiche est
  -- celle qui fige les resultats. Deux calculs, meme tres proches, finiraient
  -- par diverger. Le plafond lui fait ignorer le tour entame.
  v_st := public.tournament_standings(p_tournament, v_dernier);
  IF NOT COALESCE((v_st->>'ok')::boolean, false) THEN
    RETURN v_st;
  END IF;

  INSERT INTO public.tournament_results
    (tournament_id, team_id, player_id, final_rank, played, games_won, games_lost, points)
  SELECT p_tournament,
         tt.id,
         pl.player_id,
         (e->>'rank')::int,
         (e->>'played')::int,
         (e->>'games_won')::int,
         (e->>'games_lost')::int,
         public.fn_tournament_points(v_t.points_scale, (e->>'rank')::int)
    FROM jsonb_array_elements(v_st->'standings') AS e
    JOIN public.tournament_teams tt ON tt.id = (e->>'team_id')::uuid
    CROSS JOIN LATERAL unnest(ARRAY[tt.player1_id, tt.player2_id]) AS pl(player_id)
  ON CONFLICT (tournament_id, player_id) DO UPDATE
    SET team_id    = EXCLUDED.team_id,
        final_rank = EXCLUDED.final_rank,
        played     = EXCLUDED.played,
        games_won  = EXCLUDED.games_won,
        games_lost = EXCLUDED.games_lost,
        points     = EXCLUDED.points;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  UPDATE public.tournaments
     SET status        = 'finished',
         current_round = v_dernier,
         ends_at       = COALESCE(ends_at, now())
   WHERE id = p_tournament;

  RETURN jsonb_build_object('ok', true, 'results', v_rows,
                            'closed_at_round', v_dernier,
                            'ignored_matches', v_purges,
                            'standings', v_st->'standings');
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_close(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_close(uuid) TO authenticated;

-- ============================================================================
-- SURFACE GELEE -- ce qu'il reste des fonctions heritees.
--
-- La tache « deroulement » a reecrit `tournament_enter_score`,
-- `tournament_generate_round` et `tournament_reopen_match`, et ajoute
-- `tournament_start`, `tournament_resolve_dispute` et `tournament_forfeit` :
-- chacune a repose son propre GRANT et ne figure plus ici.
--
-- Restent gelees, jusqu'a la tache « classement, rotation finale, cloture » :
--
--   * `tournament_confirm_score` -- PERIMEE PAR LE MODELE, pas seulement par
--     le schema. Un score est desormais acquis des que deux joueurs de
--     binomes OPPOSES saisissent le meme score : il n'y a plus d'etape de
--     confirmation a declencher, et la fonction n'a plus de role a jouer. Elle
--     ecrit par-dessus le marche `entered_by` / `confirmed_by`, colonnes que
--     `tournament_matches` ne porte plus. Sa SUPPRESSION (`DROP FUNCTION`)
--     appartient a la tache qui aura fini de reecrire cette surface -- la
--     laisser gelee la garde inerte en attendant.
--
--   * `tournament_standings` et `tournament_close` -- ecrites contre l'ancienne
--     hierarchie de classement (jeux gagnes d'abord, palier le plus HAUT
--     comme dernier critere) et contre les statuts 'live' / 'finished', que la
--     contrainte CHECK de `tournaments` refuse.
--     ⚠️ LA LISTE EXACTE DE CE QUI EST FAUX DANS `tournament_standings` est
--     ecrite juste au-dessus de sa definition, en six points -- dont un que la
--     tache « deroulement » a CREE en redressant les paliers : `highest_court`
--     y est un `max(court_no)` trie DESC, alors que le Terrain 1 est desormais
--     le meilleur. La lire AVANT d'y toucher : elle dit aussi ce qui n'est PAS
--     casse, pour ne pas partir corriger un fantome.
--
-- Elles s'installent sans erreur (plpgsql ne verifie pas les identifiants a la
-- creation) mais echoueraient des le premier appel -- avec une erreur SQL
-- BRUTE, la ou tout ce fichier promet `{ok:false, reason}`. Le REVOKE nomme
-- les trois (PUBLIC, anon, authenticated) : revoquer a PUBLIC seul ne retire
-- pas les droits directs.
-- ============================================================================
REVOKE ALL ON FUNCTION public.tournament_confirm_score(uuid)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tournament_standings(uuid, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tournament_close(uuid)          FROM PUBLIC, anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
