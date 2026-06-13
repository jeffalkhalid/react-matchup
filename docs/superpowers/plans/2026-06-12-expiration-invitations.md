# Expiration & retrait des invitations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une invitation à une partie qui ne reçoit pas de réponse libère sa place — soit via retrait manuel du créateur, soit via un filet d'expiration automatique — et la place rouvre proprement (candidature atomique + promotion de la liste d'attente).

**Architecture:** Hybride. Une date `invite_expires_at` (calculée par trigger DB) ; les **lectures** ignorent déjà les invités expirés (place libre instantanément) ; un **cron** matérialise l'état terminal `expired`, et les push serveur passent par des **Database Webhooks → edge functions → `send-push`** (pattern `notify-eject` existant). La candidature passe par une RPC atomique `join_game()` sur l'occupation vivante ; toute libération de place appelle `free_spot_and_promote()`.

**Tech Stack:** Postgres / Supabase (plpgsql, pg_cron, Database Webhooks), Deno edge functions, React Native / Expo (TypeScript), Supabase JS client.

**Référence design :** `docs/superpowers/specs/2026-06-12-expiration-invitations-design.md`

---

## File Structure

**SQL (nouvelles migrations — convention du repo : nom descriptif, non timestampé)**
- `supabase/migrations/invite_expiry.sql` — colonne `invite_expires_at`, `CHECK` + `'expired'`, trigger `set_invite_expiry`, fonction `expire_stale_invitations()`, planif `pg_cron`.
- `supabase/migrations/free_spot_and_promote.sql` — fonction serveur partagée de promotion/libération.
- `supabase/migrations/join_game_rpc.sql` — RPC `join_game()`.
- `supabase/migrations/withdraw_invitation_rpc.sql` — RPC `withdraw_invitation()`.

**Tests SQL (transaction + ROLLBACK, exécutables dans le SQL editor Supabase)**
- `sql/tests/test_invite_expiry.sql`
- `sql/tests/test_free_spot_and_promote.sql`
- `sql/tests/test_expire_stale_invitations.sql`
- `sql/tests/test_join_game.sql`
- `sql/tests/test_withdraw_invitation.sql`

**Edge functions (Deno)**
- `supabase/functions/notify-invite-expired/index.ts` — webhook `invited→expired` → push à l'invité.
- `supabase/functions/notify-promotion/index.ts` — webhook `waitlist→accepted` → push au promu.

**Client (react-matchup)**
- `app/(tabs)/lobby.tsx` — `freeSpots()` + `GAME_SELECT`, `handleApply` → `join_game()`, `handleLeaveGame` → `free_spot_and_promote()`.
- `app/(tabs)/GameDetailsSheet.tsx` — bouton « Retirer » sur invités, filtre lazy des expirés.
- `lib/games.ts` (nouveau) — helpers `joinGame()`, `withdrawInvitation()`, `isInviteActive()`.

**Doc**
- `docs/DEPLOIEMENT_MAROC.md` — checklist : activer les 2 webhooks + déployer les 2 edge functions + vérifier pg_cron.

---

## Conventions de test SQL

Chaque test est un script idempotent enveloppé dans `BEGIN; … ROLLBACK;`, qui **sème ses propres données** (un club/joueur/partie jetables), exécute des `DO $$ … IF … THEN RAISE EXCEPTION … END $$;` et **n'écrit jamais en prod** (ROLLBACK final). Exécution : copier-coller dans **Supabase → SQL Editor → Run**. Un test qui passe ne renvoie aucune erreur ; un test qui échoue lève l'exception du `RAISE`.

