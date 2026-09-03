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
-- ⚠️ ETAT DU FICHIER. La section « inscription et appariement » ci-dessous est
-- ecrite pour le schema livre (tournaments.sql) : inscription INDIVIDUELLE,
-- places comptees EN JOUEURS (court_count x 4), statuts BROUILLON ->
-- INSCRIPTIONS_OUVERTES -> COMPLET -> CHECK_IN -> PRET -> EN_COURS -> TERMINE
-- -> CLASSEMENT_VALIDE.
-- Les fonctions de DEROULEMENT qui la suivent (enter_score, confirm_score,
-- generate_round, reopen_match, standings, close) datent, elles, du modele
-- PRECEDENT : elles lisent une colonne `max_teams` qui n'existe plus et
-- ecrivent des statuts ('live', 'finished') que la contrainte CHECK de
-- `tournaments` refuse. Elles s'INSTALLENT sans erreur (plpgsql ne verifie pas
-- les identifiants a la creation) mais ECHOUERAIENT A L'EXECUTION. Les taches
-- suivantes les reecrivent ; ne pas les appeler d'ici la.
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
-- Regle de mouvement, identique a `nextCourts` :
--   * bye (team_b IS NULL) : l'equipe ne bouge pas ;
--   * sinon aGagne := games_a > games_b -- NOTER LE SENS : une egalite de jeux
--     est traitee comme une VICTOIRE DE B, choix explicite du moteur
--     TypeScript ("si il survenait quand meme, ce test le traite comme une
--     victoire de B"). `tournament_enter_score` refuse d'ailleurs les
--     egalites en amont, comme le commentaire du moteur le prevoit.
--   * gagnant -> least(courtCount, court+1) ; perdant -> greatest(1, court-1).
--
-- Les equipes forfait sont EXCLUES : leur adversaire du tour suivant se
-- retrouve seul sur son palier et recoit un bye, ce que veut la spec.
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
  mv AS (
    SELECT m.round_no,
           m.team_a AS mv_team,
           CASE
             WHEN m.team_b IS NULL              THEN m.court_no
             WHEN m.games_a > m.games_b         THEN least((SELECT court_count FROM cc), m.court_no + 1)
             ELSE                                    greatest(1, m.court_no - 1)
           END AS mv_court
      FROM public.tournament_matches m
     WHERE m.tournament_id = p_tournament
       AND m.round_no < p_round
       AND m.team_a IS NOT NULL
    UNION ALL
    SELECT m.round_no,
           m.team_b,
           CASE
             WHEN m.games_a > m.games_b         THEN greatest(1, m.court_no - 1)
             ELSE                                    least((SELECT court_count FROM cc), m.court_no + 1)
           END
      FROM public.tournament_matches m
     WHERE m.tournament_id = p_tournament
       AND m.round_no < p_round
       AND m.team_b IS NOT NULL
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
       AND b.round_no < p_round
       AND b.team_b IS NULL
       AND b.team_a IS NOT NULL
     GROUP BY b.team_a
  )
  SELECT tt.id,
         COALESCE(lm.mv_court, tt.start_court)::int,
         COALESCE(bc.n, 0)::int
    FROM public.tournament_teams tt
    LEFT JOIN last_mv lm ON lm.mv_team = tt.id
    LEFT JOIN byes    bc ON bc.bye_team = tt.id
   WHERE tt.tournament_id = p_tournament
     AND NOT tt.withdrawn
     AND COALESCE(lm.mv_court, tt.start_court) IS NOT NULL;
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
--     place -- personne n'est ejecte parce qu'un partenaire s'est ravise ;
--   * AU-DELA DES PLACES (court_count x 4, comptees EN JOUEURS), l'inscription
--     entre en liste d'attente ordonnee par date ; quand des places se
--     liberent, la file avance a concurrence des places disponibles.
--
-- Les places sont un NOMBRE DE JOUEURS : `court_count x 4`. Rien de derive
-- n'est stocke ; `fn_tournament_free_places()` le recalcule a la lecture.
--
-- AUCUNE de ces fonctions n'ecrit dans `tournament_participants` : cette table
-- est l'index derive maintenu par le declencheur pose dans tournaments.sql.
-- On ecrit `tournament_teams`, le declencheur fait le reste -- et c'est LUI
-- qui garantit « un joueur, un seul binome par tournoi » (sa PK), ce dont les
-- filets `EXCEPTION WHEN unique_violation` ci-dessous dependent.
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
-- ⚠️ Le forfait EN COURS de tournoi reste a ecrire (tache « deroulement ») :
--    il lui faut son propre nom, `tournament_forfeit(p_team)`, et il doit
--    passer par `tournament_matches.forfeited_team` + `tournaments.forfeit_games`,
--    jamais par un 0-6 code en dur.
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
-- Helper interne : les places LIBRES, EN JOUEURS.
--   places = tournaments.court_count x 4  (jamais stocke, toujours derive)
--   prises = les inscriptions qui ne sont PAS en liste d'attente
-- Une inscription est la seule chose qui occupe une place : ni une demande, ni
-- un binome. Un binome n'est qu'une relation entre deux places deja prises.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_tournament_free_places(p_tournament uuid)
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

REVOKE ALL ON FUNCTION public.fn_tournament_free_places(uuid) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Helper interne : le statut suit la capacite, entre INSCRIPTIONS_OUVERTES et
-- COMPLET, et RIEN D'AUTRE. La clause `status IN (...)` est la garantie que ce
-- helper ne peut pas faire reculer un tournoi depuis CHECK_IN, PRET, EN_COURS
-- ou au-dela : la machine a etats appartient a l'organisateur, ce helper ne
-- fait que refleter « reste-t-il une place ».
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
-- Appele des qu'une place se libere. Regle du brief : « quand des places se
-- liberent, la file avance a concurrence des places disponibles », dans
-- l'ORDRE.
--
-- Ruling: FIFO STRICTE, on ne double jamais la file. Si la tete est un binome
-- qui reclame 2 places et qu'une seule est libre, on S'ARRETE -- on ne va pas
-- chercher un joueur seul plus loin dans la file pour combler. Un binome ne se
-- coupe pas en deux (un joueur assis, son partenaire en attente : un binome a
-- moitie inscrit, exactement l'etat batard que ce chantier refuse), et faire
-- passer le suivant devant serait une file qui n'en est plus une. La place
-- reste libre jusqu'a ce qu'une seconde se libere.
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
  v_free     int;
  v_head     uuid;
  v_group    uuid[];
  v_size     int;
  v_promoted int := 0;
BEGIN
  LOOP
    v_free := public.fn_tournament_free_places(p_tournament);
    EXIT WHEN v_free IS NULL OR v_free <= 0;

    SELECT r.player_id INTO v_head
      FROM public.tournament_registrations r
     WHERE r.tournament_id = p_tournament
       AND r.waitlist_position IS NOT NULL
     ORDER BY r.waitlist_position, r.registered_at, r.player_id
     LIMIT 1;
    EXIT WHEN NOT FOUND;

    -- Le groupe indissociable : le joueur de tete, plus son coequipier s'il en
    -- a un ET qu'il attend lui aussi. Le coequipier se lit dans
    -- tournament_participants -- l'inscription, elle, ne porte aucun team_id.
    SELECT coalesce(array_agg(r.player_id), ARRAY[]::uuid[]) INTO v_group
      FROM public.tournament_registrations r
     WHERE r.tournament_id = p_tournament
       AND r.waitlist_position IS NOT NULL
       AND (r.player_id = v_head
            OR r.player_id IN (
                 SELECT mate.player_id
                   FROM public.tournament_participants me
                   JOIN public.tournament_participants mate
                     ON mate.tournament_id = me.tournament_id
                    AND mate.team_id       = me.team_id
                  WHERE me.tournament_id = p_tournament
                    AND me.player_id     = v_head));

    v_size := coalesce(array_length(v_group, 1), 0);
    EXIT WHEN v_size = 0;        -- ceinture : ne peut pas arriver, la tete y est
    EXIT WHEN v_size > v_free;   -- FIFO stricte : on attend, on ne double pas

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
-- Le partenaire designe est inscrit avec le cote 'both'. C'est le seul choix
-- honnete : il n'a rien declare, et 'both' est precisement « pas de
-- contrainte », alors que recopier le cote de celui qui l'invite, ou le
-- deduire de son profil, lui preterait une declaration qu'il n'a pas faite.
-- L'ecran doit lui proposer de le preciser -- il est prevenu et peut de toute
-- facon defaire le binome.
--
-- Places : court_count x 4, EN JOUEURS. Au-dela, l'inscription entre en file.
-- Un binome entre en file ENTIER (2 places d'un coup) ou pas du tout, et un
-- nouvel inscrit ne passe JAMAIS devant une file existante, meme si une place
-- s'est liberee entre-temps.
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
  v_waiting int;
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

  v_free := public.fn_tournament_free_places(p_tournament);
  SELECT count(*) INTO v_waiting
    FROM public.tournament_registrations r
   WHERE r.tournament_id = p_tournament AND r.waitlist_position IS NOT NULL;

  -- On s'assoit si, et seulement si, la file est vide ET les places du groupe
  -- ENTIER sont disponibles.
  v_seated := (v_waiting = 0 AND coalesce(v_free, 0) >= v_need);
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
    INSERT INTO public.tournament_registrations
           (tournament_id, player_id, side, open_to_join, waitlist_position)
    VALUES (p_tournament, v_me, p_side,
            -- Inscrit a deux : `open_to_join` n'a plus d'objet, il a son
            -- partenaire. Defaire le binome le remet a true.
            CASE WHEN p_partner IS NULL THEN coalesce(p_open_to_join, true) ELSE false END,
            CASE WHEN v_seated THEN NULL ELSE v_last + 1 END);

    IF p_partner IS NOT NULL THEN
      INSERT INTO public.tournament_registrations
             (tournament_id, player_id, side, open_to_join, waitlist_position)
      VALUES (p_tournament, p_partner, 'both', false,
              CASE WHEN v_seated THEN NULL ELSE v_last + 2 END);

      -- Le declencheur de tournaments.sql remplit tournament_participants et
      -- fait echouer ici, sur sa PK, tout joueur deja engage dans un autre
      -- binome de ce tournoi.
      INSERT INTO public.tournament_teams (tournament_id, player1_id, player2_id)
      VALUES (p_tournament, v_me, p_partner)
      RETURNING id INTO v_team;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    -- Course perdue : quelqu'un s'est inscrit ou apparie entre nos controles
    -- et nos ecritures. Tout le sous-bloc est annule.
    RETURN jsonb_build_object('ok', false, 'reason', 'already_registered');
  END;

  PERFORM public.fn_tournament_sync_capacity_status(p_tournament);

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

    v_closed := public.fn_tournament_close_pending_requests(p_tournament, v_me, p_player);
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

  -- Refuse TOUT ce qui reste vivant autour des deux joueurs, la demande
  -- courante comprise...
  v_closed := public.fn_tournament_close_pending_requests(
                v_req.tournament_id, v_me, v_req.from_player);
  -- ... puis rend a la demande courante son vrai statut.
  UPDATE public.tournament_join_requests
     SET status = 'accepted', responded_at = now()
   WHERE id = v_req.id;

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
-- Refus : feature_disabled, not_authenticated, tournament_not_found,
--         tournament_not_open, not_registered, not_in_team.
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
  DELETE FROM public.tournament_teams WHERE id = v_team;

  -- Les deux redeviennent visibles comme cherchant un partenaire. Le mode
  -- « ouvert » leur est rendu : l'inscription a deux l'avait mis a false faute
  -- d'objet, et un joueur redevenu seul doit pouvoir etre rejoint.
  UPDATE public.tournament_registrations
     SET open_to_join = true
   WHERE tournament_id = p_tournament AND player_id IN (v_me, v_mate);

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
-- Refus : feature_disabled, not_authenticated, tournament_not_found,
--         tournament_not_open, not_registered.
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
  IF v_team IS NOT NULL THEN
    DELETE FROM public.tournament_teams WHERE id = v_team;
    UPDATE public.tournament_registrations
       SET open_to_join = true
     WHERE tournament_id = p_tournament AND player_id = v_mate;
  END IF;

  DELETE FROM public.tournament_registrations
   WHERE tournament_id = p_tournament AND player_id = v_me;

  -- Une place ne se libere que si j'en occupais une. Partir depuis la file ne
  -- libere rien, et la promotion serait alors un pur gaspillage d'ecriture.
  IF v_reg.waitlist_position IS NULL THEN
    v_promoted := public.fn_tournament_promote_waitlist(p_tournament);
  ELSE
    PERFORM public.fn_tournament_sync_capacity_status(p_tournament);
  END IF;

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

  RETURN jsonb_build_object('ok', true, 'check_in_status', 'checked_in');
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_check_in(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_check_in(uuid) TO authenticated;

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
-- Refus : feature_disabled, not_authenticated, tournament_not_found,
--         not_the_organizer, tournament_not_open, already_in_team.
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

-- ============================================================================
-- tournament_enter_score(p_match, p_games_a, p_games_b)
--
-- Un binome saisit, l'adversaire confirme. Pas de contestation, pas de motif
-- de rejet, pas d'auto-validation a 24h : le classement se fait aux jeux
-- gagnes, sous les yeux de tous, dans la meme salle.
--
-- Refus : feature_disabled, not_authenticated, match_not_found,
--         not_a_participant, already_confirmed, bye_match,
--         invalid_score, draw_not_allowed, tournament_not_live.
-- Appelable par : les quatre joueurs des deux binomes du match.
--
-- `draw_not_allowed` : le moteur TypeScript traite games_a = games_b comme une
-- victoire de B et note que le cas est "valide en amont, pas ici". C'est ici,
-- l'amont.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_enter_score(p_match uuid, p_games_a int, p_games_b int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me    uuid := public.current_player_id();
  v_m     public.tournament_matches%ROWTYPE;
  v_tstat text;
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
  IF v_m.confirmed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_confirmed');
  END IF;
  IF v_m.team_b IS NULL OR v_m.team_a IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bye_match');
  END IF;

  SELECT t.status INTO v_tstat FROM public.tournaments t WHERE t.id = v_m.tournament_id;
  IF v_tstat NOT IN ('open', 'live') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_live');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tournament_teams tt
     WHERE tt.id IN (v_m.team_a, v_m.team_b)
       AND (tt.player1_id = v_me OR tt.player2_id = v_me)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_participant');
  END IF;

  IF p_games_a IS NULL OR p_games_b IS NULL OR p_games_a < 0 OR p_games_b < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_score');
  END IF;
  IF p_games_a = p_games_b THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'draw_not_allowed');
  END IF;

  UPDATE public.tournament_matches
     SET games_a      = p_games_a,
         games_b      = p_games_b,
         entered_by   = v_me,
         confirmed_by = NULL,
         confirmed_at = NULL
   WHERE id = p_match;

  RETURN jsonb_build_object('ok', true, 'match_id', p_match);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_enter_score(uuid, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_enter_score(uuid, int, int) TO authenticated;

-- ============================================================================
-- tournament_confirm_score(p_match)
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
-- ============================================================================
-- [PLACE VACANTE] tournament_forfeit(p_team) -- le forfait EN COURS de tournoi.
--
-- L'ancienne `tournament_withdraw(p_team)` occupait cette place : elle marquait
-- `tournament_teams.withdrawn` et soldait les matchs restants a 0-6. Elle a ete
-- retiree ici, pour deux raisons, aucune de style :
--   1. le nom `tournament_withdraw` appartient desormais a la desinscription
--      AVANT le tournoi (section « inscription et appariement » ci-dessus), qui
--      prend un tournoi et non un binome -- deux fonctions de meme nom et de
--      meme signature (uuid) ne peuvent pas coexister ;
--   2. son contenu est perime : elle ecrivait `entered_by` / `confirmed_by`,
--      colonnes que le schema livre ne porte plus, et un 0-6 code en dur alors
--      que la regle est devenue « `tournament_matches.forfeited_team` marque le
--      camp forfait, et `tournaments.forfeit_games` (0 par defaut) est credite
--      AUX DEUX camps » -- c'est ce MARQUEUR, pas le score, qui distingue un
--      forfait d'un nul, interdit partout ailleurs.
--
-- A ecrire par la tache « deroulement », sous le nom `tournament_forfeit`.
-- ============================================================================

-- ============================================================================
-- tournament_generate_round(p_tournament)
--
-- Port de `initialCourts` (tour 1) puis `pairUp` (tous les tours) de
-- `lib/tournament.ts`. Le mouvement entre deux tours est porte par
-- `fn_tournament_ladder`, port de `nextCourts`.
--
-- Regle du bye, identique a `pairUp` : un palier a un nombre IMPAIR d equipes
-- donne un bye a celle qui en a eu le MOINS jusqu ici (l id departage), et les
-- autres se rencontrent. Un palier porte 1, 2 ou 3 equipes -- jamais plus :
-- il recoit au plus le perdant du palier du dessus, au plus le gagnant du
-- palier du dessous, et garde au plus une equipe qui vient d y faire un bye.
-- AUCUNE equipe n est jamais laissee sans ligne.
--
-- Refus : feature_disabled, not_authenticated, tournament_not_found,
--         not_the_organizer, tournament_over, tournament_cancelled,
--         not_enough_teams, round_incomplete (avec la liste des matchs
--         manquants), round_already_generated.
-- Appelable par : le createur du tournoi, et lui seul.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_generate_round(p_tournament uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me      uuid := public.current_player_id();
  v_t       public.tournaments%ROWTYPE;
  v_round   int;
  v_teams   int;
  v_placed  int;
  v_jouables int;
  v_cc      int;
  v_missing jsonb;
  v_created int;
  v_byes    int;
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
  IF v_t.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_cancelled');
  END IF;
  IF v_t.status = 'finished' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_over');
  END IF;

  v_round := v_t.current_round + 1;
  IF v_round > v_t.round_count THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_over');
  END IF;

  -- Un tour ne se genere JAMAIS sur des scores incomplets. Les byes sont
  -- exclus du controle : personne ne peut confirmer un match sans adversaire.
  IF v_t.current_round >= 1 THEN
    SELECT jsonb_agg(jsonb_build_object('match_id', m.id, 'court_no', m.court_no)
                     ORDER BY m.court_no)
      INTO v_missing
      FROM public.tournament_matches m
     WHERE m.tournament_id = p_tournament
       AND m.round_no = v_t.current_round
       AND m.team_b IS NOT NULL
       AND m.confirmed_at IS NULL;
    IF v_missing IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'round_incomplete',
                                'missing', v_missing);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.tournament_matches
              WHERE tournament_id = p_tournament AND round_no = v_round) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'round_already_generated');
  END IF;

  IF v_round = 1 THEN
    SELECT count(*)::int INTO v_teams
      FROM public.tournament_teams tt
     WHERE tt.tournament_id = p_tournament AND NOT tt.withdrawn;
    IF v_teams < 2 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_enough_teams');
    END IF;

    -- Nombre de terrains = equipes / 2, arrondi au SUPERIEUR.
    -- `initialCourts` du TypeScript refuse un nombre impair d'equipes ; ici on
    -- ne peut pas se permettre de faire echouer la soiree, et la spec prevoit
    -- explicitement le cas : "nombre impair d'equipes : un bye tournant,
    -- attribue en priorite a qui n'en a pas encore eu". Le ceil place la
    -- derniere equipe seule sur le palier 1, ou `pairUp` lui donne un bye ;
    -- la rotation ensuite est assuree par le tri sur bye_count. Pour un
    -- nombre PAIR -- le seul cas que le TypeScript definit -- ceil(n/2) = n/2 :
    -- aucune divergence possible sur le domaine ou la parite est testable.
    v_cc := (v_teams + 1) / 2;

    -- `tournaments.court_count` est saisi a la creation comme une CAPACITE
    -- prevue (max_teams / 2). Au coup d'envoi il devient le nombre de terrains
    -- REELLEMENT en jeu, faute de quoi le plafond de montee de
    -- `fn_tournament_ladder` serait faux quand tout le monde ne s'inscrit pas.
    UPDATE public.tournaments SET court_count = v_cc WHERE id = p_tournament;

    -- initialCourts : tri sur le niveau du binome (moyenne des deux joueurs),
    -- DECROISSANT, l'id departageant a niveau egal ; le i-eme binome va au
    -- palier courtCount - floor(i / 2). Le plus fort au palier le plus haut.
    WITH lvl AS (
      SELECT tt.id,
             (public.elo_to_level(COALESCE(p1.elo_score, 1000))
            + public.elo_to_level(COALESCE(p2.elo_score, 1000))) / 2.0 AS team_level
        FROM public.tournament_teams tt
        JOIN public.players p1 ON p1.id = tt.player1_id
        JOIN public.players p2 ON p2.id = tt.player2_id
       WHERE tt.tournament_id = p_tournament AND NOT tt.withdrawn
    ),
    ord AS (
      SELECT lvl.id,
             (row_number() OVER (ORDER BY lvl.team_level DESC, lvl.id ASC) - 1) AS i
        FROM lvl
    )
    UPDATE public.tournament_teams tt
       SET start_court = v_cc - (ord.i / 2)::int
      FROM ord
     WHERE tt.id = ord.id;
  ELSE
    v_cc := v_t.court_count;
  END IF;

  -- Gardes AVANT toute ecriture de matchs. Les evaluer APRES l insertion ne
  -- marcherait pas : un refus renvoie {ok:false} sans lever, donc sans
  -- rollback -- il laisserait les lignes derriere lui.
  --
  -- Compter les equipes ne suffit PAS : deux equipes restantes peuvent etre
  -- seules chacune sur son palier, ce qui donne deux byes et AUCUN match. Un
  -- bye ne fait bouger personne, donc tous les tours suivants se
  -- regenereraient a l identique, sans qu un jeu soit joue et sans que le
  -- classement bouge -- une soiree qui tourne a vide en annoncant ok:true.
  -- La vraie condition est qu au moins UN palier porte deux equipes ou plus.
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

  -- Un palier a plus de trois equipes est impossible (cf. l entete). Si ca
  -- arrive, l echelle est corrompue en amont : on LEVE, ce qui annule tout le
  -- tour. Les deux implementations abandonnaient jusqu ici la quatrieme en
  -- silence -- a l identique, donc sans casser la parite, mais un bug futur
  -- de l echelle aurait fait disparaitre un binome sans un mot.
  IF EXISTS (SELECT 1
               FROM public.fn_tournament_ladder(p_tournament, v_round) l
              GROUP BY l.court
             HAVING count(*) > 3) THEN
    RAISE EXCEPTION 'tournament_ladder_corrupt: un palier porte plus de trois equipes (tournoi %, tour %)',
      p_tournament, v_round;
  END IF;

  -- pairUp : sur chaque palier, les equipes sont triees par nombre de byes
  -- deja recus CROISSANT puis par id CROISSANT -- jamais par ordre
  -- d insertion, pour que SQL et TypeScript apparient a l identique.
  WITH st AS (
    SELECT * FROM public.fn_tournament_ladder(p_tournament, v_round)
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
    -- 1. Le bye des paliers IMPAIRS. pos = 1, c est-a-dire l equipe qui a recu
    --    le MOINS de byes jusqu ici, l id departageant : le bye tournant de la
    --    spec. Un palier a 1 equipe et un palier a 3 passent tous deux par ici.
    SELECT p_tournament, v_round, r.court, r.team_id, NULL::uuid
      FROM ranked r
     WHERE r.n % 2 = 1 AND r.pos = 1
    UNION ALL
    -- 2. Le match, entre les deux equipes qui suivent : pos 2 contre pos 3 sur
    --    un palier impair, pos 1 contre pos 2 sur un palier pair. Rien n est
    --    jamais abandonne, puisqu un palier ne porte jamais plus de 3 equipes.
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

  UPDATE public.tournaments
     SET current_round = v_round,
         status        = 'live'
   WHERE id = p_tournament;

  RETURN jsonb_build_object('ok', true, 'round', v_round,
                            'matches', v_created, 'byes', v_byes,
                            'court_count', v_cc);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_generate_round(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_generate_round(uuid) TO authenticated;

-- ============================================================================
-- tournament_reopen_match(p_match)
--
-- Rouvrir un score DETRUIT tous les tours posterieurs et ramene
-- `current_round` au tour du match rouvert. Ces tours ont ete apparies a
-- partir d'un resultat qu'on vient de declarer faux ; les garder produirait
-- une echelle fausse, donc un classement faux. La douleur de rejouer la
-- generation est le prix, et il est assume par la spec.
-- Si le tournoi etait clos, `tournament_results` est efface et le tournoi
-- repasse en `live` : un classement fige a partir de donnees fausses est
-- precisement ce qu'on repare.
--
-- Refus : feature_disabled, not_authenticated, match_not_found,
--         not_the_organizer, tournament_cancelled, not_confirmed.
-- Appelable par : le createur du tournoi, et lui seul.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_reopen_match(p_match uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me      uuid := public.current_player_id();
  v_m       public.tournament_matches%ROWTYPE;
  v_t       public.tournaments%ROWTYPE;
  v_deleted int;
BEGIN
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_m FROM public.tournament_matches WHERE id = p_match;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'match_not_found');
  END IF;

  SELECT * INTO v_t FROM public.tournaments WHERE id = v_m.tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  IF v_t.created_by <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_the_organizer');
  END IF;
  IF v_t.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_cancelled');
  END IF;
  IF v_m.confirmed_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_confirmed');
  END IF;

  DELETE FROM public.tournament_matches
   WHERE tournament_id = v_m.tournament_id
     AND round_no > v_m.round_no;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  UPDATE public.tournament_matches
     SET games_a      = 0,
         games_b      = 0,
         entered_by   = NULL,
         confirmed_by = NULL,
         confirmed_at = NULL
   WHERE id = p_match;

  DELETE FROM public.tournament_results WHERE tournament_id = v_m.tournament_id;

  UPDATE public.tournaments
     SET current_round = v_m.round_no,
         status        = 'live'
   WHERE id = v_m.tournament_id;

  RETURN jsonb_build_object('ok', true, 'round', v_m.round_no,
                            'deleted_matches', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_reopen_match(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_reopen_match(uuid) TO authenticated;

-- ============================================================================
-- tournament_standings(p_tournament, p_max_round DEFAULT NULL) RETURNS jsonb
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

COMMIT;

NOTIFY pgrst, 'reload schema';
