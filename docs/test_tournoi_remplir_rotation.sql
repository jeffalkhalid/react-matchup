-- ============================================================
-- TEST SEULEMENT — remplir les terrains d'une rotation, pour tester seul.
--
-- A lancer dans l'editeur SQL de Supabase. JAMAIS depuis l'app, et ce n'est
-- PAS une migration : aucune fonction n'est creee, rien n'est expose aux
-- joueurs.
--
-- POURQUOI UN SCRIPT ET PAS UN BOUTON DANS L'APP. Un bouton « remplir les
-- scores » serait une porte ouverte : l'audit de securite du 2026-09-14 a
-- montre que n'importe qui peut aujourd'hui se declarer admin et creer un
-- tournoi. Tout outil de test ajoute a l'app serait donc utilisable par
-- tout le monde, pour fabriquer des resultats et crediter des points. Ce
-- script, lui, ne s'execute qu'avec l'acces a l'editeur SQL — c'est-a-dire
-- avec les droits du proprietaire de la base.
--
-- ⚠️ IL ECRIT DES SCORES AU NOM DE JOUEURS REELS. A lancer UNIQUEMENT sur un
-- tournoi cree pour tester, avec des comptes qui vous appartiennent. Sur une
-- vraie soiree, il fabriquerait les resultats de gens qui n'ont rien saisi.
--
-- CE QU'IL FAIT : pour chaque terrain de la rotation EN COURS ou personne n'a
-- rien saisi, il pose un score aleatoire (jamais d'egalite). Les terrains ou
-- VOUS jouez sont laisses de cote — vous les jouez dans l'app, le reste du
-- gymnase est simule. Il ne touche jamais un terrain deja saisi, ni un
-- forfait, ni un repos.
--
-- DEUX MODES, pour tester les deux chemins de tournament_enter_score :
--   * v_accord = true  -> les DEUX camps saisissent le meme score : terrain
--     « acquis », comme apres une confirmation ;
--   * v_accord = false -> UN SEUL camp saisit : terrain « provisoire », le
--     score compte mais n'est pas confirme. C'est le cas que la migration
--     tournament_score_no_wait.sql a rendu non bloquant — le verifier ici,
--     c'est verifier qu'on peut tirer la rotation suivante sans attendre.
--
-- AUCUN EFFET DE BORD CACHE : il n'existe aucun declencheur sur
-- tournament_matches ni tournament_match_entries (verifie le 2026-09-14). Les
-- points ne sont credites qu'a `tournament_validate`, en fin de tournoi.
--
-- MODE D'EMPLOI
--   1. Remplacez l'identifiant du tournoi ci-dessous (deux endroits : l'apercu
--      et le bloc d'ecriture).
--   2. Mettez votre player_id dans v_moi pour garder VOTRE terrain, ou NULL
--      pour tout remplir.
--   3. Lancez l'APERCU seul, lisez-le.
--   4. Lancez le bloc d'ecriture.
--   5. Dans l'app, onglet Admin : « Tirer le tour suivant ». Recommencez.
-- ============================================================


-- ------------------------------------------------------------
-- 1) APERCU — lecture seule. Ce qui SERAIT rempli.
-- ------------------------------------------------------------
SELECT t.name, t.status, t.current_round,
       m.court_no,
       (SELECT count(*) FROM public.tournament_match_entries e WHERE e.match_id = m.id) AS saisies_deja,
       m.games_a, m.games_b, m.confirmed_at IS NOT NULL AS confirme
  FROM public.tournaments t
  JOIN public.tournament_matches m
    ON m.tournament_id = t.id AND m.round_no = t.current_round
 WHERE t.id = '00000000-0000-0000-0000-000000000000'   -- <<< VOTRE TOURNOI
 ORDER BY m.court_no;


-- ------------------------------------------------------------
-- 2) ECRITURE — remplit les terrains vides de la rotation en cours.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_tid    uuid    := '00000000-0000-0000-0000-000000000000';  -- <<< VOTRE TOURNOI
  v_moi    uuid    := NULL;   -- <<< votre player_id pour garder VOTRE terrain, ou NULL
  v_accord boolean := true;   -- true = terrain acquis · false = une seule saisie (provisoire)

  v_status text;
  v_round  int;
  r        record;
  v_a      int;
  v_b      int;
  v_rempli int := 0;
  v_saute  int := 0;
