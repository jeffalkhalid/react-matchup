# Uniformisation des icônes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer les emoji fonctionnels (famille A) et les badges en emoji (famille B) par le système d'icônes line-art déjà présent, avec une source de vérité unique pour les badges.

**Architecture :** On complète les deux registres SVG existants (`components/community/icons.tsx` pour les icônes UI, `components/profile/glyphs.tsx` pour les glyphes badges), on crée une table unique `lib/badges.ts` qui remplace les 4 copies de `BADGE_EMOJI`, et un composant `<BadgePill>` (glyphe blanc + pastille colorée). Migration écran par écran, additive et réversible.

**Tech Stack :** React Native 0.81 / Expo 54, TypeScript, `react-native-svg` (déjà présent). Aucune nouvelle dépendance.

## Global Constraints

- Travail directement sur `main`, sans branche ni commit automatique. NE PAS committer sauf demande explicite de l'utilisateur. (Préférence utilisateur — les étapes « Commit » de ce plan sont donc remplacées par un point de validation `tsc` + revue ; ne committer que si l'utilisateur le demande.)
- Changements additifs et réversibles.
- Aucune nouvelle dépendance (pas de `lucide-react-native` etc.).
- Pas de runner de tests dans le projet : la barrière de vérification est `npx tsc --noEmit` (depuis `react-matchup/`) + vérification visuelle device (Expo).
- NE PAS toucher la famille C : réactions chat (🔥 🎉 💪 👍 😄 dans `app/chat/[gameId].tsx`), médailles 🥇🥈🥉 (`ranking.tsx`), emoji décoratifs `guideTheme`/onboarding. Les réactions 🔥 sont des clés en base de données.
- Couleurs de pastille des badges (familles sémantiques) : or `#E6A21A` (leadership), rouge `#E5484D` (puissance), orange `#F2750A` (phénix), bleu ardoise `#5B6B82` (défense), cyan `#1FA8B0` (vitesse), violet `#7C5CD6` (cerveau), vert `#16A34A` (social/fair-play/ponctuel/ambiance), ambre `#D98A1A` (3e mi-temps).

---

## File Structure

- `components/community/icons.tsx` — MODIFY : ajouter icônes UI manquantes (`calendar`, `pencil`, `heart`, `eye`, `flame`).
- `components/profile/glyphs.tsx` — MODIFY : ajouter 7 glyphes badges (`bomb`, `brick`, `net`, `runner`, `brain`, `smile`, `beers`).
- `lib/badges.ts` — CREATE : table unique `badge → { glyph, color }` + normalisation des alias.
- `components/profile/BadgePill.tsx` — CREATE : composant pastille colorée + glyphe blanc.
- `app/(tabs)/index.tsx` — MODIFY : supprimer SVG inline + `BADGE_EMOJI` local, utiliser registre + `<BadgePill>`.
- `app/(tabs)/lobby.tsx` — MODIFY : supprimer `BADGE_EMOJI` local, utiliser `<BadgePill>`.
- `app/score-entry.tsx` — MODIFY : supprimer `BADGE_EMOJI` local, utiliser `<BadgePill>`.
- `app/(tabs)/player/[id].tsx` — MODIFY : `BADGES_INFO` consomme `lib/badges.ts`, rendu via `<BadgePill>`.
- Écrans divers — MODIFY : balayage des emoji UI (famille A) vers `<Icon>`.

---

## Task 1 : Ajouter les icônes UI manquantes au registre

**Files:**
- Modify: `components/community/icons.tsx` (type `IconName` + switch)

**Interfaces:**
- Consumes: registre `Icon({ name, size, color, stroke, fill, rotate })` existant.
- Produces: nouveaux `IconName` : `'calendar' | 'pencil' | 'heart' | 'eye' | 'flame'`, utilisables via `<Icon name="calendar" />`.

- [ ] **Step 1 : Étendre le type `IconName`**

Dans `components/community/icons.tsx`, ajouter les noms à l'union de type (ligne ~6-10) :

```ts
  | 'sliders' | 'trendingUp' | 'share' | 'lifeBuoy' | 'settings'
  | 'calendar' | 'pencil' | 'heart' | 'eye' | 'flame';
```

- [ ] **Step 2 : Ajouter les cas au switch**

Avant `default:` dans le `switch (name)`, ajouter (paths dérivés de Lucide) :

