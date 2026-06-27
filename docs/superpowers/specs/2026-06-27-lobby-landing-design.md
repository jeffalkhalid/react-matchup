# Ouvrir l'app sur le Lobby + cloche de notifs sur tous les onglets + état vide actif

**Date :** 2026-06-27
**Statut :** Design validé, prêt pour plan d'implémentation
**App :** PAG MATCH (react-matchup)

## Problème / intention

À l'ouverture, l'app démarre sur l'écran **Accueil** (un dashboard : bannière profil,
grille d'actions, carte Communauté). Pour une app de matchmaking padel, l'intention
dominante de l'utilisateur qui ouvre l'app est *« qu'est-ce qu'il y a à jouer / qui
cherche un 4e »*. On veut donc **ouvrir directement sur le Lobby** (page d'exploration
des parties ouvertes) pour réduire la friction vers l'action qui fait vivre l'app
(rejoindre = remplir les parties = liquidité).

Deux risques à couvrir en même temps :

1. **Visibilité des notifications.** La cloche de notifs vit aujourd'hui uniquement
   sur Accueil ([index.tsx:50-164](../../../app/(tabs)/index.tsx)). Si on n'ouvre plus
   sur Accueil, l'utilisateur ne voit plus ses notifs au démarrage. → On rend la cloche
   présente sur tous les onglets principaux.
2. **État vide du Lobby.** Au lancement Maroc (cold-start, peu de parties), ouvrir sur
   une liste vide donne une impression d'app morte. → On muscle l'état vide avec un CTA
   de création.

## Décisions de cadrage

- **Accueil reste un onglet** de la navbar, intact. On ne change que l'écran de départ.
- **La navbar n'est PAS refondue** : toujours 5 boutons
  (Accueil · Activité · ⊕ Créer · Défi · Chats). Le Lobby reste accessible via le bouton
  central ⊕ (qui ouvre `lobby?create=1`) — il devient juste aussi l'écran initial.
- **Cloche sur les 5 onglets principaux** (Lobby, Accueil, Activité, Défi, Chats).
- **Hors scope (YAGNI) :** refonte navbar, tri géo « près de moi », modification de la
  logique de comptage des notifs.

## Composants & changements

### 1. Écran d'ouverture → Lobby

**Fichier :** [app/(tabs)/_layout.tsx](../../../app/(tabs)/_layout.tsx)

Ajouter en haut du module :

```ts
export const unstable_settings = { initialRouteName: 'lobby' };
```

- API native et stable d'expo-router (le préfixe `unstable_` est hérité de Next.js).
  Déclaratif, 1 ligne, pas de flash d'écran.
- **Rejeté :** rediriger depuis `index` via `<Redirect>` → monte Accueil puis saute
  (flash visuel + double rendu, casse le retour natif).
- Le bouton central ⊕ continue de pousser `lobby?create=1` : même écran, param
  différent, aucun conflit. Le Lobby ouvre alors l'onglet **Explorer** par défaut.

**Vigilance :** vérifier que `initialRouteName` ne court-circuite pas la redirection
auth du `_layout` racine — un utilisateur déconnecté doit toujours arriver sur login,
pas sur le lobby.

### 2. Cloche de notifs réutilisable (`NotificationBell`) + cluster `HeaderActions`

Aujourd'hui la cloche (icône animée swing + anneau pulse + badge compteur + déclenchement
de la modale badges) est codée en dur dans
[index.tsx:50-164](../../../app/(tabs)/index.tsx).

**2a. Extraire `components/NotificationBell.tsx`** — composant autonome, sur le modèle de
`ProfileAvatarButton` :

- Props : `count: number`, `onPress: () => void`, `tint?: 'light' | 'dark'`
  (couleur d'icône : la cloche doit passer sur header sombre Lobby/Accueil ET sur les
  headers plus clairs Activité/Chats).
- Conserve l'animation existante (swing 2,6 s / pulse 1,8 s) et le badge (`9+` au-delà
  de 9).
- Ne porte AUCUNE logique métier : juste l'affichage + `onPress`.

**2b. Créer `components/HeaderActions.tsx`** — cluster unique pour le coin haut-droit :

- Affiche `[NotificationBell] [ProfileAvatarButton]` côte à côte (`flexDirection: 'row'`,
  `alignItems: 'center'`, petit `gap`).
