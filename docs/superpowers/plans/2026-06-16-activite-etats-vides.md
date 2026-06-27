# États vides (3 frames) — Implementation Plan (sous-projet C)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps en checkbox.

**Goal:** Trois états vides non-culpabilisants, branchés conditionnellement : (A) nouvel utilisateur 0 match, (B) fil calme (amis inactifs 7 j), (C) bilan mois calme (<3 matchs).

**Architecture:** Pas d'écran dédié. `lib/activityFeed.ts` expose `getMyMatchCount` + `deriveActivityState`. `app/(tabs)/activite.tsx` branche frames A/B. `app/bilan/[month].tsx` rend une slide unique si `recap.lowActivity`. Nouveaux composants dans `components/activity/` + `components/bilan/slides/`.

**Tech Stack:** Expo RN, TS strict, supabase, react-native-svg. Conventions identiques (vérif `tsc`, pas de tests, pas de commit, SQL N/A ici).

**Spec :** `docs/superpowers/specs/2026-06-16-activite-etats-vides-design.md`

## Structure des fichiers
| Fichier | Action |
|---|---|
| `lib/activityFeed.ts` | + `getMyMatchCount(uid)`, + `deriveActivityState(...)`, type `ActivityState` |
| `components/activity/EmptyHero.tsx` | Nouveau — hero paramétrable (onboarding / expand) |
| `components/activity/OnboardingChecklist.tsx` | Nouveau — checklist 3 étapes (frame A) |
| `components/activity/QuietFeedCard.tsx` | Nouveau — « Personne n'a joué » + Pinger (frame B) |
| `components/activity/DiscoveryRail.tsx` | Nouveau — « Joueurs autour de toi » (getSuggestions, frame B) |
| `components/community/ActivityFeed.tsx` | + prop `dimmed` sur `FriendsBar` (avatars opacity 0.4) |
| `app/(tabs)/activite.tsx` | Brancher frames A/B selon `deriveActivityState` |
| `components/bilan/slides/SlideLowActivity.tsx` | Nouveau — slide unique frame C |
| `app/bilan/[month].tsx` | Si `recap.lowActivity` → rendre `SlideLowActivity` (1 slide, pas 7) |

---

## Task 1: Détection d'état (`lib/activityFeed.ts`)

**Files:** Modify `lib/activityFeed.ts`

- [ ] **Step 1: Ajouter à la fin de `lib/activityFeed.ts`**

```ts
// ── État de l'écran Activité (états vides) ───────────────────
export type ActivityState = 'onboarding' | 'friends_inactive' | 'nominal';

// Nb total de matchs joués (tous slots). head:true → pas de payload.
export async function getMyMatchCount(uid: string): Promise<number> {
  try {
    const { count } = await supabase.from('matches')
      .select('id', { count: 'exact', head: true })
      .or(`winner_id.eq.${uid},loser_id.eq.${uid},winner_id_2.eq.${uid},loser_id_2.eq.${uid}`);
    return count ?? 0;
  } catch { return 0; }
}

// Détermine l'état d'affichage à partir de données déjà chargées.
//  - onboarding : aucun match joué.
//  - friends_inactive : a déjà joué, a ≥1 ami, mais 0 activité d'amis sur 7 j.
//  - nominal : sinon.
export function deriveActivityState(args: {
  totalMatches: number; friendsCount: number; recentFriendActivity: number;
}): ActivityState {
  if (args.totalMatches === 0) return 'onboarding';
  if (args.friendsCount >= 1 && args.recentFriendActivity === 0) return 'friends_inactive';
  return 'nominal';
}
```

- [ ] **Step 2:** `npx tsc --noEmit` → exit 0.

---

## Task 2: `EmptyHero` + `OnboardingChecklist`

**Files:** Create `components/activity/EmptyHero.tsx`, `components/activity/OnboardingChecklist.tsx`

- [ ] **Step 1: `EmptyHero.tsx`**