```tsx
      case 'calendar':
        return <G>
          <Rect {...common} x="3" y="4" width="18" height="18" rx="2" />
          <Line {...common} x1="16" y1="2" x2="16" y2="6" />
          <Line {...common} x1="8" y1="2" x2="8" y2="6" />
          <Line {...common} x1="3" y1="10" x2="21" y2="10" />
        </G>;
      case 'pencil':
        return <G>
          <Path {...common} d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          <Path {...common} d="m15 5 4 4" />
        </G>;
      case 'heart':
        return <Path {...common} d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.49 4.04 3 5.5l7 7Z" />;
      case 'eye':
        return <G>
          <Path {...common} d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <Circle {...common} cx="12" cy="12" r="3" />
        </G>;
      case 'flame':
        return <Path {...common} d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" />;
```

- [ ] **Step 3 : Vérifier le typecheck**

Run (depuis `react-matchup/`) : `npx tsc --noEmit`
Expected : aucune erreur liée à `icons.tsx`.

- [ ] **Step 4 : Vérification visuelle (point de validation)**

Rendre temporairement `<Icon name="calendar" />`, `pencil`, `heart`, `eye`, `flame` sur un écran de dev → vérifier que chacun s'affiche en trait propre, taille/couleur correctes. Retirer le test.

---

## Task 2 : Ajouter les 7 glyphes badges

**Files:**
- Modify: `components/profile/glyphs.tsx` (switch sur `name`)

**Interfaces:**
- Consumes: `Glyph({ name, color, strokeWidth })` existant ; helpers locaux `stroke` (`{ stroke: color, fill: 'none' }`) et `solid` (`{ fill: color, stroke: 'none' }`).
- Produces: noms de glyphes : `'bomb' | 'brick' | 'net' | 'runner' | 'brain' | 'smile' | 'beers'`.

- [ ] **Step 1 : Ajouter les cas au switch**

Dans `components/profile/glyphs.tsx`, avant `case 'star': default:`, ajouter :

```tsx
    case 'bomb':
      body = (<>
        <Circle cx={11} cy={14} r={6.5} {...stroke} />
        <Path d="M15 9.5 l 2.5 -2.5" {...stroke} />
        <Path d="M17.5 7 l 1.2 -1.2 M19.5 6.2 l 1.3 .2 M19 4.4 l .6 -1.3" {...stroke} />
        <Circle cx={9} cy={12} r={0.9} {...solid} />
      </>); break;
    case 'brick':
      body = (<>
        <Path d="M3 5 h18 v14 H3 z" {...stroke} />
        <Path d="M3 9.7 h18 M3 14.3 h18" {...stroke} />
        <Path d="M9 5 v4.7 M15 9.7 v4.6 M9 14.3 v4.7" {...stroke} />
      </>); break;
    case 'net':
      body = (<>
        <Path d="M3 6 h18 v12 H3 z" {...stroke} />
        <Path d="M7.5 6 v12 M12 6 v12 M16.5 6 v12 M3 10 h18 M3 14 h18" {...stroke} />
      </>); break;
    case 'runner':
      body = (<>
        <Circle cx={15} cy={5} r={2} {...stroke} />
        <Path d="M15 7.5 l -2.5 4 3 1.5 -1.5 5.5" {...stroke} />
        <Path d="M12.5 11.5 l -4.5 1.5 M16 13 l 4 1" {...stroke} />
      </>); break;
    case 'brain':
      body = (<>
        <Path d="M12 4.5 a3 3 0 0 0 -5.2 1 a2.6 2.6 0 0 0 -1.3 4.3 a2.6 2.6 0 0 0 .6 4.3 a2.8 2.8 0 0 0 4.4 1.4 l 1.5 0" {...stroke} />
        <Path d="M12 4.5 a3 3 0 0 1 5.2 1 a2.6 2.6 0 0 1 1.3 4.3 a2.6 2.6 0 0 1 -.6 4.3 a2.8 2.8 0 0 1 -4.4 1.4 l -1.5 0" {...stroke} />
        <Path d="M12 4.5 v12" {...stroke} />
      </>); break;
    case 'smile':
      body = (<>
        <Circle cx={12} cy={12} r={9} {...stroke} />
        <Path d="M8 13.5 c 1.6 2.2 6.4 2.2 8 0" {...stroke} />
        <Circle cx={9} cy={9.5} r={0.95} {...solid} />
        <Circle cx={15} cy={9.5} r={0.95} {...solid} />
      </>); break;
    case 'beers':
      body = (<>
        <Path d="M6 8 h7 v9 a2 2 0 0 1 -2 2 H8 a2 2 0 0 1 -2 -2 z" {...stroke} />
        <Path d="M13 10 h2.5 a2 2 0 0 1 2 2 v1.5 a2 2 0 0 1 -2 2 H13" {...stroke} />
        <Path d="M6 11.3 h7" {...stroke} />
        <Path d="M8 5.5 v1.8 M10.5 5 v2.3" {...stroke} />
      </>); break;
```

