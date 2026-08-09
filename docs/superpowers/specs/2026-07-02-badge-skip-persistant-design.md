# Passer un match sans badge = définitif

**Date :** 2026-07-02
**App :** react-matchup (PAG MATCH)

## Problème

Après validation d'un score, chaque joueur reçoit la notif « Distribue des badges » l'invitant à récompenser ses coéquipiers. Le bouton **« Passer sans badge »** (et le fait de tapoter « Envoyer les badges » sans rien sélectionner) ne laisse **aucune trace en base** : il retire seulement le match du state local. Au prochain chargement, la notif se recalcule depuis `reputation_votes`, ne trouve toujours aucun vote pour ce match, et **la notif réapparaît**. « Passer » ne dure que le temps de la session.

## Cause racine

La notif s'affiche tant que `unvotedCount > 0`, calculé dans deux lecteurs :

- `lib/notifications.ts:130` — `unvotedCount = recentMatches (< 7j) sans ligne reputation_votes (giver_id = moi)`.
- `app/(tabs)/index.tsx:339` — `pendingBadge`, la liste des matchs à récompenser qui alimente la modale.

Le seul signal persistant existant est « j'ai donné au moins un badge » (ligne dans `reputation_votes`). Il manque le signal « j'ai choisi de ne rien donner pour ce match ».

## Décision produit

- **Passer = définitif.** Une fois passé, le match ne recompte plus jamais dans la notif.
- **Granularité = tout le match.** Une action « Passer » couvre le match entier, quel que soit le nombre de coéquipiers (colle à l'UI actuelle : un seul bouton Passer pour toute la modale).

## Solution : table dédiée `badge_prompt_skips`

### Pourquoi PAS une ligne sentinelle dans `reputation_votes`

`reputation_votes` est lu partout comme « badges **reçus** » :

- compteur de badges du profil (`index.tsx:315`, `player/[id].tsx:631`),
- `player_achievements` (comptes de badges),
- **trigger `AFTER INSERT ON reputation_votes` qui crée un événement « badge reçu » dans le fil Communauté** (`community_social.sql:491`),
- backfill activité (`community_activity_backfill.sql`).

Une ligne bidon (skip) polluerait tous ces agrégats et déclencherait un faux « badge reçu » dans le feed. → écarté.

### Composant 1 — Migration SQL (`badge_prompt_skips.sql`)

```sql
CREATE TABLE IF NOT EXISTS public.badge_prompt_skips (
  player_id  uuid NOT NULL,
  match_id   uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, match_id)
);

ALTER TABLE public.badge_prompt_skips ENABLE ROW LEVEL SECURITY;

-- Lecture publique (comme reputation_votes ; aucune donnée sensible)
DROP POLICY IF EXISTS badge_skip_select ON public.badge_prompt_skips;
CREATE POLICY badge_skip_select ON public.badge_prompt_skips
  FOR SELECT USING (true);

-- Écriture par le joueur lui-même
DROP POLICY IF EXISTS badge_skip_insert ON public.badge_prompt_skips;
CREATE POLICY badge_skip_insert ON public.badge_prompt_skips
  FOR INSERT TO authenticated
  WITH CHECK (player_id = public.current_player_id());

DROP POLICY IF EXISTS badge_skip_delete ON public.badge_prompt_skips;
CREATE POLICY badge_skip_delete ON public.badge_prompt_skips
  FOR DELETE TO authenticated
  USING (player_id = public.current_player_id() OR public.is_app_admin());
```

Policies calquées à l'identique sur `reputation_votes` (`enable_rls_phase1.sql:273`). Pas de realtime, pas de trigger.

### Composant 2 — Écriture client (`app/(tabs)/index.tsx`)

- **Bouton « Passer sans badge »** (`index.tsx:532`) → `insert` d'une ligne `{ player_id, match_id }` avant le retrait local, puis enchaîne comme aujourd'hui.
- **`handleSubmitBadges` avec 0 sélection** (`inserts.length === 0`, `index.tsx:397`) → insérer une ligne skip au lieu de ne rien écrire.
- **≥ 1 badge donné** → aucun changement : la ligne `reputation_votes` fait déjà tomber le match via `votedIds`.

Facteur commun : un petit helper local `skipBadgeMatch(matchId)` réutilisé par les deux points d'entrée.

### Composant 3 — Lecture (les deux lecteurs filtrent pareil)

Principe : le compteur de la cloche a une **source unique** ; les deux lecteurs doivent appliquer exactement le même filtre, sinon la modale rouvrirait un match déjà passé (divergence d'état).

- `notifications.ts` — ajouter au `Promise.all` une requête `badge_prompt_skips.select('match_id').eq('player_id', playerId)` ; `unvotedCount` exclut `votedIds ∪ skippedIds`.
- `index.tsx` `fetchData` — même requête ; `pendingBadge` exclut `votedIds ∪ skippedIds`.

## Hors périmètre (YAGNI)

- Pas de « me le rappeler plus tard ».
- Pas de changement de la fenêtre de 7 jours.
- Pas d'UI de dé-skip (un `delete` reste possible : policy delete owner/admin).
- Pas de skip par joueur individuel.

## Vérification

- `tsc` OK.
- Vérif device : passer un match → la notif cloche disparaît et **ne revient pas** après reload / relance ; la modale ne rouvre pas ce match ; donner un badge fonctionne toujours ; le profil / feed Communauté ne montrent aucun faux badge.
- Migration `badge_prompt_skips.sql` à appliquer en prod (non timestampée, appliquée à la main comme les autres).
