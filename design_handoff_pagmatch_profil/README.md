# Handoff : Profil joueur PagMatch (épuré)

## Overview
Refonte de l'écran **Profil joueur** de l'app padel **PagMatch**. L'écran sert à *consulter* un joueur (le sien ou celui d'un autre) : identité, niveau, bilan, forme, évolution, badges, préférences et historique des matchs. Il gère deux contextes (**mon profil** vs **autre joueur**) et se connecte au système de "stories" partageables existant.

Livré en **2 ambiances** au choix : **Clair** (style app classique) et **Sombre**. Une seule sera retenue en production — la structure et les mesures sont identiques, seules les couleurs changent (voir Design Tokens → `THEMES`).

## About the Design Files
Les fichiers de ce bundle sont des **références de design réalisées en HTML/React (Babel in-browser)** — des prototypes qui montrent l'apparence et le comportement voulus, **pas du code de production à copier tel quel**. L'objectif est de **recréer ces écrans dans l'environnement du codebase cible** (React Native dans le repo `react-matchup`, d'après les conventions d'origine) en réutilisant ses patterns, composants et librairies. Les styles sont en objets `style` inline React ; à transposer vers la solution de styling du projet (StyleSheet RN, styled-components, Tailwind, etc.).

## Fidelity
**High-fidelity (hifi).** Couleurs, typographie, espacements et interactions sont définitifs. Recréer l'UI au pixel près en utilisant les composants/tokens du codebase. Les valeurs exactes sont listées plus bas.

## Mise à jour finale (état livré)
- **Ambiance retenue : Claire** (`THEMES.light`). La variante sombre reste dans le code mais n'est plus affichée.
- **Historique des matchs** : affiche 3 matchs + bouton **« Voir tout · N »** (toggle 3 ↔ tous). Sur *mon profil*, chaque ligne est cliquable → ouvre le composer de Story en mode *Match* pré-rempli avec ce résultat.
- **Photo de fond utilisateur** dans le composer, pour **tous** les styles Profil & Match (+ mode Photo) via le composant `StoryBg` (`<image-slot class="story-bg">`) :
  - Styles immersifs (Carte Noire, Terrain, Bilan, Score Hero) : la photo couvre le fond + voile (scrim) pour la lisibilité.
  - Styles carte (Trading Card, Ticket) : la photo apparaît dans les marges autour de la carte (carte intacte).
  - Styles clairs (Éditorial, Versus) : la photo passe derrière un **voile** (`.pm-base-wash`, crème/dégradé) qui s'estompe à 50 % quand une photo est déposée ; **sans photo, le design est identique à l'original**.
  - Mécanique : couche `.pm-base`/`.pm-base-wash` masquée/atténuée via CSS quand le slot porte `[data-filled]` ; root en `pointer-events:none` + slot en `pointer-events:auto` pour un dépôt sur tout l'aperçu. Bouton **« 📷 Photo de fond »** dans le composer (ouvre le sélecteur du slot courant).



## Écran principal : Profil

### Barre de navigation (sticky, en haut)
- Hauteur : `paddingTop 58` + `padding 12px 16px`, fond `topbar`, bordure basse `1px border`.
- Gauche : bouton retour (chevron) — bouton icône 38×38, rayon 12, fond `chip`, bordure `border`.
- Centre : titre **« Profil »**, police système (SF Pro), 16px / poids 700.
- Droite (gap 8) :
  - **Icône appareil photo** (toujours présente) → ouvre le composer de Story en mode *Profil*.
  - **Icône crayon** (uniquement si `isOwn`) → ouvre la feuille *Éditer le profil*.

