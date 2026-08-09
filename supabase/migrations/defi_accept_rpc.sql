-- react-matchup/supabase/migrations/defi_accept_rpc.sql
-- ============================================================
-- Défi 2v2 — le PARTENAIRE d'une candidature accepte → résolution
-- ATOMIQUE de la course :
--   • verrou de la partie (FOR UPDATE) : un seul binôme passe.
--   • si Team B déjà verrouillée → cette candidature 'rejected',
--     retour 'too_late'.
--   • sinon : candidature 'locked', insertion des 2 joueurs en
--     'accepted' côté B, rejet des autres 'pending', partie
--     'confirmed' (spots 0). Retour 'locked'.
-- Re-valide l'éligibilité (l'ELO a pu bouger depuis defi_apply).
-- Les triggers anti-chevauchement ±2h (block_accepted_overlaps)
-- s'appliquent à l'insertion 'accepted' → si un membre est déjà
-- engagé ±2h, l'INSERT lève et toute la transaction est annulée.
-- ============================================================
CREATE OR REPLACE FUNCTION public.defi_accept(p_app_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me        uuid := public.current_player_id();
  v_game_id   uuid;
  v_initiator uuid;
  v_partner   uuid;
  v_app_stat  text;
  v_min       int;
  v_max       int;
  v_avg       numeric;
  v_b_taken   text[];
  v_side_i    text;
  v_side_p    text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- Charger la candidature + verrouiller la PARTIE (sérialise la course)
  SELECT a.game_id, a.initiator_id, a.partner_id, a.status
    INTO v_game_id, v_initiator, v_partner, v_app_stat
    FROM defi_applications a
    WHERE a.id = p_app_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'application not found'; END IF;
  IF v_me <> v_partner THEN RAISE EXCEPTION 'not the invited partner'; END IF;
  IF v_app_stat <> 'pending' THEN RAISE EXCEPTION 'application not pending'; END IF;

  PERFORM 1 FROM open_games WHERE id = v_game_id FOR UPDATE;

  SELECT min_elo, max_elo INTO v_min, v_max FROM open_games WHERE id = v_game_id;

  -- Course déjà gagnée par un autre binôme ?
  IF EXISTS (
    SELECT 1 FROM defi_applications
    WHERE game_id = v_game_id AND status = 'locked'
  ) THEN
    UPDATE defi_applications SET status = 'rejected', resolved_at = now() WHERE id = p_app_id;
    RETURN 'too_late';
  END IF;

  -- Re-valider l'éligibilité (ELO a pu bouger)
  SELECT avg(elo_score) INTO v_avg FROM players WHERE id IN (v_initiator, v_partner);
  IF v_avg < coalesce(v_min, 0) OR v_avg > coalesce(v_max, 999999) THEN
    UPDATE defi_applications SET status = 'rejected', resolved_at = now() WHERE id = p_app_id;
    RAISE EXCEPTION 'binome out of level band';
  END IF;

  -- Sides B libres
  SELECT array_agg(team_side) INTO v_b_taken
    FROM game_participants
    WHERE game_id = v_game_id AND status = 'accepted' AND team_side IN ('B_GAU','B_DRO');
  v_b_taken := coalesce(v_b_taken, '{}'::text[]);
  v_side_i := CASE WHEN 'B_GAU' <> ALL(v_b_taken) THEN 'B_GAU' ELSE 'B_DRO' END;
  v_side_p := CASE WHEN v_side_i = 'B_GAU' THEN 'B_DRO' ELSE 'B_GAU' END;

  -- Verrouiller cette candidature
  UPDATE defi_applications SET status = 'locked', resolved_at = now() WHERE id = p_app_id;

  -- Insérer le binôme côté B (les triggers ±2h peuvent lever ici → rollback)
  INSERT INTO game_participants (game_id, player_id, status, team_side)
    VALUES (v_game_id, v_initiator, 'accepted', v_side_i),
           (v_game_id, v_partner,   'accepted', v_side_p);

  -- Rejeter les autres candidatures encore pending
  UPDATE defi_applications
    SET status = 'rejected', resolved_at = now()
    WHERE game_id = v_game_id AND status = 'pending' AND id <> p_app_id;

  -- Partie complète
  UPDATE open_games SET status = 'confirmed', spots_available = 0 WHERE id = v_game_id;

  RETURN 'locked';
END;
$$;

GRANT EXECUTE ON FUNCTION public.defi_accept(uuid) TO authenticated;