- [ ] **Step 2 : Typecheck**

Run : `npx tsc --noEmit`
Expected : pas d'erreur dans `glyphs.tsx`.

- [ ] **Step 3 : Vérification visuelle (point de validation)**

Rendre chaque nouveau glyphe (`<Glyph name="bomb" color="#fff" />` …) sur fond coloré → vérifier lisibilité à ~16-20px. Ajuster les paths si un glyphe est confus (le but est reconnaissable, pas pixel-perfect). Retirer le test.

---

## Task 3 : Créer `lib/badges.ts` (source unique)

**Files:**
- Create: `lib/badges.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `type BadgeKey = string` (label canonique ou alias).
  - `interface BadgeStyle { label: string; glyph: string; color: string }`
  - `function getBadge(key: string): BadgeStyle` — normalise n'importe quel alias (`MVP`, `CANNON`, `RUNNER`, `El Cañón`, label FR…) vers le style canonique ; fallback `{ label: key, glyph: 'star', color: '#5B6B82' }` pour une clé inconnue.

- [ ] **Step 1 : Écrire le fichier**

Créer `lib/badges.ts` :

```ts
// Source UNIQUE des badges achievements. Remplace les copies de BADGE_EMOJI
// dispersées (index.tsx, lobby.tsx, score-entry.tsx) et BADGES_INFO (player/[id]).
// glyph = nom dans components/profile/glyphs.tsx (ou 'clock' depuis le registre UI).
export interface BadgeStyle { label: string; glyph: string; color: string }

const COLORS = {
  gold: '#E6A21A', red: '#E5484D', orange: '#F2750A', slate: '#5B6B82',
  cyan: '#1FA8B0', purple: '#7C5CD6', green: '#16A34A', amber: '#D98A1A',
} as const;

// label canonique -> style
const BADGES: Record<string, BadgeStyle> = {
  'MVP':            { label: 'MVP',            glyph: 'crown',     color: COLORS.gold },
  'Le Capitaine':   { label: 'Le Capitaine',   glyph: 'star',      color: COLORS.gold },
  'La Bombe':       { label: 'La Bombe',       glyph: 'bomb',      color: COLORS.red },
  'Le Smash':       { label: 'Le Smash',       glyph: 'target',    color: COLORS.red },
  'Le Phénix':      { label: 'Le Phénix',      glyph: 'flame',     color: COLORS.orange },
  'Le Mur':         { label: 'Le Mur',         glyph: 'brick',     color: COLORS.slate },
  'Roi du Filet':   { label: 'Roi du Filet',   glyph: 'net',       color: COLORS.slate },
  "L'Essuie-glace": { label: "L'Essuie-glace", glyph: 'runner',    color: COLORS.cyan },
  'Le Cerveau':     { label: 'Le Cerveau',     glyph: 'brain',     color: COLORS.purple },
  'Fair-Play':      { label: 'Fair-Play',      glyph: 'handshake', color: COLORS.green },
  'Ponctuel':       { label: 'Ponctuel',       glyph: 'clock',     color: COLORS.green },
  'Bonne Ambiance': { label: 'Bonne Ambiance', glyph: 'smile',     color: COLORS.green },
  '3e Mi-temps':    { label: '3e Mi-temps',    glyph: 'beers',     color: COLORS.amber },
};

