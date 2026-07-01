# Binômes ouverts + défi ciblé — Plan 1 : Fondation backend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Poser tout le backend des binômes en vitrine et du défi ciblé : table `showcase_binomes` + RPC, colonne `open_games.is_targeted`, helpers SQL niveau↔ELO, trigger de conversion/annulation au refus, trigger d'auto-fermeture des vitrines à la confirmation.

**Architecture:** Un binôme en vitrine = une ligne `showcase_binomes` (nomination → confirmation → fermeture), écrite via RPC `SECURITY DEFINER`. Un défi ciblé = une `open_games(is_challenge, is_targeted=true)` avec 4 invités et sans bande — l'insertion se fait côté client (Plan 2). Le backend ajoute la logique serveur qui manque : quand un invité décline un défi ciblé, un trigger convertit (Team B décline → défi ouvert) ou annule (Team A décline) ; quand un défi se confirme, un trigger ferme les vitrines des paires engagées.

**Tech Stack:** Supabase Postgres (PL/pgSQL, RLS, triggers). Vérif = application SQL manuelle (pas d'outil Supabase) + requêtes de contrôle.

## Global Constraints

- **Migrations** dans `react-matchup/supabase/migrations/`, 100 % idempotentes (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP … IF EXISTS`), appliquées à la main. `supabase/` est gitignoré → stager avec `git add -f`.
- **`current_player_id()`** = helper SQL existant (utilisateur courant).
- **Ancres niveau↔ELO** (identiques à `lib/theme.ts`) : `[700→1, 850→2, 1000→3, 1200→4, 1400→5, 1650→6, 1950→7, 2300→8]` ; clamp `elo≤700→1.0`, `elo≥2300→8.0`.
- **`showcase_binomes.status`** ∈ `{pending, active, closed}`. **Unique par paire non ordonnée** tant que `pending`/`active`.
- **`open_games.is_targeted`** : `boolean NOT NULL DEFAULT false`. Un défi ciblé n'apparaît jamais dans « À relever » (le client filtre déjà `is_challenge AND status='open'` ; on ajoutera `AND is_targeted = false` en Plan 2) et ne doit pas déclencher le trigger draft→open (celui-ci ne touche que Team A accepté ; un défi ciblé n'a pas de statut draft → non concerné).
- **Refus d'un défi ciblé** : décline `B_*` → conversion en ouvert (`is_targeted=false`, Team B vidée, bande posée `min_elo=level_to_elo(moy. niveau Team A)`, `max_elo=level_to_elo(plancher+1.5)`, `status='open'`, `spots_available=2`). Décline `A_*` → `status='cancelled'`.
- **Auto-fermeture** : à la confirmation d'un défi (`is_challenge`, `status→confirmed`), fermer les `showcase_binomes` `active` dont la paire = la paire Team A ou la paire Team B du défi.

---

### Task 1 : Migration — table `showcase_binomes` + colonne `is_targeted`

**Files:**
- Create: `react-matchup/supabase/migrations/showcase_binomes.sql`

**Interfaces:**
- Produces: table `public.showcase_binomes(id, player_a, player_b, status, created_at, resolved_at)` + RLS ; colonne `public.open_games.is_targeted boolean NOT NULL DEFAULT false`.

- [ ] **Step 1 : Écrire la migration**

```sql
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
```

- [ ] **Step 2 : (manuel) appliquer** dans le SQL editor. Vérif :
```sql
SELECT relrowsecurity FROM pg_class WHERE relname='showcase_binomes'; -- t
SELECT column_name FROM information_schema.columns WHERE table_name='open_games' AND column_name='is_targeted'; -- 1 ligne
```
- [ ] **Step 3 : Commit**
```bash
git add -f react-matchup/supabase/migrations/showcase_binomes.sql
git commit -m "feat(vitrine): table showcase_binomes + colonne open_games.is_targeted + RLS"
```

---

### Task 2 : Helpers SQL niveau↔ELO (`elo_to_level` / `level_to_elo`)

**Files:**
- Create: `react-matchup/supabase/migrations/elo_level_helpers.sql`

**Interfaces:**
- Produces: `public.elo_to_level(elo numeric) RETURNS numeric` et `public.level_to_elo(lvl numeric) RETURNS int` — port fidèle des ancres de `lib/theme.ts`. Utilisés par le trigger de conversion (Task 4).

- [ ] **Step 1 : Écrire la migration**

```sql
-- react-matchup/supabase/migrations/elo_level_helpers.sql
-- ============================================================
-- Conversion niveau padel ↔ ELO en SQL (port des ancres de lib/theme.ts).
-- Ancres : (700,1)(850,2)(1000,3)(1200,4)(1400,5)(1650,6)(1950,7)(2300,8).
-- Interpolation linéaire par segment ; clamp aux bornes. IMMUTABLE.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.elo_to_level(p_elo numeric)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  e numeric[] := ARRAY[700,850,1000,1200,1400,1650,1950,2300];
  l numeric[] := ARRAY[1,2,3,4,5,6,7,8];
  i int;
BEGIN
  IF p_elo <= 700 THEN RETURN 1.0; END IF;
  IF p_elo >= 2300 THEN RETURN 8.0; END IF;
  FOR i IN 1..7 LOOP
    IF p_elo >= e[i] AND p_elo < e[i+1] THEN
      RETURN round((l[i] + (p_elo - e[i]) / (e[i+1] - e[i]) * (l[i+1] - l[i]))::numeric, 2);
    END IF;
  END LOOP;
  RETURN 8.0;
END;
$$;

CREATE OR REPLACE FUNCTION public.level_to_elo(p_lvl numeric)
RETURNS int
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  e numeric[] := ARRAY[700,850,1000,1200,1400,1650,1950,2300];
  l numeric[] := ARRAY[1,2,3,4,5,6,7,8];
  i int;
BEGIN
  IF p_lvl <= 1.0 THEN RETURN 700; END IF;
  IF p_lvl >= 8.0 THEN RETURN 2300; END IF;
  FOR i IN 1..7 LOOP
    IF p_lvl >= l[i] AND p_lvl <= l[i+1] THEN
      RETURN round(e[i] + (p_lvl - l[i]) / (l[i+1] - l[i]) * (e[i+1] - e[i]))::int;
    END IF;
  END LOOP;
  RETURN 2300;
END;
$$;

COMMIT;
```

- [ ] **Step 2 : (manuel) appliquer** + vérif :
```sql
SELECT public.elo_to_level(1300), public.level_to_elo(4.5);  -- ~4.5, ~1300
```
- [ ] **Step 3 : Commit**
```bash
git add -f react-matchup/supabase/migrations/elo_level_helpers.sql
git commit -m "feat(vitrine): helpers SQL elo_to_level / level_to_elo (port des ancres)"
```

---

### Task 3 : RPC vitrine (`showcase_open` / `showcase_confirm` / `showcase_close`)

**Files:**
- Create: `react-matchup/supabase/migrations/showcase_rpcs.sql`

**Interfaces:**
- Consumes: `showcase_binomes` (Task 1), `current_player_id()`.
- Produces: `showcase_open(p_partner_id uuid) RETURNS uuid` ; `showcase_confirm(p_id uuid) RETURNS void` ; `showcase_close(p_id uuid) RETURNS void`.

- [ ] **Step 1 : Écrire la migration**

```sql
-- react-matchup/supabase/migrations/showcase_rpcs.sql
-- ============================================================
-- Cycle de vie d'un binôme en vitrine (écriture via SECURITY DEFINER).
-- ============================================================

-- Nominer un partenaire → vitrine 'pending'. Refuse si une vitrine vivante
-- existe déjà pour ce couple (l'index unique le garantit aussi).
CREATE OR REPLACE FUNCTION public.showcase_open(p_partner_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_me uuid := public.current_player_id();
  v_id uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_partner_id IS NULL OR p_partner_id = v_me THEN RAISE EXCEPTION 'invalid partner'; END IF;
  IF EXISTS (
    SELECT 1 FROM showcase_binomes
    WHERE status IN ('pending','active')
      AND least(player_a,player_b) = least(v_me,p_partner_id)
      AND greatest(player_a,player_b) = greatest(v_me,p_partner_id)
  ) THEN
    RAISE EXCEPTION 'showcase already exists for this pair';
  END IF;
  INSERT INTO showcase_binomes (player_a, player_b, status)
    VALUES (v_me, p_partner_id, 'pending')
    RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.showcase_open(uuid) TO authenticated;

-- Le partenaire nommé confirme → 'active'.
CREATE OR REPLACE FUNCTION public.showcase_confirm(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_me uuid := public.current_player_id();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE showcase_binomes
    SET status = 'active', resolved_at = now()
    WHERE id = p_id AND player_b = v_me AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'not confirmable'; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.showcase_confirm(uuid) TO authenticated;

-- L'un des deux ferme (à tout moment) → 'closed'.
CREATE OR REPLACE FUNCTION public.showcase_close(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_me uuid := public.current_player_id();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE showcase_binomes
    SET status = 'closed', resolved_at = now()
    WHERE id = p_id AND (player_a = v_me OR player_b = v_me) AND status IN ('pending','active');
  IF NOT FOUND THEN RAISE EXCEPTION 'not closable'; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.showcase_close(uuid) TO authenticated;
```

- [ ] **Step 2 : (manuel) appliquer** + vérif signatures :
```sql
SELECT proname, pg_get_function_arguments(oid) FROM pg_proc
WHERE proname IN ('showcase_open','showcase_confirm','showcase_close');
```
- [ ] **Step 3 : Commit**
```bash
git add -f react-matchup/supabase/migrations/showcase_rpcs.sql
git commit -m "feat(vitrine): RPC showcase_open / showcase_confirm / showcase_close"
```

---

### Task 4 : Trigger conversion/annulation au refus d'un défi ciblé

**Files:**
- Create: `react-matchup/supabase/migrations/defi_targeted_decline.sql`

**Interfaces:**
- Consumes: `open_games.is_targeted` (Task 1), `elo_to_level`/`level_to_elo` (Task 2), `game_participants`.
- Produces: trigger `trg_defi_targeted_decline` sur `game_participants`.

- [ ] **Step 1 : Écrire la migration**

```sql
-- react-matchup/supabase/migrations/defi_targeted_decline.sql
-- ============================================================
-- Défi CIBLÉ — gestion du refus.
--  • Décline B_* (un membre du binôme ciblé) → CONVERSION en défi ouvert :
--     is_targeted=false, Team B vidée, bande posée (plancher = moyenne niveau
--     Team A, plafond = plancher+1.5), status='open', spots_available=2.
--  • Décline A_* (mon partenaire) → ANNULATION (status='cancelled').
-- Ne s'applique qu'aux open_games is_challenge AND is_targeted, non terminales.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_defi_targeted_decline()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_is_tgt   boolean;
  v_status   text;
  v_creator  uuid;
  v_a_elo    numeric;
  v_p_elo    numeric;
  v_floor_lv numeric;
BEGIN
  IF NOT (NEW.status = 'declined' AND OLD.status IS DISTINCT FROM 'declined') THEN
    RETURN NEW;
  END IF;

  SELECT is_targeted, status, creator_id INTO v_is_tgt, v_status, v_creator
    FROM open_games WHERE id = NEW.game_id FOR UPDATE;
  IF v_is_tgt IS NOT TRUE OR v_status IN ('confirmed','cancelled','closed') THEN
    RETURN NEW;
  END IF;

  IF (NEW.team_side LIKE 'A%') THEN
    -- Mon partenaire décline → annulation
    UPDATE open_games SET status = 'cancelled' WHERE id = NEW.game_id;
    RETURN NEW;
  END IF;

  -- Sinon : membre du binôme ciblé (B_*) décline → conversion en ouvert.
  -- Niveaux de Team A : créateur + son partenaire (participant A_*).
  SELECT elo_score INTO v_a_elo FROM players WHERE id = v_creator;
  SELECT p.elo_score INTO v_p_elo
    FROM game_participants gp JOIN players p ON p.id = gp.player_id
    WHERE gp.game_id = NEW.game_id AND gp.team_side LIKE 'A%' AND gp.player_id <> v_creator
    LIMIT 1;
  v_floor_lv := (public.elo_to_level(coalesce(v_a_elo,1000)) + public.elo_to_level(coalesce(v_p_elo, v_a_elo))) / 2.0;

  -- Vider Team B (retirer les 2 invités ciblés).
  DELETE FROM game_participants
    WHERE game_id = NEW.game_id AND team_side LIKE 'B%';

  UPDATE open_games SET
    is_targeted = false,
    min_elo = public.level_to_elo(v_floor_lv),
    max_elo = public.level_to_elo(least(8.0, v_floor_lv + 1.5)),
    status = 'open',
    spots_available = 2
  WHERE id = NEW.game_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_defi_targeted_decline ON public.game_participants;
CREATE TRIGGER trg_defi_targeted_decline
  AFTER UPDATE ON public.game_participants
  FOR EACH ROW EXECUTE FUNCTION public.fn_defi_targeted_decline();

COMMIT;
```

- [ ] **Step 2 : (manuel) appliquer** + test des 2 chemins (décliner un B_* → open ; décliner un A_* → cancelled) sur un défi ciblé de test.
- [ ] **Step 3 : Commit**
```bash
git add -f react-matchup/supabase/migrations/defi_targeted_decline.sql
git commit -m "feat(vitrine): refus d'un défi ciblé — conversion (B décline) ou annulation (A décline)"
```

---

### Task 5 : Trigger auto-fermeture des vitrines à la confirmation

**Files:**
- Create: `react-matchup/supabase/migrations/showcase_autoclose.sql`

**Interfaces:**
- Consumes: `showcase_binomes` (Task 1), `open_games`, `game_participants`.
- Produces: trigger `trg_showcase_autoclose` sur `open_games`.

- [ ] **Step 1 : Écrire la migration**

```sql
-- react-matchup/supabase/migrations/showcase_autoclose.sql
-- ============================================================
-- Auto-fermeture des binômes en vitrine quand un défi (is_challenge) se
-- confirme : on ferme les showcase_binomes 'active' dont la paire = la paire
-- Team A OU la paire Team B des joueurs ACCEPTÉS du défi.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_showcase_autoclose()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  a_ids uuid[];
  b_ids uuid[];
BEGIN
  IF NOT (NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed'
          AND NEW.is_challenge IS TRUE) THEN
    RETURN NEW;
  END IF;

  -- Paire Team A = créateur + participant A_* accepté ; Team B = 2 participants B_* acceptés.
  SELECT array_agg(player_id) INTO a_ids FROM (
    SELECT NEW.creator_id AS player_id
    UNION
    SELECT gp.player_id FROM game_participants gp
      WHERE gp.game_id = NEW.id AND gp.status='accepted' AND gp.team_side LIKE 'A%'
  ) s;
  SELECT array_agg(gp.player_id) INTO b_ids FROM game_participants gp
    WHERE gp.game_id = NEW.id AND gp.status='accepted' AND gp.team_side LIKE 'B%';

  -- Ferme la vitrine active dont la paire = {a_ids} (2 joueurs) ou {b_ids}.
  IF array_length(a_ids,1) = 2 THEN
    UPDATE showcase_binomes SET status='closed', resolved_at=now()
    WHERE status='active'
      AND least(player_a,player_b) = least(a_ids[1],a_ids[2])
      AND greatest(player_a,player_b) = greatest(a_ids[1],a_ids[2]);
  END IF;
  IF array_length(b_ids,1) = 2 THEN
    UPDATE showcase_binomes SET status='closed', resolved_at=now()
    WHERE status='active'
      AND least(player_a,player_b) = least(b_ids[1],b_ids[2])
      AND greatest(player_a,player_b) = greatest(b_ids[1],b_ids[2]);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_showcase_autoclose ON public.open_games;
CREATE TRIGGER trg_showcase_autoclose
  AFTER UPDATE ON public.open_games
  FOR EACH ROW EXECUTE FUNCTION public.fn_showcase_autoclose();

COMMIT;
```

- [ ] **Step 2 : (manuel) appliquer** + test (confirmer un défi dont Team A/B correspond à une vitrine active → elle passe 'closed').
- [ ] **Step 3 : Commit**
```bash
git add -f react-matchup/supabase/migrations/showcase_autoclose.sql
git commit -m "feat(vitrine): auto-fermeture des binômes en vitrine à la confirmation d'un défi"
```

---

## Self-review (Plan 1)

- **Couverture spec** : table `showcase_binomes` + RLS + unique-par-paire (Task 1) ✓ ; `is_targeted` (Task 1) ✓ ; RPC open/confirm/close (Task 3) ✓ ; refus B→ouvert / A→annulé avec bande plancher..plancher+1.5 (Task 4, helpers Task 2) ✓ ; auto-fermeture à la confirmation (Task 5) ✓.
- **Reporté au Plan 2 (client)** : mode « ciblé » du `CreateWizard` (Team B verrouillée, pas de bande, `is_targeted=true` à l'insert) ; section « Binômes ouverts » du hub + toggle profil + `lib/showcase.ts` ; exclusion `is_targeted=false` dans `fetchOpenDefis` ; notifs vitrine.
- **Risque** : le trigger de conversion (Task 4) écrit `min_elo/max_elo` via `level_to_elo` — dépend de Task 2 (appliquer dans l'ordre). L'auto-fermeture (Task 5) sur `open_games AFTER UPDATE` coexiste avec `trg_publish_defi_on_partner_accept` (sur `game_participants`) et `trg_showcase_autoclose` — pas de conflit (cibles différentes).
- **Ordre d'application SQL** : 1 (table+colonne) → 2 (helpers) → 3 (RPC) → 4 (conversion) → 5 (autoclose).

## Runbook Plan 1

Appliquer les 5 migrations dans l'ordre ci-dessus. Aucune dépendance client. pg_cron non requis.
