# Onboarding cible → prod (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recréer fidèlement l'onboarding cible (8 écrans, clair+sombre, push câblé) du prototype `design_handoff_onboarding_aide/` dans le code React Native de `react-matchup`, sans régresser le bouton « ? » (centre d'aide = Phase 2).

**Architecture :** Une fondation partagée (thème clair/sombre piloté par `useColorScheme`, icônes Lucide étendues, 7 mini-mockups RN) consommée par un nouveau composant `Onboarding.tsx` (carrousel swipe). `OnboardingCarousel.tsx` devient une coquille fine de signature inchangée ; le reste de l'app et `GUIDE_KEY` ne bougent pas.

**Tech Stack :** React Native / Expo, TypeScript, `react-native-svg` (icônes + dégradés), `expo-linear-gradient` (fonds dégradés), `Animated` + `PanResponder` (swipe/anims), `expo-notifications` (push), `AsyncStorage` (flag 1er lancement).

**Spec source :** [docs/superpowers/specs/2026-06-02-onboarding-cible-prod-design.md](../specs/2026-06-02-onboarding-cible-prod-design.md)

**Note tests :** Le projet n'a pas de framework de tests RN et la spec retient la **vérification manuelle via Expo**. Aucune dépendance de test n'est introduite. Chaque tâche se termine par une vérification (typecheck + contrôle visuel) puis un commit. Lancer l'app : `npx expo start` depuis `react-matchup/`.

---

## Référence de conversion CSS (prototype) → RN

Les illustrations et écrans portent du JSX web. Appliquer systématiquement :

