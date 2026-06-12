# Conflits d'horaire visibles dans le wizard de création

**Date :** 2026-06-12
**Statut :** Design validé
**Fichiers concernés :** `app/(tabs)/CreateWizard.tsx` (composant principal + `MiniCalendar`)

## Problème

La détection de conflit de créneau existe déjà, mais elle est **réactive** : elle ne se
déclenche qu'au moment de **Publier** (`app/(tabs)/lobby.tsx`, autour de la ligne 1927),
sous forme d'`Alert.alert` « ⚠️ Conflit de créneau » qui requête en base les parties du
joueur dans une fenêtre ±2h. Conséquence : le joueur remplit tout le wizard (jour, heure,
terrain, équipe) avant d'apprendre, en fin de parcours, qu'il est déjà pris. C'est un
cul-de-sac.

À l'étape « Quand & Où », les pastilles d'horaire n'ont aujourd'hui que deux états :
sélectionnée et passée (barrée + opacité 0.35, désactivée). Rien n'indique en amont qu'un
créneau entre en conflit, ni qu'un jour contient déjà un match.

## Objectif

Rendre l'information de conflit **proactive et contextuelle**, directement à l'étape du
choix de la date et de l'heure :

1. **Pastilles Jour** — un point discret signale les jours qui contiennent **au moins un
   match** (info, pas forcément un conflit). Présent sur les pastilles rapides ET dans le
   calendrier déroulant (`MiniCalendar`).
2. **Pastilles Heure** — un point + bordure ambre signale les créneaux à **±2h d'un match
   existant** (avertissement de conflit). La pastille reste **cliquable** (override
   volontaire conservé).
3. **Bloc info contextuel** — sous la grille des heures, quand le créneau sélectionné est
   en conflit, on affiche le détail des parties concernées (lieu, date/heure, rôle).

L'alerte de publication reste inchangée : c'est le filet de sécurité final.

## Sémantique des deux signaux

Deux signaux **visuellement distincts** car ils ne disent pas la même chose :

| Signal | Emplacement | Sens | Couleur |
|---|---|---|---|
| Point jour | pastille Jour + case calendrier | « au moins 1 match ce jour-là » (info) | neutre — `Colors.textMuted` |
| Point + bordure ambre | pastille Heure | « ce créneau est à ±2h d'un match » (conflit) | ambre — `Colors.warning` (`#F59E0B`) |

Justification : un match à 09:00 n'entre pas en conflit avec 20:00 le même jour. Marquer
le jour entier en ambre « conflit » serait trompeur. Le point jour est donc neutre ;
l'ambre est réservé au vrai chevauchement ±2h sur l'heure précise.

## Architecture

### Couche données — un seul fetch à l'ouverture du wizard

Plutôt que de re-requêter à chaque changement de jour, on récupère **une fois** (quand le
wizard devient visible) toutes les parties à venir du joueur, puis tout dérive côté client.

Déclenchement : `useEffect` sur `[visible, player?.id]`, ne fetch que lorsque `visible`
est vrai et `player` est défini.

Requêtes (mêmes sources et mêmes libellés de rôle que le pre-check du publish dans
`lobby.tsx`, pour cohérence stricte) :

- `open_games` : `creator_id = player.id`, `status != 'cancelled'`,
  `match_date >= début d'aujourd'hui` → rôle **organisateur**.
- `game_participants` : `player_id = player.id`, `status in ('accepted','pending','invited','waitlist')`,
  jointure `game:game_id(id, location, match_date, status)`, en filtrant côté client les
  parties `cancelled` ou sans `match_date`, et `match_date >= début d'aujourd'hui` →
  rôles **inscrit** (`accepted`) / **candidature** (`pending`) / **invité** (`invited`) /
  **liste d'attente** (`waitlist`).

Pas de borne supérieure de date : un joueur n'a pas des milliers de parties à venir. Le
fetch est one-shot par ouverture du wizard (le wizard est éphémère) — pas de realtime.

Normalisation dans un state :

```ts
type BusyGame = { ts: number; location: string | null; role: string };
const [busyGames, setBusyGames] = useState<BusyGame[]>([]);
```

où `ts = new Date(match_date).getTime()` et `role` est le libellé français ci-dessus.

### Valeurs dérivées (client, `useMemo` ou calcul inline)

Constante partagée : `const OVERLAP_MS = 2 * 60 * 60 * 1000;` (identique au publish).

