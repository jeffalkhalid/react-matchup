# Navbar — onglets Activité & Alertes — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire remonter « Activité » (fil d'activité) et « Alertes » en onglets de premier niveau, navbar à 7 boutons symétrique avec Créer surélevé, sans changer le style existant.

**Architecture:** Changement **additif** sur `main`, sans branche ni commit. On extrait les corps réutilisables (`ActivityFeed`, `AlertsList`) des écrans `/community/*` existants — qui restent intacts pour le hub — et on crée deux écrans d'onglet minces qui les affichent sans bouton retour. La barre (`app/(tabs)/_layout.tsx`) gagne deux icônes au trait, deux `Tabs.Screen`, et un bouton Créer surélevé.

**Tech Stack:** React Native, expo-router (Tabs), react-native-svg, TypeScript.

**Vérification :** pas de tests unitaires de rendu dans ce projet → chaque tâche se vérifie par `npx tsc --noEmit` (zéro nouvelle erreur) puis, en fin de plan, un contrôle visuel Expo. **Aucun commit** (consigne utilisateur ; des changements non commités sont en cours, ne pas y toucher).

**Réversibilité :** purement additif. Annuler = supprimer `app/(tabs)/activite.tsx`, `app/(tabs)/alertes.tsx`, `components/community/ActivityFeed.tsx`, `components/community/AlertsList.tsx`, et restaurer `_layout.tsx`, `friends.tsx`, `alerts.tsx`.

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `components/community/ActivityFeed.tsx` | **Nouveau** — fil d'activité des amis (extrait de `friends.tsx`) |
| `components/community/AlertsList.tsx` | **Nouveau** — liste d'alertes + bouton « Créer une alerte » (extrait de `alerts.tsx`) |
| `app/(tabs)/activite.tsx` | **Nouveau** — onglet « Activité » (en-tête + `ActivityFeed`) |
| `app/(tabs)/alertes.tsx` | **Nouveau** — onglet « Alertes » (en-tête + `AlertsList`) |
| `app/community/friends.tsx` | Modifié — rend `ActivityFeed` au lieu du `ActivityBody` local |
| `app/community/alerts.tsx` | Modifié — rend `AlertsList`, ré-exporte `alertTitle`/`alertDetail` |
| `app/(tabs)/_layout.tsx` | Modifié — 2 icônes, FAB surélevé, 2 `Tabs.Screen` dans le bon ordre |

---

## Task 1 : Extraire `ActivityFeed`

**Files:**
- Create: `components/community/ActivityFeed.tsx`
- Modify: `app/community/friends.tsx`

- [ ] **Step 1 : Créer `components/community/ActivityFeed.tsx`**

C'est le `ActivityBody` + `EmptyState` actuels de `friends.tsx` (lignes 52-175), renommés et exportés. Chemins d'import adaptés (le fichier vit maintenant sous `components/community/`).

