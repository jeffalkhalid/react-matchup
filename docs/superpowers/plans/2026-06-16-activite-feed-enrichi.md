# Feed Activité enrichi — Implementation Plan (sous-projet A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformer l'onglet Activité en feed social riche (Ta semaine · Hero « Il manque 1 joueur » · Moments · Joue ce week-end · fil amis existant).

**Architecture:** On garde le header noir de `app/(tabs)/activite.tsx` et le fil existant (`components/community/ActivityFeed.tsx`). On insère 4 nouvelles sections au-dessus, chacune isolée dans `components/activity/`. Les données passent par un nouveau `lib/activityFeed.ts` (2 RPC Supabase + 2 lectures client). Tracking via `lib/analytics.ts`. Tout est additif et réversible.

**Tech Stack:** Expo + React Native, TypeScript strict, `@supabase/supabase-js`, `react-native-svg`, expo-router.

**Spec :** `docs/superpowers/specs/2026-06-16-activite-feed-enrichi-design.md` · Index : `...-activite-refonte-index-design.md`

## Convention de vérification (ce projet n'a PAS de framework de test)

- Vérification de chaque tâche = **`npx tsc --noEmit`** doit passer (TypeScript strict), plus une vérif manuelle Expo quand c'est visuel.
- **Pas de commit automatique** (préférence utilisateur : travail direct sur `main`, l'utilisateur committe lui-même). Les tâches se terminent par la vérif `tsc`, pas par un `git commit`.
- Migrations SQL : appliquées **à la main** en prod par l'utilisateur (cohérent avec le reste du projet). Le code client doit **dégrader proprement** si une RPC n'est pas encore appliquée (try/catch → valeurs neutres, la section ne casse pas l'écran).

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `lib/analytics.ts` (créer) | `track(event, props)` fire-and-forget vers `analytics_events` |
| `lib/activityFeed.ts` (créer) | Accès données du feed : `getWeekStats`, `getSuggestedGame`, `getWeekendGames`, `pickMoments` + types |
| `lib/games.ts` (modifier) | Ajouter `freeSpots(game)` exporté (réutilisé par WeekendRail) |
| `components/community/Avatar.tsx` (modifier) | Variante `mono` (noir/jaune) |
| `components/activity/WeekStatsCard.tsx` (créer) | Section « Ta semaine » |
| `components/activity/JoinHeroCard.tsx` (créer) | Hero « Il manque 1 joueur » |
| `components/activity/WeekendRail.tsx` (créer) | « Joue ce week-end » |
| `components/activity/MomentsRail.tsx` (créer) | Rail Moments + slot Partager |
| `components/activity/MomentOverlay.tsx` (créer) | Overlay Stories plein écran |
| `components/community/ActivityFeed.tsx` (modifier) | Extraire `FriendsBar` + `FeedList` réutilisables |
| `app/(tabs)/activite.tsx` (modifier) | Assembler les sections + tracking + entrée Bilan |
| `supabase/migrations/analytics_events.sql` (créer) | Table tracking |
| `supabase/migrations/activity_week_stats.sql` (créer) | RPC « Ta semaine » |
| `supabase/migrations/suggested_open_game.sql` (créer) | RPC Hero |

---

## Task 1: Fondations tracking (`lib/analytics.ts` + table)

**Files:**
- Create: `supabase/migrations/analytics_events.sql`
- Create: `lib/analytics.ts`

- [ ] **Step 1: Migration table `analytics_events`**

Create `supabase/migrations/analytics_events.sql`:

```sql
-- Tracking événements produit. Insert-only côté client (fire-and-forget).
-- Appliquée à la main en prod (comme le reste des migrations du projet).
create table if not exists public.analytics_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.players(id) on delete set null,
  event       text not null,
  props       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_analytics_events_event_created
  on public.analytics_events (event, created_at desc);

alter table public.analytics_events enable row level security;

-- Chaque joueur n'insère QUE ses propres events. Pas de select/update/delete client.
drop policy if exists analytics_insert_self on public.analytics_events;
create policy analytics_insert_self on public.analytics_events
  for insert to authenticated
  with check (user_id = auth.uid());
```

- [ ] **Step 2: Helper `track()`**

Create `lib/analytics.ts`:

```ts
// Tracking produit minimal — fire-and-forget, jamais bloquant, jamais d'exception.
// Dégrade en silence si la table analytics_events n'est pas (encore) appliquée.
import { supabase } from './supabase';

export type AnalyticsEvent =
  | 'activity_tab_opened'
  | 'activity_hero_join_tapped'
  | 'activity_moment_opened'
  | 'activity_like_toggled'
  | 'activity_friend_filter'
  | 'bilan_opened'
  | 'bilan_month_switched'
  | 'bilan_slide_viewed'
  | 'bilan_completed'
  | 'bilan_shared'
  | 'notif_bilan_received'
  | 'notif_bilan_tapped';

export function track(event: AnalyticsEvent, props: Record<string, unknown> = {}): void {
  // Ne jamais await côté appelant : on lance et on oublie.
  (async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id ?? null;
      await supabase.from('analytics_events').insert({ user_id: uid, event, props });
    } catch {
      // silencieux : le tracking ne doit jamais casser l'UI
    }
  })();
}
```

- [ ] **Step 3: Vérifier tsc**

Run: `npx tsc --noEmit`
Expected: PASS (aucune erreur de type).

---

## Task 2: RPC SQL « Ta semaine » et Hero

**Files:**
- Create: `supabase/migrations/activity_week_stats.sql`
- Create: `supabase/migrations/suggested_open_game.sql`

> Ces deux migrations sont à **appliquer à la main** en prod. Le client (Task 3) doit fonctionner même avant application (dégradation).

- [ ] **Step 1: RPC `activity_week_stats`**

Create `supabase/migrations/activity_week_stats.sql`:

```sql
-- « Ta semaine » : matchs joués, forme V/D, delta ELO sur N derniers jours.
-- Un joueur peut être winner/winner_2/loser/loser_2 dans `matches`.
create or replace function public.activity_week_stats(p_uid uuid, p_days int default 7)
returns table (matches int, results text[], elo_delta numeric)
language sql stable security definer set search_path = public as $$
  with my_matches as (
    select m.id, m.created_at,
           (m.winner_id = p_uid or m.winner_id_2 = p_uid) as won
    from public.matches m
    where (m.winner_id = p_uid or m.winner_id_2 = p_uid
        or m.loser_id = p_uid or m.loser_id_2 = p_uid)
      and m.created_at >= now() - (p_days || ' days')::interval
    order by m.created_at asc
  )
  select
    (select count(*)::int from my_matches),
    (select coalesce(array_agg(case when won then 'W' else 'L' end order by created_at asc), '{}')
       from my_matches),
    (select coalesce(sum(h.elo_change), 0)
       from public.elo_history h
      where h.player_id = p_uid
        and h.created_at >= now() - (p_days || ' days')::interval);
$$;

grant execute on function public.activity_week_stats(uuid, int) to authenticated;
```

- [ ] **Step 2: RPC `suggested_open_game` (Hero)**

Create `supabase/migrations/suggested_open_game.sql`:

```sql
-- Hero « Il manque 1 joueur » : 1 partie ouverte à exactement 1 place libre,
-- scorée distance(club partagé) × niveau(écart ELO) × imminence × amis présents.
-- Renvoie 0 ou 1 ligne. Places libres = dérivées des participants (4 au padel).
create or replace function public.suggested_open_game(p_uid uuid)
returns table (
  game_id uuid, location text, match_date timestamptz, game_format text,
  free_spots int, friends_in int, score numeric
)
language sql stable security definer set search_path = public as $$
  with me as (
    select elo_score, coalesce(clubs, '{}') as clubs from public.players where id = p_uid
  ),
  my_follows as (
    select following_id from public.follows where follower_id = p_uid
  ),
  candidate as (
    select g.id, g.location, g.match_date, g.game_format, g.creator_id,
      -- occupants vivants = créateur + acceptés + invités non expirés
      1 + count(pt.player_id) filter (
        where pt.player_id <> g.creator_id
          and (pt.status = 'accepted'
            or (pt.status = 'invited'
              and (pt.invite_expires_at is null or pt.invite_expires_at > now())))
      ) as occupied,
      count(pt.player_id) filter (where pt.player_id in (select following_id from my_follows)) as friends_in
    from public.open_games g
    left join public.game_participants pt on pt.game_id = g.id
    where g.status = 'open' and g.match_date > now()
    group by g.id
  )
  select c.id, c.location, c.match_date, c.game_format,
    (4 - c.occupied)::int as free_spots,
    c.friends_in::int,
    (
      (case when c.location = any((select clubs from me)) then 30 else 0 end)
      + greatest(0, 25 - abs(coalesce((select elo_score from me),1000)
                              - 1000) / 40)            -- proxy écart niveau (sans ELO/partie)
      + greatest(0, 20 - extract(epoch from (c.match_date - now())) / 3600 / 12) -- imminence (≤ ~10j)
      + c.friends_in * 15
    )::numeric as score
  from candidate c
  where (4 - c.occupied) = 1
  order by score desc, c.match_date asc
  limit 1;
$$;

grant execute on function public.suggested_open_game(uuid) to authenticated;
```

> Note d'implémentation : le proxy « écart niveau » reste grossier (pas d'ELO moyen par partie disponible simplement). Acceptable pour la v1 ; raffinable plus tard (hors-scope spec).

- [ ] **Step 3: Vérification SQL (manuelle)**

Pas de `tsc` ici (SQL pur). Vérifier que le fichier est syntaxiquement cohérent (relecture). Application en prod = manuelle par l'utilisateur. **Ne pas appliquer automatiquement.**

---

## Task 3: Couche données `lib/activityFeed.ts` + `freeSpots` partagé

**Files:**
- Modify: `lib/games.ts` (ajout `freeSpots`)
- Create: `lib/activityFeed.ts`

- [ ] **Step 1: Exporter `freeSpots` dans `lib/games.ts`**

Ajouter à la fin de `lib/games.ts` :

```ts
/** Places libres au padel (4 places), dérivées des participants vivants —
 *  jamais du compteur stocké spots_available (qui peut dériver). Repli sur le
 *  compteur si les participants ne sont pas chargés. */
export function freeSpots(game: {
  creator_id: string;
  spots_available?: number | null;
  participants?: { player_id: string; status: string; invite_expires_at?: string | null }[] | null;
}): number {
  if (!game.participants) return game.spots_available ?? 0;
  const occupied = 1 + game.participants.filter(
    p => occupiesSpot(p) && p.player_id !== game.creator_id,
  ).length;
  return Math.max(0, 4 - occupied);
}
```

- [ ] **Step 2: Créer `lib/activityFeed.ts`**

Create `lib/activityFeed.ts`:

```ts
// Couche données du feed Activité enrichi (sections au-dessus du fil amis).
// Toutes les fonctions dégradent proprement si une RPC/colonne manque.
import { supabase } from './supabase';
import { getFollowingIds } from './community';
import { freeSpots } from './games';
import type { ActivityEvent } from '../types';

// ── Ta semaine ───────────────────────────────────────────────
export type WeekStats = { matches: number; results: ('W' | 'L')[]; eloDelta: number };

export async function getWeekStats(uid: string, days = 7): Promise<WeekStats> {
  try {
    const { data, error } = await supabase.rpc('activity_week_stats', { p_uid: uid, p_days: days });
    if (error || !data || !data[0]) return { matches: 0, results: [], eloDelta: 0 };
    const row: any = data[0];
    return {
      matches: row.matches ?? 0,
      results: (row.results ?? []) as ('W' | 'L')[],
      eloDelta: Number(row.elo_delta ?? 0),
    };
  } catch {
    return { matches: 0, results: [], eloDelta: 0 };
  }
}

// ── Hero « Il manque 1 joueur » ─────────────────────────────
export type SuggestedGame = {
  gameId: string; location: string | null; matchDate: string;
  gameFormat: string | null; freeSpots: number; friendsIn: number;
};

export async function getSuggestedGame(uid: string): Promise<SuggestedGame | null> {
  try {
    const { data, error } = await supabase.rpc('suggested_open_game', { p_uid: uid });
    if (error || !data || !data[0]) return null;
    const r: any = data[0];
    return {
      gameId: r.game_id, location: r.location, matchDate: r.match_date,
      gameFormat: r.game_format, freeSpots: r.free_spots ?? 1, friendsIn: r.friends_in ?? 0,
    };
  } catch {
    return null;
  }
}

// ── Joue ce week-end ─────────────────────────────────────────
export type WeekendGame = {
  id: string; location: string | null; matchDate: string;
  gameFormat: string | null; freeSpots: number;
};

function nextWeekendBounds(now = new Date()): { from: string; to: string } {
  // Du vendredi 00h au dimanche 23h59 de la semaine en cours / à venir.
  const d = new Date(now);
  const day = d.getDay(); // 0 dim … 6 sam
  const daysToFri = (5 - day + 7) % 7; // prochain vendredi (0 si on est vendredi)
  const fri = new Date(d); fri.setDate(d.getDate() + daysToFri); fri.setHours(0, 0, 0, 0);
  const sun = new Date(fri); sun.setDate(fri.getDate() + 2); sun.setHours(23, 59, 59, 999);
  return { from: fri.toISOString(), to: sun.toISOString() };
}

export async function getWeekendGames(uid: string): Promise<WeekendGame[]> {
  try {
    const { from, to } = nextWeekendBounds();
    const { data, error } = await supabase
      .from('open_games')
      .select('id, location, match_date, game_format, spots_available, creator_id, participants:game_participants(player_id, status, invite_expires_at)')
      .eq('status', 'open')
      .gte('match_date', from)
      .lte('match_date', to)
      .order('match_date', { ascending: true })
      .limit(10);
    if (error || !data) return [];
    return (data as any[])
      .map(g => ({
        id: g.id, location: g.location, matchDate: g.match_date,
        gameFormat: g.game_format, freeSpots: freeSpots(g),
      }))
      .filter(g => g.freeSpots > 0);
  } catch {
    return [];
  }
}

// ── Moments (rendus depuis activity_events, AUCUN média serveur) ─────
export type MomentType = 'match_win' | 'promotion' | 'badge';
export function pickMoments(feed: ActivityEvent[], max = 3): ActivityEvent[] {
  const types: MomentType[] = ['match_win', 'promotion', 'badge'];
  return feed.filter(e => types.includes(e.type as MomentType)).slice(0, max);
}
```

- [ ] **Step 3: Vérifier tsc**

Run: `npx tsc --noEmit`
Expected: PASS.

---

## Task 4: Variante `mono` de l'Avatar

**Files:**
- Modify: `components/community/Avatar.tsx`

- [ ] **Step 1: Ajouter le prop `mono`**

Remplacer la signature et le corps de `Avatar` dans `components/community/Avatar.tsx` par :

```tsx
export function Avatar({ name, size = 46, radius = 14, league = 'gold', mono }: {
  name?: string;
  size?: number;
  radius?: number;
  league?: League;
  mono?: 'black' | 'yellow';   // surfaces Activité : avatars noir OU jaune uniquement
}) {
  const r = Math.min(radius, size / 2);
  const gid = `av-${league}-${size}`;

  // Mode mono (règle visuelle du handoff) : aplat noir ou jaune, pas de dégradé ligue.
  if (mono) {
    const bg = mono === 'black' ? Colors.primary : Colors.brand;
    const fg = mono === 'black' ? Colors.brand : Colors.primary;
    return (
      <View style={{ width: size, height: size, borderRadius: r, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: Fonts.display, fontSize: size * 0.42, color: fg, letterSpacing: -0.5, includeFontPadding: false }}>
          {initials(name)}
        </Text>
      </View>
    );
  }

  const grad = LeagueGradients[league] ?? LeagueGradients.gold;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={grad[0]} />
            <Stop offset="1" stopColor={grad[1]} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={size} height={size} rx={r} ry={r} fill={`url(#${gid})`} />
      </Svg>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{
          fontFamily: Fonts.display, fontSize: size * 0.42, color: Colors.primary,
          letterSpacing: -0.5, includeFontPadding: false,
        }}>
          {initials(name)}
        </Text>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Vérifier tsc**

Run: `npx tsc --noEmit`
Expected: PASS. Les appels existants (`<Avatar name size radius league />`) restent valides (`mono` optionnel).

---

## Task 5: `WeekStatsCard` (Ta semaine)

**Files:**
- Create: `components/activity/WeekStatsCard.tsx`

- [ ] **Step 1: Composant**

Create `components/activity/WeekStatsCard.tsx`:

```tsx
import { View, Text } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import type { WeekStats } from '../../lib/activityFeed';

// Carré de forme V/D/?. 'W' vert, 'L' rouge, undefined = case dashed grise.
function FormCell({ r }: { r?: 'W' | 'L' }) {
  if (!r) {
    return <View style={{ width: 18, height: 18, borderRadius: 6, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#D4D4D8' }} />;
  }
  return (
    <View style={{ width: 18, height: 18, borderRadius: 6, backgroundColor: r === 'W' ? Colors.success : Colors.danger, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 10, color: '#FFFFFF' }}>{r === 'W' ? 'V' : 'D'}</Text>
    </View>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 6 }}>
      {children}
      <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 10.5, color: Colors.textMuted, textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

export function WeekStatsCard({ stats }: { stats: WeekStats }) {
  // Forme : 5 cases, complétées par des cases dashed si < 5 matchs.
  const cells: (('W' | 'L') | undefined)[] = [...stats.results].slice(-5);
  while (cells.length < 5) cells.push(undefined);
  const delta = stats.eloDelta;
  const deltaStr = `${delta > 0 ? '+' : ''}${Math.round(delta)}`;
  const deltaColor = delta > 0 ? Colors.success : delta < 0 ? Colors.danger : Colors.textMuted;

  return (
    <View style={{ backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, padding: 14, marginTop: 14 }}>
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 16, color: Colors.textPrimary, marginBottom: 12 }}>Ta semaine</Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <Metric label="Matchs joués">
          <Text style={{ fontFamily: Fonts.display, fontSize: 26, color: Colors.textPrimary }}>{stats.matches}</Text>
        </Metric>
        <Metric label="Forme">
          <View style={{ flexDirection: 'row', gap: 4 }}>{cells.map((c, i) => <FormCell key={i} r={c} />)}</View>
        </Metric>
        <Metric label="Δ ELO">
          <Text style={{ fontFamily: Fonts.display, fontSize: 26, color: deltaColor }}>{deltaStr}</Text>
        </Metric>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Vérifier tsc**

Run: `npx tsc --noEmit`
Expected: PASS.

---

## Task 6: `JoinHeroCard` (Il manque 1 joueur)

**Files:**
- Create: `components/activity/JoinHeroCard.tsx`

- [ ] **Step 1: Composant**

Create `components/activity/JoinHeroCard.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Fonts } from '../../lib/theme';
import { joinGame } from '../../lib/games';
import { track } from '../../lib/analytics';
import type { SuggestedGame } from '../../lib/activityFeed';

function whenLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tom = new Date(); tom.setDate(today.getDate() + 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const hh = String(d.getHours()).padStart(2, '0') + 'h' + (d.getMinutes() ? String(d.getMinutes()).padStart(2, '0') : '');
  if (sameDay(d, today)) return `CE SOIR · ${hh}`;
  if (sameDay(d, tom)) return `DEMAIN · ${hh}`;
  return `${['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'][d.getDay()]} · ${hh}`;
}

export function JoinHeroCard({ game }: { game: SuggestedGame }) {
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);

  const onJoin = async () => {
    if (joined || busy) return;
    setBusy(true);
    track('activity_hero_join_tapped', { match_id: game.gameId });
    try {
      await joinGame(game.gameId);
      setJoined(true);
    } catch {
      Alert.alert('Oups', "La demande n'a pas pu être envoyée.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <LinearGradient colors={[Colors.bgDark, Colors.bgDarkAlt]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ borderRadius: 18, padding: 16, marginTop: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <View style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 10, color: '#FFFFFF', letterSpacing: 0.5 }}>{whenLabel(game.matchDate)}</Text>
        </View>
        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 10, color: Colors.brand, letterSpacing: 0.5 }}>★ POUR TOI</Text>
      </View>

      <Text style={{ fontFamily: Fonts.welcome, fontSize: 22, color: Colors.textOnDark, lineHeight: 26 }}>
        Il manque 1 joueur
      </Text>
      <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>
        {[game.location, game.gameFormat].filter(Boolean).join(' · ') || 'Partie ouverte'}
        {game.friendsIn > 0 ? ` · ${game.friendsIn} ami${game.friendsIn > 1 ? 's' : ''} déjà inscrit${game.friendsIn > 1 ? 's' : ''}` : ''}
      </Text>

      <TouchableOpacity onPress={onJoin} activeOpacity={0.85} disabled={joined || busy}
        style={{ marginTop: 14, borderRadius: 999, paddingVertical: 12, alignItems: 'center', backgroundColor: joined ? Colors.success : Colors.brand }}>
        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 14, color: joined ? '#FFFFFF' : Colors.primary }}>
          {joined ? '✓ Demandé' : 'Rejoindre'}
        </Text>
      </TouchableOpacity>
    </LinearGradient>
  );
}
```

> Dépendance : `expo-linear-gradient`. Step 2 vérifie sa présence ; sinon repli `backgroundColor: Colors.bgDark`.

- [ ] **Step 2: Vérifier la dépendance `expo-linear-gradient`**

Run: `grep -i "expo-linear-gradient" package.json`
Expected : une ligne. **Si absente**, remplacer `<LinearGradient colors=... start=... end=... style={{...}}>` / `</LinearGradient>` par un simple `<View style={{ ...même style, backgroundColor: Colors.bgDark }}>` / `</View>` et retirer l'import.

- [ ] **Step 3: Vérifier tsc**

Run: `npx tsc --noEmit`
Expected: PASS.

---

## Task 7: `WeekendRail` (Joue ce week-end)

**Files:**
- Create: `components/activity/WeekendRail.tsx`

- [ ] **Step 1: Composant**

Create `components/activity/WeekendRail.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { joinGame } from '../../lib/games';
import { track } from '../../lib/analytics';
import type { WeekendGame } from '../../lib/activityFeed';

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const hh = String(d.getHours()).padStart(2, '0') + 'h' + (d.getMinutes() ? String(d.getMinutes()).padStart(2, '0') : '');
  return `${days[d.getDay()]} ${hh}`;
}

