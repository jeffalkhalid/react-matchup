-- ============================================================
-- App montre — verrou d'appareil de saisie + moteur commun.
-- Cf. spec §7 (idempotence) et §8 (garde-fou).
--
-- ⚠️ apply_live_event CHANGE DE SIGNATURE (ajout de p_claim). L'ancienne
-- 3-args est DROPée d'abord : deux surcharges rendraient l'appel PostgREST
-- ambigu (piège déjà rencontré sur start_live_session).
-- ============================================================
BEGIN;

ALTER TABLE public.live_match_sessions
  ADD COLUMN IF NOT EXISTS input_device    text NOT NULL DEFAULT 'phone',
  ADD COLUMN IF NOT EXISTS input_device_at timestamptz;

ALTER TABLE public.live_match_events
  ADD COLUMN IF NOT EXISTS watch_link_id uuid REFERENCES public.watch_links(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_seq    int;

-- IDEMPOTENCE — sans cet index, un renvoi de la file offline double le point.
CREATE UNIQUE INDEX IF NOT EXISTS live_events_watch_idem
  ON public.live_match_events (session_id, watch_link_id, client_seq)
  WHERE watch_link_id IS NOT NULL;

-- ── Moteur commun : toute la logique de score vit ICI, une seule fois ──────
-- p_device : 'phone' ou 'watch' — l'appareil qui revendique la saisie.
CREATE OR REPLACE FUNCTION public.fn_apply_live_event_as(
  p_session_id uuid, p_actor uuid, p_event_type text, p_payload jsonb,
  p_watch_link_id uuid, p_client_seq int, p_device text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s RECORD; v_state jsonb;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO s FROM public.live_match_sessions WHERE id = p_session_id FOR UPDATE;
  IF s IS NULL THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF s.status <> 'live' THEN RAISE EXCEPTION 'session_not_live'; END IF;
  IF NOT (p_actor = ANY(s.team1_ids || s.team2_ids)) THEN RAISE EXCEPTION 'not_a_participant'; END IF;

  IF p_event_type IN ('game_won','point_won','undo','finished','abandoned')
     AND p_actor <> s.scorer_id THEN
    RAISE EXCEPTION 'not_the_scorer';
  END IF;
  IF p_event_type NOT IN ('game_won','point_won','undo','contest','contest_resolved','abandoned') THEN
    RAISE EXCEPTION 'invalid_event_type';
  END IF;
  IF p_event_type = 'point_won' AND coalesce(s.scoring_mode, 'games') <> 'points' THEN
    RAISE EXCEPTION 'wrong_scoring_mode';
  END IF;
  IF p_event_type = 'game_won' AND coalesce(s.scoring_mode, 'games') = 'points' THEN
    RAISE EXCEPTION 'wrong_scoring_mode';
  END IF;

  -- GARDE-FOU : la montre a la main → le téléphone doit la réclamer.
  -- Ne concerne que les événements de score : contester reste possible
  -- depuis n'importe quel téléphone participant.
  IF p_event_type IN ('game_won','point_won','undo')
     AND coalesce(s.input_device, 'phone') = 'watch'
     AND p_device = 'phone' THEN
    RAISE EXCEPTION 'watch_has_control';
  END IF;

  -- Idempotence de la file montre : le même client_seq rejoué ne fait rien.
  IF p_watch_link_id IS NOT NULL AND p_client_seq IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.live_match_events
                  WHERE session_id = p_session_id
                    AND watch_link_id = p_watch_link_id
                    AND client_seq = p_client_seq) THEN
    RETURN public.fn_live_replay(p_session_id);
  END IF;

  INSERT INTO public.live_match_events
    (session_id, seq, author_id, event_type, payload, watch_link_id, client_seq)
  VALUES (p_session_id,
          coalesce((SELECT max(seq) FROM public.live_match_events WHERE session_id = p_session_id), 0) + 1,
          p_actor, p_event_type, p_payload, p_watch_link_id, p_client_seq);

  v_state := public.fn_live_replay(p_session_id);
  UPDATE public.live_match_sessions
     SET current_state = v_state,
         contest_count = (v_state->>'openContests')::int,
         status = CASE WHEN p_event_type = 'abandoned' THEN 'abandoned' ELSE status END,
         input_device = CASE WHEN p_event_type IN ('game_won','point_won','undo')
                             THEN p_device ELSE input_device END,
         input_device_at = CASE WHEN p_event_type IN ('game_won','point_won','undo')
                                THEN now() ELSE input_device_at END,
         updated_at = now()
   WHERE id = p_session_id;
  RETURN v_state;
END; $$;

REVOKE ALL ON FUNCTION public.fn_apply_live_event_as(uuid, uuid, text, jsonb, uuid, int, text) FROM PUBLIC;

-- ── RPC téléphone : délègue au moteur commun ──────────────────────────────
DROP FUNCTION IF EXISTS public.apply_live_event(uuid, text, jsonb);
CREATE OR REPLACE FUNCTION public.apply_live_event(
  p_session_id uuid, p_event_type text, p_payload jsonb DEFAULT '{}', p_claim boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := public.current_player_id();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  -- p_claim = le joueur a explicitement appuyé sur « Reprendre la saisie ici ».
  IF p_claim THEN
    UPDATE public.live_match_sessions
       SET input_device = 'phone', input_device_at = now()
     WHERE id = p_session_id AND scorer_id = v_me;
  END IF;
  RETURN public.fn_apply_live_event_as(p_session_id, v_me, p_event_type, p_payload, NULL, NULL, 'phone');
END; $$;

REVOKE ALL ON FUNCTION public.apply_live_event(uuid, text, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_live_event(uuid, text, jsonb, boolean) TO authenticated;

-- ── Reprise de la saisie sur le téléphone, SANS marquer d'événement ───────
-- Indispensable : détourner un événement existant (contest_resolved) pour
-- « porter » la reprise décrémenterait le compteur de contestations.
CREATE OR REPLACE FUNCTION public.claim_phone_input(p_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := public.current_player_id();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  UPDATE public.live_match_sessions
     SET input_device = 'phone', input_device_at = now(), updated_at = now()
   WHERE id = p_session_id AND scorer_id = v_me AND status = 'live';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_the_scorer'; END IF;
END; $$;

REVOKE ALL ON FUNCTION public.claim_phone_input(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_phone_input(uuid) TO authenticated;

-- ── Un changement de scoreur remet la saisie sur le téléphone du nouveau ──
CREATE OR REPLACE FUNCTION public.take_over_scoring(p_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := public.current_player_id();
  s RECORD;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO s FROM public.live_match_sessions WHERE id = p_session_id FOR UPDATE;
  IF s IS NULL THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF s.status <> 'live' THEN RAISE EXCEPTION 'session_not_live'; END IF;
  IF NOT (v_me = ANY(s.team1_ids || s.team2_ids)) THEN RAISE EXCEPTION 'not_a_participant'; END IF;

  INSERT INTO public.live_match_events (session_id, seq, author_id, event_type, payload)
  VALUES (p_session_id,
          coalesce((SELECT max(seq) FROM public.live_match_events WHERE session_id = p_session_id), 0) + 1,
          v_me, 'scorer_changed', jsonb_build_object('scorer_id', v_me));

  UPDATE public.live_match_sessions
     SET scorer_id = v_me, input_device = 'phone', input_device_at = now(), updated_at = now()
   WHERE id = p_session_id;
END; $$;

REVOKE ALL ON FUNCTION public.take_over_scoring(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.take_over_scoring(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
