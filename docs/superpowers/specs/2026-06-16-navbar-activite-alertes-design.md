# Navbar — intégration des onglets « Activité » et « Alertes »

**Date :** 2026-06-16
**Statut :** Design validé, prêt pour le plan d'implémentation

## Contexte

La barre d'onglets actuelle ([app/(tabs)/_layout.tsx](../../../app/(tabs)/_layout.tsx)) compte 5 boutons :

`Accueil · Défi · ⊕ Créer · Chats · Profil`

- Le bouton **Créer** (au centre) est le seul mis en valeur : rond plein `Colors.primary`, libellé « Créer ». Il ne mène pas à un écran d'onglet classique mais pousse `/(tabs)/lobby?create=1`.
- Les autres onglets suivent un style sobre commun : icône SVG au trait (strokeWidth 2, type Lucide — `IconHome`, `IconSwords`, `IconMessage`), libellé `fontSize 10` majuscule, couleur active `Colors.primary` / inactive `Colors.textMuted`.
- Badges : **Défi** (défis reçus), **Chats** (messages non lus), **Profil** (badge total sur l'avatar).

Deux destinations sociales vivent aujourd'hui **hors** du groupe `(tabs)`, atteintes via le hub Communauté (Accueil → Communauté) :

- **Activité** : le fil d'activité des amis, intégré dans [app/community/friends.tsx](../../../app/community/friends.tsx) (écran « Mes amis » avec un sélecteur `Activité | Recherche`).
- **Alertes** : la liste des alertes, [app/community/alerts.tsx](../../../app/community/alerts.tsx) (« Mes alertes » + « Créer une alerte »).

## Objectif

Faire remonter **Activité** et **Alertes** en onglets de premier niveau dans la navbar, sans perdre aucun bouton existant, en gardant **exactement** le style visuel actuel, et de façon **réversible**.

## Agencement retenu — 7 boutons, symétrie 3·centre·3

`Accueil · Défi · Activité · ⊕ Créer · Alertes · Chats · Profil`

- Groupe gauche : **Accueil · Défi · Activité** (Activité collée au centre).
- Centre : **Créer**, surélevé.
- Groupe droite : **Alertes · Chats · Profil** (Chats juste avant Profil, qui reste à l'extrême droite par convention).

Alternatives écartées : 6 boutons à plat sans FAB (perd la mise en valeur de Créer) ; FAB centré asymétrique 3/2 (moins propre que la symétrie parfaite obtenue avec un 6ᵉ onglet feature). Le choix d'**Alertes** comme 6ᵉ feature a été validé par l'utilisateur.

## Détail des composants

### 1. Bouton Créer surélevé

On garde le **même** bouton rond `Colors.primary` qu'aujourd'hui (`CreateTabButton`), simplement **remonté** au-dessus de la barre :

- `transform: translateY(-22)` (valeur à ajuster au rendu device), bordure blanche (`borderWidth` ~4, `borderColor` `Colors.bgCard`) pour le détacher de la barre.
- La barre doit **autoriser le débordement** (le bouton dépasse en haut) : vérifier `overflow: 'visible'` sur le conteneur de tab bar et/ou augmenter légèrement la zone haute, sans casser le rendu Android (où `overflow` + `elevation` peut rogner). Solution de repli si rognage : réduire l'amplitude de la surélévation.
- Couleur, libellé, action (`router.push('/(tabs)/lobby?create=1')`) **inchangés**.

### 2. Onglet Activité (fil seul)

- Nouvel écran d'onglet `app/(tabs)/activite.tsx` qui affiche **uniquement le fil d'activité** des amis (pas le sélecteur `Recherche`).
- Pour éviter la duplication tout en laissant le hub intact : **extraire** le corps `ActivityBody` de `friends.tsx` dans un composant réutilisable `components/community/ActivityFeed.tsx`. `friends.tsx` continue de le rendre dans son onglet « Activité » (comportement du hub **identique**), et le nouvel onglet le rend aussi.
- En-tête : titre simple (« Activité »), **sans bouton retour** (onglet racine).
- Évolutif : l'utilisateur enrichira ce fil plus tard — garder le composant isolé et facile à étendre.

### 3. Onglet Alertes

- Nouvel écran d'onglet `app/(tabs)/alertes.tsx` affichant la liste d'alertes.
- **Extraire** le corps de la liste de `alerts.tsx` dans `components/community/AlertsList.tsx`, réutilisé par l'écran poussé existant (`/community/alerts`, conservé pour le hub) et le nouvel onglet.
- En-tête : titre simple (« Alertes »), **sans bouton retour**.
- « Créer une alerte » reste un **écran poussé** plein écran avec bouton retour (`/community/alert-new`).

### 4. Icônes & style

- Ajouter deux icônes SVG **au même trait** que les icônes existantes du `_layout.tsx` :
  - **Activité** : tracé « pulse / activity » (polyline en dents).
  - **Alertes** : cloche (« bell »).
- Aucune couleur ajoutée : gris `Colors.textMuted` au repos, `Colors.primary` actif. **Seul Créer** reste coloré.
- Libellés majuscules `fontSize 10`, identiques aux autres.

### 5. Hub Communauté — intact

Aucune modification de [app/community/index.tsx](../../../app/community/index.tsx) ni des liens internes. Les écrans `/community/friends`, `/community/alerts`, etc. continuent d'exister et de fonctionner. Les onglets sont des points d'entrée **supplémentaires** partageant les composants extraits.

### 6. Badges

Inchangés. Pas de nouveau badge pour Activité ni Alertes dans cette itération (YAGNI).

## Réversibilité

- Travail **directement sur `main`**, **sans branche** (l'utilisateur veut éviter tout décalage/emmêlement de branches), **sans commit automatique** (des changements non commités sont en cours ; ne pas y toucher).
- Le changement est **purement additif** : aucun écran existant supprimé, aucune logique réécrite (seulement extraite). Annuler = supprimer `app/(tabs)/activite.tsx` + `app/(tabs)/alertes.tsx`, ré-inliner les corps extraits si besoin, et restaurer l'ordre/forme de `_layout.tsx`.

## Fichiers touchés

| Fichier | Action |
|---|---|
| `app/(tabs)/_layout.tsx` | Ajouter 2 `Tabs.Screen` (activite, alertes) dans le bon ordre ; surélever le FAB ; ajouter 2 icônes SVG |
| `app/(tabs)/activite.tsx` | **Nouveau** — onglet fil d'activité |
| `app/(tabs)/alertes.tsx` | **Nouveau** — onglet liste d'alertes |
| `components/community/ActivityFeed.tsx` | **Nouveau** — corps extrait de `friends.tsx` |
| `components/community/AlertsList.tsx` | **Nouveau** — corps extrait de `alerts.tsx` |
| `app/community/friends.tsx` | Rendre `ActivityFeed` (comportement inchangé) |
| `app/community/alerts.tsx` | Rendre `AlertsList` (comportement inchangé) |

## Critères de réussite

1. La navbar affiche 7 boutons dans l'ordre `Accueil · Défi · Activité · Créer · Alertes · Chats · Profil`.
2. Le bouton Créer est visiblement surélevé et non rogné (iOS + Android).
3. Activité ouvre le fil d'activité ; Alertes ouvre la liste d'alertes — sans bouton retour.
4. Le style (couleurs, trait, libellés, badges) est indiscernable de l'actuel hors les 2 nouveaux onglets.
5. Le hub Communauté et tous les écrans `/community/*` fonctionnent comme avant.
6. `tsc` passe.

## Hors-scope (itérations futures)

- Enrichissement du fil Activité (idées à venir de l'utilisateur).
- Nettoyage/allègement du hub Communauté (entrées devenues redondantes).
- Éventuels badges sur Activité / Alertes.
