-- ============================================================
-- App montre — appairage montre ↔ compte joueur.
-- Additive et ré-appliquable. Cf. docs/superpowers/specs/2026-08-25-app-montre-design.md §5
--
-- Pas de dépendance à pgcrypto : sha256() est natif depuis PG11 et
-- gen_random_uuid() depuis PG13. On construit le jeton avec deux UUID
-- (≈244 bits d'aléa) et on ne stocke QUE son empreinte.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.watch_pairing_codes (
  code        text PRIMARY KEY,
  player_id   uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.watch_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  device_label text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS watch_links_player_idx
  ON public.watch_links(player_id) WHERE revoked_at IS NULL;

-- Limiteur global anti-force-brute : 6 chiffres, c'est court, la protection
-- vient de l'encadrement (5 min de validité + ce compteur), pas de la longueur.
CREATE TABLE IF NOT EXISTS public.watch_pairing_attempts (
  id           bigserial PRIMARY KEY,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  ok           boolean NOT NULL,
  ip           text
);
CREATE INDEX IF NOT EXISTS watch_pairing_attempts_at_idx
  ON public.watch_pairing_attempts(attempted_at DESC);
CREATE INDEX IF NOT EXISTS watch_pairing_attempts_ip_idx
  ON public.watch_pairing_attempts(ip, attempted_at DESC);

-- Aucune policy RLS : ces tables ne sont JAMAIS lues directement, uniquement
-- via les RPC SECURITY DEFINER ci-dessous.
ALTER TABLE public.watch_pairing_codes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watch_links           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watch_pairing_attempts ENABLE ROW LEVEL SECURITY;

-- ── Génération du code (téléphone authentifié) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.create_watch_pairing_code()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := public.current_player_id();
  v_code text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  DELETE FROM public.watch_pairing_codes WHERE expires_at < now() - interval '1 day';
  -- Un seul code actif par joueur : le nouveau brûle les précédents.
  UPDATE public.watch_pairing_codes SET consumed_at = now()
   WHERE player_id = v_me AND consumed_at IS NULL;

  FOR i IN 1..10 LOOP
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    BEGIN
      INSERT INTO public.watch_pairing_codes (code, player_id, expires_at)
      VALUES (v_code, v_me, now() + interval '5 minutes');
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      NULL; -- collision improbable, on retente
    END;
  END LOOP;
  RAISE EXCEPTION 'code_generation_failed';
END; $$;

-- ── Échange du code contre un jeton durable (appelée par la MONTRE) ────────
CREATE OR REPLACE FUNCTION public.redeem_watch_pairing_code(
  p_code text, p_device_label text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c RECORD;
  v_token text;
  v_ip text;
  v_ip_fails int;
  v_all_fails int;
BEGIN
  -- IP de l'appelant si PostgREST la fournit, NULL sinon.
  BEGIN
    v_ip := split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1);
    IF v_ip = '' THEN v_ip := NULL; END IF;
  EXCEPTION WHEN others THEN
    v_ip := NULL;
  END;

  -- Limiteur PAR ORIGINE : 10 echecs/minute pour la meme IP.
  IF v_ip IS NOT NULL THEN
    SELECT count(*) INTO v_ip_fails FROM public.watch_pairing_attempts
     WHERE ok = false AND ip = v_ip AND attempted_at > now() - interval '1 minute';
    IF v_ip_fails >= 10 THEN RAISE EXCEPTION 'rate_limited'; END IF;
  END IF;

  -- Filet global VOLONTAIREMENT haut : borne une attaque distribuee sans
  -- permettre a un seul acteur de bloquer l'appairage de toute l'app.
  SELECT count(*) INTO v_all_fails FROM public.watch_pairing_attempts
   WHERE ok = false AND attempted_at > now() - interval '1 minute';
  IF v_all_fails >= 200 THEN RAISE EXCEPTION 'rate_limited'; END IF;

  SELECT * INTO c FROM public.watch_pairing_codes WHERE code = p_code FOR UPDATE;

  IF c IS NULL OR c.consumed_at IS NOT NULL OR c.expires_at < now() THEN
    INSERT INTO public.watch_pairing_attempts (ok, ip) VALUES (false, v_ip);
    IF c IS NULL THEN RAISE EXCEPTION 'invalid_code'; END IF;
    IF c.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'code_already_used'; END IF;
    RAISE EXCEPTION 'code_expired';
  END IF;

  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.watch_links (player_id, token_hash, device_label)
  VALUES (c.player_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), p_device_label);

  UPDATE public.watch_pairing_codes SET consumed_at = now() WHERE code = p_code;
  INSERT INTO public.watch_pairing_attempts (ok, ip) VALUES (true, v_ip);

  RETURN v_token; -- rendu EN CLAIR une seule fois, jamais restituable ensuite
END; $$;

-- ── Gestion depuis le téléphone ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_watch_links()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := public.current_player_id();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'device_label', device_label,
      'created_at', created_at, 'last_seen_at', last_seen_at) ORDER BY created_at DESC)
    FROM public.watch_links WHERE player_id = v_me AND revoked_at IS NULL
  ), '[]'::jsonb);
END; $$;

CREATE OR REPLACE FUNCTION public.revoke_watch_link(p_link_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := public.current_player_id();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  UPDATE public.watch_links SET revoked_at = now()
   WHERE id = p_link_id AND player_id = v_me AND revoked_at IS NULL;
END; $$;

REVOKE ALL ON FUNCTION public.create_watch_pairing_code()            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_watch_pairing_code(text, text)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_watch_links()                     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_watch_link(uuid)                FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_watch_pairing_code()           TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_watch_links()                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_watch_link(uuid)               TO authenticated;
-- La montre n'a que la clé anon : c'est la SEULE RPC ouverte à anon.
GRANT EXECUTE ON FUNCTION public.redeem_watch_pairing_code(text, text) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
