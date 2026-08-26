-- ============================================================
-- App montre — RPC appelées par la montre (clé anon + jeton).
-- Cf. spec §6. Ces RPC ne doivent RIEN exposer au-delà du joueur lié.
--
-- ORDRE D'APPLICATION - il n'y a pas de runner, un humain applique a la main :
--    1) watch_pairing.sql  ->  2) watch_input_device.sql  ->  3) watch_rpcs.sql
-- Ce fichier est le DERNIER : il dépend de watch_links (watch_pairing.sql) et
-- de fn_apply_live_event_as (watch_input_device.sql).
-- ============================================================
BEGIN;

-- Helper privé : jeton → lien. Jamais exposé à anon.
CREATE OR REPLACE FUNCTION public.fn_watch_link(p_token text)
RETURNS public.watch_links LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.watch_links;
BEGIN
  SELECT * INTO l FROM public.watch_links
   WHERE token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
     AND revoked_at IS NULL;
  IF l.id IS NULL THEN RAISE EXCEPTION 'token_revoked'; END IF;
  UPDATE public.watch_links SET last_seen_at = now() WHERE id = l.id;
  RETURN l;
END; $$;

-- Supabase accorde EXECUTE par défaut à anon ET authenticated sur toute
-- nouvelle fonction du schéma public : REVOKE ... FROM PUBLIC seul NE RETIRE
-- PAS ces deux droits directs (même piège que live_scoring.sql:335).
-- fn_watch_link est un helper interne : joignable, elle laisserait n'importe
-- quel appelant éprouver des jetons et lire la ligne watch_links complète.
REVOKE ALL ON FUNCTION public.fn_watch_link(text) FROM PUBLIC, anon, authenticated;

-- Formatage 0/15/30/40/AV — MIROIR EXACT de gameScoreLabels (lib/liveScore.ts:109).
-- Toute évolution de l'une doit être répercutée sur l'autre.
CREATE OR REPLACE FUNCTION public.fn_game_label(
  p_t1 int, p_t2 int, p_golden boolean, p_tiebreak boolean)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_tiebreak THEN jsonb_build_object('t1', p_t1::text, 't2', p_t2::text)
    WHEN p_t1 >= 3 AND p_t2 >= 3 THEN
      CASE
        WHEN p_golden OR p_t1 = p_t2 THEN jsonb_build_object('t1', '40', 't2', '40')
        WHEN p_t1 > p_t2            THEN jsonb_build_object('t1', 'AV', 't2', '40')
        ELSE                             jsonb_build_object('t1', '40', 't2', 'AV')
      END
    ELSE jsonb_build_object(
      't1', (ARRAY['0','15','30','40'])[least(p_t1, 3) + 1],
      't2', (ARRAY['0','15','30','40'])[least(p_t2, 3) + 1])
  END;
$$;

-- Même retrait que ci-dessus : PUBLIC seul ne suffit pas (cf. fn_watch_link).
REVOKE ALL ON FUNCTION public.fn_game_label(int, int, boolean, boolean) FROM PUBLIC, anon, authenticated;

