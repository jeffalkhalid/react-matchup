-- react-matchup/supabase/migrations/defi_stake_column.sql
-- ============================================================
-- Défi 2v2 — colonne de MISE (stake_multiplier).
-- Multiplie le delta ELO du match. Défaut 1.0 → neutre pour
-- toute partie non-défi. Plage défi : [1.5, 3.0].
-- Idempotent (rejouable prod + vierge).
-- ============================================================
BEGIN;

ALTER TABLE public.open_games
  ADD COLUMN IF NOT EXISTS stake_multiplier numeric(3,2) NOT NULL DEFAULT 1.0;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS stake_multiplier numeric(3,2) NOT NULL DEFAULT 1.0;

-- Garde-fou : un défi (is_challenge) doit avoir une mise dans [1.5, 3.0]
-- ET un plafond >= plancher (max_elo >= min_elo). Les non-défis : stake = 1.0.
ALTER TABLE public.open_games DROP CONSTRAINT IF EXISTS open_games_defi_stake_chk;
ALTER TABLE public.open_games
  ADD CONSTRAINT open_games_defi_stake_chk CHECK (
    (is_challenge IS NOT TRUE AND stake_multiplier = 1.0)
    OR
    (is_challenge IS TRUE
      AND stake_multiplier >= 1.5 AND stake_multiplier <= 3.0
      AND coalesce(max_elo, 0) >= coalesce(min_elo, 0))
  );

COMMIT;