- **`daysWithGames: Set<string>`** — `localDateStr(new Date(g.ts))` pour chaque `busyGame`.
  Pilote le point sur les pastilles Jour et les cases du calendrier.
- **`occupiedTimes: Set<string>`** — pour le jour sélectionné (`form.day`), l'ensemble des
  `HH:MM` de `TIMES` dont le timestamp `new Date(`${form.day}T${tm}`).getTime()` est à
  `<= OVERLAP_MS` d'au moins un `busyGame.ts`. Pilote l'ambre des pastilles Heure.
- **`selectedConflicts: BusyGame[]`** — les `busyGames` à `<= OVERLAP_MS` de
  `new Date(`${form.day}T${form.time}`).getTime()`. Pilote le bloc info. Vide si pas de
  `form.time`.

Priorité : un créneau **passé** (`isPastSlot`) garde son traitement désactivé/barré et
n'est jamais marqué occupé (de toute façon il ne peut pas être dans une fenêtre future).

## Détail UI

### 1. Point sur les pastilles Jour rapides

Dans le `QUICK_DAYS.map` (≈ ligne 497), calculer `const hasGame = daysWithGames.has(d.val);`
et, si vrai, rendre un petit point neutre (≈ 6 px, `Colors.textMuted`) en position absolue
en haut-à-droite de la pastille. Indépendant de l'état `active`.

### 2. Point dans le calendrier (`MiniCalendar`)

Ajouter un prop `daysWithGames: Set<string>` à `MiniCalendar` et le passer depuis l'appelant
(ligne 523). Dans le rendu des cellules (≈ ligne 173), pour une cellule valide,
`daysWithGames.has(cell.val)` affiche un point neutre discret sous le numéro (ou en
haut-à-droite de la case). Ne pas afficher de point sur les cases invalides/désactivées.

### 3. Pastille Heure « occupée » (cliquable, avertissement)

Dans le `TIMES.map` (≈ lignes 543-558), ajouter
`const occupied = !past && occupiedTimes.has(tm);` et :

- **Bordure ambre** (`Colors.warning`) quand `occupied && !active`. Quand `active`, la
  sélection (fond jaune marque + bordure `eloBorder`) prime sur la bordure.
- **Point ambre** (≈ 6 px, `Colors.warning`) en position absolue en haut-à-droite, rendu
  dès que `occupied` — y compris quand la pastille est sélectionnée, pour que
  l'avertissement ne disparaisse pas une fois le créneau choisi.
- La pastille **reste cliquable** (`disabled` inchangé : uniquement `past`).

### 4. Bloc info contextuel (sous la grille)

Rendu juste après la `</View>` de la grille des heures (≈ ligne 559), **uniquement si**
`form.time && selectedConflicts.length > 0`. Carte « pro » alignée sur le style des cartes
existantes :

- Fond ambre très léger (`rgba(245,158,11,0.08)`), bordure ambre douce, coins arrondis,
  barre d'accent ambre à gauche.
- En-tête : « ⚠️ Tu es déjà pris à ce créneau (±2h) ».
- Une ligne par conflit : « 🗓️ {jour court · HH:MM} · {location ?? '?'} » + le rôle via le
  composant `Pill` existant. Format date via
  `new Date(g.ts).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })`.

## Hors périmètre (YAGNI)

- Pas de souscription realtime (fetch one-shot par ouverture suffit).
- Aucune modification de l'alerte de publication ni du trigger DB `eject_overlapping_candidatures`.
- Pas de regroupement/ déduplication avancée des conflits : on liste tel quel.
- Pas d'indicateur de chargement bloquant : tant que `busyGames` n'est pas chargé, aucune
  pastille n'est marquée (dégradation silencieuse, acceptable vu la rapidité du fetch).

## Risques / points d'attention

- **Cohérence avec le publish** : les libellés de rôle et la fenêtre ±2h doivent rester
  identiques à `lobby.tsx`. Si l'un évolue, l'autre doit suivre (envisager une constante /
  helper partagé à terme, hors périmètre ici).
- **Fuseau horaire** : réutiliser exactement la construction `new Date(`${day}T${time}`)`
  déjà employée par `isPastSlot`, pour éviter tout décalage entre marquage et alerte.
- **Performance du calendrier** : `daysWithGames` est un `Set`, lookup O(1) par cellule —
  aucun impact.
