# Historique : partage story enrichi + gestion des comptes supprimés

> Design validé le 2026-06-11. PAG MATCH (react-matchup, React Native / Expo).
> Deux features rattachées à l'historique des matchs.

## Contexte

Beaucoup d'infrastructure existe déjà :

- **Partage en story** : `StoryComposerV2` (mode « Match »), registre de styles `components/story/StoryStyles.tsx`, sélecteur de match `StoryMatchPicker.tsx`. Export PNG 100 % local (capture → partage natif / galerie), aucun média serveur. Aujourd'hui accessible **uniquement** depuis l'historique du profil (`app/(tabs)/player/[id].tsx`, fonction `shareMatch`, tap sur une ligne).
- **Comptes supprimés** : suppression = **soft-delete** (`supabase/migrations/soft_delete_deleted_at.sql`). La ligne `players` est conservée mais anonymisée : `name = 'Compte supprimé'`, `deleted_at = now()`, `user_id = NULL`. Les lignes `matches` / `elo_history` sont préservées pour ne pas corrompre l'ELO des adversaires.

Problèmes / manques identifiés :

1. Le partage de story n'est **pas exposé dans l'onglet « Historique » du lobby** (`app/(tabs)/lobby.tsx`, `HistoryTab` → `MatchCard` / `MatchDetailSheet`).
2. La personnalisation du mode Match est limitée (2 templates : « Score Hero », « Ticket »).
3. **Bug rejouer** : `handleRematch` (`lobby.tsx:2146`) requête les joueurs **sans filtrer `deleted_at`** → crée une invitation pour le compte fantôme, qui ne pourra jamais accepter (plus d'auth) → créneau bloqué à vie.
4. L'historique et les stories affichent littéralement « Compte supprimé ».
5. Les stats « Partenaire favori » / « Bête noire » sont agrégées **par nom** → tous les supprimés tombent dans un même bucket « Compte supprimé ».
6. Navigation vers le profil d'un compte supprimé non gérée ; défi/invitation possible vers un supprimé.

## Périmètre validé

- Feature 1 : exposer le partage dans l'onglet Historique du lobby **+** enrichir la personnalisation (plus de templates, sélecteur couleur/thème, toggles d'éléments, légende + photo de fond).
- Feature 2 : fix rejouer (sauter le supprimé, créneau ouvert) + affichage générique par rôle + navigation profil bloquée + stats partenaire/bête noire nettoyées + défier désactivé.

Hors périmètre : suppression « dure » des lignes `matches` ; refonte du flux de suppression de compte.

## Socle commun

Helper centralisé (nouveau `lib/players.ts`, ou ajout à un util existant) :

- `isDeleted(p)` → `!!p?.deleted_at` (secours : `p?.name === 'Compte supprimé'`).
- `displayName(p, role)` → si supprimé, libellé générique selon le rôle :
  - `role: 'partner'` → `'Partenaire'`
  - `role: 'opponent'` → `'Adversaire'`
  - défaut → `'Joueur'`
  - sinon → `p.name`.

Requêtes `matches` : ajouter `id, deleted_at` aux jointures `winner/loser/winner_2/loser_2`, dans :
- `app/(tabs)/player/[id].tsx` (sélecteur du `Promise.all`)
- `app/(tabs)/lobby.tsx` (sélecteur des matches, `*, winner:winner_id(...)` → enrichir les sous-sélections)
- `components/StoryMatchPicker.tsx`

Les types `MatchRow` correspondants gagnent `id` + `deleted_at` sur les joueurs joints.

## Feature 1 — Partage dans le lobby + personnalisation

### 1a. Exposer dans l'onglet Historique du lobby

- Factoriser la construction de `StoryMatchData` (logique actuelle de `shareMatch` dans `player/[id].tsx`) dans un helper réutilisable (ex. `buildStoryMatch(match, playerId, eloDelta?)`), pour éviter la duplication entre profil et lobby.
- `MatchCard` et `MatchDetailSheet` (`lobby.tsx`) reçoivent un callback `onShare(match)` et affichent un bouton « Partager 📸 ».
- `LobbyScreen` monte `StoryComposerV2` (+ `storyMatch`, `composerOpen`, `storyPlayer`, `storyInvite`) comme le fait déjà `player/[id].tsx`. Le `storyPlayer` du lobby se construit depuis le `player` courant (contexte `usePlayer`).
- `eloDelta` est optionnel dans le lobby (la map `eloChangeByMatch` est spécifique au profil) → on l'omet si indisponible.

### 1b. Personnalisation enrichie (mode Match)

Un panneau de réglages sous l'aperçu live de `StoryComposerV2` (visible en mode Match) :