```tsx
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';

// Hero d'état vide — remplace JoinHeroCard. 1 SEUL CTA principal, jamais culpabilisant.
export function EmptyHero({ variant, subtitle, ctaLabel, onPress }: {
  variant: 'onboarding' | 'expand';
  subtitle: string;
  ctaLabel: string;
  onPress: () => void;
}) {
  const title = variant === 'onboarding' ? 'Crée ton 1ᵉʳ match' : 'Élargis ton cercle';
  const badge = variant === 'onboarding' ? 'BIENVENUE' : 'SEMAINE CALME';
  return (
    <View style={{ borderRadius: 18, padding: 16, marginTop: 14, backgroundColor: Colors.bgDark }}>
      <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 10, color: Colors.brand, letterSpacing: 0.5, marginBottom: 8 }}>{badge}</Text>
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 22, color: Colors.textOnDark, lineHeight: 26 }}>{title}</Text>
      <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>{subtitle}</Text>
      <TouchableOpacity onPress={onPress} activeOpacity={0.85}
        style={{ marginTop: 14, borderRadius: 999, paddingVertical: 12, alignItems: 'center', backgroundColor: Colors.brand }}>
        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 14, color: Colors.primary }}>{ctaLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}
```

- [ ] **Step 2: `OnboardingChecklist.tsx`**

```tsx
import { View, Text } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';

const STEPS: { label: string; hint?: string }[] = [
  { label: 'Créer ton 1ᵉʳ match', hint: '+50 pts' },
  { label: 'Inviter 3 amis' },
  { label: 'Évaluer ton niveau', hint: '5 questions' },
];

export function OnboardingChecklist() {
  return (
    <View style={{ backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, padding: 16, marginTop: 14, gap: 14 }}>
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 16, color: Colors.textPrimary }}>Tes premiers pas</Text>
      {STEPS.map((s, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 22, height: 22, borderRadius: 999, borderWidth: 2, borderColor: Colors.border }} />
          <Text style={{ flex: 1, fontFamily: Fonts.uiSemi, fontSize: 14, color: Colors.textPrimary }}>{s.label}</Text>
          {s.hint ? (
            <View style={{ backgroundColor: Colors.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
              <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 10, color: Colors.textSecondary }}>{s.hint}</Text>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}
```

- [ ] **Step 3:** `npx tsc --noEmit` → exit 0.

---

## Task 3: `QuietFeedCard` + `DiscoveryRail`

**Files:** Create `components/activity/QuietFeedCard.tsx`, `components/activity/DiscoveryRail.tsx`

- [ ] **Step 1: `QuietFeedCard.tsx`**

```tsx
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import type { SocialPlayer } from '../../types';

// Fil calme : aucun ami n'a joué cette semaine → propose de pinger 1-2 amis.
export function QuietFeedCard({ friends, onPing }: {
  friends: SocialPlayer[];
  onPing: (f: SocialPlayer) => void;
}) {
  const targets = friends.slice(0, 2);
  return (
    <View style={{ backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, padding: 16, marginTop: 14, gap: 12, alignItems: 'center' }}>
      <Text style={{ fontFamily: Fonts.uiBold, fontSize: 14, color: Colors.textPrimary }}>Personne n'a joué cette semaine</Text>
      <Text style={{ fontFamily: Fonts.ui, fontSize: 13, color: Colors.textSecondary, textAlign: 'center', maxWidth: 260 }}>
        Donne le coup d'envoi — propose une partie à un ami.
      </Text>
      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        {targets.map(f => (
          <TouchableOpacity key={f.id} onPress={() => onPing(f)} activeOpacity={0.85}
            style={{ borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: Colors.primary }}>
            <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 12, color: Colors.brand }}>Pinger {f.name.split(' ')[0]}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
```

- [ ] **Step 2: `DiscoveryRail.tsx`**

```tsx
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Avatar } from '../community/Avatar';
import type { SocialPlayer } from '../../types';

// « Joueurs autour de toi » — suggestions (amis d'amis / même club / niveau proche).
export function DiscoveryRail({ players, onPress }: {
  players: SocialPlayer[];
  onPress: (id: string) => void;
}) {
  if (players.length === 0) return null;
  return (
    <View style={{ marginTop: 18 }}>
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 16, color: Colors.textPrimary, marginBottom: 10 }}>Joueurs autour de toi</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 16 }}>
        {players.map(p => (
          <TouchableOpacity key={p.id} onPress={() => onPress(p.id)} activeOpacity={0.85}
            style={{ width: 140, borderRadius: 16, padding: 14, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', gap: 8 }}>
            <Avatar name={p.name} size={56} radius={999} league={p.league} />
            <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: Colors.textPrimary, maxWidth: 112 }}>{p.name.split(' ')[0]}</Text>
            <Text numberOfLines={2} style={{ fontFamily: Fonts.uiSemi, fontSize: 10.5, color: Colors.textSecondary, textAlign: 'center' }}>{p.reason ?? 'Niveau proche'}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}
```

