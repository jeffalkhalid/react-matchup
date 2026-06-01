# Handoff — Partage de stories PagMatch

## Overview
Fonctionnalité de **partage en story (9:16)** depuis l'app PagMatch (Expo / React Native), accessible
depuis le profil complet (`app/(tabs)/player/[id].tsx`, bouton « 📸 Story »). Trois contenus partageables :

1. **Profil** — carte joueur (niveau, ligue, win-rate, forme, etc.)
2. **Résultat de match** — score + équipes juste après la partie
3. **Photo (façon Strava)** — la photo du joueur en fond + données en surimpression

Chaque story porte un **bloc invitation** (QR + « Rejoins-moi sur PagMatch » + lien profil + lien app)
pour transformer le partage en installs.

Cible visée : remplacer / enrichir les composants existants `components/StoryCanvas.tsx`,
`StoryComposer.tsx`, `StoryMatchPicker.tsx`.

## About the Design Files
Les fichiers de ce bundle sont des **références de design réalisées en HTML/CSS/React** (prototypes
montrant le rendu et le comportement voulus) — **pas du code de production à copier tel quel**.
La tâche est de **recréer ces designs dans l'app Expo/React Native existante**, avec ses patterns
(`StyleSheet`, NativeWind, `react-native-svg`, `react-native-view-shot`, `expo-sharing`,
`expo-image-picker`, `expo-media-library` — tous déjà installés, cf. `package.json`).

Le mapping HTML → RN est direct : `<div>` → `<View>`, `<span>/texte` → `<Text>`,
`<svg>` (react-native-svg, déjà utilisé dans `player/[id].tsx`), `transform: scale()` →
même technique de canvas logique 1080×1920 mis à l'échelle (déjà la logique de `StoryCanvas`).

## Fidelity
**Hi-fi.** Couleurs, typographies, espacements et interactions sont finaux. Recréer au pixel près
avec les polices déjà bundlées (Anton, Barlow Condensed, Inter).

---

## Le workflow de partage (à implémenter dans StoryComposer)

```
Profil (player/[id].tsx)
        │  tap « 📸 Story »
        ▼
Composer (modal plein écran, animationType slide)
   ┌─────────────────────────────────────────┐
   │  ✕            📸 Ma story                 │
   │  ┌─ segmented ───────────────────────┐   │
   │  │  Profil  │  Match  │  Photo        │   │  ← choisit le CONTENU
   │  └───────────────────────────────────┘   │
   │            [ aperçu live 9:16 ]           │  ← StoryCanvas rendu en réduit
   │  STYLE  [chip][chip][chip]…  (scroll h.)  │  ← choisit le STYLE du contenu
   │  [ 💾 Sauver ]   [ 📤 Partager ]          │
   └─────────────────────────────────────────┘
        │  tap « Partager »
        ▼
Feuille de partage native (expo-sharing / Sharing.shareAsync)
   → Instagram Stories, WhatsApp, Snap, Enregistrer…
```

- **Segmented `Profil / Match / Photo`** = nouveau. Sélectionne la famille de styles.
- **Mode Profil** → styles profil (cf. ci-dessous : Carte Noire = signature).
- **Mode Match** → nécessite un match sélectionné (réutiliser `StoryMatchPicker.tsx`).
  Styles : Score Hero (signature), Ticket (signature), Versus.
- **Mode Photo** → ouvre `expo-image-picker` (caméra/galerie, déjà câblé dans `StoryComposer`),
  la photo devient le fond, les données passent en surimpression. Style signature : Photo Match.
- **Capture** : `captureRef(canvasRef, { format:'png', width:1080, height:1920 })` (déjà en place),
  puis `Sharing.shareAsync` / `MediaLibrary.saveToLibraryAsync` (déjà en place).

### Styles retenus en priorité (« favoris »)
| Mode | Style signature | Autres |
|---|---|---|
| Profil | **Carte Noire** | Trading Card, Éditorial, Terrain, Bilan |
| Match | **Score Hero**, **Ticket** | Versus |
| Photo | **Photo Match** | Photo Profil, Photo Minimal |

Démarrer le dev par les **favoris en gras** ; les autres sont des variantes bonus.

---

## Design Tokens