BEGIN
  SELECT status, current_round INTO v_status, v_round
    FROM public.tournaments WHERE id = v_tid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournoi % introuvable.', v_tid;
  END IF;
  -- Meme garde que tournament_enter_score : on ne saisit que pendant la soiree.
  IF v_status <> 'EN_COURS' OR coalesce(v_round, 0) = 0 THEN
    RAISE EXCEPTION 'Tournoi en statut % (rotation %) : il faut EN_COURS et un tour tire.',
      v_status, v_round;
  END IF;

  FOR r IN
    SELECT m.id, m.court_no,
           ta.player1_id AS a_p1, ta.player2_id AS a_p2,
           tb.player1_id AS b_p1, tb.player2_id AS b_p2
      FROM public.tournament_matches m
      JOIN public.tournament_teams ta ON ta.tournament_id = m.tournament_id AND ta.id = m.team_a
      JOIN public.tournament_teams tb ON tb.tournament_id = m.tournament_id AND tb.id = m.team_b
     WHERE m.tournament_id = v_tid
       AND m.round_no      = v_round
       AND m.team_b       IS NOT NULL     -- pas les repos
       AND m.forfeited_team IS NULL       -- pas les forfaits
       AND m.games_a      IS NULL         -- JAMAIS un terrain deja saisi
     ORDER BY m.court_no
  LOOP
    -- Votre terrain : vous le jouez dans l'app.
    IF v_moi IS NOT NULL AND v_moi IN (r.a_p1, r.a_p2, r.b_p1, r.b_p2) THEN
      v_saute := v_saute + 1;
      CONTINUE;
    END IF;

    -- Un score plausible sur vingt minutes, JAMAIS a egalite
    -- (tournament_enter_score refuserait `draw_not_allowed`).
    v_a := 3 + floor(random() * 6)::int;          -- 3..8
    v_b := floor(random() * v_a)::int;            -- 0..(v_a - 1)
    IF random() < 0.5 THEN                        -- vainqueur tire au sort
      SELECT v_b, v_a INTO v_a, v_b;
    END IF;

    INSERT INTO public.tournament_match_entries
           (tournament_id, match_id, player_id, games_a, games_b)
    VALUES (v_tid, r.id, r.a1, v_a, v_b)
    ON CONFLICT (match_id, player_id) DO NOTHING;

    IF v_accord THEN
      INSERT INTO public.tournament_match_entries
             (tournament_id, match_id, player_id, games_a, games_b)
      VALUES (v_tid, r.id, r.b1, v_a, v_b)
      ON CONFLICT (match_id, player_id) DO NOTHING;
    END IF;

    -- Meme ecriture que tournament_enter_score apres tournament_score_no_wait.sql :
    -- le score est pose des la premiere saisie, `confirmed_at` seulement sur
    -- accord.
    UPDATE public.tournament_matches
       SET games_a        = v_a,
           games_b        = v_b,
           forfeited_team = NULL,
           confirmed_at   = CASE WHEN v_accord THEN now() ELSE confirmed_at END
     WHERE id = r.id;

    v_rempli := v_rempli + 1;
    RAISE NOTICE 'Terrain % : % - %  (%)', r.court_no, v_a, v_b,
      CASE WHEN v_accord THEN 'acquis' ELSE 'provisoire, une seule saisie' END;
  END LOOP;

  RAISE NOTICE 'Rotation % : % terrain(s) rempli(s), % laisse(s) pour vous.',
    v_round, v_rempli, v_saute;

  -- Ce script ecrit les scores DIRECTEMENT, sans passer par
  -- tournament_enter_score : le tirage automatique ne serait donc jamais
  -- declenche. On l'appelle ici, comme le fait la saisie. S'il reste votre
  -- terrain a jouer, le moteur refuse (rotation incomplete) et rien ne part ;
  -- c'est votre saisie dans l'app qui fera partir la rotation.
  --
  -- Garde d'existence : si tournament_auto_advance.sql n'est pas encore
  -- appliquee, la fonction n'existe pas et le bloc entier echouerait —
  -- annulant les scores qu'il vient de poser.
  IF to_regprocedure('public.fn_tournament_try_advance(uuid)') IS NOT NULL THEN
    PERFORM public.fn_tournament_try_advance(v_tid);
    RAISE NOTICE 'Tirage automatique tente (il ne part que si tous les terrains ont un score).';
  ELSE
    RAISE NOTICE 'tournament_auto_advance.sql non appliquee : tirez la rotation depuis l''onglet Admin.';
  END IF;
END $$;
