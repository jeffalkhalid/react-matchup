# Bilan Mensuel (Wrapped) — Implementation Plan (sous-projet B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Écran plein écran « Spotify Wrapped du padel » : 7 slides 9:16 navigables (tap g/d, progress bars), sélecteur de mois, charts, partage en image locale.

**Architecture:** Route hors-tabs `app/bilan/[month].tsx`. Données : vue SQL `monthly_recap` (counts/winrate) + `lib/bilan.ts` qui assemble ΔELO/timeline (elo_history), top partenaire & best match (matches), badges (player_achievements). Slides isolés dans `components/bilan/`. Gradients & charts via `react-native-svg` (déjà présent) — pas de nouvelle dépendance native. Partage = `react-native-view-shot` + `expo-sharing` (déjà présents).

**Tech Stack:** Expo + React Native, TypeScript strict, `@supabase/supabase-js`, `react-native-svg`, `react-native-view-shot`, `expo-sharing`, `expo-media-library`, expo-router.

**Spec :** `docs/superpowers/specs/2026-06-16-activite-bilan-mensuel-design.md`

## Conventions (identiques au sous-projet A)
- Vérif = `npx tsc --noEmit` (exit 0). Baseline clean. PAS de tests (aucun framework).
- PAS de git/commit (l'utilisateur committe). PAS d'application SQL en prod (fichier .sql sur disque seulement).
- Dégradation propre : si la vue/les données manquent, l'écran affiche un état neutre, ne crash pas.

## Structure des fichiers
| Fichier | Responsabilité |
|---|---|
| `supabase/migrations/monthly_recap.sql` (créer) | Vue `monthly_recap` (matches/wins/losses/win_rate par mois) |
| `lib/bilan.ts` (créer) | Types `MonthlyRecap` + `getMonthlyRecap(uid)` (assemble tout) |
| `components/bilan/GradientBg.tsx` (créer) | Fond dégradé plein écran via react-native-svg |
| `components/bilan/BarChart6Months.tsx` (créer) | Bar chart SVG |
| `components/bilan/LineChartElo.tsx` (créer) | Line chart SVG |
| `components/bilan/MonthPicker.tsx` (créer) | Pills sélecteur de mois |
| `components/bilan/StoryProgress.tsx` (créer) | Barres de progression Stories |
| `components/bilan/slides/Slide*.tsx` (créer ×7) | Les 7 slides |
| `components/bilan/ShareCard.tsx` (créer) | Carte recap capturée pour partage |
| `app/bilan/[month].tsx` (créer) | Conteneur plein écran + navigation Stories |
| `app/_layout.tsx` (modifier) | Enregistrer la route `bilan/[month]` |
| `app/(tabs)/activite.tsx` (modifier) | Bouton « Voir bilan complet » → mois réel + tracking |

---

## Task 1: Vue SQL `monthly_recap`

**Files:** Create `supabase/migrations/monthly_recap.sql`

- [ ] **Step 1: Écrire la vue**

```sql
-- Bilan mensuel : agrégats par joueur et par mois, depuis `matches`.
-- Un joueur occupe l'un des 4 slots (winner/winner_2/loser/loser_2).
-- security_invoker = respecte la RLS de l'appelant sur matches/open_games.
create or replace view public.monthly_recap
with (security_invoker = on) as
with participation as (
  select
    m.id,
    p.player_id,
    p.won,
    date_trunc('month', coalesce(g.match_date, m.created_at))::date as month
  from public.matches m
  left join public.open_games g on g.id = m.game_id
  cross join lateral (values
    (m.winner_id, true), (m.winner_id_2, true),
    (m.loser_id, false), (m.loser_id_2, false)
  ) as p(player_id, won)
  where p.player_id is not null
)
select
  player_id as user_id,
  month,
  count(*)::int as matches,
  count(*) filter (where won)::int as wins,
  count(*) filter (where not won)::int as losses,
  coalesce(round(100.0 * count(*) filter (where won) / nullif(count(*), 0))::int, 0) as win_rate
from participation
group by player_id, month;

grant select on public.monthly_recap to authenticated;
```

- [ ] **Step 2:** Relecture syntaxique. NE PAS appliquer en prod (l'utilisateur le fera).

---

## Task 2: `lib/bilan.ts` — types + assemblage des données

**Files:** Create `lib/bilan.ts`

- [ ] **Step 1: Écrire le fichier**

```ts
// Données du Bilan Mensuel (Wrapped). Cœur depuis la vue monthly_recap ;
// compléments (ELO, partenaire, best match, badges) assemblés ici.
// Dégrade proprement : un mois sans données → recap vide.
import { supabase } from './supabase';
import { eloToLevel } from './theme';

export type RecapPartner = { userId: string; name: string; matchesTogether: number; winsTogether: number };
export type RecapBestMatch = {
  date: string; sets: [number, number][]; partnerName?: string;
  opponents: string[]; venue: string;
};
export type RecapBadge = { key: string; name: string };

export type MonthlyRecap = {
  month: string;        // "2026-06"
  label: string;        // "JUIN"
  matches: number; wins: number; losses: number; winRate: number;
  eloDelta: number;     // somme elo_change du mois (points ELO)
  fromLvl: number; toLvl: number;
  topPartner: RecapPartner | null;
  bestMatch: RecapBestMatch | null;
  badges: RecapBadge[];
  eloTimeline: { i: number; elo: number }[];
  barChart6: { label: string; matches: number }[];
  lowActivity: boolean; // < 3 matchs (frame C, sous-projet C)
};

const MONTHS_FR = ['JANV', 'FÉVR', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUIL', 'AOÛT', 'SEPT', 'OCT', 'NOV', 'DÉC'];
function monthKey(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function labelOf(key: string): string { const m = parseInt(key.slice(5, 7), 10) - 1; return MONTHS_FR[m] ?? key; }

type MatchRow = {
  id: string; created_at: string; score_text: string | null;
  winner_id: string | null; loser_id: string | null; winner_id_2: string | null; loser_id_2: string | null;
  winner: { name: string } | null; loser: { name: string } | null;
  winner_2: { name: string } | null; loser_2: { name: string } | null;
  game: { location: string | null; match_date: string | null } | null;
};

function parseSets(text: string | null): [number, number][] {
  if (!text) return [];
  return text.split(/[ ,]+/).map(s => s.split(/[-/]/).map(n => parseInt(n, 10)))
    .filter(p => p.length === 2 && !isNaN(p[0]) && !isNaN(p[1])) as [number, number][];
}

// Liste des mois disponibles (clé + label), du plus récent au plus ancien.
export async function getRecapMonths(uid: string): Promise<{ key: string; label: string }[]> {
  try {
    const { data } = await supabase.from('monthly_recap')
      .select('month').eq('user_id', uid).order('month', { ascending: false }).limit(12);
    return (data ?? []).map((r: any) => {
      const key = String(r.month).slice(0, 7);
      return { key, label: labelOf(key) };
    });
  } catch { return []; }
}

// Recap complet d'un mois ("YYYY-MM"). Renvoie null si aucune donnée.
export async function getMonthlyRecap(uid: string, month: string): Promise<MonthlyRecap | null> {
  try {
    const start = new Date(`${month}-01T00:00:00Z`);
    const end = new Date(start); end.setMonth(end.getMonth() + 1);
    const startISO = start.toISOString(), endISO = end.toISOString();

    // 1) Core depuis la vue (6 derniers mois pour le bar chart + le mois courant).
    const { data: recapRows } = await supabase.from('monthly_recap')
      .select('*').eq('user_id', uid).order('month', { ascending: false }).limit(12);
    const rows = (recapRows ?? []) as any[];
    const cur = rows.find(r => String(r.month).slice(0, 7) === month);

    // 2) Matches du mois (date via game.match_date sinon created_at).
    const { data: matchData } = await supabase.from('matches').select(`
      id, created_at, score_text, winner_id, loser_id, winner_id_2, loser_id_2,
      winner:winner_id(name), loser:loser_id(name), winner_2:winner_id_2(name), loser_2:loser_id_2(name),
      game:game_id(location, match_date)`)
      .or(`winner_id.eq.${uid},loser_id.eq.${uid},winner_id_2.eq.${uid},loser_id_2.eq.${uid}`)
      .order('created_at', { ascending: true });
    const allMine = (matchData ?? []) as unknown as MatchRow[];
    const monthMatches = allMine.filter(m => {
      const d = new Date(m.game?.match_date ?? m.created_at).toISOString();
      return d >= startISO && d < endISO;
    });

    const matches = cur?.matches ?? monthMatches.length;
    const wins = cur?.wins ?? monthMatches.filter(m => m.winner_id === uid || m.winner_id_2 === uid).length;
    const losses = cur?.losses ?? (monthMatches.length - wins);
    const winRate = cur?.win_rate ?? (matches ? Math.round((100 * wins) / matches) : 0);

    if (matches === 0) return null;

    // 3) ELO du mois (elo_history) → delta + timeline + niveaux from/to.
    const { data: eloRows } = await supabase.from('elo_history')
      .select('elo_score, elo_change, created_at')
      .eq('player_id', uid).gte('created_at', startISO).lt('created_at', endISO)
      .order('created_at', { ascending: true });
    const elo = (eloRows ?? []) as { elo_score: number; elo_change: number; created_at: string }[];
    const eloDelta = elo.reduce((s, h) => s + (h.elo_change ?? 0), 0);
    const eloTimeline = elo.map((h, i) => ({ i, elo: h.elo_score }));
    const fromLvl = elo.length ? eloToLevel(elo[0].elo_score - (elo[0].elo_change ?? 0)) : 0;
    const toLvl = elo.length ? eloToLevel(elo[elo.length - 1].elo_score) : fromLvl;

    // 4) Top partenaire (doubles) du mois.
    const partnerStat = new Map<string, { name: string; n: number; w: number }>();
    for (const m of monthMatches) {
      const iWon = m.winner_id === uid || m.winner_id_2 === uid;
      const partnerName = iWon
        ? (m.winner_id === uid ? m.winner_2?.name : m.winner?.name)
        : (m.loser_id === uid ? m.loser_2?.name : m.loser?.name);
      if (!partnerName) continue;
      const cur2 = partnerStat.get(partnerName) ?? { name: partnerName, n: 0, w: 0 };
      cur2.n += 1; if (iWon) cur2.w += 1; partnerStat.set(partnerName, cur2);
    }
    const bestPartner = [...partnerStat.values()].sort((a, b) => b.n - a.n)[0];
    const topPartner: RecapPartner | null = bestPartner
      ? { userId: '', name: bestPartner.name, matchesTogether: bestPartner.n, winsTogether: bestPartner.w }
      : null;

    // 5) Best match : la victoire avec le plus gros écart de jeux.
    const wonMatches = monthMatches.filter(m => m.winner_id === uid || m.winner_id_2 === uid);
    const scoreOf = (m: MatchRow) => parseSets(m.score_text).reduce((s, [a, b]) => s + (a - b), 0);
    const best = wonMatches.sort((a, b) => scoreOf(b) - scoreOf(a))[0];
    const bestMatch: RecapBestMatch | null = best ? {
      date: (best.game?.match_date ?? best.created_at).slice(0, 10),
      sets: parseSets(best.score_text),
      partnerName: best.winner_id === uid ? best.winner_2?.name ?? undefined : best.winner?.name ?? undefined,
      opponents: [best.loser?.name, best.loser_2?.name].filter(Boolean) as string[],
      venue: best.game?.location ?? 'Match',
    } : null;

    // 6) Badges débloqués (catalogue côté client, débloquage daté côté serveur).
    let badges: RecapBadge[] = [];
    try {
      const { data: ach } = await supabase.rpc('get_player_achievements', { p_id: uid });
      badges = ((ach ?? []) as any[])
        .filter(a => a.unlocked_at && String(a.unlocked_at) >= startISO && String(a.unlocked_at) < endISO)
        .map(a => ({ key: a.key, name: a.key }));
    } catch { badges = []; }

    // 7) Bar chart : 6 derniers mois (vue), ordre chronologique.
    const barChart6 = rows.slice(0, 6).reverse().map(r => {
      const key = String(r.month).slice(0, 7);
      return { label: labelOf(key).slice(0, 1), matches: r.matches ?? 0 };
    });

    return {
      month, label: labelOf(month), matches, wins, losses, winRate,
      eloDelta: Math.round(eloDelta), fromLvl, toLvl,
      topPartner, bestMatch, badges, eloTimeline, barChart6,
      lowActivity: matches < 3,
    };
  } catch {
    return null;
  }
}

// Résout le mois le plus récent disponible (pour /bilan/last et la notif).
export async function getLatestRecapMonth(uid: string): Promise<string | null> {
  const months = await getRecapMonths(uid);
  return months[0]?.key ?? null;
}
```

- [ ] **Step 2:** `npx tsc --noEmit` → exit 0.

---

## Task 3: `GradientBg` + enregistrement de la route

**Files:** Create `components/bilan/GradientBg.tsx`; Modify `app/_layout.tsx`

- [ ] **Step 1: `GradientBg`** (dégradé plein écran via react-native-svg, sans dépendance native)

```tsx
import { View } from 'react-native';
import Svg, { Rect, Defs, LinearGradient, Stop } from 'react-native-svg';

export function GradientBg({ from, to, angle = 160, children }: {
  from: string; to: string; angle?: number; children?: React.ReactNode;
}) {
  // angle approximé sur la diagonale (suffisant pour des fonds plein écran).
  const rad = (angle * Math.PI) / 180;
  const x2 = (Math.cos(rad) * 0.5 + 0.5).toFixed(3);
  const y2 = (Math.sin(rad) * 0.5 + 0.5).toFixed(3);
  return (
    <View style={{ flex: 1 }}>
      <Svg width="100%" height="100%" style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id="bg" x1="0" y1="0" x2={x2} y2={y2}>
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bg)" />
      </Svg>
      {children}
    </View>
  );
}
```

- [ ] **Step 2: Enregistrer la route** dans `app/_layout.tsx`, dans le bloc `<Stack.Protected guard={!!player}>`, après `score-entry` :

```tsx
        <Stack.Screen name="bilan/[month]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
```

- [ ] **Step 3:** `npx tsc --noEmit` → exit 0.

---

## Task 4: Charts SVG (`BarChart6Months`, `LineChartElo`)

**Files:** Create `components/bilan/BarChart6Months.tsx`, `components/bilan/LineChartElo.tsx`

- [ ] **Step 1: `BarChart6Months`**

```tsx
import { View, Text } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { Fonts } from '../../lib/theme';

export function BarChart6Months({ data, color = '#FFC11A', width = 280, height = 120 }: {
  data: { label: string; matches: number }[]; color?: string; width?: number; height?: number;
}) {
  if (data.length === 0) return null;
  const max = Math.max(1, ...data.map(d => d.matches));
  const gap = 10;
  const barW = (width - gap * (data.length - 1)) / data.length;
  return (
    <View style={{ width }}>
      <Svg width={width} height={height}>
        {data.map((d, i) => {
          const h = Math.round((d.matches / max) * (height - 20));
          const x = i * (barW + gap);
          return <Rect key={i} x={x} y={height - 20 - h} width={barW} height={h} rx={6} fill={color} opacity={0.5 + 0.5 * (d.matches / max)} />;
        })}
      </Svg>
      <View style={{ flexDirection: 'row', width, marginTop: 4 }}>
        {data.map((d, i) => (
          <Text key={i} style={{ width: barW, marginRight: i < data.length - 1 ? gap : 0, textAlign: 'center', fontFamily: Fonts.uiSemi, fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>{d.label}</Text>
        ))}
      </View>
    </View>
  );
}
```

- [ ] **Step 2: `LineChartElo`**

```tsx
import Svg, { Polyline, Circle } from 'react-native-svg';
import { Fonts } from '../../lib/theme';
import { View, Text } from 'react-native';

export function LineChartElo({ data, color = '#FFC11A', width = 280, height = 120 }: {
  data: { i: number; elo: number }[]; color?: string; width?: number; height?: number;
}) {
  if (data.length < 2) {
    return <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: Fonts.uiSemi, fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Pas assez de données</Text></View>;
  }
  const xs = data.map(d => d.i);
  const ys = data.map(d => d.elo);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 8;
  const sx = (x: number) => pad + ((x - minX) / Math.max(1, maxX - minX)) * (width - 2 * pad);
  const sy = (y: number) => height - pad - ((y - minY) / Math.max(1, maxY - minY)) * (height - 2 * pad);
  const points = data.map(d => `${sx(d.i).toFixed(1)},${sy(d.elo).toFixed(1)}`).join(' ');
  const last = data[data.length - 1];
  return (
    <Svg width={width} height={height}>
      <Polyline points={points} fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={sx(last.i)} cy={sy(last.elo)} r={5} fill={color} />
    </Svg>
  );
}
```

- [ ] **Step 3:** `npx tsc --noEmit` → exit 0.

---

## Task 5: `MonthPicker` + `StoryProgress`

**Files:** Create `components/bilan/MonthPicker.tsx`, `components/bilan/StoryProgress.tsx`

- [ ] **Step 1: `MonthPicker`** (pills, mois courant bloqué)

```tsx
import { ScrollView, TouchableOpacity, Text } from 'react-native';
import { Fonts } from '../../lib/theme';

export function MonthPicker({ months, current, onPick }: {
  months: { key: string; label: string }[]; current: string; onPick: (key: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 4 }}>
      {months.map(m => {
        const on = m.key === current;
        return (
          <TouchableOpacity key={m.key} onPress={() => onPick(m.key)} activeOpacity={0.85}
            style={{ borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: on ? 'rgba(10,10,10,0.85)' : 'rgba(255,255,255,0.25)' }}>
            <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 12, color: on ? '#FFC11A' : '#0A0A0A', letterSpacing: 0.5 }}>{m.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}
```

- [ ] **Step 2: `StoryProgress`** (barres haut d'écran)

```tsx
import { View } from 'react-native';

export function StoryProgress({ count, index }: { count: number; index: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4, paddingHorizontal: 4 }}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={{ flex: 1, height: 3, borderRadius: 999, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.25)' }}>
          <View style={{ height: 3, borderRadius: 999, backgroundColor: '#FFFFFF', width: i < index ? '100%' : i === index ? '50%' : '0%' }} />
        </View>
      ))}
    </View>
  );
}
```

- [ ] **Step 3:** `npx tsc --noEmit` → exit 0.

---

## Task 6: Slides 0–3 (Cover, Volume, Forme, ELO)

**Files:** Create `components/bilan/slides/SlideCover.tsx`, `SlideVolume.tsx`, `SlideForme.tsx`, `SlideElo.tsx`

> Toutes les slides reçoivent `{ recap: MonthlyRecap }` (+ extras pour la Cover). Conteneur centré, texte clair. Fond fourni par le parent via `GradientBg`/`backgroundColor` (voir Task 8).

- [ ] **Step 1: `SlideCover.tsx`**

```tsx
import { View, Text } from 'react-native';
import { Fonts } from '../../../lib/theme';
import { MonthPicker } from '../MonthPicker';
import type { MonthlyRecap } from '../../../lib/bilan';

export function SlideCover({ recap, months, onPickMonth }: {
  recap: MonthlyRecap; months: { key: string; label: string }[]; onPickMonth: (k: string) => void;
}) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 22 }}>
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 22, color: '#0A0A0A' }}>TON BILAN</Text>
      <Text style={{ fontFamily: Fonts.display, fontSize: 64, color: '#0A0A0A', lineHeight: 64 }}>{recap.label}</Text>
      <MonthPicker months={months} current={recap.month} onPick={onPickMonth} />
      <View style={{ flexDirection: 'row', gap: 22, marginTop: 10 }}>
        <Stat n={recap.matches} l="matchs" />
        <Stat n={`${recap.winRate}%`} l="victoires" />
        <Stat n={`${recap.eloDelta >= 0 ? '+' : ''}${recap.eloDelta}`} l="ELO" />
      </View>
      <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 13, color: 'rgba(10,10,10,0.6)' }}>Touche à droite pour dérouler →</Text>
    </View>
  );
}
function Stat({ n, l }: { n: number | string; l: string }) {
  return (
    <View>
      <Text style={{ fontFamily: Fonts.display, fontSize: 30, color: '#0A0A0A' }}>{n}</Text>
      <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: 'rgba(10,10,10,0.6)' }}>{l}</Text>
    </View>
  );
}
```

- [ ] **Step 2: `SlideVolume.tsx`**

```tsx
import { View, Text } from 'react-native';
import { Fonts } from '../../../lib/theme';
import { BarChart6Months } from '../BarChart6Months';
import type { MonthlyRecap } from '../../../lib/bilan';

export function SlideVolume({ recap }: { recap: MonthlyRecap }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 18 }}>
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 18, color: '#FFFFFF' }}>TU AS JOUÉ</Text>
      <Text style={{ fontFamily: Fonts.display, fontSize: 120, color: '#FFFFFF', lineHeight: 120 }}>{recap.matches}</Text>
      <Text style={{ fontFamily: Fonts.uiBold, fontSize: 16, color: 'rgba(255,255,255,0.85)' }}>matchs ce mois-ci</Text>
      <View style={{ marginTop: 12 }}>
        <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>6 derniers mois</Text>
        <BarChart6Months data={recap.barChart6} color="#FFFFFF" />
      </View>
    </View>
  );
}
```

- [ ] **Step 3: `SlideForme.tsx`**

```tsx
import { View, Text } from 'react-native';
import { Colors, Fonts } from '../../../lib/theme';
import type { MonthlyRecap } from '../../../lib/bilan';

export function SlideForme({ recap }: { recap: MonthlyRecap }) {
  const cells: ('W' | 'L')[] = [...Array(recap.wins).fill('W'), ...Array(recap.losses).fill('L')].slice(0, 24);
  return (
    <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 18 }}>
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 18, color: '#FFFFFF' }}>TA FORME</Text>
      <Text style={{ fontFamily: Fonts.display, fontSize: 96, color: '#FFFFFF', lineHeight: 96 }}>{recap.winRate}%</Text>
      <Text style={{ fontFamily: Fonts.uiBold, fontSize: 15, color: 'rgba(255,255,255,0.85)' }}>{recap.wins} victoires · {recap.losses} défaites</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {cells.map((c, i) => (
          <View key={i} style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: c === 'W' ? Colors.success : Colors.danger }} />
        ))}
      </View>
    </View>
  );
}
```

- [ ] **Step 4: `SlideElo.tsx`**

```tsx
import { View, Text } from 'react-native';
import { Fonts } from '../../../lib/theme';
import { LineChartElo } from '../LineChartElo';
import type { MonthlyRecap } from '../../../lib/bilan';

export function SlideElo({ recap }: { recap: MonthlyRecap }) {
  const up = recap.eloDelta >= 0;
  return (
    <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 18 }}>
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 18, color: '#FFFFFF' }}>TA PROGRESSION</Text>
      <Text style={{ fontFamily: Fonts.display, fontSize: 84, color: up ? '#10B981' : '#EF4444', lineHeight: 84 }}>{up ? '+' : ''}{recap.eloDelta}</Text>
      <Text style={{ fontFamily: Fonts.uiBold, fontSize: 15, color: 'rgba(255,255,255,0.85)' }}>points ELO · niveau {recap.fromLvl.toFixed(2)} → {recap.toLvl.toFixed(2)}</Text>
      <View style={{ marginTop: 12 }}>
        <LineChartElo data={recap.eloTimeline} />
      </View>
    </View>
  );
}
```

- [ ] **Step 5:** `npx tsc --noEmit` → exit 0.

---

## Task 7: Slides 4–6 (Duo, Best moment, Partage) + `ShareCard`

**Files:** Create `components/bilan/slides/SlideDuo.tsx`, `SlideBest.tsx`, `SlidePartage.tsx`, `components/bilan/ShareCard.tsx`

- [ ] **Step 1: `SlideDuo.tsx`**

```tsx
import { View, Text } from 'react-native';
import { Fonts } from '../../../lib/theme';
import { Avatar } from '../../community/Avatar';
import type { MonthlyRecap } from '../../../lib/bilan';

export function SlideDuo({ recap }: { recap: MonthlyRecap }) {
  const p = recap.topPartner;
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28, gap: 16 }}>
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 18, color: '#FFFFFF' }}>TON MEILLEUR DUO</Text>
      {p ? (
        <>
          <Avatar name={p.name} size={140} radius={999} mono="yellow" />
          <Text style={{ fontFamily: Fonts.display, fontSize: 30, color: '#FFFFFF' }}>{p.name}</Text>
          <Text style={{ fontFamily: Fonts.uiBold, fontSize: 15, color: 'rgba(255,255,255,0.85)' }}>{p.matchesTogether} matchs · {p.winsTogether} victoires ensemble</Text>
        </>
      ) : (
        <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 14, color: 'rgba(255,255,255,0.6)' }}>Pas encore de duo ce mois-ci.</Text>
      )}
    </View>
  );
}
```

- [ ] **Step 2: `SlideBest.tsx`**

```tsx
import { View, Text } from 'react-native';
import { Fonts } from '../../../lib/theme';
import type { MonthlyRecap } from '../../../lib/bilan';

export function SlideBest({ recap }: { recap: MonthlyRecap }) {
  const b = recap.bestMatch;
  return (
    <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 16 }}>
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 18, color: '#FFFFFF' }}>TON PLUS BEAU MATCH</Text>
      {b ? (
        <>
          <Text style={{ fontFamily: Fonts.display, fontSize: 48, color: '#FFFFFF' }}>
            {b.sets.map(([a, c]) => `${a}-${c}`).join('  ')}
          </Text>
          <Text style={{ fontFamily: Fonts.uiBold, fontSize: 15, color: 'rgba(255,255,255,0.85)' }}>
            {b.venue}{b.opponents.length ? ` · vs ${b.opponents.join(' & ')}` : ''}
          </Text>
          {recap.badges.length ? (
            <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 13, color: '#FFC11A', marginTop: 8 }}>
              🏅 {recap.badges.length} badge{recap.badges.length > 1 ? 's' : ''} débloqué{recap.badges.length > 1 ? 's' : ''}
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 14, color: 'rgba(255,255,255,0.6)' }}>Pas de match marquant ce mois-ci.</Text>
      )}
    </View>
  );
}
```

- [ ] **Step 3: `ShareCard.tsx`** (carte recap capturable, rendue par le parent hors-écran)

```tsx
import { forwardRef } from 'react';
import { View, Text } from 'react-native';
import { Fonts } from '../../lib/theme';
import type { MonthlyRecap } from '../../lib/bilan';

// Carte 1080×1920 rendue hors-écran pour capture nette (react-native-view-shot).
export const ShareCard = forwardRef<View, { recap: MonthlyRecap }>(({ recap }, ref) => (
  <View ref={ref} collapsable={false} style={{ width: 1080, height: 1920, backgroundColor: '#FFC11A', padding: 120, justifyContent: 'center', gap: 48 }}>
    <Text style={{ fontFamily: Fonts.welcome, fontSize: 80, color: '#0A0A0A' }}>MON BILAN {recap.label}</Text>
    <Row n={recap.matches} l="MATCHS" />
    <Row n={`${recap.winRate}%`} l="VICTOIRES" />
    <Row n={`${recap.eloDelta >= 0 ? '+' : ''}${recap.eloDelta}`} l="POINTS ELO" />
    {recap.topPartner ? <Row n={recap.topPartner.name} l="MEILLEUR DUO" /> : null}
    <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 44, color: 'rgba(10,10,10,0.6)', marginTop: 40 }}>pagmatch.com</Text>
  </View>
));
ShareCard.displayName = 'ShareCard';

function Row({ n, l }: { n: number | string; l: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 28 }}>
      <Text style={{ fontFamily: Fonts.display, fontSize: 130, color: '#0A0A0A', minWidth: 320 }}>{n}</Text>
      <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 48, color: '#0A0A0A' }}>{l}</Text>
    </View>
  );
}
```

- [ ] **Step 4: `SlidePartage.tsx`** (CTA partage — la capture est gérée par le parent via une ref)

```tsx
import { View, Text, TouchableOpacity } from 'react-native';
import { Fonts } from '../../../lib/theme';
import type { MonthlyRecap } from '../../../lib/bilan';

export function SlidePartage({ recap, busy, onShare, onSave }: {
  recap: MonthlyRecap; busy: boolean; onShare: () => void; onSave: () => void;
}) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 18 }}>
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 22, color: '#0A0A0A' }}>PARTAGE TON BILAN</Text>
      <View style={{ backgroundColor: 'rgba(10,10,10,0.08)', borderRadius: 18, padding: 18, gap: 8 }}>
        <Text style={{ fontFamily: Fonts.display, fontSize: 26, color: '#0A0A0A' }}>{recap.matches} matchs · {recap.winRate}% · {recap.eloDelta >= 0 ? '+' : ''}{recap.eloDelta} ELO</Text>
        {recap.topPartner ? <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 14, color: 'rgba(10,10,10,0.7)' }}>Meilleur duo : {recap.topPartner.name}</Text> : null}
      </View>
      <TouchableOpacity onPress={onShare} disabled={busy} activeOpacity={0.85}
        style={{ backgroundColor: '#0A0A0A', borderRadius: 999, paddingVertical: 14, alignItems: 'center' }}>
        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 15, color: '#FFC11A' }}>{busy ? 'Préparation…' : 'Partager 📲'}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onSave} disabled={busy} activeOpacity={0.85}
        style={{ borderRadius: 999, paddingVertical: 12, alignItems: 'center', borderWidth: 1.5, borderColor: 'rgba(10,10,10,0.3)' }}>
        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 14, color: '#0A0A0A' }}>Enregistrer l'image</Text>
      </TouchableOpacity>
    </View>
  );
}
```

- [ ] **Step 5:** `npx tsc --noEmit` → exit 0.

---

## Task 8: Conteneur `app/bilan/[month].tsx` (navigation Stories + partage)

**Files:** Create `app/bilan/[month].tsx`

- [ ] **Step 1: Écrire le conteneur**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Pressable, Dimensions, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { usePlayer } from '../../hooks/usePlayer';
import { Colors, Fonts } from '../../lib/theme';
import { track } from '../../lib/analytics';
import { getMonthlyRecap, getRecapMonths, getLatestRecapMonth, type MonthlyRecap } from '../../lib/bilan';
import { GradientBg } from '../../components/bilan/GradientBg';
import { StoryProgress } from '../../components/bilan/StoryProgress';
import { ShareCard } from '../../components/bilan/ShareCard';
import { SlideCover } from '../../components/bilan/slides/SlideCover';
import { SlideVolume } from '../../components/bilan/slides/SlideVolume';
import { SlideForme } from '../../components/bilan/slides/SlideForme';
import { SlideElo } from '../../components/bilan/slides/SlideElo';
import { SlideDuo } from '../../components/bilan/slides/SlideDuo';
import { SlideBest } from '../../components/bilan/slides/SlideBest';
import { SlidePartage } from '../../components/bilan/slides/SlidePartage';

const SLIDE_COUNT = 7;
const SLIDE_NAMES = ['cover', 'volume', 'forme', 'elo', 'duo', 'best', 'partage'];
// Fond par slide (from,to). Cover & Partage en jaune, sinon sombres.
const BG: [string, string][] = [
  ['#FFC11A', '#7C2D12'], ['#064E3B', '#022C22'], ['#0A0A0A', '#1A1A1C'],
  ['#0A0A0A', '#1A1A1C'], ['#0A0A0A', '#1A1A1C'], ['#0E7490', '#064E3B'], ['#FFC11A', '#E8A906'],
];

export default function BilanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { player } = usePlayer();
  const { month: monthParam } = useLocalSearchParams<{ month: string }>();
  const shareRef = useRef<View>(null);

  const [month, setMonth] = useState<string | null>(null);
  const [months, setMonths] = useState<{ key: string; label: string }[]>([]);
  const [recap, setRecap] = useState<MonthlyRecap | null>(null);
  const [slide, setSlide] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const startMs = useRef(Date.now());

  // Résout le mois ("last" → dernier mois dispo).
  useEffect(() => {
    if (!player) return;
    (async () => {
      const list = await getRecapMonths(player.id);
      setMonths(list);
      const wanted = monthParam && monthParam !== 'last' ? monthParam : await getLatestRecapMonth(player.id);
      setMonth(wanted ?? null);
    })();
  }, [player, monthParam]);

  const loadMonth = useCallback(async (m: string) => {
    if (!player) return;
    setLoading(true);
    const r = await getMonthlyRecap(player.id, m);
    setRecap(r); setSlide(0); setLoading(false);
    track('bilan_opened', { source: 'tab', month: m });
  }, [player]);

  useEffect(() => { if (month) loadMonth(month); }, [month, loadMonth]);

  useEffect(() => {
    if (recap) track('bilan_slide_viewed', { slide_index: slide, slide_name: SLIDE_NAMES[slide], month: recap.month });
    if (recap && slide === SLIDE_COUNT - 1) track('bilan_completed', { month: recap.month, duration_ms: Date.now() - startMs.current });
  }, [slide, recap]);

  const onPickMonth = (k: string) => {
    if (k === month) return;
    track('bilan_month_switched', { from_month: month, to_month: k });
    setMonth(k);
  };

  const next = () => setSlide(s => Math.min(SLIDE_COUNT - 1, s + 1));
  const prev = () => setSlide(s => Math.max(0, s - 1));

  const doShare = async (save: boolean) => {
    if (!recap || busy) return;
    setBusy(true);
    try {
      const uri = await captureRef(shareRef, { format: 'png', quality: 1, result: 'tmpfile' });
      if (save) {
        const perm = await MediaLibrary.requestPermissionsAsync();
        if (perm.granted) { await MediaLibrary.saveToLibraryAsync(uri); Alert.alert('Enregistré', 'Image ajoutée à ta galerie.'); }
      } else if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Partager mon bilan' });
      }
      track('bilan_shared', { channel: save ? 'save' : 'share', month: recap.month });
    } catch {
      Alert.alert('Oups', "Le partage a échoué.");
    } finally { setBusy(false); }
  };

  const [from, to] = BG[slide] ?? BG[0];
  const W = Dimensions.get('window').width;

  return (
    <GradientBg from={from} to={to}>
      <View style={{ flex: 1, paddingTop: insets.top + 8 }}>
        <View style={{ paddingHorizontal: 12 }}>
          <StoryProgress count={SLIDE_COUNT} index={slide} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingTop: 8 }}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 20, color: slide === 0 || slide === 6 ? '#0A0A0A' : '#FFFFFF' }}>✕</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#FFFFFF" /></View>
        ) : !recap ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 }}>
            <Text style={{ fontFamily: Fonts.uiBold, fontSize: 16, color: '#FFFFFF', textAlign: 'center' }}>Pas encore de bilan pour ce mois.</Text>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            {slide === 0 && <SlideCover recap={recap} months={months} onPickMonth={onPickMonth} />}
            {slide === 1 && <SlideVolume recap={recap} />}
            {slide === 2 && <SlideForme recap={recap} />}
            {slide === 3 && <SlideElo recap={recap} />}
            {slide === 4 && <SlideDuo recap={recap} />}
            {slide === 5 && <SlideBest recap={recap} />}
            {slide === 6 && <SlidePartage recap={recap} busy={busy} onShare={() => doShare(false)} onSave={() => doShare(true)} />}

            {/* Zones de tap g/d (sauf slide partage pour ne pas gêner les boutons) */}
            {slide !== 6 && (
              <View style={{ position: 'absolute', top: 60, bottom: 0, left: 0, right: 0, flexDirection: 'row' }} pointerEvents="box-none">
                <Pressable style={{ width: W * 0.33 }} onPress={prev} />
                <Pressable style={{ flex: 1 }} onPress={next} />
              </View>
            )}
          </View>
        )}

        {/* ShareCard hors-écran pour capture nette */}
        <View style={{ position: 'absolute', left: -9999, top: 0 }} pointerEvents="none">
          {recap ? <ShareCard ref={shareRef} recap={recap} /> : null}
        </View>
      </View>
    </GradientBg>
  );
}
```

- [ ] **Step 2:** `npx tsc --noEmit` → exit 0.

- [ ] **Step 3: Vérif manuelle (Expo)** — `/bilan/last` ouvre le bilan ; tap droite/gauche navigue ; X ferme ; sélecteur de mois recharge ; slide 7 partage capture une image.

---

## Task 9: Brancher l'entrée Feed sur le vrai mois

**Files:** Modify `app/(tabs)/activite.tsx`

- [ ] **Step 1:** Le bouton « Voir bilan complet » pousse déjà `/bilan/last`. `/bilan/last` est désormais résolu par le conteneur (Task 8) vers le dernier mois disponible — **aucun changement de code requis**. Vérifier juste que le bouton existe et pointe vers `/bilan/last`.

- [ ] **Step 2:** `npx tsc --noEmit` → exit 0.

---

## Self-Review (à compléter à l'exécution)

**Spec coverage :** 7 slides (T6+T7), vue monthly_recap (T1), getMonthlyRecap assemblant ELO/duo/best/badges (T2), charts SVG (T4), sélecteur mois + mois courant (T5/T8), navigation Stories + progress (T5/T8), partage capture locale → Share Sheet (T7+T8), deep link /bilan/<mois> & /bilan/last (T3+T8), tracking bilan_* (T8). ✅
**Placeholders :** aucun — code complet par step.
**Type consistency :** `MonthlyRecap` défini en T2, importé partout ; props slides `{ recap }` cohérentes ; `ShareCard` forwardRef<View> capturé via `shareRef`.
**Dégradation :** getMonthlyRecap/getRecapMonths en try/catch ; recap null → écran « pas de bilan ».

## Notes
- **Mois courant bloqué** : le handoff demande de bloquer la sélection du mois en cours. `getRecapMonths` renvoie les mois présents dans `monthly_recap` ; si on veut explicitement exclure le mois courant tant qu'il n'est pas « prêt », filtrer `key !== moisCourant` dans `getRecapMonths` (1 ligne) — à décider au rendu.
- **Frame C (mois calme < 3 matchs)** = sous-projet C : `recap.lowActivity` est déjà calculé ; le rendu mono-slide sera branché en C.
- **À appliquer à la main en prod** : `monthly_recap.sql`.
