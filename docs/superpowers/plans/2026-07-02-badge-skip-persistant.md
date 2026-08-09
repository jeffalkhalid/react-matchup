# Passer un match sans badge = définitif — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre « Passer sans badge » persistant : un match passé (ou soumis sans badge) ne réapparaît plus jamais dans la notif « Distribue des badges ».

**Architecture:** Nouvelle table `badge_prompt_skips(player_id, match_id)` qui enregistre le refus explicite. Les deux lecteurs qui calculent la liste des matchs à récompenser (`lib/notifications.ts` pour la cloche, `app/(tabs)/index.tsx` pour la modale) excluent les matchs skippés, en plus des matchs déjà votés. La modale écrit une ligne skip sur « Passer » et sur « Envoyer » avec 0 sélection.

**Tech Stack:** React Native / Expo, TypeScript, Supabase (Postgres + RLS). Spec : `docs/superpowers/specs/2026-07-02-badge-skip-persistant-design.md`.

## Global Constraints

- **Pas de commit automatique.** L'utilisateur commite lui-même. Les tâches s'arrêtent après vérification `tsc`.
- **Vérification = `npx tsc --noEmit`** (aucun runner de tests unitaires dans ce projet) + vérif device manuelle en fin de plan.
- **Migrations non timestampées**, appliquées à la main en prod (comme les autres dans `supabase/migrations/`).
- **RLS obligatoire** sur toute nouvelle table, calquée sur `reputation_votes` via `public.current_player_id()` / `public.is_app_admin()`.
- **Ne jamais insérer de ligne sentinelle dans `reputation_votes`** (pollue badges reçus, achievements, et déclenche le trigger d'activité Communauté).
- **Cohérence des deux lecteurs :** `unvotedCount` (notifications.ts) et `pendingBadge` (index.tsx) doivent appliquer EXACTEMENT le même filtre.

---

### Task 1 : Migration `badge_prompt_skips`

**Files:**
- Create: `react-matchup/supabase/migrations/badge_prompt_skips.sql`

**Interfaces:**
- Produces: table `public.badge_prompt_skips(player_id uuid, match_id uuid, created_at timestamptz)`, PK `(player_id, match_id)`, RLS activée. Lue par les tâches 2 et 3 via `.from('badge_prompt_skips').select('match_id').eq('player_id', <id>)` et écrite via `.insert({ player_id, match_id })`.

- [ ] **Step 1 : Écrire la migration**

Créer `react-matchup/supabase/migrations/badge_prompt_skips.sql` :

```sql
-- Persiste le choix « je passe ce match sans donner de badge ».
-- Sans cette trace, la notif « Distribue des badges » se recalcule depuis
-- reputation_votes et réapparaît à chaque chargement (passer n'était que local).
-- Table dédiée (PAS de ligne sentinelle dans reputation_votes, qui est lue
-- partout comme « badges reçus » et déclenche un trigger d'activité Communauté).

CREATE TABLE IF NOT EXISTS public.badge_prompt_skips (
  player_id  uuid NOT NULL,
  match_id   uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, match_id)
);

ALTER TABLE public.badge_prompt_skips ENABLE ROW LEVEL SECURITY;

-- Lecture publique (aucune donnée sensible ; calqué sur reputation_votes).
DROP POLICY IF EXISTS badge_skip_select ON public.badge_prompt_skips;
CREATE POLICY badge_skip_select ON public.badge_prompt_skips
  FOR SELECT USING (true);

-- Écriture réservée au joueur lui-même.
DROP POLICY IF EXISTS badge_skip_insert ON public.badge_prompt_skips;
CREATE POLICY badge_skip_insert ON public.badge_prompt_skips
  FOR INSERT TO authenticated
  WITH CHECK (player_id = public.current_player_id());

DROP POLICY IF EXISTS badge_skip_delete ON public.badge_prompt_skips;
CREATE POLICY badge_skip_delete ON public.badge_prompt_skips
  FOR DELETE TO authenticated
  USING (player_id = public.current_player_id() OR public.is_app_admin());
```

- [ ] **Step 2 : Vérifier la cohérence des policies**

Relire `react-matchup/supabase/migrations/enable_rls_phase1.sql:273-289` (bloc `reputation_votes`) et confirmer que les noms de helpers (`public.current_player_id()`, `public.is_app_admin()`) et la structure des policies sont identiques. Aucun outil à lancer — revue visuelle.

- [ ] **Step 3 : (manuel, hors session) appliquer en prod**

À appliquer à la main dans l'éditeur SQL Supabase quand l'utilisateur le décide. Noté dans le récap final du plan — ne pas bloquer les tâches suivantes dessus.

---

### Task 2 : Écriture — la modale enregistre le skip (`index.tsx`)

**Files:**
- Modify: `react-matchup/app/(tabs)/index.tsx` (helper `skipBadgeMatch`, `handleSubmitBadges` ~L391-405, bouton « Passer sans badge » ~L532-540)

**Interfaces:**
- Consumes: table `badge_prompt_skips` (Task 1), `player.id`, `badgeMatches`, `badgeModalMatch`, `supabase`.
- Produces: helper `skipBadgeMatch(matchId: string): Promise<void>` réutilisé par le bouton Passer et par `handleSubmitBadges` (cas 0 badge).

- [ ] **Step 1 : Ajouter le helper `skipBadgeMatch`**

Dans `react-matchup/app/(tabs)/index.tsx`, juste au-dessus de `handleSubmitBadges` (avant la ligne 391) :

```tsx
  // Passer un match : trace persistante pour que la notif ne revienne pas.
  const skipBadgeMatch = async (matchId: string) => {
    if (!player) return;
    await supabase
      .from('badge_prompt_skips')
      .upsert({ player_id: player.id, match_id: matchId }, { onConflict: 'player_id,match_id' });
  };
```

(`upsert` avec `onConflict` : passer deux fois le même match ne provoque pas d'erreur de clé dupliquée.)

- [ ] **Step 2 : Écrire un skip quand « Envoyer » ne contient aucun badge**

Dans `handleSubmitBadges` (L391-405), remplacer la ligne d'insertion conditionnelle actuelle :

```tsx
    if (inserts.length > 0) await supabase.from('reputation_votes').insert(inserts);
```

par :

```tsx
    if (inserts.length > 0) await supabase.from('reputation_votes').insert(inserts);
    else await skipBadgeMatch(badgeModalMatch.id);
```

Ainsi « Envoyer les badges » sans sélection = passer définitivement (au lieu de ne rien écrire).

- [ ] **Step 3 : Écrire un skip depuis le bouton « Passer sans badge »**

Remplacer le `onPress` du bouton « Passer sans badge » (L532-537) :

```tsx
                  <TouchableOpacity onPress={() => {
                      const rest = badgeMatches.filter(m => m.id !== badgeModalMatch?.id);
                      setBadgeMatches(rest);
                      if (rest.length > 0) openBadgeModal(rest[0]);
                      else { setBadgeModalMatch(null); setBadgeVotes({}); }
                    }}
```

par (capture l'id avant de vider l'état, puis persiste) :

```tsx
                  <TouchableOpacity onPress={() => {
                      const skippedId = badgeModalMatch?.id;
                      const rest = badgeMatches.filter(m => m.id !== skippedId);
                      setBadgeMatches(rest);
                      if (skippedId) skipBadgeMatch(skippedId);
                      if (rest.length > 0) openBadgeModal(rest[0]);
                      else { setBadgeModalMatch(null); setBadgeVotes({}); }
                    }}
```

- [ ] **Step 4 : Vérifier le typage**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: PASS (aucune nouvelle erreur ; les erreurs préexistantes éventuelles inchangées).

---

### Task 3 : Lecture — les deux lecteurs excluent les matchs skippés

**Files:**
- Modify: `react-matchup/lib/notifications.ts` (Promise.all ~L64-122, `unvotedCount` L129-130)
- Modify: `react-matchup/app/(tabs)/index.tsx` (`fetchData` Promise.all L308-334, `pendingBadge` L338-340)

**Interfaces:**
- Consumes: table `badge_prompt_skips` (Task 1). Les deux lecteurs recomposent `skippedIds` et l'unissent à `votedIds`.
- Produces: `unvotedCount` et `pendingBadge` corrigés — le socle unique de la notif « Distribue des badges ».

- [ ] **Step 1 : `notifications.ts` — charger les skips**

⚠️ Le `Promise.all` (L64-122) et sa déstructuration (L56-63) sont un tableau **positionnel** : chaque `{ data: X }` correspond à la Nième requête. Ajouter la nouvelle entrée **en DERNIÈRE position des deux côtés** pour ne pas décaler l'alignement.

1. Déstructuration : après `{ data: dmRequests },` (L63), ajouter `{ data: badgeSkips },`.
2. `Promise.all` : après la dernière requête (le bloc `direct_conversations` qui se termine L121 par `.eq('status', 'pending'),`), ajouter comme dernière requête :

```ts
    supabase
      .from('badge_prompt_skips')
      .select('match_id')
      .eq('player_id', playerId),
```

- [ ] **Step 2 : `notifications.ts` — exclure les skips de `unvotedCount`**

Remplacer L129-130 :

```ts
  const votedIds = new Set((alreadyVoted ?? []).map((v: any) => v.match_id));
  const unvotedCount = (recentMatches ?? []).filter((m: any) => !votedIds.has(m.id)).length;
```

par :

```ts
  const votedIds = new Set((alreadyVoted ?? []).map((v: any) => v.match_id));
  const skippedIds = new Set((badgeSkips ?? []).map((s: any) => s.match_id));
  const unvotedCount = (recentMatches ?? [])
    .filter((m: any) => !votedIds.has(m.id) && !skippedIds.has(m.id)).length;
```

- [ ] **Step 3 : `index.tsx` — charger les skips dans `fetchData`**

Même prudence positionnelle : le `Promise.all` (L313-334) et sa déstructuration (L308-312) sont alignés par position. Ajouter **en DERNIÈRE position des deux côtés**.

1. Déstructuration : après `{ data: alreadyVoted },` (L312), ajouter `{ data: badgeSkips },`.
2. `Promise.all` : après la dernière requête (le bloc `reputation_votes` … `.eq('giver_id', player.id)` L330-333), ajouter comme dernière requête :

```tsx
      supabase
        .from('badge_prompt_skips')
        .select('match_id')
        .eq('player_id', player.id),
```

- [ ] **Step 4 : `index.tsx` — exclure les skips de `pendingBadge`**

Remplacer L338-340 :

```tsx
    const votedIds = new Set((alreadyVoted ?? []).map((v: any) => v.match_id));
    const pendingBadge = (recentMatches ?? []).filter((m: any) => !votedIds.has(m.id));
    setBadgeMatches(pendingBadge);
```

par :

```tsx
    const votedIds = new Set((alreadyVoted ?? []).map((v: any) => v.match_id));
    const skippedIds = new Set((badgeSkips ?? []).map((s: any) => s.match_id));
    const pendingBadge = (recentMatches ?? [])
      .filter((m: any) => !votedIds.has(m.id) && !skippedIds.has(m.id));
    setBadgeMatches(pendingBadge);
```

- [ ] **Step 5 : Vérifier le typage**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: PASS.

---

### Task 4 : Vérification device (manuelle)

**Files:** aucun (validation).

- [ ] **Step 1 : Appliquer la migration** `badge_prompt_skips.sql` dans l'éditeur SQL Supabase (prod), si pas déjà fait.

- [ ] **Step 2 : Scénarios à valider sur device**
  1. Match récent non récompensé → la notif « Distribue des badges » apparaît.
  2. Ouvrir la modale, **« Passer sans badge »** → la notif disparaît ; **recharger / relancer l'app** → elle ne revient pas.
  3. Ouvrir un autre match, **« Envoyer les badges » sans rien sélectionner** → même résultat (notif ne revient pas).
  4. Ouvrir un 3e match, sélectionner ≥ 1 badge, **Envoyer** → le badge est bien enregistré (profil du receveur incrémenté, événement dans le fil Communauté) et la notif tombe.
  5. Le profil et le fil Communauté ne montrent **aucun faux badge** issu d'un skip.
  6. Compteur de la cloche cohérent avec l'écran notifications (même total).

---

## Récap post-plan

- **À appliquer en prod :** `react-matchup/supabase/migrations/badge_prompt_skips.sql` (à la main, éditeur SQL Supabase).
- **Commit :** géré par l'utilisateur (pas de commit auto).
- **Fichiers touchés :** 1 migration créée, `lib/notifications.ts` et `app/(tabs)/index.tsx` modifiés.
