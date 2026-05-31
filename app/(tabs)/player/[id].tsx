import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, TextInput,
  Modal, KeyboardAvoidingView, Platform, Pressable, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Line, Polyline, Polygon } from 'react-native-svg';
import { usePlayer } from '../../../hooks/usePlayer';
import { supabase } from '../../../lib/supabase';
import { Colors, getLeague, getLeagueLabel, eloToLevel, formatPadelLevel, Fonts } from '../../../lib/theme';
import type { Player, EloHistory } from '../../../types';
import StoryMatchPicker from '../../../components/StoryMatchPicker';
import StoryComposer from '../../../components/StoryComposer';
import type { StoryMatch } from '../../../components/StoryCanvas';

// ── Local types ──────────────────────────────────────────────────────
interface MatchRow {
  id: string;
  score_text: string | null;
  created_at: string;
  game_format?: string | null;
  match_type?: string | null;
  is_challenge?: boolean | null;
  status: string;
  game_id?: string | null;
  winner_id: string | null;
  loser_id: string | null;
  winner_id_2: string | null;
  loser_id_2: string | null;
  winner: { name: string } | null;
  loser: { name: string } | null;
  winner_2: { name: string } | null;
  loser_2: { name: string } | null;
  game?: { location: string | null; match_date: string | null } | null;
}

// ── Constants ────────────────────────────────────────────────────────
const BADGES_INFO: Record<string, { icon: string; label: string }> = {
  MVP:            { icon: '👑', label: 'MVP' },
  'La Bombe':     { icon: '💥', label: 'La Bombe' },
  'Le Smash':     { icon: '🎯', label: 'Le Smash' },
  'Le Phénix':    { icon: '🔥', label: 'Le Phénix' },
  'Le Mur':       { icon: '🧱', label: 'Le Mur' },
  "L'Essuie-glace": { icon: '🏃', label: "L'Essuie-glace" },
  'Roi du Filet': { icon: '🎾', label: 'Roi du Filet' },
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
  NET_KING:       { icon: '🎾', label: 'Roi du Filet' },
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

const COURT_SIDE_LABEL: Record<string, string> = { left: 'Gauche', right: 'Droit', both: 'Les deux' };

// ── Helpers ──────────────────────────────────────────────────────────
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : (parts[0]?.[0] ?? '?').toUpperCase();
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

function relativeDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return 'Hier';
  if (days < 7) return `Il y a ${days}j`;
  if (days < 30) return `Il y a ${Math.floor(days / 7)} sem.`;
  if (days < 365) return `Il y a ${Math.floor(days / 30)} mois`;
  return `Il y a ${Math.floor(days / 365)} an${Math.floor(days / 365) > 1 ? 's' : ''}`;
}

// ── SVG Icons ────────────────────────────────────────────────────────
function IconBack({ color = Colors.textPrimary }: { color?: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M15 18l-6-6 6-6" />
    </Svg>
  );
}

function IconEdit({ color = Colors.textOnDark, size = 18 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <Path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </Svg>
  );
}