```tsx
import { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Colors, Fonts, LeagueGradients } from '../../lib/theme';
import { getFriends, getActivityFeed, toggleReaction } from '../../lib/community';
import { getHiddenPlayerIds, reportContent } from '../../lib/moderation';
import { Avatar } from './Avatar';
import { Chips } from './ui';
import { Icon } from './icons';
import { ActivityCard } from './ActivityCard';
import type { SocialPlayer, ActivityEvent } from '../../types';

export function ActivityFeed({ myId }: { myId: string }) {
  const router = useRouter();
  const [friends, setFriends] = useState<SocialPlayer[]>([]);
  const [feed, setFeed] = useState<ActivityEvent[]>([]);
  const [sel, setSel] = useState<string | null>(null);   // player_id filtré
  const [loading, setLoading] = useState(true);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([getFriends(myId), getActivityFeed(myId), getHiddenPlayerIds(myId)]).then(([fr, fd, hidden]) => {
      setFriends(fr); setFeed(fd); setHiddenIds(hidden); setLoading(false);
    });
  }, [myId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const reportActivity = (e: ActivityEvent) => {
    if (e.player_id === myId) return;
    Alert.alert('Cette activité', undefined, [
      {
        text: 'Signaler', style: 'destructive',
        onPress: async () => {
          try {
            await reportContent({ reporterId: myId, targetType: 'activity', targetId: e.id, reportedPlayerId: e.player_id });
            Alert.alert('Merci', 'Activité signalée à la modération.');
          } catch {
            Alert.alert('Erreur', "Le signalement n'a pas pu être envoyé.");
          }
        },
      },
      { text: 'Annuler', style: 'cancel' },
    ]);
  };

  const react = async (eventId: string) => {
    // Optimiste
    setFeed(prev => prev.map(e => {
      if (e.id !== eventId) return e;
      const fire = e.reactions?.['🔥'] ?? [];
      const has = fire.includes(myId);
      const next = has ? fire.filter(id => id !== myId) : [...fire, myId];
      const reactions = { ...e.reactions };
      if (next.length) reactions['🔥'] = next; else delete reactions['🔥'];
      return { ...e, reactions };
    }));
    const updated = await toggleReaction(eventId);
    if (updated) setFeed(prev => prev.map(e => e.id === eventId ? { ...e, reactions: updated } : e));
  };

  const selName = friends.find(f => f.id === sel)?.name;
  const visibleFeed = feed.filter(e => !hiddenIds.has(e.player_id));
  const shown = sel ? visibleFeed.filter(e => e.player_id === sel) : visibleFeed;

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 110 }}>
      {/* Bandeau d'amis — tap = FILTRE le fil (pas de navigation profil) */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 4 }}>
        {/* Tous */}
        <TouchableOpacity onPress={() => setSel(null)} activeOpacity={0.85} style={{ alignItems: 'center', gap: 6, width: 56 }}>
          <View style={{
            width: 52, height: 52, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
            backgroundColor: sel === null ? Colors.primary : Chips,
            borderWidth: sel === null ? 0 : 1.5, borderColor: Colors.border,
          }}>
            <Icon name="users" size={22} color={sel === null ? Colors.brand : Colors.textMuted} />
          </View>
          <Text style={{ fontFamily: sel === null ? Fonts.uiExtraBold : Fonts.uiSemi, fontSize: 10.5, color: sel === null ? Colors.textPrimary : Colors.textSecondary }}>Tous</Text>
        </TouchableOpacity>

        {friends.map(f => {
          const on = sel === f.id;
          return (
            <TouchableOpacity key={f.id} onPress={() => setSel(on ? null : f.id)} activeOpacity={0.85} style={{ alignItems: 'center', gap: 6, width: 56 }}>
              <View style={{ padding: on ? 3 : 2, borderRadius: 999, backgroundColor: on ? Colors.brand : (LeagueGradients[f.league] ?? LeagueGradients.gold)[1] }}>
                <View style={{ padding: on ? 2 : 0, borderRadius: 999, backgroundColor: on ? Colors.bg : 'transparent' }}>
                  <Avatar name={f.name} size={on ? 44 : 48} radius={999} league={f.league} />
                </View>
              </View>
              <Text numberOfLines={1} style={{ fontFamily: on ? Fonts.uiExtraBold : Fonts.uiSemi, fontSize: 10.5, color: on ? Colors.textPrimary : Colors.textSecondary, maxWidth: 56 }}>
                {f.name.split(' ')[0]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* En-tête de filtre */}
      {sel && selName ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14, color: Colors.textPrimary }}>Activité de {selName.split(' ')[0]}</Text>
          <TouchableOpacity onPress={() => setSel(null)} activeOpacity={0.85} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Chips, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Icon name="x" size={12} color={Colors.textSecondary} stroke={2.6} />
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: Colors.textSecondary }}>Tout voir</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Fil (filtré par l'ami sélectionné) */}
      <View style={{ gap: 14, marginTop: 14 }}>
        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
        ) : shown.length > 0 ? (
          shown.map(e => <ActivityCard key={e.id} e={e} myId={myId} onReact={() => react(e.id)} onPressActor={() => router.push(`/player/${e.player_id}` as any)} onPressPlayer={(id) => router.push(`/player/${id}` as any)} onPressComments={() => router.push(`/community/comments/${e.id}` as any)} onReport={e.player_id === myId ? undefined : () => reportActivity(e)} />)
        ) : (
          <EmptyState name={selName?.split(' ')[0]} />
        )}
      </View>
    </ScrollView>
  );
}

function EmptyState({ name }: { name?: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 40, gap: 12 }}>
      <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: Chips, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="clock" size={24} color={Colors.textMuted} />
      </View>
      <Text style={{ fontFamily: Fonts.uiBold, fontSize: 14, color: Colors.textPrimary }}>Pas d'activité récente</Text>
      <Text style={{ fontFamily: Fonts.ui, fontSize: 13, color: Colors.textSecondary, maxWidth: 240, textAlign: 'center' }}>
        {name ? `${name} n'a rien publié pour l'instant.` : 'Suis des amis pour voir leurs résultats apparaître ici.'}
      </Text>
    </View>
  );
}
```