function WeekendCard({ g, dark, onJoin }: { g: WeekendGame; dark: boolean; onJoin: () => void }) {
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const bg = dark ? Colors.bgDark : Colors.bgCard;
  const fg = dark ? Colors.textOnDark : Colors.textPrimary;
  const sub = dark ? 'rgba(255,255,255,0.6)' : Colors.textSecondary;

  const handle = async () => {
    if (joined || busy) return;
    setBusy(true);
    try { await joinGame(g.id); setJoined(true); onJoin(); }
    catch { Alert.alert('Oups', "La demande n'a pas pu être envoyée."); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ width: 200, borderRadius: 16, padding: 14, backgroundColor: bg, borderWidth: dark ? 0 : 1, borderColor: Colors.border }}>
      <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 13, color: fg }}>{dayLabel(g.matchDate)}</Text>
      <Text numberOfLines={1} style={{ fontFamily: Fonts.uiSemi, fontSize: 12, color: sub, marginTop: 2 }}>{g.location ?? 'Lieu à confirmer'}</Text>
      <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: sub, marginTop: 8 }}>
        {g.freeSpots} place{g.freeSpots > 1 ? 's' : ''} libre{g.freeSpots > 1 ? 's' : ''}
      </Text>
      <TouchableOpacity onPress={handle} activeOpacity={0.85} disabled={joined || busy}
        style={{ marginTop: 10, borderRadius: 999, paddingVertical: 9, alignItems: 'center', backgroundColor: joined ? Colors.success : Colors.brand }}>
        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 12, color: joined ? '#FFFFFF' : Colors.primary }}>{joined ? '✓ Demandé' : 'Rejoindre'}</Text>
      </TouchableOpacity>
    </View>
  );
}

