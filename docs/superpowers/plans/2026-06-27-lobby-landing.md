# Ouvrir l'app sur le Lobby + cloche partout + état vide actif — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'app PAG MATCH ouvre sur le Lobby (exploration des parties), la cloche de notifications est visible sur les 5 onglets principaux, et l'état vide de l'Explorer propose un bouton de création de partie.

**Architecture :** 1 ligne de config expo-router pour l'écran initial ; extraction de la cloche en composant réutilisable + un cluster `HeaderActions` (cloche + avatar) posé sur les 5 onglets ; un CTA branché sur le wizard existant dans l'état vide de l'Explorer.

**Tech Stack :** React Native, Expo Router (`Tabs`), TypeScript, react-native-svg, hook partagé `useNotificationCount`.

**Spec :** [docs/superpowers/specs/2026-06-27-lobby-landing-design.md](../specs/2026-06-27-lobby-landing-design.md)

## Global Constraints

- **Pas de runner de tests applicatif** dans ce repo (aucun `*.test.*` hors `node_modules`, pas de script `test`/`typecheck`). La barrière de vérification de chaque tâche = `npx tsc --noEmit` vert + vérification manuelle Expo (device/emulateur). Ne PAS inventer de tests Jest.
- **Pas de commit automatique** : préférence projet = travail direct sur `main`, le commit est fait par l'utilisateur (sauf demande explicite). Les étapes « Commit » ci-dessous sont OPTIONNELLES — proposer, ne pas exécuter sans accord.
- **Source unique du compteur de notifs** : toujours lire le total via `useNotificationCount()` (champ `total`). Ne jamais recompter les notifications ailleurs.
- **Cloche → destination unique** : `router.push('/notifications')` depuis tous les onglets.
- Tous les headers d'onglet utilisent `Colors.heroBg` (sombre) → cloche `tint="light"`, SAUF **Accueil** dont le coin haut-droit est sur fond clair (`#F8FAFC`) → `tint="dark"`.
- Ne pas refondre la navbar ; ne pas toucher la logique de comptage des notifs.

---

### Task 1: Ouvrir l'app sur le Lobby

**Files:**
- Modify: `app/(tabs)/_layout.tsx` (haut du module, après les imports)

**Interfaces:**
- Consumes: rien.
- Produces: l'écran initial du groupe `(tabs)` devient `lobby`.

- [ ] **Step 1: Ajouter `unstable_settings`**

Dans [app/(tabs)/_layout.tsx](../../../app/(tabs)/_layout.tsx), juste après le bloc d'imports (avant `const IconHome = …`), ajouter :

```ts
// Écran d'ouverture de l'app : le Lobby (exploration des parties), pas Accueil.
// API native expo-router (le préfixe `unstable_` est hérité de Next.js, l'option est stable).
export const unstable_settings = {
  initialRouteName: 'lobby',
};
```

- [ ] **Step 2: Typecheck**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Vérif device**

Lancer Expo, ouvrir l'app à froid avec un compte **connecté** → on arrive sur le **Lobby**, onglet **Explorer** (pas sur Accueil). L'onglet Accueil reste présent et accessible dans la navbar. Se déconnecter / relancer **déconnecté** → on arrive toujours sur l'écran de **login** (la redirection auth du `_layout` racine n'est pas court-circuitée).

- [ ] **Step 4 (optionnel): Commit**

```bash
git add app/(tabs)/_layout.tsx
git commit -m "feat(nav): ouvrir l'app sur le Lobby"
```

---

### Task 2: Extraire la cloche en composant `NotificationBell`

Aujourd'hui la cloche (icône animée + anneau pulse + badge compteur) est définie en dur dans `index.tsx` (lignes ~47-164). On la sort en composant autonome paramétrable par `tint`, et on met à jour Accueil pour l'importer (comportement identique à ce stade).

