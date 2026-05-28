import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, TextInput,
  Modal, KeyboardAvoidingView, Platform, Pressable, LayoutAnimation, UIManager,
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Line, Polyline, Polygon } from 'react-native-svg';
import { usePlayer } from '../../hooks/usePlayer';
import { supabase } from '../../lib/supabase';
import { Colors, getLeague, getLeagueLabel, eloToLevel, formatPadelLevel } from '../../lib/theme';
import type { Player, EloHistory } from '../../types';
import PadelRacketIcon from '../../components/PadelRacketIcon';

// ── Local types ──────────────────────────────────────────────────────
interface MatchRow {
  id: string;
  score_text: string | null;
  created_at: string;
  game_format?: string | null;
  match_type?: string | null;
  status: string;
  winner_id: string | null;
  loser_id: string | null;
  winner_id_2: string | null;
  loser_id_2: string | null;
  game_id?: string | null;
  winner: { name: string } | null;
  loser: { name: string } | null;
  winner_2: { name: string } | null;
  loser_2: { name: string } | null;
  game?: { location: string | null; match_date?: string | null } | null;
}

// ── Constants ────────────────────────────────────────────────────────
const BADGES_INFO: Record<string, { icon: string; label: string }> = {
  MVP:            { icon: '👑', label: 'MVP' },
  'La Bombe':     { icon: '💥', label: 'La Bombe' },
  'Le Smash':     { icon: '🎯', label: 'Le Smash' },
  'Le Phénix':    { icon: '🔥', label: 'Le Phénix' },
  'Le Mur':       { icon: '🧱', label: 'Le Mur' },
  "L'Essuie-glace": { icon: '🏃', label: "L'Essuie-glace" },
  'Roi du Filet': { icon: '', label: 'Roi du Filet' },
  'Le Cerveau':   { icon: '🧠', label: 'Le Cerveau' },
  'Le Capitaine': { icon: '⭐', label: 'Le Capitaine' },
  'Fair-Play':    { icon: '🤝', label: 'Fair-Play' },
  'Bonne Ambiance':{ icon: '😄', label: 'Bonne Ambiance' },
  '3e Mi-temps':  { icon: '🍻', label: '3e Mi-temps' },
  Ponctuel:       { icon: '⏰', label: 'Ponctuel' },
  CANNON:         { icon: '💥', label: 'La Bombe' },
  SMASH:          { icon: '🎯', label: 'Le Smash' },
  COMEBACK:       { icon: '🔥', label: 'Le Phénix' },
  WALL:           { icon: '🧱', label: 'Le Mur' },
  RUNNER:         { icon: '🏃', label: "L'Essuie-glace" },
  NET_KING:       { icon: '', label: 'Roi du Filet' },
  BRAIN:          { icon: '🧠', label: 'Le Cerveau' },
  CAPTAIN:        { icon: '⭐', label: 'Le Capitaine' },
  FAIR_PLAY:      { icon: '🤝', label: 'Fair-Play' },
  GOOD_VIBES:     { icon: '😄', label: 'Bonne Ambiance' },
  DRINKS:         { icon: '🍻', label: '3e Mi-temps' },
  PUNCTUAL:       { icon: '⏰', label: 'Ponctuel' },
  'El Cañón':     { icon: '💥', label: 'La Bombe' },
  'Bon Délire':   { icon: '😄', label: 'Bonne Ambiance' },
  'Essuie-glace': { icon: '🏃', label: "L'Essuie-glace" },
};

const DNA_AXES = [
  { key: 'Puissance', emoji: '💥', angle: -90 },
  { key: 'Vitesse',   emoji: '🏃', angle: -18 },
  { key: 'Ambiance',  emoji: '😄', angle:  54 },
  { key: 'Défense',   emoji: '🧱', angle: 126 },
  { key: 'Tactique',  emoji: '🧠', angle: 198 },
] as const;

const COURT_SIDE_LABEL: Record<string, string> = { left: 'Revers', right: 'Drive', both: 'Les deux' };

// ── Helpers ──────────────────────────────────────────────────────────
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : (parts[0]?.[0] ?? '?').toUpperCase();
}

function relativeDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return 'Hier';
  if (days < 7) return `Il y a ${days}j`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function parseSets(text: string | null): [number, number][] {
  if (!text) return [];
  return text.trim().split(/[\s,]+/).flatMap(s => {
    const parts = s.split('-').map(Number);
    return parts.length === 2 && !parts.some(isNaN) ? [[parts[0], parts[1]] as [number, number]] : [];
  });
}

function isDoubles(m: MatchRow) {
  return !!(m.winner_id_2 || m.loser_id_2) || m.match_type === '2v2';
}

// ── SVG Icons ────────────────────────────────────────────────────────
function IconBack({ color = '#0f172a' }: { color?: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M15 18l-6-6 6-6" />
    </Svg>
  );
}

function IconEdit({ color = '#fff', size = 18 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <Path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </Svg>
  );
}

function IconStar({ filled = false, color = '#94a3b8', size = 18 }: { filled?: boolean; color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24"
      fill={filled ? color : 'none'} stroke={color} strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </Svg>
  );
}

