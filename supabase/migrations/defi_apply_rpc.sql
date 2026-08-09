-- react-matchup/supabase/migrations/defi_apply_rpc.sql
-- ============================================================
-- Défi 2v2 — un joueur POSTULE pour relever un défi, en désignant
-- son partenaire. Crée une defi_applications 'pending'. La place
-- n'est PAS encore prise : il faut que le partenaire accepte
-- (defi_accept) pour verrouiller Team B.
-- Éligibilité : moyenne ELO du binôme ∈ [min_elo, max_elo].
-- ============================================================
CREATE OR REPLACE FUNCTION public.defi_apply(
  p_game_id    uuid,
  p_partner_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me        uuid := public.current_player_id();
  v_is_chal   boolean;
  v_status    text;
  v_min       int;
  v_max       int;
  v_avg       numeric;
  v_app_id    uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_partner_id IS NULL OR p_partner_id = v_me THEN
    RAISE EXCEPTION 'invalid partner';
  END IF;

  -- Verrou sur la partie (sérialise vs defi_accept concurrents)
  SELECT is_challenge, status, min_elo, max_elo
    INTO v_is_chal, v_status, v_min, v_max
    FROM open_games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'game not found'; END IF;
  IF v_is_chal IS NOT TRUE THEN RAISE EXCEPTION 'not a defi'; END IF;
  IF v_status <> 'open' THEN RAISE EXCEPTION 'defi not open'; END IF;

  -- Ni moi ni mon partenaire déjà dans la partie (créateur/participant)
  IF EXISTS (
    SELECT 1 FROM open_games g
    WHERE g.id = p_game_id AND g.creator_id IN (v_me, p_partner_id)
  ) OR EXISTS (
    SELECT 1 FROM game_participants gp
    WHERE gp.game_id = p_game_id AND gp.player_id IN (v_me, p_partner_id)
      AND gp.status IN ('accepted','invited')
  ) THEN
    RAISE EXCEPTION 'player already in game';
  END IF;

  -- Éligibilité : moyenne ELO du binôme dans la bande
  SELECT avg(elo_score) INTO v_avg FROM players WHERE id IN (v_me, p_partner_id);
  IF v_avg < coalesce(v_min, 0) OR v_avg > coalesce(v_max, 999999) THEN
    RAISE EXCEPTION 'binome out of level band';
  END IF;

  -- Une seule candidature pending par initiateur sur ce défi : on remplace.
  UPDATE defi_applications
    SET status = 'cancelled', resolved_at = now()
    WHERE game_id = p_game_id AND initiator_id = v_me AND status = 'pending';

  INSERT INTO defi_applications (game_id, initiator_id, partner_id, status)
    VALUES (p_game_id, v_me, p_partner_id, 'pending')
    RETURNING id INTO v_app_id;

  RETURN v_app_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.defi_apply(uuid, uuid) TO authenticated;
