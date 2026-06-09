# Timeline profil + Réactions aux commentaires — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une timeline d'activité interactive sur le profil joueur, et permettre de réagir (🔥) aux commentaires.

**Architecture:** Réutilisation maximale de l'existant. Partie A (timeline profil) : une fonction `getPlayerActivity` + une section `ActivityCard` dans `player/[id].tsx`, zéro migration. Partie B (réactions commentaires) : colonne `reactions jsonb` + RPC `toggle_comment_reaction` calquée sur `toggle_activity_reaction`, exposée dans l'écran commentaires.

**Tech Stack:** React Native / Expo Router, Supabase (Postgres + RPC plpgsql), TypeScript.

**Référence spec:** `docs/superpowers/specs/2026-06-08-timeline-profil-et-reactions-commentaires-design.md`

**Vérification:** pas de runner de test dans le repo → vérification manuelle (app + SQL editor Supabase). Pas de branche (l'utilisateur travaille sur `main` et relit/commit lui-même).

---

## PARTIE A — Timeline d'activité sur le profil (aucune migration)

### Task A1: `getPlayerActivity` dans `lib/community.ts`

**Files:**
- Modify: `react-matchup/lib/community.ts` (après `getActivityFeed`, vers la ligne 198)

- [ ] **Step 1: Ajouter la fonction**

Dans `react-matchup/lib/community.ts`, juste après la fin de `getActivityFeed` (avant le commentaire `// Toggle réaction 🔥`), ajoute :

```ts
// Fil d'activité d'UN joueur (pour sa page profil). Même hydratation que getActivityFeed.
export async function getPlayerActivity(playerId: string, limit = 20): Promise<ActivityEvent[]> {
  const { data: events } = await supabase
    .from('activity_events')
    .select('*')
    .eq('player_id', playerId)
    .order('created_at', { ascending: false })
    .limit(limit);

  const list = (events ?? []) as ActivityEvent[];
  if (list.length === 0) return [];

  const eventIds = list.map(e => e.id);
  const [{ data: actor }, { data: comments }] = await Promise.all([
    supabase.from('players').select('id, name, elo_score').eq('id', playerId).single(),
    supabase.from('activity_comments').select('event_id').in('event_id', eventIds),
  ]);

  const commentCount = new Map<string, number>();
  (comments ?? []).forEach((c: any) =>
    commentCount.set(c.event_id, (commentCount.get(c.event_id) ?? 0) + 1));

  const a: any = actor;
  const league = a ? (getLeague(a.elo_score) as League) : 'discovery';
  return list.map(e => ({
    ...e,
    reactions: e.reactions ?? {},
    actor: a,
    league,
    comment_count: commentCount.get(e.id) ?? 0,
  }));
}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: pas de nouvelle erreur.

- [ ] **Step 3: Commit**

```bash
git add react-matchup/lib/community.ts
git commit -m "feat(community): getPlayerActivity (fil d'un joueur)"
```

---

### Task A2: Rendre `onReact` optionnel dans `ActivityCard`

**Files:**
- Modify: `react-matchup/components/community/ActivityCard.tsx` (signature + bloc réactions)

- [ ] **Step 1: Passer `onReact` en optionnel**

Dans `react-matchup/components/community/ActivityCard.tsx`, remplace la signature par :

```tsx
export function ActivityCard({ e, myId, onReact, onPressActor, onReport, onPressComments }: {
  e: ActivityEvent;
  myId: string;
  onReact?: () => void;        // absent = 🔥 désactivé (ex: ses propres posts)
  onPressActor?: () => void;   // ouvre le profil de l'acteur
  onReport?: () => void;       // signaler l'activité (absent si c'est la mienne)
  onPressComments?: () => void; // ouvre la feuille de commentaires
}) {
```

- [ ] **Step 2: Désactiver le 🔥 quand `onReact` est absent**

Dans le même fichier, repère le `TouchableOpacity` du 🔥 (celui avec `onPress={onReact}`) et ajoute `disabled={!onReact}` :

```tsx
        <TouchableOpacity onPress={onReact} disabled={!onReact} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 17, opacity: liked ? 1 : 0.5 }}>🔥</Text>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: liked ? Colors.brandDeep : Colors.textMuted }}>
            {likes}
          </Text>
        </TouchableOpacity>