// alias (codes back-end, variantes ES/FR) -> label canonique
const ALIASES: Record<string, string> = {
  CANNON: 'La Bombe', 'El Cañón': 'La Bombe',
  SMASH: 'Le Smash',
  COMEBACK: 'Le Phénix',
  WALL: 'Le Mur',
  RUNNER: "L'Essuie-glace", 'Essuie-glace': "L'Essuie-glace",
  NET_KING: 'Roi du Filet',
  BRAIN: 'Le Cerveau',
  CAPTAIN: 'Le Capitaine',
  FAIR_PLAY: 'Fair-Play',
  GOOD_VIBES: 'Bonne Ambiance', 'Bon Délire': 'Bonne Ambiance',
  DRINKS: '3e Mi-temps',
  PUNCTUAL: 'Ponctuel',
};

export function getBadge(key: string): BadgeStyle {
  const canonical = BADGES[key] ? key : ALIASES[key];
  return BADGES[canonical] ?? { label: key, glyph: 'star', color: COLORS.slate };
}
```

- [ ] **Step 2 : Typecheck**

Run : `npx tsc --noEmit`
Expected : aucune erreur.

---

## Task 4 : Composant `<BadgePill>`

**Files:**
- Create: `components/profile/BadgePill.tsx`

**Interfaces:**
- Consumes: `getBadge` (`lib/badges.ts`), `Glyph` (`components/profile/glyphs.tsx`), `Icon` (`components/community/icons.tsx`) pour le cas `clock`.
- Produces: `BadgePill({ badge, size, showLabel })` :
  - `badge: string` — label ou alias.
  - `size?: number` — diamètre de la pastille (défaut 28).
  - `showLabel?: boolean` — si vrai, affiche le label sous la pastille.

- [ ] **Step 1 : Écrire le composant**

Créer `components/profile/BadgePill.tsx` :

```tsx
import React from 'react';
import { View, Text } from 'react-native';
import { Glyph } from './glyphs';
import { Icon } from '../community/icons';
import { getBadge } from '../../lib/badges';

export function BadgePill({ badge, size = 28, showLabel = false }:
  { badge: string; size?: number; showLabel?: boolean }) {
  const { label, glyph, color } = getBadge(badge);
  const glyphSize = Math.round(size * 0.6);
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <View style={{
        width: size, height: size, borderRadius: 999, backgroundColor: color,
        alignItems: 'center', justifyContent: 'center',
      }}>
        {glyph === 'clock'
          ? <Icon name="clock" size={glyphSize} color="#fff" stroke={2} />
          : <Glyph name={glyph} color="#fff" strokeWidth={1.8} />}
      </View>
      {showLabel && (
        <Text style={{ fontSize: 10, fontWeight: '700', color: '#374151' }} numberOfLines={1}>
          {label}
        </Text>
      )}
    </View>
  );
}
```

Note : `Glyph` rend un `<G>` (pas de `<Svg>` wrapper). Vérifier en Step 3 qu'il s'affiche bien dans la pastille ; si rien ne s'affiche, wrapper dans `<Svg width={glyphSize} height={glyphSize} viewBox="0 0 24 24">` à l'intérieur de `BadgePill` (le composant `Glyph` ne fournit que le contenu, pas le canvas SVG).

- [ ] **Step 2 : Corriger le wrapper SVG si nécessaire**

Comme `Glyph` ne contient pas de `<Svg>`, l'envelopper. Remplacer la branche glyphe par :

```tsx
import Svg from 'react-native-svg';
// ...
{glyph === 'clock'
  ? <Icon name="clock" size={glyphSize} color="#fff" stroke={2} />
  : <Svg width={glyphSize} height={glyphSize} viewBox="0 0 24 24" fill="none">
      <Glyph name={glyph} color="#fff" strokeWidth={1.8} />
    </Svg>}
