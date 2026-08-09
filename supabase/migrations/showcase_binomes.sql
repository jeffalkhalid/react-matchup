-- react-matchup/supabase/migrations/showcase_binomes.sql
-- ============================================================
-- Binômes ouverts aux défis (vitrine) + marqueur défi ciblé.
--  • showcase_binomes : paire déclarée (nomination → confirmation → fermeture).
--    Plusieurs par joueur ; unique par paire non ordonnée tant que pending/active.
--  • open_games.is_targeted : défi à adversaire nommé (jamais dans « À relever »).
-- Idempotent.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.showcase_binomes (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  player_a    uuid        NOT NULL,   -- nominateur
  player_b    uuid        NOT NULL,   -- invité
  status      text        NOT NULL DEFAULT 'pending',
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT showcase_binomes_pkey PRIMARY KEY (id)
);

ALTER TABLE public.showcase_binomes DROP CONSTRAINT IF EXISTS showcase_binomes_status_chk;
ALTER TABLE public.showcase_binomes
  ADD CONSTRAINT showcase_binomes_status_chk
    CHECK (status = ANY (ARRAY['pending','active','closed']::text[]));

ALTER TABLE public.showcase_binomes DROP CONSTRAINT IF EXISTS showcase_binomes_distinct_chk;
ALTER TABLE public.showcase_binomes
  ADD CONSTRAINT showcase_binomes_distinct_chk CHECK (player_a <> player_b);

ALTER TABLE public.showcase_binomes DROP CONSTRAINT IF EXISTS showcase_binomes_a_fkey;
ALTER TABLE public.showcase_binomes
  ADD CONSTRAINT showcase_binomes_a_fkey FOREIGN KEY (player_a) REFERENCES public.players(id) ON DELETE CASCADE;
ALTER TABLE public.showcase_binomes DROP CONSTRAINT IF EXISTS showcase_binomes_b_fkey;
ALTER TABLE public.showcase_binomes
  ADD CONSTRAINT showcase_binomes_b_fkey FOREIGN KEY (player_b) REFERENCES public.players(id) ON DELETE CASCADE;

-- Unicité par PAIRE non ordonnée, seulement pour les vitrines vivantes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_showcase_pair_live
  ON public.showcase_binomes (least(player_a, player_b), greatest(player_a, player_b))
  WHERE status IN ('pending','active');

CREATE INDEX IF NOT EXISTS idx_showcase_status ON public.showcase_binomes (status);
CREATE INDEX IF NOT EXISTS idx_showcase_a ON public.showcase_binomes (player_a);
CREATE INDEX IF NOT EXISTS idx_showcase_b ON public.showcase_binomes (player_b);

-- ---------- RLS ----------
ALTER TABLE public.showcase_binomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS showcase_select ON public.showcase_binomes;
CREATE POLICY showcase_select ON public.showcase_binomes
  FOR SELECT USING (
    status = 'active'                                   -- vitrine publique
    OR player_a = public.current_player_id()            -- mes vitrines pending
    OR player_b = public.current_player_id()
  );
-- Pas de policy write : uniquement via RPC SECURITY DEFINER.

-- ---------- Marqueur défi ciblé ----------
ALTER TABLE public.open_games
  ADD COLUMN IF NOT EXISTS is_targeted boolean NOT NULL DEFAULT false;

COMMIT;