```

> `friends.tsx` passe toujours `onReact` → aucun changement de comportement là-bas.

- [ ] **Step 3: Vérifier la compilation**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: pas de nouvelle erreur.

- [ ] **Step 4: Commit**

```bash
git add react-matchup/components/community/ActivityCard.tsx
git commit -m "feat(community): ActivityCard onReact optionnel (désactivable)"
```

---

### Task A3: Section « Activité » dans le profil

**Files:**
- Modify: `react-matchup/app/(tabs)/player/[id].tsx` (imports, state, fetchData, render après Palmarès)

- [ ] **Step 1: Compléter les imports**

Dans `react-matchup/app/(tabs)/player/[id].tsx` :

Remplace l'import community (ligne 14) :
```tsx
import { playerStoryLink, SHARE_LABEL, getPlayerActivity, toggleReaction } from '../../../lib/community';
```

Remplace l'import de types (ligne 15) :
```tsx
import type { Player, EloHistory, ActivityEvent } from '../../../types';
```

Ajoute l'import du composant carte (après la ligne 19, avec les autres imports de composants) :
```tsx
import { ActivityCard } from '../../../components/community/ActivityCard';
```

- [ ] **Step 2: Ajouter l'état activité**

Près des autres `useState` (vers la ligne 588, après `const [loading, setLoading] = useState(true);`), ajoute :

```tsx
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
```

- [ ] **Step 3: Charger l'activité dans `fetchData`**

Dans `fetchData()`, ajoute le chargement de l'activité juste après la phase parallèle existante (après `setRankPos((rankRes.count ?? 0) + 1);`, vers la ligne 638) :

```tsx
    getPlayerActivity(id).then(setActivity);
```

- [ ] **Step 4: Ajouter le handler de réaction**

Avant le `return (` du composant (avec les autres handlers, ex. après la définition de `isSelf` vers la ligne 604), ajoute :

```tsx
  const reactToActivity = async (eventId: string) => {
    const myId = self?.id ?? '';
    if (!myId) return;
    setActivity(prev => prev.map(e => {
      if (e.id !== eventId) return e;
      const fire = e.reactions?.['🔥'] ?? [];
      const has = fire.includes(myId);
      const next = has ? fire.filter(idx => idx !== myId) : [...fire, myId];
      const reactions = { ...e.reactions };
      if (next.length) reactions['🔥'] = next; else delete reactions['🔥'];
      return { ...e, reactions };
    }));
    const updated = await toggleReaction(eventId);
    if (updated) setActivity(prev => prev.map(e => e.id === eventId ? { ...e, reactions: updated } : e));
  };

  const reportActivityEvent = (e: ActivityEvent) => {
    const myId = self?.id ?? '';
    Alert.alert('Cette activité', undefined, [
      {
        text: 'Signaler', style: 'destructive',
        onPress: async () => {
          try {
            await reportContent({ reporterId: myId, targetType: 'activity', targetId: e.id, reportedPlayerId: e.player_id });
            Alert.alert('Merci', 'Activité signalée à la modération.');
          } catch {
            Alert.alert('Erreur', "Le signalement n'a pas pu être envoyé.");
          }
        },
      },
      { text: 'Annuler', style: 'cancel' },
    ]);
  };
```

- [ ] **Step 5: Rendre la section après le Palmarès**

Dans le JSX, juste après le bloc Palmarès (le `)}` qui ferme `{showPalm && (...)}`, vers la ligne 1185) et avant le bloc « Historique des matchs », insère :

```tsx
      {/* ── Activité (interactive : 🔥 + commentaires) ──────────── */}
      {activity.length > 0 && (
        <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
          <Kicker style={{ marginBottom: 8, marginLeft: 2 }}>Activité</Kicker>
          <View style={{ gap: 14 }}>
            {activity.map(e => (
              <ActivityCard
                key={e.id}
                e={e}
                myId={self?.id ?? ''}
                onReact={isSelf ? undefined : () => reactToActivity(e.id)}
                onPressComments={() => router.push(`/community/comments/${e.id}` as any)}
                onReport={isSelf ? undefined : () => reportActivityEvent(e)}
              />
            ))}
          </View>
        </View>
      )}
```

- [ ] **Step 6: Vérifier la compilation**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: pas de nouvelle erreur.

- [ ] **Step 7: Vérification manuelle (app)**

Lance l'app, ouvre **ton** profil : la section « Activité » liste tes events ; le 🔥 est grisé/inactif sur tes posts ; taper 💬 ouvre l'écran commentaires. Ouvre le profil **d'un ami** : le 🔥 fonctionne (réaction persiste après pull-to-refresh), et tu peux signaler une de ses activités. Profil sans aucune activité → pas de section.

- [ ] **Step 8: Commit**

```bash
git add "react-matchup/app/(tabs)/player/[id].tsx"
git commit -m "feat(profile): section Activité interactive sur le profil"
```

---

## PARTIE B — Réactions aux commentaires (1 migration SQL)

### Task B1: Migration `comment_reactions.sql`

**Files:**
- Create: `react-matchup/supabase/migrations/comment_reactions.sql`

- [ ] **Step 1: Écrire la migration**

Crée `react-matchup/supabase/migrations/comment_reactions.sql` :

```sql
-- Réactions sur les commentaires d'activité (format Record<emoji, player_ids[]>).
-- Migration appliquée à la main dans le SQL editor Supabase.

