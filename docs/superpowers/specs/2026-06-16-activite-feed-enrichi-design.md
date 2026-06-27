# Sous-projet A — Feed Activité enrichi

**Date :** 2026-06-16
**Statut :** Design validé, prêt pour le plan d'implémentation
**Index :** `2026-06-16-activite-refonte-index-design.md`
**Handoff :** `design_handoff_activity_tab/designs/01-Activity-Tab.dc.html` · screenshot `screenshots/01-activity-feed.png`

## Contexte

`app/(tabs)/activite.tsx` affiche aujourd'hui un header noir arrondi (logo + titre « L'Activité » + `ProfileAvatarButton`) puis un `<ActivityFeed myId>` plat : bandeau d'amis filtrant + cards d'activité (🔥 + commentaires + `<MatchCard>` via `lib/matchView`). Données via `lib/community.ts` (`getFriends`, `getActivityFeed`, `toggleReaction`).

Le handoff veut transformer ce fil en **espace social vivant** : on garde le header et le fil, on **insère 4 sections** au-dessus.

## Objectif

Reproduire l'écran 1 du handoff au pixel près, en réutilisant l'existant (header, `ActivityFeed`, `Avatar`, `joinGame`, scoring matchmaking) et en isolant chaque section dans `components/activity/` pour rester testable et réversible.

## Architecture

`activite.tsx` garde son header. Le corps devient un `ScrollView` unique assemblant, dans l'ordre :

```
<WeekStatsCard />        // Ta semaine
<JoinHeroCard />         // Il manque 1 joueur
<MomentsRail />          // Moments de la semaine
<WeekendRail />          // Joue ce week-end
<FriendsBar /> + <FeedList />   // existant, extrait de ActivityFeed
```

État local (handoff §State) : `{ activeFriend: 'all'|string, likes: Record<string,bool>, joined: Record<string,bool>, openMoment: string|null }`. Les `likes`/filtre amis viennent déjà de l'`ActivityFeed` actuel — on le refactore plutôt que de dupliquer.

## Composants

### 1. `WeekStatsCard` (Ta semaine)
- Card blanche, bordure `Colors.border`, radius 18.
- 3 métriques sur une ligne : **Matchs joués** · **Forme V/D** (4-5 carrés : vert `success` / rouge `danger` / dashed `#D4D4D8`) · **Δ ELO** (Anton, signé).
- Données : **RPC `activity_week_stats(p_uid, p_days=7)`** → `{ matches, results: ('W'|'L')[], elo_delta }`. Lit `matches` + `elo_history` côté serveur.
- Exposé via `lib/activityFeed.ts` `getWeekStats(uid)`.

### 2. `JoinHeroCard` (Il manque 1 joueur)
- Fond dégradé `#0A0A0A → #1A1A1C` (`bgDarkFrom`/`bgDarkAlt`), radius 18.
- Badge « CE SOIR · 19h » + label « ★ POUR TOI ». Titre « Il manque 1 joueur à **{n} km** » (distance en jaune). Sous-titre club + niveau + amis présents. 3 avatars + « +1 » bordure dashed jaune.
- Bouton **Rejoindre** → appelle `joinGame()` (`lib/games.ts`) → bascule `✓ Demandé` vert (`joined[matchId]=true`). Idempotent / optimiste.
- Données : **RPC `suggested_open_game(p_uid)`** → renvoie 1 `open_games` à 1 place libre, scoré **distance × niveau × imminence × amis présents** (réutilise la logique de `app/(tabs)/matchmaking.tsx` : `scoreClubs`/`scoreDays` + écart ELO + proximité `match_date` + nb de `follows` déjà inscrits). Renvoie `null` → la carte ne s'affiche pas (ou bascule en Hero d'état vide, cf. sous-projet C).
- Tracking : `activity_hero_join_tapped { match_id, distance_km }`.