### Identité (centré)
- Avatar : 76×76, rayon 24, dégradé `linear-gradient(150deg, <couleur ligue>, #E8A906)`, initiales en **Anton** 34px couleur `#0A0A0A` (initiales dérivées du nom).
- Nom : police **système (-apple-system / SF Pro)**, 26px, poids 800, `letter-spacing -0.6`, `line-height 1.05`, `white-space: nowrap`. (⚠️ le nom n'utilise PAS Barlow Condensed — choix produit pour un rendu "app natif".)
- Rangée de chips (gap 7, wrap, centré), chacune rayon 999, padding `5px 12px`, 11px/800 :
  - Ligue + niveau : `● <Ligue> · Niv. 5.85` — couleur = couleur ligue, fond `<ligue>1f`, bordure `<ligue>55`.
  - Rang : `Rang #12` — couleur `sub`, fond `chip`, bordure `border`.
  - Vérif : `FRMT 147 ✓` — couleur `#10B981`, fond `#10B98116`, bordure `#10B98144`.

### Carte « Niveau padel »
- Carte : fond `card`, bordure `border`, rayon 18, padding 18, flex space-between.
- Gauche : kicker `NIVEAU PADEL` (11px/700, `letter-spacing 1.8`, `muted`, uppercase) + chiffre **Anton** 50px couleur `accent`, `letter-spacing -1`.
- Droite (max 150px) : ligne `→ Niv. 6.0` (gauche) / `85%` (droite, couleur accent) ; barre de progression hauteur 6, rayon 3, piste `divider`, remplissage `accent` à `levelPct` ; puis `Fiabilité 88%` + pastille `EXCELLENT` (vert).

### Carte « Bilan + Forme »
- Carte padding 0.
- Rangée stats (4 colonnes, séparées par `1px divider`) : `Matchs 66`, `Victoires 47` (vert), `Défaites 19` (rouge), `Win 71%` (accent). Chiffres **Anton** 26px, labels kicker 11px.
- Rangée Forme (bordure haute `divider`, padding `14px 18px`) : kicker `FORME` + 5 pastilles 22×22 rayon 7 (`W` vert `#10B981`, `L` rouge `#EF4444`, texte blanc 10px/900) + `🔥 6` (warning `#F59E0B`).

### Carte « Évolution du niveau »
- Kicker `ÉVOLUTION DU NIVEAU` + `+1.75 cette saison` (vert, 13px/800).
- Sparkline (composant `PMSparkline`) : largeur 326, hauteur 92, couleur `accent`, remplissage gold translucide. Données = `player.eloSeries` (11 points).

### Badges
- Kicker `BADGES`. 3 cartes égales (gap 10) : emoji 24px + label (11px/800) + `×N` (10px/800 accent). Données = `player.badges`.

### Préférences
- Kicker `PRÉFÉRENCES`. Carte avec lignes (min-height 46, séparées par `divider`) : label (gauche, 13px/500 `sub`) / valeur (droite, 14px/700 `text`).
- Lignes : **Sexe**, **Club**, **Côté de jeu**, **Disponibilités**, **Partenaire favori**, **Bête noire**.

### Historique des matchs
- En-tête : kicker `HISTORIQUE DES MATCHS` + (si `isOwn`) label `Tape pour partager 📸` (10.5px/700 `muted`).
- Carte avec lignes de match (padding `13px 0`, séparées par `divider`). Affiche **3 matchs** par défaut.
- Chaque ligne (gap 12) :
  - Badge résultat 30×30 rayon 9 : `V` (fond `#10B9811c`, texte vert) ou `D` (fond `#EF44441c`, texte rouge), 13px/900.
  - Bloc central : ligne 1 = `<Moi> & <Partenaire>` (gras, `text`) + ` vs ` (`muted`) + `<Adversaires>` (`sub`), 12.5px ; ligne 2 = `<Lieu> · <Date> · <Heure>` (11px/500 `muted`).
  - Score à droite : `6-3 7-5`, 14px/800, vert si victoire / rouge si défaite.
  - Si `isOwn` : petite icône appareil photo 15px (`muted`) en fin de ligne ; la ligne entière est cliquable.
- Pied de carte : bouton pleine largeur `Voir tout · 8` / `Voir moins` (12.5px/800, couleur `accent`, bordure haute `divider`). Toggle l'affichage 3 ↔ tous.

### Bouton « Défier » (uniquement si NON `isOwn`)
- Barre collée en bas (sticky), fond `card`, bordure haute, padding `12px 20px 30px`, ombre portée vers le haut.
- Bouton pleine largeur : hauteur 52, rayon 16, fond `#FFC11A`, texte `#0A0A0A` 16px/800, icône éclair (polygone) + `Défier <Prénom>`. Ombre `0 6px 18px rgba(255,193,26,0.4)`.
- Au tap : toast central « ⚡ Défi envoyé ! » (1.9 s) — placeholder ; à remplacer par le vrai flux de défi (créneau / type de match).

## Interactions & Behavior
- **isOwn = true (mon profil)** : crayon *Éditer* visible ; pas de bouton *Défier* ; lignes d'historique cliquables → composer de Story.
- **isOwn = false (autre joueur)** : crayon masqué ; bouton *Défier* visible ; historique en lecture seule (pas d'icône, curseur normal).
- **Icône photo (nav)** → composer en mode *Profil* (`selMatch = null`, mode `profil`).
- **Tap sur un match (isOwn)** → conversion de la ligne d'historique en objet "match" puis composer en mode *Match* pré-rempli (voir §State / conversion).
- **Éditer le profil** → feuille slide-up (transform translateY, `.4s cubic-bezier(.32,.72,0,1)`).
- **Voir tout** → toggle 3 ↔ N matchs.
- Toutes les modales (composer, share sheet, edit) glissent depuis le bas.

## Feuille « Éditer le profil » (slide-up plein écran, si isOwn)
- Header : bouton ✕ (38×38) / titre `Éditer le profil` (16/700) / bouton **Enregistrer** (gold, 38h, 13.5/800).
- Corps scrollable :
  - Avatar 84×84 (mêmes initiales/dégradé) + badge photo + lien `Modifier la photo` (accent). *(photo = placeholder décoratif)*
  - **Nom** : input texte (h48, rayon 12, fond `chip`, bordure `border`).
  - **Sexe** : segmented `Homme / Femme / Autre`.
  - **Côté de jeu** : segmented `Gauche / Droite`.
  - **Club** : input texte.
  - **Disponibilités** : 7 boutons jour `Lun…Dim` (multi-sélection).
- Segmented/jour actif : fond `#FFC11A`, texte `#0A0A0A`, 800. Inactif : `chip` / `sub`.
- **Enregistrer** applique les changements au state `player` (nom + initiales + préférences se mettent à jour en direct) puis ferme la feuille. Les jours sont réordonnés selon `Lun→Dim`.

## State Management
- `player` : objet joueur éditable (source : `window.PM.player`). Mis à jour par la feuille d'édition.
- `isOwn` : booléen (mon profil vs autre). Dans le proto, piloté par un sélecteur en haut de la vitrine ; en prod, dérivé de l'utilisateur courant vs l'id du profil consulté.
- `showAllMatches` : booléen, toggle « Voir tout ».
- `selMatch` : match sélectionné (ou `null`) passé au composer/share-sheet via la prop `matchData`.
- États modales : `composerOpen`, `shareOpen`, `editOpen`, `mode` (`profil`|`match`|`photo`), `idx` (style sélectionné), `picked`, `challenge`.

### Conversion ligne d'historique → "match" (pour la story)
```js
const me = player.name.split(' ')[0];
const win = item.result === 'win';
const mine = [me, item.partner];
const matchData = {
  result: item.result,
  sets: item.score.split(' ').map(s => s.split('-').map(Number)), // "6-3 7-5" → [[6,3],[7,5]]
  score: item.score,
  winners: win ? mine : item.opponents,
  losers:  win ? item.opponents : mine,
  location: item.location,
  date: `${item.date} · ${item.time}`,
  type: 'Compétitif',
  eloDelta: item.eloDelta || (win ? '+0.15' : '-0.12'),
};
```

## Design Tokens

### Thèmes (THEMES dans profile/clean.jsx)
| token | Clair | Sombre |
|---|---|---|
| page | #F4F4F2 | #0B0B0C |
| card | #FFFFFF | #161618 |
| border | #ECEAE7 | rgba(255,255,255,0.08) |
| text | #0A0A0A | #FFFFFF |
| sub | #52525B | rgba(255,255,255,0.62) |
| muted | #9A9A9F | rgba(255,255,255,0.40) |
| divider | #F1F0EE | rgba(255,255,255,0.07) |
| chip | #F6F5F3 | rgba(255,255,255,0.06) |
| topbar | #FFFFFF | #0B0B0C |
| accent | #E8A906 | #FFC11A |

### Couleurs marque (lib/colors — window.PM.Colors)
- brand `#FFC11A`, brandBright `#FFD23F`, brandDeep `#E8A906`, primary `#0A0A0A`
- success `#10B981`, danger `#EF4444`, warning `#F59E0B`, info `#3B82F6`
- Ligues : diamond `#67E8F9`, gold `#FBBF24`, silver `#A1A1AA`, bronze `#E8A906`, discovery `#71717A`

### Typographie
- **Anton** (Google Font) — chiffres / display (niveau, stats, initiales).
- **Inter** (Google Font), poids 500–900 — UI, kickers, labels.
- **-apple-system / SF Pro (system-ui)** — titre de nav et **nom du joueur**.
- **Barlow Condensed** 900 italic — utilisé par les *stories* (pas par l'écran profil).
- Kickers : 10.5–11px, poids 700, `letter-spacing 1.8`, UPPERCASE, couleur `muted`.

### Rayons & divers
- Cartes : rayon 18 ; chips/boutons icône : 12–13 ; pastilles : 7–9 ; pills : 999.
- Bouton icône nav : 38×38. Avatar profil : 76 (rayon 24) ; avatar édition : 84 (rayon 26).
- Bouton primaire (Défier) : h52, rayon 16.
- Espacements section verticaux : 12–20px ; padding horizontal écran : 20px.

## Assets
- Polices via Google Fonts (`Anton`, `Barlow Condensed`, `Inter`). SF Pro = police système.
- Icônes : SVG inline (chevron, partage, appareil photo, crayon, éclair) — pas d'assets externes.
- Emoji utilisés (cohérents avec la marque PagMatch) : 🔥 (série), 📸 (partager), ⚡ (défi), 👑/💥/🎯 (badges), 🎾.
- Avatars = initiales sur dégradé (pas de photos réelles dans le proto ; prévoir l'upload côté prod).
- Sparkline / radar / ring : composants SVG maison (voir `stories/styles.jsx`).

## Files
Fichiers de référence inclus dans ce bundle :
- `PagMatch - Profil épuré.html` — page hôte (charge React + Babel, monte la vitrine 2 téléphones avec sélecteur Mon profil / Autre joueur).
- `profile/clean.jsx` — **écran Profil** (`ProfileClean`) + **feuille d'édition** (`ProfileEditSheet`) + `THEMES`. ← cœur du livrable.
- `profile/showcase-clean.jsx` — vitrine + `FlowShellClean` (orchestration des états, conversion match, branchement composer/share/edit).
- `stories/data.js` — données d'exemple (`window.PM`) : joueur, ligues, couleurs, `matchHistory`, match, invite.
- `stories/styles.jsx` — helpers SVG réutilisés : `PMSparkline`, `PMRadar`, `PMRing`, `StoryFrame`, styles de stories Profil.
- `stories/match.jsx` — styles de stories *Résultat de match* (consomment la prop `match`).
- `stories/flow.jsx` — `PMComposer` + `PMShareSheet` (modale de partage ; acceptent la prop `matchData`).
- `ios-frame.jsx` — bezel iPhone (`IOSDevice`) utilisé pour le cadrage du proto (non nécessaire en prod).
- `stories/image-slot.js` — emplacement photo drag-and-drop (pour les stories *Photo*).

> Note : `ios-frame.jsx` et la "vitrine" 2 téléphones ne servent qu'à présenter/comparer les ambiances. En production, seul `ProfileClean` (+ `ProfileEditSheet`) et la logique de `FlowShellClean` sont à porter.