ALTER TABLE public.activity_comments
  ADD COLUMN IF NOT EXISTS reactions jsonb NOT NULL DEFAULT '{}'::jsonb;

-- RPC toggle (miroir exact de toggle_activity_reaction).
CREATE OR REPLACE FUNCTION public.toggle_comment_reaction(
  p_comment_id uuid,
  p_emoji      text
)
RETURNS public.activity_comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_player uuid;
  v_arr    jsonb;
  v_idx    int;
  v_result public.activity_comments;
BEGIN
  v_player := public.current_player_id();
  IF v_player IS NULL THEN
    RAISE EXCEPTION 'not a registered player';
  END IF;

  SELECT reactions -> p_emoji INTO v_arr
  FROM public.activity_comments WHERE id = p_comment_id FOR UPDATE;

  IF v_arr IS NULL OR jsonb_typeof(v_arr) <> 'array' THEN
    v_arr := '[]'::jsonb;
  END IF;

  v_idx := NULL;
  SELECT ord - 1 INTO v_idx
  FROM jsonb_array_elements_text(v_arr) WITH ORDINALITY AS t(val, ord)
  WHERE val = v_player::text
  LIMIT 1;

  IF v_idx IS NULL THEN
    v_arr := v_arr || to_jsonb(v_player::text);
  ELSE
    v_arr := v_arr - v_idx;
  END IF;

  UPDATE public.activity_comments
     SET reactions = CASE
       WHEN jsonb_array_length(v_arr) = 0 THEN reactions - p_emoji
       ELSE jsonb_set(reactions, ARRAY[p_emoji], v_arr, true)
     END
   WHERE id = p_comment_id
   RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;
```

- [ ] **Step 2: Appliquer dans Supabase**

Colle le contenu dans le SQL editor Supabase et exécute.
Expected: `activity_comments` a une colonne `reactions` (défaut `{}`), la fonction `toggle_comment_reaction` existe.

- [ ] **Step 3: Vérification manuelle (SQL editor)**

```sql
SELECT public.toggle_comment_reaction('<comment_id>', '🔥');
```
Expected: renvoie la ligne du commentaire avec `reactions` contenant ton player_id ; un 2e appel le retire.

> Rappel : dossier `supabase/` gitignored → migration non versionnée (convention du repo), pas de commit.

---

### Task B2: Type `ActivityComment` += `reactions`

**Files:**
- Modify: `react-matchup/types/index.ts` (interface `ActivityComment`)

- [ ] **Step 1: Ajouter le champ**

Dans `react-matchup/types/index.ts`, dans l'interface `ActivityComment`, ajoute la ligne `reactions` après `created_at` :

```ts
export interface ActivityComment {
  id: string;
  event_id: string;
  player_id: string;
  content: string;
  created_at: string;
  reactions: Record<string, string[]>;   // { "🔥": [player_id, ...] }
  // Hydraté côté client :
  actor?: Pick<Player, 'id' | 'name' | 'elo_score'>;
  league?: League;
}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: pas de nouvelle erreur (les objets `ActivityComment` construits dans community.ts seront complétés au Task B3).

- [ ] **Step 3: Commit**

```bash
git add react-matchup/types/index.ts
git commit -m "feat(types): ActivityComment.reactions"
```

---

### Task B3: Données réactions commentaires dans `lib/community.ts`

**Files:**
- Modify: `react-matchup/lib/community.ts` (`getComments`, `addComment`, + nouvelle `toggleCommentReaction`)

- [ ] **Step 1: Inclure `reactions` dans `getComments`**

Dans `getComments`, dans l'objet retourné par le `.map`, ajoute `reactions` :

```ts
  return list.map(c => {
    const actor: any = actorById.get(c.player_id);
    return {
      ...c,
      reactions: c.reactions ?? {},
      actor,
      league: actor ? (getLeague(actor.elo_score) as League) : 'discovery',
    };
  });
```

- [ ] **Step 2: Inclure `reactions` dans l'objet renvoyé par `addComment`**

Dans `addComment`, complète l'objet `comment` :

```ts
  const row = data as ActivityComment;
  const comment: ActivityComment = {
    ...row,
    reactions: row.reactions ?? {},
    actor: { id: me.id, name: me.name, elo_score: me.elo_score },
    league: getLeague(me.elo_score) as League,
  };
```