- [ ] **Step 2 : Mettre à jour `app/community/friends.tsx`**

Remplacer **tout le bloc d'imports (lignes 1-15)** par celui-ci (on retire les imports qui ne servaient qu'à `ActivityBody`/`EmptyState`) :

```tsx
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { usePlayer } from '../../hooks/usePlayer';
import { Colors, Fonts } from '../../lib/theme';
import { getSuggestions, searchPlayers, setFollow } from '../../lib/community';
import { Card, Kicker, NavBar, BrandBtn, Chips, Divider, Cream, CreamBorder } from '../../components/community/ui';
import { Icon } from '../../components/community/icons';
import { PlayerRow } from '../../components/community/PlayerRow';
import { ActivityFeed } from '../../components/community/ActivityFeed';
import type { SocialPlayer } from '../../types';
```

Dans `FriendsScreen`, remplacer la ligne 45 :

```tsx
        ? <ActivityBody myId={player.id} />
```

par :

```tsx
        ? <ActivityFeed myId={player.id} />
```

Puis **supprimer** les définitions locales devenues mortes : la fonction `ActivityBody` (anciennes lignes 51-161) et la fonction `EmptyState` (anciennes lignes 163-175). Garder `SearchField`, `SearchBody`, `InviteBlock` tels quels.