### Couleurs (source unique : `lib/colors.js` — déjà dans le repo)
```
brand          #FFC11A   (jaune marque — accents, parcimonie)
brandBright    #FFD23F
brandDeep      #E8A906
primary        #0A0A0A   (CTA noir)
bgDark/heroBg  #0A0A0A
bgCream        #FAF5E8   (fond Éditorial / Ticket)
textPrimary    #0A0A0A   textSecondary #52525B   textMuted #A1A1AA
success        #10B981   danger #EF4444   warning #F59E0B
league.diamond #67E8F9   gold #FBBF24   silver #A1A1AA   bronze #E8A906   discovery #71717A
leagueGrad.gold ['#D97706','#FBBF24']   (dégradé Trading Card)
```
> La « couleur d'accent » du Tweak remappe **uniquement** `brand`/`brandDeep` ; les couleurs de
> ligue ne changent jamais.

### Typographies (polices déjà bundlées via expo-font)
```
display  : Anton (Anton_400Regular)              → gros chiffres (niveau, score, KPIs)
welcome  : Barlow Condensed Black Italic          → noms de joueur / titres (UPPERCASE, italic)
           (BarlowCondensed_900Black_Italic)
ui       : Inter (500/600/700/800/900)            → labels, kickers, liens
```

### Échelle (story = canvas logique 1080 × 1920, ratio 9:16)
```
padding latéral story : ~84–92 px (sur 1080)
QR invitation         : 120–132 px ; quiet-zone padding ≈ 8.5% ; modules 25×25
rayons                : cartes 26–56 ; pills 999
scrim photo (Strava)  : linear-gradient(180deg, rgba(10,10,10,.45) 0%, transparent 28%,
                        transparent 42%, rgba(10,10,10,.88) 100%)
```

---

## Specs des styles signature (canvas 1080 × 1920)

### Carte Noire (Profil)
- Fond `#0A0A0A` + 2 glows radiaux jaunes (haut-droite 16%, bas-gauche 8%) + fine texture verticale.
- Layout flex column `space-between`, padding `110 92 96`.
- **Haut** : wordmark (carré jaune 52px radius 14 + 🎾 ; « PAGMATCH » Inter 900, 26px, letter-spacing 6, blanc 82%) — à droite « CARTE JOUEUR » 22px muted.
- **Héros** : avatar 132 radius 32 dégradé `gold→brandDeep` + monogramme Anton 64 noir ;
  chip ligue (« ● OR » Inter900 22, fond `gold22`, bord `gold66`) ; « Rang #12 · FRMT 147 ✓ » 24px blanc 45%.
  Nom : Barlow Black Italic **168px** UPPERCASE, prénom blanc / nom en `gold`. Niveau : kicker
  « NIVEAU PADEL » 24px + chiffre Anton **200px** `gold`.
- **Stats** : rangée Matchs / Victoires / Win% (Anton 84, labels 22 muted) entre 2 filets blancs 12%.
  Rangée Forme (pastilles W/L 48px, vert/rouge) + 🔥 série (Anton 52, warning).
- **Pied** : bloc invitation (voir plus bas) + nom du club à droite (22px blanc 40%).

### Score Hero (Match)
- Fond `#0A0A0A` + glow couleur résultat (vert victoire / rouge défaite).
- Haut : wordmark + type de match (« COMPÉTITIF »).
- Centre : « VICTOIRE 🏆 » Barlow Italic 90 (success) ; **score sets** géant (voir composant Score) ;
  « 2–0 SETS · +0.18 NIV. » 28px blanc 50%.
- Bas : VAINQUEURS (barre jaune 6px + avatars 84 + nom Barlow 56 blanc) / séparateur « VS » /
  ADVERSAIRES (gris). Puis filet + bloc invitation + lieu·date à droite.

### Ticket (Match — éditorial crème)
- Carte crème `#FAF5E8` 920px de large centrée sur fond noir, radius 36, ombre portée.
- En-tête noir : wordmark + « VICTOIRE » (brand) / « DÉFAITE » (danger).
- Corps : « SCORE FINAL » + score géant (chiffres `textPrimary`, perdant `textMuted`) +
  pills « 2–0 sets » (noir) / « +0.18 niv. » (success).
- **Perforation** : filet pointillé `4px dashed border` + 2 demi-cercles noirs (encoches latérales).
- Équipes : avatars 72 + noms Barlow 50 UPPERCASE (1 ligne, `nowrap`). Filet + lieu·date + bloc invitation.

