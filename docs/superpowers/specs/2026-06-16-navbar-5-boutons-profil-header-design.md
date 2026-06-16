# Navbar 5 boutons + Profil en avatar d'en-tête

**Date :** 2026-06-16
**Statut :** Design validé, prêt pour le plan d'implémentation

## Contexte

La navbar à **7 boutons** (Accueil · Défi · Activité · ⊕Créer · Alertes · Chats · Profil — cf. `project_navbar_7_onglets`) rend la barre trop chargée sur mobile. On revient à **5 boutons** (2 · Créer · 2). Profil sort de la barre et devient un **avatar en haut à droite** présent sur chaque page principale ; il ouvre le profil complet refondu (header sombre + onglets + burger ☰, cf. `project_profil_direct_burger`).

État de départ de la barre : [app/(tabs)/_layout.tsx](../../../app/(tabs)/_layout.tsx) déclare les écrans visibles `index` (Accueil), `matchmaking` (Défi), `activite` (Activité), `lobby` (Créer, FAB surélevé), `alertes` (Alertes), `chats` (Chats), `profile` (Profil, avatar+badge), plus les écrans cachés (`href: null`).

## Objectif

1. Navbar à **5 boutons symétriques** : `Accueil · Activité · ⊕Créer · Défis · Chats`.
2. **Profil** quitte la barre → **avatar dans l'en-tête** (coin haut-droit) de chaque page principale, qui ouvre le profil complet.
3. **Alertes** quitte la barre → reste accessible via le **hub Communauté** (Accueil → Communauté → Alertes), comme avant la navbar à 7.

## Décisions validées

- Ordre exact : **Accueil · Activité · ⊕Créer · Défis · Chats**. Le bouton Créer surélevé retrouve le centre exact (2 onglets de chaque côté).
- Libellé **« Défi »** conservé tel quel (pas « Défis »).
- Avatar top-right = **initiale seule** (couleur de ligue), pas de photo — cohérent avec le reste de l'app.
- Avatar **sans badge** (Défi et Chats gardent leurs badges respectifs ; pas de doublon).
- Tap sur l'avatar → ouvre `/player/[monId]` en **écran poussé avec flèche retour** (le burger ☰ + Modifier restent dans ce profil).

## Architecture

### 1. Navbar (`app/(tabs)/_layout.tsx`)

- Ordre des `Tabs.Screen` visibles : `index`, `activite`, `lobby` (FAB), `matchmaking`, `chats`.
- **Retirer de la barre** les onglets `alertes` et `profile`.
- Le FAB Créer (surélevé, `translateY -18`) reste tel quel ; avec 2+2 onglets il est de nouveau parfaitement centré.
- Badges inchangés : `matchmaking` (défis reçus), `chats` (non-lus). L'avatar/badge `profile` disparaît de la barre.

### 2. Avatar Profil d'en-tête — nouveau composant `components/ProfileAvatarButton.tsx`

- Petit avatar rond (~34-38px) affichant l'initiale du joueur sur fond couleur de ligue, avec une légère bordure, posé en haut à droite.
- `onPress` → `router.push('/player/${self.id}')` (profil complet poussé, avec retour).
- Props minimales pour s'adapter au fond de chaque en-tête (ex. `size?`, `style?`) ; lit le joueur courant via `usePlayer`.
- Intégré dans le coin haut-droit de l'en-tête des **écrans principaux** : Accueil ([index.tsx](../../../app/(tabs)/index.tsx)), Activité ([activite.tsx](../../../app/(tabs)/activite.tsx)), Créer/lobby ([lobby.tsx](../../../app/(tabs)/lobby.tsx)), Défis ([matchmaking.tsx](../../../app/(tabs)/matchmaking.tsx)), Chats ([chats.tsx](../../../app/(tabs)/chats.tsx)).
- Écrans secondaires (Classement, Notifications, profil lui-même…) : **non concernés** (ils ont déjà une navigation retour).