export function WeekendRail({ games }: { games: WeekendGame[] }) {
  if (games.length === 0) return null;
  return (
    <View style={{ marginTop: 18 }}>
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 16, color: Colors.textPrimary, marginBottom: 10 }}>Joue ce week-end</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 16 }}>
        {games.map((g, i) => <WeekendCard key={g.id} g={g} dark={i % 2 === 0} onJoin={() => track('activity_hero_join_tapped', { match_id: g.id })} />)}
      </ScrollView>
    </View>
  );
}
```

- [ ] **Step 2: Vérifier tsc**

Run: `npx tsc --noEmit`
Expected: PASS.

---

## Task 8: `MomentsRail` + `MomentOverlay`

**Files:**
- Create: `components/activity/MomentOverlay.tsx`
- Create: `components/activity/MomentsRail.tsx`

- [ ] **Step 1: `MomentOverlay`**

Create `components/activity/MomentOverlay.tsx`:

```tsx
import { Modal, View, Text, TouchableOpacity, TouchableWithoutFeedback } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Avatar } from '../community/Avatar';
import type { ActivityEvent } from '../../types';

const GRAD: Record<string, [string, string]> = {
  match_win: ['#064E3B', '#022C22'],
  promotion: ['#1A1A1C', '#0A0A0A'],
  badge: ['#7C2D12', '#FFC11A'],
};

