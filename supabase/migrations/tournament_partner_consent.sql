-- ============================================================
-- Binome defait : celui qui SUBIT se referme.
--
-- ORDRE D'APPLICATION - il n'y a pas de runner, un humain applique a la main.
-- Ce fichier remplace public.tournament_leave_team et
-- public.fn_tournament_withdraw_player, toutes deux de tournaments_rpcs.sql.
-- Les corps sont repris MOT POUR MOT, seule l'ecriture ci-dessous est ajoutee.
--
-- LA REGLE, ET SA LIMITE. tournaments_rpcs.sql pose que `open_to_join`
-- « n'appartient qu'a son proprietaire », et c'est juste pour celui qui AGIT :
-- defaire son binome ou se desinscrire est un choix, son mode reste le sien.
--
-- Mais son partenaire, lui, N'A RIEN CHOISI. Il se retrouve seul sans l'avoir
-- demande, et s'il etait ouvert, n'importe qui peut se coller a lui d'un seul
-- geste -- un binome subi, deux fois de suite. On le referme donc : desormais
-- on doit LUI DEMANDER, et il decide. Il rouvre quand il veut, par
-- tournament_set_open_to_join.
--
-- Ce que ca ne change PAS : il garde sa place, son rang de file et son cote.
-- Seul son consentement redevient explicite.
-- ============================================================
BEGIN;

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
  -- CELUI QUI SUBIT SE REFERME. Le commentaire ci-dessus dit vrai pour celui
  -- qui AGIT : son mode lui appartient, on n'y touche pas. Mais son binome,
  -- lui, n'a rien choisi -- il se retrouve seul sans l'avoir demande, et
  -- ouvert, n'importe qui pourrait se coller a lui d'un geste. On le referme :
  -- il rouvrira lui-meme s'il le veut (tournament_set_open_to_join).
  IF v_mate IS NOT NULL THEN
    UPDATE public.tournament_registrations
       SET open_to_join = false
     WHERE tournament_id = p_tournament AND player_id = v_mate;
  END IF;

  -- Ici l'appel n'est PAS decoratif : un binome en attente qui se defait
  -- devient deux candidats de taille 1, et un siege qui ne pouvait pas
  -- accueillir le binome peut accueillir l'un d'eux.
  PERFORM public.fn_tournament_promote_waitlist(p_tournament);

  RETURN jsonb_build_object('ok', true, 'team_id', v_team, 'partner_id', v_mate);
END;
$$;

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
    -- CELUI QUI RESTE SE REFERME : il n'a pas choisi de se retrouver seul.
    -- Meme regle que dans tournament_leave_team.
    IF v_mate IS NOT NULL THEN
      UPDATE public.tournament_registrations
         SET open_to_join = false
       WHERE tournament_id = p_tournament AND player_id = v_mate;
    END IF;
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

COMMIT;

NOTIFY pgrst, 'reload schema';
