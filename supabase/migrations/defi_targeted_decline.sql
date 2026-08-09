-- react-matchup/supabase/migrations/defi_targeted_decline.sql
-- ============================================================
-- Défi CIBLÉ — gestion du refus.
--  • Décline B_* (un membre du binôme ciblé) → CONVERSION en défi ouvert :
--     is_targeted=false, Team B vidée, bande posée (plancher = moyenne niveau
--     Team A, plafond = plancher+1.5), status='open', spots_available=2.
--  • Décline A_* (mon partenaire) → ANNULATION (status='cancelled').
-- Ne s'applique qu'aux open_games is_challenge AND is_targeted, non terminales.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_defi_targeted_decline()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_is_tgt   boolean;
  v_status   text;
  v_creator  uuid;
  v_a_elo    numeric;
  v_p_elo    numeric;
  v_floor_lv numeric;
BEGIN
  IF NOT (NEW.status = 'declined' AND OLD.status IS DISTINCT FROM 'declined') THEN
    RETURN NEW;
  END IF;

  SELECT is_targeted, status, creator_id INTO v_is_tgt, v_status, v_creator
    FROM open_games WHERE id = NEW.game_id FOR UPDATE;
  IF v_is_tgt IS NOT TRUE OR v_status IN ('confirmed','cancelled','closed') THEN
    RETURN NEW;
  END IF;

  IF (NEW.team_side LIKE 'A%') THEN
    -- Mon partenaire décline → annulation
    UPDATE open_games SET status = 'cancelled' WHERE id = NEW.game_id;
    RETURN NEW;
  END IF;

  -- Sinon : membre du binôme ciblé (B_*) décline → conversion en ouvert.
  -- Niveaux de Team A : créateur + son partenaire (participant A_*).
  SELECT elo_score INTO v_a_elo FROM players WHERE id = v_creator;
  SELECT p.elo_score INTO v_p_elo
    FROM game_participants gp JOIN players p ON p.id = gp.player_id
    WHERE gp.game_id = NEW.game_id AND gp.team_side LIKE 'A%' AND gp.player_id <> v_creator
    LIMIT 1;
  v_floor_lv := (public.elo_to_level(coalesce(v_a_elo,1000)) + public.elo_to_level(coalesce(v_p_elo, v_a_elo))) / 2.0;

  -- Vider Team B (retirer les 2 invités ciblés).
  DELETE FROM game_participants
    WHERE game_id = NEW.game_id AND team_side LIKE 'B%';

  UPDATE open_games SET
    is_targeted = false,
    min_elo = public.level_to_elo(v_floor_lv),
    max_elo = public.level_to_elo(least(8.0, v_floor_lv + 1.5)),
    status = 'open',
    spots_available = 2
  WHERE id = NEW.game_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_defi_targeted_decline ON public.game_participants;
CREATE TRIGGER trg_defi_targeted_decline
  AFTER UPDATE ON public.game_participants
  FOR EACH ROW EXECUTE FUNCTION public.fn_defi_targeted_decline();

COMMIT;