| Web (prototype) | React Native |
|---|---|
| `<div>` | `<View>` |
| Texte nu dans un div | toujours enveloppé dans `<Text>` |
| `style={{ background: '#XXX' }}` (couleur unie) | `backgroundColor: '#XXX'` |
| `background: 'linear-gradient(...)'` | `<GradientRect colors={[...]} .../>` (helper `react-native-svg` de `_shared.tsx` — le codebase n'utilise PAS expo-linear-gradient) |
| `border: '1px solid #XXX'` | `borderWidth: 1, borderColor: '#XXX'` |
| `boxShadow: '0 Ah Br rgba(...)'` | `shadowColor, shadowOpacity, shadowRadius, shadowOffset:{width,height}, elevation` (Android) |
| `display:'flex'` (rangée par défaut web) | `flexDirection:'row'` **explicite** (RN défaut = `column`) |
| `gap` | supporté (RN ≥ 0.71, ok ici) |
| `F.ui` / `F.display` / `F.welcome` | `Fonts.ui` / `Fonts.display` / `Fonts.welcome` (de `lib/theme`) |
| `fontWeight: 500/600/700/800/900` | famille dédiée : 500→`Fonts.ui`, 600→`Fonts.uiSemi`, 700→`Fonts.uiBold`, 800→`Fonts.uiExtraBold`, 900→`Fonts.uiBlack` |
| `MiniAvatar` du prototype | réutiliser `Avatar` de [components/community/Avatar.tsx](../../../components/community/Avatar.tsx) |
| dégradé de ligue sur petit carré | `<LinearGradient colors={LeagueGradients[k]} ...>` |

Couleurs de surface : **ne jamais coder en dur** — lire via `useGuideTheme()` (Tâche 1). Les cartes de mockup restent volontairement claires (`#FFFFFF`) dans les deux thèmes (« product feel », choix spec).

---

## Structure de fichiers

- Créer `lib/guideTheme.ts` — tokens clair/sombre + `RUBRIC` + hook `useGuideTheme()`.
- Modifier `components/community/icons.tsx` — ajouter glyphes Lucide.
- Créer `components/guide/illustrations/_shared.tsx` — `Pill`, `miniCard`, `MiniLabel`, `LeagueSwatch`.
- Créer `components/guide/illustrations/{Lobby,Recherche,Defi,Ligues,Badges,Stories,Notif}.tsx` — 1 mockup chacun.
- Créer `components/guide/illustrations/index.ts` — registre `ILLUST`.
- Modifier `hooks/usePushNotifications.ts` — extraire `registerForPushAsync()`.
- Créer `components/guide/Onboarding.tsx` — carrousel 8 écrans.
- Modifier `components/OnboardingCarousel.tsx` — coquille → `<Onboarding/>`.

---

## Task 1: Thème du guide (clair/sombre + rubriques)

**Files:**
- Create: `lib/guideTheme.ts`

- [ ] **Step 1: Écrire `lib/guideTheme.ts`**

```ts
// Thème clair/sombre + accents par rubrique pour les surfaces Guide (onboarding + aide).
// Isolé : seuls les composants du guide le consomment. Suit l'OS via useColorScheme().
// Miroir de design_handoff_onboarding_aide/kit.jsx (theme(mode) + RUBRIC).
import { useColorScheme } from 'react-native';

export interface GuideTheme {
  mode: 'light' | 'dark';
  bg: string; bgAlt: string; card: string; cardAlt: string;
  border: string; divider: string; chip: string;
  text: string; sub: string; muted: string;
  ctaBg: string; ctaFg: string; overlay: string;
}

const LIGHT: GuideTheme = {
  mode: 'light',
  bg: '#F5F5F4', bgAlt: '#FAFAF9', card: '#FFFFFF', cardAlt: '#FAFAF9',
  border: '#E7E5E4', divider: '#F1F0EE', chip: '#F6F5F3',
  text: '#0A0A0A', sub: '#52525B', muted: '#A1A1AA',
  ctaBg: '#0A0A0A', ctaFg: '#FFFFFF', overlay: 'rgba(10,10,10,0.45)',
};

const DARK: GuideTheme = {
  mode: 'dark',
  bg: '#0A0A0A', bgAlt: '#08080A', card: '#151518', cardAlt: '#1A1A1E',
  border: '#28282E', divider: 'rgba(255,255,255,0.07)', chip: '#202026',
  text: '#FFFFFF', sub: '#8A8A92', muted: '#5D5D66',
  ctaBg: '#FFC11A', ctaFg: '#0A0A0A', overlay: 'rgba(0,0,0,0.6)',
};

export function useGuideTheme(): GuideTheme {
  return useColorScheme() === 'dark' ? DARK : LIGHT;
}

export interface Rubric {
  key: string; accent: string; soft: string; emoji: string; title: string; sub: string;
}

// Accents par rubrique (fixes, indépendants du thème). Onboarding utilise accent/soft/emoji/title.
export const RUBRIC: Record<string, Rubric> = {
  welcome:   { key: 'welcome',   accent: '#E8A906', soft: 'rgba(232,169,6,0.12)',  emoji: '👋', title: 'Bienvenue',           sub: 'À quoi sert PagMatch' },
  lobby:     { key: 'lobby',     accent: '#2563EB', soft: 'rgba(37,99,235,0.10)',  emoji: '📋', title: 'Lobby',               sub: 'Trouve ou crée ta partie' },
  defis:     { key: 'defis',     accent: '#D97706', soft: 'rgba(217,119,6,0.11)',  emoji: '⚡', title: 'Défis',               sub: 'Affronte un joueur directement' },
  recherche: { key: 'recherche', accent: '#4F46E5', soft: 'rgba(79,70,229,0.10)',  emoji: '🔎', title: 'Recherche de joueurs', sub: 'Trouve qui défier ou inviter' },
  ranking:   { key: 'ranking',   accent: '#059669', soft: 'rgba(5,150,105,0.10)',  emoji: '🏆', title: 'Classement & Ligues', sub: 'Ton ELO, tes ligues' },
  chats:     { key: 'chats',     accent: '#0891B2', soft: 'rgba(8,145,178,0.11)',  emoji: '💬', title: 'Chats',               sub: 'Un fil par partie' },
  badges:    { key: 'badges',    accent: '#B45309', soft: 'rgba(180,83,9,0.11)',   emoji: '🎖️', title: 'Palmarès & Badges',  sub: 'Des trophées votés par tes adversaires' },
  stories:   { key: 'stories',   accent: '#DB2777', soft: 'rgba(219,39,119,0.10)', emoji: '📤', title: 'Stories & Partage',  sub: 'Partage et invite en 9:16' },
  faq:       { key: 'faq',       accent: '#7C3AED', soft: 'rgba(124,58,237,0.10)', emoji: '🆘', title: 'Dépannage',          sub: 'Un souci ? On te débloque' },
};
```

- [ ] **Step 2: Typecheck**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: aucune erreur sur `lib/guideTheme.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/guideTheme.ts
git commit -m "feat(guide): thème clair/sombre + rubriques pour l'onboarding"
```

---

## Task 2: Icônes Lucide manquantes

**Files:**
- Modify: `components/community/icons.tsx`

- [ ] **Step 1: Étendre le type `IconName`**

Dans [components/community/icons.tsx:6-9](../../../components/community/icons.tsx), remplacer l'union `IconName` par :

```ts
export type IconName =
  | 'chevronLeft' | 'chevronRight' | 'chevronDown' | 'bell' | 'users' | 'search' | 'plus'
  | 'mapPin' | 'check' | 'x' | 'arrowRight' | 'arrowLeft' | 'message' | 'camera'
  | 'clock' | 'trophy' | 'zap' | 'swords' | 'radar' | 'bellRing' | 'send' | 'qr'
  | 'sliders' | 'trendingUp' | 'share';
```

- [ ] **Step 2: Ajouter les cas dans le `switch`**

Dans le `switch (name)` du composant `Icon`, ajouter avant le `default`/la fin (paths Lucide officiels, viewBox 24×24) :

```tsx
case 'chevronDown':
  return <Path {...common} d="m6 9 6 6 6-6" />;
case 'arrowLeft':
  return <Path {...common} d="m12 19-7-7 7-7M19 12H5" />;
case 'swords':
  return <G>
    <Polyline {...common} points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
    <Line {...common} x1="13" y1="19" x2="19" y2="13" />
    <Line {...common} x1="16" y1="16" x2="20" y2="20" />
    <Line {...common} x1="19" y1="21" x2="21" y2="19" />
    <Polyline {...common} points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" />
    <Line {...common} x1="5" y1="14" x2="9" y2="18" />
    <Line {...common} x1="7" y1="17" x2="4" y2="20" />
    <Line {...common} x1="3" y1="19" x2="5" y2="21" />
  </G>;
case 'radar':
  return <G>
    <Path {...common} d="M19.07 4.93A10 10 0 0 0 6.99 3.34" />
    <Path {...common} d="M4 6h.01" />
    <Path {...common} d="M2.29 9.62A10 10 0 1 0 21.31 8.35" />
    <Path {...common} d="M16.24 7.76A6 6 0 1 0 8.23 16.67" />
    <Path {...common} d="M12 18h.01" />
    <Path {...common} d="M17.99 11.66A6 6 0 0 1 15.77 16.67" />
    <Circle {...common} cx="12" cy="12" r="2" />
    <Path {...common} d="m13.41 10.59 5.66-5.66" />
  </G>;
case 'bellRing':
  return <G>
    <Path {...common} d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <Path {...common} d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    <Path {...common} d="M4 2C2.8 3.7 2 5.7 2 8" />
    <Path {...common} d="M22 8c0-2.3-.8-4.3-2-6" />
  </G>;
case 'send':
  return <G>
    <Path {...common} d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
    <Path {...common} d="m21.854 2.147-10.94 10.939" />
  </G>;
case 'qr':
  return <G>
    <Rect {...common} x="3" y="3" width="5" height="5" rx="1" />
    <Rect {...common} x="16" y="3" width="5" height="5" rx="1" />
    <Rect {...common} x="3" y="16" width="5" height="5" rx="1" />
    <Path {...common} d="M21 16h-3a2 2 0 0 0-2 2v3M21 21v.01M12 7v3a2 2 0 0 1-2 2H7M3 12h.01M12 3h.01M12 16v.01M16 12h1M21 12v.01M12 21v-1" />
  </G>;
case 'sliders':
  return <G>
    <Line {...common} x1="4" y1="21" x2="4" y2="14" />
    <Line {...common} x1="4" y1="10" x2="4" y2="3" />
    <Line {...common} x1="12" y1="21" x2="12" y2="12" />
    <Line {...common} x1="12" y1="8" x2="12" y2="3" />
    <Line {...common} x1="20" y1="21" x2="20" y2="16" />
    <Line {...common} x1="20" y1="12" x2="20" y2="3" />
    <Line {...common} x1="2" y1="14" x2="6" y2="14" />
    <Line {...common} x1="10" y1="8" x2="14" y2="8" />
    <Line {...common} x1="18" y1="16" x2="22" y2="16" />
  </G>;
case 'trendingUp':
  return <G>
    <Polyline {...common} points="22 7 13.5 15.5 8.5 10.5 2 17" />
    <Polyline {...common} points="16 7 22 7 22 13" />
  </G>;
case 'share':
  return <G>
    <Circle {...common} cx="18" cy="5" r="3" />
    <Circle {...common} cx="6" cy="12" r="3" />
    <Circle {...common} cx="18" cy="19" r="3" />
    <Line {...common} x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <Line {...common} x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </G>;
```

Vérifier que `Rect` et `Polyline` sont bien importés en haut du fichier (l'import existant est `import Svg, { Path, Line, Polyline, Polygon, Circle, G } from 'react-native-svg';` — `Rect` manque, l'ajouter) :

```ts
import Svg, { Path, Line, Polyline, Polygon, Circle, G, Rect } from 'react-native-svg';
```

- [ ] **Step 2b: Vérifier le rendu de chaque nouvelle icône**

Rendu temporaire (ou via Storybook mental) : afficher chaque nom dans un écran scratch et confirmer qu'aucune ne tombe sur le `default`. Supprimer le scratch après.

- [ ] **Step 3: Typecheck**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4: Commit**

```bash
git add components/community/icons.tsx
git commit -m "feat(icons): glyphes Lucide pour l'onboarding (swords, radar, bellRing, send, qr, sliders, trendingUp, share, chevronDown, arrowLeft)"
```

---

## Task 3: Refactor push — `registerForPushAsync()` réutilisable

**Files:**
- Modify: `hooks/usePushNotifications.ts`

- [ ] **Step 1: Extraire la fonction d'enregistrement**

Dans [hooks/usePushNotifications.ts](../../../hooks/usePushNotifications.ts), au-dessus de `export function usePushNotifications()`, ajouter :

```ts
// Demande la permission push, récupère le token Expo et l'enregistre en DB.
// Idempotent : un second appel sur permission déjà accordée ne re-prompte pas.
// Réutilisé par le hook (au montage) ET par l'écran final de l'onboarding (bouton « Activer & jouer »).
export async function registerForPushAsync(playerId: string): Promise<'granted' | 'denied' | 'skipped'> {
  if (IS_EXPO_GO) { console.log('[push] Expo Go → enregistrement impossible (build natif requis)'); return 'skipped'; }
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: Colors.brand,
      });
    }
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    console.log('[push] permission =', finalStatus);
    if (finalStatus !== 'granted') return 'denied';

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
    });
    const token = tokenData.data;
    console.log('[push] token obtenu =', token);
    const { error } = await supabase.from('players').update({ push_token: token }).eq('id', playerId);
    console.log('[push] save DB', error ? `ERREUR: ${error.message}` : 'OK');
    return 'granted';
  } catch (e) {
    console.log('[push] EXCEPTION (FCM/Firebase pas dans le build ?):', String(e));
    return 'skipped';
  }
}
```

- [ ] **Step 2: Faire consommer la fonction par le hook**

Remplacer le corps du premier `useEffect` (l'IIFE async d'enregistrement, [lignes 30-74](../../../hooks/usePushNotifications.ts)) par un appel à la fonction extraite, en gardant la garde anti-doublon de token côté hook :

```ts
useEffect(() => {
  if (!player) { console.log('[push] pas de player → skip'); return; }
  registerForPushAsync(player.id);
}, [player?.id]);
```

> Note : la garde `savedToken` devient inutile (l'update DB est idempotent et peu fréquent). Supprimer la ref `savedToken` si elle n'est plus référencée ailleurs.

- [ ] **Step 3: Typecheck**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: aucune erreur. Vérifier qu'aucune variable (`savedToken`) n'est orpheline.

- [ ] **Step 4: Vérification manuelle (build natif)**

Lancer l'app sur un build dev natif, se connecter → confirmer dans les logs `[push] permission = granted` puis `[push] save DB OK` (comportement identique à avant le refactor).

- [ ] **Step 5: Commit**

```bash
git add hooks/usePushNotifications.ts
git commit -m "refactor(push): extraire registerForPushAsync() réutilisable"
```

---

## Task 4: Primitives partagées des illustrations

**Files:**
- Create: `components/guide/illustrations/_shared.tsx`

- [ ] **Step 1: Écrire `_shared.tsx`**

```tsx
// Primitives partagées par les mini-mockups d'onboarding (port de illustrations.jsx + kit.jsx).
import React from 'react';
import { View, Text, ViewStyle, TextStyle } from 'react-native';
import Svg, { Rect, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import { Fonts, LeagueGradients } from '../../../lib/theme';
import type { League } from '../../../types';

// Carte blanche flottante — volontairement claire dans les deux thèmes (« product feel »).
export function miniCard(extra: ViewStyle = {}): ViewStyle {
  return {
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#ECEAE7', borderRadius: 16,
    shadowColor: '#0A0A0A', shadowOpacity: 0.18, shadowRadius: 15, shadowOffset: { width: 0, height: 10 },
    elevation: 6, ...extra,
  };
}

export const miniLabel: TextStyle = {
  fontFamily: Fonts.uiBold, fontSize: 9, letterSpacing: 1.4,
  textTransform: 'uppercase', color: '#A1A1AA',
};

// Rectangle dégradé via react-native-svg (même approche que components/community/Avatar.tsx).
// Remplace `background: 'linear-gradient(...)'` du prototype. L'id est local à chaque <Svg>.
export function GradientRect({ colors, width, height, radius = 0, diagonal = true }:
  { colors: readonly [string, string]; width: number; height: number; radius?: number; diagonal?: boolean }) {
  return (
    <Svg width={width} height={height}>
      <Defs>
        <SvgLinearGradient id="g" x1="0" y1="0" x2={diagonal ? '1' : '0'} y2="1">
          <Stop offset="0" stopColor={colors[0]} />
          <Stop offset="1" stopColor={colors[1]} />
        </SvgLinearGradient>
      </Defs>
      <Rect x="0" y="0" width={width} height={height} rx={radius} ry={radius} fill="url(#g)" />
    </Svg>
  );
}

// Petit dégradé de ligue (carré arrondi) — remplace `background: LEAGUE_GRAD[k]` du prototype.
export function LeagueSwatch({ league, size = 26, radius = 8 }: { league: League; size?: number; radius?: number }) {
  const g = (LeagueGradients[league] ?? LeagueGradients.gold) as [string, string];
  return <GradientRect colors={g} width={size} height={size} radius={radius} />;
}

type PillVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';
const PILL: Record<PillVariant, { bg: string; fg: string; bd: string }> = {
  neutral: { bg: '#FAFAF9', fg: '#52525B', bd: '#E7E5E4' },
  brand:   { bg: 'rgba(255,193,26,0.14)', fg: '#E8A906', bd: 'rgba(255,193,26,0.55)' },
  success: { bg: 'rgba(16,185,129,0.10)', fg: '#047857', bd: 'rgba(16,185,129,0.45)' },
  warning: { bg: 'rgba(245,158,11,0.12)', fg: '#B45309', bd: 'rgba(245,158,11,0.50)' },
  danger:  { bg: 'rgba(239,68,68,0.10)', fg: '#B91C1C', bd: 'rgba(239,68,68,0.45)' },
  info:    { bg: 'rgba(59,130,246,0.10)', fg: '#1D4ED8', bd: 'rgba(59,130,246,0.45)' },
};

export function Pill({ variant = 'neutral', children, fontSize = 10 }:
  { variant?: PillVariant; children: React.ReactNode; fontSize?: number }) {
  const s = PILL[variant];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
      backgroundColor: s.bg, borderWidth: 1, borderColor: s.bd, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text style={{ color: s.fg, fontFamily: Fonts.uiBlack, fontSize, letterSpacing: 0.4, textTransform: 'uppercase' }}>
        {children}
      </Text>
    </View>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: aucune erreur. (`react-native-svg` est déjà une dépendance — aucun nouveau module natif.)

- [ ] **Step 3: Commit**

```bash
git add components/guide/illustrations/_shared.tsx
git commit -m "feat(guide): primitives partagées des illustrations (miniCard, Pill, LeagueSwatch)"
```

---

## Task 5: Illustration Lobby (mockup de référence — complet)

**Files:**
- Create: `components/guide/illustrations/Lobby.tsx`

Port de `IllustLobby` ([illustrations.jsx:22-74](../../../design_handoff_onboarding_aide/illustrations.jsx)).

- [ ] **Step 1: Écrire `Lobby.tsx`**

```tsx
import React from 'react';
import { View, Text } from 'react-native';
import { Avatar } from '../../community/Avatar';
import { Icon } from '../../community/icons';
import { Fonts } from '../../../lib/theme';
import { miniCard, miniLabel, Pill } from './_shared';

export function IllustLobby() {
  return (
    <View style={{ width: 290 }}>
      {/* carte fantôme en fond pour la profondeur */}
      <View style={{ ...miniCard(), position: 'absolute', top: -14, left: 16, right: 16, height: 70,
        transform: [{ rotate: '-2.5deg' }], opacity: 0.5 }} />

      {/* partie urgente */}
      <View style={{ ...miniCard({ borderColor: 'rgba(239,68,68,0.30)' }), padding: 14, marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 }}>
          <Pill variant="danger" fontSize={9}>🆘 Urgent · 1 place</Pill>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: '#52525B' }}>Auj. 19:00</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <Avatar name="Karim B" size={30} radius={10} league="gold" />
          <View style={{ width: 6 }} />
          <Avatar name="Sofia I" size={30} radius={10} league="silver" />
          <View style={{ width: 6 }} />
          <Avatar name="Omar T" size={30} radius={10} league="gold" />
          <View style={{ width: 6 }} />
          <View style={{ width: 30, height: 30, borderRadius: 10, borderWidth: 2, borderStyle: 'dashed',
            borderColor: '#D8D4CE', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: Fonts.display, fontSize: 16, color: '#C0BBB2' }}>?</Text>
          </View>
          <View style={{ flex: 1 }} />
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ ...miniLabel, fontSize: 8 }}>Niveau</Text>
            <Text style={{ fontFamily: Fonts.display, fontSize: 17, color: '#0A0A0A' }}>5.5–6</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 11, borderTopWidth: 1, borderTopColor: '#F1F0EE' }}>
          <Icon name="mapPin" size={13} color="#A1A1AA" />
          <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: '#52525B', marginLeft: 6 }}>Padel Club Casa · Piste 3</Text>
          <View style={{ flex: 1 }} />
          <View style={{ backgroundColor: '#FFC11A', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}>
            <Text style={{ color: '#0A0A0A', fontFamily: Fonts.uiExtraBold, fontSize: 10.5 }}>Rejoindre</Text>
          </View>
        </View>
      </View>

      {/* partie normale */}
      <View style={{ ...miniCard(), paddingVertical: 11, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row' }}>
          <View style={{ borderWidth: 2, borderColor: '#fff', borderRadius: 9 }}>
            <Avatar name="Yassine R" size={26} radius={8} league="gold" />
          </View>
          <View style={{ marginLeft: -9, borderWidth: 2, borderColor: '#fff', borderRadius: 9 }}>
            <Avatar name="Nadia E" size={26} radius={8} league="bronze" />
          </View>
        </View>
        <View style={{ flex: 1, marginLeft: 9 }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11.5, color: '#0A0A0A' }}>Double · Dimanche</Text>
          <Text style={{ fontFamily: Fonts.ui, fontSize: 10, color: '#A1A1AA' }}>2 places · Niv. 4–5</Text>
        </View>
        <Pill variant="success" fontSize={8.5}>10:30</Pill>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Vérification visuelle**

Monter `<IllustLobby/>` dans un écran scratch (`npx expo start`), comparer côte à côte avec le prototype (http://127.0.0.1:8753/design_handoff_onboarding_aide/index.html → onboarding écran Lobby). Ajuster espacements si dérive visible. Retirer le scratch.

- [ ] **Step 3: Commit**

```bash
git add components/guide/illustrations/Lobby.tsx
git commit -m "feat(guide): illustration Lobby"
```

---

## Task 6: Illustration Notif (final — complet)

**Files:**
- Create: `components/guide/illustrations/Notif.tsx`

Port de `IllustNotif` ([illustrations.jsx:266-290](../../../design_handoff_onboarding_aide/illustrations.jsx)).

- [ ] **Step 1: Écrire `Notif.tsx`**

```tsx
import React from 'react';
import { View, Text } from 'react-native';
import { Icon, IconName } from '../../community/icons';
import { Fonts } from '../../../lib/theme';
import { miniCard } from './_shared';

const ITEMS: { ic: IconName; c: string; bg: string; t: string; s: string }[] = [
  { ic: 'zap',     c: '#D97706', bg: 'rgba(217,119,6,0.12)', t: 'Nouveau défi de Sami',     s: 'à l’instant' },
  { ic: 'message', c: '#0891B2', bg: 'rgba(8,145,178,0.12)', t: 'Omar a répondu au chat',   s: 'il y a 2 min' },
  { ic: 'check',   c: '#059669', bg: 'rgba(5,150,105,0.12)', t: 'Score validé · +0.18 niv.', s: 'il y a 1 h' },
];

export function IllustNotif() {
  return (
    <View style={{ width: 286 }}>
      {ITEMS.map((n, i) => (
        <View key={i} style={{ ...miniCard(), paddingVertical: 12, paddingHorizontal: 13, flexDirection: 'row',
          alignItems: 'center', marginBottom: 10, transform: [{ translateX: i * 8 }], opacity: 1 - i * 0.12,
          shadowOpacity: 0.16 - i * 0.04, shadowRadius: 26 - i * 4, shadowOffset: { width: 0, height: 10 - i * 2 } }}>
          <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: n.bg,
            alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={n.ic} size={18} color={n.c} />
          </View>
          <View style={{ flex: 1, minWidth: 0, marginLeft: 11 }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12.5, color: '#0A0A0A' }}>{n.t}</Text>
            <Text style={{ fontFamily: Fonts.ui, fontSize: 10.5, color: '#A1A1AA' }}>{n.s}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}
```

- [ ] **Step 2: Vérification visuelle** (comme Task 5, écran final).
- [ ] **Step 3: Commit**

```bash
git add components/guide/illustrations/Notif.tsx
git commit -m "feat(guide): illustration Notif (écran final)"
```

---

## Task 7: Illustration Recherche

**Files:**
- Create: `components/guide/illustrations/Recherche.tsx`

Port de `IllustRecherche` ([illustrations.jsx:292-331](../../../design_handoff_onboarding_aide/illustrations.jsx)). Appliquer la **Référence de conversion**. Données exactes :

```ts
const ROWS = [
  { n: 'Sami Lahlou',  lvl: '5.40', lg: 'silver' as const, frmt: true },
  { n: 'Inès Berrada', lvl: '6.10', lg: 'gold'   as const, frmt: false },
];
```

- [ ] **Step 1: Écrire `Recherche.tsx`** en respectant cette structure :
  - Carte `miniCard()` largeur 278, padding 14.
  - **Champ de recherche** : `View` rangée, hauteur 40, radius 12, `backgroundColor:'#FAFAF9'`, `borderWidth:1.5, borderColor:'rgba(79,70,229,0.45)'`. Contenu : `Icon name="search" size={16} color="#4F46E5"`, texte « Sami » (`Fonts.uiSemi`, 12.5, `#0A0A0A`) suivi d'un curseur « | » couleur `#4F46E5`, `flex:1` spacer, `Icon name="sliders" size={15} color="#A1A1AA"`.
  - Label « Résultats » (`miniLabel`, marges 12/8).
  - Pour chaque `ROWS` : ligne radius 12, fond `i===0 ? 'rgba(79,70,229,0.06)' : '#FAFAF9'`, bordure `i===0 ? 'rgba(79,70,229,0.30)' : '#EFEDEA'`, contenant `<Avatar name={r.n} size={32} radius={10} league={r.lg} />`, bloc nom (`Fonts.uiExtraBold` 12) + check vert `✓` si `r.frmt` + sous-ligne `Niv. {r.lvl} · {getLeagueLabel(r.lg)}` (`Fonts.uiBold` 9.5 `#A1A1AA`), et pastille « Défier » (`i===0` → fond `#0A0A0A` texte blanc, sinon fond `#fff` bord `#E7E5E4` texte `#52525B`).
  - `getLeagueLabel` importé de `lib/theme`.
- [ ] **Step 2: Vérification visuelle** (écran Recherche du prototype).
- [ ] **Step 3: Commit** — `git add components/guide/illustrations/Recherche.tsx && git commit -m "feat(guide): illustration Recherche"`

---

## Task 8: Illustration Defi

**Files:**
- Create: `components/guide/illustrations/Defi.tsx`

Port de `IllustDefi` ([illustrations.jsx:76-118](../../../design_handoff_onboarding_aide/illustrations.jsx)).

- [ ] **Step 1: Écrire `Defi.tsx`** :
  - Carte `miniCard()` largeur 280, padding 18/16, `overflow:'hidden'`. Halo : `View` absolu top -30 right -30, 110×110, radius 60, `backgroundColor:'rgba(217,119,6,0.08)'`.
  - Pastille centrée `Pill variant="warning" fontSize={9}`> « ⚡ Défi en attente ».
  - Rangée centrale (3 colonnes, `justifyContent:'center'`, gap 14) :
    - Colonne « Toi » : `<Avatar name="Toi K" size={54} radius={18} league="gold" />`, nom « Toi » (`Fonts.welcome`, italic, 14, uppercase `#0A0A0A`), « Niv. 6.02 » (`Fonts.uiExtraBold` 10 `#E8A906`).
    - Colonne centre : rond 38 noir `#0A0A0A` avec `Icon name="swords" size={19} color="#FFC11A"`, puis « VS » (`Fonts.display` 13 `#A1A1AA`).
    - Colonne « Sami » : `<Avatar name="Sami L" size={54} radius={18} league="silver" />`, « Sami », « Niv. 5.40 » (`#A1A1AA`).
  - Rangée de boutons (marginTop 16) : « Refuser » (flex 1, h 38, radius 999, bord `#E7E5E4`, fond `#FAFAF9`, texte `#52525B` `Fonts.uiExtraBold` 12) + « Relever le défi » (flex 1.4, h 38, radius 999, fond `#FFC11A`, `Icon name="zap" size={14} color="#0A0A0A"` + texte `#0A0A0A`).
  - **Note RN** : `fontStyle:'italic'` peut ne pas styliser une police custom ; `Fonts.welcome` est déjà la variante *Italic* (`BarlowCondensed_900Black_Italic`) → ne pas ajouter `fontStyle`.
- [ ] **Step 2: Vérification visuelle** (écran Défis).
- [ ] **Step 3: Commit** — `git commit -m "feat(guide): illustration Defi"`

---

## Task 9: Illustration Ligues

**Files:**
- Create: `components/guide/illustrations/Ligues.tsx`

Port de `IllustLigues` ([illustrations.jsx:120-152](../../../design_handoff_onboarding_aide/illustrations.jsx)). Données exactes :

```ts
const ROWS = [
  { k: 'diamond'   as const, n: 'Diamant',    lvl: '7.0+' },
  { k: 'gold'      as const, n: 'Or',         lvl: '5.5', cur: true },
  { k: 'silver'    as const, n: 'Argent',     lvl: '4.0' },
  { k: 'bronze'    as const, n: 'Bronze',     lvl: '2.5' },
  { k: 'discovery' as const, n: 'Découverte', lvl: '1.0' },
];
```

- [ ] **Step 1: Écrire `Ligues.tsx`** :
  - Carte `miniCard()` largeur 270, padding 14.
  - En-tête : « Ta progression » (`miniLabel`) + `Pill variant="success" fontSize={8.5}` avec `Icon name="trendingUp" size={10} color="#047857"` + « +0.18 niv. ».
  - Pour chaque `ROWS` : rangée radius 11, padding 6/9, fond/bord actifs si `cur` (`'rgba(255,193,26,0.10)'` / `'rgba(255,193,26,0.45)'`, sinon transparents). Contenu : `<LeagueSwatch league={r.k} size={26} radius={8} />`, nom (`r.cur ? Fonts.uiExtraBold : Fonts.uiBold`, 12.5, `r.cur ? '#0A0A0A' : '#52525B'`), si `cur` `Pill variant="brand" fontSize={8}`>« Tu es ici », niveau (`Fonts.display` 14, `r.cur ? '#0A0A0A' : '#C0BBB2'`).
- [ ] **Step 2: Vérification visuelle** (écran Classement & Ligues).
- [ ] **Step 3: Commit** — `git commit -m "feat(guide): illustration Ligues"`

---

## Task 10: Illustration Badges

**Files:**
- Create: `components/guide/illustrations/Badges.tsx`

Port de `IllustBadges` ([illustrations.jsx:196-221](../../../design_handoff_onboarding_aide/illustrations.jsx)). Données exactes :

```ts
const BADGES = [
  { e: '👑', n: 'MVP', got: true },        { e: '💥', n: 'La Bombe', got: true },
  { e: '🎯', n: 'Le Smash', got: false },  { e: '🤝', n: 'Fair-Play', got: true },
  { e: '🔥', n: 'Le Phénix', got: false }, { e: '🍻', n: '3e mi-temps', got: true },
];
```

- [ ] **Step 1: Écrire `Badges.tsx`** :
  - Carte `miniCard()` largeur 274, padding 15.
  - En-tête : « Trophées du match » (`miniLabel`) + `Pill variant="brand" fontSize={8.5}`> « Vote des adversaires ».
  - Grille 3 colonnes (RN : `flexDirection:'row', flexWrap:'wrap'`, chaque case largeur `(274 - 15*2 - 9*2)/3`, gap 9 simulé par marges) : chaque badge = case radius 13, padding 11/4, fond `b.got ? 'rgba(255,193,26,0.10)' : '#FAFAF9'`, bord `b.got ? 'rgba(255,193,26,0.40)' : '#EFEDEA'`, `opacity: b.got ? 1 : 0.55`. Contenu : emoji (fontSize 22 ; pour le rendu grisé des non-obtenus, `opacity` de la case suffit — pas de filtre grayscale en RN), nom (`Fonts.uiExtraBold` 9, centré, `b.got ? '#0A0A0A' : '#A1A1AA'`).
- [ ] **Step 2: Vérification visuelle** (écran Chats & Palmarès — illustration badges).
- [ ] **Step 3: Commit** — `git commit -m "feat(guide): illustration Badges"`

---

## Task 11: Illustration Stories

**Files:**
- Create: `components/guide/illustrations/Stories.tsx`

Port de `IllustStories` ([illustrations.jsx:223-263](../../../design_handoff_onboarding_aide/illustrations.jsx)). C'est la plus riche (carte 9:16 + dégradé + bloc QR + colonne de 3 tuiles).

- [ ] **Step 1: Écrire `Stories.tsx`** :
  - Conteneur rangée, gap 12, alignItems center.
  - **Carte 9:16** : 138×232, radius 22, `overflow:'hidden'`, bord 3 `#0A0A0A`. Fond dégradé : `<View style={StyleSheet.absoluteFill}><GradientRect colors={['#1A1A1C','#0A0A0A']} width={138} height={232} /></View>` (helper de `_shared.tsx`). Halo rose absolu top -20 right -20 90×90 radius 50 `rgba(219,39,119,0.30)`. Contenu (absolu, padding 13, colonne) : `Pill variant="brand" fontSize={7.5}`>« 🎾 Victoire », spacer `flex:1`, titre « Karim\ngagne 6-3 6-4 » (`Fonts.welcome`, 24, uppercase, blanc), « Niveau 6.02 · +0.18 » (`Fonts.uiExtraBold` 10 `#FFC11A`), bloc QR : `View` radius 12 padding 8 `backgroundColor:'rgba(255,255,255,0.10)'` rangée → carré blanc 34 radius 7 avec `Icon name="qr" size={22} color="#0A0A0A"` + texte « Rejoins-moi sur PagMatch » (`Fonts.uiBold` 8.5, `rgba(255,255,255,0.85)`, « PagMatch » en blanc).
  - **Colonne de 3 tuiles** (`[['camera','Photo'],['trophy','Résultat'],['share','Profil']]`) : chaque tuile `miniCard()` (la 1ère bord `'rgba(219,39,119,0.4)'`), padding 9/11, rangée, carré 26 radius 8 (`i===0` fond `'rgba(219,39,119,0.12)'` icône `#DB2777`, sinon `#FAFAF9` icône `#52525B`) + label (`Fonts.uiExtraBold` 11 `#0A0A0A`).
  - **Note RN** : pas de `backdropFilter` (ignoré en RN) — l'omettre.
- [ ] **Step 2: Vérification visuelle** (écran Stories & Partage).
- [ ] **Step 3: Commit** — `git commit -m "feat(guide): illustration Stories"`

---

## Task 12: Registre des illustrations

**Files:**
- Create: `components/guide/illustrations/index.ts`

- [ ] **Step 1: Écrire `index.ts`**

```ts
import { IllustLobby } from './Lobby';
import { IllustRecherche } from './Recherche';
import { IllustDefi } from './Defi';
import { IllustLigues } from './Ligues';
import { IllustBadges } from './Badges';
import { IllustStories } from './Stories';
import { IllustNotif } from './Notif';

// Clés alignées sur les écrans d'onboarding (Phase 1). welcome/chats viendront en Phase 2.
export const ILLUST = {
  lobby: IllustLobby,
  recherche: IllustRecherche,
  defis: IllustDefi,
  ranking: IllustLigues,
  badges: IllustBadges,
  stories: IllustStories,
  notif: IllustNotif,
} as const;

export type IllustKey = keyof typeof ILLUST;
```

- [ ] **Step 2: Typecheck** — `cd react-matchup && npx tsc --noEmit` → aucune erreur.
- [ ] **Step 3: Commit** — `git add components/guide/illustrations/index.ts && git commit -m "feat(guide): registre des illustrations"`

---

## Task 13: Composant `Onboarding` (carrousel 8 écrans)

**Files:**
- Create: `components/guide/Onboarding.tsx`

Port de `onboarding.jsx` (Hero/Feature/Final + pager swipe + Reveal). Consomme `useGuideTheme()`, `RUBRIC`, `ILLUST`, `Icon`, `registerForPushAsync`, `usePlayer`.

- [ ] **Step 1: Définir les données des écrans**

```tsx
import React, { useRef, useState, useEffect } from 'react';
import { View, Text, Pressable, Animated, PanResponder, Dimensions, Image, AccessibilityInfo } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Fonts } from '../../lib/theme';
import { useGuideTheme, RUBRIC } from '../../lib/guideTheme';
import { ILLUST, IllustKey } from './illustrations';
import { Icon } from '../community/icons';
import { registerForPushAsync } from '../../hooks/usePushNotifications';
import { usePlayer } from '../../hooks/usePlayer';

const { width: W } = Dimensions.get('window');

type Slide =
  | { kind: 'hero' }
  | { kind: 'final' }
  | { kind: 'feature'; rubric: keyof typeof RUBRIC; illust: IllustKey; tag: string; title: string; body: string };

const SLIDES: Slide[] = [
  { kind: 'hero' },
  { kind: 'feature', rubric: 'lobby',     illust: 'lobby',     tag: 'Le Lobby',            title: 'Trouve ta partie\nen quelques secondes', body: 'Rejoins une partie ouverte à ton niveau ou crée la tienne. Les parties 🆘 urgentes cherchent un 4ᵉ joueur, vite.' },
  { kind: 'feature', rubric: 'recherche', illust: 'recherche', tag: 'Recherche',           title: 'Trouve les\nbons joueurs',              body: 'Cherche un partenaire à ton niveau, ou laisse les suggestions te proposer qui défier. Niveau, forme, fiabilité : tout est là.' },
  { kind: 'feature', rubric: 'defis',     illust: 'defis',     tag: 'Les Défis',           title: 'Lance un défi\nà n’importe qui',        body: 'Provoque un joueur depuis son profil ou via nos suggestions. Il accepte, vous jouez, l’ELO décide.' },
  { kind: 'feature', rubric: 'ranking',   illust: 'ranking',   tag: 'Classement & Ligues', title: 'Grimpe\nles ligues',                    body: 'Chaque match validé fait bouger ton niveau. Découverte → Bronze → Argent → Or → Diamant. Bats plus fort, gagne plus.' },
  { kind: 'feature', rubric: 'badges',    illust: 'badges',    tag: 'Chats & Palmarès',    title: 'Joue, échange,\ngagne des badges',     body: 'Un chat dédié par partie pour tout caler. Après le match, tes adversaires votent tes trophées 👑.' },
  { kind: 'feature', rubric: 'stories',   illust: 'stories',   tag: 'Stories & Partage',   title: 'Partage tes\nexploits',                 body: 'Transforme une victoire en story 9:16 prête à poster. Le QR « Rejoins-moi » intégré fait grandir ta communauté.' },
  { kind: 'final' },
];
```

- [ ] **Step 2: Sous-composant `Reveal` (entrée animée, respecte reduce-motion)**

```tsx
function Reveal({ active, delay = 0, children, reduceMotion }:
  { active: boolean; delay?: number; children: React.ReactNode; reduceMotion: boolean }) {
  const v = useRef(new Animated.Value(active && !reduceMotion ? 0 : 1)).current;
  useEffect(() => {
    if (reduceMotion) { v.setValue(1); return; }
    if (active) {
      v.setValue(0);
      Animated.timing(v, { toValue: 1, duration: 500, delay, useNativeDriver: true }).start();
    } else {
      v.setValue(0);
    }
  }, [active, reduceMotion]);
  return (
    <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}
```

- [ ] **Step 3: Le composant `Onboarding` (chrome + pager + CTA)**

```tsx
export default function Onboarding({ onDone }: { onDone: () => void }) {
  const T = useGuideTheme();
  const insets = useSafeAreaInsets();
  const { player } = usePlayer();
  const [i, setI] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const tx = useRef(new Animated.Value(0)).current;
  const N = SLIDES.length;
  const last = i === N - 1;

  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion); }, []);

  const goTo = (n: number) => {
    const clamped = Math.max(0, Math.min(N - 1, n));
    setI(clamped);
    if (reduceMotion) { tx.setValue(-clamped * W); return; }
    Animated.timing(tx, { toValue: -clamped * W, duration: 450, useNativeDriver: true }).start();
  };

  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dy) < 60,
    onPanResponderRelease: (_, g) => {
      if (g.dx < -52) goTo(i + 1);
      else if (g.dx > 52) goTo(i - 1);
    },
  })).current;

  const finishWithPush = async () => {
    if (player) await registerForPushAsync(player.id);
    onDone();
  };

  return (
    <View style={{ flex: 1, backgroundColor: T.mode === 'dark' ? T.bg : '#FAF5E8' }}>
      {/* top chrome */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: insets.top + 8, paddingHorizontal: 22, paddingBottom: 6 }}>
        <View style={{ width: 60 }}>
          {i > 0 && (
            <Pressable onPress={() => goTo(i - 1)} hitSlop={8}>
              <Icon name="chevronLeft" size={22} color={T.sub} stroke={2.4} />
            </Pressable>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {SLIDES.map((_, k) => (
            <View key={k} style={{ height: 6, borderRadius: 999, width: k === i ? 22 : 6,
              backgroundColor: k === i ? RUBRIC.welcome.accent : 'rgba(125,125,135,0.35)' }} />
          ))}
        </View>
        <View style={{ width: 60, alignItems: 'flex-end' }}>
          {!last && (
            <Pressable onPress={onDone} hitSlop={8}>
              <Text style={{ fontFamily: Fonts.uiBold, fontSize: 13.5, color: T.muted }}>Passer</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* pager */}
      <View style={{ flex: 1, overflow: 'hidden' }} {...pan.panHandlers}>
        <Animated.View style={{ flexDirection: 'row', width: W * N, flex: 1, transform: [{ translateX: tx }] }}>
          {SLIDES.map((s, k) => (
            <View key={k} style={{ width: W }}>
              {s.kind === 'hero' ? <HeroSlide T={T} active={k === i} reduceMotion={reduceMotion} />
                : s.kind === 'final' ? <FinalSlide T={T} active={k === i} reduceMotion={reduceMotion} />
                : <FeatureSlide T={T} slide={s} active={k === i} reduceMotion={reduceMotion} />}
            </View>
          ))}
        </Animated.View>
      </View>

      {/* bottom CTA */}
      <View style={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 24, paddingTop: 6 }}>
        {last ? (
          <>
            <Pressable onPress={finishWithPush} style={{ height: 54, borderRadius: 999, backgroundColor: T.ctaBg,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Icon name="bellRing" size={18} color={T.ctaFg} />
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 15.5, color: T.ctaFg }}>Activer & jouer</Text>
            </Pressable>
            <Pressable onPress={onDone} style={{ alignItems: 'center', paddingVertical: 10, marginTop: 4 }}>
              <Text style={{ fontFamily: Fonts.uiBold, fontSize: 13.5, color: T.muted }}>Plus tard</Text>
            </Pressable>
          </>
        ) : (
          <Pressable onPress={() => goTo(i + 1)} style={{ height: 54, borderRadius: 999, backgroundColor: T.ctaBg,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 15.5, color: T.ctaFg }}>{i === 0 ? 'Découvrir' : 'Continuer'}</Text>
            <Icon name="arrowRight" size={18} color={T.ctaFg} stroke={2.2} />
          </Pressable>
        )}
      </View>
    </View>
  );
}
```

- [ ] **Step 4: Les 3 sous-composants d'écran**

```tsx
function HeroSlide({ T, active, reduceMotion }: { T: ReturnType<typeof useGuideTheme>; active: boolean; reduceMotion: boolean }) {
  const dark = T.mode === 'dark';
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 }}>
      <Reveal active={active} delay={60} reduceMotion={reduceMotion}>
        <View style={{ width: 188, height: 132, marginBottom: 22 }}>
          <Image source={require('../../assets/auth/splash-trails.png')}
            style={{ position: 'absolute', left: '10%', top: '20%', width: 75, height: 75, resizeMode: 'contain' }} />
          <Image source={require('../../assets/auth/splash-racket.png')}
            style={{ position: 'absolute', left: '44%', top: 0, width: 86, height: 86, resizeMode: 'contain' }} />
        </View>
      </Reveal>
      <Reveal active={active} delay={180} reduceMotion={reduceMotion}>
        <Image source={dark ? require('../../assets/auth/splash-wordmark.png') : require('../../assets/auth/splash-wordmark-dark.png')}
          style={{ width: 188, height: 40, resizeMode: 'contain', marginBottom: 22 }} />
      </Reveal>
      <Reveal active={active} delay={300} reduceMotion={reduceMotion}>
        <Text style={{ fontFamily: Fonts.welcome, fontSize: 30, lineHeight: 31, textTransform: 'uppercase',
          textAlign: 'center', color: T.text, marginBottom: 16 }}>
          Ton terrain de jeu pour <Text style={{ color: dark ? '#FFC11A' : '#E8A906' }}>défier la ville</Text>
        </Text>
      </Reveal>
      <Reveal active={active} delay={420} reduceMotion={reduceMotion}>
        <Text style={{ fontFamily: Fonts.ui, fontSize: 15, lineHeight: 22, color: T.sub, textAlign: 'center', maxWidth: 300 }}>
          Trouve des partenaires, lance des défis, grimpe le classement ELO. Le padel, version compétition entre potes.
        </Text>
      </Reveal>
    </View>
  );
}

function FeatureSlide({ T, slide, active, reduceMotion }:
  { T: ReturnType<typeof useGuideTheme>; slide: Extract<Slide, { kind: 'feature' }>; active: boolean; reduceMotion: boolean }) {
  const r = RUBRIC[slide.rubric];
  const Illust = ILLUST[slide.illust];
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {/* halo */}
        <View style={{ position: 'absolute', width: 280, height: 280, borderRadius: 999, backgroundColor: r.soft }} />
        <Reveal active={active} delay={120} reduceMotion={reduceMotion}><Illust /></Reveal>
      </View>
      <View style={{ paddingHorizontal: 32, paddingBottom: 4 }}>
        <Reveal active={active} delay={260} reduceMotion={reduceMotion}>
          <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6,
            backgroundColor: r.soft, borderWidth: 1, borderColor: `${r.accent}40`, borderRadius: 999,
            paddingHorizontal: 12, paddingVertical: 5, marginBottom: 14 }}>
            <Text style={{ fontSize: 13 }}>{r.emoji}</Text>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: r.accent }}>{slide.tag}</Text>
          </View>
        </Reveal>
        <Reveal active={active} delay={340} reduceMotion={reduceMotion}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 27, lineHeight: 29, letterSpacing: -0.6, color: T.text, marginBottom: 12 }}>{slide.title}</Text>
        </Reveal>
        <Reveal active={active} delay={420} reduceMotion={reduceMotion}>
          <Text style={{ fontFamily: Fonts.ui, fontSize: 14.5, lineHeight: 22, color: T.sub }}>{slide.body}</Text>
        </Reveal>
      </View>
    </View>
  );
}

function FinalSlide({ T, active, reduceMotion }: { T: ReturnType<typeof useGuideTheme>; active: boolean; reduceMotion: boolean }) {
  const dark = T.mode === 'dark';
  const IllustNotifCmp = ILLUST.notif;
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', width: 300, height: 300, borderRadius: 999, backgroundColor: 'rgba(255,193,26,0.18)' }} />
        <Reveal active={active} delay={120} reduceMotion={reduceMotion}><IllustNotifCmp /></Reveal>
      </View>
      <View style={{ paddingHorizontal: 30, paddingBottom: 4 }}>
        <Reveal active={active} delay={240} reduceMotion={reduceMotion}>
          <View style={{ alignItems: 'center', marginBottom: 14 }}>
            <View style={{ width: 58, height: 58, borderRadius: 18, backgroundColor: dark ? '#1A1A1E' : '#fff',
              borderWidth: 1, borderColor: T.border, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="bellRing" size={26} color={dark ? '#FFC11A' : '#E8A906'} />
            </View>
          </View>
        </Reveal>
        <Reveal active={active} delay={320} reduceMotion={reduceMotion}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 27, lineHeight: 29, letterSpacing: -0.6, color: T.text, textAlign: 'center', marginBottom: 10 }}>Prêt à jouer ?</Text>
        </Reveal>
        <Reveal active={active} delay={400} reduceMotion={reduceMotion}>
          <Text style={{ fontFamily: Fonts.ui, fontSize: 14.5, lineHeight: 22, color: T.sub, textAlign: 'center', maxWidth: 300, alignSelf: 'center' }}>
            Active les notifications pour ne rater aucun défi, message ou validation de score.
          </Text>
        </Reveal>
      </View>
    </View>
  );
}
```

- [ ] **Step 5: Typecheck** — `cd react-matchup && npx tsc --noEmit` → aucune erreur. Vérifier le chemin du hook `usePlayer` (`hooks/usePlayer` — confirmé importé ainsi dans `usePushNotifications.ts`).
- [ ] **Step 6: Commit** — `git add components/guide/Onboarding.tsx && git commit -m "feat(guide): composant Onboarding (carrousel 8 écrans, clair/sombre, push)"`

---

## Task 14: Brancher la coquille `OnboardingCarousel`

**Files:**
- Modify: `components/OnboardingCarousel.tsx`

- [ ] **Step 1: Réécrire la coquille**

```tsx
import Onboarding from './guide/Onboarding';

// Coquille de compatibilité — signature inchangée pour app/(tabs)/_layout.tsx.
// Le montage/persistance (GUIDE_KEY) reste géré par le layout via `hasSeenOnboarding`.
export default function OnboardingCarousel({ onDone }: { onDone: () => void }) {
  return <Onboarding onDone={onDone} />;
}
```

> Le fond plein écran est désormais géré par `Onboarding` lui-même (crème en clair, `bg` en sombre). On retire l'ancien `View`/`StyleSheet`/`GuideDeck`.

- [ ] **Step 2: Vérifier que rien d'autre ne casse**

`GUIDE_KEY` est exporté par `guideDeck.tsx` (intact) et importé par le layout — non impacté. `HelpCenter.tsx` continue d'utiliser `guideDeck` (Phase 2). Typecheck : `cd react-matchup && npx tsc --noEmit`.

- [ ] **Step 3: Vérification manuelle complète (Expo)**

`npx expo start`. Effacer le flag pour rejouer l'onboarding :
```js
// dans un écran scratch ou via le debugger
import AsyncStorage from '@react-native-async-storage/async-storage';
AsyncStorage.removeItem('matchup_guide_rn_v1');
```
Vérifier sur appareil/simulateur :
- [ ] Les 8 écrans s'affichent dans l'ordre, textes corrects.
- [ ] Swipe gauche/droite (seuil), chevron retour, dots, « Passer ».
- [ ] Bascule **clair → sombre** (réglages OS) : surfaces, CTA (noir↔jaune), textes lisibles ; mockups restent clairs.
- [ ] Animations d'entrée fluides ; avec « réduire les animations » activé → contenu visible sans anim.
- [ ] Écran final : « Activer & jouer » déclenche l'invite push (build natif) ; « Plus tard » ferme sans demander ; les deux terminent l'onboarding (non réaffiché au relancement).

- [ ] **Step 4: Commit** — `git add components/OnboardingCarousel.tsx && git commit -m "feat(guide): brancher la coquille OnboardingCarousel sur le nouveau composant"`

---

## Self-Review (effectuée)

**Couverture spec ✓**
- Dark mode `useColorScheme` → Task 1 + consommé partout. ✓
- 8 écrans (welcome, lobby, recherche, defis, ranking, social/badges, stories, final) → Task 13 `SLIDES`. ✓
- 7 illustrations Phase 1 → Tasks 5–11 ; registre Task 12. ✓
- Push câblé (extraction + final CTA) → Tasks 3 + 13. ✓
- Coquille inchangée, GUIDE_KEY/layout intacts, HelpCenter Phase 2 → Task 14. ✓
- Icônes Lucide étendues → Task 2. ✓
- Swipe/anims/reduce-motion → Task 13. ✓

**Cohérence des types ✓** — `useGuideTheme()`/`GuideTheme`, `RUBRIC`/`Rubric`, `ILLUST`/`IllustKey`, `registerForPushAsync(playerId)` cohérents entre Tasks 1, 3, 12, 13.

**Placeholders** — Tasks 7–11 décrivent le port depuis le source jsx **in-repo** (lignes exactes citées) avec données complètes et règles de conversion explicites (section dédiée) ; ce ne sont pas des « TODO » mais des specs de port vérifiables. Tasks critiques (thème, push, shells, Lobby, Notif, Onboarding) fournissent le code complet.
