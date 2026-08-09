-- react-matchup/supabase/migrations/defi_applications.sql
-- ============================================================
-- Défi 2v2 — candidature-BINÔME pour relever un défi.
-- Une candidature = (initiateur + partenaire). Elle ne verrouille
-- Team B que lorsque le partenaire ACCEPTE (RPC defi_accept).
-- Course : premier binôme complet → 'locked', les autres 'rejected'.
-- Écriture exclusivement via RPC SECURITY DEFINER (pas de policy write).
-- Idempotent.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.defi_applications (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  game_id      uuid        NOT NULL,
  initiator_id uuid        NOT NULL,
  partner_id   uuid        NOT NULL,
  status       text        NOT NULL DEFAULT 'pending',
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  CONSTRAINT defi_applications_pkey PRIMARY KEY (id)
);

ALTER TABLE public.defi_applications DROP CONSTRAINT IF EXISTS defi_applications_status_chk;
ALTER TABLE public.defi_applications
  ADD CONSTRAINT defi_applications_status_chk
    CHECK (status = ANY (ARRAY['pending','locked','rejected','cancelled']::text[]));

ALTER TABLE public.defi_applications DROP CONSTRAINT IF EXISTS defi_applications_game_fkey;
ALTER TABLE public.defi_applications
  ADD CONSTRAINT defi_applications_game_fkey
    FOREIGN KEY (game_id) REFERENCES public.open_games(id) ON DELETE CASCADE;

ALTER TABLE public.defi_applications DROP CONSTRAINT IF EXISTS defi_applications_initiator_fkey;
ALTER TABLE public.defi_applications
  ADD CONSTRAINT defi_applications_initiator_fkey
    FOREIGN KEY (initiator_id) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE public.defi_applications DROP CONSTRAINT IF EXISTS defi_applications_partner_fkey;
ALTER TABLE public.defi_applications
  ADD CONSTRAINT defi_applications_partner_fkey
    FOREIGN KEY (partner_id) REFERENCES public.players(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_defi_apps_game_status
  ON public.defi_applications (game_id, status);

-- ---------- RLS : lecture pour les parties prenantes, écriture via RPC ----------
ALTER TABLE public.defi_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS defi_apps_select ON public.defi_applications;
CREATE POLICY defi_apps_select ON public.defi_applications
  FOR SELECT USING (
    initiator_id = public.current_player_id()
    OR partner_id = public.current_player_id()
    OR EXISTS (
      SELECT 1 FROM public.open_games g
      WHERE g.id = defi_applications.game_id
        AND g.creator_id = public.current_player_id()
    )
  );
-- Pas de policy INSERT/UPDATE/DELETE : seules les fonctions SECURITY DEFINER écrivent.

COMMIT;