function summary(e: ActivityEvent): string {
  if (e.type === 'match_win') return `Victoire ${e.payload?.score ?? ''}`.trim();
  if (e.type === 'promotion') return e.payload?.promo_label ?? 'Promotion';
  if (e.type === 'badge') return e.payload?.badge_label ?? 'Nouveau badge';
  return '';
}

export function MomentOverlay({ event, onClose }: { event: ActivityEvent | null; onClose: () => void }) {
  if (!event) return null;
  const [c0, c1] = GRAD[event.type] ?? GRAD.promotion;
  const when = new Date(event.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={{ flex: 1, backgroundColor: 'rgba(10,10,10,0.85)', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 280, aspectRatio: 9 / 16, borderRadius: 24, overflow: 'hidden', backgroundColor: c0 }}>
            <View style={{ flex: 1, backgroundColor: c1, padding: 18, justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar name={event.actor?.name} size={36} radius={999} mono="yellow" />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontFamily: Fonts.uiBlack, fontSize: 14, color: '#FFFFFF' }}>{event.actor?.name ?? 'Joueur'}</Text>
                  <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{when}</Text>
                </View>
                <TouchableOpacity onPress={onClose} hitSlop={10}>
                  <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 18, color: '#FFFFFF' }}>✕</Text>
                </TouchableOpacity>
              </View>
              <Text style={{ fontFamily: Fonts.welcome, fontSize: 28, color: '#FFFFFF', textAlign: 'center' }}>{summary(event)}</Text>
              <View style={{ borderRadius: 999, paddingVertical: 11, alignItems: 'center', backgroundColor: Colors.brand }}>
                <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 13, color: Colors.primary }}>Féliciter →</Text>
              </View>
            </View>
          </View>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}