### Photo Match (Photo — façon Strava)
- Couche fond : **photo joueur** (`expo-image-picker` → `<Image>` cover plein cadre) sur fallback `#16181d`.
- Couche scrim (dégradé bas, cf. tokens) `pointerEvents:none`.
- Couche données `pointerEvents:none` :
  - Haut : wordmark sur pill verre (`rgba(0,0,0,.32)` + blur 14) + date (pill verre).
  - Bas (`bottom:~96`) : « Victoire 🎾 » Barlow Italic 72 `brand` ; score géant 172 ;
    filet ; noms + delta niveau ; **barre invitation translucide** (QR 96 + texte + lien + 📲 app).
- Texte blanc + ombres portées pour rester lisible sur n'importe quelle photo.

### Score (sets) — composant partagé `BigSets`
Rangée de sets `6–3  7–5` : mon score Anton 150–188px blanc ; tiret 0.42× en `brand` ;
score adverse 0.78× en blanc 50%. (Helper `parseSets` déjà présent dans le repo.)

---

## Bloc invitation (sur toutes les stories)
- **QR** (gauche, 96–132px) : carré blanc radius 16 + quiet-zone, 25×25 modules,
  3 finder patterns aux coins. ⚠️ **Le QR du mock est un visuel non-scannable.** En prod :
  `react-native-qrcode-svg` encodant le **lien de parrainage / deep link** du joueur.
- **Texte** : « REJOINS-MOI SUR » (Inter 800, 24, muted) / « PagMatch » (Barlow Italic 56) /
  lien profil (Inter 800, 26, `brand`) / pill « 📲 {lien app} » (bord léger).
- Variantes : `light` (texte blanc, stories sombres) / `light=false` (texte noir, Ticket crème).

### Lien app
Mettre dans le champ « Lien / app » l'URL réelle : lien **App Store / Play Store**, ou un
**lien dynamique** (Firebase Dynamic Links / Branch) qui ouvre l'app si installée, sinon le store.
Idéalement encodé dans le QR aussi.

---

## Réglages exposés (Tweaks — pour calage avant dev, pas pour la prod)
`accent` (couleur, remappe brand) · `playerName` · `cta` (texte invite) · `link` (lien profil) ·
`appUrl` (lien app) · `showApp` (bool) · `showQR` (bool).

## State management (composer)
```
mode        : 'profil' | 'match' | 'photo'        (segmented ; reset styleIndex à 0 au changement)
styleIndex  : index dans la liste de styles du mode courant
match       : StoryMatch | null  (via StoryMatchPicker en mode match)
photoUri    : string | null      (via expo-image-picker en mode photo)
busy        : 'share' | 'save' | null
```
Données profil : depuis `players` / `elo_history` / `reputation_votes` (déjà requêtées dans
`player/[id].tsx`). Données match : `StoryMatch` (interface déjà définie dans `StoryCanvas.tsx`).

## Interactions & comportement
- Composer : slide-up (`Modal animationType="slide"`).
- Sélection style/mode : re-render instantané de l'aperçu.
- Mode Photo : double-tap pour recadrer la photo (dans le mock via `<image-slot>` ; en RN, recadrage
  natif d'`expo-image-picker` `allowsEditing` ou un recadreur custom).
- Partager : capture 1080×1920 → `Sharing.shareAsync`. Sauver : `MediaLibrary.saveToLibraryAsync`.
- Feuille de partage : native (ne pas recréer l'UI iOS du mock — c'est juste une illustration).

## Assets
- Aucune image fournie. Photos = fournies par l'utilisateur (image-picker).
- QR = à générer (cf. ci-dessus). Emoji 🎾🏆🔥📲 = system emoji.

## Files (références dans ce bundle)
- `react-native/` — **code React Native prêt à porter** (composants `.tsx` + README d'intégration). Commence ici pour le dev.
- `PagMatch — Stories profil.html` — document principal (canvas : flux + tous les styles + Tweaks).
- `PagMatch — Flux cliquable.html` — le parcours de partage cliquable (iPhone plein écran).
- `stories/data.js` — données d'exemple (profil, match, invite) + tokens couleurs.
- `stories/styles.jsx` — styles **Profil** (Carte Noire, Trading Card, Éditorial, Terrain, Bilan) + `StoryFrame`, `QRCode`, `Invite`, `Ring`, `Radar`, `Sparkline`.
- `stories/match.jsx` — styles **Match** (Score Hero, Versus, Ticket) + **Photo** (Match, Profil, Minimal) + `BigSets`.
- `stories/flow.jsx` — prototype du flux (écran profil + composer + feuille de partage).
- `ios-frame.jsx`, `design-canvas.jsx`, `tweaks-panel.jsx`, `stories/image-slot.js` — échafaudages de présentation (NON à porter — outils de maquette uniquement).
