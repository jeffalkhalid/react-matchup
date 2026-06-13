import { useEffect, useState, useMemo, type ReactNode } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, TextInput,
  Modal, KeyboardAvoidingView, Platform, Pressable, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Line, Polyline, Polygon, Rect, Defs, Stop, LinearGradient as SvgLinearGradient } from 'react-native-svg';
import { usePlayer } from '../../../hooks/usePlayer';
import { supabase } from '../../../lib/supabase';
import { Colors, getLeague, getLeagueLabel, eloToLevel, formatPadelLevel, Fonts } from '../../../lib/theme';
import { formatFrmtRanking } from '../../../lib/frmt-match';
import { blockUser, unblockUser, isBlocked, reportContent } from '../../../lib/moderation';
import { playerStoryLink, SHARE_LABEL, getPlayerActivity, toggleReaction, setFollow } from '../../../lib/community';
import { ActivityCard } from '../../../components/community/ActivityCard';
import type { Player, EloHistory, ActivityEvent, Achievement } from '../../../types';
import { getPlayerAchievements } from '../../../lib/achievements';
import { PM } from '../../../components/profile/theme';
import {
  ProfileHeader, AchievementFeedCard, MatchActionButton, type TabName, type MatchView, type TimelinePoint, type PlayerLite,
} from '../../../components/profile/components';
import { StatsTab, MatchsTab, PalmaresTab, BadgesTab } from '../../../components/profile/tabs';
import StoryMatchPicker from '../../../components/StoryMatchPicker';
import StoryComposerV2 from '../../../components/StoryComposerV2';
import type { StoryMode } from '../../../components/story/StoryStyles';
import type { StoryPlayer, StoryMatchData, InviteData } from '../../../components/story/storyTheme';
import { buildStoryMatch } from '../../../components/story/storyTheme';
import { isDeleted, displayName, type JoinedPlayer } from '../../../lib/players';

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
  winner: JoinedPlayer | null;
  loser: JoinedPlayer | null;
  winner_2: JoinedPlayer | null;
  loser_2: JoinedPlayer | null;
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
  'Roi du Filet': { icon: '🥅', label: 'Roi du Filet' },
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
  NET_KING:       { icon: '🥅', label: 'Roi du Filet' },
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

// ── Thème clair « épuré » (handoff) ───────────────────────────────────
// Tokens dérivés de la charte existante — aucune couleur nouvelle.
const LIGHT = {
  page: Colors.bg,
  card: Colors.bgCard,
  border: Colors.border,
  text: Colors.textPrimary,
  sub: Colors.textSecondary,
  muted: Colors.textMuted,
  divider: Colors.bgCardAlt,
  chip: Colors.bgCardAlt,
  accent: Colors.brandDeep,
};

const cardStyle = {
  backgroundColor: LIGHT.card, borderWidth: 1, borderColor: LIGHT.border, borderRadius: 18,
} as const;

function Kicker({ children, style }: { children: React.ReactNode; style?: any }) {
  return (
    <Text style={[{ fontSize: 11, fontWeight: '700', letterSpacing: 1.6, color: LIGHT.muted, textTransform: 'uppercase' }, style]}>
      {children}
    </Text>
  );
}

// Jauge circulaire de fiabilité — anneau coloré, % au centre.
function ReliabilityRing({ pct, color, size = 76, stroke = 8 }: {
  pct: number; color: string; size?: number; stroke?: number;
}) {
  const clamped = Math.min(100, Math.max(0, pct));
  const r       = (size - stroke) / 2;
  const c       = 2 * Math.PI * r;
  const offset  = c * (1 - clamped / 100);
  const mid     = size / 2;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={mid} cy={mid} r={r} stroke={LIGHT.divider} strokeWidth={stroke} fill="none" />
        <Circle
          cx={mid} cy={mid} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          transform={`rotate(-90 ${mid} ${mid})`}
        />
      </Svg>
      <Text style={{ fontFamily: Fonts.display, fontSize: 22, lineHeight: 24, color, letterSpacing: -0.5 }}>{Math.round(clamped)}</Text>
      <Text style={{ fontSize: 9, fontWeight: '800', color: LIGHT.muted, marginTop: -1 }}>%</Text>
    </View>
  );
}