**Files:**
- Create: `components/NotificationBell.tsx`
- Modify: `app/(tabs)/index.tsx` (supprimer la définition inline lignes ~47-164 + les constantes `BADGE_RED`/`HERO_GREEN` ; importer depuis le nouveau fichier ; passer `tint="light"` à l'usage in-hero)

**Interfaces:**
- Consumes: `Icon` depuis `components/community/icons`, `Colors` depuis `lib/theme`.
- Produces:
  ```ts
  export function NotificationBell(props: {
    count: number;
    onPress: () => void;
    tint?: 'light' | 'dark'; // défaut 'light'
  }): JSX.Element
  ```
  Le composant N'EST PAS positionné en absolu — c'est une pastille 40×40 que le parent place.

- [ ] **Step 1: Créer `components/NotificationBell.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import { TouchableOpacity, Text, View, Animated, Easing } from 'react-native';
import { Colors } from '../lib/theme';
import { Icon } from './community/icons';

const BADGE_RED = '#E5484D';
const OUTLINE_DARK = '#0E2A22'; // contour badge sur header sombre
const OUTLINE_LIGHT = '#FFFFFF'; // contour badge sur fond clair (Accueil)

// Cloche de notifications réutilisable. Pastille 40×40 NON positionnée (le parent,
// p.ex. HeaderActions, la place en absolu). Animation swing + anneau pulse repris
// de l'ancienne cloche d'Accueil. `tint` adapte les couleurs au fond.
export function NotificationBell({ count, onPress, tint = 'light' }: {
  count: number; onPress: () => void; tint?: 'light' | 'dark';
}) {
  const has = count > 0;
  const display = count > 9 ? '9+' : String(count);

  const iconColor = tint === 'light' ? '#fff' : Colors.textPrimary;
  const bgColor = tint === 'light' ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)';
  const outline = tint === 'light' ? OUTLINE_DARK : OUTLINE_LIGHT;

  // Bell swing — 2.6 s loop, ±12°, pivot top-center
  const swing = useRef(new Animated.Value(0)).current;
  // Pulse ring — 1.8 s loop, scale 0.85→1.6 + fade
  const ringScale = useRef(new Animated.Value(0.85)).current;
  const ringOpacity = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (!has) {
      swing.stopAnimation(); swing.setValue(0);
      ringScale.stopAnimation(); ringOpacity.stopAnimation();
      ringScale.setValue(0.85); ringOpacity.setValue(0.9);
      return;
    }
    const swingLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(swing, { toValue: -12, duration: 260, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(swing, { toValue: 12, duration: 260, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(swing, { toValue: -12, duration: 260, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(swing, { toValue: 12, duration: 260, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(swing, { toValue: -12, duration: 260, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(swing, { toValue: 12, duration: 260, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(swing, { toValue: 0, duration: 260, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.delay(780),
      ])
    );
    const pulseLoop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(ringScale, { toValue: 1.6, duration: 1440, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.delay(360),
        ]),
        Animated.sequence([
          Animated.timing(ringOpacity, { toValue: 0, duration: 1440, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.delay(360),
        ]),
      ])
    );
    swingLoop.start(); pulseLoop.start();
    return () => { swingLoop.stop(); pulseLoop.stop(); };
  }, [has]);

  const rotate = swing.interpolate({ inputRange: [-12, 12], outputRange: ['-12deg', '12deg'] });

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={{
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: bgColor,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Animated.View style={{ transform: [{ rotate }] }}>
        <Icon name="bell" size={20} color={iconColor} stroke={1.4} />
      </Animated.View>

      {has && (
        <>
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute', top: -2, right: -2,
              width: 22, height: 22, borderRadius: 11,
              borderWidth: 2, borderColor: BADGE_RED,
              transform: [{ scale: ringScale }],
              opacity: ringOpacity,
            }}
          />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute', top: -6, right: -8,
              borderRadius: 11, backgroundColor: outline, padding: 2,
            }}
          >
            <View style={{
              minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9,
              backgroundColor: BADGE_RED, alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ color: Colors.textOnDark, fontSize: 11, fontWeight: '700', letterSpacing: 0.2, lineHeight: 14 }}>
                {display}
              </Text>
            </View>
          </View>
        </>
      )}
    </TouchableOpacity>
  );
}
```

- [ ] **Step 2: Mettre à jour `app/(tabs)/index.tsx`**

1. Supprimer la définition locale `function NotificationBell(...) { … }` (lignes ~50-164) ET les constantes `BADGE_RED` / `HERO_GREEN` (lignes ~47-48).
2. Ajouter l'import en haut, près des autres imports de composants :
```tsx
import { NotificationBell } from '../../components/NotificationBell';
```
3. Dans `ProfileBanner`, l'appel reste identique mais on précise le tint (header hero sombre) :
```tsx
<NotificationBell count={notifCount} onPress={onBellPress} tint="light" />
```
4. Si l'import `Easing` (de `react-native`) devient inutilisé dans `index.tsx` après suppression de la cloche locale, le retirer pour garder le typecheck propre.

> À ce stade le comportement d'Accueil est INCHANGÉ (même cloche, même position in-hero). On a juste déplacé le code. Le repositionnement vers le coin haut-droit se fait en Task 5.

- [ ] **Step 3: Typecheck**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4: Vérif device**

Ouvrir Accueil → la cloche dans la bannière profil s'affiche, s'anime quand il y a des notifs, et ouvre `/notifications` au tap (comportement identique à avant).

- [ ] **Step 5 (optionnel): Commit**

```bash
git add components/NotificationBell.tsx app/(tabs)/index.tsx
git commit -m "refactor(notif): extraire NotificationBell en composant réutilisable"
```

---

### Task 3: Cluster `HeaderActions` (cloche + avatar)

**Files:**
- Create: `components/HeaderActions.tsx`

**Interfaces:**
- Consumes: `NotificationBell` (Task 2), `ProfileAvatarButton` (`components/ProfileAvatarButton`), `useNotificationCount` (`hooks/useNotificationCount`).
- Produces:
  ```ts
  export function HeaderActions(props: {
    top: number;
    right: number;
    tint?: 'light' | 'dark'; // défaut 'light'
  }): JSX.Element
  ```
  Rendu : `View` positionnée en absolu (`top`/`right`, `zIndex: 20`), en ligne `[cloche] [avatar]`. La cloche lit `total` depuis `useNotificationCount` et navigue vers `/notifications`.

- [ ] **Step 1: Créer `components/HeaderActions.tsx`**

```tsx
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { NotificationBell } from './NotificationBell';
import { ProfileAvatarButton } from './ProfileAvatarButton';
import { useNotificationCount } from '../hooks/useNotificationCount';

// Cluster du coin haut-droit des écrans principaux : cloche de notifs + avatar profil.
// Source UNIQUE de ce coin → un seul endroit à modifier pour les 5 onglets.
// Le total de notifs vient du hook partagé (même nombre que l'écran /notifications).
export function HeaderActions({ top, right, tint = 'light' }: {
  top: number; right: number; tint?: 'light' | 'dark';
}) {
  const router = useRouter();
  const { total } = useNotificationCount();
  return (
    <View style={{
      position: 'absolute', top, right, zIndex: 20,
      flexDirection: 'row', alignItems: 'center', gap: 10,
    }}>
      <NotificationBell count={total} tint={tint} onPress={() => router.push('/notifications' as any)} />
      <ProfileAvatarButton />
    </View>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: aucune erreur. (Le composant n'est pas encore utilisé — on vérifie juste qu'il compile.)

- [ ] **Step 3 (optionnel): Commit**

```bash
git add components/HeaderActions.tsx
git commit -m "feat(notif): cluster HeaderActions (cloche + avatar)"
```

---

### Task 4: Brancher `HeaderActions` sur Lobby, Activité, Défi, Chats

Remplacer le `ProfileAvatarButton` seul par le cluster `HeaderActions` (avatar **inclus**) sur les 4 onglets à header sombre. On conserve les coordonnées `top`/`right` existantes de chaque écran.

**Files:**
- Modify: `app/(tabs)/lobby.tsx:2630`
- Modify: `app/(tabs)/activite.tsx:152`
- Modify: `app/(tabs)/matchmaking.tsx:599`
- Modify: `app/(tabs)/chats.tsx:100`

**Interfaces:**
- Consumes: `HeaderActions` (Task 3).
- Produces: rien de nouveau pour les tâches suivantes.

- [ ] **Step 1: lobby.tsx**

Ajouter l'import (près de l'import existant de `ProfileAvatarButton`) :
```tsx
import { HeaderActions } from '../../components/HeaderActions';
```
Remplacer la ligne 2630 :
```tsx
<ProfileAvatarButton style={{ position: 'absolute', top: insets.top + 8, right: 16, zIndex: 20 }} />
```
par :
```tsx
<HeaderActions top={insets.top + 8} right={16} tint="light" />
```
Si `ProfileAvatarButton` n'est plus utilisé ailleurs dans le fichier, retirer son import.

- [ ] **Step 2: activite.tsx**

Ajouter l'import :
```tsx
import { HeaderActions } from '../../components/HeaderActions';
```
Remplacer la ligne 152 :
```tsx
<ProfileAvatarButton style={{ position: 'absolute', top: insets.top + 6, right: 14, zIndex: 20 }} />
```
par :
```tsx
<HeaderActions top={insets.top + 6} right={14} tint="light" />
```
Retirer l'import `ProfileAvatarButton` s'il devient inutilisé.

- [ ] **Step 3: matchmaking.tsx**

Ajouter l'import :
```tsx
import { HeaderActions } from '../../components/HeaderActions';
```
Remplacer la ligne 599 :
```tsx
<ProfileAvatarButton style={{ position: 'absolute', top: insets.top + 6, right: 14, zIndex: 20 }} />
```
par :
```tsx
<HeaderActions top={insets.top + 6} right={14} tint="light" />
```
Retirer l'import `ProfileAvatarButton` s'il devient inutilisé.

- [ ] **Step 4: chats.tsx**

Ajouter l'import :
```tsx
import { HeaderActions } from '../../components/HeaderActions';
```
Remplacer la ligne 100 :
```tsx
<ProfileAvatarButton style={{ position: 'absolute', top: 50, right: 20, zIndex: 20 }} />
```
par :
```tsx
<HeaderActions top={50} right={20} tint="light" />
```
Retirer l'import `ProfileAvatarButton` s'il devient inutilisé.

- [ ] **Step 5: Typecheck**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Vérif device**

Sur **Lobby**, **Activité**, **Défi**, **Chats** : en haut à droite, la cloche (blanche, lisible sur le header sombre) apparaît à gauche de l'avatar. Badge compteur identique partout. Tap cloche → `/notifications`. Tap avatar → profil. L'alignement vertical avec le logo/header reste correct sur chaque écran.

- [ ] **Step 7 (optionnel): Commit**

```bash
git add app/(tabs)/lobby.tsx app/(tabs)/activite.tsx app/(tabs)/matchmaking.tsx app/(tabs)/chats.tsx
git commit -m "feat(notif): cloche sur Lobby/Activité/Défi/Chats via HeaderActions"
```

---

### Task 5: Accueil — cloche en haut à droite, retrait de la cloche in-hero

Sur Accueil, on aligne le pattern : la cloche passe dans le cluster `HeaderActions` (coin haut-droit, fond clair → `tint="dark"`) et on retire la cloche dupliquée de la bannière profil.

**Files:**
- Modify: `app/(tabs)/index.tsx` (ligne ~546 : le `ProfileAvatarButton` seul → `HeaderActions` ; `ProfileBanner` : retrait du `<NotificationBell>` et des props `notifCount`/`onBellPress` ; call-site de `ProfileBanner` : retrait de ces deux props)

**Interfaces:**
- Consumes: `HeaderActions` (Task 3).
- Produces: rien.

- [ ] **Step 1: Remplacer l'avatar seul par le cluster**

Ajouter l'import :
```tsx
import { HeaderActions } from '../../components/HeaderActions';
```
Remplacer (ligne ~546) :
```tsx
<ProfileAvatarButton style={{ position: 'absolute', top: insets.top + 6, right: 14, zIndex: 20 }} />
```
par :
```tsx
<HeaderActions top={insets.top + 6} right={14} tint="dark" />
```
Retirer l'import `ProfileAvatarButton` de `index.tsx` s'il devient inutilisé.

- [ ] **Step 2: Retirer la cloche in-hero de `ProfileBanner`**

Dans le composant `ProfileBanner` :
1. Supprimer la ligne `<NotificationBell count={notifCount} onPress={onBellPress} tint="light" />`.
2. Retirer `notifCount` et `onBellPress` de la signature de props (objet déstructuré ET du type inline).
3. Supprimer l'import `NotificationBell` de `index.tsx` s'il n'est plus utilisé.

- [ ] **Step 3: Nettoyer le call-site de `ProfileBanner`**

Au rendu de `<ProfileBanner … />` (lignes ~671-681), retirer les props devenues inexistantes :
```tsx
// SUPPRIMER ces deux lignes :
notifCount={totalNotifs}
onBellPress={() => router.push('/notifications' as any)}
```
La variable locale `totalNotifs` (= `notifTotal`) n'est alors plus utilisée que par… rien : si elle devient inutilisée, la supprimer. `useNotificationCount` reste importé/utilisé indirectement via `HeaderActions` (et le call `reloadNotifs` sur focus reste inchangé).

> La modale « distribue tes badges » N'EST PAS impactée : elle est déclenchée par le param `?openBadge=1` (venant de l'écran `/notifications`), pas par la cloche directement. Elle reste donc accessible.

- [ ] **Step 4: Typecheck**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: aucune erreur (notamment : aucune référence résiduelle à `notifCount`/`onBellPress`).

- [ ] **Step 5: Vérif device**

Sur **Accueil** : une **seule** cloche, en haut à droite à gauche de l'avatar, **lisible sur le fond clair** (icône sombre). Plus de cloche dans la bannière profil. Badge compteur correct. Tap → `/notifications`. Depuis une notif « badges à distribuer », la modale s'ouvre toujours (param `openBadge`).

- [ ] **Step 6 (optionnel): Commit**

```bash
git add app/(tabs)/index.tsx
git commit -m "feat(notif): Accueil — cloche en haut à droite, retrait du doublon in-hero"
```

---

### Task 6: CTA « Créer une partie » dans l'état vide de l'Explorer

**Files:**
- Modify: `app/(tabs)/lobby.tsx` (signature `ExploreTab` ~1399-1408 ; état vide ~1521 ; call-site `<ExploreTab … />` ~2721)

**Interfaces:**
- Consumes: l'état `setShowCreate` du composant parent de `lobby.tsx` (déjà utilisé pour ouvrir le `CreateWizard`, ligne ~1941).
- Produces: rien.

- [ ] **Step 1: Ajouter `onCreate` aux props de `ExploreTab`**

Dans la signature (ligne ~1399), ajouter `onCreate` à la déstructuration et au type :
```tsx
function ExploreTab({ games, myElo, filterMode, setFilterMode, typeFilter, setTypeFilter, search, setSearch, onOpenGame, playerId, onApply, onChangeSide, onCreatorChangeSide, onCreate }: {
  games: EnrichedGame[]; myElo: number;
  filterMode: FilterMode; setFilterMode: (v: FilterMode) => void;
  typeFilter: TypeFilter; setTypeFilter: (v: TypeFilter) => void;
  search: string; setSearch: (v: string) => void; onOpenGame: (g: EnrichedGame) => void;
  playerId: string;
  onApply: (gameId: string, side: string) => void;
  onChangeSide: (participantId: string, side: string) => void;
  onCreatorChangeSide: (gameId: string, side: string) => void;
  onCreate: () => void;
}) {
```

- [ ] **Step 2: Remplacer l'état vide « vrai vide » par une version avec CTA**

Remplacer (ligne ~1521) :
```tsx
: <EmptyState text="Aucune partie disponible" sub="Crée la tienne pour lancer le jeu" />)
```
par un bloc carte pointillée avec bouton (cohérent avec la carte « filtre actif » juste au-dessus) :
```tsx
: (
    <View style={{
      paddingVertical: 32, paddingHorizontal: 16, alignItems: 'center',
      backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
      borderStyle: 'dashed', borderRadius: 18,
    }}>
      <Text style={{ fontFamily: Fonts.uiBlack, color: Colors.textPrimary, fontSize: 14, textAlign: 'center' }}>
        Aucune partie pour l'instant
      </Text>
      <Text style={{ color: Colors.textMuted, fontWeight: '600', fontSize: 12, textAlign: 'center', marginTop: 4 }}>
        Sois le premier à lancer une partie aujourd'hui
      </Text>
      <TouchableOpacity onPress={onCreate} activeOpacity={0.85}
        style={{ marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11 }}>
        <Text style={{ color: Colors.textOnDark, fontFamily: Fonts.uiBlack, fontSize: 14 }}>＋ Créer une partie</Text>
      </TouchableOpacity>
    </View>
  ))