- [ ] **Step 3: Ajouter `toggleCommentReaction`**

Juste après `deleteComment` (vers la ligne 282), ajoute :

```ts
// Toggle réaction 🔥 sur un commentaire (RPC SECURITY DEFINER). Renvoie les réactions à jour.
export async function toggleCommentReaction(commentId: string, emoji = '🔥'): Promise<Record<string, string[]> | null> {
  const { data, error } = await supabase.rpc('toggle_comment_reaction', {
    p_comment_id: commentId, p_emoji: emoji,
  });
  if (error) { console.log('[toggleCommentReaction]', error.message); return null; }
  return (data?.reactions ?? {}) as Record<string, string[]>;
}
```

- [ ] **Step 4: Vérifier la compilation**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: pas de nouvelle erreur.

- [ ] **Step 5: Commit**

```bash
git add react-matchup/lib/community.ts
git commit -m "feat(community): toggleCommentReaction + reactions dans getComments/addComment"
```

---

### Task B4: 🔥 par commentaire dans l'écran commentaires

**Files:**
- Modify: `react-matchup/app/community/comments/[eventId].tsx` (import, handler, bloc réaction sous chaque commentaire)

- [ ] **Step 1: Importer `toggleCommentReaction`**

Dans `react-matchup/app/community/comments/[eventId].tsx`, complète l'import depuis community :

```tsx
import { getComments, addComment, deleteComment, toggleCommentReaction } from '../../../lib/community';
```

- [ ] **Step 2: Ajouter le handler optimiste**

Avant le `return (` du composant (après la fonction `report`), ajoute :

```tsx
  const reactToComment = async (commentId: string) => {
    if (!myId) return;
    setComments(prev => prev.map(c => {
      if (c.id !== commentId) return c;
      const fire = c.reactions?.['🔥'] ?? [];
      const has = fire.includes(myId);
      const next = has ? fire.filter(idx => idx !== myId) : [...fire, myId];
      const reactions = { ...c.reactions };
      if (next.length) reactions['🔥'] = next; else delete reactions['🔥'];
      return { ...c, reactions };
    }));
    const updated = await toggleCommentReaction(commentId);
    if (updated) setComments(prev => prev.map(c => c.id === commentId ? { ...c, reactions: updated } : c));
  };
```

- [ ] **Step 3: Afficher le 🔥 sous chaque commentaire**

Dans le rendu d'un commentaire, juste après le `<Text>` qui affiche `{c.content}`, ajoute le bloc réaction :

```tsx
                  <Text style={{ fontFamily: Fonts.ui, fontSize: 14, color: Colors.textPrimary, marginTop: 3 }}>
                    {c.content}
                  </Text>
                  <TouchableOpacity onPress={() => reactToComment(c.id)} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, alignSelf: 'flex-start' }}>
                    <Text style={{ fontSize: 15, opacity: (c.reactions?.['🔥'] ?? []).includes(myId) ? 1 : 0.5 }}>🔥</Text>
                    {(c.reactions?.['🔥'] ?? []).length > 0 && (
                      <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: (c.reactions?.['🔥'] ?? []).includes(myId) ? Colors.brandDeep : Colors.textMuted }}>
                        {(c.reactions?.['🔥'] ?? []).length}
                      </Text>
                    )}
                  </TouchableOpacity>
```

> Remplace le `<Text>…{c.content}…</Text>` existant par ce bloc (il commence par le même `<Text>` puis ajoute le `TouchableOpacity`).

- [ ] **Step 4: Vérifier la compilation**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: pas de nouvelle erreur.

- [ ] **Step 5: Vérification manuelle (app)**

Migration B1 appliquée. Ouvre un fil de commentaires : taper 🔥 sur un commentaire l'allume + incrémente ; re-taper l'éteint ; après avoir quitté/rouvert l'écran, l'état persiste ; un autre compte voit le compteur.

- [ ] **Step 6: Commit**

```bash
git add "react-matchup/app/community/comments/[eventId].tsx"
git commit -m "feat(comments): réactions 🔥 sur les commentaires"
```

---

## Vérification finale (parcours manuel)

- [ ] Migration `comment_reactions.sql` appliquée en prod Supabase.
- [ ] Profil : section Activité présente, 🔥 désactivé sur ses propres posts, actif sur ceux des autres, persistant après refresh.
- [ ] Profil : ouverture des commentaires depuis une carte d'activité.
- [ ] Profil sans activité → pas de section vide.
- [ ] Commentaires : 🔥 toggle + compteur + persistance + visible par un 2e compte.

## Hors périmètre (rappel spec)

Retrait des posts perso du fil amis · notif sur réaction à un commentaire · pagination « voir plus » · multi-emoji.
