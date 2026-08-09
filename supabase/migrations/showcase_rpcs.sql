-- react-matchup/supabase/migrations/showcase_rpcs.sql
-- ============================================================
-- Cycle de vie d'un binôme en vitrine (écriture via SECURITY DEFINER).
-- ============================================================

-- Nominer un partenaire → vitrine 'pending'. Refuse si une vitrine vivante
-- existe déjà pour ce couple (l'index unique le garantit aussi).
CREATE OR REPLACE FUNCTION public.showcase_open(p_partner_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_me uuid := public.current_player_id();
  v_id uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_partner_id IS NULL OR p_partner_id = v_me THEN RAISE EXCEPTION 'invalid partner'; END IF;
  IF EXISTS (
    SELECT 1 FROM showcase_binomes
    WHERE status IN ('pending','active')
      AND least(player_a,player_b) = least(v_me,p_partner_id)
      AND greatest(player_a,player_b) = greatest(v_me,p_partner_id)
  ) THEN
    RAISE EXCEPTION 'showcase already exists for this pair';
  END IF;
  INSERT INTO showcase_binomes (player_a, player_b, status)
    VALUES (v_me, p_partner_id, 'pending')
    RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.showcase_open(uuid) TO authenticated;

-- Le partenaire nommé confirme → 'active'.
CREATE OR REPLACE FUNCTION public.showcase_confirm(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_me uuid := public.current_player_id();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE showcase_binomes
    SET status = 'active', resolved_at = now()
    WHERE id = p_id AND player_b = v_me AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'not confirmable'; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.showcase_confirm(uuid) TO authenticated;

-- L'un des deux ferme (à tout moment) → 'closed'.
CREATE OR REPLACE FUNCTION public.showcase_close(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_me uuid := public.current_player_id();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE showcase_binomes
    SET status = 'closed', resolved_at = now()
    WHERE id = p_id AND (player_a = v_me OR player_b = v_me) AND status IN ('pending','active');
  IF NOT FOUND THEN RAISE EXCEPTION 'not closable'; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.showcase_close(uuid) TO authenticated;