```

- [ ] **Step 3 : Typecheck + vérif visuelle (point de validation)**

Run : `npx tsc --noEmit` → OK.
Rendre `<BadgePill badge="MVP" showLabel />`, `"La Bombe"`, `"CANNON"` (alias), `"Le Cerveau"`, `"3e Mi-temps"` côte à côte → vérifier pastilles colorées + glyphe blanc lisible + alias résolu correctement.

---

## Task 5 : Migrer `index.tsx` (badges + SVG inline)

**Files:**
- Modify: `app/(tabs)/index.tsx` (lignes ~14-243 icônes inline ; ~245-251 `BADGE_EMOJI` ; ~696 rendu badge)

**Interfaces:**
- Consumes: `Icon` (registre), `BadgePill`.
- Produces: rien (écran).

- [ ] **Step 1 : Remplacer le rendu badge**

Importer en tête de fichier :

```tsx
import { BadgePill } from '../../components/profile/BadgePill';
```

Remplacer (ligne ~696) :

```tsx
<Text style={{ fontSize: 20 }}>{BADGE_EMOJI[b.label] ?? '🏅'}</Text>
```

par :

```tsx
<BadgePill badge={b.label} size={24} />
```

- [ ] **Step 2 : Supprimer la table locale `BADGE_EMOJI`**

Supprimer le bloc `const BADGE_EMOJI: Record<string,string> = { ... };` (lignes ~245-251).

- [ ] **Step 3 : Remplacer les SVG inline par le registre**

Pour chaque composant inline (`IconRadar`, `IconTrophy`, `IconCalendar`, `IconPen`, `BellFilledIcon`) : remplacer les usages JSX par `<Icon name="radar" />`, `<Icon name="trophy" />`, `<Icon name="calendar" />`, `<Icon name="pencil" />`, `<Icon name="bell" />` (couleur/size repris des props existantes), puis supprimer les définitions inline. Importer `Icon` si absent :

```tsx
import { Icon } from '../../components/community/icons';
```

- [ ] **Step 4 : Typecheck + vérif visuelle**

Run : `npx tsc --noEmit` → OK (plus aucune référence à `BADGE_EMOJI` / `IconRadar` etc.).
Vérif device : écran Accueil — badges en pastilles, icônes radar/trophée/calendrier/stylo/cloche identiques au rendu précédent.

---

## Task 6 : Migrer `lobby.tsx` et `score-entry.tsx` (badges)

**Files:**
- Modify: `app/(tabs)/lobby.tsx` (`BADGE_EMOJI` ~825-827 + rendus)
- Modify: `app/score-entry.tsx` (`BADGE_EMOJI` ~21-23 + rendus)

**Interfaces:**
- Consumes: `BadgePill`.

- [ ] **Step 1 : `lobby.tsx` — importer et remplacer**

Ajouter l'import `import { BadgePill } from '../../components/profile/BadgePill';`. Remplacer chaque `<Text>{BADGE_EMOJI[...]}</Text>` (rechercher `BADGE_EMOJI` dans le fichier) par `<BadgePill badge={...} size={24} />`. Supprimer le bloc `const BADGE_EMOJI = {...}`.

- [ ] **Step 2 : `score-entry.tsx` — importer et remplacer**

Ajouter `import { BadgePill } from '../components/profile/BadgePill';` (chemin depuis `app/`). Remplacer les usages de `BADGE_EMOJI` par `<BadgePill badge={...} size={24} />`. Supprimer le bloc `const BADGE_EMOJI = {...}`.

- [ ] **Step 3 : Typecheck**

Run : `npx tsc --noEmit`
Expected : aucune référence résiduelle à `BADGE_EMOJI` dans ces deux fichiers ; pas d'erreur.

- [ ] **Step 4 : Vérif visuelle (point de validation)**

Device : lobby (cartes parties) + saisie de score → badges en pastilles colorées, pas d'emoji.

---

## Task 7 : Migrer `player/[id].tsx` (badges + DNA via source unique)

**Files:**
- Modify: `app/(tabs)/player/[id].tsx` (`BADGES_INFO` ~54-83 ; usages ; `DNA_AXES` ~85-91)

**Interfaces:**
- Consumes: `getBadge`, `BadgePill`.

- [ ] **Step 1 : Remplacer `BADGES_INFO` par la source unique**

Importer :

```tsx
import { getBadge } from '../../../lib/badges';
import { BadgePill } from '../../../components/profile/BadgePill';
```

(vérifier la profondeur du chemin relatif depuis `app/(tabs)/player/`).

Là où le code lit `BADGES_INFO[key]` pour afficher `{ icon, label }`, remplacer le rendu de l'icône emoji par `<BadgePill badge={key} size={...} showLabel />` (le `BadgePill` résout l'alias et le label via `getBadge`). Si seul le label est requis ailleurs, utiliser `getBadge(key).label`. Supprimer ensuite le bloc `BADGES_INFO`.

- [ ] **Step 2 : DNA_AXES — garder ou convertir**

`DNA_AXES` (`💥🏃😄🧱🧠`) sert d'axes du radar « ADN de jeu ». Le convertir en glyphes line-art : remplacer le champ `emoji` par `glyph` (`'bomb','runner','smile','brick','brain'`) et rendre `<Glyph>` (dans un `<Svg>` wrapper, cf. Task 4) à la place du `<Text>` emoji aux sommets du radar. Importer `Glyph` depuis `../../../components/profile/glyphs`.

- [ ] **Step 3 : Typecheck + vérif visuelle**

Run : `npx tsc --noEmit` → OK, plus de `BADGES_INFO`.
Device : profil joueur — onglet Palmarès/Badges en pastilles ; radar ADN avec glyphes line-art.

---

## Task 8 : Balayage des emoji UI (famille A) — écran par écran

**Files:**
- Modify: écrans utilisant des emoji fonctionnels (repérés via recherche). Principaux candidats : `app/(tabs)/lobby.tsx`, `app/(tabs)/CreateWizard.tsx`, `app/(tabs)/GameDetailsSheet.tsx`, `app/(tabs)/admin.tsx`, `app/(tabs)/chats.tsx`, `app/(tabs)/notifications.tsx`.

**Interfaces:**
- Consumes: `Icon` (registre).

- [ ] **Step 1 : Localiser les emoji fonctionnels**

Rechercher dans `app/` et `components/` (hors famille C) les occurrences de : `🔍 🔔 🔕 💬 📍 📅` et symboles texte utilisés comme icônes `✓ ✕ × →`. Pour chaque occurrence, juger si elle est **fonctionnelle** (bouton/état/section → à convertir) ou **expressive/contenu** (famille C → laisser).

- [ ] **Step 2 : Remplacer par `<Icon>` (table de correspondance)**

| Avant | Après |
|---|---|
| 🔍 | `<Icon name="search" .../>` |
| 🔔 / 🔕 | `<Icon name="bell" .../>` / `<Icon name="bellRing" .../>` |
| 💬 | `<Icon name="message" .../>` |
| 📍 | `<Icon name="mapPin" .../>` |
| 📅 | `<Icon name="calendar" .../>` |
| ✓ | `<Icon name="check" .../>` |
| ✕ / × | `<Icon name="x" .../>` |
| → | `<Icon name="arrowRight" .../>` |
| ✏️ | `<Icon name="pencil" .../>` |

Reprendre la couleur/taille du `<Text>` remplacé pour conserver l'alignement. Procéder **un écran à la fois**, `npx tsc --noEmit` après chaque écran.

- [ ] **Step 3 : Vérif visuelle par écran (point de validation)**

Pour chaque écran modifié : device check que l'icône remplace bien l'emoji sans casser la mise en page (alignement vertical, espacement). Famille C (réactions, médailles) intacte.

- [ ] **Step 4 : Vérification finale**

Run : `npx tsc --noEmit` (global) → OK.
Recherche finale : plus aucun emoji fonctionnel résiduel dans les écrans traités ; réactions chat / médailles inchangées.

---

## Self-Review

**Spec coverage :**
- Architecture source unique → Tasks 1-4 (registres complétés, `lib/badges.ts`, `BadgePill`). ✓
- Mapping 13 badges (couleurs par famille) → Task 3 (table) + Task 2 (glyphes). ✓
- Suppression des 4 `BADGE_EMOJI` dupliqués → Tasks 5, 6, 7. ✓
- Suppression SVG inline `index.tsx` → Task 5 Step 3. ✓
- Balayage emoji UI famille A → Task 8. ✓
- Famille C intouchée → Global Constraints + Task 8 Step 1. ✓
- Pas de nouvelle dépendance / travail sur main sans commit → Global Constraints. ✓

**Placeholders :** aucun « TODO/TBD » ; code complet fourni pour chaque création.

**Cohérence des types :** `getBadge(key): BadgeStyle { label, glyph, color }` défini en Task 3, consommé identiquement en Tasks 4/5/6/7. `BadgePill({ badge, size, showLabel })` défini en Task 4, appelé avec ces props en Tasks 5/6/7. Noms de glyphes de Task 2 == valeurs `glyph` de Task 3. Noms d'icônes de Task 1 == utilisés en Tasks 5/8. ✓

**Point d'attention connu :** `Glyph` ne fournit pas le wrapper `<Svg>` — traité explicitement en Task 4 Step 2 (et réutilisé Task 7 Step 2).