- Props de position : `top`, `right` (chaque écran garde ses coordonnées actuelles), et
  `tint` propagé à la cloche.
- Lit le total de notifs via le hook partagé **`useNotificationCount`** (source unique,
  déjà utilisée par la cloche d'Accueil — on ne duplique pas le comptage).
- `onPress` cloche par défaut → `router.push('/notifications')`.

**2c. Brancher sur les 5 onglets** — remplacer les placements actuels de
`ProfileAvatarButton` par `<HeaderActions top=… right=… tint=… />` dans :

- [app/(tabs)/lobby.tsx:2630](../../../app/(tabs)/lobby.tsx) — `tint="light"` (header sombre)
- [app/(tabs)/index.tsx:546](../../../app/(tabs)/index.tsx) — voir 2d ci-dessous
- [app/(tabs)/activite.tsx:152](../../../app/(tabs)/activite.tsx)
- [app/(tabs)/matchmaking.tsx:599](../../../app/(tabs)/matchmaking.tsx)
- [app/(tabs)/chats.tsx:100](../../../app/(tabs)/chats.tsx)

> Note : `ranking.tsx` porte aussi un `ProfileAvatarButton` mais n'est pas un onglet
> principal (masqué de la navbar). Hors périmètre validé — on le laisse tel quel pour
> l'instant (ou on l'aligne si trivial, sans en faire un objectif).

**2d. Cas particulier Accueil — modale badges.** Sur Accueil, la cloche déclenche AUSSI
la modale « distribue tes badges » via le param `?openBadge=1`. Ce comportement reste
spécifique à Accueil :

- Le composant `NotificationBell`/`HeaderActions` extrait fait uniquement
  « aller aux notifs ».
- Sur Accueil, soit on conserve la cloche actuelle telle quelle (intégrée au
  `ProfileBanner`), soit `HeaderActions` y pointe aussi vers `/notifications` et la
  modale badges reste accessible depuis l'écran `/notifications` (qui liste déjà tout,
  badges inclus). **Décision retenue : `/notifications` comme destination unique de la
  cloche partout** ; on ne réimplémente pas la modale badges hors d'Accueil. La cloche
  historique du `ProfileBanner` est remplacée par le comportement standard pour rester
  cohérente avec les autres onglets.

### 3. État vide « Explorer » avec CTA création

**Fichier :** [app/(tabs)/lobby.tsx:1521](../../../app/(tabs)/lobby.tsx)

Le vrai état vide (aucune partie, sans filtre actif) est aujourd'hui un `<EmptyState>`
texte seul. On ajoute un **bouton « ＋ Créer une partie »** qui ouvre le wizard de
création (même mécanisme que le bouton central ⊕ : ouverture via le param/état `create`
du lobby).

- `ExploreTab` reçoit un nouveau callback `onCreate: () => void` (déclenche l'ouverture
  du `CreateWizard` au niveau du parent `lobby.tsx`).
- Message adapté au cold-start, ex. titre « Aucune partie pour l'instant » + sous-texte
  « Sois le premier à lancer une partie aujourd'hui » + bouton CTA.
- Ne pas toucher l'état vide « filtre actif » (qui a déjà son bouton
  « Réinitialiser les filtres »).

## Critères de réussite

- À froid, l'app ouverte (connecté) affiche le Lobby, onglet Explorer.
- Un utilisateur déconnecté arrive toujours sur l'écran de login.
- La cloche (avec badge compteur correct) est visible en haut à droite des 5 onglets
  principaux, lisible sur fond sombre comme clair.
- Taper la cloche ouvre `/notifications` depuis n'importe quel onglet.
- Le compteur de la cloche reste identique partout (un seul `useNotificationCount`).
- Quand aucune partie n'est disponible, l'Explorer affiche un CTA qui ouvre le wizard de
  création.
- `tsc` passe sans erreur.

## Tests / vérification

- Typecheck (`tsc`) vert.
- Vérif device Expo : ouverture à froid → Lobby ; cloche présente et cliquable sur les 5
  onglets ; badge correct ; CTA état vide fonctionnel (compte de test sans partie) ;
  rendu cloche correct sur header sombre et clair ; flux login déconnecté intact.
