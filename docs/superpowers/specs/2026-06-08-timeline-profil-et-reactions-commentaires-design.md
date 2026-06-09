# Spec — Timeline d'activité sur le profil + Réactions aux commentaires

**Date** : 2026-06-08
**Statut** : validé, prêt pour plan d'implémentation

## Contexte & objectif

Suite de la feature commentaires d'activité (voir `2026-06-05-commentaires-activite-design.md`).
Deux ajouts validés, indépendants mais livrés ensemble :

1. **Timeline d'activité sur le profil** — donner une « maison » aux réalisations d'un joueur :
   son profil liste ses événements d'activité dans le temps, et les visiteurs peuvent y
   réagir / commenter. Le fil des amis reste inchangé (on n'en retire PAS les posts perso).
2. **Réactions aux commentaires** — pouvoir 🔥 un commentaire (pas seulement l'activité),
   pour nourrir le « se hyper ».

Les deux réutilisent massivement l'existant (`ActivityCard`, écran commentaires, RPC de
réactions calquées).

## État actuel (vérifié)

- `getActivityFeed` mélange volontairement `[myId, ...following]` ([community.ts:163](../../lib/community.ts)).
  → On garde ce comportement ; la timeline profil est **additive**.
- Le profil `app/(tabs)/player/[id].tsx` affiche des badges calculés (Palmarès) mais **aucun
  fil d'activité**. Données chargées dans `fetchData()` ; flag `isSelf = self?.id === id`.
- L'écran commentaires `app/community/comments/[eventId].tsx` rend chaque commentaire (nom +
  ⋯ + texte) mais **sans réactions**.
- RLS : `activity_events` lisible par tous les authentifiés (`USING (true)`) → afficher la
  timeline de n'importe quel profil est OK sans changement.
- Convention : écritures sensibles via RPC `SECURITY DEFINER` ; réactions au format
  `Record<emoji, player_ids[]>` (cf. `toggle_activity_reaction`).

---

## Partie A — Timeline d'activité sur le profil (aucune migration)

### A.1 Données — `getPlayerActivity` dans `lib/community.ts`
Nouvelle fonction, calquée sur `getActivityFeed` mais filtrée sur un seul joueur :

```
getPlayerActivity(playerId: string, limit = 20): Promise<ActivityEvent[]>
```
- `select * from activity_events where player_id = playerId order by created_at desc limit N`
- Hydrate `actor` (id, name, elo_score), `league`, `reactions` (`?? {}`), `comment_count`
  (count via `activity_comments`), exactement comme `getActivityFeed`.

### A.2 UI — section « Activité » dans `player/[id].tsx`
- Nouvel état : `const [activity, setActivity] = useState<ActivityEvent[]>([])`.
- Dans `fetchData()`, ajouter `getPlayerActivity(id)` à la phase parallèle et
  `setActivity(...)`.
- Nouvelle section rendue **après le Palmarès** (avant ou après l'historique des matchs),
  titrée via `Kicker` « Activité », qui mappe une `<ActivityCard>` par event.
- Câblage des interactions (réutilise les briques du fil) :
  - `myId = self?.id ?? ''`
  - `onReact` : toggle optimiste + `toggleReaction(e.id)` (copie du `react()` de
    `friends.tsx`). **Désactivé** (prop non passée) quand `isSelf` ET que le post est le mien
    — concrètement, sur son propre profil tous les posts sont à soi → 🔥 désactivé partout ;
    sur le profil d'un autre → 🔥 actif.
  - `onPressComments` : `router.push('/community/comments/' + e.id)`.
  - `onPressActor` : non passé (on est déjà sur le profil de l'acteur).
  - `onReport` : passé seulement si `!isSelf` (signaler l'activité d'un autre).
- Si `activity.length === 0` : ne rien afficher (pas de section vide), ou un libellé discret
  « Aucune activité ». **Décision : ne rien afficher** (cohérent avec `showPalm`).

### A.3 Rafraîchissement
- La section se recharge avec `fetchData()` (déjà appelé au focus / pull-to-refresh existant).
  Après un retour de l'écran commentaires, le `comment_count` se met à jour au prochain
  `fetchData`. (Pas de re-fetch ciblé nécessaire pour le lancement.)

---

## Partie B — Réactions aux commentaires (1 migration SQL)

### B.1 Migration `supabase/migrations/comment_reactions.sql`
```sql
-- Réactions sur les commentaires d'activité (format Record<emoji, player_ids[]>).
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

### B.2 Type — `ActivityComment` reçoit `reactions`
Dans `types/index.ts` :
```ts
export interface ActivityComment {
  id: string;
  event_id: string;
  player_id: string;
  content: string;
  reactions: Record<string, string[]>;   // { "🔥": [player_id, ...] }
  created_at: string;
  actor?: Pick<Player, 'id' | 'name' | 'elo_score'>;
  league?: League;
}
```

### B.3 Données — `lib/community.ts`
- `getComments` : inclure `reactions: c.reactions ?? {}` dans l'objet hydraté.
- `addComment` : l'objet `comment` renvoyé doit inclure `reactions: row.reactions ?? {}`.
- Nouvelle fonction :
  ```
  toggleCommentReaction(commentId: string, emoji = '🔥'): Promise<Record<string, string[]> | null>
  ```
  appelle `supabase.rpc('toggle_comment_reaction', { p_comment_id, p_emoji })`, renvoie
  `data?.reactions ?? {}` (ou `null` sur erreur). Miroir de `toggleReaction`.

### B.4 UI — écran `comments/[eventId].tsx`
- Sous le texte de chaque commentaire, un bouton 🔥 + compteur (style aligné sur
  `ActivityCard`).
- `liked = (c.reactions?.['🔥'] ?? []).includes(myId)` ; `likes = longueur`.
- Toggle **optimiste** sur l'état `comments`, puis appel `toggleCommentReaction(c.id)` et
  réconciliation avec le retour (comme `react()` de `friends.tsx`).

---

## Tests — vérification manuelle (convention du repo)

Pas de runner de test ; vérification à la main.

- **A.1/A.2** : ouvrir mon profil → voir ma timeline ; 🔥 désactivé sur mes posts ; ouvrir
  les commentaires depuis une carte. Ouvrir le profil d'un ami → 🔥 actif, réaction
  persistée après refresh ; signaler une de ses activités.
- **A** : profil sans aucune activité → pas de section vide.
- **B** : migration appliquée (SQL editor) ; 🔥 sur un commentaire toggle et persiste après
  rechargement de l'écran ; un second compte voit le compteur à jour.

## Hors périmètre

- Retirer les posts perso du fil des amis (non demandé).
- Notif sur réaction à un commentaire (YAGNI pour l'instant).
- Pagination « voir plus » de la timeline (limite fixe 20 au lancement).
- Réactions multi-emoji (🔥 uniquement, comme l'activité).

## Notes de déploiement

- Partie A : aucune migration.
- Partie B : appliquer `supabase/migrations/comment_reactions.sql` à la main dans Supabase
  (dossier `supabase/` gitignored, non versionné — convention du repo).
- Travail dans l'app React Native (`react-matchup`).