- [ ] **Step 3 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune **nouvelle** erreur liée à `friends.tsx` ou `ActivityFeed.tsx` (notamment pas d'« unused import » ni de symbole `ActivityBody`/`EmptyState` introuvable).

---

## Task 2 : Extraire `AlertsList`

**Files:**
- Create: `components/community/AlertsList.tsx`
- Modify: `app/community/alerts.tsx`

- [ ] **Step 1 : Créer `components/community/AlertsList.tsx`**

On déplace le corps (état + liste + bouton « Créer une alerte ») et les helpers `alertTitle`/`alertDetail`/`SLOT_LABEL`/`fmt` ici. `Pill` est désormais importé via `../Pill`.

```tsx
import { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { usePlayer } from '../../hooks/usePlayer';
import { Colors, Fonts } from '../../lib/theme';
import { getAlerts, setAlertActive } from '../../lib/community';
import { Card, Toggle } from './ui';
import { Icon } from './icons';
import { Pill } from '../Pill';
import type { GameAlert } from '../../types';

const SLOT_LABEL: Record<string, string> = {
  morning: 'Matin', noon: 'Midi', afternoon: 'Après-midi', evening: 'Soir',
};

export function alertTitle(a: GameAlert): string {
  if (a.courts.length === 1) return a.courts[0];
  if (a.courts.length > 1) return `${a.courts.length} terrains`;
  return 'Toutes les pistes';
}

export function alertDetail(a: GameAlert): string {
  const days = a.days.length === 0 ? 'Tous les jours'
    : a.days.length === 7 ? 'Tous les jours'
    : a.days.join('·');
  const slots = a.slots.length === 0 ? 'Tout horaire'
    : a.slots.map(s => SLOT_LABEL[s] ?? s).join(' & ');
  const type = (a.formats ?? []).length === 1
    ? (a.formats[0] === 'friendly' ? 'Amical' : 'Compétitif')
    : null;
  const lvl = `Niv. ${fmt(a.lvl_min)}–${fmt(a.lvl_max)}`;
  return [days, slots, type, lvl].filter(Boolean).join(' · ');
}
const fmt = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(1);

export function AlertsList() {
  const router = useRouter();
  const { player } = usePlayer();
  const [alerts, setAlerts] = useState<GameAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    if (!player) return;
    setLoading(true);
    getAlerts(player.id).then(a => { setAlerts(a); setLoading(false); });
  }, [player]));

  const toggle = (a: GameAlert) => {
    setAlerts(prev => prev.map(x => x.id === a.id ? { ...x, active: !x.active } : x));
    setAlertActive(a.id, !a.active);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 110, gap: 12 }}>
      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <>
          {alerts.map(a => (
            <Card key={a.id} pad={16}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,193,26,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="bell" size={19} color={Colors.brandDeep} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14.5, color: Colors.textPrimary }}>{alertTitle(a)}</Text>
                  <Text style={{ fontFamily: Fonts.ui, fontSize: 12, color: Colors.textSecondary, marginTop: 2 }}>{alertDetail(a)}</Text>
                  {a.friend_ids.length > 0 ? (
                    <View style={{ marginTop: 8, flexDirection: 'row' }}>
                      <Pill variant="brand">{a.friend_ids.length} ami{a.friend_ids.length > 1 ? 's' : ''}</Pill>
                    </View>
                  ) : null}
                </View>
                <Toggle on={a.active} onPress={() => toggle(a)} />
              </View>
            </Card>
          ))}

          <TouchableOpacity onPress={() => router.push('/community/alert-new')} activeOpacity={0.85} style={{
            marginTop: 4, height: 56, borderRadius: 16, borderWidth: 2, borderStyle: 'dashed', borderColor: Colors.border,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <Icon name="plus" size={18} color={Colors.textPrimary} stroke={2.4} />
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14.5, color: Colors.textPrimary }}>Créer une alerte</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}
```

- [ ] **Step 2 : Réécrire `app/community/alerts.tsx`**

Remplacer **tout le fichier** par cette version mince (écran poussé du hub, garde le `NavBar` avec retour et ré-exporte les helpers pour ne casser aucun import existant) :

```tsx
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors } from '../../lib/theme';
import { NavBar } from '../../components/community/ui';
import { AlertsList } from '../../components/community/AlertsList';

// Ré-export pour compat : d'autres écrans peuvent importer ces helpers depuis ici.
export { alertTitle, alertDetail } from '../../components/community/AlertsList';

export default function AlertsListScreen() {
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <NavBar title="Mes alertes" onBack={() => router.back()} />
      <AlertsList />
    </View>
  );
}
```

- [ ] **Step 3 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune nouvelle erreur. En particulier, les imports éventuels de `alertTitle`/`alertDetail` depuis `app/community/alerts.tsx` continuent de résoudre (grâce au ré-export).

---

## Task 3 : Onglet « Activité »

**Files:**
- Create: `app/(tabs)/activite.tsx`

- [ ] **Step 1 : Créer `app/(tabs)/activite.tsx`**

En-tête simple sans bouton retour (onglet racine), même fond/bordure que les barres de titre de l'app, puis le fil.

```tsx
import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../hooks/usePlayer';
import { Colors, Fonts } from '../../lib/theme';
import { ActivityFeed } from '../../components/community/ActivityFeed';

export default function ActiviteTab() {
  const insets = useSafeAreaInsets();
  const { player } = usePlayer();
  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <View style={{
        paddingTop: insets.top + 8, paddingBottom: 10, paddingHorizontal: 16,
        backgroundColor: Colors.bgCard, borderBottomWidth: 1, borderBottomColor: Colors.border,
      }}>
        <Text style={{ fontFamily: Fonts.uiBold, fontSize: 18, color: Colors.textPrimary }}>Activité</Text>
      </View>
      {player ? <ActivityFeed myId={player.id} /> : null}
    </View>
  );
}
```

- [ ] **Step 2 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune nouvelle erreur.

---

## Task 4 : Onglet « Alertes »

**Files:**
- Create: `app/(tabs)/alertes.tsx`

- [ ] **Step 1 : Créer `app/(tabs)/alertes.tsx`**

```tsx
import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../lib/theme';
import { AlertsList } from '../../components/community/AlertsList';

export default function AlertesTab() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <View style={{
        paddingTop: insets.top + 8, paddingBottom: 10, paddingHorizontal: 16,
        backgroundColor: Colors.bgCard, borderBottomWidth: 1, borderBottomColor: Colors.border,
      }}>
        <Text style={{ fontFamily: Fonts.uiBold, fontSize: 18, color: Colors.textPrimary }}>Alertes</Text>
      </View>
      <AlertsList />
    </View>
  );
}
```

- [ ] **Step 2 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune nouvelle erreur.

---

## Task 5 : Câbler la navbar (icônes, FAB surélevé, ordre)

**Files:**
- Modify: `app/(tabs)/_layout.tsx`

- [ ] **Step 1 : Ajouter les deux icônes au trait**

Dans `app/(tabs)/_layout.tsx`, juste après le composant `IconMessage` (après la ligne 43), insérer :

```tsx
const IconActivity = ({ color, size = 22 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </Svg>
);

const IconBell = ({ color, size = 22 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <Path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </Svg>
);
```

(`Svg`, `Path`, `Polyline` sont déjà importés ligne 5 — rien à ajouter aux imports.)

- [ ] **Step 2 : Surélever le bouton Créer**

Remplacer le composant `CreateTabButton` (lignes 80-103) par :

```tsx
function CreateTabButton({ ...rest }: any) {
  const router = useRouter();
  return (
    <TouchableOpacity
      {...rest}
      onPress={() => router.push('/(tabs)/lobby?create=1' as any)}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 }}
      activeOpacity={0.85}
    >
      <View style={{
        width: 46, height: 46, borderRadius: 999,
        backgroundColor: Colors.primary,
        alignItems: 'center', justifyContent: 'center',
        borderWidth: 4, borderColor: '#fff',
        transform: [{ translateY: -18 }],
        shadowColor: Colors.primary, shadowOpacity: 0.35, shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 }, elevation: 8, zIndex: 10,
      }}>
        <IconPlus size={22} />
      </View>
      <Text style={{ marginTop: -14, color: Colors.textMuted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 }}>
        Créer
      </Text>
    </TouchableOpacity>
  );
}
```

- [ ] **Step 3 : Autoriser le débordement de la barre**

Dans `screenOptions.tabBarStyle` (objet commençant ligne 234), ajouter la propriété `overflow: 'visible'` (par ex. juste après `backgroundColor`) pour que le FAB surélevé ne soit pas rogné :

```tsx
        tabBarStyle: {
          backgroundColor: 'rgba(255,255,255,0.97)',
          overflow: 'visible',
          borderTopColor: Colors.borderLight,
```

- [ ] **Step 4 : Insérer les deux onglets dans le bon ordre**

L'ordre d'affichage suit l'ordre des `Tabs.Screen` visibles. Cible : `Accueil · Défi · Activité · Créer · Alertes · Chats · Profil`.

Insérer le bloc **Activité juste avant** `<Tabs.Screen name="lobby" …>` :

```tsx
      <Tabs.Screen
        name="activite"
        options={{
          title: 'Activité',
          tabBarIcon: ({ color }) => <IconActivity color={color} size={22} />,
        }}
      />
```

Insérer le bloc **Alertes juste après** le bloc `lobby` (donc avant `<Tabs.Screen name="chats" …>`) :

```tsx
      <Tabs.Screen
        name="alertes"
        options={{
          title: 'Alertes',
          tabBarIcon: ({ color }) => <IconBell color={color} size={22} />,
        }}
      />
```

Ne pas toucher aux blocs `chats` et `profile` (ils restent dans cet ordre, à la fin) ni aux écrans cachés (`href: null`).

- [ ] **Step 5 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune nouvelle erreur.

---

## Task 6 : Vérification visuelle (Expo)

**Files:** aucun (contrôle manuel)

- [ ] **Step 1 : Lancer l'app**

Run: `npx expo start` (puis ouvrir sur un device/simulateur iOS **et** Android — la surélévation se comporte différemment selon `overflow`/`elevation`).

- [ ] **Step 2 : Checklist navbar**

  - [ ] 7 boutons dans l'ordre `Accueil · Défi · Activité · Créer · Alertes · Chats · Profil`.
  - [ ] Icônes Activité (pulse) et Alertes (cloche) au même trait gris que les autres ; passent en `Colors.primary` quand l'onglet est actif ; **seul** Créer est coloré.
  - [ ] Le bouton Créer est visiblement surélevé et **non rogné** en haut (vérifier iOS et Android). Si rogné sur Android : réduire `translateY` à `-10` dans `CreateTabButton` (et ajuster `marginTop` du libellé à `-8`).
  - [ ] Badges intacts : Défi (défis reçus), Chats (non-lus), Profil (avatar).

- [ ] **Step 3 : Checklist navigation**

  - [ ] Onglet **Activité** → fil d'activité, sans bouton retour ; le bandeau d'amis filtre le fil ; réactions 🔥 et accès commentaires OK.
  - [ ] Onglet **Alertes** → liste d'alertes, sans bouton retour ; le toggle actif/inactif fonctionne ; « Créer une alerte » ouvre un écran **poussé avec retour**.
  - [ ] Bouton **Créer** → ouvre le lobby en mode création (inchangé).
  - [ ] **Hub Communauté** (Accueil → Communauté) inchangé : « Mes amis » (fil + recherche) et la liste d'alertes fonctionnent comme avant.

---

## Critères de réussite (rappel spec)

1. Navbar 7 boutons, ordre exact ci-dessus. ✔ Task 5
2. Créer surélevé non rogné (iOS + Android). ✔ Task 5 + Task 6
3. Activité = fil seul ; Alertes = liste ; sans retour. ✔ Tasks 1-4
4. Style indiscernable de l'actuel hors les 2 onglets. ✔ Tasks 3-5
5. Hub + écrans `/community/*` fonctionnels. ✔ Tasks 1-2 (additif)
6. `tsc` passe. ✔ Steps de vérif de chaque tâche
