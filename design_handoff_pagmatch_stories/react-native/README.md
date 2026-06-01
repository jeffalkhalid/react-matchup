# Port React Native — Stories PagMatch

Composants `.tsx` prêts à déposer dans le repo **react-matchup** (Expo / RN). Ils recréent les
maquettes HTML du bundle parent avec tes conventions (`StyleSheet` inline, `Colors`/`Fonts` de
`lib/theme`, `react-native-svg`, `captureRef`).

## 1. Installer la dépendance manquante
```bash
npx expo install react-native-qrcode-svg
```
Tout le reste est déjà dans `package.json` (`react-native-view-shot`, `expo-image-picker`,
`expo-sharing`, `expo-media-library`, `react-native-svg`, `react-native-safe-area-context`).

## 2. Arborescence à copier
```
components/
  story/
    storyTheme.ts          ← tokens, helpers (parseSets, makeScale), types
    StoryPrimitives.tsx    ← Wordmark, Avatars, BigSets, Qr, Invite
    StoryStyles.tsx        ← CardDark, ScoreHero, Ticket, PhotoMatch + StoryCardV2 (dispatcher)
  StoryComposerV2.tsx      ← modal : segmented Profil/Match/Photo + aperçu + capture/partage
```
> `StoryComposerV2` peut remplacer `StoryComposer.tsx`, ou cohabiter le temps de la migration.

## 3. Brancher depuis le profil (`app/(tabs)/player/[id].tsx`)
Le bouton « 📸 Story » existe déjà (`setStoryPickerOpen`). Remplace l'ouverture par le composer V2 :

```tsx
import StoryComposerV2 from '../../../components/StoryComposerV2';
import type { StoryPlayer, StoryMatchData, InviteData } from '../../../components/story/storyTheme';

const storyPlayer: StoryPlayer = {
  name: profile.name, league, level: eloToLevel(profile.elo_score), rank: rankPos ?? 0,
  frmtRank: profile.frmt_rank, frmtVerified: profile.frmt_verified,
  fiability: profile.fiability_pct, fiabilityLabel: fibLabel,
  wins, losses, winRate, streak, recentForm, club: profile.clubs?.[0],
};
const invite: InviteData = {
  cta: 'Rejoins-moi sur',
  link: `pagmatch.com/u/${profile.id}`,
  appUrl: 'Télécharger l’app',
  qrValue: `https://pagmatch.com/u/${profile.id}?ref=story`, // ← encodé dans le QR
  showApp: true, showQR: true,
};

<StoryComposerV2
  visible={composerOpen}
  player={storyPlayer}
  match={storyMatch}                 // StoryMatchData | null (via StoryMatchPicker)
  invite={invite}
  onClose={() => setComposerOpen(false)}
  onRequestMatch={() => setStoryPickerOpen(true)}
/>
```

`StoryMatchPicker.tsx` renvoie déjà un objet match ; mappe-le vers `StoryMatchData` :
```tsx
const storyMatch: StoryMatchData = {
  result: won ? 'win' : 'loss',
  sets: parseSets(m.score_text),
  winners: [m.winner?.name, m.winner_2?.name].filter(Boolean) as string[],
  losers:  [m.loser?.name,  m.loser_2?.name ].filter(Boolean) as string[],
  location: m.game?.location ?? undefined,
  date: /* format fr court */,
  type: m.is_challenge ? 'Défi' : 'Compétitif',
  eloDelta: '+0.18', // depuis elo_history
};
```

## 4. QR & lien app (important)
- Le QR est maintenant **réel** via `react-native-qrcode-svg`, encodant `invite.qrValue`.
  Mets-y un **deep link / lien de parrainage** (ex. Firebase Dynamic Links ou Branch) qui ouvre
  l'app si installée, sinon redirige vers le store. Ce même lien va dans `appUrl` (texte affiché).

## 5. Notes de port (web → RN)
- **Dégradés** : pas de CSS `linear/radial-gradient`. Faits en `react-native-svg`
  (`<RadialGradient>` pour les glows, `<LinearGradient>` pour le scrim photo). Voir `StoryStyles.tsx`.
- **Échelle** : chaque story prend une prop `width` ; `makeScale(width)` donne `s(n)` appliqué à
  toutes les tailles (canvas logique 1080). Aperçu = petite width ; export = `width: 1080` via `captureRef`.
- **Polices** : `Fonts.display` (Anton), `Fonts.welcome` (Barlow Condensed Black Italic),
  `Fonts.uiBlack/uiExtraBold/uiBold` (Inter). Déjà bundlées (`app/_layout.tsx`).
- **Capture** : `captureRef(canvasRef, { width:1080, height:1920 })` — `StoryCardV2` est `forwardRef`.
- **Noms longs** : `numberOfLines={1}` posé sur les noms (évite le wrap). Adapte la taille si besoin.

## 6. Reste à faire (variantes bonus, non incluses ici)
- Profil : Trading Card, Éditorial, Terrain, Bilan (specs dans le README parent).
- Match : Versus. Photo : Photo Profil, Photo Minimal.
- Recadrage photo (le mock propose un reframe ; en RN, `allowsEditing` d'ImagePicker ou un recadreur custom).
- Pour ajouter une variante : nouveau composant + entrée dans `STORY_REGISTRY` (StoryStyles.tsx).

## Référence visuelle
Ouvre `../PagMatch — Stories profil.html` (toutes les variantes + Tweaks) et
`../PagMatch — Flux cliquable.html` (le parcours cliquable) pour le rendu cible exact.