function IconStar({ filled = false, color = Colors.textMuted, size = 18 }: { filled?: boolean; color?: string; size?: number }) {
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
  const color = diff >= 0 ? Colors.success : Colors.danger;
  const last = pts[pts.length - 1];

  return (
    <View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Polygon points={area} fill={diff >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)'} />
        <Polyline points={poly} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx={last.x.toFixed(1)} cy={last.y.toFixed(1)} r={3.5} fill={color} />
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        <Text style={{ color: Colors.textMuted, fontSize: 9 }}>{values[0].toFixed(2)}</Text>
        <Text style={{ fontSize: 11, fontWeight: '900', color }}>
          {diff >= 0 ? '+' : ''}{diff.toFixed(2)} niv.
        </Text>
        <Text style={{ color: Colors.textPrimary, fontSize: 9, fontWeight: '700' }}>{values[values.length - 1].toFixed(2)}</Text>
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
        <Circle cx={42} cy={42} r={r} fill="none" stroke={Colors.bgCardAlt} strokeWidth={7} />
        <Circle cx={42} cy={42} r={r} fill="none" stroke={Colors.textPrimary} strokeWidth={7}
          strokeDasharray={`${circ * rate / 100} ${circ}`} strokeLinecap="round" />
      </Svg>
      <View style={{ alignItems: 'center' }}>
        <Text style={{ fontSize: 15, fontWeight: '900', color: Colors.textPrimary, letterSpacing: -0.5, fontFamily: Fonts.uiBlack }}>{rate}%</Text>
        <Text style={{ fontSize: 8, color: Colors.textMuted, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Win</Text>
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
        {grids.map((pts, i) => <Polygon key={i} points={pts} fill="none" stroke={Colors.border} strokeWidth={1} />)}
        {DNA_AXES.map(a => {
          const pt = xy(a.angle, R);
          return <Line key={a.key} x1={cx} y1={cy} x2={pt.x.toFixed(1)} y2={pt.y.toFixed(1)} stroke={Colors.border} strokeWidth={1} />;
        })}
        <Polygon points={dataPoly} fill="rgba(79,70,229,0.15)" stroke={Colors.primary} strokeWidth={2} />
        {dataPts.map((p, i) => <Circle key={i} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r={3} fill={Colors.primary} />)}
      </Svg>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: -4 }}>
        {DNA_AXES.map(a => (
          <View key={a.key} style={{ alignItems: 'center', width: 58 }}>
            <Text style={{ fontSize: 14 }}>{a.emoji}</Text>
            <Text style={{ fontSize: 8, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{a.key}</Text>
            {(values[a.key] ?? 0) > 0 && (
              <Text style={{ fontSize: 9, fontWeight: '900', color: Colors.brand }}>×{values[a.key]}</Text>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Match history card ───────────────────────────────────────────────
function MatchCard({ match, playerId, eloDelta, onPlayerPress, onRematch }: {
  match: MatchRow;
  playerId: string;
  eloDelta?: number;
  onPlayerPress?: (id: string) => void;
  onRematch?: (matchId: string) => void;
}) {
  const isWin  = match.winner_id === playerId || match.winner_id_2 === playerId;
  const sets   = parseSets(match.score_text);
  const setsWon  = sets.filter(([w, l]) => w > l).length;
  const setsLost = sets.length - setsWon;

  const winnerIds = [match.winner_id, match.winner_id_2].filter(Boolean) as string[];
  const loserIds  = [match.loser_id,  match.loser_id_2].filter(Boolean) as string[];
  const winNames  = [match.winner?.name, match.winner_2?.name].filter(Boolean) as string[];
  const loseNames = [match.loser?.name,  match.loser_2?.name].filter(Boolean) as string[];

  // Find the partner of the viewed player (if doubles)
  const myTeamIds   = isWin ? winnerIds : loserIds;
  const myTeamNames = isWin ? winNames  : loseNames;
  const partnerIdx  = myTeamIds.findIndex(id => id !== playerId);
  const partnerName = partnerIdx >= 0 ? myTeamNames[partnerIdx] : null;
  const oppNames    = isWin ? loseNames : winNames;
  const oppIds      = isWin ? loserIds  : winnerIds;

  const accent    = isWin ? Colors.success : Colors.danger;
  const accentBg  = isWin ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.07)';
  const typeLabel = match.is_challenge ? 'Défi'
    : match.game_format === 'friendly' ? 'Amical'
    : 'Compétitif';
  const typeColor = match.is_challenge ? Colors.brandDeep
    : match.game_format === 'friendly' ? '#047857'
    : Colors.primary;
  const typeBg    = match.is_challenge ? 'rgba(255,193,26,0.18)'
    : match.game_format === 'friendly' ? 'rgba(16,185,129,0.12)'
    : 'rgba(79,70,229,0.10)';

  return (
    <View style={{
      backgroundColor: Colors.bgCard, borderRadius: 16, overflow: 'hidden',
      borderWidth: 1, borderColor: Colors.border, flexDirection: 'row',
    }}>
      {/* Accent stripe */}
      <View style={{ width: 4, backgroundColor: accent }} />

      <View style={{ flex: 1, padding: 12 }}>
        {/* ── Header ── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <View style={{ backgroundColor: accentBg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, fontWeight: '900', color: accent, letterSpacing: 0.4 }}>
              {isWin ? 'VICTOIRE' : 'DÉFAITE'}
            </Text>
          </View>
          <View style={{ backgroundColor: typeBg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, fontWeight: '900', color: typeColor, letterSpacing: 0.4 }}>
              {typeLabel.toUpperCase()}
            </Text>
          </View>
          <Text style={{ fontSize: 11, color: Colors.textMuted, marginLeft: 'auto' }}>
            {relativeDate(match.created_at)}
          </Text>
        </View>

        {/* ── Lieu + heure (si on a un game associé) ── */}
        {(match.game?.location || match.game?.match_date) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            {match.game?.location ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={{ fontSize: 11 }}>📍</Text>
                <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textSecondary }} numberOfLines={1}>
                  {match.game.location}
                </Text>
              </View>
            ) : null}
            {match.game?.match_date ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={{ fontSize: 11 }}>🕒</Text>
                <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textSecondary }}>
                  {new Date(match.game.match_date).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            ) : null}
          </View>
        )}

        {/* ── Sets (centered, large) ── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 12 }}>
          {sets.map(([w, l], i) => {
            const myScore = isWin ? w : l;
            const oppScore = isWin ? l : w;
            const wonSet  = myScore > oppScore;
            return (
              <View key={i} style={{ alignItems: 'center', minWidth: 38 }}>
                <Text style={{ fontSize: 9, fontWeight: '900', color: Colors.textMuted, letterSpacing: 0.5, marginBottom: 2 }}>
                  SET {i + 1}
                </Text>
                <View style={{
                  flexDirection: 'row', alignItems: 'baseline', gap: 4,
                  backgroundColor: wonSet ? accentBg : Colors.bgCardAlt,
                  borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
                  borderWidth: 1, borderColor: wonSet ? accent : Colors.border,
                }}>
                  <Text style={{ fontSize: 16, fontFamily: Fonts.uiBlack, fontWeight: '900', color: wonSet ? accent : Colors.textPrimary }}>
                    {myScore}
                  </Text>
                  <Text style={{ fontSize: 11, color: Colors.textMuted }}>–</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.textMuted }}>
                    {oppScore}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        {/* ── Teams (compact) ── */}
        <View style={{ borderTopWidth: 1, borderTopColor: Colors.bgCardAlt, paddingTop: 10, gap: 6 }}>
          {/* My team */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 9, fontWeight: '900', color: Colors.textMuted, letterSpacing: 0.5, width: 60 }}>
              AVEC
            </Text>
            <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {partnerName ? (
                <TouchableOpacity
                  onPress={() => partnerIdx >= 0 && onPlayerPress?.(myTeamIds[partnerIdx])}
                  activeOpacity={0.7}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
                >
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: Colors.textOnDark, fontSize: 9, fontWeight: '900' }}>{getInitials(partnerName)}</Text>
                  </View>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.textPrimary }} numberOfLines={1}>{partnerName}</Text>
                </TouchableOpacity>
              ) : (
                <Text style={{ fontSize: 11, color: Colors.textMuted, fontStyle: 'italic' }}>Solo</Text>
              )}
            </View>
          </View>

          {/* Opponents */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 9, fontWeight: '900', color: Colors.textMuted, letterSpacing: 0.5, width: 60 }}>
              CONTRE
            </Text>
            <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {oppNames.map((name, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => oppIds[i] && onPlayerPress?.(oppIds[i])}
                  activeOpacity={0.7}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
                >
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.bgCardAlt, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border }}>
                    <Text style={{ color: Colors.textSecondary, fontSize: 9, fontWeight: '900' }}>{getInitials(name)}</Text>
                  </View>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: Colors.textSecondary }} numberOfLines={1}>{name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* ── Footer: sets won + ELO ── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: Colors.bgCardAlt }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textMuted }}>
            {setsWon}–{setsLost} sets
          </Text>
          {eloDelta != null && Math.abs(eloDelta) >= 0.005 && (
            <View style={{
              marginLeft: 'auto',
              flexDirection: 'row', alignItems: 'center', gap: 4,
              backgroundColor: eloDelta >= 0 ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.08)',
              borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
            }}>
              <Text style={{ fontSize: 10 }}>{eloDelta >= 0 ? '📈' : '📉'}</Text>
              <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, fontWeight: '900', color: eloDelta >= 0 ? Colors.success : Colors.danger }}>
                {eloDelta >= 0 ? '+' : ''}{eloDelta.toFixed(2)} niv.
              </Text>
            </View>
          )}
        </View>

        {onRematch && (
          <TouchableOpacity
            onPress={() => onRematch(match.id)}
            activeOpacity={0.85}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
              marginTop: 10, paddingVertical: 9, borderRadius: 10,
              backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border,
            }}
          >
            <Text style={{ fontSize: 13 }}>🔄</Text>
            <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary, letterSpacing: 0.3 }}>
              Rejouer avec la même équipe
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
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
  const [genderReqOpen, setGenderReqOpen] = useState(false);
  const [storyPickerOpen, setStoryPickerOpen] = useState(false);
  const [storyMatch, setStoryMatch] = useState<StoryMatch | null>(null);
  const [genderReqPending, setGenderReqPending] = useState<{ requested_gender: string; created_at: string } | null>(null);
  const [genderReqChoice, setGenderReqChoice] = useState<'male' | 'female' | 'other' | ''>('');
  const [genderReqReason, setGenderReqReason] = useState('');
  const [genderReqSubmitting, setGenderReqSubmitting] = useState(false);

  const isSelf = self?.id === id;

  const fetchData = async () => {
    // Phase 1 — profile
    const { data: profileData } = await supabase.from('players').select('*').eq('id', id).single();
    setProfile(profileData);

    // Phase 2 — everything else in parallel
    const [matchesRes, historyRes, repRes, favRes, rankRes] = await Promise.all([
      supabase
        .from('matches')
        .select(`id, score_text, created_at, game_format, match_type, is_challenge, status, game_id,
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

    setMatches(((matchesRes.data ?? []) as MatchRow[]).filter(isDoubles));
    setEloHistory(historyRes.data ?? []);
    setReputation(repRes.data ?? []);
    setIsFav(!!favRes.data);
    setRankPos((rankRes.count ?? 0) + 1);

    // Pending gender-change request (only relevant on own profile)
    if (self?.id === id) {
      const { data: req } = await supabase
        .from('gender_change_requests')
        .select('requested_gender, created_at')
        .eq('player_id', id)
        .eq('status', 'pending')
        .maybeSingle();
      setGenderReqPending(req ?? null);
    }

    setLoading(false);
  };

  const submitGenderRequest = async () => {
    if (!self || !genderReqChoice || genderReqSubmitting) return;
    setGenderReqSubmitting(true);
    const { error } = await supabase.from('gender_change_requests').insert({
      player_id: self.id,
      current_gender: profile?.gender ?? null,
      requested_gender: genderReqChoice,
      reason: genderReqReason.trim() || null,
    });
    setGenderReqSubmitting(false);
    if (error) {
      Alert.alert('Erreur', error.code === '23505' ? 'Tu as déjà une demande en cours.' : error.message);
      return;
    }
    setGenderReqOpen(false);
    setGenderReqChoice('');
    setGenderReqReason('');
    Alert.alert('Demande envoyée', 'Un administrateur traitera ta demande sous peu.');
    fetchData();
  };

  const cancelGenderRequest = async () => {
    if (!self) return;
    const { error } = await supabase
      .from('gender_change_requests')
      .delete()
      .eq('player_id', self.id)
      .eq('status', 'pending');
    if (error) Alert.alert('Erreur', error.message);
    else fetchData();
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
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
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
  const fibColor = fib >= 75 ? Colors.success : fib >= 50 ? Colors.primary : Colors.danger;

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
      style={{ flex: 1, backgroundColor: Colors.bg }}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
    >
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 14,
        backgroundColor: Colors.heroBg,
      }}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
          activeOpacity={0.7}
        >
          <IconBack color={Colors.textOnDark} />
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          {!isSelf && (
            <>
              <TouchableOpacity
                onPress={toggleFav}
                style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: isFav ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
                activeOpacity={0.7}
              >
                <IconStar filled={isFav} color={isFav ? Colors.warning : 'rgba(255,255,255,0.7)'} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const sideParam = profile.court_side ? `&pside=${encodeURIComponent(profile.court_side)}` : '';
                  router.push((`/(tabs)/lobby?create=1&challenge=1&with=${profile.id}&pname=${encodeURIComponent(profile.name)}&pelo=${profile.elo_score}${sideParam}`) as any);
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: 12, borderRadius: 12, backgroundColor: Colors.primary }}
                activeOpacity={0.8}
              >
                <Text style={{ color: Colors.textOnDark, fontSize: 12 }}>⚡</Text>
                <Text style={{ color: Colors.textOnDark, fontSize: 12, fontWeight: '900', fontFamily: Fonts.uiBlack }}>Défier</Text>
              </TouchableOpacity>
            </>
          )}
          {isSelf && (
            <>
              <TouchableOpacity
                onPress={() => setStoryPickerOpen(true)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 13 }}>📸</Text>
                <Text style={{ color: Colors.textOnDark, fontSize: 12, fontWeight: '900', fontFamily: Fonts.uiBlack }}>Story</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={openEdit}
                style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
                activeOpacity={0.7}
              >
                <IconEdit color={Colors.textOnDark} size={17} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/* ── Hero zone (seamless with nav bar) ───────────────────── */}
      <View style={{ backgroundColor: Colors.heroBg, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 42, alignItems: 'center' }}>
        <View style={{ width: 82, height: 82, borderRadius: 41, borderWidth: 3, borderColor: leagueColor, backgroundColor: leagueColor + '22', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
          <Text style={{ color: Colors.textOnDark, fontSize: 30, fontWeight: '900', fontFamily: Fonts.uiBlack }}>{getInitials(profile.name)}</Text>
        </View>
        <Text style={{ fontSize: 32, color: Colors.textOnDark, letterSpacing: -0.5, textAlign: 'center', fontFamily: Fonts.welcome }}>
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
      <View style={{ marginHorizontal: 16, marginTop: -22, borderRadius: 24, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, padding: 20, shadowColor: Colors.textPrimary, shadowOpacity: 0.08, shadowRadius: 20, shadowOffset: { width: 0, height: 4 }, elevation: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: Colors.bgCardAlt }}>
          <View>
            <Text style={{ fontSize: 10, color: Colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Niveau padel</Text>
            <Text style={{ fontSize: 48, fontWeight: '900', color: leagueColor, letterSpacing: -2, lineHeight: 52, fontFamily: Fonts.uiBlack }}>
              {formatPadelLevel(profile.elo_score)}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 12, color: Colors.textSecondary }}>Fiabilité {fib}%</Text>
              <View style={{ backgroundColor: fibColor + '20', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 }}>
                <Text style={{ color: fibColor, fontSize: 10, fontWeight: '700' }}>{fibLabel}</Text>
              </View>
            </View>
            {nextLvl && (
              <View style={{ width: 130 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={{ fontSize: 9, color: Colors.textMuted }}>→ Niv. {nextLvl.toFixed(1)}</Text>
                  <Text style={{ fontSize: 9, color: leagueColor, fontWeight: '700' }}>{Math.round(lvlPct * 100)}%</Text>
                </View>
                <View style={{ height: 5, borderRadius: 3, backgroundColor: Colors.bgCardAlt }}>
                  <View style={{ height: 5, borderRadius: 3, backgroundColor: leagueColor, width: `${Math.round(lvlPct * 100)}%` as any }} />
                </View>
              </View>
            )}
          </View>
        </View>

        {recentForm.length > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.bgCardAlt }}>
            <Text style={{ fontSize: 10, fontWeight: '600', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 }}>Forme</Text>
            <View style={{ flexDirection: 'row', gap: 4, flex: 1 }}>
              {recentForm.map((r, i) => (
                <View key={i} style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: r === 'W' ? Colors.success : Colors.danger, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: Colors.textOnDark, fontSize: 9, fontWeight: '900' }}>{r}</Text>
                </View>
              ))}
            </View>
            {streak >= 3 && <Text style={{ fontSize: 11, fontWeight: '900', color: Colors.warning }}>🔥 {streak}</Text>}
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
          {[
            { label: 'Matchs',    value: totalM, color: Colors.textPrimary, bg: Colors.bg, border: Colors.border },
            { label: 'Victoires', value: wins,   color: Colors.success, bg: '#f0fdf4', border: '#bbf7d0' },
            { label: 'Défaites',  value: losses, color: Colors.danger, bg: '#fff5f5', border: '#fecaca' },
          ].map(s => (
            <View key={s.label} style={{ flex: 1, alignItems: 'center', backgroundColor: s.bg, borderRadius: 14, paddingVertical: 12, borderWidth: 1, borderColor: s.border }}>
              <Text style={{ fontSize: 26, fontWeight: '900', color: s.color, lineHeight: 30, fontFamily: Fonts.uiBlack }}>{s.value}</Text>
              <Text style={{ fontSize: 9, fontWeight: '600', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 2 }}>{s.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── ELO Chart ───────────────────────────────────────────── */}
      {eloHistory.length >= 2 && (
        <View style={{ marginHorizontal: 16, marginTop: 16, backgroundColor: Colors.bgCard, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: Colors.border, shadowColor: Colors.textPrimary, shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 14 }}>Évolution du niveau</Text>
          <EloLineChart history={eloHistory} />
        </View>
      )}


      {/* ── Stats ───────────────────────────────────────────────── */}
      <View style={{ marginHorizontal: 16, marginTop: 16, backgroundColor: Colors.bgCard, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: Colors.border, shadowColor: Colors.textPrimary, shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
        <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 16 }}>Statistiques</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
            <View>
              <Text style={{ fontSize: 22, fontWeight: '900', color: Colors.textPrimary, fontFamily: Fonts.uiBlack }}>{totalM}</Text>
              <Text style={{ fontSize: 10, fontWeight: '600', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 1 }}>Totaux</Text>
            </View>
            <View>
              <Text style={{ fontSize: 22, fontWeight: '900', color: Colors.success, fontFamily: Fonts.uiBlack }}>{wins}</Text>
              <Text style={{ fontSize: 10, fontWeight: '600', color: Colors.success, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 1 }}>Remportés</Text>
            </View>
            {bestPartner && (
              <View>
                <Text style={{ fontSize: 15, fontWeight: '900', color: Colors.brandDeep, fontFamily: Fonts.uiBlack }} numberOfLines={1}>{bestPartner}</Text>
                <Text style={{ fontSize: 10, fontWeight: '600', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 1 }}>Partenaire</Text>
              </View>
            )}
            {worstNemesis && (
              <View>
                <Text style={{ fontSize: 15, fontWeight: '900', color: Colors.danger, fontFamily: Fonts.uiBlack }} numberOfLines={1}>{worstNemesis}</Text>
                <Text style={{ fontSize: 10, fontWeight: '600', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 1 }}>Bête noire</Text>
              </View>
            )}
          </View>
          <WinRateRing rate={winRate} />
        </View>
      </View>

      {/* ── Dernier match ───────────────────────────────────────── */}
      {lastMatch && (
        <View style={{ marginHorizontal: 16, marginTop: 16, backgroundColor: Colors.bgCard, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border, shadowColor: Colors.textPrimary, shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
          <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.2 }}>Dernier Match</Text>
          </View>
          <View style={{ paddingHorizontal: 16, paddingVertical: 12, backgroundColor: lastIsWin ? '#fef9c3' : '#fee2e2', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 13, fontWeight: '900', color: lastIsWin ? '#713f12' : '#7f1d1d' }}>
                {lastIsWin ? 'Victoire !' : 'Défaite'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 11, color: Colors.textMuted }}>{relativeDate(lastMatch.created_at)}</Text>
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
                          <View key={ni} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: isMine ? Colors.primary : Colors.textMuted, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.bgCard, marginLeft: ni > 0 ? -8 : 0 }}>
                            <Text style={{ color: Colors.textOnDark, fontSize: 11, fontWeight: '900' }}>{getInitials(name)}</Text>
                          </View>
                        ))}
                      </View>
                      <Text style={{ flex: 1, fontSize: 13, fontWeight: isMine ? '900' : '500', color: isMine ? Colors.textPrimary : Colors.textMuted }} numberOfLines={1}>
                        {team.join(' & ')}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 12 }}>
                        {lastSets.map(([w, l], si) => {
                          const score = isMine ? (lastIsWin ? w : l) : (lastIsWin ? l : w);
                          return (
                            <Text key={si} style={{ fontSize: 18, fontWeight: '900', color: isMine ? Colors.textPrimary : Colors.border, width: 20, textAlign: 'center' }}>
                              {score}
                            </Text>
                          );
                        })}
                      </View>
                    </View>
                    {ti === 0 && <View style={{ height: 1, backgroundColor: Colors.bgCardAlt, marginVertical: 8 }} />}
                  </View>
                );
              })}
              {lastSets.length > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 4 }}>
                  {lastSets.map((_, si) => (
                    <Text key={si} style={{ fontSize: 9, fontWeight: '700', color: Colors.border, textTransform: 'uppercase', letterSpacing: 1, width: 20, textAlign: 'center' }}>
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
        <View style={{ marginHorizontal: 16, marginTop: 16, backgroundColor: Colors.bgCard, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: Colors.border, shadowColor: Colors.textPrimary, shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 14 }}>Préférences</Text>
          <View style={{ gap: 10 }}>
            {profile.court_side && (
              <View style={{ backgroundColor: Colors.bg, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: '#eef2ff', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 18 }}>🎾</Text>
                </View>
                <View>
                  <Text style={{ fontSize: 10, color: Colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 }}>Côté préféré</Text>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: Colors.textPrimary, marginTop: 1 }}>
                    {COURT_SIDE_LABEL[profile.court_side] ?? profile.court_side}
                  </Text>
                </View>
              </View>
            )}
            {playingDays.length > 0 && (
              <View style={{ backgroundColor: Colors.bg, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border, flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
                <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: '#f0fdf4', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 18 }}>📅</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 10, color: Colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>Jours préférés</Text>
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
              <View style={{ backgroundColor: Colors.bg, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: '#fffbeb', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 18 }}>🏆</Text>
                </View>
                <View>
                  <Text style={{ fontSize: 10, color: Colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 }}>Classement FRMT</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: Colors.textPrimary }}>{profile.frmt_rank}</Text>
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
              <View style={{ backgroundColor: Colors.bg, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 18 }}>🏟️</Text>
                </View>
                <View>
                  <Text style={{ fontSize: 10, color: Colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 }}>Terrain préféré</Text>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: Colors.textPrimary, marginTop: 1 }}>{profile.preferred_court}</Text>
                </View>
              </View>
            )}
          </View>
        </View>
      )}

      {/* ── Palmarès ────────────────────────────────────────────── */}
      {showPalm && (
        <View style={{ marginHorizontal: 16, marginTop: 16, backgroundColor: Colors.bgCard, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: Colors.border, shadowColor: Colors.textPrimary, shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 14 }}>Palmarès</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {sortedKarma.map(([key, count]) => {
                const info = BADGES_INFO[key];
                if (!info) return null;
                return (
                  <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border }}>
                    <Text style={{ fontSize: 20 }}>{info.icon}</Text>
                    <View>
                      <Text style={{ fontSize: 13, fontWeight: '900', color: Colors.textPrimary }}>{info.label}</Text>
                      <Text style={{ fontSize: 10, color: Colors.textMuted, fontWeight: '600' }}>×{count}</Text>
                    </View>
                  </View>
                );
              })}
              {achvBadges.map((b, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border }}>
                  <Text style={{ fontSize: 20 }}>{b.emoji}</Text>
                  <View>
                    <Text style={{ fontSize: 13, fontWeight: '900', color: Colors.textPrimary }}>{b.name}</Text>
                    <Text style={{ fontSize: 10, color: Colors.textMuted, fontWeight: '600' }}>{b.desc}</Text>
                  </View>
                </View>
              ))}
            </View>
        </View>
      )}

      {/* ── Match history ───────────────────────────────────────── */}
      <View style={{ marginHorizontal: 16, marginTop: 16 }}>
        <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 12 }}>
          Historique · {matches.length} match{matches.length !== 1 ? 's' : ''}
        </Text>

        {matches.length > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, marginBottom: 10, height: 42 }}>
            <Text style={{ fontSize: 15, marginRight: 8, color: Colors.textMuted }}>🔍</Text>
            <TextInput
              value={matchSearch}
              onChangeText={setMatchSearch}
              placeholder="Rechercher un joueur…"
              placeholderTextColor={Colors.textMuted}
              style={{ flex: 1, fontSize: 14, color: Colors.textPrimary }}
              clearButtonMode="while-editing"
              autoCorrect={false}
            />
          </View>
        )}

        {filteredMatches.length === 0 ? (
          <View style={{ backgroundColor: Colors.bgCard, borderRadius: 20, padding: 40, alignItems: 'center', borderWidth: 1, borderColor: Colors.border, shadowColor: Colors.textPrimary, shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
            <Text style={{ fontSize: 26, marginBottom: 8 }}>🎾</Text>
            <Text style={{ fontSize: 15, fontWeight: '900', color: Colors.textPrimary }}>
              {matchSearch.trim() ? 'Aucun résultat' : 'Aucun match joué'}
            </Text>
            <Text style={{ fontSize: 13, color: Colors.textMuted, marginTop: 4 }}>
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
                eloDelta={eloChangeByMatch[m.id]}
                onPlayerPress={(pid) => pid !== id && router.push(`/player/${pid}` as any)}
                onRematch={isSelf ? (matchId) => router.push(`/(tabs)/lobby?rematch=${matchId}` as any) : undefined}
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
            <View style={{ backgroundColor: Colors.bgCard, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: insets.bottom + 16 }}>
              {/* Handle */}
              <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
                <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border }} />
              </View>

              <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: Colors.bgCardAlt }}>
                <Text style={{ fontSize: 22, color: Colors.textPrimary, fontFamily: Fonts.welcome }}>Modifier le <Text style={{ color: Colors.brand }}>profil</Text></Text>
                <TouchableOpacity onPress={() => setEditOpen(false)} style={{ padding: 4 }}>
                  <Text style={{ fontSize: 22, color: Colors.textMuted }}>×</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ padding: 20, gap: 20 }} keyboardShouldPersistTaps="handled">

                {/* Pseudo */}
                <View>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8 }}>Pseudo affiché</Text>
                  <TextInput
                    value={editForm.name}
                    onChangeText={v => setEditForm(f => ({ ...f, name: v }))}
                    style={{ backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontWeight: '700', color: Colors.textPrimary }}
                    placeholder="Ton pseudo"
                    placeholderTextColor={Colors.textMuted}
                  />
                </View>

                {/* Genre — admin-gated via request */}
                <View>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8 }}>Genre</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>
                      {profile.gender === 'male' ? '♂ Homme' : profile.gender === 'female' ? '♀ Femme' : profile.gender === 'other' ? '⚧ Autre' : '—'}
                    </Text>
                    {genderReqPending ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ fontSize: 10, fontWeight: '800', color: '#B45309' }}>⏳ Demande en cours</Text>
                        <TouchableOpacity onPress={cancelGenderRequest} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                          <Text style={{ fontSize: 11, color: Colors.danger, fontWeight: '700' }}>Annuler</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity
                        onPress={() => { setGenderReqChoice(''); setGenderReqReason(''); setGenderReqOpen(true); }}
                        style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: Colors.bgCardAlt }}
                      >
                        <Text style={{ fontSize: 11, color: Colors.textPrimary, fontWeight: '800' }}>Demander un changement</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {genderReqPending ? (
                    <Text style={{ fontSize: 11, color: Colors.textMuted, marginTop: 4 }}>
                      Demande pour {genderReqPending.requested_gender === 'male' ? '♂ Homme' : genderReqPending.requested_gender === 'female' ? '♀ Femme' : '⚧ Autre'} envoyée le {new Date(genderReqPending.created_at).toLocaleDateString('fr-FR')}. Tu peux l'annuler tant qu'elle n'est pas traitée.
                    </Text>
                  ) : (
                    <Text style={{ fontSize: 11, color: Colors.textMuted, marginTop: 4 }}>Le genre influence les filtres de parties. Une demande sera traitée par un administrateur.</Text>
                  )}
                </View>

                {/* Côté préféré */}
                <View>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8 }}>Côté préféré</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {([{ val: 'left', label: 'Gauche' }, { val: 'right', label: 'Droit' }, { val: 'both', label: 'Les deux' }]).map(({ val, label }) => (
                      <TouchableOpacity
                        key={val}
                        onPress={() => setEditForm(f => ({ ...f, court_side: f.court_side === val ? '' : val }))}
                        style={{ flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 2, alignItems: 'center',
                          borderColor: editForm.court_side === val ? Colors.brand : Colors.border,
                          backgroundColor: editForm.court_side === val ? 'rgba(255,193,26,0.14)' : Colors.bg }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: 13, fontWeight: '700', color: editForm.court_side === val ? Colors.brandDeep : Colors.textSecondary, fontFamily: editForm.court_side === val ? Fonts.uiExtraBold : Fonts.uiBold }}>{label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Jours préférés */}
                <View>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8 }}>Jours préférés</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(day => (
                      <TouchableOpacity
                        key={day}
                        onPress={() => toggleDay(day)}
                        style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 2,
                          borderColor: editForm.playing_days.includes(day) ? Colors.brand : Colors.border,
                          backgroundColor: editForm.playing_days.includes(day) ? 'rgba(255,193,26,0.14)' : Colors.bg }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: 13, fontWeight: '700', color: editForm.playing_days.includes(day) ? Colors.brandDeep : Colors.textSecondary, fontFamily: editForm.playing_days.includes(day) ? Fonts.uiExtraBold : Fonts.uiBold }}>{day}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Terrain préféré */}
                <View>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8 }}>Terrain préféré</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {(['Intérieur', 'Extérieur', 'Les deux'] as const).map(court => (
                      <TouchableOpacity
                        key={court}
                        onPress={() => setEditForm(f => ({ ...f, preferred_court: f.preferred_court === court ? '' : court }))}
                        style={{ flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 2, alignItems: 'center',
                          borderColor: editForm.preferred_court === court ? Colors.brand : Colors.border,
                          backgroundColor: editForm.preferred_court === court ? 'rgba(255,193,26,0.14)' : Colors.bg }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '700', color: editForm.preferred_court === court ? Colors.brandDeep : Colors.textSecondary, textAlign: 'center', fontFamily: editForm.preferred_court === court ? Fonts.uiExtraBold : Fonts.uiBold }}>{court}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Classement FRMT */}
                <View>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8 }}>Classement FRMT (numéro)</Text>
                  <TextInput
                    value={editForm.frmt_rank}
                    onChangeText={v => setEditForm(f => ({ ...f, frmt_rank: v }))}
                    style={{ backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontWeight: '700', color: Colors.textPrimary }}
                    placeholder="Ex : 147"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="numeric"
                  />
                  <Text style={{ fontSize: 11, color: Colors.textMuted, marginTop: 4 }}>La vérification officielle sera disponible prochainement.</Text>
                </View>

              </ScrollView>

              {/* Save button */}
              <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
                <TouchableOpacity
                  onPress={handleEditSave}
                  disabled={editSaving || !editForm.name.trim()}
                  style={{ backgroundColor: editSaving || !editForm.name.trim() ? Colors.border : Colors.primary, borderRadius: 16, paddingVertical: 14, alignItems: 'center' }}
                  activeOpacity={0.85}
                >
                  <Text style={{ color: editSaving || !editForm.name.trim() ? Colors.textMuted : Colors.textOnDark, fontSize: 15, fontWeight: '900', fontFamily: Fonts.uiBlack }}>
                    {editSaving ? 'Enregistrement…' : 'Sauvegarder'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>

    {/* ── Demande de changement de genre ── */}
    <Modal visible={genderReqOpen} transparent animationType="fade" onRequestClose={() => setGenderReqOpen(false)}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', paddingHorizontal: 20 }} onPress={() => setGenderReqOpen(false)}>
        <Pressable onPress={() => {}} style={{ backgroundColor: Colors.bgCard, borderRadius: 20, padding: 20 }}>
          <Text style={{ fontSize: 17, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, marginBottom: 6 }}>
            Changement de genre
          </Text>
          <Text style={{ fontSize: 12, color: Colors.textSecondary, lineHeight: 18, marginBottom: 16 }}>
            Le genre influence les filtres "Hommes / Femmes / Mixte" des parties. Une demande sera revue par un administrateur.
          </Text>

          <Text style={{ fontSize: 10, fontWeight: '800', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Nouveau genre</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
            {([
              { val: 'male' as const, label: '♂ Homme' },
              { val: 'female' as const, label: '♀ Femme' },
              { val: 'other' as const, label: '⚧ Autre' },
            ]).map(({ val, label }) => {
              const active = genderReqChoice === val;
              const disabled = profile?.gender === val;
              return (
                <TouchableOpacity
                  key={val}
                  disabled={disabled}
                  onPress={() => setGenderReqChoice(val)}
                  style={{
                    flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 2, alignItems: 'center',
                    borderColor: active ? Colors.brand : Colors.border,
                    backgroundColor: active ? 'rgba(255,193,26,0.14)' : Colors.bg,
                    opacity: disabled ? 0.4 : 1,
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '800', color: active ? Colors.brandDeep : Colors.textSecondary }}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={{ fontSize: 10, fontWeight: '800', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Raison (optionnel)</Text>
          <TextInput
            value={genderReqReason}
            onChangeText={setGenderReqReason}
            placeholder="Quelques mots pour aider l'admin…"
            placeholderTextColor={Colors.textMuted}
            multiline
            style={{
              backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border,
              borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
              fontSize: 13, color: Colors.textPrimary, minHeight: 60, textAlignVertical: 'top',
              marginBottom: 16,
            }}
            maxLength={300}
          />

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity
              onPress={() => setGenderReqOpen(false)}
              style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' }}
            >
              <Text style={{ fontSize: 13, fontWeight: '800', color: Colors.textSecondary }}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={submitGenderRequest}
              disabled={!genderReqChoice || genderReqSubmitting}
              style={{
                flex: 1.4, paddingVertical: 12, borderRadius: 12, alignItems: 'center',
                backgroundColor: (!genderReqChoice || genderReqSubmitting) ? Colors.border : Colors.primary,
              }}
            >
              <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: (!genderReqChoice || genderReqSubmitting) ? Colors.textMuted : Colors.textOnDark }}>
                {genderReqSubmitting ? 'Envoi…' : 'Envoyer la demande'}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>

    {/* ── Story flow ── */}
    {isSelf && (
      <>
        <StoryMatchPicker
          visible={storyPickerOpen}
          playerId={profile.id}
          onClose={() => setStoryPickerOpen(false)}
          onPick={(m) => { setStoryPickerOpen(false); setStoryMatch(m); }}
        />
        <StoryComposer
          visible={storyMatch !== null}
          match={storyMatch}
          onClose={() => setStoryMatch(null)}
        />
      </>
    )}
    </>
  );
}
