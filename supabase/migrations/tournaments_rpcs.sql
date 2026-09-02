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

-- ============================================================================
-- tournament_register(p_tournament, p_partner)
--
-- Le binome est cree IMMEDIATEMENT, sans etat d'attente : une place reservee
-- a un binome non confirme est exactement la classe de bug de
-- `spots_available`.
--
-- Refus : feature_disabled, not_authenticated, tournament_not_found,
--         invalid_partner, partner_not_found, tournament_not_open,
--         tournament_full, already_registered.
-- Appelable par : tout joueur connecte (pour lui-meme).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_register(p_tournament uuid, p_partner uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me     uuid := public.current_player_id();
  v_status text;
  v_max    int;
  v_taken  int;
  v_team   uuid;
BEGIN
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;
  IF p_partner IS NULL OR p_partner = v_me THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_partner');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = p_partner) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'partner_not_found');
  END IF;

  -- FOR UPDATE : serialise les inscriptions concurrentes, sinon deux binomes
  -- peuvent lire la meme derniere place libre.
  SELECT t.status, t.max_teams INTO v_status, v_max
    FROM public.tournaments t WHERE t.id = p_tournament FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  IF v_status <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_open');
  END IF;

  -- Un binome forfait ne bloque plus une place : ses DEUX joueurs restent
  -- interdits de reinscription (la ligne `tournament_participants` survit),
  -- mais la place peut etre reprise par un autre binome.
  SELECT count(*) INTO v_taken
    FROM public.tournament_teams tt
   WHERE tt.tournament_id = p_tournament AND NOT tt.withdrawn;
  IF v_taken >= v_max THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_full');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tournament_participants tp
     WHERE tp.tournament_id = p_tournament AND tp.player_id IN (v_me, p_partner)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_registered');
  END IF;

  BEGIN
    INSERT INTO public.tournament_teams (tournament_id, player1_id, player2_id)
    VALUES (p_tournament, v_me, p_partner)
    RETURNING id INTO v_team;
  EXCEPTION WHEN unique_violation THEN
    -- Filet : le trigger qui alimente `tournament_participants` rejette le
    -- doublon a l'insertion du BINOME. Le test ci-dessus l'attrape presque
    -- toujours ; ce bloc couvre la course entre deux inscriptions simultanees
    -- sur des tournois differents partageant un joueur.
    RETURN jsonb_build_object('ok', false, 'reason', 'already_registered');
  END;

  RETURN jsonb_build_object('ok', true, 'team_id', v_team);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_register(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_register(uuid, uuid) TO authenticated;

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
-- tournament_withdraw(p_team)
--
-- HUITIEME fonction, absente de la liste du brief : le plan decide que
-- "les matchs deja generes et non joues d'un binome qui declare forfait sont
-- enregistres 0-6 au moment du forfait", et ne designe aucune fonction ou le
-- faire. La regle vit donc ici, au seul endroit ou l'information existe --
-- `tournament_standings` ne peut pas la synthetiser : elle ne sait pas
-- combien de tours restaient.
--
-- Effets :
--   1. `tournament_teams.withdrawn = true` -- definitif pour ce tournoi. Les
--      lignes `tournament_participants` survivent, donc les deux joueurs ne
--      peuvent pas se reinscrire ; la PLACE, elle, redevient disponible.
--   2. Tout match DEJA GENERE et NON CONFIRME impliquant ce binome est
--      enregistre 0-6 contre lui, et confirme sur-le-champ. Sans la
--      confirmation la regle n'aurait aucun effet : `tournament_standings`
--      ne compte que les matchs confirmes.
--   3. Les byes du binome (team_b IS NULL) sont laisses tels quels : un bye
--      n'a pas de score et n'entre jamais dans le classement.
-- A partir du tour suivant, le binome est exclu de l'echelle : son adversaire
-- se retrouve seul sur son palier et recoit un bye, comme le veut la spec.
--
-- Refus : feature_disabled, not_authenticated, team_not_found,
--         not_allowed, already_withdrawn, tournament_over.
-- Appelable par : les deux joueurs du binome, ou le createur du tournoi.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_withdraw(p_team uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me      uuid := public.current_player_id();
  v_tt      public.tournament_teams%ROWTYPE;
  v_creator uuid;
  v_status  text;
  v_forfeit int := 0;
BEGIN
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_tt FROM public.tournament_teams WHERE id = p_team FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'team_not_found');
  END IF;

  SELECT t.created_by, t.status INTO v_creator, v_status
    FROM public.tournaments t WHERE t.id = v_tt.tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;

  IF v_me <> v_creator AND v_me <> v_tt.player1_id AND v_me <> v_tt.player2_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;
  IF v_tt.withdrawn THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_withdrawn');
  END IF;
  IF v_status IN ('finished', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_over');
  END IF;

  UPDATE public.tournament_teams SET withdrawn = true WHERE id = p_team;

  -- 0-6 contre le forfait, sur ses matchs generes et non confirmes.
  WITH f AS (
    UPDATE public.tournament_matches m
       SET games_a      = CASE WHEN m.team_a = p_team THEN 0 ELSE 6 END,
           games_b      = CASE WHEN m.team_b = p_team THEN 0 ELSE 6 END,
           entered_by   = COALESCE(m.entered_by, v_me),
           confirmed_by = v_me,
           confirmed_at = now()
     WHERE m.tournament_id = v_tt.tournament_id
       AND m.confirmed_at IS NULL
       AND m.team_a IS NOT NULL
       AND m.team_b IS NOT NULL
       AND (m.team_a = p_team OR m.team_b = p_team)
    RETURNING 1
  )
  SELECT count(*)::int INTO v_forfeit FROM f;

  RETURN jsonb_build_object('ok', true, 'team_id', p_team, 'forfeited_matches', v_forfeit);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_withdraw(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_withdraw(uuid) TO authenticated;

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
