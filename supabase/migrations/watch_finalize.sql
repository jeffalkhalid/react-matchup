-- ============================================================
-- App montre — valider le score depuis le poignet.
--
-- ORDRE : après watch_pairing.sql, watch_input_device.sql, watch_rpcs.sql,
-- watch_feature_flag.sql. Ré-appliquable.
--
-- Décision produit (2026-08-26, après test réel) : sortir le téléphone à la
-- fin annulait une partie du confort recherché. La montre peut désormais
-- valider — mais seulement un match RÉELLEMENT joué, et derrière un geste
-- délibéré (appui long + écran de confirmation).
--
-- ⚠️ La logique de finalisation n'est PAS dupliquée : elle est extraite dans
-- fn_finalize_live_session_as(), que les deux entrées appellent. Un second
-- exemplaire divergerait tôt ou tard (cf. spec §13).
-- ============================================================
BEGIN;

-- ── Moteur commun : le corps EXACT de finalize_live_session, l'acteur passé
-- en paramètre au lieu d'être lu depuis le JWT ────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_finalize_live_session_as(
  p_session_id uuid, p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s RECORD; g RECORD; v_state jsonb; v_score text;
  sw1 int; sw2 int; w uuid[]; l uuid[]; v_match uuid;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO s FROM public.live_match_sessions WHERE id = p_session_id FOR UPDATE;
  IF s IS NULL THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF s.match_id IS NOT NULL THEN RETURN s.match_id; END IF; -- déjà finalisée
  IF s.status <> 'live' THEN RAISE EXCEPTION 'session_not_live'; END IF;
  IF p_actor <> s.scorer_id THEN RAISE EXCEPTION 'not_the_scorer'; END IF;

  v_state := public.fn_live_replay(p_session_id);
  sw1 := (v_state->'setsWon'->>'t1')::int; sw2 := (v_state->'setsWon'->>'t2')::int;
  -- Ces deux garde-fous SONT la condition « match réellement joué » : ils
  -- protègent la montre d'une validation prématurée aussi bien que le téléphone.
  IF sw1 = sw2 THEN RAISE EXCEPTION 'no_winner'; END IF;
  IF sw1 + sw2 < 2 THEN RAISE EXCEPTION 'not_enough_sets'; END IF;

  -- score_text : sets terminés uniquement (même format que score-entry : "6-3, 6-4")
  SELECT string_agg((e->>'t1') || '-' || (e->>'t2'), ', ' ORDER BY i)
    INTO v_score
    FROM jsonb_array_elements(v_state->'sets') WITH ORDINALITY AS t(e, i)
   WHERE i < jsonb_array_length(v_state->'sets'); -- exclut le set courant

  IF sw1 > sw2 THEN w := s.team1_ids; l := s.team2_ids; ELSE w := s.team2_ids; l := s.team1_ids; END IF;
  SELECT * INTO g FROM public.open_games WHERE id = s.game_id;

  -- Toujours `pending` : le score live est une PROPOSITION du scoreur, les
  -- adversaires la valident/contestent par le circuit classique.
  INSERT INTO public.matches (winner_id, winner_id_2, loser_id, loser_id_2, score_text,
                              status, created_by, game_id, game_format, is_challenge, stake_multiplier,
                              scored_live)
  VALUES (w[1], w[2], l[1], l[2], v_score, 'pending', s.scorer_id, s.game_id,
          coalesce(g.game_format, 'competitive'), coalesce(g.is_challenge, false), coalesce(g.stake_multiplier, 1.0),
          true)
  RETURNING id INTO v_match;

  INSERT INTO public.live_match_events (session_id, seq, author_id, event_type, payload)
  VALUES (p_session_id,
          coalesce((SELECT max(seq) FROM public.live_match_events WHERE session_id = p_session_id), 0) + 1,
          p_actor, 'finished', jsonb_build_object('match_id', v_match));
  UPDATE public.live_match_sessions
     SET status = 'finished', match_id = v_match, current_state = public.fn_live_replay(p_session_id), updated_at = now()
   WHERE id = p_session_id;
  UPDATE public.open_games SET status = 'closed' WHERE id = s.game_id;
  RETURN v_match;
END; $$;

-- Helper interne : prend l'acteur en PARAMÈTRE, donc jamais exposé — sinon
-- n'importe qui finaliserait au nom du scoreur. Même piège que
-- fn_apply_live_event_as : REVOKE FROM PUBLIC seul ne suffit pas chez Supabase.
REVOKE ALL ON FUNCTION public.fn_finalize_live_session_as(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── Entrée téléphone : délègue, comportement inchangé ─────────────────────
CREATE OR REPLACE FUNCTION public.finalize_live_session(p_session_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.fn_finalize_live_session_as(p_session_id, public.current_player_id());
END; $$;

REVOKE ALL ON FUNCTION public.finalize_live_session(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_live_session(uuid) TO authenticated;

-- ── Entrée montre ─────────────────────────────────────────────────────────
-- Renvoie TOUJOURS un objet : Connect IQ rejette tout JSON qui n'est pas un
-- objet par -400 (cf. watch_rpcs.sql).
CREATE OR REPLACE FUNCTION public.watch_finalize_session(p_token text, p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.watch_links; v_match uuid;
BEGIN
  IF NOT public.fn_watch_enabled() THEN
    RAISE EXCEPTION 'feature_disabled';
  END IF;
  l := public.fn_watch_link(p_token);
  v_match := public.fn_finalize_live_session_as(p_session_id, l.player_id);
  RETURN jsonb_build_object('ok', true, 'match_id', v_match);
END; $$;

REVOKE ALL ON FUNCTION public.watch_finalize_session(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.watch_finalize_session(text, uuid) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
