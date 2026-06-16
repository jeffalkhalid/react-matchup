# Profil → profil complet direct + menu burger

**Date :** 2026-06-16
**Statut :** Design validé, prêt pour le plan d'implémentation

## Contexte

Aujourd'hui l'onglet **Profil** de la navbar ouvre [app/(tabs)/profile.tsx](../../../app/(tabs)/profile.tsx), un **hub de menu** (~537 lignes) : header sombre maison + cartes de notifications + cartes de navigation (« Mon Profil complet », « Défi », « Classement », « Notifications ») + section Compte (Modifier le profil, Qui peut commenter, Se déconnecter) + Légal (Confidentialité, CGU) + Supprimer le compte. « Mon Profil complet » redirige vers le **vrai** profil [app/(tabs)/player/[id].tsx](../../../app/(tabs)/player/[id].tsx) (refonte « Profil PagMatch » : header sombre + onglets Stats/Matchs/Palmarès/Badges).

Le profil complet sait déjà afficher « mon profil » (`isSelf = self?.id === id`), contient déjà son **modal Modifier le profil**, et son header (`ProfileHeader` dans [components/profile/components.tsx](../../../components/profile/components.tsx)) montre pour soi **↗ Partager + ✏️ Modifier** (et un kebab « … » de modération pour les autres).

## Objectif

1. L'onglet **Profil** ouvre **directement le profil complet** de l'utilisateur courant (plus de hub intermédiaire), en gardant l'onglet surligné dans la navbar.
2. Tout l'ancien menu (réglages, raccourcis, légal, déconnexion, suppression) est rangé dans un **burger ☰** à l'intérieur du profil complet (vue « moi »).

## Décisions validées