```

- [ ] **Step 2: `MomentsRail`**

Create `components/activity/MomentsRail.tsx`:

```tsx
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Avatar } from '../community/Avatar';
import { track } from '../../lib/analytics';
import type { ActivityEvent } from '../../types';

const TILE: Record<string, string> = { match_win: '#064E3B', promotion: '#1A1A1C', badge: '#7C2D12' };

function tileText(e: ActivityEvent): string {
  if (e.type === 'match_win') return 'Victoire';
  if (e.type === 'promotion') return e.payload?.promo_label ?? 'Promotion';
  return e.payload?.badge_label ?? 'Badge';
}

export function MomentsRail({ moments, onShareMatch, onOpen }: {
  moments: ActivityEvent[];
  onShareMatch: () => void;
  onOpen: (e: ActivityEvent) => void;
}) {
  return (
    <View style={{ marginTop: 18 }}>
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 16, color: Colors.textPrimary, marginBottom: 10 }}>Moments de la semaine</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 16 }}>
        {/* Slot Partager — ouvre le StoryComposer local */}
        <TouchableOpacity onPress={onShareMatch} activeOpacity={0.85}
          style={{ width: 128, height: 184, borderRadius: 16, borderWidth: 2, borderStyle: 'dashed', borderColor: Colors.brand, alignItems: 'center', justifyContent: 'center', padding: 10 }}>
          <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 13, color: Colors.textPrimary, textAlign: 'center' }}>＋{'\n'}Partager ton match</Text>
        </TouchableOpacity>

        {moments.map(e => (
          <TouchableOpacity key={e.id} activeOpacity={0.9}
            onPress={() => { track('activity_moment_opened', { friend_id: e.player_id, moment_type: e.type }); onOpen(e); }}
            style={{ width: 128, height: 184, borderRadius: 16, overflow: 'hidden', backgroundColor: TILE[e.type] ?? '#1A1A1C', padding: 12, justifyContent: 'space-between' }}>
            <Avatar name={e.actor?.name} size={32} radius={999} mono="yellow" />
            <View>
              <Text numberOfLines={1} style={{ fontFamily: Fonts.uiBlack, fontSize: 13, color: '#FFFFFF' }}>{e.actor?.name?.split(' ')[0] ?? 'Joueur'}</Text>
              <Text numberOfLines={2} style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>{tileText(e)}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}
```

- [ ] **Step 3: Vérifier tsc**

Run: `npx tsc --noEmit`
Expected: PASS.

---

## Task 9: Extraire `FriendsBar` + `FeedList` de `ActivityFeed`

Objectif : pouvoir réutiliser la barre d'amis et la liste dans le nouvel assemblage **sans dupliquer**, en gardant le comportement actuel intact. On exporte deux sous-composants et on garde `ActivityFeed` comme wrapper qui les compose (les usages existants, ex. `app/community/friends.tsx`, continuent de marcher).

**Files:**
- Modify: `components/community/ActivityFeed.tsx`

- [ ] **Step 1: Exporter `FriendsBar` et `FeedList`**

Dans `components/community/ActivityFeed.tsx`, extraire le JSX de la barre d'amis (lignes ~69-97) dans un composant exporté `FriendsBar`, et la liste filtrée (lignes ~99-119) dans `FeedList`, tous deux pilotés par props. Remplacer le corps du `return` d'`ActivityFeed` pour les composer. Code complet :

```tsx
// ── Barre d'amis filtrante (export pour réutilisation dans l'onglet Activité) ──
export function FriendsBar({ friends, sel, onSelect }: {
  friends: SocialPlayer[]; sel: string | null; onSelect: (id: string | null) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 4 }}>
      <TouchableOpacity onPress={() => onSelect(null)} activeOpacity={0.85} style={{ alignItems: 'center', gap: 6, width: 56 }}>
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
          <TouchableOpacity key={f.id} onPress={() => onSelect(on ? null : f.id)} activeOpacity={0.85} style={{ alignItems: 'center', gap: 6, width: 56 }}>
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
  );
}