### 3. Suppression de l'onglet Profil

- Supprimer `app/(tabs)/profile.tsx` (Profil n'est plus un onglet ; il est atteint par l'avatar via `/player/[monId]`).
- `PlayerProfile` (export nommé de `player/[id].tsx`) et le burger **restent** (utilisés par la route poussée).
- Le chemin `asTab`/`hideBack` n'a plus de consommateur (seul `profile.tsx` l'utilisait) ⇒ on **retire** la prop `asTab` de `PlayerProfile` et l'usage `hideBack={asTab}`. La flèche retour s'affiche donc **toujours** (cohérent : le profil est désormais toujours poussé). La prop `hideBack` de `ProfileHeader` peut rester (inoffensive) ou être retirée — au choix de l'implémentation, sans impact fonctionnel.

### 4. Suppression de l'onglet Alertes

- Supprimer `app/(tabs)/alertes.tsx`.
- Le composant `components/community/AlertsList.tsx` **reste** (utilisé par l'écran poussé `app/community/alerts.tsx`, lui-même atteint depuis le hub Communauté).

## Fichiers touchés

| Fichier | Action |
|---|---|
| `app/(tabs)/_layout.tsx` | Retirer les `Tabs.Screen` `alertes` et `profile` ; réordonner en `index · activite · lobby · matchmaking · chats` ; retirer le `IconBell`/avatar devenus inutiles si plus référencés |
| `components/ProfileAvatarButton.tsx` | **Nouveau** — avatar rond → push `/player/[monId]` |
| `app/(tabs)/index.tsx` | Ajouter l'avatar en haut à droite de l'en-tête |
| `app/(tabs)/activite.tsx` | Idem |
| `app/(tabs)/lobby.tsx` | Idem |
| `app/(tabs)/matchmaking.tsx` | Idem |
| `app/(tabs)/chats.tsx` | Idem |
| `app/(tabs)/player/[id].tsx` | Retirer la prop `asTab` de `PlayerProfile` + l'usage `hideBack={asTab}` |
| `app/(tabs)/profile.tsx` | **Supprimer** |
| `app/(tabs)/alertes.tsx` | **Supprimer** |

⚠️ Vérifier à l'implémentation qu'aucun code ne pousse encore vers `/(tabs)/profile` ou `/(tabs)/alertes` (sinon repointer vers `/player/[id]` ou `/community/alerts`).

## Critères de réussite

1. La navbar montre 5 boutons : `Accueil · Activité · ⊕Créer · Défis · Chats`, Créer centré et surélevé.
2. Les onglets Alertes et Profil ne sont plus dans la barre. Alertes reste atteignable via le hub Communauté.
3. Un avatar Profil (initiale, couleur de ligue, sans badge) est en haut à droite des 5 écrans principaux ; tap → profil complet poussé avec retour + burger.
4. Aucun lien mort vers `/(tabs)/profile` ou `/(tabs)/alertes`.
5. Le profil complet (vue moi et vue autre joueur) fonctionne comme avant (burger, Modifier, Suivre/Défier).
6. `tsc` passe.

## Contraintes & réversibilité

- Travail **directement sur `main`**, **sans branche ni commit** (l'utilisateur commitera lui-même). Vérification = `npx tsc --noEmit` + contrôle visuel Expo (manuel).
- Mixte additif/soustractif : un nouveau composant avatar + ajouts dans 5 en-têtes (additif) ; suppression de 2 fichiers d'onglet et retrait de 2 entrées de navbar (soustractif). Revert = manuel (pas de filet git puisque pas de commit).

## Hors-scope (futur)

- Toute refonte visuelle des en-têtes au-delà de l'ajout de l'avatar.
- Badge de notifications sur l'avatar (écarté pour l'instant).
- Avatar sur les écrans secondaires (poussés, déjà dotés d'un retour).