// ── ELO Line Chart ───────────────────────────────────────────────────
function EloLineChart({ history }: { history: EloHistory[] }) {
  const values = history.map(h => eloToLevel(h.elo_score));
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 0.01;
  const W = 300, H = 80, pad = 8;
  const step = (W - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => ({
    x: pad + i * step,
    y: H - pad - ((v - min) / range) * (H - pad * 2),
  }));
  const poly = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = [
    `${pts[0].x},${H - 2}`,
    ...pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    `${pts[pts.length - 1].x},${H - 2}`,
  ].join(' ');
  const diff = values[values.length - 1] - values[0];
  const color = diff >= 0 ? '#10b981' : '#ef4444';
  const last = pts[pts.length - 1];

  return (
    <View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Polygon points={area} fill={diff >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)'} />
        <Polyline points={poly} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx={last.x.toFixed(1)} cy={last.y.toFixed(1)} r={3.5} fill={color} />
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        <Text style={{ color: '#94a3b8', fontSize: 9 }}>{values[0].toFixed(2)}</Text>
        <Text style={{ fontSize: 11, fontWeight: '900', color }}>
          {diff >= 0 ? '+' : ''}{diff.toFixed(2)} niv.
        </Text>
        <Text style={{ color: '#0f172a', fontSize: 9, fontWeight: '700' }}>{values[values.length - 1].toFixed(2)}</Text>
      </View>
    </View>
  );
}