- [ ] **Step 3:** `npx tsc --noEmit` → exit 0.

---

## Task 4: Prop `dimmed` sur `FriendsBar`

**Files:** Modify `components/community/ActivityFeed.tsx`

- [ ] **Step 1:** Étendre la signature de `FriendsBar` et appliquer l'opacité.

Remplacer la signature :
```tsx
export function FriendsBar({ friends, sel, onSelect }: {
  friends: SocialPlayer[]; sel: string | null; onSelect: (id: string | null) => void;
}) {
```
par :
```tsx
export function FriendsBar({ friends, sel, onSelect, dimmed = false }: {
  friends: SocialPlayer[]; sel: string | null; onSelect: (id: string | null) => void; dimmed?: boolean;
}) {
```

Puis, sur le `<ScrollView ...>` racine de `FriendsBar`, ajouter `style={{ opacity: dimmed ? 0.4 : 1 }}` :
```tsx
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ opacity: dimmed ? 0.4 : 1 }} contentContainerStyle={{ gap: 14, paddingBottom: 4 }}>
```

- [ ] **Step 2:** `npx tsc --noEmit` → exit 0. (Les appels existants sans `dimmed` restent valides.)

---

## Task 5: Brancher les frames A/B dans `app/(tabs)/activite.tsx`

**Files:** Modify `app/(tabs)/activite.tsx`

