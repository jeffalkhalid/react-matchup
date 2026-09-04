# App montre PagMatch (Garmin) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre au scoreur de marquer les points au poignet sur une Garmin, téléphone rangé, pendant tout le match.

**Architecture:** La montre est un programme Connect IQ séparé qui parle **directement à Supabase** (aucun pont possible avec l'app RN sur iPhone). Elle prouve son identité avec un jeton durable obtenu une fois via un code à 6 chiffres. Elle envoie ses événements via des RPC `watch_*` qui délèguent au **même moteur de score** que le téléphone. Un verrou `input_device` côté serveur garantit qu'un seul appareil marque à la fois.

**Tech Stack:** PostgreSQL/Supabase (RPC `SECURITY DEFINER`), React Native/Expo (app téléphone), Monkey C / Connect IQ SDK 9.2.0 (app montre), vitest (tests TS).

**Spec:** `docs/superpowers/specs/2026-08-25-app-montre-design.md`

## Global Constraints

- **Migrations SQL** : un fichier par tâche dans `supabase/migrations/`, **additif et ré-appliquable** (`CREATE OR REPLACE`, `IF NOT EXISTS`). Appliquées **à la main** par le user dans le SQL Editor Supabase — ne jamais tenter de les appliquer soi-même. Terminer chaque fichier par `NOTIFY pgrst, 'reload schema';`.
- **Changement de signature d'une RPC existante** : `DROP FUNCTION IF EXISTS` de l'ancienne signature AVANT le `CREATE OR REPLACE` de la nouvelle — sinon PostgREST voit deux surcharges et l'appel devient ambigu (piège déjà rencontré sur `start_live_session`).
- **Pas de 3e moteur de score.** La montre affiche ce que le serveur renvoie. Les RPC montre délèguent à la logique commune, jamais de copie de `fn_live_replay`.
- **Identité côté app RN** : `public.current_player_id()`. La montre n'est PAS un utilisateur Supabase : elle appelle avec la clé anon + son jeton.
- **Pas de commit automatique** — le user commite lui-même (cf. sa préférence de travail). Les étapes « Commit » du plan sont donc à proposer, pas à exécuter sans accord.
- **Tests** : `npm test` (vitest, `lib/` uniquement). Il n'existe **pas** de framework de test SQL dans le repo : les tâches SQL fournissent des requêtes de vérification à exécuter dans le SQL Editor.
- **Chaînes affichées sur la montre : SANS ACCENTS** (les polices Garmin ne les garantissent pas). Les commentaires restent en français accentué.
- **Cible Garmin** : `epix2` (montre du user). Le manifeste liste aussi `epix2pro42mm/47mm/51mm`.

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `supabase/migrations/watch_pairing.sql` | Tables `watch_pairing_codes`, `watch_links`, `watch_pairing_attempts` + RPC d'appairage |
| `supabase/migrations/watch_input_device.sql` | Verrou `input_device`, colonnes d'idempotence, moteur commun `fn_apply_live_event_as` |
| `supabase/migrations/watch_rpcs.sql` | `watch_current_session`, `watch_apply_event` |
| `lib/watchLink.ts` | Client téléphone : créer un code, lister/délier les montres |
| `app/watch-link.tsx` | Écran « Connecter ma montre » |
| `components/profile/ProfileMenuSheet.tsx` | Entrée de menu vers l'écran |
| `app/live/[sessionId].tsx` | Bandeau de verrouillage + « Reprendre la saisie ici » |
| `lib/liveSession.ts` | Gestion de l'erreur `watch_has_control` dans la file |
| `watch/` (nouveau projet Connect IQ) | App montre : appairage, session, saisie, file locale |

---

## Task 1 : Migration d'appairage

**Files:**
- Create: `supabase/migrations/watch_pairing.sql`

**Interfaces:**
- Produces: `create_watch_pairing_code() → text` (6 chiffres), `redeem_watch_pairing_code(p_code text, p_device_label text) → text` (jeton en clair, une seule fois), `list_watch_links() → jsonb`, `revoke_watch_link(p_link_id uuid) → void`, table `public.watch_links(id, player_id, token_hash, device_label, created_at, last_seen_at, revoked_at)`.

- [ ] **Step 1 : Écrire la migration**

```sql
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

-- Limiteur anti-force-brute : 6 chiffres, c'est court, la protection vient de
-- l'encadrement (5 min de validité + ces compteurs), pas de la longueur.
-- ⚠️ Le compteur est PAR IP. Un compteur purement global serait un déni de
-- service : 10 mauvais codes suffiraient à bloquer l'appairage de TOUS les
-- joueurs, sur une RPC ouverte à `anon`.
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

  -- Limiteur PAR ORIGINE : 10 échecs/minute pour la même IP.
  IF v_ip IS NOT NULL THEN
    SELECT count(*) INTO v_ip_fails FROM public.watch_pairing_attempts
     WHERE ok = false AND ip = v_ip AND attempted_at > now() - interval '1 minute';
    IF v_ip_fails >= 10 THEN RAISE EXCEPTION 'rate_limited'; END IF;
  END IF;

  -- Filet global VOLONTAIREMENT haut : borne une attaque distribuée sans
  -- permettre à un seul acteur de bloquer l'appairage de toute l'app.
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
```

- [ ] **Step 2 : Faire appliquer la migration par le user**

Lui demander d'exécuter `supabase/migrations/watch_pairing.sql` dans le SQL Editor Supabase, puis d'attendre sa confirmation. **Ne pas continuer sans.**

- [ ] **Step 3 : Vérifier — cas nominal**

Dans le SQL Editor (session authentifiée impossible ici, on simule en passant par un joueur réel) :

```sql
-- Remplacer <PLAYER_ID> par un id réel de public.players.
INSERT INTO public.watch_pairing_codes (code, player_id, expires_at)
VALUES ('123456', '<PLAYER_ID>', now() + interval '5 minutes');

SELECT public.redeem_watch_pairing_code('123456', 'epix2') AS token;
```

Attendu : un jeton de 64 caractères hexadécimaux.

```sql
SELECT device_label, token_hash IS NOT NULL AS hash_ok, revoked_at
  FROM public.watch_links WHERE device_label = 'epix2';
```

Attendu : une ligne, `hash_ok = true`, `revoked_at` nul.

- [ ] **Step 4 : Vérifier — le code ne sert qu'une fois**

```sql
SELECT public.redeem_watch_pairing_code('123456', 'epix2');
```

Attendu : erreur `code_already_used`.

- [ ] **Step 5 : Vérifier — code expiré**

```sql
INSERT INTO public.watch_pairing_codes (code, player_id, expires_at)
VALUES ('654321', '<PLAYER_ID>', now() - interval '1 minute');
SELECT public.redeem_watch_pairing_code('654321', 'epix2');
```

Attendu : erreur `code_expired`.

- [ ] **Step 6 : Nettoyer les données de test**

```sql
DELETE FROM public.watch_links WHERE device_label = 'epix2';
DELETE FROM public.watch_pairing_codes WHERE code IN ('123456','654321');
DELETE FROM public.watch_pairing_attempts;
```

- [ ] **Step 7 : Proposer le commit**

```bash
git add supabase/migrations/watch_pairing.sql
git commit -m "feat(montre): appairage montre par code a usage unique"
```

---

## Task 2 : Verrou d'appareil et moteur de score commun

**Files:**
- Create: `supabase/migrations/watch_input_device.sql`

**Interfaces:**
- Consumes: `public.watch_links` (Task 1).
- Produces: `fn_apply_live_event_as(p_session_id uuid, p_actor uuid, p_event_type text, p_payload jsonb, p_watch_link_id uuid, p_client_seq int, p_device text) → jsonb` (interne, utilisée par Task 3) ; `apply_live_event(p_session_id uuid, p_event_type text, p_payload jsonb, p_claim boolean) → jsonb` (nouvelle signature 4 args) ; colonnes `live_match_sessions.input_device` / `.input_device_at`.

- [ ] **Step 1 : Écrire la migration**

```sql
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
-- ⚠️ Corps repris À L'IDENTIQUE de la production (live_scoring.sql:241-256) :
-- le no-op sur auto-appel, l'erreur `session_not_live` pour une session absente
-- et la payload `'from'` (ANCIEN scoreur) doivent être préservés. La SEULE
-- addition autorisée est `input_device`/`input_device_at` dans l'UPDATE final.
CREATE OR REPLACE FUNCTION public.take_over_scoring(p_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := public.current_player_id(); s RECORD;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO s FROM public.live_match_sessions WHERE id = p_session_id FOR UPDATE;
  IF s IS NULL OR s.status <> 'live' THEN RAISE EXCEPTION 'session_not_live'; END IF;
  IF NOT (v_me = ANY(s.team1_ids || s.team2_ids)) THEN RAISE EXCEPTION 'not_a_participant'; END IF;
  IF v_me = s.scorer_id THEN RETURN; END IF;

  INSERT INTO public.live_match_events (session_id, seq, author_id, event_type, payload)
  VALUES (p_session_id,
          coalesce((SELECT max(seq) FROM public.live_match_events WHERE session_id = p_session_id), 0) + 1,
          v_me, 'scorer_changed', jsonb_build_object('from', s.scorer_id));

  UPDATE public.live_match_sessions
     SET scorer_id = v_me, input_device = 'phone', input_device_at = now(), updated_at = now()
   WHERE id = p_session_id;
END; $$;

REVOKE ALL ON FUNCTION public.take_over_scoring(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.take_over_scoring(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2 : Vérifier que `take_over_scoring` ci-dessus est fidèle à l'existant**

Avant de faire appliquer quoi que ce soit, comparer le corps réécrit avec la version en base :

```sql
SELECT pg_get_functiondef('public.take_over_scoring(uuid)'::regprocedure);
```

Si la version en base fait autre chose que ce qui est reproduit ici (contrôles supplémentaires, notification…), **reprendre son corps exact** et n'y ajouter que `input_device = 'phone', input_device_at = now()`. Ne pas régresser une fonction en production.

- [ ] **Step 3 : Faire appliquer la migration par le user, attendre confirmation**

- [ ] **Step 4 : Vérifier — signature unique d'apply_live_event**

```sql
SELECT p.oid::regprocedure AS signature
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'apply_live_event';
```

Attendu : **une seule ligne**, `apply_live_event(uuid, text, jsonb, boolean)`. Si la 3-args subsiste, le `DROP` n'a pas pris et les appels seront ambigus.

- [ ] **Step 5 : Vérifier — le verrou et l'index existent**

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'live_match_sessions' AND column_name LIKE 'input_device%';
SELECT indexname FROM pg_indexes WHERE indexname = 'live_events_watch_idem';
```

Attendu : deux colonnes, un index.

- [ ] **Step 6 : Vérifier que le live téléphone marche toujours**

Lancer une session live depuis l'app, marquer 2 points, annuler 1. Aucun message d'erreur, le score se met à jour. C'est le test de non-régression le plus important de cette tâche.

- [ ] **Step 7 : Proposer le commit**

```bash
git add supabase/migrations/watch_input_device.sql
git commit -m "feat(montre): verrou d'appareil de saisie + moteur de score commun"
```

---

## Task 3 : RPC de la montre

**Files:**
- Create: `supabase/migrations/watch_rpcs.sql`

**Interfaces:**
- Consumes: `watch_links` (Task 1), `fn_apply_live_event_as` (Task 2).
- Produces: `watch_current_session(p_token text) → jsonb`, `watch_apply_event(p_token text, p_session_id uuid, p_event_type text, p_payload jsonb, p_client_seq int) → jsonb`.

Forme du `jsonb` renvoyé par les deux RPC (contrat consommé par la montre en Task 8) :

```json
{
  "session_id": "uuid", "scoring_mode": "games|points", "golden_point": true,
  "team1": "Karim & Mina", "team2": "Ali & Sara",
  "sets": [{"t1":6,"t2":3}], "sets_won": {"t1":1,"t2":0},
  "current_game": {"t1":0,"t2":0}, "tie_break": false,
  "contest_count": 0, "input_device": "watch",
  "is_scorer": true, "finished": false
}
```

- [ ] **Step 1 : Écrire la migration**

```sql
-- ============================================================
-- App montre — RPC appelées par la montre (clé anon + jeton).
-- Cf. spec §6. Ces RPC ne doivent RIEN exposer au-delà du joueur lié.
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

REVOKE ALL ON FUNCTION public.fn_watch_link(text) FROM PUBLIC;

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
    'session_id',    s.id,
    'scoring_mode',  coalesce(s.scoring_mode, 'games'),
    'golden_point',  coalesce(s.golden_point, true),
    'team1',         coalesce(t1, 'Equipe 1'),
    'team2',         coalesce(t2, 'Equipe 2'),
    'sets',          coalesce(st->'sets', '[]'::jsonb),
    'sets_won',      coalesce(st->'setsWon', jsonb_build_object('t1', 0, 't2', 0)),
    'current_game',  coalesce(st->'currentGame', 'null'::jsonb),
    'tie_break',     coalesce(st->'tieBreak', 'false'::jsonb),
    'contest_count', coalesce(s.contest_count, 0),
    'input_device',  coalesce(s.input_device, 'phone'),
    'is_scorer',     (s.scorer_id = p_player),
    'finished',      (s.status <> 'live')
  );
END; $$;

REVOKE ALL ON FUNCTION public.fn_watch_payload(uuid, uuid) FROM PUBLIC;

-- ── Quelle session dois-je scorer ? ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.watch_current_session(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.watch_links; v_sid uuid;
BEGIN
  l := public.fn_watch_link(p_token);
  SELECT id INTO v_sid FROM public.live_match_sessions
   WHERE scorer_id = l.player_id AND status = 'live'
   ORDER BY started_at DESC LIMIT 1;
  IF v_sid IS NULL THEN RETURN NULL; END IF;
  RETURN public.fn_watch_payload(v_sid, l.player_id);
END; $$;

-- ── Marquer depuis la montre ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.watch_apply_event(
  p_token text, p_session_id uuid, p_event_type text,
  p_payload jsonb DEFAULT '{}', p_client_seq int DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.watch_links;
BEGIN
  l := public.fn_watch_link(p_token);
  -- Seuls les événements de saisie sont permis depuis la montre : ni contestation,
  -- ni abandon, ni finalisation (spec §12 — la montre ne valide pas).
  IF p_event_type NOT IN ('game_won','point_won','undo') THEN
    RAISE EXCEPTION 'invalid_event_type';
  END IF;
  PERFORM public.fn_apply_live_event_as(
    p_session_id, l.player_id, p_event_type, p_payload, l.id, p_client_seq, 'watch');
  RETURN public.fn_watch_payload(p_session_id, l.player_id);
END; $$;

REVOKE ALL ON FUNCTION public.watch_current_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.watch_apply_event(text, uuid, text, jsonb, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.watch_current_session(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.watch_apply_event(text, uuid, text, jsonb, int) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2 : Faire appliquer la migration par le user, attendre confirmation**

- [ ] **Step 3 : Vérifier — jeton invalide rejeté**

```sql
SELECT public.watch_current_session('jeton-bidon');
```

Attendu : erreur `token_revoked`.

- [ ] **Step 4 : Vérifier — idempotence**

Créer un lien de test, démarrer une session live depuis l'app, puis :

```sql
-- <TOKEN> = jeton rendu par redeem_watch_pairing_code, <SID> = session live en cours
SELECT public.watch_apply_event('<TOKEN>', '<SID>', 'game_won', '{"team":1}', 1);
SELECT public.watch_apply_event('<TOKEN>', '<SID>', 'game_won', '{"team":1}', 1); -- rejoué
SELECT count(*) FROM public.live_match_events
 WHERE session_id = '<SID>' AND client_seq = 1;
```

Attendu : **1** seul événement. C'est LA vérification qui protège des points doublés.

- [ ] **Step 5 : Vérifier — le verrou bloque le téléphone**

Après l'étape 4, depuis l'app téléphone, essayer de marquer un point sur cette session.

Attendu : erreur `watch_has_control` (l'UI ne la gère pas encore, c'est normal — Task 6).

- [ ] **Step 6 : Proposer le commit**

```bash
git add supabase/migrations/watch_rpcs.sql
git commit -m "feat(montre): RPC de session et de saisie pour la montre"
```

---

## Task 4 : Client téléphone d'appairage

**Files:**
- Create: `lib/watchLink.ts`
- Test: `lib/__tests__/watchLink.test.ts`

**Interfaces:**
- Consumes: RPC de Task 1.
- Produces: `createPairingCode(): Promise<string>`, `listWatchLinks(): Promise<WatchLink[]>`, `revokeWatchLink(id: string): Promise<void>`, `formatCode(code: string): string`, `type WatchLink = { id: string; device_label: string | null; created_at: string; last_seen_at: string | null }`.

- [ ] **Step 1 : Écrire le test qui échoue**

```typescript
// lib/__tests__/watchLink.test.ts
import { describe, it, expect } from 'vitest';
import { formatCode } from '../watchLink';

describe('formatCode', () => {
  it('coupe le code en deux groupes de trois pour la lisibilite', () => {
    expect(formatCode('123456')).toBe('123 456');
  });
  it('laisse intact ce qui ne fait pas six chiffres', () => {
    expect(formatCode('12345')).toBe('12345');
    expect(formatCode('')).toBe('');
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier qu'il échoue**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "../watchLink"`.

- [ ] **Step 3 : Écrire l'implémentation**

```typescript
// lib/watchLink.ts
// Appairage montre ↔ compte : le téléphone génère un code éphémère, la montre
// l'échange contre un jeton durable. Cf. docs/superpowers/specs/2026-08-25-app-montre-design.md §5
import { supabase } from './supabase';

export type WatchLink = {
  id: string;
  device_label: string | null;
  created_at: string;
  last_seen_at: string | null;
};

// « 123 456 » se relit et se saisit plus sûrement que « 123456 » sur un petit écran.
export function formatCode(code: string): string {
  return /^\d{6}$/.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export async function createPairingCode(): Promise<string> {
  const { data, error } = await supabase.rpc('create_watch_pairing_code');
  if (error) throw error;
  return data as string;
}

export async function listWatchLinks(): Promise<WatchLink[]> {
  const { data, error } = await supabase.rpc('list_watch_links');
  if (error) throw error;
  return (data as WatchLink[]) ?? [];
}

export async function revokeWatchLink(id: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_watch_link', { p_link_id: id });
  if (error) throw error;
}
```

- [ ] **Step 4 : Lancer le test, vérifier qu'il passe**

Run: `npm test`
Expected: PASS, et les 43 tests existants toujours verts.

- [ ] **Step 5 : Proposer le commit**

```bash
git add lib/watchLink.ts lib/__tests__/watchLink.test.ts
git commit -m "feat(montre): client d'appairage cote telephone"
```

---

## Task 5 : Écran « Connecter ma montre »

**Files:**
- Create: `app/watch-link.tsx`
- Modify: `components/profile/ProfileMenuSheet.tsx` (groupe « Compte »)

**Interfaces:**
- Consumes: `createPairingCode`, `listWatchLinks`, `revokeWatchLink`, `formatCode` (Task 4).
- Produces: route `/watch-link`.

- [ ] **Step 1 : Créer l'écran**

```tsx
// app/watch-link.tsx
// Écran « Connecter ma montre » : génère un code à 6 chiffres valable 5 min,
// et liste les montres déjà liées (avec possibilité de les délier).
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts, FontSize, Radius, Spacing } from '../lib/theme';
import { createPairingCode, listWatchLinks, revokeWatchLink, formatCode, type WatchLink } from '../lib/watchLink';

const VALIDITY_MS = 5 * 60 * 1000;

export default function WatchLinkScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState<string | null>(null);
  const [codeAt, setCodeAt] = useState<number>(0);
  const [links, setLinks] = useState<WatchLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);

  const reload = useCallback(async () => {
    try { setLinks(await listWatchLinks()); } catch { /* liste non bloquante */ }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Tick seconde : fait vivre le compte à rebours de validité du code.
  useEffect(() => {
    if (!code) return;
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [code]);

  const remaining = code ? Math.max(0, VALIDITY_MS - (Date.now() - codeAt)) : 0;
  const expired = !!code && remaining === 0;

  const onGenerate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const c = await createPairingCode();
      setCode(c);
      setCodeAt(Date.now());
    } catch (e: any) {
      Alert.alert('Erreur', String(e?.message ?? e));
    } finally { setBusy(false); }
  };

  const onRevoke = (l: WatchLink) => {
    Alert.alert('Délier cette montre ?', 'Elle ne pourra plus marquer de points tant que tu ne la reconnecteras pas.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Délier', style: 'destructive',
        onPress: async () => {
          try { await revokeWatchLink(l.id); await reload(); }
          catch (e: any) { Alert.alert('Erreur', String(e?.message ?? e)); }
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.75}>
          <Text style={{ fontSize: 22, fontWeight: '900', color: Colors.textPrimary }}>‹</Text>
        </TouchableOpacity>
        <Text numberOfLines={1} adjustsFontSizeToFit style={{ flex: 1, fontFamily: Fonts.uiBlack, fontSize: 17, color: Colors.textPrimary, paddingRight: 6 }}>
          Connecter ma montre
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: Spacing.md, paddingBottom: insets.bottom + 40, gap: Spacing.md }}>
        <Text style={{ fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 }}>
          Ouvre PagMatch sur ta montre, puis saisis le code ci-dessous. Une seule fois :
          ensuite ta montre retrouvera tes matchs toute seule.
        </Text>

        <View style={{ backgroundColor: Colors.bgCard, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm }}>
          {code && !expired ? (
            <>
              <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 40, letterSpacing: 4, color: Colors.textPrimary }}>
                {formatCode(code)}
              </Text>
              <Text style={{ fontSize: FontSize.xs, color: Colors.textMuted }}>
                Valable encore {Math.ceil(remaining / 1000)} s
              </Text>
            </>
          ) : (
            <Text style={{ fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center' }}>
              {expired ? 'Code expiré — génères-en un nouveau.' : 'Aucun code en cours.'}
            </Text>
          )}
          <TouchableOpacity onPress={onGenerate} disabled={busy} activeOpacity={0.85}
            style={{ backgroundColor: Colors.brand, borderRadius: Radius.md, paddingVertical: 12, paddingHorizontal: Spacing.lg, opacity: busy ? 0.6 : 1 }}>
            {busy
              ? <ActivityIndicator color={Colors.textOnBrand} size="small" />
              : <Text style={{ fontFamily: Fonts.uiBlack, fontSize: FontSize.sm, color: Colors.textOnBrand }}>
                  {code ? 'Générer un nouveau code' : 'Générer un code'}
                </Text>}
          </TouchableOpacity>
        </View>

        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: FontSize.sm, color: Colors.textPrimary }}>
          Montres connectées
        </Text>
        {links.length === 0 ? (
          <Text style={{ fontSize: FontSize.xs, color: Colors.textMuted }}>Aucune montre pour l'instant.</Text>
        ) : links.map(l => (
          <View key={l.id} style={{ backgroundColor: Colors.bgCard, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: FontSize.sm, fontWeight: '800', color: Colors.textPrimary }}>
                {l.device_label ?? 'Montre'}
              </Text>
              <Text style={{ fontSize: FontSize.xs, color: Colors.textMuted }}>
                {l.last_seen_at ? `Vue le ${new Date(l.last_seen_at).toLocaleDateString('fr-FR')}` : 'Jamais utilisée'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => onRevoke(l)} activeOpacity={0.75}>
              <Text style={{ fontSize: FontSize.xs, fontWeight: '900', color: Colors.danger }}>Délier</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
```

- [ ] **Step 2 : Ajouter l'entrée de menu**

Dans `components/profile/ProfileMenuSheet.tsx`, groupe « Compte », juste après « Confidentialité des messages » :

```tsx
          <Row icon="clock" label="Connecter ma montre" onPress={() => nav('/watch-link')} />
```

> Il n'existe pas d'icône « montre » dans le registre (`components/community/icons.tsx`) : `clock` est le plus proche. Ajouter une vraie icône est un polish différé.

- [ ] **Step 3 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune sortie.

- [ ] **Step 4 : Vérifier à l'écran**

Publier sur la branche EAS `preview`, ouvrir Profil → menu → « Connecter ma montre », générer un code. Attendu : six chiffres affichés en gros, compte à rebours qui descend, liste vide.

- [ ] **Step 5 : Proposer le commit**

```bash
git add app/watch-link.tsx components/profile/ProfileMenuSheet.tsx
git commit -m "feat(montre): ecran de connexion de la montre"
```

---

## Task 6 : Verrouillage dans l'écran live

**Files:**
- Modify: `app/live/[sessionId].tsx`
- Modify: `lib/liveSession.ts`

**Interfaces:**
- Consumes: colonne `input_device` (Task 2), erreur `watch_has_control` (Task 2).
- Produces: `claimPhoneInput(sessionId: string): Promise<void>` dans `lib/liveSession.ts` ; champ `input_device` sur le type `LiveSession`.

- [ ] **Step 1 : Étendre le type et le client**

Dans `lib/liveSession.ts`, ajouter au type `LiveSession` :

```typescript
  // Appareil qui a la main sur la saisie (migration watch_input_device.sql).
  // Sessions antérieures : champ absent → 'phone'.
  input_device?: 'phone' | 'watch';
```

Puis ajouter la fonction de reprise :

```typescript
// Reprise explicite de la saisie sur CE téléphone : le seul moyen de reprendre
// la main à la montre (elle, la prend automatiquement au premier appui).
// RPC dédiée : elle ne pose AUCUN événement, donc elle ne touche ni au score
// ni au compteur de contestations.
export async function claimPhoneInput(sessionId: string): Promise<void> {
  const { error } = await supabase.rpc('claim_phone_input', { p_session_id: sessionId });
  if (error) throw error;
}
```

- [ ] **Step 2 : Ne pas jeter les événements bloqués par le verrou**

Dans `flush()` de `lib/liveSession.ts`, la liste `business` fait actuellement jeter tout événement dont l'erreur est « métier ». `watch_has_control` **ne doit pas** y figurer : l'événement doit être jeté aussi (le point a été marqué à la montre, le rejouer le doublerait), mais avec un message clair. Modifier :

```typescript
        const business = ['not_the_scorer', 'session_not_live', 'session_not_found', 'invalid_event_type', 'not_a_participant', 'not_authenticated', 'wrong_scoring_mode', 'watch_has_control'];
```

- [ ] **Step 3 : Protéger `input_device` du cache de schéma Realtime**

⚠️ **À faire avant tout le reste dans ce fichier.** Le handler realtime de
`app/live/[sessionId].tsx` protège déjà `scoring_mode` et `golden_point` contre les
payloads qui arrivent SANS la colonne (cache de schéma Realtime pas encore rafraîchi
après une migration). `input_device` est introduit par la migration de cette vague : il
est exactement dans ce cas et doit recevoir la même protection.

Ajouter au même objet de fusion :

```tsx
input_device: s.input_device ?? prev.input_device,
```

Sans ça, un payload amputé remet `watchHasControl` à `false`, le téléphone rouvre ses
boutons, l'événement part, se fait rejeter en `watch_has_control` puis jeter — mais le
`progressKey` local a déjà avancé, donc la réconciliation ne ré-adopte plus jamais l'état
serveur : **score divergent pour le reste du match.**

- [ ] **Step 4 : Afficher le bandeau dans l'écran live**

Dans `app/live/[sessionId].tsx`, calculer l'état :

```tsx
  // La montre a la main : le téléphone affiche mais ne marque plus (spec §8).
  const watchHasControl = session?.input_device === 'watch';
```

Puis, juste avant le bloc de saisie du scoreur (`{isScorer ? (`), insérer :

```tsx
        {isScorer && watchHasControl && (
          <View style={sty.contestBanner}>
            <Text style={sty.contestTxt}>⌚ C'est ta montre qui marque.</Text>
            <TouchableOpacity onPress={onClaimInput} style={sty.contestBtn} activeOpacity={0.8}>
              <Text style={sty.contestBtnTxt}>Reprendre la saisie ici</Text>
            </TouchableOpacity>
          </View>
        )}
```

Et griser les deux gros boutons quand la montre a la main : ajouter `disabled={watchHasControl}` et `watchHasControl && { opacity: 0.4 }` à leur style.

Handler :

```tsx
  const onClaimInput = async () => {
    if (!sessionId) return;
    try {
      await claimPhoneInput(sessionId);
      if (mounted.current) {
        setSession(prev => prev ? { ...prev, input_device: 'phone' } : prev);
      }
    } catch (e: any) {
      Alert.alert('Impossible de reprendre la saisie', String(e?.message ?? e));
    }
  };
```

Ne pas oublier l'import de `claimPhoneInput` depuis `../../lib/liveSession`.

- [ ] **Step 4 : Vérifier la compilation et les tests**

Run: `npx tsc --noEmit` puis `npm test`
Expected: aucune sortie, puis 45 tests verts (43 existants + 2 de Task 4).

- [ ] **Step 5 : Vérifier le comportement**

Avec une session live et le jeton de test de Task 3 : marquer un point via `watch_apply_event` en SQL, puis regarder l'écran live du téléphone. Attendu : bandeau « C'est ta montre qui marque », boutons grisés. Appuyer sur « Reprendre la saisie ici » : le bandeau disparaît, les boutons redeviennent actifs.

- [ ] **Step 6 : Proposer le commit**

```bash
git add app/live/[sessionId].tsx lib/liveSession.ts
git commit -m "feat(montre): verrouillage de la saisie telephone quand la montre a la main"
```

---

## Task 7 : App montre — appairage

**Files:**
- Create: `watch/manifest.xml`, `watch/monkey.jungle`, `watch/build.ps1`, `watch/.gitignore`
- Create: `watch/source/PagMatchApp.mc`, `watch/source/Config.mc`, `watch/source/Api.mc`, `watch/source/PairingView.mc`
- Create: `watch/resources/strings/strings.xml`, `watch/resources/drawables/drawables.xml`, `watch/resources/drawables/launcher_icon.png`

**Interfaces:**
- Consumes: `redeem_watch_pairing_code` (Task 1).
- Produces: `Api.token()`, `Api.setToken(t)`, `Api.hasToken()`, `Api.redeem(code, callback)`, `Api.currentSession(callback)`, `Api.applyEvent(sessionId, type, team, clientSeq, callback)`.

Point de départ : **copier le projet du spike** `spikes/garmin-connectiq/` (manifeste, jungle, `build.ps1`, icône, ressources) vers `watch/`, puis remplacer les sources. Le spike garde ainsi sa valeur d'archive et `watch/` devient le vrai projet.

- [ ] **Step 1 : Copier la base et ajuster le manifeste**

```powershell
Copy-Item -Recurse "spikes\garmin-connectiq" "watch"
Remove-Item -Recurse -Force "watch\bin","watch\sql","watch\source" -ErrorAction SilentlyContinue
Remove-Item "watch\README.md" -ErrorAction SilentlyContinue
New-Item -ItemType Directory "watch\source" | Out-Null
```

Dans `watch/manifest.xml`, remplacer `entry="PagMatchProbeApp"` par `entry="PagMatchApp"`, et le nom d'app dans `watch/resources/strings/strings.xml` par `PagMatch`. Générer un nouvel `id` (32 hex, via `(New-Guid).Guid.Replace("-","").ToUpper()`) : c'est une **autre** application que la sonde, elles doivent pouvoir cohabiter sur la montre.

Dans `watch/build.ps1`, renommer le fichier de sortie pour qu'il ne s'appelle plus « Probe » :

```powershell
$Prg = Join-Path $BinDir ("PagMatch-" + $Device + ".prg")
```

- [ ] **Step 2 : Écrire la configuration**

```monkeyc
// watch/source/Config.mc
// SEUL fichier à toucher si le projet Supabase change.
// La clé anon est PUBLIQUE par conception (déjà embarquée dans l'APK) : les
// droits réels sont portés par le jeton d'appairage, jamais par cette clé.
module Config {
    const SUPABASE_URL = "https://icshhobxeppttgayxmba.supabase.co";
    const ANON_KEY = "<copier EXPO_PUBLIC_SUPABASE_ANON_KEY depuis react-matchup/.env>";
    const DEVICE_LABEL = "epix2";
}
```

- [ ] **Step 3 : Écrire la couche réseau**

```monkeyc
// watch/source/Api.mc
// Toutes les requêtes vers Supabase. Le jeton d'appairage est stocké en
// permanence dans Application.Storage : il survit aux redémarrages.
using Toybox.Communications;
using Toybox.Application;
using Toybox.Lang;

module Api {

    const KEY_TOKEN = "watch_token";

    function token() {
        return Application.Storage.getValue(KEY_TOKEN);
    }

    function hasToken() {
        var t = token();
        return t != null && t.length() > 0;
    }

    function setToken(t) {
        Application.Storage.setValue(KEY_TOKEN, t);
    }

    function clearToken() {
        Application.Storage.deleteValue(KEY_TOKEN);
    }

    hidden function headers() {
        return {
            "Content-Type"  => Communications.REQUEST_CONTENT_TYPE_JSON,
            "apikey"        => Config.ANON_KEY,
            "Authorization" => "Bearer " + Config.ANON_KEY
        };
    }

    hidden function post(path, body, cb) {
        Communications.makeWebRequest(
            Config.SUPABASE_URL + "/rest/v1/rpc/" + path,
            body,
            {
                :method => Communications.HTTP_REQUEST_METHOD_POST,
                :headers => headers(),
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            cb
        );
    }

    // cb.invoke(responseCode, data)
    function redeem(code, cb) {
        post("redeem_watch_pairing_code",
             { "p_code" => code, "p_device_label" => Config.DEVICE_LABEL }, cb);
    }

    function currentSession(cb) {
        post("watch_current_session", { "p_token" => token() }, cb);
    }

    function applyEvent(sessionId, eventType, team, clientSeq, cb) {
        post("watch_apply_event", {
            "p_token"      => token(),
            "p_session_id" => sessionId,
            "p_event_type" => eventType,
            "p_payload"    => { "team" => team },
            "p_client_seq" => clientSeq
        }, cb);
    }
}
```

- [ ] **Step 4 : Écrire l'écran d'appairage**

```monkeyc
// watch/source/PairingView.mc
// Saisie du code à 6 chiffres. Un chiffre à la fois : HAUT/BAS changent le
// chiffre courant, SELECT valide et passe au suivant, BACK revient en arrière.
// Chaines AFFICHEES sans accents (polices Garmin).
using Toybox.WatchUi;
using Toybox.Graphics;

class PairingView extends WatchUi.View {

    hidden var _digits = [0, 0, 0, 0, 0, 0];
    hidden var _pos = 0;
    hidden var _status = "";

    function initialize() { View.initialize(); }

    function up()   { _digits[_pos] = (_digits[_pos] + 1) % 10; WatchUi.requestUpdate(); }
    function down() { _digits[_pos] = (_digits[_pos] + 9) % 10; WatchUi.requestUpdate(); }

    function back() {
        if (_pos > 0) { _pos = _pos - 1; WatchUi.requestUpdate(); return true; }
        return false;
    }

    function code() {
        var s = "";
        for (var i = 0; i < 6; i = i + 1) { s = s + _digits[i].toString(); }
        return s;
    }

    function setStatus(s) { _status = s; WatchUi.requestUpdate(); }

    // Renvoie true si le code est complet et doit etre envoye.
    function next() {
        if (_pos < 5) { _pos = _pos + 1; WatchUi.requestUpdate(); return false; }
        return true;
    }

    function onUpdate(dc) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var w = dc.getWidth();
        var h = dc.getHeight();

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 18 / 100, Graphics.FONT_XTINY, "Code affiche dans l app", Graphics.TEXT_JUSTIFY_CENTER);

        var s = "";
        for (var i = 0; i < 6; i = i + 1) {
            s = s + _digits[i].toString();
            if (i == 2) { s = s + " "; }
        }
        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 40 / 100, Graphics.FONT_NUMBER_MILD, s, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 62 / 100, Graphics.FONT_XTINY, "Chiffre " + (_pos + 1) + "/6", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(w / 2, h * 74 / 100, Graphics.FONT_XTINY, "HAUT/BAS puis SELECT", Graphics.TEXT_JUSTIFY_CENTER);

        if (!_status.equals("")) {
            dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 86 / 100, Graphics.FONT_XTINY, _status, Graphics.TEXT_JUSTIFY_CENTER);
        }
    }
}

class PairingDelegate extends WatchUi.BehaviorDelegate {

    hidden var _view;

    function initialize(view) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    function onPreviousPage() { _view.up();   return true; }
    function onNextPage()     { _view.down(); return true; }
    function onBack()         { return _view.back(); }

    function onSelect() {
        if (_view.next()) {
            _view.setStatus("Envoi...");
            Api.redeem(_view.code(), method(:onRedeem));
        }
        return true;
    }

    function onRedeem(responseCode, data) {
        if (responseCode == 200 && data != null) {
            Api.setToken(data);
            // SessionDelegate PREND la vue en argument : ne jamais l'instancier
            // sans, sinon l'app plante à la bascule.
            var v = new SessionView();
            WatchUi.switchToView(v, new SessionDelegate(v), WatchUi.SLIDE_IMMEDIATE);
        } else if (responseCode == 400 || responseCode == 404) {
            _view.setStatus("Code refuse");
        } else {
            _view.setStatus("Erreur " + responseCode.toString());
        }
    }
}
```

- [ ] **Step 5 : Écrire le point d'entrée**

```monkeyc
// watch/source/PagMatchApp.mc
// Le nom de cette classe doit rester synchronisé avec l'attribut `entry`
// de manifest.xml, sinon l'app ne démarre pas.
using Toybox.Application;
using Toybox.WatchUi;

class PagMatchApp extends Application.AppBase {

    function initialize() { AppBase.initialize(); }

    function getInitialView() {
        // Déjà appairée → droit au match. Sinon → saisie du code.
        // Les deux delegates prennent leur vue en argument.
        if (Api.hasToken()) {
            var s = new SessionView();
            return [s, new SessionDelegate(s)];
        }
        var v = new PairingView();
        return [v, new PairingDelegate(v)];
    }
}
```

- [ ] **Step 6 : Compiler**

Cette tâche ne compile qu'une fois `SessionView` / `SessionDelegate` écrits (Task 8). **Enchaîner sur Task 8 avant de compiler**, ou créer un `SessionView` vide temporaire pour valider la syntaxe :

Run: `cd watch; .\build.ps1 -Device epix2`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 7 : Proposer le commit**

```bash
git add watch/
git commit -m "feat(montre): projet Connect IQ et ecran d'appairage"
```

---

## Task 8 : App montre — session, saisie et file locale

**Files:**
- Create: `watch/source/SessionView.mc`, `watch/source/Queue.mc`

**Interfaces:**
- Consumes: `Api` (Task 7), `watch_current_session` / `watch_apply_event` (Task 3).
- Produces: `SessionView`, `SessionDelegate` (référencées par Task 7).

- [ ] **Step 1 : Écrire la file locale**

```monkeyc
// watch/source/Queue.mc
// File d'envoi persistante : un appui est enregistré ICI d'abord, envoyé
// ensuite. Tant qu'un envoi n'a pas été acquitté, l'événement reste en tête
// et sera rejoué — c'est l'idempotence côté serveur (client_seq) qui rend ce
// rejeu sûr. Cf. spec §7.
using Toybox.Application;
using Toybox.Lang;

module Queue {

    const KEY_ITEMS = "queue_items";
    const KEY_SEQ   = "queue_seq";

    function items() {
        var v = Application.Storage.getValue(KEY_ITEMS);
        if (v == null) { return []; }
        return v;
    }

    hidden function save(a) {
        Application.Storage.setValue(KEY_ITEMS, a);
    }

    // client_seq monotone, JAMAIS réutilisé : c'est la clé d'idempotence.
    function nextSeq() {
        var s = Application.Storage.getValue(KEY_SEQ);
        if (s == null) { s = 0; }
        s = s + 1;
        Application.Storage.setValue(KEY_SEQ, s);
        return s;
    }

    function push(sessionId, eventType, team, seq) {
        var a = items();
        a.add({ "sid" => sessionId, "type" => eventType, "team" => team, "seq" => seq });
        save(a);
    }

    function head() {
        var a = items();
        if (a.size() == 0) { return null; }
        return a[0];
    }

    function popHead() {
        var a = items();
        if (a.size() == 0) { return; }
        var b = [];
        for (var i = 1; i < a.size(); i = i + 1) { b.add(a[i]); }
        save(b);
    }

    function size() { return items().size(); }

    function clear() { save([]); }
}
```

- [ ] **Step 2 : Écrire l'écran de match**

```monkeyc
// watch/source/SessionView.mc
// Écran principal : score du match courant + saisie.
// La montre N'A PAS de moteur de score : elle affiche ce que le serveur
// renvoie (spec §13). Le seul état local est la file d'envoi.
// Chaines AFFICHEES sans accents (polices Garmin).
using Toybox.WatchUi;
using Toybox.Graphics;
using Toybox.Timer;

class SessionView extends WatchUi.View {

    hidden var _sid = null;
    hidden var _team1 = "Equipe 1";
    hidden var _team2 = "Equipe 2";
    hidden var _setsWon1 = 0;
    hidden var _setsWon2 = 0;
    hidden var _games1 = 0;
    hidden var _games2 = 0;
    hidden var _mode = "games";
    hidden var _contests = 0;
    hidden var _finished = false;
    hidden var _isScorer = true;
    hidden var _msg = "Chargement...";
    hidden var _timer = null;

    function initialize() { View.initialize(); }

    function onShow() {
        refresh();
        _timer = new Timer.Timer();
        // Renvoi périodique de la file + rafraichissement de l'affichage.
        _timer.start(method(:onTick), 5000, true);
    }

    function onHide() {
        if (_timer != null) { _timer.stop(); _timer = null; }
    }

    function onTick() {
        if (Queue.size() > 0) { sendHead(); } else { refresh(); }
    }

    function sessionId() { return _sid; }
    function isReady() { return _sid != null && !_finished && _isScorer; }

    function refresh() {
        Api.currentSession(method(:onSession));
    }

    function onSession(responseCode, data) {
        if (responseCode != 200) {
            _msg = "Hors ligne (" + responseCode.toString() + ")";
            WatchUi.requestUpdate();
            return;
        }
        if (data == null) {
            _sid = null;
            _msg = "Aucun match en cours";
            WatchUi.requestUpdate();
            return;
        }
        apply(data);
    }

    hidden function apply(d) {
        _sid      = d["session_id"];
        _team1    = d["team1"];
        _team2    = d["team2"];
        _mode     = d["scoring_mode"];
        _contests = d["contest_count"];
        _finished = d["finished"];
        _isScorer = d["is_scorer"];

        var sw = d["sets_won"];
        _setsWon1 = sw["t1"];
        _setsWon2 = sw["t2"];

        // Set en cours = dernier élément du tableau des sets.
        var sets = d["sets"];
        if (sets != null && sets.size() > 0) {
            var last = sets[sets.size() - 1];
            _games1 = last["t1"];
            _games2 = last["t2"];
        }

        if (_finished) {
            _msg = "Match termine - valide sur le tel";
        } else if (!_isScorer) {
            _msg = "Tu n es plus le scoreur";
        } else if (d["input_device"].equals("phone") && Queue.size() == 0) {
            _msg = "Le telephone a repris la main";
        } else {
            _msg = "";
        }
        WatchUi.requestUpdate();
    }

    // Enregistre localement PUIS envoie : le poignet ne doit jamais attendre.
    function tap(eventType, team) {
        if (!isReady()) { return; }
        Queue.push(_sid, eventType, team, Queue.nextSeq());
        _msg = "";
        WatchUi.requestUpdate();
        sendHead();
    }

    function sendHead() {
        var e = Queue.head();
        if (e == null) { return; }
        Api.applyEvent(e["sid"], e["type"], e["team"], e["seq"], method(:onSent));
    }

    function onSent(responseCode, data) {
        if (responseCode == 200) {
            Queue.popHead();
            if (data != null) { apply(data); }
            if (Queue.size() > 0) { sendHead(); } // on vide la file d'affilée
            return;
        }
        // 4xx = refus métier définitif : rejouer ne servirait à rien et
        // bloquerait la file pour toujours. On jette et on prévient.
        if (responseCode >= 400 && responseCode < 500) {
            Queue.popHead();
            _msg = "Refuse (" + responseCode.toString() + ")";
        } else {
            _msg = "En attente reseau (" + Queue.size().toString() + ")";
        }
        WatchUi.requestUpdate();
    }

    function onUpdate(dc) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var w = dc.getWidth();
        var h = dc.getHeight();

        if (_sid == null) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h / 2, Graphics.FONT_SMALL, _msg, Graphics.TEXT_JUSTIFY_CENTER);
            return;
        }

        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 10 / 100, Graphics.FONT_XTINY, _team1, Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 26 / 100, Graphics.FONT_NUMBER_MILD,
                    _setsWon1.toString() + " - " + _games1.toString(), Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 50 / 100, Graphics.FONT_XTINY, _team2, Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 64 / 100, Graphics.FONT_NUMBER_MILD,
                    _setsWon2.toString() + " - " + _games2.toString(), Graphics.TEXT_JUSTIFY_CENTER);

        if (_contests > 0) {
            dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 84 / 100, Graphics.FONT_XTINY,
                        _contests.toString() + " contestation(s)", Graphics.TEXT_JUSTIFY_CENTER);
        } else if (!_msg.equals("")) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 84 / 100, Graphics.FONT_XTINY, _msg, Graphics.TEXT_JUSTIFY_CENTER);
        }
    }
}

class SessionDelegate extends WatchUi.BehaviorDelegate {

    hidden var _view;

    function initialize(view) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    // Le type d'evenement depend de la granularite choisie au demarrage.
    hidden function scoreEvent() {
        return _view.isPointMode() ? "point_won" : "game_won";
    }

    function onSelect()       { _view.tap(scoreEvent(), 1); return true; }
    function onNextPage()     { _view.tap(scoreEvent(), 2); return true; }
    function onPreviousPage() { _view.tap("undo", 0);       return true; }
}
```

- [ ] **Step 3 : Ajouter l'accesseur de mode manquant**

`SessionDelegate.scoreEvent()` appelle `isPointMode()`. Ajouter dans `SessionView` :

```monkeyc
    function isPointMode() { return _mode != null && _mode.equals("points"); }
```

- [ ] **Step 4 : Compiler**

Run: `cd watch; .\build.ps1 -Device epix2`
Expected: `BUILD SUCCESSFUL`.

En cas d'erreur de type sur un callback réseau, appliquer la signature exacte que le SDK attend (piège déjà rencontré sur le spike) :

```monkeyc
function onSession(responseCode as Lang.Number, data as Lang.Dictionary or Lang.String or Null) as Void {
```

- [ ] **Step 5 : Vérifier dans le simulateur**

Run: `cd watch; .\build.ps1 -Device epix2 -Sim`
Expected: l'écran d'appairage s'affiche au premier lancement ; après saisie d'un code valide généré depuis l'app, on bascule sur l'écran de match.

- [ ] **Step 6 : Proposer le commit**

```bash
git add watch/source/SessionView.mc watch/source/Queue.mc
git commit -m "feat(montre): ecran de match, saisie et file d'envoi locale"
```

---

## Task 9 : Test réel sur la montre

**Files:** aucun — validation de bout en bout.

- [ ] **Step 1 : Installer sur la montre**

```powershell
cd watch; .\build.ps1 -Device epix2
```

Copier `watch\bin\PagMatch-epix2.prg` dans `GARMIN/Apps` de la montre. **La montre est en MTP : pas de lettre de lecteur, `Copy-Item` ne marche pas.** Passer par le COM `Shell.Application` (procédure éprouvée lors du spike) :

```powershell
$src = (Resolve-Path "watch\bin\PagMatch-epix2.prg").Path
$shell = New-Object -ComObject Shell.Application
$epix = $shell.NameSpace(17).Items() | Where-Object { $_.Name -eq "EPIX" }
$garmin = ($epix.GetFolder.Items() | Where-Object { $_.Name -eq "Internal Storage" }).GetFolder.Items() | Where-Object { $_.Name -eq "GARMIN" }
$apps = ($garmin.GetFolder.Items() | Where-Object { $_.Name -eq "Apps" }).GetFolder
$apps.CopyHere($shell.NameSpace((Split-Path $src)).ParseName((Split-Path $src -Leaf)), 16)
```

Si la montre n'apparaît pas dans « Ce PC », c'est le vieux pilote Garmin qui la capte en mode GPS : `pnputil /delete-driver oem74.inf /uninstall` en administrateur, puis rebrancher.

- [ ] **Step 2 : Appairer**

Générer un code dans l'app (Profil → Connecter ma montre), le saisir sur la montre. Attendu : bascule immédiate sur l'écran de match ou « Aucun match en cours ».

- [ ] **Step 3 : Match complet**

Démarrer une session live depuis le téléphone en se déclarant scoreur, ranger le téléphone, jouer (ou simuler) un set complet à la montre.

Vérifier : le score au poignet suit, et sur un autre téléphone (compte lecteur) le score progresse aussi.

- [ ] **Step 4 : Test de coupure — le plus important**

En plein match, mettre le téléphone en mode avion. Marquer 3 points à la montre : ils doivent s'afficher au poignet immédiatement et la montre indiquer une attente réseau. Réactiver le réseau.

Attendu : les 3 points remontent, **et le total est exact — ni perdu, ni doublé.** Vérifier en SQL :

```sql
SELECT event_type, client_seq, count(*) OVER () AS total
  FROM public.live_match_events WHERE session_id = '<SID>' ORDER BY seq;
```

- [ ] **Step 5 : Test du garde-fou**

Sortir le téléphone en cours de match et essayer de marquer. Attendu : bandeau « C'est ta montre qui marque », boutons inactifs. Appuyer sur « Reprendre la saisie ici », marquer un point : il passe, et la montre affiche « Le telephone a repris la main ».

- [ ] **Step 6 : Fin de match**

Terminer le match. Attendu : la montre affiche « Match termine - valide sur le tel ». Valider sur le téléphone ; les adversaires reçoivent « 📋 Score à valider ».

- [ ] **Step 7 : Nettoyer le spike**

Une fois le test concluant, la sonde n'a plus de raison d'être :

```sql
DROP FUNCTION IF EXISTS public.live_probe(text);
NOTIFY pgrst, 'reload schema';
```

```bash
git rm -r spikes/garmin-connectiq
git commit -m "chore: suppression du spike Connect IQ, remplace par watch/"
```

---

## Task 10 : Score point par point au poignet

> Ajoutée après la relecture de la vague montre : `fn_watch_payload` renvoyait déjà
> `current_game`/`tie_break`, mais la montre ne les affichait pas — alors que la spec §11
> l'exige. Le user a précisé que le mode point par point sera une **fonction premium** :
> il doit donc être complet, pas approximatif.
>
> **Décision de conception :** le formatage 0/15/30/40/AV vit **côté serveur**, pas sur la
> montre. Une copie en Monkey C serait la TROISIÈME implémentation de la sémantique de
> score du projet (après `lib/liveScore.ts` et `fn_live_replay`), ce que la spec §13
> interdit. Côté serveur, le libellé profite en plus à tous les futurs clients — dont la
> télécommande par notification Apple Watch / Wear OS, qui aura le même besoin.

**Files:**
- Modify: `supabase/migrations/watch_rpcs.sql`
- Modify: `watch/source/SessionView.mc`

**Interfaces:**
- Produces: clé `game_label` dans le jsonb de `watch_current_session` / `watch_apply_event` —
  `{"t1": "40", "t2": "AV"}`, ou `null` hors mode points.

- [ ] **Step 1 : Ajouter le formateur SQL**

Dans `supabase/migrations/watch_rpcs.sql`, avant `fn_watch_payload` :

```sql
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

REVOKE ALL ON FUNCTION public.fn_game_label(int, int, boolean, boolean) FROM PUBLIC;
```

- [ ] **Step 2 : Exposer `game_label` dans la charge utile**

Dans `fn_watch_payload`, ajouter cette clé au `jsonb_build_object` final (garder toutes
les autres inchangées) :

```sql
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
```

- [ ] **Step 3 : Vérifier le formateur en SQL**

```sql
SELECT public.fn_game_label(0, 0, true,  false);  -- {"t1":"0","t2":"0"}
SELECT public.fn_game_label(2, 3, true,  false);  -- {"t1":"30","t2":"40"}
SELECT public.fn_game_label(3, 3, true,  false);  -- {"t1":"40","t2":"40"}  (point en or)
SELECT public.fn_game_label(4, 3, false, false);  -- {"t1":"AV","t2":"40"}  (avantage)
SELECT public.fn_game_label(3, 4, false, false);  -- {"t1":"40","t2":"AV"}
SELECT public.fn_game_label(5, 6, true,  true);   -- {"t1":"5","t2":"6"}    (tie-break)
```

Chaque ligne doit renvoyer exactement le commentaire en regard. Ce sont les mêmes cas que
ceux couverts par les tests de `gameScoreLabels` côté TypeScript.

- [ ] **Step 4 : Afficher le point vif sur la montre**

Dans `watch/source/SessionView.mc`, mémoriser le libellé dans `apply()` :

```monkeyc
        _pointLabel = null;
        if (d["game_label"] != null) {
            var g = d["game_label"];
            _pointLabel = g["t1"] + " - " + g["t2"];
        }
```

avec le champ correspondant déclaré à côté des autres :

```monkeyc
    hidden var _pointLabel = null;   // "30 - 40" en mode points, null sinon
```

Puis, dans `onUpdate`, sous les deux lignes d'équipes et au-dessus de la ligne de message,
n'afficher la ligne que si elle existe :

```monkeyc
        if (_pointLabel != null) {
            dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 78 / 100, Graphics.FONT_NUMBER_MILD, _pointLabel, Graphics.TEXT_JUSTIFY_CENTER);
        }
```

Ajuster les positions verticales voisines si la ligne chevauche le message ou les
contestations — l'écran fait 416×416 sur `epix2`, il y a la place, mais vérifier qu'aucune
ligne n'en écrase une autre.

- [ ] **Step 5 : Recompiler**

Run: `cd watch; .\build.ps1 -Device epix2`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 6 : Proposer le commit**

```bash
git add -f supabase/migrations/watch_rpcs.sql
git add watch/source/SessionView.mc
git commit -m "feat(montre): score point par point affiche au poignet"
```

> ⚠️ `watch_rpcs.sql` doit être **RÉ-APPLIQUÉE** dans Supabase après cette tâche si elle
> l'a déjà été — elle est `CREATE OR REPLACE`, donc ré-appliquable sans danger.

## Ce que ce plan ne couvre PAS

- **Télécommande par notification** pour Apple Watch / Wear OS (spec §10) — chantier indépendant, plan séparé à écrire.
- **Publication sur la boutique Garmin** (spec §12) — dossier, pas du développement.
- Validation du score, règlement des contestations ou mode lecteur depuis la montre (spec §12, YAGNI assumé).