function IconCamera({ color = LIGHT.sub, size = 19 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2z" />
      <Circle cx={12} cy={13} r={3.6} />
    </Svg>
  );
}

// Avatar carré arrondi à dégradé ligue→or, initiales en Anton (design épuré).
function GradientAvatar({ name, color, size = 76 }: { name: string; color: string; size?: number }) {
  const gid = 'avgrad';
  return (
    <View style={{ width: size, height: size, borderRadius: Math.round(size * 0.31), overflow: 'hidden' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Defs>
          <SvgLinearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={color} />
            <Stop offset="1" stopColor={Colors.brandDeep} />
          </SvgLinearGradient>
        </Defs>
        <Rect width={size} height={size} fill={`url(#${gid})`} />
      </Svg>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: Fonts.display, fontSize: Math.round(size * 0.45), color: '#0A0A0A' }}>{getInitials(name)}</Text>
      </View>
    </View>
  );
}

// ── Ligne d'historique compacte (design épuré) ────────────────────────
function HistoryRow({ match, playerId, isSelf, divider, onShare, onRematch }: {
  match: MatchRow; playerId: string; isSelf: boolean; divider: boolean;
  onShare?: () => void; onRematch?: () => void;
}) {
  const win = match.winner_id === playerId || match.winner_id_2 === playerId;
  const meIds      = win ? [match.winner_id, match.winner_id_2] : [match.loser_id, match.loser_id_2];
  const mePlayers  = win ? [match.winner, match.winner_2] : [match.loser, match.loser_2];
  const oppPlayers = win ? [match.loser, match.loser_2] : [match.winner, match.winner_2];
  const oppNames = oppPlayers.filter(Boolean).map(p => displayName(p, 'opponent'));
  const pIdx = meIds.findIndex(id => id && id !== playerId);
  const partner = pIdx >= 0 && mePlayers[pIdx] ? displayName(mePlayers[pIdx], 'partner') : null;
  const accent = win ? Colors.success : Colors.danger;
  const dateRaw = match.game?.match_date ?? match.created_at;
  const dateStr = new Date(dateRaw).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

  return (
    <TouchableOpacity
      activeOpacity={isSelf ? 0.6 : 1}
      onPress={isSelf ? onShare : undefined}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: divider ? 1 : 0, borderTopColor: LIGHT.divider }}
    >
      <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: accent + '1c', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 13, fontWeight: '900', color: accent }}>{win ? 'V' : 'D'}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 12.5, lineHeight: 16, color: LIGHT.sub }} numberOfLines={1}>
          <Text style={{ fontWeight: '700', color: LIGHT.text }}>Toi{partner ? ` & ${partner}` : ''}</Text>
          <Text style={{ color: LIGHT.muted }}>  vs  </Text>
          {oppNames.join(' & ') || '—'}
        </Text>
        <Text style={{ fontSize: 11, color: LIGHT.muted, marginTop: 3 }} numberOfLines={1}>
          {[match.game?.location, dateStr].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {match.score_text ? (
        <Text style={{ fontSize: 14, fontWeight: '800', letterSpacing: 0.3, color: accent }}>{match.score_text}</Text>
      ) : null}
      {isSelf && onRematch && (
        <TouchableOpacity onPress={onRematch} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }} style={{ paddingLeft: 2 }}>
          <Text style={{ fontSize: 15 }}>🔄</Text>
        </TouchableOpacity>
      )}
      {isSelf && <IconCamera color={LIGHT.muted} size={15} />}
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
  const [blocked,    setBlocked]    = useState(false);
  const [rankPos,    setRankPos]    = useState<number | null>(null);
  const [activity,   setActivity]   = useState<ActivityEvent[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [matchSearch, setMatchSearch] = useState('');
  const [showAllMatches, setShowAllMatches] = useState(false);
  const [editOpen,   setEditOpen]   = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm,   setEditForm]   = useState({ name: '', court_side: '', playing_days: [] as string[], frmt_rank: '', preferred_court: '' });
  const [genderReqOpen, setGenderReqOpen] = useState(false);
  const [storyPickerOpen, setStoryPickerOpen] = useState(false);
  const [storyMatch, setStoryMatch] = useState<StoryMatchData | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<StoryMode>('profil');
  const [composerLocked, setComposerLocked] = useState(false);
  const [genderReqPending, setGenderReqPending] = useState<{ requested_gender: string; created_at: string } | null>(null);
  const [genderReqChoice, setGenderReqChoice] = useState<'male' | 'female' | 'other' | ''>('');
  const [genderReqReason, setGenderReqReason] = useState('');
  const [genderReqSubmitting, setGenderReqSubmitting] = useState(false);

  // ── Refonte profil (header sombre + onglets) ──────────────────────
  const [tab, setTab]                     = useState<TabName>('Stats');
  const [achievements, setAchievements]   = useState<Achievement[]>([]);
  const [isFollowing, setIsFollowing]     = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);

  const isSelf = self?.id === id;

  const reactToActivity = async (eventId: string) => {
    const myId = self?.id ?? '';
    if (!myId) return;
    setActivity(prev => prev.map(e => {
      if (e.id !== eventId) return e;
      const fire = e.reactions?.['🔥'] ?? [];
      const has = fire.includes(myId);
      const next = has ? fire.filter(idx => idx !== myId) : [...fire, myId];
      const reactions = { ...e.reactions };
      if (next.length) reactions['🔥'] = next; else delete reactions['🔥'];
      return { ...e, reactions };
    }));
    const updated = await toggleReaction(eventId);
    if (updated) setActivity(prev => prev.map(e => e.id === eventId ? { ...e, reactions: updated } : e));
  };

  const reportActivityEvent = (e: ActivityEvent) => {
    const myId = self?.id ?? '';
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
          winner:winner_id(id, name, deleted_at, elo_score), loser:loser_id(id, name, deleted_at, elo_score),
          winner_2:winner_id_2(id, name, deleted_at, elo_score), loser_2:loser_id_2(id, name, deleted_at, elo_score),
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
        ? supabase.from('players').select('id', { count: 'exact', head: true }).is('deleted_at', null).gt('elo_score', profileData.elo_score)
        : Promise.resolve({ count: 0 }),
    ]);

    // Supabase renvoie les relations FK comme tableaux ; cast via unknown (forme runtime ≠ MatchRow).
    setMatches(((matchesRes.data ?? []) as unknown as MatchRow[]).filter(isDoubles));
    setEloHistory(historyRes.data ?? []);
    setReputation(repRes.data ?? []);
    setIsFav(!!favRes.data);
    setRankPos((rankRes.count ?? 0) + 1);
    getPlayerActivity(id).then(setActivity);
    getPlayerAchievements(id).then(setAchievements);

    // Graphe social (follows) — compteurs + état de suivi pour l'en-tête.
    supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', id)
      .then(({ count }) => setFollowerCount(count ?? 0));
    supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', id)
      .then(({ count }) => setFollowingCount(count ?? 0));
    if (self && self.id !== id) {
      supabase.from('follows').select('follower_id')
        .eq('follower_id', self.id).eq('following_id', id).maybeSingle()
        .then(({ data }) => setIsFollowing(!!data));
    }

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

  const toggleFollow = async () => {
    if (!self || isSelf) return;
    const next = !isFollowing;
    setIsFollowing(next);
    setFollowerCount(c => Math.max(0, c + (next ? 1 : -1)));
    try { await setFollow(self.id, id as string, next); }
    catch { setIsFollowing(!next); setFollowerCount(c => Math.max(0, c + (next ? -1 : 1))); }
  };

  const toggleFav = async () => {
    if (!self || isSelf) return;
    if (isFav) {
      await supabase.from('player_favorites').delete().eq('player_id', self.id).eq('favorite_id', id);
    } else {
      await supabase.from('player_favorites').insert({ player_id: self.id, favorite_id: id });
    }
    setIsFav(f => !f);
  };

  // ── Modération (blocage / signalement) ────────────────────────────
  useEffect(() => {
    if (!self?.id || isSelf) { setBlocked(false); return; }
    isBlocked(self.id, id).then(setBlocked).catch(() => {});
  }, [self?.id, id, isSelf]);

  const handleBlockToggle = async () => {
    if (!self?.id || isSelf) return;
    try {
      if (blocked) {
        await unblockUser(self.id, id);
        setBlocked(false);
        Alert.alert('Débloqué', 'Cet utilisateur est débloqué.');
      } else {
        await blockUser(self.id, id);
        setBlocked(true);
        if (isFav) {
          await supabase.from('player_favorites').delete().eq('player_id', self.id).eq('favorite_id', id);
          setIsFav(false);
        }
        Alert.alert('Bloqué', 'Vous ne verrez plus les contenus de cet utilisateur.');
      }
    } catch {
      Alert.alert('Erreur', 'Action impossible. Réessaie.');
    }
  };

  const handleReportProfile = () => {
    if (!self?.id || isSelf) return;
    Alert.alert('Signaler ce profil', 'Confirmer le signalement de ce profil à la modération ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Signaler', style: 'destructive',
        onPress: async () => {
          try {
            await reportContent({ reporterId: self.id, targetType: 'player', targetId: id, reportedPlayerId: id });
            Alert.alert('Merci', 'Signalement envoyé à la modération.');
          } catch {
            Alert.alert('Erreur', "Le signalement n'a pas pu être envoyé.");
          }
        },
      },
    ]);
  };

  const openModerationMenu = () => {
    Alert.alert('Modération', undefined, [
      { text: blocked ? 'Débloquer' : 'Bloquer', style: blocked ? 'default' : 'destructive', onPress: handleBlockToggle },
      { text: 'Signaler ce profil', onPress: handleReportProfile },
      { text: 'Annuler', style: 'cancel' },
    ]);
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

  // Compte supprimé : on n'ouvre pas un profil cassé (couvre tous les chemins de
  // navigation qui pointeraient vers un id supprimé : historique, défis, etc.).
  if (isDeleted(profile)) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
        <Text style={{ fontSize: 40, marginBottom: 10 }}>👤</Text>
        <Text style={{ fontSize: 16, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, textAlign: 'center' }}>
          Ce compte a été supprimé
        </Text>
        <Text style={{ fontSize: 13, color: Colors.textMuted, textAlign: 'center', marginTop: 6 }}>
          Ce joueur n’est plus sur l’app. Ses anciens matchs restent visibles dans ton historique.
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ marginTop: 20, paddingHorizontal: 22, paddingVertical: 11, borderRadius: 12, backgroundColor: Colors.primary }}
        >
          <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>Retour</Text>
        </TouchableOpacity>
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
  const lvlToNext  = nextLvl ? Math.max(0.01, nextLvl - curLevel) : 0;

  // Fiability
  const fib      = profile.fiability_pct ?? 50;
  const fibLabel = fib >= 85 ? 'EXCELLENT' : fib >= 75 ? 'FIABLE' : fib >= 50 ? 'MOYEN' : 'FAIBLE';
  const fibColor = fib >= 75 ? Colors.success : fib >= 50 ? Colors.primary : Colors.danger;

  // Best partner & nemesis — agrégés par id de joueur, comptes supprimés exclus
  // (sinon tous les supprimés tomberaient dans un même bucket « Compte supprimé »).
  const partnerWins: Record<string, { name: string; n: number }>  = {};
  const opponentLoss: Record<string, { name: string; n: number }> = {};
  const tally = (acc: Record<string, { name: string; n: number }>, pid: string | null, p: JoinedPlayer | null) => {
    if (!pid || !p || isDeleted(p) || !p.name) return;
    const cur = acc[pid] ?? { name: p.name, n: 0 };
    cur.n += 1;
    acc[pid] = cur;
  };
  for (const m of matches) {
    const isW   = m.winner_id === id || m.winner_id_2 === id;
    const is2v2 = isDoubles(m);
    if (isW && is2v2) {
      if (m.winner_id === id) tally(partnerWins, m.winner_id_2, m.winner_2);
      else                    tally(partnerWins, m.winner_id,   m.winner);
    }
    if (!isW) {
      tally(opponentLoss, m.winner_id,   m.winner);
      tally(opponentLoss, m.winner_id_2, m.winner_2);
    }
  }
  const bestPartner  = Object.values(partnerWins).sort((a, b) => b.n - a.n)[0]?.name;
  const worstNemesis = Object.values(opponentLoss).sort((a, b) => b.n - a.n)[0]?.name;

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

  const handleDefier = () => {
    const sideParam = profile.court_side ? `&pside=${encodeURIComponent(profile.court_side)}` : '';
    router.push((`/(tabs)/lobby?create=1&challenge=1&with=${profile.id}&pname=${encodeURIComponent(profile.name)}&pelo=${profile.elo_score}${sideParam}`) as any);
  };

  // Ouvre le composer de story directement (mode Match) avec ce match pré-rempli.
  const shareMatch = (m: MatchRow) => {
    const d = eloChangeByMatch[m.id];
    setStoryMatch(buildStoryMatch(m, id as string, {
      eloDelta: d != null ? `${d >= 0 ? '+' : ''}${d.toFixed(2)}` : undefined,
    }));
    setComposerMode('match');
    setComposerLocked(true); // partage d'un score précis → verrouillé sur Match
    setComposerOpen(true);
  };

  // Préférences en lignes label/valeur (design épuré) — seules les valeurs présentes.
  const clubLabel = Array.isArray((profile as any).clubs) && (profile as any).clubs.length ? (profile as any).clubs.join(' · ') : null;
  const genderLabel = profile.gender === 'male' ? 'Homme' : profile.gender === 'female' ? 'Femme' : profile.gender === 'other' ? 'Autre' : null;
  const prefRows: [string, string][] = ([
    ['Sexe', genderLabel],
    ['Club', clubLabel],
    ['Côté de jeu', profile.court_side ? (COURT_SIDE_LABEL[profile.court_side] ?? profile.court_side) : null],
    ['Terrain', profile.preferred_court ?? null],
    ['Disponibilités', playingDays.length ? playingDays.join(' · ') : null],
    ['Partenaire favori', bestPartner ?? null],
    ['Bête noire', worstNemesis ?? null],
    ['Classement FRMT', (() => { const f = formatFrmtRanking(profile); return f ? `${f.text}${f.verified ? ' ✓' : ''}` : null; })()],
  ] as [string, string | null][]).filter((r): r is [string, string] => !!r[1]);

  // Historique : 3 par défaut, tout si recherche active ou « Voir tout ».
  const visibleMatches = (matchSearch.trim() || showAllMatches) ? filteredMatches : filteredMatches.slice(0, 3);

  // ── Données pour le composer de story (V2) ────────────────────────
  const storyPlayer: StoryPlayer = {
    name: profile.name,
    league,
    level: curLevel,
    rank: rankPos ?? 0,
    // Sur la story, on ne met le classement FRMT que si le joueur est réellement
    // LIÉ au scraper (vérifié + position connue) → le vrai rang (#position · pts),
    // jamais le bracket auto-déclaré (PXXX).
    frmtRank: (profile.frmt_verified && profile.frmt_position != null)
      ? formatFrmtRanking(profile)?.text ?? undefined
      : undefined,
    frmtVerified: profile.frmt_verified ?? undefined,
    fiability: fib,
    fiabilityLabel: fibLabel,
    wins, losses, winRate, streak,
    recentForm: recentForm as ('W' | 'L')[],
    club: clubLabel ?? undefined,
  };
  const storyInvite: InviteData = {
    cta: 'Rejoins-moi sur',
    link: SHARE_LABEL, // libellé de marque affiché sur la story (décoratif)
    appUrl: 'Télécharger l’app',
    // QR fonctionnel → fiche joueur de l'app web (route /player/[id]).
    // Passe par SHARE_BASE (centralisé) → bascule domaine = 1 ligne dans community.ts.
    qrValue: playerStoryLink(profile.id),
    showApp: true, showQR: true,
  };

  // ── Adaptateurs : données réelles → formes de la maquette ─────────
  const matchById = new Map(matches.map(m => [m.id, m]));
  const mapMatch = (m: MatchRow): MatchView => {
    const win = m.winner_id === id || m.winner_id_2 === id;
    const is2 = isDoubles(m);
    const winners = [{ pid: m.winner_id, p: m.winner }, { pid: m.winner_id_2, p: m.winner_2 }].filter(x => x.pid);
    const losers  = [{ pid: m.loser_id,  p: m.loser  }, { pid: m.loser_id_2,  p: m.loser_2  }].filter(x => x.pid);
    const mine = win ? winners : losers;
    const opp  = win ? losers  : winners;
    const meEntry = mine.find(x => x.pid === id);
    const partnerEntry = mine.find(x => x.pid !== id);
    const lvlOf = (p: JoinedPlayer | null | undefined) => (p?.elo_score != null ? eloToLevel(p.elo_score) : undefined);
    const myTeam: PlayerLite[] = [
      { name: meEntry?.p?.name ?? profile.name, lvl: lvlOf(meEntry?.p) ?? curLevel, me: true },
      ...(is2 && partnerEntry ? [{ name: displayName(partnerEntry.p, 'partner'), lvl: lvlOf(partnerEntry.p) }] : []),
    ];
    const oppTeam: PlayerLite[] = opp.map(x => ({ name: displayName(x.p, 'opponent'), lvl: lvlOf(x.p) }));
    const sets = parseSets(m.score_text).map(([w, l]) => (win ? [w, l] : [l, w]) as [number, number]);
    const dt = new Date(m.game?.match_date ?? m.created_at);
    const dateStr = dt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const time = dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
    return {
      id: m.id,
      club: m.game?.location ?? 'Match',
      date: dateStr.charAt(0).toUpperCase() + dateStr.slice(1),
      time,
      result: win ? 'Victoire' : 'Défaite',
      delta: eloChangeByMatch[m.id] ?? 0,
      teams: [myTeam, oppTeam],
      sets,
      winnerRow: win ? 0 : 1,
    };
  };
  const matchViews: MatchView[] = matches.map(mapMatch);
  const lastMatchView = matchViews[0] ?? null;
  const timeline: TimelinePoint[] = eloHistory
    .filter(h => h.match_id && matchById.has(h.match_id))
    .map(h => {
      const m = matchById.get(h.match_id as string) as MatchRow;
      const win = m.winner_id === id || m.winner_id_2 === id;
      return { lvl: eloToLevel(h.elo_score), result: (win ? 'Victoire' : 'Défaite') as 'Victoire' | 'Défaite', match: mapMatch(m) };
    });
  const formVD = recentForm.map(r => (r === 'W' ? 'V' : 'D')) as ('V' | 'D')[];
  const repMap = new Map<string, { emoji: string; label: string; n: number }>();
  for (const [key, n] of Object.entries(karmaCounts)) {
    const info = BADGES_INFO[key];
    if (!info) continue;
    const cur = repMap.get(info.label) ?? { emoji: info.icon, label: info.label, n: 0 };
    cur.n += n; repMap.set(info.label, cur);
  }
  const repBadges = [...repMap.values()];
  const nowMs = Date.now();
  const recentHist = eloHistory.filter(h => nowMs - new Date(h.created_at).getTime() <= 30 * 86400000);
  const delta30 = recentHist.length
    ? eloToLevel(eloHistory[eloHistory.length - 1].elo_score) - eloToLevel(recentHist[0].elo_score - recentHist[0].elo_change)
    : null;
  const onShareMatchView = (mv: MatchView) => { const m = mv.id ? matchById.get(mv.id) : null; if (m) shareMatch(m); };

  // Footer d'une carte de match — branché sur l'événement d'activité du match :
  //  • Vamos 🔥  → réaction (pas sur ses propres matchs, comme dans la Communauté)
  //  • Commenter → fil de commentaires de l'événement
  //  • Partager  → uniquement sur SON profil (on ne partage pas le match d'un autre)
  const eventByMatch = new Map(activity.filter(e => e.match_id).map(e => [e.match_id as string, e]));
  const renderMatchFooter = (mv: MatchView): ReactNode => {
    const ev = mv.id ? eventByMatch.get(mv.id) : undefined;
    const myId = self?.id ?? '';
    const fireArr = ev?.reactions?.['🔥'] ?? [];
    const reacted = !!myId && fireArr.includes(myId);
    const btns: ReactNode[] = [];
    if (ev && !isSelf) {
      btns.push(<MatchActionButton key="vamos" icon="🔥" label="Vamos" active={reacted} count={fireArr.length} onPress={() => reactToActivity(ev.id)} />);
    }
    if (ev) {
      btns.push(<MatchActionButton key="comment" icon="💬" label="Commenter" count={ev.comment_count} onPress={() => router.push(`/community/comments/${ev.id}` as any)} />);
    }
    if (isSelf) {
      btns.push(<MatchActionButton key="share" icon="↗" label="Partager" onPress={() => onShareMatchView(mv)} />);
    }
    if (btns.length === 0) return null;
    return <View style={{ flexDirection: 'row', gap: 7, borderTopWidth: 1, borderTopColor: PM.divider, paddingTop: 10 }}>{btns}</View>;
  };

  return (
    <View style={{ flex: 1, backgroundColor: LIGHT.page }}>
    {/* ── Header sombre + onglets (refonte « Profil PagMatch ») ── */}
    <ScrollView
      style={{ flex: 1, backgroundColor: PM.ink }}
      contentContainerStyle={{ paddingBottom: isSelf ? 40 : insets.bottom + 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
    >
      <ProfileHeader
        name={profile.name}
        level={curLevel}
        leagueLabel={getLeagueLabel(league)}
        leagueColor={leagueColor}
        followers={followerCount}
        following={followingCount}
        isSelf={isSelf}
        isFollowing={isFollowing}
        onToggleFollow={toggleFollow}
        onBack={() => router.back()}
        onMenu={openModerationMenu}
        onEdit={openEdit}
        onShareProfile={() => { setComposerMode('profil'); setComposerLocked(false); setComposerOpen(true); }}
        onDefier={handleDefier}
        tab={tab}
        setTab={setTab}
        topInset={insets.top}
      />
      <View style={{ backgroundColor: PM.page, borderTopLeftRadius: 20, borderTopRightRadius: 20, marginTop: -2, paddingHorizontal: 14, paddingTop: 18, paddingBottom: 40, minHeight: 420 }}>
        {tab === 'Stats' && (
          <StatsTab
            curLevel={curLevel} delta30={delta30} timeline={timeline}
            winRate={winRate} played={totalM} wins={wins} losses={losses}
            streak={streak} form={formVD} lastMatch={lastMatchView} renderFooter={renderMatchFooter}
          />
        )}
        {tab === 'Matchs' && <MatchsTab matches={matchViews} renderFooter={renderMatchFooter} />}
        {tab === 'Palmarès' && <PalmaresTab achievements={achievements} />}
        {tab === 'Badges' && <BadgesTab badges={repBadges} />}
        {tab === 'Activité' && (() => {
          // Activité = badges reçus + palmarès débloqués (pas les matchs).
          const feedEvents = activity.filter(e => e.type !== 'match_win' && e.type !== 'match_loss');
          const unlocked = achievements.filter(a => a.unlocked || a.progress >= a.target);
          if (feedEvents.length === 0 && unlocked.length === 0) {
            return <Text style={{ fontSize: 12, color: PM.muted, textAlign: 'center', paddingVertical: 24 }}>Aucun badge ni palmarès débloqué pour l'instant.</Text>;
          }
          return (
            <View style={{ gap: 14 }}>
              {unlocked.map(a => <AchievementFeedCard key={a.key} ach={a} />)}
              {feedEvents.map(e => (
                <ActivityCard
                  key={e.id}
                  e={e}
                  myId={self?.id ?? ''}
                  onReact={isSelf ? undefined : () => reactToActivity(e.id)}
                  onPressComments={() => router.push(`/community/comments/${e.id}` as any)}
                  onReport={isSelf ? undefined : () => reportActivityEvent(e)}
                />
              ))}
            </View>
          );
        })()}
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
        <StoryComposerV2
          visible={composerOpen}
          player={storyPlayer}
          match={storyMatch}
          invite={storyInvite}
          initialMode={composerMode}
          lockMode={composerLocked}
          onClose={() => setComposerOpen(false)}
          onRequestMatch={() => setStoryPickerOpen(true)}
        />
      </>
    )}
    </View>
  );
}
