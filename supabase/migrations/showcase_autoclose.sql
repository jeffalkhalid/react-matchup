-- react-matchup/supabase/migrations/showcase_autoclose.sql
-- ============================================================
-- Auto-fermeture des binômes en vitrine quand un défi (is_challenge) se
-- confirme : on ferme les showcase_binomes 'active' dont la paire = la paire
-- Team A OU la paire Team B des joueurs ACCEPTÉS du défi.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_showcase_autoclose()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  a_ids uuid[];
  b_ids uuid[];
BEGIN
  IF NOT (NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed'
          AND NEW.is_challenge IS TRUE) THEN
    RETURN NEW;
  END IF;

  -- Paire Team A = créateur + participant A_* accepté ; Team B = 2 participants B_* acceptés.
  SELECT array_agg(player_id) INTO a_ids FROM (
    SELECT NEW.creator_id AS player_id
    UNION
    SELECT gp.player_id FROM game_participants gp
      WHERE gp.game_id = NEW.id AND gp.status='accepted' AND gp.team_side LIKE 'A%'
  ) s;
  SELECT array_agg(gp.player_id) INTO b_ids FROM game_participants gp
    WHERE gp.game_id = NEW.id AND gp.status='accepted' AND gp.team_side LIKE 'B%';

  -- Ferme la vitrine active dont la paire = {a_ids} (2 joueurs) ou {b_ids}.
  IF array_length(a_ids,1) = 2 THEN
    UPDATE showcase_binomes SET status='closed', resolved_at=now()
    WHERE status='active'
      AND least(player_a,player_b) = least(a_ids[1],a_ids[2])
      AND greatest(player_a,player_b) = greatest(a_ids[1],a_ids[2]);
  END IF;
  IF array_length(b_ids,1) = 2 THEN
    UPDATE showcase_binomes SET status='closed', resolved_at=now()
    WHERE status='active'
      AND least(player_a,player_b) = least(b_ids[1],b_ids[2])
      AND greatest(player_a,player_b) = greatest(b_ids[1],b_ids[2]);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_showcase_autoclose ON public.open_games;
CREATE TRIGGER trg_showcase_autoclose
  AFTER UPDATE ON public.open_games
  FOR EACH ROW EXECUTE FUNCTION public.fn_showcase_autoclose();

COMMIT;