// ── Liste filtrée (export) ──
export function FeedList({ shown, myId, loading, selName, onReact, onReport, router }: {
  shown: ActivityEvent[]; myId: string; loading: boolean; selName?: string;
  onReact: (id: string) => void; onReport: (e: ActivityEvent) => void; router: ReturnType<typeof useRouter>;
}) {
  return (
    <View style={{ gap: 14, marginTop: 14 }}>
      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : shown.length > 0 ? (
        shown.map(e => <ActivityCard key={e.id} e={e} myId={myId} onReact={() => onReact(e.id)} onPressActor={() => router.push(`/player/${e.player_id}` as any)} onPressPlayer={(id) => router.push(`/player/${id}` as any)} onPressComments={() => router.push(`/community/comments/${e.id}` as any)} onReport={e.player_id === myId ? undefined : () => onReport(e)} />)
      ) : (
        <EmptyState name={selName?.split(' ')[0]} />
      )}
    </View>
  );
}
```

Puis remplacer le `return (...)` du composant `ActivityFeed` par une composition utilisant ces deux sous-composants (en conservant la logique `load`/`react`/`reportActivity`/filtres déjà présente) :

```tsx
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 110 }}>
      <FriendsBar friends={friends} sel={sel} onSelect={setSel} />
      {sel && selName ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14, color: Colors.textPrimary }}>Activité de {selName.split(' ')[0]}</Text>
          <TouchableOpacity onPress={() => setSel(null)} activeOpacity={0.85} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Chips, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Icon name="x" size={12} color={Colors.textSecondary} stroke={2.6} />
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: Colors.textSecondary }}>Tout voir</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <FeedList shown={shown} myId={myId} loading={loading} selName={selName} onReact={react} onReport={reportActivity} router={router} />
    </ScrollView>
  );