```

> `TouchableOpacity`, `View`, `Text`, `Colors`, `Fonts` sont déjà importés dans `lobby.tsx`. `EmptyState` reste utilisé ailleurs (onglets À venir / Historique) — ne pas le supprimer.

- [ ] **Step 3: Passer `onCreate` au call-site de `ExploreTab`**

Au rendu de `<ExploreTab … />` (lignes ~2721-2730), ajouter la prop :
```tsx
onCreate={() => setShowCreate(true)}
```

- [ ] **Step 4: Typecheck**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 5: Vérif device**

Avec un compte test SANS partie disponible et SANS filtre actif, l'onglet **Explorer** affiche la carte « Aucune partie pour l'instant » + bouton **＋ Créer une partie**. Tap → ouvre le `CreateWizard` (même wizard que le bouton central ⊕). Vérifier que l'état vide « filtre actif » (avec bouton « Réinitialiser les filtres ») n'a pas changé.

- [ ] **Step 6 (optionnel): Commit**

```bash
git add app/(tabs)/lobby.tsx
git commit -m "feat(lobby): CTA création dans l'état vide de l'Explorer"
```

---

## Vérification finale (tout le plan)

- [ ] `cd react-matchup && npx tsc --noEmit` → vert.
- [ ] Ouverture à froid (connecté) → Lobby / Explorer ; (déconnecté) → login.
- [ ] Cloche présente et cliquable sur les 5 onglets (Lobby, Accueil, Activité, Défi, Chats), lisible sur fond sombre (4 onglets) et clair (Accueil), badge identique partout, tap → `/notifications`.
- [ ] Accueil : une seule cloche (plus de doublon in-hero) ; modale « distribue tes badges » toujours atteignable.
- [ ] État vide Explorer : CTA « ＋ Créer une partie » ouvre le wizard.
