# Live Scoring (Phase 1 téléphone) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Suivi du score en direct jeu par jeu pendant un match (scoreur désigné, lecteurs realtime, contestation, pont vers `matches`), livré derrière un feature flag admin éteint.

**Architecture:** Journal d'événements append-only (`live_match_events`) comme source de vérité + état dénormalisé (`live_match_sessions.current_state`) recalculé par RPC transactionnelle. Reducer pur dupliqué TS (optimistic UI/offline) et plpgsql (autorité). Realtime Supabase sur la table sessions. Le pont vers `matches` réutilise le trigger ELO existant via `pending → validated`.

**Tech Stack:** Expo SDK 54 / RN / expo-router, Supabase (Postgres RLS + RPC + Realtime), vitest (nouveau, tests du reducer).

**Spec:** `docs/superpowers/specs/2026-08-23-live-scoring-design.md`

## Global Constraints

- **AUCUN `git commit`** : l'utilisateur commite lui-même (règle projet). Chaque tâche se termine par typecheck/tests verts, pas par un commit.
- **Migrations JAMAIS appliquées automatiquement** : écrire le `.sql` dans `supabase/migrations/`, l'utilisateur l'applique dans le SQL editor Supabase. Le signaler en fin de tâche.
- UI en **français** ; thème via `lib/theme` (`Colors`, `Fonts`, `Spacing`, `FontSize`, `Radius`) ; jamais « équipe 1/2 » à l'écran, toujours les prénoms.
- Feature flag `app_config.live_scoring_enabled`, défaut `'false'` — aucune surface visible flag éteint.
- Ne modifier ni `matches`, ni la logique ELO, ni le flux de `score-entry.tsx` (seul ajout : masquage d'une partie en live actif).
- Statuts `matches` réels : `pending` → `validated` (PAS « confirmed ») ; trigger ELO = `trg_distribute_elo_on_validate`, AFTER **UPDATE**, garde `NEW.status='validated' AND OLD.status IS DISTINCT FROM 'validated'`.
- `score_text` format existant : `"6-3, 6-4"` (`sets.map(s => \`${s.t1}-${s.t2}\`).join(', ')`).
- Typecheck : `npx tsc --noEmit` (le repo a des erreurs préexistantes éventuelles : ne vérifier que l'absence d'erreurs NOUVELLES sur les fichiers touchés).

---

### Task 0: Suppression du spike watch-test

**Files:**
- Delete: `app/watch-test.tsx`
- Modify: `components/profile/ProfileMenuSheet.tsx` (retirer la Row « Test montre (spike) » et son commentaire)

**Interfaces:** aucune.

- [ ] **Step 1: Supprimer l'écran**

```powershell
Remove-Item "app\watch-test.tsx"
```

- [ ] **Step 2: Retirer l'entrée du menu**

Dans `components/profile/ProfileMenuSheet.tsx`, supprimer ces deux lignes (section Admin) :

```tsx
              {/* SPIKE JETABLE — test notification-télécommande montre (à retirer) */}
              <Row icon="bell" label="Test montre (spike)" onPress={() => nav('/watch-test')} />
```

- [ ] **Step 3: Vérifier**

Run: `npx tsc --noEmit` → aucune erreur nouvelle ; `grep -r "watch-test" app/ components/` → 0 résultat.

---

### Task 1: Infra de test (vitest)

Le repo n'a **aucun** test runner. On ajoute vitest, uniquement pour les modules purs de `lib/` (pas de tests de composants RN).

**Files:**
- Modify: `package.json` (devDependency + script)
- Create: `lib/__tests__/smoke.test.ts` (supprimé en Task 2)

**Interfaces:**
- Produces: commande `npm test` (vitest run, cible `lib/**/*.test.ts`).

- [ ] **Step 1: Installer vitest**

Run: `npm install --save-dev vitest`

- [ ] **Step 2: Ajouter le script**

Dans `package.json`, section `scripts`, ajouter :

```json
    "test": "vitest run lib"
```

- [ ] **Step 3: Test de fumée**

Créer `lib/__tests__/smoke.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
describe('smoke', () => { it('runs', () => { expect(1 + 1).toBe(2); }); });
```

- [ ] **Step 4: Vérifier**

Run: `npm test` → 1 passed.

---

### Task 2: Reducer pur `lib/liveScore.ts` (TDD)

Le cœur : rejouer un journal d'événements → score. Aucune dépendance (pas de supabase, pas de RN) — c'est la référence de la logique, dupliquée en SQL en Task 3.

**Files:**
- Create: `lib/liveScore.ts`
- Create: `lib/__tests__/liveScore.test.ts`
- Delete: `lib/__tests__/smoke.test.ts`

**Interfaces:**
- Produces (consommé par Tasks 3/4/5) :

```ts
export type LiveEventType = 'game_won' | 'undo' | 'contest' | 'contest_resolved' | 'scorer_changed' | 'finished' | 'abandoned';
export type LiveEvent = { seq: number; event_type: LiveEventType; payload: { team?: 1 | 2; target_seq?: number } };
export type SetScore = { t1: number; t2: number };
export type LiveState = {
  sets: SetScore[];          // sets terminés + set courant (dernier élément)
  setsWon: { t1: number; t2: number }; // sets TERMINÉS gagnés
  finished: boolean;
  openContests: number;      // contest non résolus/non retirés
};
export function replayEvents(events: LiveEvent[]): LiveState;
export function isMatchDecided(state: LiveState): 1 | 2 | null; // équipe gagnante si ≥2 sets ET écart ≥1, sinon null
export function buildScoreText(state: LiveState): string;       // "6-3, 6-4" — sets terminés uniquement + set courant s'il est non vide
```

**Règles à encoder** : un set est terminé quand une équipe atteint ≥6 jeux avec 2 d'écart, OU 7 jeux (7-6 et 7-5 inclus) ; à 6-6 le jeu suivant vaut tie-break (7-6). `undo` annule le **dernier `game_won` encore effectif** (les `game_won` déjà undoés sont sautés ; un `undo` de plus que de jeux = no-op). `contest{target_seq}` incrémente `openContests` ; `contest_resolved{target_seq}` le décrémente (plancher 0). Les autres événements n'affectent pas le score.

- [ ] **Step 1: Écrire les tests (échouants)**

Créer `lib/__tests__/liveScore.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { replayEvents, isMatchDecided, buildScoreText, type LiveEvent } from '../liveScore';

let seq = 0;
const g = (team: 1 | 2): LiveEvent => ({ seq: ++seq, event_type: 'game_won', payload: { team } });
const undo = (): LiveEvent => ({ seq: ++seq, event_type: 'undo', payload: {} });
const games = (n: number, team: 1 | 2) => Array.from({ length: n }, () => g(team));
const reset = () => { seq = 0; };

describe('replayEvents — sets', () => {
  it('journal vide → 0-0, un set courant', () => {
    reset();
    const s = replayEvents([]);
    expect(s.sets).toEqual([{ t1: 0, t2: 0 }]);
    expect(s.setsWon).toEqual({ t1: 0, t2: 0 });
  });
  it('set gagné 6-0 → nouveau set ouvert', () => {
    reset();
    const s = replayEvents(games(6, 1));
    expect(s.sets).toEqual([{ t1: 6, t2: 0 }, { t1: 0, t2: 0 }]);
    expect(s.setsWon).toEqual({ t1: 1, t2: 0 });
  });
  it('6-5 ne clôt pas le set', () => {
    reset();
    const s = replayEvents([...games(5, 1), ...games(5, 2), g(1)]);
    expect(s.sets).toEqual([{ t1: 6, t2: 5 }]);
    expect(s.setsWon).toEqual({ t1: 0, t2: 0 });
  });
  it('7-5 clôt le set', () => {
    reset();
    const s = replayEvents([...games(5, 1), ...games(5, 2), g(1), g(1)]);
    expect(s.setsWon).toEqual({ t1: 1, t2: 0 });
  });
  it('6-6 puis jeu décisif → 7-6', () => {
    reset();
    const evts = [...games(5, 1), ...games(5, 2), g(1), g(2), g(1)]; // 6-6 puis t1
    const s = replayEvents(evts);
    expect(s.sets[0]).toEqual({ t1: 7, t2: 6 });
    expect(s.setsWon).toEqual({ t1: 1, t2: 0 });
  });
});

describe('replayEvents — undo', () => {
  it('undo simple annule le dernier jeu', () => {
    reset();
    const s = replayEvents([g(1), g(1), undo()]);
    expect(s.sets).toEqual([{ t1: 1, t2: 0 }]);
  });
  it('undo rouvre un set clos', () => {
    reset();
    const s = replayEvents([...games(6, 1), undo()]);
    expect(s.sets).toEqual([{ t1: 5, t2: 0 }]);
    expect(s.setsWon).toEqual({ t1: 0, t2: 0 });
  });
  it('undos en cascade sautent les jeux déjà annulés', () => {
    reset();
    const s = replayEvents([g(1), g(2), undo(), undo()]); // annule g(2) puis g(1)
    expect(s.sets).toEqual([{ t1: 0, t2: 0 }]);
  });
  it('undo sur journal vide = no-op', () => {
    reset();
    expect(replayEvents([undo()]).sets).toEqual([{ t1: 0, t2: 0 }]);
  });
});

describe('isMatchDecided', () => {
  it('2-0 → équipe 1', () => {
    reset();
    const s = replayEvents([...games(6, 1), ...games(6, 1)]);
    expect(isMatchDecided(s)).toBe(1);
  });
  it('1-1 → null', () => {
    reset();
    const s = replayEvents([...games(6, 1), ...games(6, 2)]);
    expect(isMatchDecided(s)).toBeNull();
  });
  it('2-1 (set fun perdu) → équipe 1', () => {
    reset();
    const s = replayEvents([...games(6, 1), ...games(6, 1), ...games(6, 2)]);
    expect(isMatchDecided(s)).toBe(1);
  });
  it('2-2 → null (pas de vainqueur net)', () => {
    reset();
    const s = replayEvents([...games(6, 1), ...games(6, 1), ...games(6, 2), ...games(6, 2)]);
    expect(isMatchDecided(s)).toBeNull();
  });
});

describe('buildScoreText', () => {
  it('sets terminés + set courant non vide', () => {
    reset();
    const s = replayEvents([...games(6, 1), ...games(4, 2), g(1)]);
    expect(buildScoreText(s)).toBe('6-0, 1-4');
  });
  it('ignore le set courant vide', () => {
    reset();
    const s = replayEvents([...games(6, 1), ...games(6, 1)]);
    expect(buildScoreText(s)).toBe('6-0, 6-0');
  });
});

describe('contestations', () => {
  it('contest ouvre, contest_resolved ferme', () => {
    reset();
    const evts: LiveEvent[] = [g(1),
      { seq: ++seq, event_type: 'contest', payload: { target_seq: 1 } },
      { seq: ++seq, event_type: 'contest_resolved', payload: { target_seq: 1 } }];
    expect(replayEvents(evts).openContests).toBe(0);
    expect(replayEvents(evts.slice(0, 2)).openContests).toBe(1);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npm test` → FAIL (module `../liveScore` introuvable).

- [ ] **Step 3: Implémenter `lib/liveScore.ts`**

```ts
// Rejeu du journal live → score. Module PUR (aucune dépendance) : c'est la
// RÉFÉRENCE de la logique, dupliquée en plpgsql dans supabase/migrations/
// live_scoring.sql (fn_live_replay). Toute modification ICI doit être
// répercutée LÀ-BAS (même contrainte que lib/elo.ts ↔ elo_on_validate.sql).
export type LiveEventType = 'game_won' | 'undo' | 'contest' | 'contest_resolved' | 'scorer_changed' | 'finished' | 'abandoned';
export type LiveEvent = { seq: number; event_type: LiveEventType; payload: { team?: 1 | 2; target_seq?: number } };
export type SetScore = { t1: number; t2: number };
export type LiveState = {
  sets: SetScore[];
  setsWon: { t1: number; t2: number };
  finished: boolean;
  openContests: number;
};

// Set terminé : ≥6 jeux avec 2 d'écart, ou 7 jeux (7-5 et tie-break 7-6).
function setIsOver(s: SetScore): boolean {
  const max = Math.max(s.t1, s.t2), diff = Math.abs(s.t1 - s.t2);
  return (max >= 6 && diff >= 2) || max === 7;
}

export function replayEvents(events: LiveEvent[]): LiveState {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  // 1. Résoudre les undo : chaque undo annule le dernier game_won encore effectif.
  const effective: LiveEvent[] = [];
  let openContests = 0;
  for (const e of ordered) {
    if (e.event_type === 'game_won') effective.push(e);
    else if (e.event_type === 'undo') {
      for (let i = effective.length - 1; i >= 0; i--) {
        if (effective[i].event_type === 'game_won') { effective.splice(i, 1); break; }
      }
    } else if (e.event_type === 'contest') openContests++;
    else if (e.event_type === 'contest_resolved') openContests = Math.max(0, openContests - 1);
  }
  // 2. Rejouer les jeux effectifs.
  const sets: SetScore[] = [{ t1: 0, t2: 0 }];
  for (const e of effective) {
    const cur = sets[sets.length - 1];
    if (e.payload.team === 1) cur.t1++; else cur.t2++;
    if (setIsOver(cur)) sets.push({ t1: 0, t2: 0 });
  }
  const done = sets.slice(0, -1);
  return {
    sets,
    setsWon: {
      t1: done.filter(s => s.t1 > s.t2).length,
      t2: done.filter(s => s.t2 > s.t1).length,
    },
    finished: ordered.some(e => e.event_type === 'finished'),
    openContests,
  };
}

export function isMatchDecided(state: LiveState): 1 | 2 | null {
  const { t1, t2 } = state.setsWon;
  if (Math.max(t1, t2) >= 2 && t1 !== t2) return t1 > t2 ? 1 : 2;
  return null;
}

export function buildScoreText(state: LiveState): string {
  const done = state.sets.slice(0, -1);
  const cur = state.sets[state.sets.length - 1];
  const all = (cur.t1 > 0 || cur.t2 > 0) ? [...done, cur] : done;
  return all.map(s => `${s.t1}-${s.t2}`).join(', ');
}
```

- [ ] **Step 4: Vérifier**

Run: `npm test` → tous verts. Supprimer `lib/__tests__/smoke.test.ts`. Run: `npx tsc --noEmit` → rien de nouveau.

---

### Task 3: Migration SQL `supabase/migrations/live_scoring.sql`

Tables + RLS + RPC. La fonction de rejeu plpgsql **duplique exactement** `lib/liveScore.ts` (commentaire croisé obligatoire des deux côtés).

**Files:**
- Create: `supabase/migrations/live_scoring.sql`

**Interfaces:**
- Produces (consommé par Task 4 via `supabase.rpc(...)`) :
  - `start_live_session(p_game_id uuid) → uuid` (session id ; erreur si flag éteint, si pas participant confirmé, si session déjà `live`/`finished`)
  - `apply_live_event(p_session_id uuid, p_event_type text, p_payload jsonb) → jsonb` (current_state après rejeu)
  - `take_over_scoring(p_session_id uuid) → void`
  - `finalize_live_session(p_session_id uuid) → uuid` (match id ; idempotente)
  - Colonne `open_games.live_scorer_id uuid null`
  - Clé `app_config['live_scoring_enabled'] = 'false'`

- [ ] **Step 1: Écrire la migration**

```sql
-- ============================================================
-- Score en direct (live scoring) — Phase 1.
-- Journal append-only = source de vérité ; current_state dénormalisé.
-- fn_live_replay DUPLIQUE lib/liveScore.ts (référence TS) : toute modif
-- d'un côté DOIT être répercutée de l'autre.
-- Spec : docs/superpowers/specs/2026-08-23-live-scoring-design.md
-- ============================================================
BEGIN;

-- Feature flag (défaut éteint) + désignation au lobby
INSERT INTO public.app_config (key, value) VALUES ('live_scoring_enabled', 'false')
  ON CONFLICT (key) DO NOTHING;
ALTER TABLE public.open_games ADD COLUMN IF NOT EXISTS live_scorer_id uuid REFERENCES public.players(id);

CREATE TABLE IF NOT EXISTS public.live_match_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id       uuid NOT NULL UNIQUE REFERENCES public.open_games(id),
  scorer_id     uuid NOT NULL REFERENCES public.players(id),
  team1_ids     uuid[] NOT NULL,
  team2_ids     uuid[] NOT NULL,
  current_state jsonb NOT NULL DEFAULT '{"sets":[{"t1":0,"t2":0}],"setsWon":{"t1":0,"t2":0},"finished":false,"openContests":0}',
  status        text NOT NULL DEFAULT 'live' CHECK (status IN ('live','finished','abandoned')),
  contest_count int  NOT NULL DEFAULT 0,
  match_id      uuid REFERENCES public.matches(id), -- posé par finalize (idempotence)
  started_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.live_match_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.live_match_sessions(id) ON DELETE CASCADE,
  seq        int  NOT NULL,
  author_id  uuid NOT NULL REFERENCES public.players(id),
  event_type text NOT NULL CHECK (event_type IN ('game_won','undo','contest','contest_resolved','scorer_changed','finished','abandoned')),
  payload    jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, seq)
);

-- RLS : lecture pour les 4 participants ; écriture UNIQUEMENT via RPC (security definer).
ALTER TABLE public.live_match_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_match_events   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS live_sessions_read ON public.live_match_sessions;
CREATE POLICY live_sessions_read ON public.live_match_sessions FOR SELECT TO authenticated
  USING (auth.uid() = ANY(team1_ids || team2_ids));

DROP POLICY IF EXISTS live_events_read ON public.live_match_events;
CREATE POLICY live_events_read ON public.live_match_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.live_match_sessions s
                 WHERE s.id = session_id AND auth.uid() = ANY(s.team1_ids || s.team2_ids)));

-- Realtime sur les sessions (même mécanique que realtime_game_participants.sql)
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_match_sessions;

-- ── Rejeu du journal (COPIE de lib/liveScore.ts replayEvents) ──────────────
CREATE OR REPLACE FUNCTION public.fn_live_replay(p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ev RECORD;
  effective int[] := '{}';           -- équipes des game_won effectifs, dans l'ordre
  open_contests int := 0;
  is_finished boolean := false;
  sets jsonb := '[]';
  cur_t1 int := 0; cur_t2 int := 0;
  sw1 int := 0; sw2 int := 0;
  team int; mx int; diff int;
BEGIN
  FOR ev IN SELECT event_type, payload FROM public.live_match_events
            WHERE session_id = p_session_id ORDER BY seq LOOP
    IF ev.event_type = 'game_won' THEN
      effective := effective || (ev.payload->>'team')::int;
    ELSIF ev.event_type = 'undo' THEN
      IF array_length(effective, 1) IS NOT NULL THEN
        effective := effective[1:array_length(effective,1)-1];
      END IF;
    ELSIF ev.event_type = 'contest' THEN
      open_contests := open_contests + 1;
    ELSIF ev.event_type = 'contest_resolved' THEN
      open_contests := greatest(0, open_contests - 1);
    ELSIF ev.event_type = 'finished' THEN
      is_finished := true;
    END IF;
  END LOOP;

  FOREACH team IN ARRAY effective LOOP
    IF team = 1 THEN cur_t1 := cur_t1 + 1; ELSE cur_t2 := cur_t2 + 1; END IF;
    mx := greatest(cur_t1, cur_t2); diff := abs(cur_t1 - cur_t2);
    IF (mx >= 6 AND diff >= 2) OR mx = 7 THEN
      sets := sets || jsonb_build_object('t1', cur_t1, 't2', cur_t2);
      IF cur_t1 > cur_t2 THEN sw1 := sw1 + 1; ELSE sw2 := sw2 + 1; END IF;
      cur_t1 := 0; cur_t2 := 0;
    END IF;
  END LOOP;
  sets := sets || jsonb_build_object('t1', cur_t1, 't2', cur_t2); -- set courant

  RETURN jsonb_build_object(
    'sets', sets,
    'setsWon', jsonb_build_object('t1', sw1, 't2', sw2),
    'finished', is_finished,
    'openContests', open_contests);
END; $$;

-- NB : dans lib/liveScore.ts, un undo "saute les jeux déjà annulés" via une
-- pile ; ici effective ne contient QUE des game_won effectifs, donc retirer
-- le dernier élément est équivalent.

-- ── Démarrage ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_live_session(p_game_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_flag text; v_session uuid; v_t1 uuid[]; v_t2 uuid[];
BEGIN
  SELECT value INTO v_flag FROM public.app_config WHERE key = 'live_scoring_enabled';
  IF coalesce(v_flag, 'false') <> 'true' THEN RAISE EXCEPTION 'live_scoring_disabled'; END IF;

  -- Équipes depuis les participants confirmés (team_side 1/2, même source que le lobby)
  SELECT array_agg(player_id) FILTER (WHERE team_side = 1),
         array_agg(player_id) FILTER (WHERE team_side = 2)
    INTO v_t1, v_t2
    FROM public.game_participants
   WHERE game_id = p_game_id AND status = 'accepted';
  IF coalesce(array_length(v_t1,1),0) <> 2 OR coalesce(array_length(v_t2,1),0) <> 2 THEN
    RAISE EXCEPTION 'teams_incomplete';
  END IF;
  IF NOT (auth.uid() = ANY(v_t1 || v_t2)) THEN RAISE EXCEPTION 'not_a_participant'; END IF;

  INSERT INTO public.live_match_sessions (game_id, scorer_id, team1_ids, team2_ids)
  VALUES (p_game_id, auth.uid(), v_t1, v_t2)
  ON CONFLICT (game_id) DO NOTHING
  RETURNING id INTO v_session;
  IF v_session IS NULL THEN
    SELECT id INTO v_session FROM public.live_match_sessions
     WHERE game_id = p_game_id AND status = 'live';
    IF v_session IS NULL THEN RAISE EXCEPTION 'session_already_closed'; END IF;
  END IF;
  RETURN v_session;
END; $$;

-- ── Événement ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_live_event(p_session_id uuid, p_event_type text, p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s RECORD; v_state jsonb;
BEGIN
  SELECT * INTO s FROM public.live_match_sessions WHERE id = p_session_id FOR UPDATE;
  IF s IS NULL THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF s.status <> 'live' THEN RAISE EXCEPTION 'session_not_live'; END IF;
  IF NOT (auth.uid() = ANY(s.team1_ids || s.team2_ids)) THEN RAISE EXCEPTION 'not_a_participant'; END IF;
  -- Événements de score : scoreur uniquement
  IF p_event_type IN ('game_won','undo','finished','abandoned','contest_resolved')
     AND auth.uid() <> s.scorer_id THEN
    RAISE EXCEPTION 'not_the_scorer';
  END IF;
  IF p_event_type NOT IN ('game_won','undo','contest','contest_resolved','abandoned') THEN
    RAISE EXCEPTION 'invalid_event_type'; -- finished passe par finalize, scorer_changed par take_over
  END IF;

  INSERT INTO public.live_match_events (session_id, seq, author_id, event_type, payload)
  VALUES (p_session_id,
          coalesce((SELECT max(seq) FROM public.live_match_events WHERE session_id = p_session_id), 0) + 1,
          auth.uid(), p_event_type, p_payload);

  v_state := public.fn_live_replay(p_session_id);
  UPDATE public.live_match_sessions
     SET current_state = v_state,
         contest_count = (v_state->>'openContests')::int,
         status = CASE WHEN p_event_type = 'abandoned' THEN 'abandoned' ELSE status END,
         updated_at = now()
   WHERE id = p_session_id;
  RETURN v_state;
END; $$;

-- ── Reprise du rôle ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.take_over_scoring(p_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s RECORD;
BEGIN
  SELECT * INTO s FROM public.live_match_sessions WHERE id = p_session_id FOR UPDATE;
  IF s IS NULL OR s.status <> 'live' THEN RAISE EXCEPTION 'session_not_live'; END IF;
  IF NOT (auth.uid() = ANY(s.team1_ids || s.team2_ids)) THEN RAISE EXCEPTION 'not_a_participant'; END IF;
  IF auth.uid() = s.scorer_id THEN RETURN; END IF;
  INSERT INTO public.live_match_events (session_id, seq, author_id, event_type, payload)
  VALUES (p_session_id,
          coalesce((SELECT max(seq) FROM public.live_match_events WHERE session_id = p_session_id), 0) + 1,
          auth.uid(), 'scorer_changed', jsonb_build_object('from', s.scorer_id));
  UPDATE public.live_match_sessions SET scorer_id = auth.uid(), updated_at = now() WHERE id = p_session_id;
END; $$;

-- ── Finalisation (idempotente) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_live_session(p_session_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s RECORD; g RECORD; v_state jsonb; v_score text;
  sw1 int; sw2 int; w uuid[]; l uuid[]; v_match uuid;
BEGIN
  SELECT * INTO s FROM public.live_match_sessions WHERE id = p_session_id FOR UPDATE;
  IF s IS NULL THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF s.match_id IS NOT NULL THEN RETURN s.match_id; END IF; -- déjà finalisée
  IF s.status <> 'live' THEN RAISE EXCEPTION 'session_not_live'; END IF;
  IF auth.uid() <> s.scorer_id THEN RAISE EXCEPTION 'not_the_scorer'; END IF;

  v_state := public.fn_live_replay(p_session_id);
  sw1 := (v_state->'setsWon'->>'t1')::int; sw2 := (v_state->'setsWon'->>'t2')::int;
  IF sw1 = sw2 THEN RAISE EXCEPTION 'no_winner'; END IF;
  -- Parité avec score-entry : un match compte au moins 2 sets terminés
  IF sw1 + sw2 < 2 THEN RAISE EXCEPTION 'not_enough_sets'; END IF;

  -- score_text : sets terminés uniquement (même format que score-entry : "6-3, 6-4")
  SELECT string_agg((e->>'t1') || '-' || (e->>'t2'), ', ')
    INTO v_score
    FROM jsonb_array_elements(v_state->'sets') WITH ORDINALITY AS t(e, i)
   WHERE i < jsonb_array_length(v_state->'sets'); -- exclut le set courant (vide à la fin)

  IF sw1 > sw2 THEN w := s.team1_ids; l := s.team2_ids; ELSE w := s.team2_ids; l := s.team1_ids; END IF;
  SELECT * INTO g FROM public.open_games WHERE id = s.game_id;

  INSERT INTO public.matches (winner_id, winner_id_2, loser_id, loser_id_2, score_text,
                              status, created_by, game_id, game_format, is_challenge, stake_multiplier)
  VALUES (w[1], w[2], l[1], l[2], v_score, 'pending', s.scorer_id, s.game_id,
          coalesce(g.game_format, 'competitive'), coalesce(g.is_challenge, false), coalesce(g.stake_multiplier, 1.0))
  RETURNING id INTO v_match;

  -- 0 contestation ouverte → validation immédiate PAR LE TRIGGER EXISTANT
  -- (trg_distribute_elo_on_validate : AFTER UPDATE, bascule vers 'validated').
  IF s.contest_count = 0 THEN
    UPDATE public.matches SET status = 'validated' WHERE id = v_match;
  END IF;

  INSERT INTO public.live_match_events (session_id, seq, author_id, event_type, payload)
  VALUES (p_session_id,
          coalesce((SELECT max(seq) FROM public.live_match_events WHERE session_id = p_session_id), 0) + 1,
          auth.uid(), 'finished', jsonb_build_object('match_id', v_match));
  UPDATE public.live_match_sessions
     SET status = 'finished', match_id = v_match, current_state = public.fn_live_replay(p_session_id), updated_at = now()
   WHERE id = p_session_id;
  UPDATE public.open_games SET status = 'closed' WHERE id = s.game_id;
  RETURN v_match;
END; $$;

-- ── Filet : sessions zombies > 6 h → abandoned (appelé par le cron existant
-- d'auto-validation, ou manuellement — cf. auto_validate_pending_scores.sql) ──
CREATE OR REPLACE FUNCTION public.abandon_stale_live_sessions()
RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH upd AS (
    UPDATE public.live_match_sessions
       SET status = 'abandoned', updated_at = now()
     WHERE status = 'live' AND started_at < now() - interval '6 hours'
     RETURNING 1)
  SELECT count(*)::int FROM upd;
$$;

COMMIT;
```

- [ ] **Step 2: Relecture croisée TS ↔ SQL**

Vérifier ligne à ligne que `fn_live_replay` et `replayEvents` encodent les mêmes règles (clôture de set `(mx>=6 AND diff>=2) OR mx=7`, undo = retrait du dernier effectif, contests avec plancher 0). Vérifier que `game_participants.team_side` et `status='accepted'` sont les bons noms de colonnes/valeurs : `grep -rn "team_side" lib/ | head` et ajuster si la valeur de statut confirmé diffère (cf. `lib/games` / `isConfirmedInGame`). Vérifier aussi que `players.id = auth.uid()` dans ce schéma (regarder une policy RLS existante comparant `auth.uid()` à un id joueur, ex. dans `enable_rls_phase1.sql`) — sinon insérer la résolution utilisée par ces policies partout où les RPC comparent `auth.uid()` aux ids d'équipe.

- [ ] **Step 3: Signaler**

La migration n'est PAS appliquée. La lister dans le message final à l'utilisateur (avec rappel : l'appliquer AVANT d'activer le flag ; sans elle, l'app reste inchangée).

---

### Task 4: Client `lib/liveSession.ts` (flag, RPC, realtime, file offline)

**Files:**
- Create: `lib/liveSession.ts`

**Interfaces:**
- Consumes: `replayEvents`, `LiveState`, `LiveEvent` (Task 2) ; RPC (Task 3) ; `supabase` (`lib/supabase`).
- Produces (consommé par Tasks 5/6/7) :

```ts
export type LiveSession = { id: string; game_id: string; scorer_id: string; team1_ids: string[]; team2_ids: string[]; current_state: LiveState; status: 'live' | 'finished' | 'abandoned'; contest_count: number; match_id: string | null };
export async function getLiveScoringEnabled(): Promise<boolean>;              // app_config, cache mémoire (pattern getPromotionWindowMinutes)
export async function fetchLiveSession(gameId: string): Promise<LiveSession | null>;
export async function startLiveSession(gameId: string): Promise<string>;      // RPC start_live_session
export async function sendLiveEvent(sessionId: string, type: 'game_won' | 'undo' | 'contest' | 'contest_resolved' | 'abandoned', payload?: object): Promise<void>; // file offline + flush
export function subscribeLiveSession(sessionId: string, onChange: (s: LiveSession) => void): () => void; // realtime, retourne l'unsubscribe
export async function takeOverScoring(sessionId: string): Promise<void>;
export async function finalizeLiveSession(sessionId: string): Promise<string>; // match id
export function getPendingCount(sessionId: string): number;                   // taille file offline (affichage « X taps en attente »)
```

- [ ] **Step 1: Implémenter**

```ts
// Client du score en direct : flag, RPC, realtime, et file offline du scoreur.
// Le scoreur est l'UNIQUE écrivain ⇒ rejouer sa file locale dans l'ordre au
// retour du réseau est sûr (pas de conflit possible). File en mémoire module,
// persistée AsyncStorage pour survivre à un kill de l'app.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { LiveState } from './liveScore';

export type LiveSession = {
  id: string; game_id: string; scorer_id: string;
  team1_ids: string[]; team2_ids: string[];
  current_state: LiveState; status: 'live' | 'finished' | 'abandoned';
  contest_count: number; match_id: string | null;
};

let _flagCache: boolean | null = null;
export async function getLiveScoringEnabled(): Promise<boolean> {
  if (_flagCache != null) return _flagCache;
  const { data } = await supabase.from('app_config').select('value').eq('key', 'live_scoring_enabled').maybeSingle();
  _flagCache = data?.value === 'true';
  return _flagCache;
}

export async function fetchLiveSession(gameId: string): Promise<LiveSession | null> {
  const { data } = await supabase.from('live_match_sessions').select('*').eq('game_id', gameId).maybeSingle();
  return (data as LiveSession | null) ?? null;
}

export async function startLiveSession(gameId: string): Promise<string> {
  const { data, error } = await supabase.rpc('start_live_session', { p_game_id: gameId });
  if (error) throw error;
  return data as string;
}

// ── File offline (scoreur) ───────────────────────────────────────────────
type QueuedEvent = { type: string; payload: object };
const queues = new Map<string, QueuedEvent[]>();
let flushing = false;
const storageKey = (sid: string) => `live-queue:${sid}`;

async function flush(sessionId: string): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const q = queues.get(sessionId) ?? [];
    while (q.length > 0) {
      const e = q[0];
      const { error } = await supabase.rpc('apply_live_event', {
        p_session_id: sessionId, p_event_type: e.type, p_payload: e.payload,
      });
      if (error) {
        // Erreurs métier (not_the_scorer, session_not_live…) : jeter l'événement,
        // il n'a plus de sens. Erreurs réseau : garder, on réessaiera.
        const msg = String(error.message ?? '');
        const business = ['not_the_scorer', 'session_not_live', 'session_not_found', 'invalid_event_type', 'not_a_participant'];
        if (business.some(b => msg.includes(b))) q.shift();
        else break;
      } else q.shift();
      try { await AsyncStorage.setItem(storageKey(sessionId), JSON.stringify(q)); } catch {}
    }
  } finally { flushing = false; }
}

export async function sendLiveEvent(
  sessionId: string,
  type: 'game_won' | 'undo' | 'contest' | 'contest_resolved' | 'abandoned',
  payload: object = {},
): Promise<void> {
  if (!queues.has(sessionId)) {
    // Recharge une éventuelle file persistée (app relancée)
    try {
      const raw = await AsyncStorage.getItem(storageKey(sessionId));
      queues.set(sessionId, raw ? JSON.parse(raw) : []);
    } catch { queues.set(sessionId, []); }
  }
  const q = queues.get(sessionId)!;
  q.push({ type, payload });
  try { await AsyncStorage.setItem(storageKey(sessionId), JSON.stringify(q)); } catch {}
  await flush(sessionId);
}

export function getPendingCount(sessionId: string): number {
  return queues.get(sessionId)?.length ?? 0;
}

export function subscribeLiveSession(sessionId: string, onChange: (s: LiveSession) => void): () => void {
  const suffix = Math.random().toString(36).slice(2, 8);
  const ch = supabase
    .channel(`live-session:${sessionId}:${suffix}`)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'live_match_sessions', filter: `id=eq.${sessionId}` },
      payload => onChange(payload.new as LiveSession))
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

export async function takeOverScoring(sessionId: string): Promise<void> {
  const { error } = await supabase.rpc('take_over_scoring', { p_session_id: sessionId });
  if (error) throw error;
}

export async function finalizeLiveSession(sessionId: string): Promise<string> {
  await flush(sessionId); // vider la file avant de finaliser
  const { data, error } = await supabase.rpc('finalize_live_session', { p_session_id: sessionId });
  if (error) throw error;
  return data as string;
}
```

- [ ] **Step 2: Dépendance AsyncStorage**

Run: `grep "@react-native-async-storage" package.json`. Si absent : `npx expo install @react-native-async-storage/async-storage` (⚠️ ajoute du natif → nécessitera un rebuild APK ; le signaler à l'utilisateur. Si on veut l'éviter, remplacer la persistance par la file mémoire seule et le noter en commentaire).

- [ ] **Step 3: Vérifier**

Run: `npx tsc --noEmit` → rien de nouveau. `npm test` → toujours vert.

---

### Task 5: Bloc lobby « Score en direct » (désignation)

**Files:**
- Create: `components/live/LiveLobbyBlock.tsx`
- Modify: `app/(tabs)/GameDetailsSheet.tsx` (montage du bloc)

**Interfaces:**
- Consumes: `getLiveScoringEnabled`, `fetchLiveSession`, `startLiveSession` (Task 4).
- Produces: `<LiveLobbyBlock game={...} me={...} onStarted={(sessionId) => ...} />`.

- [ ] **Step 1: Composant**

```tsx
// Bloc « Score en direct » du détail de partie : désignation du scoreur
// (volontariat) + démarrage de la session dans la fenêtre H-15 → H+2h.
// Invisible si le flag admin est éteint ou si la partie n'est pas complète.
import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Colors, Fonts, FontSize, Radius } from '../../lib/theme';
import { getLiveScoringEnabled, fetchLiveSession, startLiveSession } from '../../lib/liveSession';

type Props = {
  gameId: string;
  meId: string;
  matchDate: string | null;        // open_games.match_date
  liveScorerId: string | null;     // open_games.live_scorer_id
  isComplete: boolean;             // 4 confirmés
  participants: { id: string; name: string }[];
  onChanged: () => void;           // re-fetch de la partie par le parent
};

export function LiveLobbyBlock({ gameId, meId, matchDate, liveScorerId, isComplete, participants, onChanged }: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { getLiveScoringEnabled().then(setEnabled); }, []);
  if (!enabled || !isComplete) return null;

  const scorer = participants.find(p => p.id === liveScorerId) ?? null;
  const now = Date.now();
  const start = matchDate ? new Date(matchDate).getTime() : null;
  const inWindow = start != null && now >= start - 15 * 60_000 && now <= start + 2 * 3_600_000;

  const volunteer = async (id: string | null) => {
    setBusy(true);
    const { error } = await supabase.from('open_games').update({ live_scorer_id: id }).eq('id', gameId);
    setBusy(false);
    if (error) Alert.alert('Erreur', error.message); else onChanged();
  };

  const startLive = async () => {
    setBusy(true);
    try {
      const sessionId = await startLiveSession(gameId);
      router.push(`/live/${sessionId}` as any);
    } catch (e: any) {
      Alert.alert('Impossible de démarrer', String(e?.message ?? e));
    } finally { setBusy(false); }
  };

  return (
    <View style={{ backgroundColor: Colors.bgCard, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, padding: 14, gap: 8 }}>
      <Text style={{ fontSize: FontSize.sm, fontWeight: '900', color: Colors.textPrimary, fontFamily: Fonts.uiBlack }}>🔴 Score en direct</Text>
      {scorer == null ? (
        <>
          <Text style={{ fontSize: FontSize.xs, color: Colors.textMuted }}>
            Un joueur peut suivre le score jeu par jeu pendant le match. Les trois autres le verront en direct.
          </Text>
          <TouchableOpacity disabled={busy} onPress={() => volunteer(meId)} activeOpacity={0.8}
            style={{ backgroundColor: Colors.primary, borderRadius: Radius.md, padding: 12, alignItems: 'center' }}>
            <Text style={{ color: Colors.textOnDark, fontWeight: '900', fontFamily: Fonts.uiBlack }}>Je scorerai ce match</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={{ fontSize: FontSize.xs, color: Colors.textSecondary }}>
            {scorer.id === meId ? 'Tu scoreras ce match.' : `${scorer.name} scorera ce match.`}
          </Text>
          {scorer.id === meId && (
            <TouchableOpacity disabled={busy} onPress={() => volunteer(null)} activeOpacity={0.7}>
              <Text style={{ fontSize: FontSize.xs, color: Colors.textMuted, textDecorationLine: 'underline' }}>Me désister</Text>
            </TouchableOpacity>
          )}
          {scorer.id === meId && inWindow && (
            <TouchableOpacity disabled={busy} onPress={startLive} activeOpacity={0.8}
              style={{ backgroundColor: Colors.primary, borderRadius: Radius.md, padding: 12, alignItems: 'center' }}>
              <Text style={{ color: Colors.textOnDark, fontWeight: '900', fontFamily: Fonts.uiBlack }}>Démarrer le score en direct</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}
```

- [ ] **Step 2: Montage dans le détail de partie**

Dans `app/(tabs)/GameDetailsSheet.tsx` : lire le fichier, repérer la section qui rend la liste des participants d'une partie **confirmée** où je suis engagé, et monter `<LiveLobbyBlock />` juste en dessous avec les props tirées de l'objet game déjà chargé (`game.id`, `game.match_date`, `game.live_scorer_id` — ajouter ce champ au select si la requête liste les colonnes —, `isComplete` via le helper existant de complétude type `freeSpots() === 0`, participants confirmés via `occupiesSpot`/`isConfirmedInGame` de `lib/games`, jamais un check `status` brut). `onChanged` = le refetch existant de la sheet. Si une session `live` existe déjà (`fetchLiveSession`), remplacer le bloc par un bouton « ▶ Suivre le match en direct » → `router.push('/live/' + session.id)`.

- [ ] **Step 3: Vérifier**

Run: `npx tsc --noEmit` → rien de nouveau. Test visuel : flag éteint (défaut) → rien ne s'affiche.

---

### Task 6: Écran live `app/live/[sessionId].tsx`

**Files:**
- Create: `app/live/[sessionId].tsx`
- Modify: `app/_layout.tsx` (déclarer `<Stack.Screen name="live/[sessionId]" options={{ presentation: 'card' }} />` à côté des autres écrans de pile)

**Interfaces:**
- Consumes: tout `lib/liveSession.ts` (Task 4), `replayEvents`/`isMatchDecided`/`buildScoreText` (Task 2), `usePlayer` (`hooks/usePlayer`), `notifyPlayers` (`lib/notify`).

- [ ] **Step 1: Installer keep-awake**

Run: `grep "expo-keep-awake" package.json` ; si absent : `npx expo install expo-keep-awake` (JS pur côté usage, pas de rebuild nécessaire — il est déjà dans le runtime Expo).

- [ ] **Step 2: Écran**

Structure (un seul fichier, ~300 lignes, style scoreboard existant — s'inspirer de `app/score-entry.tsx` pour les styles) :

```tsx
// Écran du score en direct : scoreur (2 gros boutons) ou lecteur (realtime),
// selon session.scorer_id === me. Source de rendu : session.current_state
// (serveur) recouverte par l'état optimiste local du scoreur (file offline).
import { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';   // si absent du package.json : npx expo install expo-haptics ; sinon retirer les appels
import { supabase } from '../../lib/supabase';
import { usePlayer } from '../../hooks/usePlayer';
import { notifyPlayers } from '../../lib/notify';
import { Colors, Fonts, FontSize, Radius, Spacing } from '../../lib/theme';
import { isMatchDecided, buildScoreText, type LiveState } from '../../lib/liveScore';
import {
  type LiveSession, fetchLiveSession, sendLiveEvent, subscribeLiveSession,
  takeOverScoring, finalizeLiveSession, getPendingCount,
} from '../../lib/liveSession';
```

Comportements à implémenter (chacun est court) :

1. **Chargement** : `useLocalSearchParams()` → `sessionId` ; au montage, `select` direct de la session par id (`supabase.from('live_match_sessions').select('*').eq('id', sessionId).single()`) + `select id,name` des 4 joueurs (`players`) pour les prénoms d'équipes (`team1_ids`/`team2_ids`). `useKeepAwake()` au top.
2. **Realtime** : `subscribeLiveSession(sessionId, setSession)` dans un `useEffect` avec cleanup. Toute mise à jour serveur remplace l'état affiché (les lecteurs) ; chez le scoreur, l'état optimiste local prime tant que `getPendingCount(sessionId) > 0`.
3. **Optimistic UI scoreur** : garder en state la liste locale des événements envoyés (`LiveEvent[]` reconstruite du `current_state` initial + taps) et afficher `replayEvents(localEvents)`. Chaque tap : `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)`, ajout local, puis `sendLiveEvent(sessionId, 'game_won', { team })` (fire and forget, la file gère le réseau). Undo : événement `undo` (local + envoi). Afficher « ⏳ {n} en attente de réseau » si `getPendingCount() > 0`.
4. **Scoreboard** : sets terminés en petites cartes, set courant en très gros (`Fonts.welcome`, ~64pt — appliquer la règle projet : `numberOfLines={1}` + `adjustsFontSizeToFit` + `paddingRight` sur les titres italiques). Prénoms d'équipe : `"Karim & Mina"` depuis les données joueurs.
5. **Deux gros boutons** (scoreur seulement) : pleine largeur, hauteur ~96, « 🎾 Jeu {prénoms équipe 1} » / « Jeu {prénoms équipe 2} ». Sous eux : ↩︎ Annuler (désactivé si aucun jeu), pastille ⚠️ `contest_count`, menu ⋯ via `Alert.alert` avec options « Terminer maintenant » (ouvre l'écran de fin) et « Annuler le suivi live » (`sendLiveEvent('abandoned')` + `router.back()` ; confirmation destructive avant).
6. **Lecteur** : mêmes scoreboard sans boutons de saisie ; badge « EN DIRECT » ; boutons « Contester ce score » (→ `Alert.alert` de choix : « Le dernier jeu » / « Un jeu plus ancien » → envoie `contest` avec `target_seq` du dernier `game_won` connu ou sans target ; simple pour la v1) et « Reprendre le score » (confirmation → `takeOverScoring`). Après `scorer_changed` reçu par realtime, les rôles basculent automatiquement (le rendu dérive de `session.scorer_id`).
7. **Résolution de contestation (scoreur)** : si `contest_count > 0`, bandeau jaune « ⚠️ {n} contestation(s) — corrige avec ↩︎ ou maintiens » + bouton « Marquer comme résolu » → `sendLiveEvent('contest_resolved')`.
8. **Fin détectée** : quand `isMatchDecided(state)` non-null ET scoreur → carte de fin en bas : « Victoire {prénoms} — {buildScoreText(state)} » avec 3 boutons : **Valider le score** → `finalizeLiveSession` puis `notifyPlayers({ playerIds: les3autres, title: '✅ Score final', body: 'Victoire ' + prénoms + ' — ' + score, data: { type: 'match', matchId } })` puis `Alert` de succès + `router.back()` ; **Continuer un set** → masque la carte (state local `funSetAck = setsJoués`) ; **↩︎ Annuler** → undo. Si `finalize` échoue avec `no_winner` (2-2), `Alert` « Pas de vainqueur — joue un set décisif ou annule le dernier set » ; avec `not_enough_sets` (« Terminer maintenant » trop tôt), `Alert` « Un match compte au moins 2 sets terminés ».
9. **Session terminée/abandonnée** (au chargement ou par realtime) : écran statique « Match terminé {score} » / « Suivi abandonné » + bouton retour.

- [ ] **Step 3: Vérifier**

Run: `npx tsc --noEmit` → rien de nouveau. `npm test` → vert.

---

### Task 7: Points d'entrée (badge LIVE, bannière, masquage score-entry)

**Files:**
- Modify: `components/home/UpcomingMatchCard.tsx` (badge « 🔴 LIVE » + navigation vers l'écran live si session active)
- Modify: `app/score-entry.tsx` (masquer une partie en live actif)

**Interfaces:**
- Consumes: `fetchLiveSession`, `getLiveScoringEnabled` (Task 4).

- [ ] **Step 1: Badge sur la carte « Prochain match »**

Dans `components/home/UpcomingMatchCard.tsx` : lire le fichier ; au montage (le gameId de la prochaine partie est déjà là), si `await getLiveScoringEnabled()` alors `fetchLiveSession(gameId)` ; si `status === 'live'`, afficher une pastille « 🔴 LIVE » (mêmes styles que la pastille nature de match existante) et faire pointer le press de la carte vers `/live/{session.id}` au lieu de la destination habituelle.

- [ ] **Step 2: Masquage dans score-entry**

Dans `app/score-entry.tsx` : là où la liste des parties à scorer est construite, pour chaque partie appeler `fetchLiveSession(game.id)` (en parallèle, `Promise.all`) et si une session `live` existe, remplacer la carte par une ligne inerte « 🔴 Score en direct en cours — {lieu} » qui navigue vers `/live/{id}`. Une session `finished` a déjà fermé la partie (RPC), donc rien à faire pour ce cas. Garder ce code DERRIÈRE le flag (`getLiveScoringEnabled()`) pour zéro requête supplémentaire flag éteint.

- [ ] **Step 3: Vérifier**

Run: `npx tsc --noEmit` → rien de nouveau. Flag éteint : aucune requête `live_match_sessions` émise (vérifier en relisant le code : chaque appel est gardé par le flag).

---

### Task 8: Toggle admin

**Files:**
- Modify: `app/(tabs)/admin.tsx` (fonction `SettingsTab`, ~ligne 1217)

**Interfaces:**
- Consumes: pattern `app_config` upsert existant (bloc `defi_promotion_window_minutes`, lignes 1216-1239).

- [ ] **Step 1: Ajouter le réglage**

Dans `SettingsTab` : un state `const [liveOn, setLiveOn] = useState(false);`, chargé dans le `load()` existant :

```ts
    const { data: live } = await supabase.from('app_config').select('value').eq('key', 'live_scoring_enabled').maybeSingle();
    setLiveOn(live?.value === 'true');
```

Et après la carte « Défis — file d'attente », une carte identique :

```tsx
      <View style={{ backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 16, gap: 10 }}>
        <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>Score en direct</Text>
        <Text style={{ fontSize: 12, color: Colors.textMuted, lineHeight: 17 }}>
          Active le suivi du score jeu par jeu pendant les matchs (scoreur désigné au lobby, lecture en temps réel). Éteint, la feature est totalement invisible.
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.textPrimary }}>{liveOn ? 'Activé' : 'Désactivé'}</Text>
          <Switch value={liveOn} onValueChange={async (v) => {
            setLiveOn(v);
            const { error } = await supabase.from('app_config')
              .upsert({ key: 'live_scoring_enabled', value: v ? 'true' : 'false', updated_at: new Date().toISOString() }, { onConflict: 'key' });
            if (error) { setLiveOn(!v); Alert.alert('Erreur', error.message); }
          }} />
        </View>
      </View>
```

(Ajouter `Switch` à l'import `react-native` du fichier s'il n'y est pas.)

- [ ] **Step 2: Vérifier**

Run: `npx tsc --noEmit` → rien de nouveau. Note : le cache client `_flagCache` fait qu'un changement de flag est vu au prochain démarrage de l'app — acceptable (documenté dans le texte du réglage si besoin).

---

### Task 9: Vérification finale et protocole de test manuel

**Files:** aucun (vérification).

- [ ] **Step 1: Suite complète**

Run: `npm test` (tous verts) puis `npx tsc --noEmit` (aucune erreur nouvelle sur les fichiers créés/modifiés : `lib/liveScore.ts`, `lib/liveSession.ts`, `components/live/LiveLobbyBlock.tsx`, `app/live/[sessionId].tsx`, `app/(tabs)/GameDetailsSheet.tsx`, `app/(tabs)/admin.tsx`, `components/home/UpcomingMatchCard.tsx`, `app/score-entry.tsx`, `app/_layout.tsx`).

- [ ] **Step 2: Récapitulatif à remettre à l'utilisateur**

Le message final DOIT contenir :
1. **Migration à appliquer** : `supabase/migrations/live_scoring.sql` (SQL editor Supabase) — AVANT d'activer le flag. Rien ne change tant qu'elle n'est pas appliquée ET que le flag est éteint. Planifier aussi `abandon_stale_live_sessions()` dans pg_cron (ex. toutes les heures, au même endroit que le cron d'auto-validation des scores).
2. **Rebuild APK nécessaire ?** oui si `@react-native-async-storage/async-storage` a été ajouté en Task 4 (sinon EAS Update suffit).
3. **Protocole de test à deux téléphones** (flag activé via Panel Arbitre → Réglages) :
   - Créer une partie complète (4 confirmés) avec date dans la fenêtre H−15.
   - Tél. A : « Je scorerai » → « Démarrer le score en direct » ; tél. B (autre participant) : ouvrir le détail → « Suivre le match en direct ».
   - A tape 6 jeux équipe 1 → B voit le set 6-0 se fermer en direct.
   - B « Contester ce score » → A voit la pastille ⚠️ ; A corrige (↩︎ + re-saisie) puis « Marquer comme résolu ».
   - A mène 2 sets → carte de fin → « Continuer un set » (vérifier le set fun) puis re-fin → « Valider le score ».
   - Vérifier : ligne `matches` en `validated` (0 contestation) avec `score_text` correct, ELO mis à jour, partie fermée, notification reçue sur B.
   - Refaire un match avec une contestation NON résolue → vérifier `matches` en `pending` (flux classique).
   - Mode avion sur A pendant 2 jeux → « ⏳ en attente » → couper le mode avion → B rattrape.
   - B « Reprendre le score » → A bascule lecteur, B saisit.