// ── Win Rate Ring ────────────────────────────────────────────────────
function WinRateRing({ rate }: { rate: number }) {
  const r = 34, circ = 2 * Math.PI * r;
  return (
    <View style={{ width: 84, height: 84, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={84} height={84} viewBox="0 0 84 84"
        style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={42} cy={42} r={r} fill="none" stroke="#f1f5f9" strokeWidth={7} />
        <Circle cx={42} cy={42} r={r} fill="none" stroke="#0f172a" strokeWidth={7}
          strokeDasharray={`${circ * rate / 100} ${circ}`} strokeLinecap="round" />
      </Svg>
      <View style={{ alignItems: 'center' }}>
        <Text style={{ fontSize: 15, fontWeight: '900', color: '#0f172a', letterSpacing: -0.5 }}>{rate}%</Text>
        <Text style={{ fontSize: 8, color: '#94a3b8', fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Win</Text>
      </View>
    </View>
  );
}

// ── DNA Radar ────────────────────────────────────────────────────────
function DnaRadar({ values }: { values: Record<string, number> }) {
  const R = 55, cx = 95, cy = 95;
  const xy = (angle: number, r: number) => ({
    x: cx + r * Math.cos((angle * Math.PI) / 180),
    y: cy + r * Math.sin((angle * Math.PI) / 180),
  });
  const maxVal = Math.max(...DNA_AXES.map(a => values[a.key] ?? 0), 1);
  const grids = [0.25, 0.5, 0.75, 1].map(lvl =>
    DNA_AXES.map(a => { const p = xy(a.angle, R * lvl); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' ')
  );
  const dataPts = DNA_AXES.map(a => xy(a.angle, R * Math.min((values[a.key] ?? 0) / maxVal, 1)));
  const dataPoly = dataPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={190} height={190} viewBox="0 0 190 190">
        {grids.map((pts, i) => <Polygon key={i} points={pts} fill="none" stroke="#e2e8f0" strokeWidth={1} />)}
        {DNA_AXES.map(a => {
          const pt = xy(a.angle, R);
          return <Line key={a.key} x1={cx} y1={cy} x2={pt.x.toFixed(1)} y2={pt.y.toFixed(1)} stroke="#e2e8f0" strokeWidth={1} />;
        })}
        <Polygon points={dataPoly} fill="rgba(79,70,229,0.15)" stroke="#4f46e5" strokeWidth={2} />
        {dataPts.map((p, i) => <Circle key={i} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r={3} fill="#4f46e5" />)}
      </Svg>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: -4 }}>
        {DNA_AXES.map(a => (
          <View key={a.key} style={{ alignItems: 'center', width: 58 }}>
            <Text style={{ fontSize: 14 }}>{a.emoji}</Text>
            <Text style={{ fontSize: 8, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>{a.key}</Text>
            {(values[a.key] ?? 0) > 0 && (
              <Text style={{ fontSize: 9, fontWeight: '900', color: '#4f46e5' }}>×{values[a.key]}</Text>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Match history card ───────────────────────────────────────────────
function MatchCard({ match, playerId, eloChange }: {
  match: MatchRow;
  playerId: string;
  eloChange?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const isWin  = match.winner_id === playerId || match.winner_id_2 === playerId;
  const is2v2  = isDoubles(match);
  const sets   = parseSets(match.score_text);
  const pad    = (arr: (number | string)[]) => [...arr, '–', '–', '–'].slice(0, 3) as (number | string)[];
  const wScores = pad(sets.map(s => s[0]));
  const lScores = pad(sets.map(s => s[1]));
  const winTeam  = [match.winner?.name, is2v2 ? match.winner_2?.name : null].filter(Boolean) as string[];
  const loseTeam = [match.loser?.name,  is2v2 ? match.loser_2?.name  : null].filter(Boolean) as string[];

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(v => !v);
  };

  const date = new Date(match.created_at);
  const dateLabel = date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeLabel = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const formatLabel = match.game_format === 'friendly' ? 'Amical' : match.game_format === 'competitive' ? 'Compétitif' : null;
  const typeLabel = is2v2 ? 'Double' : 'Simple';
  const eloDelta = eloChange != null ? eloChange : null;
  const locationLabel = match.game?.location ?? null;

  return (
    <TouchableOpacity onPress={toggle} activeOpacity={0.9}
      style={{ backgroundColor: '#fff', borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: '#f1f5f9' }}>
      <View style={{ paddingHorizontal: 14, paddingVertical: 10, backgroundColor: isWin ? '#fef9c3' : '#fee2e2', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 13, fontWeight: '900', color: isWin ? '#713f12' : '#7f1d1d' }}>
          {isWin ? 'Victoire !' : 'Défaite'}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 10, color: isWin ? '#92400e' : '#991b1b', opacity: 0.6 }}>
            {dateLabel}
          </Text>
          <Text style={{ fontSize: 18 }}>{isWin ? '🏆' : '💪'}</Text>
        </View>
      </View>

      <View style={{ padding: 12 }}>
        {/* Winner row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <View style={{ flexDirection: 'row', flex: 1, gap: 6 }}>
            {winTeam.map((name, i) => (
              <View key={i} style={{ alignItems: 'center', width: 44 }}>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#4f46e5', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '900' }}>{getInitials(name)}</Text>
                </View>
                <Text style={{ fontSize: 9, fontWeight: '700', color: '#475569', marginTop: 2 }} numberOfLines={1}>{name.split(' ')[0]}</Text>
              </View>
            ))}
          </View>
          <Text style={{ fontSize: 13, color: '#f59e0b', width: 20, textAlign: 'center' }}>🏆</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {wScores.map((s, i) => (
              <Text key={i} style={{ fontSize: 18, fontWeight: '900', color: '#0f172a', width: 18, textAlign: 'center' }}>{s}</Text>
            ))}
          </View>
        </View>

        <View style={{ height: 1, backgroundColor: '#f1f5f9', marginVertical: 6 }} />

        {/* Loser row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flexDirection: 'row', flex: 1, gap: 6 }}>
            {loseTeam.map((name, i) => (
              <View key={i} style={{ alignItems: 'center', width: 44 }}>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '900' }}>{getInitials(name)}</Text>
                </View>
                <Text style={{ fontSize: 9, fontWeight: '600', color: '#94a3b8', marginTop: 2 }} numberOfLines={1}>{name.split(' ')[0]}</Text>
              </View>
            ))}
          </View>
          <View style={{ width: 20 }} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {lScores.map((s, i) => (
              <Text key={i} style={{ fontSize: 18, fontWeight: '900', color: '#cbd5e1', width: 18, textAlign: 'center' }}>{s}</Text>
            ))}
          </View>
        </View>

        {/* Toggle indicator */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8, gap: 4 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8 }}>
            {expanded ? 'Masquer' : 'Détails'}
          </Text>
          <Text style={{ fontSize: 10, color: '#cbd5e1' }}>{expanded ? '▴' : '▾'}</Text>
        </View>
      </View>

      {expanded && (
        <View style={{ borderTopWidth: 1, borderTopColor: '#f1f5f9', padding: 14, backgroundColor: '#fafbfc', gap: 10 }}>
          {locationLabel && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: '#e2e8f0' }}>
              <Text style={{ fontSize: 13 }}>📍</Text>
              <Text style={{ fontSize: 12, fontWeight: '800', color: '#0f172a', flex: 1 }} numberOfLines={2}>
                {locationLabel}
              </Text>
            </View>
          )}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1, borderColor: '#e2e8f0' }}>
              <Text style={{ fontSize: 11 }}>🕒</Text>
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#475569' }}>{timeLabel}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1, borderColor: '#e2e8f0' }}>
              <Text style={{ fontSize: 11 }}>{is2v2 ? '👥' : '👤'}</Text>
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#475569' }}>{typeLabel}</Text>
            </View>
            {formatLabel && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1, borderColor: '#e2e8f0' }}>
                <Text style={{ fontSize: 11 }}>{match.game_format === 'friendly' ? '🤝' : '🎯'}</Text>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#475569' }}>{formatLabel}</Text>
              </View>
            )}
            {eloDelta != null && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: eloDelta >= 0 ? '#ecfdf5' : '#fef2f2', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1, borderColor: eloDelta >= 0 ? '#a7f3d0' : '#fecaca' }}>
                <Text style={{ fontSize: 11 }}>{eloDelta >= 0 ? '📈' : '📉'}</Text>
                <Text style={{ fontSize: 11, fontWeight: '900', color: eloDelta >= 0 ? '#059669' : '#dc2626' }}>
                  {eloDelta >= 0 ? '+' : ''}{eloDelta.toFixed(2)} niv.
                </Text>
              </View>
            )}
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── Main screen ──────────────────────────────────────────────────────
export default function PlayerProfileScreen() {
  const { id }           = useLocalSearchParams<{ id: string }>();
  const { player: self } = usePlayer();
  const router           = useRouter();
  const insets           = useSafeAreaInsets();

  const [profile,    setProfile]    = useState<Player | null>(null);
  const [matches,    setMatches]    = useState<MatchRow[]>([]);
  const [eloHistory, setEloHistory] = useState<EloHistory[]>([]);
  const [reputation, setReputation] = useState<{ badge_type: string }[]>([]);
  const [isFav,      setIsFav]      = useState(false);
  const [rankPos,    setRankPos]    = useState<number | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [matchSearch, setMatchSearch] = useState('');
  const [editOpen,   setEditOpen]   = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm,   setEditForm]   = useState({ name: '', court_side: '', playing_days: [] as string[], frmt_rank: '', preferred_court: '' });

  const isSelf = self?.id === id;

  const fetchData = async () => {
    // Phase 1 — profile
    const { data: profileData } = await supabase.from('players').select('*').eq('id', id).single();
    setProfile(profileData);

    // Phase 2 — everything else in parallel
    const [matchesRes, historyRes, repRes, favRes, rankRes] = await Promise.all([
      supabase
        .from('matches')
        .select(`id, score_text, created_at, game_format, match_type, status, game_id,
          winner_id, loser_id, winner_id_2, loser_id_2,
          winner:winner_id(name), loser:loser_id(name),
          winner_2:winner_id_2(name), loser_2:loser_id_2(name),
          game:game_id(location, match_date)`)
        .or(`winner_id.eq.${id},loser_id.eq.${id},winner_id_2.eq.${id},loser_id_2.eq.${id}`)
        .eq('status', 'validated')
        .order('created_at', { ascending: false }),
      supabase.from('elo_history').select('*').eq('player_id', id).order('created_at', { ascending: true }),
      supabase.from('reputation_votes').select('badge_type').eq('receiver_id', id),
      self
        ? supabase.from('player_favorites').select('id').eq('player_id', self.id).eq('favorite_id', id).maybeSingle()
        : Promise.resolve({ data: null }),
      profileData
        ? supabase.from('players').select('id', { count: 'exact', head: true }).gt('elo_score', profileData.elo_score)
        : Promise.resolve({ count: 0 }),
    ]);

    setMatches((matchesRes.data ?? []) as MatchRow[]);
    setEloHistory(historyRes.data ?? []);
    setReputation(repRes.data ?? []);
    setIsFav(!!favRes.data);
    setRankPos((rankRes.count ?? 0) + 1);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [id]);
  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const toggleFav = async () => {
    if (!self || isSelf) return;
    if (isFav) {
      await supabase.from('player_favorites').delete().eq('player_id', self.id).eq('favorite_id', id);
    } else {
      await supabase.from('player_favorites').insert({ player_id: self.id, favorite_id: id });
    }
    setIsFav(f => !f);
  };

  // ── Derived ───────────────────────────────────────────────────────
  const karmaCounts = useMemo(() => {
    const c: Record<string, number> = {};
    reputation.forEach(v => { c[v.badge_type] = (c[v.badge_type] || 0) + 1; });
    return c;
  }, [reputation]);

  const eloChangeByMatch = useMemo(() => {
    const m: Record<string, number> = {};
    eloHistory.forEach(h => {
      if (!h.match_id) return;
      const prev = h.elo_score - h.elo_change;
      m[h.match_id] = eloToLevel(h.elo_score) - eloToLevel(prev);
    });
    return m;
  }, [eloHistory]);


  const dna = (...keys: string[]) => keys.reduce((s, k) => s + (karmaCounts[k] ?? 0), 0);
  const dnaValues = useMemo(() => ({
    Puissance: dna('La Bombe', 'Le Smash', 'CANNON', 'SMASH', 'El Cañón'),
    Défense:   dna('Le Mur', 'Roi du Filet', 'WALL', 'NET_KING'),
    Tactique:  dna('Le Cerveau', 'Le Capitaine', 'Le Phénix', 'BRAIN', 'CAPTAIN', 'COMEBACK'),
    Vitesse:   dna("L'Essuie-glace", 'Essuie-glace', 'RUNNER'),
    Ambiance:  dna('3e Mi-temps', 'Bonne Ambiance', 'Fair-Play', 'Ponctuel', 'MVP',
                   'DRINKS', 'GOOD_VIBES', 'FAIR_PLAY', 'PUNCTUAL', 'Bon Délire'),
  }), [karmaCounts]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f9fafb', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f9fafb', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: Colors.textMuted }}>Joueur introuvable</Text>
      </View>
    );
  }

  const league      = getLeague(profile.elo_score);
  const leagueColor = Colors.league[league];
  const wins        = profile.win_count  ?? 0;
  const losses      = profile.loss_count ?? 0;
  const totalM      = wins + losses;
  const winRate     = totalM > 0 ? Math.round((wins / totalM) * 100) : 0;

  // Recent form + streak
  const recentForm = matches.slice(0, 5).map(m => (m.winner_id === id || m.winner_id_2 === id ? 'W' : 'L'));
  let streak = 0;
  for (const m of matches) { if (m.winner_id === id || m.winner_id_2 === id) streak++; else break; }

  // Level progress
  const curLevel   = eloToLevel(profile.elo_score);
  const thresholds = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0];
  const nextLvl    = thresholds.find(l => l > curLevel + 0.001) ?? null;
  const prevLvl    = [...thresholds].reverse().find(l => l <= curLevel + 0.001) ?? 1.0;
  const lvlPct     = nextLvl ? (curLevel - prevLvl) / (nextLvl - prevLvl) : 1.0;

  // Fiability
  const fib      = profile.fiability_pct ?? 50;
  const fibLabel = fib >= 85 ? 'EXCELLENT' : fib >= 75 ? 'FIABLE' : fib >= 50 ? 'MOYEN' : 'FAIBLE';
  const fibColor = fib >= 75 ? '#10b981' : fib >= 50 ? '#4f46e5' : '#ef4444';

  // Best partner & nemesis
  const partnerWins: Record<string, number>    = {};
  const opponentLoss: Record<string, number>   = {};
  for (const m of matches) {
    const isW   = m.winner_id === id || m.winner_id_2 === id;
    const is2v2 = isDoubles(m);
    if (isW && is2v2) {
      const p = m.winner_id === id ? m.winner_2?.name : m.winner?.name;
      if (p) partnerWins[p] = (partnerWins[p] || 0) + 1;
    }
    if (!isW) {
      if (m.winner?.name)   opponentLoss[m.winner.name]   = (opponentLoss[m.winner.name]   || 0) + 1;
      if (m.winner_2?.name) opponentLoss[m.winner_2.name] = (opponentLoss[m.winner_2.name] || 0) + 1;
    }
  }
  const [bestPartner]  = Object.entries(partnerWins).sort(([,a],[,b]) => b-a)[0] ?? [];
  const [worstNemesis] = Object.entries(opponentLoss).sort(([,a],[,b]) => b-a)[0] ?? [];

  // Achievement badges
  const achvBadges: { emoji: string; name: string; desc: string }[] = [];
  if (totalM >= 10)     achvBadges.push({ emoji: '🎖️', name: 'Vétéran',     desc: '10 matchs joués' });
  else if (totalM >= 1) achvBadges.push({ emoji: '🌱', name: 'Bizuth',       desc: 'A joué son 1er match' });
  if (streak >= 3)      achvBadges.push({ emoji: '🔥', name: 'On Fire',      desc: `${streak} victoires de suite` });
  let bagel = false, marathon = false, tiebreak = false;
  for (const m of matches) {
    if (!m.score_text) continue;
    if (m.score_text.split(',').length === 3)                           marathon  = true;
    if (m.score_text.includes('6-0') || m.score_text.includes('0-6')) bagel     = true;
    if (m.score_text.includes('7-6') || m.score_text.includes('6-7')) tiebreak  = true;
  }
  if (bagel)    achvBadges.push({ emoji: '🥯', name: 'Boulanger',   desc: 'A mis ou pris un 6-0' });
  if (marathon) achvBadges.push({ emoji: '🏃', name: 'Marathonien', desc: 'A survécu à 3 sets' });
  if (tiebreak) achvBadges.push({ emoji: '🎯', name: 'Clutch',      desc: 'A joué un tie-break' });

  const sortedKarma = Object.entries(karmaCounts).sort(([,a],[,b]) => b-a);
  const hasDna      = Object.values(dnaValues).some(v => v > 0);
  const playingDays: string[] = Array.isArray(profile.playing_days) ? profile.playing_days : [];

  // Last match details
  const lastMatch  = matches[0] ?? null;
  const lastIsWin  = lastMatch ? (lastMatch.winner_id === id || lastMatch.winner_id_2 === id) : false;
  const lastIs2v2  = lastMatch ? isDoubles(lastMatch) : false;
  const lastSets   = lastMatch ? parseSets(lastMatch.score_text) : [];
  const lastWinTeam  = lastMatch ? [lastMatch.winner?.name, lastIs2v2 ? lastMatch.winner_2?.name : null].filter(Boolean) as string[] : [];
  const lastLoseTeam = lastMatch ? [lastMatch.loser?.name,  lastIs2v2 ? lastMatch.loser_2?.name  : null].filter(Boolean) as string[] : [];
  const myLastTeam   = lastIsWin ? lastWinTeam  : lastLoseTeam;
  const theirTeam    = lastIsWin ? lastLoseTeam : lastWinTeam;

  const showPrefs = !!profile.court_side || playingDays.length > 0 || !!profile.frmt_rank || !!profile.preferred_court;
  const showPalm  = sortedKarma.length > 0 || achvBadges.length > 0;

  const openEdit = () => {
    setEditForm({
      name:            profile.name,
      court_side:      profile.court_side ?? '',
      playing_days:    Array.isArray(profile.playing_days) ? [...profile.playing_days] : [],
      frmt_rank:       profile.frmt_rank ?? '',
      preferred_court: profile.preferred_court ?? '',
    });
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    if (!editForm.name.trim()) return;
    setEditSaving(true);
    await supabase.from('players').update({
      name:            editForm.name.trim(),
      court_side:      editForm.court_side || null,
      playing_days:    editForm.playing_days.length > 0 ? editForm.playing_days : null,
      frmt_rank:       editForm.frmt_rank.trim() || null,
      preferred_court: editForm.preferred_court || null,
    }).eq('id', profile.id);
    setEditSaving(false);
    setEditOpen(false);
    onRefresh();
  };

  const toggleDay = (day: string) =>
    setEditForm(f => ({
      ...f,
      playing_days: f.playing_days.includes(day)
        ? f.playing_days.filter(d => d !== day)
        : [...f.playing_days, day],
    }));

  const filteredMatches = matchSearch.trim()
    ? matches.filter(m => {
        const q = matchSearch.toLowerCase();
        return [m.winner?.name, m.winner_2?.name, m.loser?.name, m.loser_2?.name]
          .some(n => n?.toLowerCase().includes(q));
      })
    : matches;

  return (
    <>
    <ScrollView
      style={{ flex: 1, backgroundColor: '#f0f4f8' }}
      contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
    >
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 14,
        backgroundColor: '#102820',
      }}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
          activeOpacity={0.7}
        >
          <IconBack color="#fff" />
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          {!isSelf && (
            <>
              <TouchableOpacity
                onPress={toggleFav}
                style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: isFav ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
                activeOpacity={0.7}
              >
                <IconStar filled={isFav} color={isFav ? '#f59e0b' : 'rgba(255,255,255,0.7)'} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const sideParam = profile.court_side ? `&pside=${encodeURIComponent(profile.court_side)}` : '';
                  router.push((`/(tabs)/lobby?create=1&challenge=1&with=${profile.id}&pname=${encodeURIComponent(profile.name)}&pelo=${profile.elo_score}${sideParam}`) as any);
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#4f46e5' }}
                activeOpacity={0.8}
              >
                <Text style={{ color: '#fff', fontSize: 12 }}>⚡</Text>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '900' }}>Défier</Text>
              </TouchableOpacity>
            </>
          )}
          {isSelf && (
            <TouchableOpacity
              onPress={openEdit}
              style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
              activeOpacity={0.7}
            >
              <IconEdit color="#fff" size={17} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Hero zone (seamless with nav bar) ───────────────────── */}
      <View style={{ backgroundColor: '#102820', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 42, alignItems: 'center' }}>
        <View style={{ width: 82, height: 82, borderRadius: 41, borderWidth: 3, borderColor: leagueColor, backgroundColor: leagueColor + '22', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
          <Text style={{ color: '#fff', fontSize: 30, fontWeight: '900' }}>{getInitials(profile.name)}</Text>
        </View>
        <Text style={{ fontSize: 22, fontWeight: '900', color: '#fff', letterSpacing: -0.5, textAlign: 'center' }}>
          {profile.name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <View style={{ backgroundColor: leagueColor + '25', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: leagueColor }}>
            <Text style={{ color: leagueColor, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 }}>{getLeagueLabel(league)}</Text>
          </View>
          {rankPos && (
            <View style={{ backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>
              <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: '700' }}>Rang #{rankPos}</Text>
            </View>
          )}
          {profile.frmt_verified && profile.frmt_rank && (
            <View style={{ backgroundColor: '#f0fdf4', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: '#bbf7d0' }}>
              <Text style={{ color: '#16a34a', fontSize: 10, fontWeight: '900' }}>🏆 {profile.frmt_rank} ✓</Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Floating profile card ────────────────────────────────── */}
      <View style={{ marginHorizontal: 16, marginTop: -22, borderRadius: 24, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', padding: 20, shadowColor: '#0f172a', shadowOpacity: 0.08, shadowRadius: 20, shadowOffset: { width: 0, height: 4 }, elevation: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
          <View>
            <Text style={{ fontSize: 10, color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Niveau padel</Text>
            <Text style={{ fontSize: 48, fontWeight: '900', color: leagueColor, letterSpacing: -2, lineHeight: 52 }}>
              {formatPadelLevel(profile.elo_score)}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 12, color: '#64748b' }}>Fiabilité {fib}%</Text>
              <View style={{ backgroundColor: fibColor + '20', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 }}>
                <Text style={{ color: fibColor, fontSize: 10, fontWeight: '700' }}>{fibLabel}</Text>
              </View>
            </View>
            {nextLvl && (
              <View style={{ width: 130 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={{ fontSize: 9, color: '#94a3b8' }}>→ Niv. {nextLvl.toFixed(1)}</Text>
                  <Text style={{ fontSize: 9, color: leagueColor, fontWeight: '700' }}>{Math.round(lvlPct * 100)}%</Text>
                </View>
                <View style={{ height: 5, borderRadius: 3, backgroundColor: '#f1f5f9' }}>
                  <View style={{ height: 5, borderRadius: 3, backgroundColor: leagueColor, width: `${Math.round(lvlPct * 100)}%` as any }} />
                </View>
              </View>
            )}
          </View>
        </View>

        {recentForm.length > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
            <Text style={{ fontSize: 10, fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>Forme</Text>
            <View style={{ flexDirection: 'row', gap: 4, flex: 1 }}>
              {recentForm.map((r, i) => (
                <View key={i} style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: r === 'W' ? '#10b981' : '#ef4444', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 9, fontWeight: '900' }}>{r}</Text>
                </View>
              ))}
            </View>
            {streak >= 3 && <Text style={{ fontSize: 11, fontWeight: '900', color: '#f97316' }}>🔥 {streak}</Text>}
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
          {[
            { label: 'Matchs',    value: totalM, color: '#0f172a', bg: '#f8fafc', border: '#e2e8f0' },
            { label: 'Victoires', value: wins,   color: '#059669', bg: '#f0fdf4', border: '#bbf7d0' },
            { label: 'Défaites',  value: losses, color: '#dc2626', bg: '#fff5f5', border: '#fecaca' },
          ].map(s => (
            <View key={s.label} style={{ flex: 1, alignItems: 'center', backgroundColor: s.bg, borderRadius: 14, paddingVertical: 12, borderWidth: 1, borderColor: s.border }}>
              <Text style={{ fontSize: 26, fontWeight: '900', color: s.color, lineHeight: 30 }}>{s.value}</Text>
              <Text style={{ fontSize: 9, fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 2 }}>{s.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── ELO Chart ───────────────────────────────────────────── */}
      {eloHistory.length >= 2 && (
        <View style={{ marginHorizontal: 16, marginTop: 16, backgroundColor: '#fff', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: '#e8edf2', shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 14 }}>Évolution du niveau</Text>
          <EloLineChart history={eloHistory} />
        </View>
      )}

      {/* ── Stats ───────────────────────────────────────────────── */}
      <View style={{ marginHorizontal: 16, marginTop: 16, backgroundColor: '#fff', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: '#e8edf2', shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
        <Text style={{ fontSize: 11, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 16 }}>Statistiques</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
            <View>
              <Text style={{ fontSize: 22, fontWeight: '900', color: '#0f172a' }}>{totalM}</Text>
              <Text style={{ fontSize: 10, fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 1 }}>Totaux</Text>
            </View>
            <View>
              <Text style={{ fontSize: 22, fontWeight: '900', color: '#10b981' }}>{wins}</Text>
              <Text style={{ fontSize: 10, fontWeight: '600', color: '#10b981', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 1 }}>Remportés</Text>
            </View>
            {bestPartner && (
              <View>
                <Text style={{ fontSize: 15, fontWeight: '900', color: '#4f46e5' }} numberOfLines={1}>{bestPartner}</Text>
                <Text style={{ fontSize: 10, fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 1 }}>Partenaire</Text>
              </View>
            )}
            {worstNemesis && (
              <View>
                <Text style={{ fontSize: 15, fontWeight: '900', color: '#ef4444' }} numberOfLines={1}>{worstNemesis}</Text>
                <Text style={{ fontSize: 10, fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 1 }}>Bête noire</Text>
              </View>
            )}
          </View>
          <WinRateRing rate={winRate} />
        </View>
      </View>

      {/* ── Dernier match ───────────────────────────────────────── */}
      {lastMatch && (
        <View style={{ marginHorizontal: 16, marginTop: 16, backgroundColor: '#fff', borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: '#e8edf2', shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
          <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1.2 }}>Dernier Match</Text>
          </View>
          <View style={{ paddingHorizontal: 16, paddingVertical: 12, backgroundColor: lastIsWin ? '#fef9c3' : '#fee2e2', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 13, fontWeight: '900', color: lastIsWin ? '#713f12' : '#7f1d1d' }}>
                {lastIsWin ? 'Victoire !' : 'Défaite'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 11, color: '#94a3b8' }}>{relativeDate(lastMatch.created_at)}</Text>
                <Text style={{ fontSize: 22 }}>{lastIsWin ? '🏆' : '💪'}</Text>
              </View>
            </View>

            <View style={{ padding: 16 }}>
              {[myLastTeam, theirTeam].map((team, ti) => {
                const isMine = ti === 0;
                return (
                  <View key={ti}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{ flexDirection: 'row' }}>
                        {team.map((name, ni) => (
                          <View key={ni} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: isMine ? '#4f46e5' : '#94a3b8', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff', marginLeft: ni > 0 ? -8 : 0 }}>
                            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '900' }}>{getInitials(name)}</Text>
                          </View>
                        ))}
                      </View>
                      <Text style={{ flex: 1, fontSize: 13, fontWeight: isMine ? '900' : '500', color: isMine ? '#0f172a' : '#94a3b8' }} numberOfLines={1}>
                        {team.join(' & ')}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 12 }}>
                        {lastSets.map(([w, l], si) => {
                          const score = isMine ? (lastIsWin ? w : l) : (lastIsWin ? l : w);
                          return (
                            <Text key={si} style={{ fontSize: 18, fontWeight: '900', color: isMine ? '#0f172a' : '#cbd5e1', width: 20, textAlign: 'center' }}>
                              {score}
                            </Text>
                          );
                        })}
                      </View>
                    </View>
                    {ti === 0 && <View style={{ height: 1, backgroundColor: '#f1f5f9', marginVertical: 8 }} />}
                  </View>
                );
              })}
              {lastSets.length > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 4 }}>
                  {lastSets.map((_, si) => (
                    <Text key={si} style={{ fontSize: 9, fontWeight: '700', color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: 1, width: 20, textAlign: 'center' }}>
                      S{si + 1}
                    </Text>
                  ))}
                </View>
              )}
            </View>
        </View>
      )}

      {/* ── Préférences ─────────────────────────────────────────── */}
      {showPrefs && (
        <View style={{ marginHorizontal: 16, marginTop: 16, backgroundColor: '#fff', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: '#e8edf2', shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 14 }}>Préférences</Text>
          <View style={{ gap: 10 }}>
            {profile.court_side && (
              <View style={{ backgroundColor: '#f8fafc', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#e8edf2', flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: '#eef2ff', alignItems: 'center', justifyContent: 'center' }}>
                  <PadelRacketIcon size={20} />
                </View>
                <View>
                  <Text style={{ fontSize: 10, color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 }}>Côté préféré</Text>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: '#0f172a', marginTop: 1 }}>
                    {COURT_SIDE_LABEL[profile.court_side] ?? profile.court_side}
                  </Text>
                </View>
              </View>
            )}
            {playingDays.length > 0 && (
              <View style={{ backgroundColor: '#f8fafc', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#e8edf2', flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
                <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: '#f0fdf4', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 18 }}>📅</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 10, color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>Jours préférés</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {playingDays.map(day => (
                      <View key={day} style={{ backgroundColor: '#f0fdf4', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#bbf7d0' }}>
                        <Text style={{ color: '#16a34a', fontSize: 12, fontWeight: '700' }}>{day}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            )}
            {profile.frmt_rank && (
              <View style={{ backgroundColor: '#f8fafc', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#e8edf2', flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: '#fffbeb', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 18 }}>🏆</Text>
                </View>
                <View>
                  <Text style={{ fontSize: 10, color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 }}>Classement FRMT</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: '#0f172a' }}>{profile.frmt_rank}</Text>
                    {profile.frmt_verified && (
                      <View style={{ backgroundColor: '#f0fdf4', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1, borderWidth: 1, borderColor: '#bbf7d0' }}>
                        <Text style={{ color: '#16a34a', fontSize: 9, fontWeight: '900' }}>Vérifié</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            )}
            {profile.preferred_court && (
              <View style={{ backgroundColor: '#f8fafc', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#e8edf2', flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 18 }}>🏟️</Text>
                </View>
                <View>
                  <Text style={{ fontSize: 10, color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 }}>Terrain préféré</Text>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: '#0f172a', marginTop: 1 }}>{profile.preferred_court}</Text>
                </View>
              </View>
            )}
          </View>
        </View>
      )}

      {/* ── Palmarès ────────────────────────────────────────────── */}
      {showPalm && (
        <View style={{ marginHorizontal: 16, marginTop: 16, backgroundColor: '#fff', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: '#e8edf2', shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 14 }}>Palmarès</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {sortedKarma.map(([key, count]) => {
                const info = BADGES_INFO[key];
                if (!info) return null;
                return (
                  <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: '#fafafa', borderWidth: 1, borderColor: '#e2e8f0' }}>
                    {key === 'Roi du Filet' || key === 'NET_KING'
                      ? <PadelRacketIcon size={20} />
                      : <Text style={{ fontSize: 20 }}>{info.icon}</Text>}
                    <View>
                      <Text style={{ fontSize: 13, fontWeight: '900', color: '#0f172a' }}>{info.label}</Text>
                      <Text style={{ fontSize: 10, color: '#94a3b8', fontWeight: '600' }}>×{count}</Text>
                    </View>
                  </View>
                );
              })}
              {achvBadges.map((b, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: '#fafafa', borderWidth: 1, borderColor: '#e2e8f0' }}>
                  <Text style={{ fontSize: 20 }}>{b.emoji}</Text>
                  <View>
                    <Text style={{ fontSize: 13, fontWeight: '900', color: '#0f172a' }}>{b.name}</Text>
                    <Text style={{ fontSize: 10, color: '#94a3b8', fontWeight: '600' }}>{b.desc}</Text>
                  </View>
                </View>
              ))}
            </View>
        </View>
      )}

      {/* ── Match history ───────────────────────────────────────── */}
      <View style={{ marginHorizontal: 16, marginTop: 16 }}>
        <Text style={{ fontSize: 11, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 12 }}>
          Historique · {matches.length} match{matches.length !== 1 ? 's' : ''}
        </Text>

        {matches.length > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e8edf2', paddingHorizontal: 12, marginBottom: 10, height: 42 }}>
            <Text style={{ fontSize: 15, marginRight: 8, color: '#94a3b8' }}>🔍</Text>
            <TextInput
              value={matchSearch}
              onChangeText={setMatchSearch}
              placeholder="Rechercher un joueur…"
              placeholderTextColor="#94a3b8"
              style={{ flex: 1, fontSize: 14, color: '#0f172a' }}
              clearButtonMode="while-editing"
              autoCorrect={false}
            />
          </View>
        )}

        {filteredMatches.length === 0 ? (
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 40, alignItems: 'center', borderWidth: 1, borderColor: '#e8edf2', shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
            <View style={{ marginBottom: 8 }}><PadelRacketIcon size={26} style={{ opacity: 0.6 }} /></View>
            <Text style={{ fontSize: 15, fontWeight: '900', color: '#0f172a' }}>
              {matchSearch.trim() ? 'Aucun résultat' : 'Aucun match joué'}
            </Text>
            <Text style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
              {matchSearch.trim() ? `Aucun match avec "${matchSearch}"` : "L'historique est encore vierge."}
            </Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {filteredMatches.map(m => (
              <MatchCard
                key={m.id}
                match={m}
                playerId={id as string}
                eloChange={eloChangeByMatch[m.id]}
              />
            ))}
          </View>
        )}
      </View>
    </ScrollView>

    {/* ── Edit profile modal ──────────────────────────────────── */}
    <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={() => setEditOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable>
            <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: insets.bottom + 16 }}>
              {/* Handle */}
              <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
                <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: '#e2e8f0' }} />
              </View>

              <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
                <Text style={{ fontSize: 18, fontWeight: '900', color: '#0f172a' }}>Modifier le profil</Text>
                <TouchableOpacity onPress={() => setEditOpen(false)} style={{ padding: 4 }}>
                  <Text style={{ fontSize: 22, color: '#94a3b8' }}>×</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ padding: 20, gap: 20 }} keyboardShouldPersistTaps="handled">

                {/* Pseudo */}
                <View>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8 }}>Pseudo affiché</Text>
                  <TextInput
                    value={editForm.name}
                    onChangeText={v => setEditForm(f => ({ ...f, name: v }))}
                    style={{ backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontWeight: '700', color: '#0f172a' }}
                    placeholder="Ton pseudo"
                    placeholderTextColor="#94a3b8"
                  />
                </View>

                {/* Genre — read-only */}
                <View>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8 }}>Genre</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f172a' }}>
                      {profile.gender === 'male' ? '♂ Homme' : profile.gender === 'female' ? '♀ Femme' : '—'}
                    </Text>
                    <Text style={{ fontSize: 11, color: '#94a3b8', fontWeight: '600' }}>Modifiable sur demande</Text>
                  </View>
                  <Text style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Pour modifier cette information, contactez un administrateur.</Text>
                </View>

                {/* Côté préféré */}
                <View>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8 }}>Côté préféré</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {([{ val: 'left', label: 'Revers' }, { val: 'right', label: 'Drive' }, { val: 'both', label: 'Les deux' }]).map(({ val, label }) => (
                      <TouchableOpacity
                        key={val}
                        onPress={() => setEditForm(f => ({ ...f, court_side: f.court_side === val ? '' : val }))}
                        style={{ flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 2, alignItems: 'center',
                          borderColor: editForm.court_side === val ? Colors.primary : '#e2e8f0',
                          backgroundColor: editForm.court_side === val ? '#eef2ff' : '#f8fafc' }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: 13, fontWeight: '700', color: editForm.court_side === val ? Colors.primary : '#64748b' }}>{label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Jours préférés */}
                <View>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8 }}>Jours préférés</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(day => (
                      <TouchableOpacity
                        key={day}
                        onPress={() => toggleDay(day)}
                        style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 2,
                          borderColor: editForm.playing_days.includes(day) ? Colors.primary : '#e2e8f0',
                          backgroundColor: editForm.playing_days.includes(day) ? '#eef2ff' : '#f8fafc' }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: 13, fontWeight: '700', color: editForm.playing_days.includes(day) ? Colors.primary : '#64748b' }}>{day}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Terrain préféré */}
                <View>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8 }}>Terrain préféré</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {(['Intérieur', 'Extérieur', 'Les deux'] as const).map(court => (
                      <TouchableOpacity
                        key={court}
                        onPress={() => setEditForm(f => ({ ...f, preferred_court: f.preferred_court === court ? '' : court }))}
                        style={{ flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 2, alignItems: 'center',
                          borderColor: editForm.preferred_court === court ? Colors.primary : '#e2e8f0',
                          backgroundColor: editForm.preferred_court === court ? '#eef2ff' : '#f8fafc' }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '700', color: editForm.preferred_court === court ? Colors.primary : '#64748b', textAlign: 'center' }}>{court}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Classement FRMT */}
                <View>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8 }}>Classement FRMT (numéro)</Text>
                  <TextInput
                    value={editForm.frmt_rank}
                    onChangeText={v => setEditForm(f => ({ ...f, frmt_rank: v }))}
                    style={{ backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontWeight: '700', color: '#0f172a' }}
                    placeholder="Ex : 147"
                    placeholderTextColor="#94a3b8"
                    keyboardType="numeric"
                  />
                  <Text style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>La vérification officielle sera disponible prochainement.</Text>
                </View>

              </ScrollView>

              {/* Save button */}
              <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
                <TouchableOpacity
                  onPress={handleEditSave}
                  disabled={editSaving || !editForm.name.trim()}
                  style={{ backgroundColor: editSaving || !editForm.name.trim() ? '#e2e8f0' : Colors.primary, borderRadius: 16, paddingVertical: 14, alignItems: 'center' }}
                  activeOpacity={0.85}
                >
                  <Text style={{ color: editSaving || !editForm.name.trim() ? '#94a3b8' : '#fff', fontSize: 15, fontWeight: '900' }}>
                    {editSaving ? 'Enregistrement…' : 'Sauvegarder'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
    </>
  );
}