- **Templates** : ajouter 2–3 styles dans `STORY_REGISTRY.match` au-delà de Score Hero / Ticket (ex. *Minimal*, *Gradient*, *Néon*) — implémentés comme les composants existants dans `StoryStyles.tsx`.
- **Sélecteur couleur/thème** : liste d'accents (jaune marque, sombre, clair…). L'accent choisi est passé en prop aux composants de carte et applique la couleur d'accent/fond.
- **Toggles d'éléments** : afficher/masquer `eloDelta`, `location`, `date`, `type`, QR, logo. État booléen passé en props ; chaque template respecte les toggles.
- **Légende + photo de fond** : champ texte libre (légende affichée sur la carte) + photo de fond optionnelle derrière le score (réutilise le pipeline `ImagePicker` / `photoUri` déjà présent pour le mode Photo).

Contrat des composants de `StoryStyles.tsx` (mode match) étendu pour accepter : `accentId`, `toggles`, `caption`, `backgroundUri`. Valeurs par défaut = comportement actuel (rétro-compatible).

## Feature 2 — Comptes supprimés

### Rejouer (fix bug)

Dans `handleRematch` (`lobby.tsx:2146`) :
- La requête `players ... .in('id', allIds)` ajoute `.is('deleted_at', null)`.
- Les ids supprimés ne produisent pas d'entrée dans `invites` (slot laissé vide → la partie reste ouverte, n'importe qui peut rejoindre).
- Si au moins un joueur a été écarté : `Alert` informatif, ex. « 1 joueur n'est plus sur l'app — sa place reste libre dans la partie. » (pluriel géré).
- Si **tous** les autres joueurs sont supprimés → message clair, on ouvre quand même la création avec les slots libres (pas de blocage).

### Affichage générique par rôle

- `HistoryRow` (`player/[id].tsx`) et les cartes/détails du lobby utilisent `displayName(p, role)` au lieu du nom brut.
- `StoryMatchPicker.handlePick` et `buildStoryMatch` mappent les noms supprimés vers les libellés génériques → la story ne montre jamais « Compte supprimé ».
- Détermination du rôle : un joueur de mon équipe (hors moi) = `partner` ; un joueur de l'équipe adverse = `opponent`.

### Navigation profil bloquée

- Garde unique dans l'écran `app/(tabs)/player/[id].tsx` : après chargement, si `profile.deleted_at` est défini, afficher un état dédié « Ce compte a été supprimé » (titre + sous-texte + retour) au lieu du profil complet. Couvre **tous** les chemins de navigation d'un coup.
- Les libellés génériques (« Adversaire »/« Partenaire ») ne sont pas rendus cliquables.

### Stats partenaire / bête noire

- Dans le calcul `partnerWins` / `opponentLoss` (`player/[id].tsx:858-874`) : agréger par **id de joueur** (pas par nom) et **exclure les supprimés** (`isDeleted`).
- Pour l'affichage final, résoudre l'id → nom du joueur actif. Plus aucun « Partenaire favori / Bête noire : Compte supprimé ».

### Défier désactivé

- Bouton « Défier » / invitation directe désactivé (grisé) si la cible est supprimée. En pratique couvert par la garde profil (on n'atteint plus le profil d'un supprimé), mais on durcit aussi tout point d'entrée d'invitation qui pourrait référencer un id supprimé.

## Tests

- **Unitaire** : `isDeleted` / `displayName` — joueur actif, supprimé, et utilisateur FRMT importé (`user_id = NULL` mais `deleted_at = NULL` → considéré actif).
- **Unitaire / logique** : `handleRematch` — 0, 1 et 2 joueurs supprimés → `invites` corrects, slots libres, alerte avec bon pluriel.
- **Manuel (Expo)** :
  1. Partager un match depuis l'onglet Historique du lobby.
  2. Personnalisation : changer template, accent, toggles, légende, photo de fond → aperçu + export PNG.
  3. Historique (profil + lobby) avec un match contenant un compte supprimé → libellés génériques, pas de « Compte supprimé ».
  4. Rejouer un match avec un supprimé → invitation correcte, slot libre, alerte.
  5. Ouvrir le profil d'un compte supprimé → état « compte supprimé ».
  6. Stats profil → pas de supprimé en partenaire/bête noire.

## Notes de migration / données

- Aucune migration SQL nouvelle requise : `players.deleted_at` existe déjà (`soft_delete_deleted_at.sql`). On exploite seulement la colonne côté requêtes/UI.
- Conforme à la note mémoire « Stories local, sans stockage » : aucun média serveur ajouté.
