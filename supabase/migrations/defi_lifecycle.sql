-- react-matchup/supabase/migrations/defi_lifecycle.sql
-- ============================================================
-- Défi 2v2 — cycle de vie : annulation par le créateur + expiration
-- des candidatures pending orphelines (anti-ghost).
-- Idempotent. Le bloc cron suit le pattern de invite_expiry.sql.
-- ============================================================
BEGIN;

-- ---------- Annulation par le créateur ----------
-- Passe le défi (draft|open) en 'cancelled' et annule ses candidatures pending.
-- Refusé si pas créateur / pas un défi / déjà confirmé.
CREATE OR REPLACE FUNCTION public.cancel_defi(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := public.current_player_id();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  UPDATE open_games
    SET status = 'cancelled'
    WHERE id = p_game_id
      AND creator_id = v_me
      AND is_challenge IS TRUE
      AND status IN ('draft', 'open');
  IF NOT FOUND THEN RAISE EXCEPTION 'defi not cancellable'; END IF;

  UPDATE defi_applications
    SET status = 'cancelled', resolved_at = now()
    WHERE game_id = p_game_id AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_defi(uuid) TO authenticated;

-- ---------- Expiration des candidatures pending orphelines ----------
-- Annule une candidature pending si : son défi n'est plus 'open'
-- (annulé/confirmé/fermé) OU elle a été créée il y a plus de 48 h.
CREATE OR REPLACE FUNCTION public.expire_stale_defi_applications()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE defi_applications a
    SET status = 'cancelled', resolved_at = now()
    WHERE a.status = 'pending'
      AND (
        a.created_at < now() - interval '48 hours'
        OR NOT EXISTS (
          SELECT 1 FROM open_games g
          WHERE g.id = a.game_id AND g.status = 'open'
        )
      );
$$;

GRANT EXECUTE ON FUNCTION public.expire_stale_defi_applications() TO service_role;

-- ---------- Planification (pg_cron, toutes les 15 min) ----------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'expire-stale-defi-applications',
      '*/15 * * * *',
      $cron$ SELECT public.expire_stale_defi_applications(); $cron$
    );
  ELSE
    RAISE NOTICE 'pg_cron non activé : active l''extension puis ré-exécute ce bloc DO.';
  END IF;
END $$;

COMMIT;