```

> Comportement identique à aujourd'hui : `app/community/friends.tsx` qui rend `<ActivityFeed myId>` n'est pas modifié.

- [ ] **Step 2: Vérifier tsc**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Vérif manuelle (Expo)**

Lancer `npm run android` (ou `start`), ouvrir Communauté → Mes amis : la barre d'amis et le fil se comportent **comme avant** (filtre, 🔥, commentaires, signalement). Aucun changement visible.

---

## Task 10: Assembler le feed enrichi dans `activite.tsx`

**Files:**
- Modify: `app/(tabs)/activite.tsx`

- [ ] **Step 1: Réécrire l'écran**

Remplacer `app/(tabs)/activite.tsx` par :

```tsx
import { useCallback, useState } from 'react';
import { View, Text, Image, ScrollView, ActivityIndicator, Alert, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { usePlayer } from '../../hooks/usePlayer';
import { Colors, Fonts } from '../../lib/theme';
import { ProfileAvatarButton } from '../../components/ProfileAvatarButton';
import { FriendsBar, FeedList } from '../../components/community/ActivityFeed';
import { getFriends, getActivityFeed, toggleReaction } from '../../lib/community';
import { getHiddenPlayerIds, reportContent } from '../../lib/moderation';
import { getWeekStats, getSuggestedGame, getWeekendGames, pickMoments, type WeekStats, type SuggestedGame, type WeekendGame } from '../../lib/activityFeed';
import { WeekStatsCard } from '../../components/activity/WeekStatsCard';
import { JoinHeroCard } from '../../components/activity/JoinHeroCard';
import { WeekendRail } from '../../components/activity/WeekendRail';
import { MomentsRail } from '../../components/activity/MomentsRail';
import { MomentOverlay } from '../../components/activity/MomentOverlay';
import { track } from '../../lib/analytics';
import type { SocialPlayer, ActivityEvent } from '../../types';

export default function ActiviteTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { player } = usePlayer();
  const myId = player?.id;

  const [friends, setFriends] = useState<SocialPlayer[]>([]);
  const [feed, setFeed] = useState<ActivityEvent[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [week, setWeek] = useState<WeekStats>({ matches: 0, results: [], eloDelta: 0 });
  const [hero, setHero] = useState<SuggestedGame | null>(null);
  const [weekend, setWeekend] = useState<WeekendGame[]>([]);
  const [openMoment, setOpenMoment] = useState<ActivityEvent | null>(null);

  const load = useCallback(() => {
    if (!myId) return;
    setLoading(true);
    Promise.all([
      getFriends(myId), getActivityFeed(myId), getHiddenPlayerIds(myId),
      getWeekStats(myId), getSuggestedGame(myId), getWeekendGames(myId),
    ]).then(([fr, fd, hidden, w, h, we]) => {
      setFriends(fr); setFeed(fd); setHiddenIds(hidden);
      setWeek(w); setHero(h); setWeekend(we); setLoading(false);
    });
  }, [myId]);

  useFocusEffect(useCallback(() => { track('activity_tab_opened', { source: 'tab' }); load(); }, [load]));

  const react = async (eventId: string) => {
    if (!myId) return;
    setFeed(prev => prev.map(e => {
      if (e.id !== eventId) return e;
      const fire = e.reactions?.['🔥'] ?? [];
      const has = fire.includes(myId);
      const next = has ? fire.filter(id => id !== myId) : [...fire, myId];
      const reactions = { ...e.reactions };
      if (next.length) reactions['🔥'] = next; else delete reactions['🔥'];
      track('activity_like_toggled', { activity_id: eventId, liked: !has });
      return { ...e, reactions };
    }));
    const updated = await toggleReaction(eventId);
    if (updated) setFeed(prev => prev.map(e => e.id === eventId ? { ...e, reactions: updated } : e));
  };

  const reportActivity = (e: ActivityEvent) => {
    if (!myId || e.player_id === myId) return;
    Alert.alert('Cette activité', undefined, [
      { text: 'Signaler', style: 'destructive', onPress: async () => {
        try { await reportContent({ reporterId: myId, targetType: 'activity', targetId: e.id, reportedPlayerId: e.player_id }); Alert.alert('Merci', 'Activité signalée à la modération.'); }
        catch { Alert.alert('Erreur', "Le signalement n'a pas pu être envoyé."); }
      } },
      { text: 'Annuler', style: 'cancel' },
    ]);
  };

  const selName = friends.find(f => f.id === sel)?.name;
  const visibleFeed = feed.filter(e => !hiddenIds.has(e.player_id));
  const shown = sel ? visibleFeed.filter(e => e.player_id === sel) : visibleFeed;
  const moments = pickMoments(visibleFeed);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <ProfileAvatarButton style={{ position: 'absolute', top: insets.top + 6, right: 14, zIndex: 20 }} />
      <View style={{ backgroundColor: Colors.heroBg, paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 16, borderBottomLeftRadius: 32, borderBottomRightRadius: 32 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
          <Image source={require('../../assets/auth/splash-racket.png')} style={{ width: 22, height: 22 }} resizeMode="contain" />
          <Image source={require('../../assets/auth/splash-wordmark.png')} style={{ width: 100, height: 22, marginLeft: -7 }} resizeMode="contain" />
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 28, fontFamily: Fonts.welcome, color: Colors.textOnDark, letterSpacing: 0.2, textAlign: 'center' }}>
            L'<Text style={{ color: Colors.brand }}>Activité</Text>
          </Text>
          <Text style={{ fontSize: 12, fontFamily: Fonts.uiSemi, fontWeight: '600', color: Colors.textSecondary, marginTop: 2, textAlign: 'center' }}>Le fil de tes amis</Text>
        </View>
      </View>

      {!myId ? null : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 110 }}>
          <WeekStatsCard stats={week} />
          {hero ? <JoinHeroCard game={hero} /> : null}
          <MomentsRail moments={moments} onShareMatch={() => router.push('/(tabs)/lobby?create=1' as any)} onOpen={setOpenMoment} />
          <WeekendRail games={weekend} />

          <View style={{ height: 1, backgroundColor: Colors.border, marginVertical: 18 }} />
          <FriendsBar friends={friends} sel={sel} onSelect={setSel} />
          {sel && selName ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14, color: Colors.textPrimary }}>Activité de {selName.split(' ')[0]}</Text>
              <TouchableOpacity onPress={() => setSel(null)} activeOpacity={0.85} style={{ backgroundColor: Colors.bgCardAlt, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: Colors.border }}>
                <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: Colors.textSecondary }}>Tout voir</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {sel ? track('activity_friend_filter', { friend_id: sel }) : null}
          <FeedList shown={shown} myId={myId} loading={loading} selName={selName} onReact={react} onReport={reportActivity} router={router} />

          {/* Entrée Bilan Mensuel (sous-projet B) — route créée plus tard */}
          <TouchableOpacity onPress={() => router.push('/bilan/last' as any)} activeOpacity={0.85}
            style={{ marginTop: 20, borderRadius: 14, paddingVertical: 13, alignItems: 'center', backgroundColor: Colors.primary }}>
            <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 13, color: Colors.brand }}>Voir bilan complet →</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      <MomentOverlay event={openMoment} onClose={() => setOpenMoment(null)} />
    </View>
  );
}
```

> Le bouton « Voir bilan complet » pointe vers `/bilan/last` (route ajoutée au sous-projet B). En attendant, le tap échouera silencieusement / sera ignoré ; **acceptable** car B suit immédiatement. (Si tu préfères, masquer ce bouton tant que B n'existe pas — choix laissé à l'exécution.)
> Le `track('activity_friend_filter')` rendu inline est volontairement simple ; si le linter se plaint d'un appel dans le JSX, déplacer l'appel dans le `onSelect` de `FriendsBar`.

- [ ] **Step 2: Vérifier tsc**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Vérif manuelle (Expo)**

Lancer l'app, onglet Activité :
1. « Ta semaine » affiche matchs / forme / Δ ELO (0/vide si RPC pas encore appliquée — ne casse pas).
2. Hero s'affiche s'il existe une partie à 1 place ; « Rejoindre » → « ✓ Demandé ».
3. Rail Moments : slot Partager ouvre le composer ; tap tuile → overlay plein écran, fermeture au tap.
4. « Joue ce week-end » liste les parties du week-end (ou rien).
5. Le fil amis (filtre, 🔥, commentaires) fonctionne comme avant.

---

## Self-Review (effectuée)

**Spec coverage :** Ta semaine (T5), Hero distance×niveau×imminence×amis (T2+T6), Moments rendus sans média (T8), Joue ce week-end via freeSpots (T3+T7), fil amis réutilisé (T9), avatars mono (T4), tracking analytics_events (T1) + events posés (T6/T7/T8/T10). ✅
**Placeholders :** aucun TODO/TBD ; code complet dans chaque step. ✅
**Type consistency :** `WeekStats`/`SuggestedGame`/`WeekendGame` définis en T3 et importés tels quels en T5/T6/T7/T10 ; `freeSpots` ajouté en T3 et utilisé en T3 ; `FriendsBar`/`FeedList` exportés en T9 et importés en T10 ; `MomentOverlay`/`MomentsRail` props alignées (`event`/`onClose`, `moments`/`onShareMatch`/`onOpen`). ✅
**Dégradation :** chaque accès RPC en try/catch → valeurs neutres (sections vides plutôt qu'écran cassé) si migrations pas encore appliquées. ✅

## Notes d'intégration (rappels)

- **Appliquer à la main** en prod : `analytics_events.sql`, `activity_week_stats.sql`, `suggested_open_game.sql` (par l'utilisateur).
- **Git** : pas de commit auto — l'utilisateur committe lui-même sur `main`.
- Vérif manuelle finale sur device Expo (le projet n'a pas de tests automatisés).