### 3. `MomentsRail` (Moments de la semaine)
- Scroll horizontal. **1er slot** = tuile « Partager ton match » → ouvre le `StoryComposer`/`StoryMatchPicker` local existant. Puis **3 tuiles 9:16 (128×184)** rendues **à la volée depuis `activity_events`** des amis (type `match_win` / `promotion` / `badge` des 7 derniers jours).
- **Aucun média stocké** : la tuile est un rendu (dégradé selon type + résumé de l'event). Tap → `MomentOverlay` plein écran (`inset:0`, `rgba(10,10,10,0.85)`, z-index 50, fade-in + slide-up), fermeture au tap n'importe où.
- `MomentOverlay` : card 280×9:16, header (avatar mono + nom + date + X), footer (🔥 réutilise `toggleReaction` + 💬 + bouton « Partager / Féliciter → »).
- Données : filtre sur le `feed` déjà chargé (pas de requête supplémentaire). Helper `lib/activityFeed.ts` `pickMoments(feed)`.
- Tracking : `activity_moment_opened { friend_id, moment_type }`.

### 4. `WeekendRail` (Joue ce week-end)
- Scroll horizontal de cards de parties ouvertes ce week-end (samedi/dimanche à venir) : card sombre / claire selon places, mêmes mécaniques **Rejoindre** que le Hero.
- Données : `lib/activityFeed.ts` `getWeekendGames(uid)` → `open_games` avec `match_date` sur le prochain week-end, `spots_available > 0`, **affichage des places dérivé des joueurs** (`freeSpots()`, jamais lire la colonne brute — cf. règle `spots_available`).

### 5. `FriendsBar` + `FeedList` (existant, extrait)
- Refactor de `components/community/ActivityFeed.tsx` : extraire la barre d'amis filtrante et la liste en sous-composants réutilisés par le nouvel assemblage. Comportement **inchangé** (filtre, en-tête « Activité de {prénom} », pill « Tout voir », 🔥, commentaires, signalement, `<ActivityCard>`/`<MatchCard>`).
- Tracking : `activity_friend_filter { friend_id }`, `activity_like_toggled { activity_id, liked }`.

### Ouverture & tracking d'écran
- `activite.tsx` émet `activity_tab_opened { source }` au focus.
- Bouton « Voir bilan complet » (vers le sous-projet B) : placé en bas du fil ou dans le header — **à confirmer au rendu** ; route `app/bilan/[month].tsx` (mois précédent par défaut).

## Fichiers touchés

| Fichier | Action |
|---|---|
| `app/(tabs)/activite.tsx` | Assembler les sections dans un `ScrollView` ; émettre `activity_tab_opened` |
| `components/activity/WeekStatsCard.tsx` | **Nouveau** |
| `components/activity/JoinHeroCard.tsx` | **Nouveau** |
| `components/activity/MomentsRail.tsx` + `MomentOverlay.tsx` | **Nouveau** |
| `components/activity/WeekendRail.tsx` | **Nouveau** |
| `components/community/ActivityFeed.tsx` | Extraire `FriendsBar` + `FeedList` (comportement inchangé) |
| `components/community/Avatar.tsx` | Ajouter variante `mono` (noir/jaune) |
| `lib/activityFeed.ts` | **Nouveau** — `getWeekStats`, `getWeekendGames`, `pickMoments`, `getSuggestedGame` |
| `lib/analytics.ts` | **Nouveau** — `track()` (fondations) |
| `supabase/migrations/analytics_events.sql` | **Nouveau** |
| `supabase/migrations/activity_week_stats.sql` | **Nouveau** — RPC |
| `supabase/migrations/suggested_open_game.sql` | **Nouveau** — RPC Hero |

## Critères de réussite

1. Le fil affiche, dans l'ordre : Ta semaine · Hero · Moments · Week-end · Amis+Fil.
2. Rejoindre (Hero & week-end) envoie une vraie demande (`joinGame`) et bascule `✓ Demandé`.
3. Tap tuile Moment → overlay plein écran, fermeture au tap ; 🔥 fonctionne.
4. Aucun média Moment n'est uploadé (rendu local only).
5. L'`ActivityFeed` historique (filtre, 🔥, commentaires) ne régresse pas.
6. Les places affichées dérivent des joueurs (`freeSpots`), pas de la colonne brute.
7. `tsc` passe.

## Hors-scope (itérations futures)

- Auto-play / durée des Moments (statique au tap pour l'instant).
- Algo Hero raffiné au-delà du score initial (A/B à venir).
- Bilan complet (sous-projet B) — seul le bouton d'entrée est posé ici.