- **Contenu du burger : tel quel** (cf. ci-dessous). « Défi » est retiré (il a déjà son onglet navbar) ; « Classement » et « Notifications » restent (pas d'onglet dédié).
- **Cartes de notifications retirées** du profil : accessibles via la cloche de l'Accueil et l'entrée « Notifications » du burger.

## Architecture

### 1. Routage — Profil = profil complet, onglet surligné

`player/[id].tsx` est scindé sans réécriture du corps :

- **Export par défaut** = wrapper de route mince : lit `id` via `useLocalSearchParams` et rend `<PlayerProfile id={id} />`.
- **Export nommé** `PlayerProfile({ id, asTab }: { id: string; asTab?: boolean })` = tout le corps actuel de l'écran (états, data, header, onglets, modals), où `id` vient désormais des props au lieu de `useLocalSearchParams`.

`profile.tsx` devient un onglet mince :

```tsx
import { usePlayer } from '../../hooks/usePlayer';
import { PlayerProfile } from './player/[id]';

export default function ProfileTab() {
  const { player } = usePlayer();
  if (!player) return null;
  return <PlayerProfile id={player.id} asTab />;
}
```

- L'onglet `profile` de la navbar (`app/(tabs)/_layout.tsx`) **ne change pas** (toujours `name="profile"`, icône avatar) → il reste surligné, puisque la route active reste `profile`.
- `asTab` (vue racine « moi ») **masque la flèche retour** du header (aucun historique). Quand on arrive sur `/player/[monId]` par navigation (deep-link, tap sur son avatar ailleurs), `asTab` est absent → la flèche retour reste.
- Le wrapper par défaut reste un export `default` ⇒ expo-router ne route que lui ; l'export nommé `PlayerProfile` n'est pas une route.

### 2. Burger ☰ dans le header (vue « moi »)

Dans `ProfileHeader` (components/profile/components.tsx), pour `isSelf` :

- Coin haut-droit = **↗ Partager + ☰ Burger** (on **retire l'icône ✏️** du coin ; l'édition reste accessible via le gros bouton « Modifier le profil » sous l'identité, inchangé, + une ligne du burger).
- Le ☰ appelle `props.onMenu` (réutilisé : pour soi il pointe désormais vers l'ouverture du burger ; pour les autres il garde la modération).
- Icône : ☰ (trois traits) quand `isSelf`, kebab « … » sinon. Ajouter une prop `hideBack?: boolean` (pilotée par `asTab`) pour masquer la flèche retour.

Le burger ouvre une **feuille (bottom sheet)** `ProfileMenuSheet` (nouveau composant `components/profile/ProfileMenuSheet.tsx`), même style que les sheets existants (poignée + lignes icône/label), avec les groupes :

| Groupe | Entrées | Action |
|---|---|---|
| Compte | Modifier le profil | ouvre le modal Edit existant (`openEdit`) |
| | Qui peut commenter | ouvre `CommentsPolicyModal` (extrait) |
| Raccourcis | Classement | `router.push('/(tabs)/ranking')` |
| | Notifications | `router.push('/notifications')` |
| Admin (si `player.is_admin`) | Panel Arbitre | `router.push('/admin')` |
| Légal | Confidentialité | `router.push('/legal/confidentialite')` |
| | Conditions d'utilisation | `router.push('/legal/cgu')` |
| (bas) | Se déconnecter | `signOut()` (via `usePlayer`) |
| (bas) | Supprimer mon compte | ouvre `DeleteAccountModal` (extrait) |

### 3. Modals partagés

- **Modifier le profil** : déjà dans `player/[id].tsx` (réutilisé via `openEdit`).
- **CommentsPolicyModal** et **DeleteAccountModal** : **extraits** depuis `profile.tsx` vers un fichier partagé `components/profile/AccountModals.tsx` (exports nommés), consommés par `PlayerProfile` (montés quand `isSelf`) et déclenchés par le burger. `DeleteAccountModal` appelle la RPC `delete_my_account` puis `signOut` (logique inchangée).
- `signOut` provient de `usePlayer`.

### 4. Nettoyage de `profile.tsx`

`profile.tsx` passe de ~537 lignes à ~10 (le wrapper d'onglet). Tout le reste est supprimé : `NavRow`, `NotifRow`, `SectionHeader`, `Card`, `LeaguePill`, le hero, la section Notifications (cartes retirées), les cartes de navigation, et ses définitions de modals (Edit hub, CommentsPolicy, Delete) — les deux derniers étant désormais dans `AccountModals.tsx`.

## Fichiers touchés

| Fichier | Action |
|---|---|
| `app/(tabs)/player/[id].tsx` | Scinder : wrapper `default` + export nommé `PlayerProfile({ id, asTab })` ; `id` en prop ; `asTab`→`hideBack` ; brancher le burger (`onMenu`=ouvrir le sheet quand self) ; monter `ProfileMenuSheet` + `CommentsPolicyModal` + `DeleteAccountModal` quand self |
| `app/(tabs)/profile.tsx` | Remplacer tout le contenu par le wrapper d'onglet mince |
| `components/profile/components.tsx` | `ProfileHeader` : self → ↗ + ☰ (retirer ✏️ du coin) ; icône burger vs kebab ; prop `hideBack` |
| `components/profile/ProfileMenuSheet.tsx` | **Nouveau** — la feuille du menu burger |
| `components/profile/AccountModals.tsx` | **Nouveau** — `CommentsPolicyModal` + `DeleteAccountModal` extraits de `profile.tsx` |

## Critères de réussite

1. Taper l'onglet **Profil** ouvre directement le profil complet de l'utilisateur (header sombre + onglets), **sans** passer par l'ancien hub, et l'icône Profil de la navbar reste **surlignée**.
2. En vue « moi », le header montre **↗ + ☰** ; pas de flèche retour. En vue d'un autre joueur, comportement inchangé (retour + kebab modération + Suivre/Défier).
3. Le burger ouvre la feuille avec les entrées validées et chacune fait son action (édition, commentaires, classement, notifications, admin si admin, légal, déconnexion, suppression).
4. Les cartes de notifications ne sont plus sur le profil.
5. `profile.tsx` est réduit au wrapper ; aucune régression de `player/[id].tsx` pour la vue d'un autre joueur.
6. `tsc` passe.

## Contraintes & réversibilité

- Travail **directement sur `main`**, **sans branche ni commit** (cf. préférence utilisateur). Vérification = `npx tsc --noEmit` + contrôle visuel Expo (manuel).
- ⚠️ **Pas 100 % additif** : `profile.tsx` est vidé ; `player/[id].tsx` et `components/profile/components.tsx` (qui portent déjà des modifications non commitées) sont retouchés. Le revert est **manuel** (pas de filet git puisque pas de commit). En atténuation : les modals et la logique sont **déplacés, pas réécrits** (comportement préservé), et le profil complet d'un autre joueur n'est pas modifié dans son rendu.

## Hors-scope (futur)

- Refonte visuelle de la feuille burger au-delà du style sheet existant.
- Toute modification du contenu des onglets du profil complet (Stats/Matchs/Palmarès/Badges).
- Nettoyage d'éventuels autres points d'entrée vers `/player/[monId]`.