Avant la 1re assertion, chaque script crée une partie de référence :
```sql
-- helper de seed réutilisé en tête de chaque test (adapter les ids)
INSERT INTO players (id, name, elo_score)
  VALUES ('00000000-0000-0000-0000-0000000000c1','TEST_CREATOR',1500)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO players (id, name, elo_score)
  VALUES ('00000000-0000-0000-0000-0000000000a1','TEST_A',1500)
  ON CONFLICT (id) DO NOTHING;
```
(Les `players.name` ont une contrainte d'unicité — utiliser des noms `TEST_*` distincts par script.)

---

## Phase 1 — Schéma & calcul de la date d'expiration

### Task 1: Colonne `invite_expires_at` + statut `expired` + trigger de calcul

**Files:**
- Create: `supabase/migrations/invite_expiry.sql`
- Test: `sql/tests/test_invite_expiry.sql`

- [ ] **Step 1: Écrire le test (échec attendu)**

`sql/tests/test_invite_expiry.sql` :
```sql
BEGIN;
INSERT INTO players (id, name, elo_score) VALUES
  ('00000000-0000-0000-0000-0000000000c1','TEST_INVEXP_CREATOR',1500) ON CONFLICT (id) DO NOTHING;
INSERT INTO players (id, name, elo_score) VALUES
  ('00000000-0000-0000-0000-0000000000a1','TEST_INVEXP_A',1500) ON CONFLICT (id) DO NOTHING;

-- Cas 1 : match lointain (dans 5 jours) → borne envoi+48h
INSERT INTO open_games (id, creator_id, match_date, status, spots_available, creator_side, location)
  VALUES ('00000000-0000-0000-0000-00000000f001','00000000-0000-0000-0000-0000000000c1',
          now() + interval '5 days','open',2,'A_GAU','TEST');
INSERT INTO game_participants (game_id, player_id, status, team_side)
  VALUES ('00000000-0000-0000-0000-00000000f001','00000000-0000-0000-0000-0000000000a1','invited','A_DRO');
DO $$
DECLARE v timestamptz;
BEGIN
  SELECT invite_expires_at INTO v FROM game_participants
   WHERE game_id='00000000-0000-0000-0000-00000000f001' AND player_id='00000000-0000-0000-0000-0000000000a1';
  IF v IS NULL THEN RAISE EXCEPTION 'cas1: invite_expires_at non calculé'; END IF;
  IF abs(extract(epoch FROM (v - (now() + interval '48 hours')))) > 5 THEN
    RAISE EXCEPTION 'cas1: attendu ~envoi+48h, obtenu %', v;
  END IF;
END $$;

-- Cas 2 : match dans 3h (match-6h passé) → plancher envoi+1h
INSERT INTO open_games (id, creator_id, match_date, status, spots_available, creator_side, location)
  VALUES ('00000000-0000-0000-0000-00000000f002','00000000-0000-0000-0000-0000000000c1',
          now() + interval '3 hours','open',2,'A_GAU','TEST');
INSERT INTO game_participants (game_id, player_id, status, team_side)
  VALUES ('00000000-0000-0000-0000-00000000f002','00000000-0000-0000-0000-0000000000a1','invited','A_DRO');
DO $$
DECLARE v timestamptz;
BEGIN
  SELECT invite_expires_at INTO v FROM game_participants
   WHERE game_id='00000000-0000-0000-0000-00000000f002' AND player_id='00000000-0000-0000-0000-0000000000a1';
  IF abs(extract(epoch FROM (v - (now() + interval '1 hour')))) > 5 THEN
    RAISE EXCEPTION 'cas2: attendu plancher ~envoi+1h, obtenu %', v;
  END IF;
END $$;

-- Cas 3 : match dans 45min (envoi+1h > match) → plafond = début du match
INSERT INTO open_games (id, creator_id, match_date, status, spots_available, creator_side, location)
  VALUES ('00000000-0000-0000-0000-00000000f003','00000000-0000-0000-0000-0000000000c1',
          now() + interval '45 minutes','open',2,'A_GAU','TEST');
INSERT INTO game_participants (game_id, player_id, status, team_side)
  VALUES ('00000000-0000-0000-0000-00000000f003','00000000-0000-0000-0000-0000000000a1','invited','A_DRO');
DO $$
DECLARE v timestamptz; m timestamptz;
BEGIN
  SELECT invite_expires_at INTO v FROM game_participants
   WHERE game_id='00000000-0000-0000-0000-00000000f003' AND player_id='00000000-0000-0000-0000-0000000000a1';
  SELECT match_date INTO m FROM open_games WHERE id='00000000-0000-0000-0000-00000000f003';
  IF abs(extract(epoch FROM (v - m))) > 5 THEN
    RAISE EXCEPTION 'cas3: attendu plafond=match, obtenu % (match %)', v, m;
  END IF;
END $$;

-- Cas 4 : le statut 'expired' est accepté par la contrainte
DO $$
BEGIN
  UPDATE game_participants SET status='expired'
   WHERE game_id='00000000-0000-0000-0000-00000000f001' AND player_id='00000000-0000-0000-0000-0000000000a1';
END $$;

RAISE NOTICE 'test_invite_expiry: OK';
ROLLBACK;
```

- [ ] **Step 2: Lancer le test → échec**

Run : coller `sql/tests/test_invite_expiry.sql` dans Supabase SQL Editor.
Expected : ÉCHEC — `cas1: invite_expires_at non calculé` (colonne/trigger absents), ou erreur de `CHECK` sur `'expired'`.

- [ ] **Step 3: Écrire la migration**

`supabase/migrations/invite_expiry.sql` :
```sql
-- ============================================================
-- Expiration des invitations à une partie.
-- Voir docs/superpowers/specs/2026-06-12-expiration-invitations-design.md
-- ============================================================

-- 1) Colonne (n'a de sens que pour les lignes status='invited')
ALTER TABLE public.game_participants
  ADD COLUMN IF NOT EXISTS invite_expires_at timestamptz;

-- 2) Statut terminal 'expired'
ALTER TABLE public.game_participants DROP CONSTRAINT IF EXISTS game_participants_status_check;
ALTER TABLE public.game_participants
  ADD CONSTRAINT game_participants_status_check
    CHECK (status IN ('pending','accepted','declined','waitlist','invited','expired'));

-- 3) Trigger de calcul de la date (constantes 48h / 6h / 1h ICI uniquement)
CREATE OR REPLACE FUNCTION public.set_invite_expiry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_match timestamptz;
  v_exp   timestamptz;
BEGIN
  IF NEW.status = 'invited' AND NEW.invite_expires_at IS NULL THEN
    SELECT match_date INTO v_match FROM public.open_games WHERE id = NEW.game_id;
    IF v_match IS NULL THEN
      v_exp := now() + interval '48 hours';
    ELSE
      v_exp := least(now() + interval '48 hours', v_match - interval '6 hours');
      v_exp := greatest(v_exp, now() + interval '1 hour');   -- plancher de grâce
      v_exp := least(v_exp, v_match);                        -- plafond = début du match
    END IF;
    NEW.invite_expires_at := v_exp;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_invite_expiry ON public.game_participants;
CREATE TRIGGER trg_set_invite_expiry
  BEFORE INSERT OR UPDATE ON public.game_participants
  FOR EACH ROW EXECUTE FUNCTION public.set_invite_expiry();

-- NB : expire_stale_invitations() + pg_cron sont ajoutés en Phase 3
--      (même fichier, plus bas).
```

- [ ] **Step 4: Appliquer la migration**

Run : coller le contenu de `invite_expiry.sql` dans Supabase SQL Editor → Run.
Expected : `Success. No rows returned`.

- [ ] **Step 5: Relancer le test → succès**

Run : coller `sql/tests/test_invite_expiry.sql`.
Expected : `NOTICE: test_invite_expiry: OK`, aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/invite_expiry.sql sql/tests/test_invite_expiry.sql
git commit -m "feat(invites): invite_expires_at column + status 'expired' + expiry trigger"
```

---

## Phase 2 — Promotion / libération partagée

### Task 2: `free_spot_and_promote(game_id)`

**Files:**
- Create: `supabase/migrations/free_spot_and_promote.sql`
- Test: `sql/tests/test_free_spot_and_promote.sql`

- [ ] **Step 1: Écrire le test (échec attendu)**

`sql/tests/test_free_spot_and_promote.sql` :
```sql
BEGIN;
INSERT INTO players (id, name, elo_score) VALUES
  ('00000000-0000-0000-0000-0000000000c2','TEST_FSP_CREATOR',1500) ON CONFLICT (id) DO NOTHING;
INSERT INTO players (id, name, elo_score) VALUES
  ('00000000-0000-0000-0000-0000000000w1','TEST_FSP_WAIT1',1500) ON CONFLICT (id) DO NOTHING;
INSERT INTO players (id, name, elo_score) VALUES
  ('00000000-0000-0000-0000-0000000000w2','TEST_FSP_WAIT2',1500) ON CONFLICT (id) DO NOTHING;

-- Partie complète avec 2 en liste d'attente (w1 avant w2)
INSERT INTO open_games (id, creator_id, match_date, status, spots_available, creator_side, location)
  VALUES ('00000000-0000-0000-0000-00000000f010','00000000-0000-0000-0000-0000000000c2',
          now() + interval '2 days','closed',0,'A_GAU','TEST');
INSERT INTO game_participants (game_id, player_id, status, team_side, created_at) VALUES
  ('00000000-0000-0000-0000-00000000f010','00000000-0000-0000-0000-0000000000w1','waitlist',NULL, now() - interval '2 min'),
  ('00000000-0000-0000-0000-00000000f010','00000000-0000-0000-0000-0000000000w2','waitlist',NULL, now() - interval '1 min');

-- Cas A : avec liste d'attente → promeut w1 (le plus ancien), pas w2
SELECT public.free_spot_and_promote('00000000-0000-0000-0000-00000000f010');
DO $$
DECLARE s1 text; s2 text; side1 text;
BEGIN
  SELECT status, team_side INTO s1, side1 FROM game_participants
   WHERE game_id='00000000-0000-0000-0000-00000000f010' AND player_id='00000000-0000-0000-0000-0000000000w1';
  SELECT status INTO s2 FROM game_participants
   WHERE game_id='00000000-0000-0000-0000-00000000f010' AND player_id='00000000-0000-0000-0000-0000000000w2';
  IF s1 <> 'accepted' THEN RAISE EXCEPTION 'A: w1 devait être promu, statut=%', s1; END IF;
  IF side1 IS NULL THEN RAISE EXCEPTION 'A: un côté libre devait être assigné à w1'; END IF;
  IF s2 <> 'waitlist' THEN RAISE EXCEPTION 'A: w2 ne devait PAS être promu, statut=%', s2; END IF;
END $$;

-- Cas B : sans liste d'attente → spots_available +1 et status='open'
INSERT INTO open_games (id, creator_id, match_date, status, spots_available, creator_side, location)
  VALUES ('00000000-0000-0000-0000-00000000f011','00000000-0000-0000-0000-0000000000c2',
          now() + interval '2 days','closed',0,'A_GAU','TEST');
SELECT public.free_spot_and_promote('00000000-0000-0000-0000-00000000f011');
DO $$
DECLARE sp int; st text;
BEGIN
  SELECT spots_available, status INTO sp, st FROM open_games WHERE id='00000000-0000-0000-0000-00000000f011';
  IF sp <> 1 THEN RAISE EXCEPTION 'B: spots_available devait passer à 1, obtenu %', sp; END IF;
  IF st <> 'open' THEN RAISE EXCEPTION 'B: status devait passer à open, obtenu %', st; END IF;
END $$;

RAISE NOTICE 'test_free_spot_and_promote: OK';
ROLLBACK;
```

- [ ] **Step 2: Lancer → échec** (`function free_spot_and_promote does not exist`).

- [ ] **Step 3: Écrire la migration**

`supabase/migrations/free_spot_and_promote.sql` :
```sql
-- ============================================================
-- Libération d'une place : promeut le 1er en liste d'attente,
-- sinon incrémente le compteur. Appelée par CHAQUE chemin de
-- libération (expiration cron, retrait manuel, départ d'un accepté).
-- La notif de promotion part d'un Database Webhook sur l'UPDATE
-- waitlist→accepted (edge function notify-promotion). Cette fonction
-- ne fait QUE des transitions SQL.
-- ============================================================
CREATE OR REPLACE FUNCTION public.free_spot_and_promote(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator_side text;
  v_next_id   uuid;
  v_taken     text[];
  v_side      text;
BEGIN
  SELECT creator_side INTO v_creator_side FROM open_games WHERE id = p_game_id;

  SELECT id INTO v_next_id
  FROM game_participants
  WHERE game_id = p_game_id AND status = 'waitlist'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_next_id IS NOT NULL THEN
    SELECT array_agg(team_side) INTO v_taken
      FROM game_participants
      WHERE game_id = p_game_id AND status = 'accepted' AND team_side IS NOT NULL;
    v_taken := coalesce(v_taken, '{}'::text[]) || coalesce(v_creator_side, 'A_GAU','TEST');

    SELECT s INTO v_side
      FROM unnest(ARRAY['A_GAU','A_DRO','B_GAU','B_DRO']) AS s
      WHERE s <> ALL (v_taken)
      LIMIT 1;

    UPDATE game_participants
      SET status = 'accepted',
          team_side = coalesce(v_side, team_side)
      WHERE id = v_next_id;
  ELSE
    UPDATE open_games
      SET spots_available = least(3, coalesce(spots_available, 0) + 1),
          status = 'open'
      WHERE id = p_game_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.free_spot_and_promote(uuid) TO authenticated, service_role;
```

- [ ] **Step 4: Appliquer** (SQL Editor → Run → `Success`).

- [ ] **Step 5: Relancer le test → `NOTICE: test_free_spot_and_promote: OK`.**

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/free_spot_and_promote.sql sql/tests/test_free_spot_and_promote.sql
git commit -m "feat(invites): shared free_spot_and_promote() (waitlist promotion / counter bump)"
```

---

## Phase 3 — Cron d'expiration

### Task 3: `expire_stale_invitations()` + planif pg_cron

**Files:**
- Modify: `supabase/migrations/invite_expiry.sql` (ajout en bas)
- Test: `sql/tests/test_expire_stale_invitations.sql`

- [ ] **Step 1: Écrire le test (échec attendu)**

`sql/tests/test_expire_stale_invitations.sql` :
```sql
BEGIN;
INSERT INTO players (id, name, elo_score) VALUES
  ('00000000-0000-0000-0000-0000000000c3','TEST_EXP_CREATOR',1500) ON CONFLICT (id) DO NOTHING;
INSERT INTO players (id, name, elo_score) VALUES
  ('00000000-0000-0000-0000-0000000000a3','TEST_EXP_A',1500) ON CONFLICT (id) DO NOTHING;

INSERT INTO open_games (id, creator_id, match_date, status, spots_available, creator_side, is_challenge, location)
  VALUES ('00000000-0000-0000-0000-00000000f020','00000000-0000-0000-0000-0000000000c3',
          now() + interval '2 days','open',2,'A_GAU', true,'TEST');

-- Invitation déjà expirée (on force invite_expires_at dans le passé en contournant le trigger)
INSERT INTO game_participants (game_id, player_id, status, team_side, invite_expires_at)
  VALUES ('00000000-0000-0000-0000-00000000f020','00000000-0000-0000-0000-0000000000a3','invited','A_DRO', now() - interval '1 min');

-- Défi lié pending
INSERT INTO challenges (challenger_id, challenged_id, game_id, status)
  VALUES ('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000a3',
          '00000000-0000-0000-0000-00000000f020','pending');

SELECT public.expire_stale_invitations();

DO $$
DECLARE st text; ch text; sp int;
BEGIN
  SELECT status INTO st FROM game_participants
   WHERE game_id='00000000-0000-0000-0000-00000000f020' AND player_id='00000000-0000-0000-0000-0000000000a3';
  IF st <> 'expired' THEN RAISE EXCEPTION 'invitation devait être expired, statut=%', st; END IF;

  SELECT status INTO ch FROM challenges
   WHERE game_id='00000000-0000-0000-0000-00000000f020' AND challenged_id='00000000-0000-0000-0000-0000000000a3';
  IF ch <> 'expired' THEN RAISE EXCEPTION 'défi lié devait être expired, statut=%', ch; END IF;

  SELECT spots_available INTO sp FROM open_games WHERE id='00000000-0000-0000-0000-00000000f020';
  IF sp <> 3 THEN RAISE EXCEPTION 'place devait être rouverte (spots 2->3), obtenu %', sp; END IF;
END $$;

-- Idempotence : un 2e passage ne retouche rien
DO $$
DECLARE n int;
BEGIN
  SELECT public.expire_stale_invitations() INTO n;
  IF n <> 0 THEN RAISE EXCEPTION 'idempotence cassée : % lignes retraitées', n; END IF;
END $$;

RAISE NOTICE 'test_expire_stale_invitations: OK';
ROLLBACK;
```

- [ ] **Step 2: Lancer → échec** (`function expire_stale_invitations does not exist`).

- [ ] **Step 3: Compléter la migration** (ajouter à la fin de `supabase/migrations/invite_expiry.sql`) :

```sql
-- ============================================================
-- Cron : matérialise l'expiration des invitations échues.
-- Effets : status invited→expired, défi lié pending→expired,
-- libération de place (free_spot_and_promote). Le push à l'invité
-- part d'un Database Webhook sur l'UPDATE invited→expired
-- (edge function notify-invite-expired).
-- ============================================================
CREATE OR REPLACE FUNCTION public.expire_stale_invitations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT id, game_id, player_id
    FROM game_participants
    WHERE status = 'invited' AND invite_expires_at < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE game_participants SET status = 'expired' WHERE id = r.id;

    UPDATE challenges SET status = 'expired'
      WHERE game_id = r.game_id AND challenged_id = r.player_id AND status = 'pending';

    PERFORM public.free_spot_and_promote(r.game_id);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_invitations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_stale_invitations() TO service_role;

-- Planification toutes les 10 min (nécessite l'extension pg_cron, déjà
-- utilisée par cleanup_unconfirmed_accounts.sql).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'expire-stale-invitations',
      '*/10 * * * *',
      $cron$ SELECT public.expire_stale_invitations(); $cron$
    );
  ELSE
    RAISE NOTICE 'pg_cron non activé : active l''extension puis ré-exécute ce bloc DO.';
  END IF;
END $$;
```

- [ ] **Step 4: Appliquer** (coller la partie ajoutée → Run → `Success`).

- [ ] **Step 5: Relancer le test → `NOTICE: test_expire_stale_invitations: OK`.**

- [ ] **Step 6: Vérifier la planif**

Run : `SELECT jobname, schedule FROM cron.job WHERE jobname = 'expire-stale-invitations';`
Expected : 1 ligne, `*/10 * * * *`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/invite_expiry.sql sql/tests/test_expire_stale_invitations.sql
git commit -m "feat(invites): expire_stale_invitations() cron (status, linked challenge, free spot)"
```

---

## Phase 4 — Candidature atomique

### Task 4: RPC `join_game()`

**Files:**
- Create: `supabase/migrations/join_game_rpc.sql`
- Test: `sql/tests/test_join_game.sql`

- [ ] **Step 1: Écrire le test (échec attendu)**

`sql/tests/test_join_game.sql` :
```sql
BEGIN;
-- current_player_id() = SELECT id FROM players WHERE user_id = auth.uid()::text.
-- On impersonne via SET LOCAL "request.jwt.claims" (→ auth.uid() = sub), donc le
-- joueur appelant DOIT avoir user_id = ce sub. On pose user_id = id (chaîne uuid).
INSERT INTO players (id, name, elo_score, user_id) VALUES
  ('00000000-0000-0000-0000-0000000000c4','TEST_JOIN_CREATOR',1500,'00000000-0000-0000-0000-0000000000c4') ON CONFLICT (id) DO NOTHING;
INSERT INTO players (id, name, elo_score, user_id) VALUES
  ('00000000-0000-0000-0000-0000000000a4','TEST_JOIN_FIT',1500,'00000000-0000-0000-0000-0000000000a4') ON CONFLICT (id) DO NOTHING;
INSERT INTO players (id, name, elo_score, user_id) VALUES
  ('00000000-0000-0000-0000-0000000000b4','TEST_JOIN_UNFIT',900,'00000000-0000-0000-0000-0000000000b4') ON CONFLICT (id) DO NOTHING;

-- Fillers (occupants, jamais appelants → pas besoin de user_id)
INSERT INTO players (id, name, elo_score) VALUES
  ('00000000-0000-0000-0000-0000000000p1','TEST_JOIN_P1',1500),
  ('00000000-0000-0000-0000-0000000000p2','TEST_JOIN_P2',1500),
  ('00000000-0000-0000-0000-0000000000p3','TEST_JOIN_P3',1500) ON CONFLICT (id) DO NOTHING;

-- CAS 1 — place libre + appelant UNFIT → 'pending'.
-- Partie : créateur + p1 invité NON expiré (occupe), free = 4-1-1 = 2.
INSERT INTO open_games (id, creator_id, match_date, status, spots_available, creator_side, min_elo, max_elo, location)
  VALUES ('00000000-0000-0000-0000-00000000f030','00000000-0000-0000-0000-0000000000c4',
          now() + interval '2 days','open',2,'A_GAU', 1200, 1800,'TEST');
INSERT INTO game_participants (game_id, player_id, status, team_side, invite_expires_at)
  VALUES ('00000000-0000-0000-0000-00000000f030','00000000-0000-0000-0000-0000000000p1','invited','A_DRO', now() + interval '1 day');
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000b4"}';
DO $$
DECLARE st text;
BEGIN
  SELECT public.join_game('00000000-0000-0000-0000-00000000f030', 'B_GAU', false) INTO st;
  IF st <> 'pending' THEN RAISE EXCEPTION 'cas1 unfit+place → attendu pending, obtenu %', st; END IF;
END $$;

-- CAS 2 — partie PLEINE d'invités EXPIRÉS + appelant FIT → 'accepted'.
-- Si les expirés comptaient (occupied=3 → free=0) on aurait waitlist : ce cas DISCRIMINE.
INSERT INTO open_games (id, creator_id, match_date, status, spots_available, creator_side, min_elo, max_elo, location)
  VALUES ('00000000-0000-0000-0000-00000000f031','00000000-0000-0000-0000-0000000000c4',
          now() + interval '2 days','open',0,'A_GAU', 1200, 1800,'TEST');
INSERT INTO game_participants (game_id, player_id, status, team_side, invite_expires_at) VALUES
  ('00000000-0000-0000-0000-00000000f031','00000000-0000-0000-0000-0000000000p1','invited','A_DRO', now() - interval '1 min'),
  ('00000000-0000-0000-0000-00000000f031','00000000-0000-0000-0000-0000000000p2','invited','B_GAU', now() - interval '1 min'),
  ('00000000-0000-0000-0000-00000000f031','00000000-0000-0000-0000-0000000000p3','invited','B_DRO', now() - interval '1 min');
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a4"}';
DO $$
DECLARE st text; sp int;
BEGIN
  SELECT public.join_game('00000000-0000-0000-0000-00000000f031', NULL, false) INTO st;
  IF st <> 'accepted' THEN RAISE EXCEPTION 'cas2 invités expirés exclus → attendu accepted, obtenu %', st; END IF;
  SELECT spots_available INTO sp FROM open_games WHERE id='00000000-0000-0000-0000-00000000f031';
  IF sp <> 0 THEN RAISE EXCEPTION 'cas2 spots_available devait être décrémenté (cache), obtenu %', sp; END IF;
END $$;

-- CAS 3 — partie PLEINE de joueurs VIVANTS (accepted) + appelant FIT → 'waitlist'.
INSERT INTO open_games (id, creator_id, match_date, status, spots_available, creator_side, min_elo, max_elo, location)
  VALUES ('00000000-0000-0000-0000-00000000f032','00000000-0000-0000-0000-0000000000c4',
          now() + interval '2 days','open',0,'A_GAU', 1200, 1800,'TEST');
INSERT INTO game_participants (game_id, player_id, status, team_side) VALUES
  ('00000000-0000-0000-0000-00000000f032','00000000-0000-0000-0000-0000000000p1','accepted','A_DRO'),
  ('00000000-0000-0000-0000-00000000f032','00000000-0000-0000-0000-0000000000p2','accepted','B_GAU'),
  ('00000000-0000-0000-0000-00000000f032','00000000-0000-0000-0000-0000000000p3','accepted','B_DRO');
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a4"}';
DO $$
DECLARE st text;
BEGIN
  SELECT public.join_game('00000000-0000-0000-0000-00000000f032', NULL, false) INTO st;
  IF st <> 'waitlist' THEN RAISE EXCEPTION 'cas3 partie pleine vivante → attendu waitlist, obtenu %', st; END IF;
END $$;

RAISE NOTICE 'test_join_game: OK';
ROLLBACK;
```

- [ ] **Step 2: Lancer → échec** (`function join_game does not exist`).

- [ ] **Step 3: Écrire la migration**

`supabase/migrations/join_game_rpc.sql` :
```sql
-- ============================================================
-- Candidature atomique. Gate sur l'OCCUPATION VIVANTE
-- (créateur + accepted + invited NON expiré), pas sur le compteur
-- stocké. SELECT ... FOR UPDATE sérialise les candidatures
-- concurrentes (pas de surbooking). Renvoie le statut attribué ;
-- le client envoie ensuite la notif adéquate (confirmé / demande).
-- Règle ELO identique à getEloFit (lobby.tsx) : fit = elo ∈ [min,max].
-- ============================================================
CREATE OR REPLACE FUNCTION public.join_game(
  p_game_id uuid,
  p_side text DEFAULT NULL,
  p_join_waitlist boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me        uuid := public.current_player_id();
  v_elo       numeric;
  v_min       int;
  v_max       int;
  v_occupied  int;
  v_free      int;
  v_fit       boolean;
  v_status    text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT min_elo, max_elo INTO v_min, v_max
    FROM open_games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'game not found'; END IF;

  SELECT elo_score INTO v_elo FROM players WHERE id = v_me;

  SELECT count(*) INTO v_occupied
    FROM game_participants
    WHERE game_id = p_game_id
      AND (status = 'accepted'
           OR (status = 'invited'
               AND (invite_expires_at IS NULL OR invite_expires_at > now())));

  v_free := 4 - 1 - v_occupied;   -- 4 joueurs - le créateur - occupants vivants

  v_fit := (v_elo >= coalesce(v_min, 0)) AND (v_elo <= coalesce(v_max, 9999));

  IF p_join_waitlist OR v_free <= 0 THEN
    v_status := 'waitlist';
  ELSIF v_fit THEN
    v_status := 'accepted';
  ELSE
    v_status := 'pending';
  END IF;

  -- Réinscription : efface une éventuelle ligne terminale (declined/expired)
  -- pour ce joueur, puis insère (UNIQUE game_id,player_id).
  DELETE FROM game_participants
    WHERE game_id = p_game_id AND player_id = v_me AND status IN ('declined','expired');

  INSERT INTO game_participants (game_id, player_id, status, team_side)
    VALUES (p_game_id, v_me, v_status, p_side);

  IF v_status = 'accepted' THEN
    UPDATE open_games
      SET spots_available = greatest(0, coalesce(spots_available, 1) - 1)
      WHERE id = p_game_id;
  END IF;

  RETURN v_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_game(uuid, text, boolean) TO authenticated;
```

> Le trigger anti-chevauchement créateur (`eject_creator_overlaps`) reste actif sur l'INSERT : si l'appelant a un match équivalent à ±4h, l'INSERT lèvera son exception — `join_game()` la propage, le client la mappe comme aujourd'hui (`isCreatorConflict`).

- [ ] **Step 4: Appliquer** (Run → `Success`).

- [ ] **Step 5: Relancer le test → `NOTICE: test_join_game: OK`.**

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/join_game_rpc.sql sql/tests/test_join_game.sql
git commit -m "feat(invites): atomic join_game() RPC gating on live occupancy"
```

---

## Phase 5 — Retrait manuel

### Task 5: RPC `withdraw_invitation()`

**Files:**
- Create: `supabase/migrations/withdraw_invitation_rpc.sql`
- Test: `sql/tests/test_withdraw_invitation.sql`

- [ ] **Step 1: Écrire le test (échec attendu)**

`sql/tests/test_withdraw_invitation.sql` :
```sql
BEGIN;
-- Callers (c5 créateur, x5 intrus) impersonnés via request.jwt.claims → user_id = id requis.
INSERT INTO players (id, name, elo_score, user_id) VALUES
  ('00000000-0000-0000-0000-0000000000c5','TEST_WDR_CREATOR',1500,'00000000-0000-0000-0000-0000000000c5') ON CONFLICT (id) DO NOTHING;
INSERT INTO players (id, name, elo_score) VALUES
  ('00000000-0000-0000-0000-0000000000a5','TEST_WDR_A',1500) ON CONFLICT (id) DO NOTHING;
INSERT INTO players (id, name, elo_score, user_id) VALUES
  ('00000000-0000-0000-0000-0000000000x5','TEST_WDR_INTRUDER',1500,'00000000-0000-0000-0000-0000000000x5') ON CONFLICT (id) DO NOTHING;

INSERT INTO open_games (id, creator_id, match_date, status, spots_available, creator_side, is_challenge, location)
  VALUES ('00000000-0000-0000-0000-00000000f040','00000000-0000-0000-0000-0000000000c5',
          now() + interval '2 days','open',1,'A_GAU', true,'TEST');
INSERT INTO game_participants (game_id, player_id, status, team_side, invite_expires_at)
  VALUES ('00000000-0000-0000-0000-00000000f040','00000000-0000-0000-0000-0000000000a5','invited','A_DRO', now() + interval '1 day');
INSERT INTO challenges (challenger_id, challenged_id, game_id, status)
  VALUES ('00000000-0000-0000-0000-0000000000c5','00000000-0000-0000-0000-0000000000a5',
          '00000000-0000-0000-0000-00000000f040','pending');

-- Cas refus : un non-créateur ne peut pas retirer
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000x5"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.withdraw_invitation('00000000-0000-0000-0000-00000000f040','00000000-0000-0000-0000-0000000000a5');
    RAISE EXCEPTION 'un non-créateur a pu retirer (devait échouer)';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'un non-créateur a pu retirer (devait échouer)' THEN RAISE; END IF;
    -- sinon : rejet attendu, OK
  END;
END $$;

-- Cas nominal : le créateur retire → ligne supprimée, défi declined, place rouverte
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000c5"}';
SELECT public.withdraw_invitation('00000000-0000-0000-0000-00000000f040','00000000-0000-0000-0000-0000000000a5');
DO $$
DECLARE cnt int; ch text; sp int;
BEGIN
  SELECT count(*) INTO cnt FROM game_participants
   WHERE game_id='00000000-0000-0000-0000-00000000f040' AND player_id='00000000-0000-0000-0000-0000000000a5';
  IF cnt <> 0 THEN RAISE EXCEPTION 'la ligne invited devait être supprimée'; END IF;
  SELECT status INTO ch FROM challenges
   WHERE game_id='00000000-0000-0000-0000-00000000f040' AND challenged_id='00000000-0000-0000-0000-0000000000a5';
  IF ch <> 'declined' THEN RAISE EXCEPTION 'défi lié devait être declined, statut=%', ch; END IF;
  SELECT spots_available INTO sp FROM open_games WHERE id='00000000-0000-0000-0000-00000000f040';
  IF sp <> 2 THEN RAISE EXCEPTION 'place devait rouvrir (1->2), obtenu %', sp; END IF;
END $$;

RAISE NOTICE 'test_withdraw_invitation: OK';
ROLLBACK;
```

- [ ] **Step 2: Lancer → échec** (`function withdraw_invitation does not exist`).

- [ ] **Step 3: Écrire la migration**

`supabase/migrations/withdraw_invitation_rpc.sql` :
```sql
-- ============================================================
-- Retrait manuel d'une invitation par le CRÉATEUR. Silencieux
-- (pas de notif). Vérifie l'ownership (la RLS participants_write
-- est trop permissive → on ne s'appuie pas dessus). Supprime la
-- ligne 'invited', répercute le défi lié (declined), rouvre la place.
-- ============================================================
CREATE OR REPLACE FUNCTION public.withdraw_invitation(
  p_game_id uuid,
  p_player_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := public.current_player_id();
  v_creator uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT creator_id INTO v_creator FROM open_games WHERE id = p_game_id;
  IF v_creator IS NULL THEN RAISE EXCEPTION 'game not found'; END IF;
  IF v_creator <> v_me THEN RAISE EXCEPTION 'only the creator can withdraw an invitation'; END IF;

  DELETE FROM game_participants
    WHERE game_id = p_game_id AND player_id = p_player_id AND status = 'invited';

  UPDATE challenges SET status = 'declined'
    WHERE game_id = p_game_id AND challenged_id = p_player_id AND status = 'pending';

  PERFORM public.free_spot_and_promote(p_game_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.withdraw_invitation(uuid, uuid) TO authenticated;
```

- [ ] **Step 4: Appliquer** (Run → `Success`).

- [ ] **Step 5: Relancer le test → `NOTICE: test_withdraw_invitation: OK`.**

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/withdraw_invitation_rpc.sql sql/tests/test_withdraw_invitation.sql
git commit -m "feat(invites): withdraw_invitation() RPC (creator-only, silent, frees spot)"
```

---

## Phase 6 — Notifications serveur (webhooks + edge functions)

### Task 6: Edge function `notify-invite-expired`

**Files:**
- Create: `supabase/functions/notify-invite-expired/index.ts`

- [ ] **Step 1: Écrire l'edge function** (calquée sur `notify-eject`)

`supabase/functions/notify-invite-expired/index.ts` :
```ts
// Database Webhook handler : notifie l'invité dont l'invitation vient
// de passer invited→expired (cron expire_stale_invitations).
// Webhook configuré sur game_participants — events: UPDATE.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface DbWebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  record: { game_id: string; player_id: string; status: string } | null;
  old_record: { status: string } | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' },
    });
  }
  try {
    const { type, record, old_record } = (await req.json()) as DbWebhookPayload;
    if (type !== 'UPDATE' || !record) return new Response('skip');
    // On ne notifie QUE la transition invited→expired
    if (record.status !== 'expired' || old_record?.status !== 'invited') return new Response('skip');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
      body: JSON.stringify({
        playerIds: [record.player_id],
        title: '⌛ Invitation expirée',
        body: "Tu n'as pas répondu à temps — la partie s'est faite sans toi.",
        data: { type: 'lobby', gameId: record.game_id },
      }),
    });
    return new Response(JSON.stringify({ ok: res.ok }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
```

- [ ] **Step 2: Déployer**

Run : `npx supabase functions deploy notify-invite-expired --project-ref icshhobxeppttgayxmba`
Expected : `Deployed Function notify-invite-expired`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/notify-invite-expired/index.ts
git commit -m "feat(invites): notify-invite-expired edge function (invited->expired push)"
```

### Task 7: Edge function `notify-promotion`

**Files:**
- Create: `supabase/functions/notify-promotion/index.ts`

- [ ] **Step 1: Écrire l'edge function**

`supabase/functions/notify-promotion/index.ts` :
```ts
// Database Webhook handler : notifie le joueur promu de la liste
// d'attente (waitlist→accepted via free_spot_and_promote).
// Webhook sur game_participants — events: UPDATE.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface DbWebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  record: { game_id: string; player_id: string; status: string } | null;
  old_record: { status: string } | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' },
    });
  }
  try {
    const { type, record, old_record } = (await req.json()) as DbWebhookPayload;
    if (type !== 'UPDATE' || !record) return new Response('skip');
    if (record.status !== 'accepted' || old_record?.status !== 'waitlist') return new Response('skip');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
      body: JSON.stringify({
        playerIds: [record.player_id],
        title: '🎉 Place libérée — tu es accepté !',
        body: "Tu passes de la liste d'attente à confirmé !",
        data: { type: 'lobby', gameId: record.game_id },
      }),
    });
    return new Response(JSON.stringify({ ok: res.ok }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
```

- [ ] **Step 2: Déployer**

Run : `npx supabase functions deploy notify-promotion --project-ref icshhobxeppttgayxmba`
Expected : `Deployed Function notify-promotion`.

- [ ] **Step 3: Configurer les 2 Database Webhooks (dashboard)**

Supabase → Database → Webhooks → Create :
1. **invite-expired** : table `game_participants`, events `UPDATE`, type HTTP Request → `POST {project}/functions/v1/notify-invite-expired`, header `Authorization: Bearer <SERVICE_ROLE_KEY>`.
2. **promotion** : table `game_participants`, events `UPDATE`, type HTTP Request → `POST {project}/functions/v1/notify-promotion`, même header.

Documenter dans `docs/DEPLOIEMENT_MAROC.md` (checklist déploiement).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/notify-promotion/index.ts docs/DEPLOIEMENT_MAROC.md
git commit -m "feat(invites): notify-promotion edge function + webhooks deploy checklist"
```

---

## Phase 7 — Câblage client

### Task 8: Helpers `lib/games.ts` + filtre lazy partagé

**Files:**
- Create: `lib/games.ts`

- [ ] **Step 1: Écrire les helpers**

`lib/games.ts` :
```ts
import { supabase } from './supabase';

/** Vrai uniquement pour une invitation (status='invited') non expirée. */
export function isInviteActive(p: { status: string; invite_expires_at?: string | null }): boolean {
  if (p.status !== 'invited') return false;
  if (!p.invite_expires_at) return true;
  return new Date(p.invite_expires_at).getTime() > Date.now();
}

/** Occupant vivant d'une place = accepté, ou invité non expiré. */
export function occupiesSpot(p: { status: string; invite_expires_at?: string | null }): boolean {
  return p.status === 'accepted' || isInviteActive(p);
}

export async function joinGame(gameId: string, side?: string, joinWaitlist = false): Promise<string> {
  const { data, error } = await supabase.rpc('join_game', {
    p_game_id: gameId, p_side: side ?? null, p_join_waitlist: joinWaitlist,
  });
  if (error) throw error;
  return data as string; // 'accepted' | 'pending' | 'waitlist'
}

export async function withdrawInvitation(gameId: string, playerId: string): Promise<void> {
  const { error } = await supabase.rpc('withdraw_invitation', { p_game_id: gameId, p_player_id: playerId });
  if (error) throw error;
}
```

- [ ] **Step 2: Vérifier le typecheck**

Run : `npx tsc --noEmit`
Expected : aucune nouvelle erreur (import `./supabase` existant).

- [ ] **Step 3: Commit**

```bash
git add lib/games.ts
git commit -m "feat(invites): lib/games.ts helpers (isInviteActive, joinGame, withdrawInvitation)"
```

### Task 9: `freeSpots()` + `GAME_SELECT` ignorent les invités expirés

**Files:**
- Modify: `app/(tabs)/lobby.tsx` (`freeSpots` ~57-63 ; `GAME_SELECT` participants embed)

- [ ] **Step 1: Inclure `invite_expires_at` dans le select participants**

Dans `GAME_SELECT` (et tout embed `participants:game_participants(...)` du fichier), ajouter `invite_expires_at` à la liste des colonnes ramenées. Exemple :
```ts
// avant : participants:game_participants(player_id, status, team_side, approvals, ...)
// après : participants:game_participants(player_id, status, team_side, approvals, invite_expires_at, ...)
```
Faire de même dans `useNotificationCount.tsx:125` et `matchmaking.tsx:482` si ces embeds servent à calculer une occupation.

- [ ] **Step 2: Mettre à jour `freeSpots()`**

Remplacer [lobby.tsx:57-63](../../app/(tabs)/lobby.tsx#L57-L63) :
```ts
import { occupiesSpot } from '../../lib/games';

function freeSpots(game: OpenGame): number {
  if (!game.participants) return game.spots_available ?? 0;
  const occupied = 1 + game.participants.filter(
    (p: any) => occupiesSpot(p) && p.player_id !== game.creator_id,
  ).length;
  return Math.max(0, 4 - occupied);
}
```

- [ ] **Step 3: Typecheck**

Run : `npx tsc --noEmit`
Expected : aucune nouvelle erreur.

- [ ] **Step 4: Commit**

```bash
git add app/(tabs)/lobby.tsx app/(tabs)/GameDetailsSheet.tsx hooks/useNotificationCount.tsx app/(tabs)/matchmaking.tsx
git commit -m "feat(invites): occupancy ignores expired invitations (freeSpots + selects)"
```

### Task 10: `handleApply` → `join_game()`

**Files:**
- Modify: `app/(tabs)/lobby.tsx:1849-1919`

- [ ] **Step 1: Remplacer l'insert client par la RPC**

Dans `handleApply`, remplacer le bloc insert + décision de statut ([lobby.tsx:1852-1874](../../app/(tabs)/lobby.tsx#L1852-L1874)) par :
```ts
let newStatus: string;
try {
  newStatus = await joinGame(gameId, teamSide, joinWaitlist);
} catch (error: any) {
  if (isCreatorConflict(error)) {
    Alert.alert('Créneau déjà occupé',
      "Tu es l'organisateur·trice d'un match sur un créneau équivalent ou rapproché (~2h). Annule-le ou transfère-en l'organisation avant de créer ou rejoindre une partie.");
  } else {
    Alert.alert('Erreur', error.message ?? 'Candidature échouée');
  }
  throw error;
}
```
Ajouter l'import : `import { joinGame } from '../../lib/games';`. **Garder tel quel** tout le bloc suivant (notifs `notifyPlayers` confirmé/pending/waitlist + Alerts + `setOpenGameId(null)` + `fetchData()`) : il s'appuie sur `newStatus` renvoyé par la RPC. Supprimer le `update spots_available` client désormais fait dans la RPC ([lobby.tsx:1876-1879](../../app/(tabs)/lobby.tsx#L1876-L1879)).

- [ ] **Step 2: Typecheck**

Run : `npx tsc --noEmit`
Expected : aucune nouvelle erreur.

- [ ] **Step 3: Commit**

```bash
git add app/(tabs)/lobby.tsx
git commit -m "feat(invites): handleApply uses atomic join_game() RPC"
```

### Task 11: `handleLeaveGame` (départ d'un accepté) → `free_spot_and_promote()`

**Files:**
- Modify: `app/(tabs)/lobby.tsx:2168-2222`

- [ ] **Step 1: Remplacer la promotion client par la RPC**

Dans `handleLeaveGame`, après le `delete` du partant ([lobby.tsx:2168](../../app/(tabs)/lobby.tsx#L2168)), remplacer tout le bloc « Promote first waitlisted player » + le `else` qui bumpe `spots_available` ([lobby.tsx:2189-2222](../../app/(tabs)/lobby.tsx#L2189-L2222)) par :
```ts
if (wasAccepted) {
  await supabase.rpc('free_spot_and_promote', { p_game_id: gameId });
}
```
La notif de promotion part désormais du webhook `notify-promotion` (plus de `notifyPlayers` ici). Conserver le nettoyage des `approvals` ([lobby.tsx:2170-2187](../../app/(tabs)/lobby.tsx#L2170-L2187)).

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` → aucune nouvelle erreur.

- [ ] **Step 3: Commit**

```bash
git add app/(tabs)/lobby.tsx
git commit -m "refactor(invites): handleLeaveGame delegates to free_spot_and_promote() (dedup + dérive)"
```

### Task 12: Bouton « Retirer » + filtre lazy dans `GameDetailsSheet`

**Files:**
- Modify: `app/(tabs)/GameDetailsSheet.tsx`

- [ ] **Step 1: Masquer les invités expirés**

Là où `invitedPlayers` est calculé ([GameDetailsSheet.tsx:290](../../app/(tabs)/GameDetailsSheet.tsx#L290)) et dans le filtre des présents ([GameDetailsSheet.tsx:76](../../app/(tabs)/GameDetailsSheet.tsx#L76)), n'inclure que les invitations actives :
```ts
import { isInviteActive } from '../../lib/games';
// présents :
.filter((p: any) => p.status === 'accepted' || (p.status === 'invited' && isInviteActive(p)))
// invitedPlayers :
const invitedPlayers = (game.participants ?? []).filter((p: any) => p.status === 'invited' && isInviteActive(p));
```

- [ ] **Step 2: Ajouter le bouton « Retirer » (vue créateur)**

Dans le rendu de chaque invité de `invitedPlayers`, quand `isCreator`, ajouter une action :
```tsx
import { withdrawInvitation } from '../../lib/games';

const onWithdraw = (playerId: string, name: string) => {
  Alert.alert("Retirer l'invitation ?", `${name} ne pourra plus rejoindre via cette invitation.`, [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Retirer', style: 'destructive', onPress: async () => {
        try { await withdrawInvitation(game.id, playerId); onChanged?.(); }
        catch (e: any) { Alert.alert('Erreur', e.message ?? 'Retrait échoué'); }
    } },
  ]);
};
```
Rendre un `TouchableOpacity` « ✕ Retirer » à côté du nom de l'invité (réutiliser le style des boutons secondaires du fichier). `onChanged` = le callback de refresh déjà passé à la sheet (sinon `fetchData`).

- [ ] **Step 3: Compte à rebours sur la carte invité** (nice-to-have, même fichier)

Sous le nom de l'invité, afficher le temps restant :
```tsx
function inviteCountdown(p: { invite_expires_at?: string | null }): string | null {
  if (!p.invite_expires_at) return null;
  const ms = new Date(p.invite_expires_at).getTime() - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  return h >= 1 ? `expire dans ${h} h` : `expire dans ${Math.max(1, Math.floor(ms / 60_000))} min`;
}
```
Rendre `inviteCountdown(p)` en petit texte secondaire s'il est non-null.

- [ ] **Step 4: Typecheck** — `npx tsc --noEmit` → aucune nouvelle erreur.

- [ ] **Step 5: Commit**

```bash
git add app/(tabs)/GameDetailsSheet.tsx
git commit -m "feat(invites): creator 'Retirer' action + lazy filter + invite countdown"
```

---

## Phase 8 — Vérification end-to-end

### Task 13: Tests SQL globaux + typecheck final

- [ ] **Step 1: Rejouer les 5 tests SQL** (SQL Editor) — tous doivent finir `NOTICE: … OK`, aucune erreur.
- [ ] **Step 2: `npx tsc --noEmit`** → 0 erreur.
- [ ] **Step 3: Commit éventuel des ajustements.**

### Task 14: Vérification sur 2 appareils (cf. mémoire `project_push_notifications`)

Manuel, hors CI. Cocher après observation réelle :
- [ ] **Expiration auto** : inviter un joueur (device B) ; forcer `invite_expires_at` à `now()` en SQL puis `SELECT expire_stale_invitations();` ; vérifier sur device A que la place rouvre, et que device B reçoit « ⌛ Invitation expirée ».
- [ ] **Retrait manuel** : depuis device A (créateur), « Retirer » l'invitation de device B → la place rouvre, **aucune notif** côté B, l'invitation disparaît de son « À venir ».
- [ ] **Promotion** : partie pleine + 1 waitlister (device B) ; un accepté quitte → device B reçoit « 🎉 Place libérée » et passe accepté.
- [ ] **Candidature concurrente** : 2 devices postulent en même temps sur la dernière place → un seul `accepted`, l'autre `waitlist` (pas de surbooking).
- [ ] **Défi** : invitation issue d'un Défi expirée/retirée → l'onglet Matchmaking du défié ne montre plus le défi `pending`.

---

## Notes d'exécution

- **Drift assumé** : ces migrations ne sont pas timestampées (convention du repo) et sont appliquées **à la main** dans le SQL Editor. Garder l'ordre : Phase 1 → 2 → 3 → 4 → 5 (la 3 dépend de la 2 ; la 5 dépend de la 2).
- **RLS** : `join_game`/`withdraw_invitation`/`free_spot_and_promote` sont `SECURITY DEFINER` → elles passent outre la RLS, d'où les vérifs d'ownership explicites dans `withdraw_invitation`.
- **`match_date` figée** : si un flux d'édition de partie est ajouté plus tard, prévoir un trigger sur `open_games` pour recalculer `invite_expires_at`. Hors scope.
- **Promotion — critère à revisiter** (note design) : `free_spot_and_promote` réutilise le critère existant (premier arrivé par `created_at`). Tout raffinement futur (ELO, équité) se fera dans cette seule fonction.
```