- [ ] **Step 1: Imports** — ajouter :
```tsx
import { getMyMatchCount, deriveActivityState, type ActivityState } from '../../lib/activityFeed';
import { getSuggestions } from '../../lib/community';
import { notifyPlayers } from '../../lib/notify';
import { EmptyHero } from '../../components/activity/EmptyHero';
import { OnboardingChecklist } from '../../components/activity/OnboardingChecklist';
import { QuietFeedCard } from '../../components/activity/QuietFeedCard';
import { DiscoveryRail } from '../../components/activity/DiscoveryRail';
import { Alert } from 'react-native'; // déjà importé — ne pas dupliquer
```
(NB : `Alert` est déjà importé ; n'ajouter que les lignes manquantes.)

- [ ] **Step 2: État + chargement** — ajouter aux `useState` :
```tsx
  const [totalMatches, setTotalMatches] = useState(0);
  const [suggestions, setSuggestions] = useState<SocialPlayer[]>([]);
```
et étendre le `Promise.all` de `load()` :
```tsx
    Promise.all([
      getFriends(myId), getActivityFeed(myId), getHiddenPlayerIds(myId),
      getWeekStats(myId), getSuggestedGame(myId), getWeekendGames(myId),
      getMyMatchCount(myId), player ? getSuggestions(player, 8) : Promise.resolve([]),
    ]).then(([fr, fd, hidden, w, h, we, mc, sugg]) => {
      setFriends(fr); setFeed(fd); setHiddenIds(hidden);
      setWeek(w); setHero(h); setWeekend(we);
      setTotalMatches(mc as number); setSuggestions(sugg as SocialPlayer[]); setLoading(false);
    });
```

- [ ] **Step 3: Dérivation d'état** — après le calcul de `moments`/`liveMoment`, ajouter :
```tsx
  const recentFriendActivity = visibleFeed.filter(
    e => Date.now() - new Date(e.created_at).getTime() <= 7 * 24 * 60 * 60 * 1000,
  ).length;
  const state: ActivityState = deriveActivityState({
    totalMatches, friendsCount: friends.length, recentFriendActivity,
  });

  const pingFriend = (f: SocialPlayer) => {
    if (!player) return;
    notifyPlayers({
      playerIds: [f.id],
      title: `${player.name} veut jouer 🎾`,
      body: 'Propose-lui une partie cette semaine !',
      data: { type: 'ping' },
    });
    Alert.alert('Envoyé', `${f.name.split(' ')[0]} a reçu ton ping.`);
  };
```

- [ ] **Step 4: Rendu conditionnel** — remplacer le bloc de sections (de `<WeekStatsCard .../>` jusqu'au bouton « Voir bilan complet » inclus) par :

```tsx
          {state === 'onboarding' ? (
            <>
              <EmptyHero variant="onboarding"
                subtitle="Lance ta première partie et commence à grimper."
                ctaLabel="Créer un match"
                onPress={() => router.push('/(tabs)/lobby?create=1' as any)} />
              <OnboardingChecklist />
              {hero ? <JoinHeroCard game={hero} /> : null}
              <View style={{ marginTop: 18, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#D4D4D8', borderRadius: 16, padding: 16, alignItems: 'center' }}>
                <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 13, color: Colors.textMuted, textAlign: 'center' }}>Ton fil se remplit après ton 1ᵉʳ match.</Text>
              </View>
            </>
          ) : state === 'friends_inactive' ? (
            <>
              <WeekStatsCard stats={week} />
              <EmptyHero variant="expand"
                subtitle={`${suggestions.length || 'Des'} joueurs de ton niveau jouent près de toi.`}
                ctaLabel="Découvrir des joueurs"
                onPress={() => router.push('/community/friends' as any)} />
              <FriendsBar friends={friends} sel={sel} onSelect={selectFriend} dimmed />
              <QuietFeedCard friends={friends} onPing={pingFriend} />
              <DiscoveryRail players={suggestions} onPress={(id) => router.push(`/player/${id}` as any)} />
            </>
          ) : (
            <>
              <WeekStatsCard stats={week} />
              {hero ? <JoinHeroCard game={hero} /> : null}
              <MomentsRail moments={moments} onShareMatch={() => setStoryPickerOpen(true)} onOpen={(e) => setOpenMomentId(e.id)} />
              <WeekendRail games={weekend} />

              <View style={{ height: 1, backgroundColor: Colors.border, marginVertical: 18 }} />
              <FriendsBar friends={friends} sel={sel} onSelect={selectFriend} />
              {sel && selName ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
                  <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14, color: Colors.textPrimary }}>Activité de {selName.split(' ')[0]}</Text>
                  <TouchableOpacity onPress={() => setSel(null)} activeOpacity={0.85} style={{ backgroundColor: Colors.bgCardAlt, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: Colors.border }}>
                    <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: Colors.textSecondary }}>Tout voir</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              <FeedList shown={shown} myId={myId} loading={loading} selName={selName} onReact={react} onReport={reportActivity} router={router} />

              <TouchableOpacity onPress={() => router.push('/bilan/last' as any)} activeOpacity={0.85}
                style={{ marginTop: 20, borderRadius: 14, paddingVertical: 13, alignItems: 'center', backgroundColor: Colors.primary }}>
                <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 13, color: Colors.brand }}>Voir bilan complet →</Text>
              </TouchableOpacity>
            </>
          )}
```

- [ ] **Step 5:** `npx tsc --noEmit` → exit 0.

- [ ] **Step 6: Vérif manuelle** — compte 0 match → frame A ; compte avec amis silencieux → frame B (avatars grisés, Pinger, découverte) ; sinon nominal inchangé.

---

## Task 6: Frame C — slide unique « mois calme » dans le Bilan

**Files:** Create `components/bilan/slides/SlideLowActivity.tsx`; Modify `app/bilan/[month].tsx`

- [ ] **Step 1: `SlideLowActivity.tsx`**

```tsx
import { View, Text, TouchableOpacity } from 'react-native';
import { Fonts } from '../../../lib/theme';
import type { MonthlyRecap } from '../../../lib/bilan';

// Frame C : mois calme (<3 matchs). 1 slide, ton non-culpabilisant, PAS de partage.
export function SlideLowActivity({ recap, onPrevMonth, onPing, onClose }: {
  recap: MonthlyRecap;
  onPrevMonth: () => void;
  onPing: () => void;
  onClose: () => void;
}) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 16 }}>
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 26, color: '#FFFFFF' }}>Mois en sommeil 🌱</Text>
      <View style={{ flexDirection: 'row', gap: 22, marginTop: 6 }}>
        <Stat n={recap.matches} l="matchs" />
        <Stat n={`${recap.winRate}%`} l="victoires" />
        <Stat n={`${recap.eloDelta >= 0 ? '+' : ''}${recap.eloDelta}`} l="ELO" dim />
      </View>
      <View style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16, padding: 16, marginTop: 6 }}>
        <Text style={{ fontFamily: Fonts.uiBold, fontSize: 14, color: '#FFFFFF' }}>🌱 Pas de quoi rougir</Text>
        <Text style={{ fontFamily: Fonts.ui, fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 6 }}>
          {recap.winRate >= 50 && recap.matches > 0
            ? `Tu as gagné ${recap.wins}/${recap.matches}. ${recap.winRate}% de réussite — la base est bonne.`
            : 'Une partie suffit à relancer la machine.'}
        </Text>
      </View>
      <TouchableOpacity onPress={onClose} activeOpacity={0.85}
        style={{ marginTop: 8, borderRadius: 999, paddingVertical: 13, alignItems: 'center', backgroundColor: '#FFC11A' }}>
        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 14, color: '#0A0A0A' }}>Recommencer {recap.label} sur les chapeaux →</Text>
      </TouchableOpacity>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <TouchableOpacity onPress={onPrevMonth} activeOpacity={0.85} style={{ flex: 1, borderRadius: 999, paddingVertical: 11, alignItems: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)' }}>
          <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 12, color: '#FFFFFF' }}>Voir le mois précédent</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onPing} activeOpacity={0.85} style={{ flex: 1, borderRadius: 999, paddingVertical: 11, alignItems: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)' }}>
          <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 12, color: '#FFFFFF' }}>Pinger un ami</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
function Stat({ n, l, dim }: { n: number | string; l: string; dim?: boolean }) {
  return (
    <View>
      <Text style={{ fontFamily: Fonts.display, fontSize: 30, color: dim ? 'rgba(255,255,255,0.55)' : '#FFFFFF' }}>{n}</Text>
      <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{l}</Text>
    </View>
  );
}
```

- [ ] **Step 2: Brancher dans `app/bilan/[month].tsx`** — import :
```tsx
import { SlideLowActivity } from '../../components/bilan/slides/SlideLowActivity';
```
Ajouter une fonction « mois précédent » dans le composant (après `onPickMonth`) :
```tsx
  const goPrevMonth = () => {
    const idx = months.findIndex(m => m.key === month);
    const prevM = months[idx + 1];
    if (prevM) onPickMonth(prevM.key);
  };
```
Puis, dans le rendu, juste après le `else if (!recap)` et **avant** le bloc `<View style={{ flex: 1 }}>` des 7 slides, intercaler la branche frame C. Remplacer :
```tsx
        ) : (
          <View style={{ flex: 1 }}>
            {slide === 0 && <SlideCover ... />}
```
par :
```tsx
        ) : recap.lowActivity ? (
          <SlideLowActivity
            recap={recap}
            onPrevMonth={goPrevMonth}
            onPing={() => router.push('/community/friends' as any)}
            onClose={() => router.back()}
          />
        ) : (
          <View style={{ flex: 1 }}>
            {slide === 0 && <SlideCover ... />}
```
(Le reste du bloc 7-slides est inchangé.) Pour la frame C, on n'affiche **pas** les progress bars 7-slides : entourer `<StoryProgress .../>` d'une condition `!recap?.lowActivity` (sinon laisser — 1 seule slide, barres non pertinentes). Recommandé : masquer.
Modifier :
```tsx
        <View style={{ paddingHorizontal: 12 }}>
          <StoryProgress count={SLIDE_COUNT} index={slide} />
        </View>
```
en :
```tsx
        {!recap?.lowActivity && (
          <View style={{ paddingHorizontal: 12 }}>
            <StoryProgress count={SLIDE_COUNT} index={slide} />
          </View>
        )}
```

- [ ] **Step 3:** `npx tsc --noEmit` → exit 0.

- [ ] **Step 4: Vérif manuelle** — Bilan d'un mois <3 matchs → 1 slide « Mois en sommeil », pas de barres 7-slides, pas de bouton Partager ; « mois précédent » recharge le mois d'avant.

---

## Self-Review (à compléter à l'exécution)
- Frame A (0 match) : EmptyHero onboarding + checklist + (hero éventuel) + footer dashed ; pas de Moments/Duo/Bilan. ✅ (T2/T5)
- Frame B (amis silencieux 7 j) : WeekStats + EmptyHero expand + FriendsBar dimmed + QuietFeedCard (Pinger) + DiscoveryRail. ✅ (T2/T3/T4/T5)
- Frame C (<3 matchs) : 1 slide non-culpabilisante, sans Partager, « mois précédent »/« Pinger ». ✅ (T6)
- 1 seul CTA principal par frame ; header premium conservé. ✅
- Types : `ActivityState` (T1) ; props composants cohérentes ; `dimmed` optionnel rétrocompatible (T4).

## Notes
- Aucune migration SQL. Aucun commit.
- « Pinger » = `notifyPlayers` (push direct). Pas de table dédiée (YAGNI).
- Pas de géoloc → le sous-titre frame B utilise le **nombre de suggestions**, pas une distance.
