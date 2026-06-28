-- react-matchup/supabase/migrations/defi_draft_publish.sql
-- ============================================================
-- Défi 2v2 — publication différée.
-- Un défi est créé en status='draft' (invisible). Dès que le
-- partenaire du créateur (invité côté Team A) ACCEPTE son invitation
-- (game_participants.status → 'accepted'), le défi passe 'open' et
-- devient visible / candidatable. Aucune autre transition n'est
-- touchée. open_games.status n'a pas de CHECK → 'draft' est libre.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_publish_defi_on_partner_accept()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    UPDATE public.open_games
      SET status = 'open'
      WHERE id = NEW.game_id
        AND is_challenge IS TRUE
        AND status = 'draft';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_publish_defi_on_partner_accept ON public.game_participants;
CREATE TRIGGER trg_publish_defi_on_partner_accept
  AFTER UPDATE ON public.game_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_publish_defi_on_partner_accept();

COMMIT;
