# Refonte Défi 2v2 — Phase 1 : Fondation données + ELO — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poser la fondation backend du défi 2v2 — mise ELO (×1.5→×3) et candidature-binôme atomique — sans toucher encore à l'UI.

**Architecture:** Un défi reste une `open_games` marquée `is_challenge` (existant). On ajoute une colonne `stake_multiplier` (sur `open_games` ET `matches`), un multiplicateur de mise dans le trigger ELO `fn_distribute_elo_on_validate` (+ miroir `lib/elo.ts`), une table `defi_applications` (candidature-binôme) et deux RPC `SECURITY DEFINER` (`defi_apply`, `defi_accept`) qui résolvent atomiquement la course « premier binôme complet gagne ».

**Tech Stack:** Supabase Postgres (PL/pgSQL, RLS, RPC), TypeScript (React Native / Expo), pas de harnais de test auto → vérif = `npx tsc --noEmit` + application SQL + requêtes de contrôle.

## Global Constraints

- **Migrations** : fichiers dans `react-matchup/supabase/migrations/`, **100 % idempotents** (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP … IF EXISTS`) — ce projet applique les migrations **à la main** (Supabase SQL editor), pas de timestamp ni de `supabase db push`.
- **Mise** : `stake_multiplier numeric(3,2)`, défaut `1.0`, plage défi `[1.5, 3.0]`. Toute partie non-défi garde `1.0` → **aucun changement de comportement ELO existant**.
- **Niveau défi** : plancher/plafond stockés dans `open_games.min_elo`/`max_elo` (ELO, via `padelLevelToElo`). La bande défi est une **moyenne de binôme**, interprétée par la RPC (les défis ne passent PAS par `join_game`).
- **`current_player_id()`** : helper SQL existant pour l'utilisateur courant (cf. `join_game_rpc.sql`).
- **Sides** : `A_GAU, A_DRO` = Team A (créateur+partenaire), `B_GAU, B_DRO` = Team B (binôme qui relève).
- **ELO source unique** : le trigger SQL est l'autorité ; `lib/elo.ts` est un miroir exact (simulateur admin) — toute formule modifiée des deux côtés à l'identique.

---

### Task 1 : Colonne `stake_multiplier` (open_games + matches)

**Files:**
- Create: `react-matchup/supabase/migrations/defi_stake_column.sql`

**Interfaces:**
- Produces: colonnes `open_games.stake_multiplier numeric(3,2) DEFAULT 1.0`, `matches.stake_multiplier numeric(3,2) DEFAULT 1.0`, contrainte `open_games_defi_stake_chk`.

- [ ] **Step 1 : Écrire la migration**

```sql
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
```

- [ ] **Step 2 : Appliquer la migration**

Coller le contenu dans le **Supabase SQL editor** (projet `icshhobxeppttgayxmba`) et exécuter. Attendu : `Success. No rows returned.`

- [ ] **Step 3 : Vérifier les colonnes**

Run (SQL editor) :
```sql
SELECT table_name, column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name IN ('open_games','matches') AND column_name = 'stake_multiplier';
```
Attendu : 2 lignes, `numeric`, default `1.0`.

- [ ] **Step 4 : Commit**

```bash
git add react-matchup/supabase/migrations/defi_stake_column.sql
git commit -m "feat(defi): colonne stake_multiplier sur open_games + matches"
```

---

### Task 2 : Mise dans le trigger ELO + miroir `lib/elo.ts`

**Files:**
- Create: `react-matchup/supabase/migrations/defi_stake_elo.sql`
- Modify: `react-matchup/lib/elo.ts`

**Interfaces:**
- Consumes: `matches.stake_multiplier` (Task 1).
- Produces: `delta_i` multiplié par `coalesce(NEW.stake_multiplier,1.0)` côté SQL ; `simulateElo(players, scoreText, stakeMultiplier=1)` et `computeEloExchange(..., stakeMultiplier=1)` côté TS.

> ⚠️ **CORRECTION (revue finale)** : la version ci-dessous part de `elo_per_player_k.sql`, qui est **antérieur** et **n'a pas la phase de placement**. La définition CANONIQUE/live est `elo_placement_phase.sql` (branche placement K=85 / blowout 2.5 / cap 90 pour les 4 premiers matchs). Le fichier livré (commit `3b7f45f`) repart du corps de `elo_placement_phase.sql` et multiplie **les deux branches** du `delta` par `stake` (cap 90 appliqué APRÈS le stake, comme `lib/elo.ts`). Voir le contenu réel dans `supabase/migrations/defi_stake_elo.sql`. Ne pas régénérer depuis le bloc ci-dessous tel quel.

- [ ] **Step 1 : Écrire la migration (CREATE OR REPLACE du trigger)**

```sql
-- react-matchup/supabase/migrations/defi_stake_elo.sql
-- ============================================================
-- Défi 2v2 — applique la MISE au delta ELO per-joueur.
-- Reprend fn_distribute_elo_on_validate (elo_per_player_k.sql) à
-- l'IDENTIQUE, seule la ligne du delta change :
--   delta_i = round(greatest(1, round(k_i*factor)) * marge * STAKE)
-- avec STAKE = coalesce(NEW.stake_multiplier, 1.0).
-- Non-défi → stake 1.0 → comportement inchangé.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_distribute_elo_on_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  w_ids   uuid[] := array_remove(ARRAY[NEW.winner_id, NEW.winner_id_2], NULL);
  l_ids   uuid[] := array_remove(ARRAY[NEW.loser_id,  NEW.loser_id_2 ], NULL);
  all_ids uuid[] := array_remove(ARRAY[NEW.winner_id, NEW.winner_id_2, NEW.loser_id, NEW.loser_id_2], NULL);
  w_team   numeric;
  l_team   numeric;
  expected numeric;
  anti     numeric;
  margin   numeric;
  factor   numeric;
  stake    numeric := coalesce(NEW.stake_multiplier, 1.0);
BEGIN
  IF NOT (NEW.status = 'validated' AND OLD.status IS DISTINCT FROM 'validated') THEN
    RETURN NEW;
  END IF;

  CREATE TEMP TABLE _elo_snap ON COMMIT DROP AS
    SELECT
      id, elo_score, win_count, loss_count, fiability_pct, last_match_at,
      round(elo_score * public.elo_inactivity_decay(last_match_at))::numeric AS decayed
    FROM public.players
    WHERE id = ANY(all_ids);

  IF NEW.game_format = 'friendly' THEN
    UPDATE public.players SET last_match_at = now() WHERE id = ANY(all_ids);
    DROP TABLE IF EXISTS _elo_snap;
    RETURN NEW;
  END IF;

  IF array_length(w_ids, 1) IS NULL OR array_length(l_ids, 1) IS NULL THEN
    DROP TABLE IF EXISTS _elo_snap;
    RETURN NEW;
  END IF;

  SELECT avg(decayed) INTO w_team FROM _elo_snap WHERE id = ANY(w_ids);
  SELECT avg(decayed) INTO l_team FROM _elo_snap WHERE id = ANY(l_ids);

  expected := 1.0 / (1.0 + power(10.0, (l_team - w_team) / 400.0));

  anti := CASE
    WHEN (w_team - l_team) > 300 THEN 0.5
    WHEN (w_team - l_team) > 150 THEN 0.75
    ELSE 1.0
  END;

  margin := public.elo_margin_multiplier(NEW.score_text);
  factor := (1 - expected) * anti;

  -- delta PAR JOUEUR × MISE (seule ligne modifiée vs elo_per_player_k.sql)
  CREATE TEMP TABLE _elo_delta ON COMMIT DROP AS
    SELECT
      s.id, s.decayed, s.elo_score,
      round(greatest(1, round(public.elo_k_factor(s.fiability_pct) * factor)) * margin * stake)::int AS delta
    FROM _elo_snap s;

  UPDATE public.players p SET
    elo_score     = d.decayed + d.delta,
    win_count     = coalesce(p.win_count, 0) + 1,
    last_match_at = now(),
    fiability_pct = least(greatest(10, coalesce(p.fiability_pct, 10)) + 5, 100)
  FROM _elo_delta d
  WHERE p.id = d.id AND d.id = ANY(w_ids);

  INSERT INTO public.elo_history (player_id, match_id, elo_score, elo_change)
  SELECT d.id, NEW.id, d.decayed + d.delta, (d.decayed + d.delta) - d.elo_score
  FROM _elo_delta d WHERE d.id = ANY(w_ids);

  UPDATE public.players p SET
    elo_score     = greatest(100, d.decayed - d.delta),
    loss_count    = coalesce(p.loss_count, 0) + 1,
    last_match_at = now(),
    fiability_pct = least(greatest(10, coalesce(p.fiability_pct, 10)) + 5, 100)
  FROM _elo_delta d
  WHERE p.id = d.id AND d.id = ANY(l_ids);

  INSERT INTO public.elo_history (player_id, match_id, elo_score, elo_change)
  SELECT d.id, NEW.id, greatest(100, d.decayed - d.delta), greatest(100, d.decayed - d.delta) - d.elo_score
  FROM _elo_delta d WHERE d.id = ANY(l_ids);

  DROP TABLE IF EXISTS _elo_delta;
  DROP TABLE IF EXISTS _elo_snap;
  RETURN NEW;
END;
$$;

COMMIT;
```

- [ ] **Step 2 : Appliquer la migration** dans le SQL editor. Attendu : `Success`.

- [ ] **Step 3 : Modifier le miroir TS — `getMarginMultiplier` reste, ajouter le stake à `computeEloExchange`**

Dans `react-matchup/lib/elo.ts`, remplacer la signature et le corps de `computeEloExchange` :

```ts
export function computeEloExchange(
  winnerTeamElo: number,
  loserTeamElo: number,
  winnerMatchCount = 30,
  fiabilityPct?: number,
  stakeMultiplier = 1,
): number {
  const expectedWin = 1 / (1 + Math.pow(10, (loserTeamElo - winnerTeamElo) / 400));
  const K = getKFactor(winnerMatchCount, fiabilityPct);
  const antiFarm = getAntiFarmMultiplier(winnerTeamElo, loserTeamElo);
  return Math.max(1, Math.round(K * (1 - expectedWin) * antiFarm * stakeMultiplier));
}
```

- [ ] **Step 4 : Modifier `simulateElo` — propager le stake dans `movement`**

Dans `react-matchup/lib/elo.ts`, changer la signature de `simulateElo` et la ligne `delta` de `movement` :

```ts
export function simulateElo(players: EloPlayerInput[], scoreText?: string | null, stakeMultiplier = 1): EloSimResult {
```

puis, dans la fonction interne `movement`, remplacer la ligne du delta :

```ts
    let delta = Math.round(Math.max(1, Math.round(kFactor * factor)) * margin * stakeMultiplier);
```

(le reste de `movement` et de `simulateElo` est inchangé ; en placement, le plafond `PLACEMENT_DELTA_CAP` s'applique APRÈS le stake — comportement voulu : la mise ne fait pas exploser un match de placement.)

- [ ] **Step 5 : Vérifier le typecheck**

Run : `cd react-matchup && npx tsc --noEmit`
Attendu : aucune erreur (les nouveaux paramètres ont un défaut → appelants existants inchangés).

- [ ] **Step 6 : Smoke-test SQL de la mise (optionnel mais recommandé)**

Dans le SQL editor, sur un match de test `validated` avec `stake_multiplier = 2.0`, vérifier que `elo_history.elo_change` est ~2× celui d'un match identique à `1.0`. (Si pas de données de test sous la main, sauter — la revue de la ligne `delta` suffit.)

- [ ] **Step 7 : Commit**

```bash
git add react-matchup/supabase/migrations/defi_stake_elo.sql react-matchup/lib/elo.ts
git commit -m "feat(defi): mise (stake) appliquée au delta ELO — trigger SQL + miroir lib/elo.ts"
```

---

### Task 3 : Copier la mise dans le match à la saisie de score

**Files:**
- Modify: `react-matchup/app/score-entry.tsx` (GAME_SELECT ~ligne 231 ; `matchPayload` ~ligne 474-485)

**Interfaces:**
- Consumes: `open_games.stake_multiplier` (Task 1), `matches.stake_multiplier` (Task 1).
- Produces: chaque `matches` créé porte le `stake_multiplier` de son `open_game` → le trigger ELO (Task 2) l'applique.

- [ ] **Step 1 : Inclure `stake_multiplier` dans le select du jeu**

Dans `react-matchup/app/score-entry.tsx`, à la constante `GAME_SELECT` (~ligne 231), ajouter `stake_multiplier` à la liste des colonnes `open_games` (juste après `game_format`) :

```ts
const GAME_SELECT = 'id, location, match_date, status, is_challenge, game_format, stake_multiplier, creator_id, creator_side, creator:creator_id(id, name, elo_score), participants:game_participants(id, player_id, status, team_side, player:player_id(id, name, elo_score))';
```

- [ ] **Step 2 : Ajouter le type au modèle de jeu local**

Dans `react-matchup/app/score-entry.tsx` (~ligne 27, l'interface qui déclare `is_challenge?: boolean; game_format?: string;`), ajouter :

```ts
  is_challenge?: boolean; game_format?: string; stake_multiplier?: number;
```

- [ ] **Step 3 : Copier la mise dans `matchPayload`**

Dans `react-matchup/app/score-entry.tsx`, dans `matchPayload` (~ligne 484, après `is_challenge: game.is_challenge ?? false,`) ajouter :

```ts
      is_challenge: game.is_challenge ?? false,
      stake_multiplier: game.stake_multiplier ?? 1.0,
```

- [ ] **Step 4 : Typecheck**

Run : `cd react-matchup && npx tsc --noEmit`
Attendu : aucune erreur.

- [ ] **Step 5 : Commit**

```bash
git add react-matchup/app/score-entry.tsx
git commit -m "feat(defi): le match saisi hérite du stake_multiplier de l'open_game"
```

---

### Task 4 : Table `defi_applications` + RLS

**Files:**
- Create: `react-matchup/supabase/migrations/defi_applications.sql`

**Interfaces:**
- Produces: table `public.defi_applications(id, game_id, initiator_id, partner_id, status, created_at, resolved_at)`, statut ∈ `{pending, locked, rejected, cancelled}`, index `idx_defi_apps_game_status`, RLS lecture seule côté client (écriture via RPC `SECURITY DEFINER` uniquement).

- [ ] **Step 1 : Écrire la migration**

```sql
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
```

- [ ] **Step 2 : Appliquer** dans le SQL editor. Attendu : `Success`.

- [ ] **Step 3 : Vérifier la table + RLS**

```sql
SELECT count(*) FROM public.defi_applications;                 -- 0
SELECT relrowsecurity FROM pg_class WHERE relname = 'defi_applications';  -- t
```

- [ ] **Step 4 : Commit**

```bash
git add react-matchup/supabase/migrations/defi_applications.sql
git commit -m "feat(defi): table defi_applications (candidature-binôme) + RLS"
```

---

### Task 5 : RPC `defi_apply` (postuler avec un partenaire)

**Files:**
- Create: `react-matchup/supabase/migrations/defi_apply_rpc.sql`

**Interfaces:**
- Consumes: `defi_applications` (Task 4), `open_games.min_elo/max_elo/is_challenge/status`, `current_player_id()`.
- Produces: `defi_apply(p_game_id uuid, p_partner_id uuid) RETURNS uuid` (id de la candidature créée).

- [ ] **Step 1 : Écrire la migration**

```sql
-- react-matchup/supabase/migrations/defi_apply_rpc.sql
-- ============================================================
-- Défi 2v2 — un joueur POSTULE pour relever un défi, en désignant
-- son partenaire. Crée une defi_applications 'pending'. La place
-- n'est PAS encore prise : il faut que le partenaire accepte
-- (defi_accept) pour verrouiller Team B.
-- Éligibilité : moyenne ELO du binôme ∈ [min_elo, max_elo].
-- ============================================================
CREATE OR REPLACE FUNCTION public.defi_apply(
  p_game_id    uuid,
  p_partner_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me        uuid := public.current_player_id();
  v_is_chal   boolean;
  v_status    text;
  v_min       int;
  v_max       int;
  v_avg       numeric;
  v_app_id    uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_partner_id IS NULL OR p_partner_id = v_me THEN
    RAISE EXCEPTION 'invalid partner';
  END IF;

  -- Verrou sur la partie (sérialise vs defi_accept concurrents)
  SELECT is_challenge, status, min_elo, max_elo
    INTO v_is_chal, v_status, v_min, v_max
    FROM open_games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'game not found'; END IF;
  IF v_is_chal IS NOT TRUE THEN RAISE EXCEPTION 'not a defi'; END IF;
  IF v_status <> 'open' THEN RAISE EXCEPTION 'defi not open'; END IF;

  -- Ni moi ni mon partenaire déjà dans la partie (créateur/participant)
  IF EXISTS (
    SELECT 1 FROM open_games g
    WHERE g.id = p_game_id AND g.creator_id IN (v_me, p_partner_id)
  ) OR EXISTS (
    SELECT 1 FROM game_participants gp
    WHERE gp.game_id = p_game_id AND gp.player_id IN (v_me, p_partner_id)
      AND gp.status IN ('accepted','invited')
  ) THEN
    RAISE EXCEPTION 'player already in game';
  END IF;

  -- Éligibilité : moyenne ELO du binôme dans la bande
  SELECT avg(elo_score) INTO v_avg FROM players WHERE id IN (v_me, p_partner_id);
  IF v_avg < coalesce(v_min, 0) OR v_avg > coalesce(v_max, 999999) THEN
    RAISE EXCEPTION 'binome out of level band';
  END IF;

  -- Une seule candidature pending par initiateur sur ce défi : on remplace.
  UPDATE defi_applications
    SET status = 'cancelled', resolved_at = now()
    WHERE game_id = p_game_id AND initiator_id = v_me AND status = 'pending';

  INSERT INTO defi_applications (game_id, initiator_id, partner_id, status)
    VALUES (p_game_id, v_me, p_partner_id, 'pending')
    RETURNING id INTO v_app_id;

  RETURN v_app_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.defi_apply(uuid, uuid) TO authenticated;
```

- [ ] **Step 2 : Appliquer** dans le SQL editor. Attendu : `Success`.

- [ ] **Step 3 : Vérifier la signature**

```sql
SELECT proname, pg_get_function_arguments(oid)
FROM pg_proc WHERE proname = 'defi_apply';
```
Attendu : `p_game_id uuid, p_partner_id uuid`.

- [ ] **Step 4 : Commit**

```bash
git add react-matchup/supabase/migrations/defi_apply_rpc.sql
git commit -m "feat(defi): RPC defi_apply (postuler avec un partenaire, gate moyenne de niveau)"
```

---

### Task 6 : RPC `defi_accept` (résolution atomique de la course)

**Files:**
- Create: `react-matchup/supabase/migrations/defi_accept_rpc.sql`

**Interfaces:**
- Consumes: `defi_applications` (Task 4), `defi_apply` (Task 5), `game_participants`, `open_games`, `current_player_id()`.
- Produces: `defi_accept(p_app_id uuid) RETURNS text` → `'locked'` (binôme verrouillé, match confirmé) ou `'too_late'` (un autre binôme a déjà verrouillé).

- [ ] **Step 1 : Écrire la migration**

```sql
-- react-matchup/supabase/migrations/defi_accept_rpc.sql
-- ============================================================
-- Défi 2v2 — le PARTENAIRE d'une candidature accepte → résolution
-- ATOMIQUE de la course :
--   • verrou de la partie (FOR UPDATE) : un seul binôme passe.
--   • si Team B déjà verrouillée → cette candidature 'rejected',
--     retour 'too_late'.
--   • sinon : candidature 'locked', insertion des 2 joueurs en
--     'accepted' côté B, rejet des autres 'pending', partie
--     'confirmed' (spots 0). Retour 'locked'.
-- Re-valide l'éligibilité (l'ELO a pu bouger depuis defi_apply).
-- Les triggers anti-chevauchement ±2h (block_accepted_overlaps)
-- s'appliquent à l'insertion 'accepted' → si un membre est déjà
-- engagé ±2h, l'INSERT lève et toute la transaction est annulée.
-- ============================================================
CREATE OR REPLACE FUNCTION public.defi_accept(p_app_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me        uuid := public.current_player_id();
  v_game_id   uuid;
  v_initiator uuid;
  v_partner   uuid;
  v_app_stat  text;
  v_min       int;
  v_max       int;
  v_avg       numeric;
  v_b_taken   text[];
  v_side_i    text;
  v_side_p    text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- Charger la candidature + verrouiller la PARTIE (sérialise la course)
  SELECT a.game_id, a.initiator_id, a.partner_id, a.status
    INTO v_game_id, v_initiator, v_partner, v_app_stat
    FROM defi_applications a
    WHERE a.id = p_app_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'application not found'; END IF;
  IF v_me <> v_partner THEN RAISE EXCEPTION 'not the invited partner'; END IF;
  IF v_app_stat <> 'pending' THEN RAISE EXCEPTION 'application not pending'; END IF;

  PERFORM 1 FROM open_games WHERE id = v_game_id FOR UPDATE;

  SELECT min_elo, max_elo INTO v_min, v_max FROM open_games WHERE id = v_game_id;

  -- Course déjà gagnée par un autre binôme ?
  IF EXISTS (
    SELECT 1 FROM defi_applications
    WHERE game_id = v_game_id AND status = 'locked'
  ) THEN
    UPDATE defi_applications SET status = 'rejected', resolved_at = now() WHERE id = p_app_id;
    RETURN 'too_late';
  END IF;

  -- Re-valider l'éligibilité (ELO a pu bouger)
  SELECT avg(elo_score) INTO v_avg FROM players WHERE id IN (v_initiator, v_partner);
  IF v_avg < coalesce(v_min, 0) OR v_avg > coalesce(v_max, 999999) THEN
    UPDATE defi_applications SET status = 'rejected', resolved_at = now() WHERE id = p_app_id;
    RAISE EXCEPTION 'binome out of level band';
  END IF;

  -- Sides B libres
  SELECT array_agg(team_side) INTO v_b_taken
    FROM game_participants
    WHERE game_id = v_game_id AND status = 'accepted' AND team_side IN ('B_GAU','B_DRO');
  v_b_taken := coalesce(v_b_taken, '{}'::text[]);
  v_side_i := CASE WHEN 'B_GAU' <> ALL(v_b_taken) THEN 'B_GAU' ELSE 'B_DRO' END;
  v_side_p := CASE WHEN v_side_i = 'B_GAU' THEN 'B_DRO' ELSE 'B_GAU' END;

  -- Verrouiller cette candidature
  UPDATE defi_applications SET status = 'locked', resolved_at = now() WHERE id = p_app_id;

  -- Insérer le binôme côté B (les triggers ±2h peuvent lever ici → rollback)
  INSERT INTO game_participants (game_id, player_id, status, team_side)
    VALUES (v_game_id, v_initiator, 'accepted', v_side_i),
           (v_game_id, v_partner,   'accepted', v_side_p);

  -- Rejeter les autres candidatures encore pending
  UPDATE defi_applications
    SET status = 'rejected', resolved_at = now()
    WHERE game_id = v_game_id AND status = 'pending' AND id <> p_app_id;

  -- Partie complète
  UPDATE open_games SET status = 'confirmed', spots_available = 0 WHERE id = v_game_id;

  RETURN 'locked';
END;
$$;

GRANT EXECUTE ON FUNCTION public.defi_accept(uuid) TO authenticated;
```

- [ ] **Step 2 : Appliquer** dans le SQL editor. Attendu : `Success`.

- [ ] **Step 3 : Test manuel de la course (SQL editor, 2 candidatures concurrentes)**

Préparer un défi `open` (is_challenge, status='open', min_elo/max_elo larges) avec créateur + partenaire déjà `accepted` côté A. Créer 2 candidatures via `defi_apply` (2 binômes). Appeler `defi_accept` sur la 1re → attendu `'locked'`, partie `confirmed`, l'autre candidature `rejected`. Appeler `defi_accept` sur la 2e → attendu `'too_late'`.
```sql
SELECT status, count(*) FROM defi_applications WHERE game_id = '<id>' GROUP BY status;
SELECT status, spots_available FROM open_games WHERE id = '<id>';
SELECT player_id, team_side, status FROM game_participants WHERE game_id = '<id>';
```

- [ ] **Step 4 : Commit**

```bash
git add react-matchup/supabase/migrations/defi_accept_rpc.sql
git commit -m "feat(defi): RPC defi_accept (résolution atomique de la course, premier binôme complet gagne)"
```

---

## Self-review (Phase 1)

- **Couverture spec** : mise ELO (Tasks 1-3) ✓ ; candidature-binôme atomique + course (Tasks 4-6) ✓ ; réutilisation `is_challenge`/`min_elo`/`max_elo` ✓ ; revalidation d'éligibilité au lock ✓ ; interaction anti-chevauchement notée (Task 6 commentaire) ✓.
- **Hors Phase 1 (volontaire)** : statut `draft` + bascule draft→open à l'acceptation du partenaire créateur, et la non-utilisation de `join_game` pour les défis → traités en **Phase 2** (wizard) car liés à la création/UX. En Phase 1, un défi de test est monté en `open` directement en SQL.
- **Types** : `stake_multiplier` cohérent `numeric(3,2)` partout ; RPC `defi_apply(uuid,uuid)→uuid`, `defi_accept(uuid)→text` utilisées telles quelles en Phase 3.

---

## Roadmap des phases suivantes (plans à écrire ensuite)

> Chaque phase = un plan séparé, écrit après lecture complète des fichiers UI concernés, pour rester sans placeholder.

- **Phase 2 — Création dans le `CreateWizard`** : statut `draft` (non publié) ; nouvelle étape « Mon binôme » (avant mise/plafond, Défi-only) ; curseurs mise (→ `stake_multiplier`) et plafond (→ `max_elo`), plancher = `padelLevelToElo(moyenne paire)` (→ `min_elo`) ; Team B verrouillée ouverte ; bascule draft→open quand le partenaire créateur accepte ; **retrait de l'écriture dans `challenges`** (`lobby.tsx:2111`). Fichiers : `CreateWizard.tsx`, `lobby.tsx` (`handlePublish`).
- **Phase 3 — Hub Défi + flux « Relever »** : refonte `matchmaking.tsx` (sections *À relever* filtrée éligibles / *Mes défis* / *Candidatures*) ; bouton « Lancer un défi » → wizard ; flux Relever → choix partenaire → `defi_apply` ; acceptation partenaire → `defi_accept` ; retrait du 1v1 « Défier depuis Suggestions ».
- **Phase 4 — Notifications** : événements défi (partenaire créateur invité/accepte, partenaire candidat invité, binôme locké → 4 joueurs, candidatures rejetées) via `notifyPlayers`/`send-push` ; compteur cloche via `buildNotificationItems` (source unique).
- **Phase 5 — Nettoyage** : retrait `lib/challenges.ts` + lecteurs (`matchmaking`, `useNotificationCount`, `notifications.tsx`) ; dépréciation table `challenges` (dormante, pas de DROP).
