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

-- Garde-fou : on valide UNIQUEMENT le domaine de valeur du stake — soit 1.0
-- (neutre : non-défis ET anciens défis créés avant la mise), soit la plage
-- défi [1.5, 3.0]. On ne couple PAS à is_challenge : des open_games
-- is_challenge=true existent déjà (type « Défi » de l'ancien wizard) et ont
-- hérité du défaut 1.0 — les coupler casserait la contrainte sur l'existant.
-- Les nouveaux défis (Phase 2) poseront toujours une valeur dans [1.5, 3.0],
-- et max_elo >= min_elo est garanti côté création (curseur borné au plancher).
ALTER TABLE public.open_games DROP CONSTRAINT IF EXISTS open_games_defi_stake_chk;
ALTER TABLE public.open_games
  ADD CONSTRAINT open_games_defi_stake_chk CHECK (
    stake_multiplier = 1.0
    OR (stake_multiplier >= 1.5 AND stake_multiplier <= 3.0)
  );

COMMIT;