-- Sérialisation commune de l'état, pour que les deux RPC renvoient la
-- MÊME forme (contrat unique côté montre).
CREATE OR REPLACE FUNCTION public.fn_watch_payload(p_session_id uuid, p_player uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s RECORD; st jsonb; t1 text; t2 text;
BEGIN
  SELECT * INTO s FROM public.live_match_sessions WHERE id = p_session_id;
  IF s.id IS NULL THEN RETURN NULL; END IF;
  st := coalesce(s.current_state, public.fn_live_replay(p_session_id));

  SELECT string_agg(split_part(p.name, ' ', 1), ' & ' ORDER BY ord) INTO t1
    FROM unnest(s.team1_ids) WITH ORDINALITY AS u(pid, ord)
    JOIN public.players p ON p.id = u.pid;
  SELECT string_agg(split_part(p.name, ' ', 1), ' & ' ORDER BY ord) INTO t2
    FROM unnest(s.team2_ids) WITH ORDINALITY AS u(pid, ord)
    JOIN public.players p ON p.id = u.pid;

  RETURN jsonb_build_object(
    -- ⚠️ Connect IQ n'accepte QUE des objets JSON en réponse : un `null`, une
    -- chaîne, un nombre ou un tableau — pourtant du JSON valide — sont rejetés
    -- côté montre par l'erreur -400 INVALID_HTTP_BODY_IN_NETWORK_RESPONSE, sans
    -- que l'appel serveur n'échoue pour autant. Toute RPC appelée par la montre
    -- doit donc TOUJOURS renvoyer un objet, jamais NULL. D'où `has_session`,
    -- qui porte l'absence de match au lieu de la coder par un `null`.
    'has_session',   true,
    'session_id',    s.id,
    'scoring_mode',  coalesce(s.scoring_mode, 'games'),
    'golden_point',  coalesce(s.golden_point, true),
    'team1',         coalesce(t1, 'Equipe 1'),
    'team2',         coalesce(t2, 'Equipe 2'),
    'sets',          coalesce(st->'sets', '[]'::jsonb),
    'sets_won',      coalesce(st->'setsWon', jsonb_build_object('t1', 0, 't2', 0)),
    'current_game',  coalesce(st->'currentGame', 'null'::jsonb),
    'tie_break',     coalesce(st->'tieBreak', 'false'::jsonb),
    'game_label',    CASE
      WHEN coalesce(s.scoring_mode, 'games') <> 'points'
        OR st->'currentGame' IS NULL
        OR jsonb_typeof(st->'currentGame') = 'null'
      THEN NULL
      ELSE public.fn_game_label(
        (st->'currentGame'->>'t1')::int,
        (st->'currentGame'->>'t2')::int,
        coalesce(s.golden_point, true),
        coalesce((st->>'tieBreak')::boolean, false))
    END,
    'contest_count', coalesce(s.contest_count, 0),
    'input_device',  coalesce(s.input_device, 'phone'),
    'is_scorer',     (s.scorer_id = p_player),
    -- DEUX notions distinctes, à ne surtout pas fusionner (spec §9) :
    --  • finished       = la session n'est plus 'live' → le téléphone a déjà
    --    validé ; c'est ce qui coupe la saisie au poignet.
    --  • match_decided  = le match est JOUÉ (2 sets d'écart-vainqueur) alors que
    --    la session tourne encore → la montre invite à sortir le téléphone,
    --    mais laisse marquer : l'app permet « Continuer un set ».
    -- MIROIR de isMatchDecided (lib/liveScore.ts:173) : évoluer les deux ensemble.
    -- NB : st->>'finished' ne convient PAS ici, il ne vaut true qu'après
    -- l'événement 'finished' posé par finalize_live_session - soit la même
    -- information que s.status, donc toujours trop tard.
    'match_decided', (
      greatest(coalesce((st->'setsWon'->>'t1')::int, 0),
               coalesce((st->'setsWon'->>'t2')::int, 0)) >= 2
      AND coalesce((st->'setsWon'->>'t1')::int, 0) <> coalesce((st->'setsWon'->>'t2')::int, 0)
    ),
    'finished',      (s.status <> 'live')
  );
END; $$;

-- Idem, et c'est le plus sensible des trois : joignable, fn_watch_payload est
-- une lecture NON AUTHENTIFIÉE de l'état d'une session live et des noms des
-- joueurs à partir du seul uuid de session - exactement ce que le commentaire
-- d'en-tête de ce fichier interdit.
REVOKE ALL ON FUNCTION public.fn_watch_payload(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── Quelle session dois-je scorer ? ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.watch_current_session(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.watch_links; v_sid uuid;
BEGIN
  -- Interrupteur global : on répond un OBJET (jamais NULL, cf. -400) portant
  -- `disabled`, pour que la montre affiche un message clair plutôt qu'une
  -- erreur technique. Testé avant le jeton : inutile de valider un lien pour
  -- une fonctionnalité coupée.
  IF NOT public.fn_watch_enabled() THEN
    RETURN jsonb_build_object('has_session', false, 'disabled', true);
  END IF;
  l := public.fn_watch_link(p_token);
  SELECT id INTO v_sid FROM public.live_match_sessions
   WHERE scorer_id = l.player_id AND status = 'live'
   ORDER BY started_at DESC LIMIT 1;
  -- Aucun match à scorer : on renvoie un OBJET, jamais NULL (cf. -400 plus haut).
  IF v_sid IS NULL THEN RETURN jsonb_build_object('has_session', false); END IF;
  RETURN coalesce(public.fn_watch_payload(v_sid, l.player_id),
                  jsonb_build_object('has_session', false));
END; $$;

-- ── Marquer depuis la montre ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.watch_apply_event(
  p_token text, p_session_id uuid, p_event_type text,
  p_payload jsonb DEFAULT '{}', p_client_seq int DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.watch_links;
BEGIN
  -- Interrupteur global : un point envoyé alors que la fonctionnalité est
  -- coupée ne doit PAS être enregistré. On lève (4xx) : la montre jette
  -- l'événement au lieu de le rejouer indéfiniment, et son prochain
  -- rafraîchissement (5 s) affichera le message « fonction desactivee ».
  IF NOT public.fn_watch_enabled() THEN
    RAISE EXCEPTION 'feature_disabled';
  END IF;
  l := public.fn_watch_link(p_token);
  -- Seuls les événements de saisie sont permis depuis la montre : ni contestation,
  -- ni abandon, ni finalisation (spec §12 — la montre ne valide pas).
  IF p_event_type NOT IN ('game_won','point_won','undo') THEN
    RAISE EXCEPTION 'invalid_event_type';
  END IF;
  PERFORM public.fn_apply_live_event_as(
    p_session_id, l.player_id, p_event_type, p_payload, l.id, p_client_seq, 'watch');
  RETURN coalesce(public.fn_watch_payload(p_session_id, l.player_id),
                  jsonb_build_object('has_session', false));
END; $$;

-- Les DEUX RPC ci-dessous sont, elles, faites pour être appelées par la montre
-- (clé anon + jeton d'appairage) : on les ré-accorde juste après.
REVOKE ALL ON FUNCTION public.watch_current_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.watch_apply_event(text, uuid, text, jsonb, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.watch_current_session(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.watch_apply_event(text, uuid, text, jsonb, int) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
