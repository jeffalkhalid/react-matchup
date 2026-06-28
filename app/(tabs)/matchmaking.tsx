import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, StyleSheet, Image, Alert,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';
import { usePlayer } from '../../hooks/usePlayer';
import { useNotificationCount } from '../../hooks/useNotificationCount';
import { supabase } from '../../lib/supabase';
import { notifyPlayers } from '../../lib/notify';
import { getHiddenPlayerIds } from '../../lib/moderation';
import { Colors, eloToLevel, Fonts } from '../../lib/theme';
import { isCreatorConflict } from '../../lib/games';
import { isReceivedChallengeVisible } from '../../lib/challenges';
import type { Player, Challenge } from '../../types';
import { Pill, type PillVariant, pillAccent } from '../../components/Pill';
import { HeaderActions } from '../../components/HeaderActions';
import { Icon, type IconName } from '../../components/community/icons';
import { GameCard } from './lobby';
import {
  fetchOpenDefis, fetchMyDefis, fetchCandidaturesOnMyDefis, fetchBinomeInvitations,
  acceptBinomeInvitation, applyToDefi,
  type DefiGame, type DefiApplication,
} from '../../lib/defis';

// ── Types ─────────────────────────────────────────────────────
type Tab = 'relever' | 'mes' | 'candidatures' | 'invitations';
type SortMode = 'compat' | 'elo';

interface CompatDetail {
  score: number;
  eloScore: number; eloGap: number;
  clubScore: number; sharedClubs: string[];
  dayScore: number; sharedDays: string[];
  sideScore: number; sideMatch: string;
}

// ── Helpers ───────────────────────────────────────────────────
function compatTier(score: number): { label: string; color: string; bg: string; border: string; variant: PillVariant } {
  if (score >= 80) return { label: 'Match parfait',   color: '#047857',           bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.45)', variant: 'success' };
  if (score >= 60) return { label: 'Très compatible', color: Colors.brandDeep,    bg: 'rgba(255,193,26,0.14)', border: 'rgba(255,193,26,0.55)', variant: 'brand'   };
  if (score >= 40) return { label: 'Compatible',      color: '#B45309',           bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.50)', variant: 'warning' };
  return             { label: 'Passable',           color: Colors.textSecondary, bg: Colors.bgCardAlt,        border: Colors.border,            variant: 'neutral' };
}

function leagueColors(elo: number) {
  // Couleurs de ligues conservées (palette officielle) : diamond/gold/silver/bronze/discovery.
  if (elo >= 1800) return { label: 'Diamant',    color: '#67E8F9', bg: 'rgba(103,232,249,0.12)', border: 'rgba(103,232,249,0.45)' };
  if (elo >= 1500) return { label: 'Or',         color: '#FBBF24', bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.45)'  };
  if (elo >= 1200) return { label: 'Argent',     color: '#9CA3AF', bg: 'rgba(156,163,175,0.12)', border: 'rgba(156,163,175,0.45)' };
  if (elo >= 1000) return { label: 'Bronze',     color: '#F97316', bg: 'rgba(249,115,22,0.12)',  border: 'rgba(249,115,22,0.45)'  };
  return             { label: 'Découverte',    color: '#34D399', bg: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.45)'  };
}

// League pill (couleurs ligues officielles, gardées intactes — pas via le composant Pill partagé).
function LeaguePill({ elo }: { elo: number }) {
  const l = leagueColors(elo);
  return (
    <View style={{ backgroundColor: l.bg, borderWidth: 1, borderColor: l.border, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 }}>
      <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, color: l.color, letterSpacing: 0.4, textTransform: 'uppercase' }}>{l.label}</Text>
    </View>
  );
}

// Exact port of web compatibility.ts
const DAYS_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

function scoreElo(eloA: number, eloB: number): number {
  const gap = Math.abs(eloA - eloB);
  if (gap <= 75)  return 40;
  if (gap <= 150) return 32;
  if (gap <= 250) return 20;
  if (gap <= 400) return 10;
  return 0;
}

async function getPlayerGameData(playerId: string): Promise<{ clubs: Map<string, number>; days: Set<number> }> {
  const { data: parts } = await supabase
    .from('game_participants')
    .select('game_id')
    .eq('player_id', playerId);
  const gameIds = (parts ?? []).map((p: any) => p.game_id as string).filter(Boolean);
  if (gameIds.length === 0) return { clubs: new Map(), days: new Set() };

  const { data: games } = await supabase
    .from('open_games')
    .select('location, match_date')
    .in('id', gameIds)
    .neq('status', 'cancelled');

  const clubs = new Map<string, number>();
  const days = new Set<number>();
  for (const row of games ?? []) {
    if (row.location) clubs.set(row.location, (clubs.get(row.location) ?? 0) + 1);
    if (row.match_date) days.add(new Date(row.match_date).getDay());
  }
  return { clubs, days };
}

function scoreClubs(a: Map<string, number>, b: Map<string, number>): { score: number; shared: string[] } {
  const shared: string[] = [];
  for (const club of a.keys()) { if (b.has(club)) shared.push(club); }
  if (shared.length === 0) return { score: 0, shared: [] };
  return { score: shared.length >= 2 ? 30 : 20, shared };
}

function scoreDays(a: Set<number>, b: Set<number>): { score: number; shared: string[] } {
  const nums = [...a].filter(d => b.has(d));
  const shared = nums.map(d => DAYS_FR[d]);
  if (shared.length === 0) return { score: 0, shared: [] };
  return { score: shared.length >= 2 ? 20 : 12, shared };
}

function scoreSide(sideA: string | null | undefined, sideB: string | null | undefined): { score: number; sideMatch: string } {
  // Handle both 'left'/'right'/'both' (RN) and 'Gauche'/'Droit'/'Mixte' (web) values
  const norm = (s: string | null | undefined) => {
    if (!s) return 'mixte';
    if (s === 'left'  || s === 'Gauche') return 'gauche';
    if (s === 'right' || s === 'Droit')  return 'droit';
    return 'mixte';
  };
  const a = norm(sideA), b = norm(sideB);
  if (a === 'mixte' || b === 'mixte') return { score: 5,  sideMatch: 'flexible' };
  if ((a === 'gauche' && b === 'droit') || (a === 'droit' && b === 'gauche'))
    return { score: 10, sideMatch: 'complémentaires' };
  return { score: 2, sideMatch: 'même côté' };
}

async function computeCompatDetail(
  meId: string, myElo: number, mySide: string | null | undefined,
  myData: { clubs: Map<string, number>; days: Set<number> },
  otherId: string, otherElo: number, otherSide: string | null | undefined,
): Promise<CompatDetail> {
  const otherData = await getPlayerGameData(otherId);
  const eloGap   = Math.abs(myElo - otherElo);
  const eloScore = scoreElo(myElo, otherElo);
  const { score: clubScore, shared: sharedClubs } = scoreClubs(myData.clubs, otherData.clubs);
  const { score: dayScore,  shared: sharedDays  } = scoreDays(myData.days, otherData.days);
  const { score: sideScore, sideMatch            } = scoreSide(mySide, otherSide);
  return { score: eloScore + clubScore + dayScore + sideScore, eloScore, eloGap, clubScore, sharedClubs, dayScore, sharedDays, sideScore, sideMatch };
}

// ── Avatar ────────────────────────────────────────────────────
const AV_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#84cc16', '#ec4899', '#8b5cf6'];
function hashColor(name: string) {
  return AV_COLORS[(name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % AV_COLORS.length];
}
function PlayerAvatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: Math.round(size * 0.36), backgroundColor: hashColor(name), alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: Colors.textOnDark, fontSize: Math.round(size * 0.38), fontWeight: '900' }}>
        {(name || '?').charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

// ── Compat ring (SVG arc) ─────────────────────────────────────
function CompatRing({ score, size = 54, strokeWidth = 5 }: { score: number; size?: number; strokeWidth?: number }) {
  const tier = compatTier(score);
  const r = (size - strokeWidth * 2) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  const cx = size / 2, cy = size / 2;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={cx} cy={cy} r={r} fill="none" stroke={Colors.border} strokeWidth={strokeWidth} />
      <Circle cx={cx} cy={cy} r={r} fill="none" stroke={tier.color} strokeWidth={strokeWidth}
        strokeDasharray={`${circ}`} strokeDashoffset={offset}
        strokeLinecap="round" transform={`rotate(-90, ${cx}, ${cy})`} />
      <SvgText x={cx} y={cy + Math.round(size * 0.12)} textAnchor="middle"
        fontSize={Math.round(size * 0.22)} fontWeight="900" fill={tier.color}>
        {score}
      </SvgText>
    </Svg>
  );
}

// ── Compat breakdown bars ─────────────────────────────────────
function CompatBreakdown({ detail }: { detail: CompatDetail }) {
  const tier = compatTier(detail.score);
  const bars = [
    { label: 'Niveau ELO', value: detail.eloScore, max: 40, info: `±${detail.eloGap} pts` },
    { label: 'Clubs',      value: detail.clubScore, max: 30, info: detail.sharedClubs.length ? detail.sharedClubs.slice(0, 2).join(', ') : 'Aucun commun' },
    { label: 'Jours',      value: detail.dayScore,  max: 20, info: detail.sharedDays.length  ? detail.sharedDays.join(', ')               : 'Aucun commun' },
    { label: 'Côté',       value: detail.sideScore, max: 10, info: detail.sideMatch },
  ];
  return (
    <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: Colors.bgCardAlt, gap: 8 }}>
      {bars.map(b => (
        <View key={b.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
              <Text style={{ fontSize: 9, fontWeight: '900', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6 }}>{b.label}</Text>
              <Text style={{ fontSize: 9, color: Colors.textMuted, fontWeight: '600' }} numberOfLines={1}>{b.info}</Text>
            </View>
            <View style={{ height: 4, backgroundColor: Colors.bgCardAlt, borderRadius: 2, overflow: 'hidden', flexDirection: 'row' }}>
              <View style={{ flex: b.value, height: 4, backgroundColor: tier.color }} />
              <View style={{ flex: Math.max(0, b.max - b.value) }} />
            </View>
          </View>
          <Text style={{ fontSize: 10, fontWeight: '900', color: tier.color, width: 24, textAlign: 'right' }}>{b.value}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Sort toggle ───────────────────────────────────────────────
function SortToggle({ mode, onChange, computing }: { mode: SortMode; onChange: (m: SortMode) => void; computing: boolean }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: Colors.bgCardAlt, borderRadius: 12, padding: 3, gap: 2, marginBottom: 14 }}>
      {([
        { val: 'compat' as SortMode, label: 'Compatibilité', icon: 'zap' as IconName },
        { val: 'elo'    as SortMode, label: 'Niveau',        icon: 'trendingUp' as IconName },
      ]).map(t => {
        const active = mode === t.val;
        const disabled = t.val === 'compat' && computing;
        const tint = active ? Colors.brandDeep : Colors.textMuted;
        return (
          <TouchableOpacity key={t.val} onPress={() => onChange(t.val)} disabled={disabled} activeOpacity={0.75}
            style={{
              flex: 1, paddingVertical: 7, borderRadius: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
              backgroundColor: active ? Colors.bgCard : 'transparent',
              borderWidth: active ? 1 : 0, borderColor: active ? Colors.brand : 'transparent',
              opacity: disabled ? 0.6 : 1,
              shadowColor: Colors.textPrimary, shadowOpacity: active ? 0.1 : 0,
              shadowRadius: active ? 4 : 0, shadowOffset: { width: 0, height: 2 }, elevation: active ? 2 : 0,
            }}>
            <Icon name={t.icon} size={13} color={tint} stroke={2.2} />
            <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, fontWeight: '900', color: tint }}>
              {disabled ? '…' : t.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Empty state ───────────────────────────────────────────────
function EmptyCard({ icon, title, sub }: { icon: IconName; title: string; sub: string }) {
  return (
    <View style={{ backgroundColor: Colors.bgCard, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, padding: 40, alignItems: 'center' }}>
      <View style={{ marginBottom: 10 }}>
        <Icon name={icon} size={40} color={Colors.textMuted} stroke={1.8} />
      </View>
      <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary, marginBottom: 4, textAlign: 'center' }}>{title}</Text>
      <Text style={{ fontSize: 12, color: Colors.textMuted, fontWeight: '600', textAlign: 'center' }}>{sub}</Text>
    </View>
  );
}

// ── 2v2 Défi card helpers ─────────────────────────────────────
function bandLabel(g: DefiGame): string {
  const lo = g.min_elo != null ? eloToLevel(g.min_elo).toFixed(1) : '?';
  const hi = g.max_elo != null ? eloToLevel(g.max_elo).toFixed(1) : '?';
  return `Moy. ${lo} → ${hi}`;
}

function DefiReleverCard({ game, myElo, onRelever }: { game: DefiGame; myElo: number; onRelever: () => void; }) {
  const teamA = (game.participants ?? []).filter(p => (p.team_side ?? '').startsWith('A') || p.player_id === game.creator_id);
  return (
    <View style={sty.card}>
      <View style={{ padding: 14, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <PlayerAvatar name={game.creator?.name ?? '?'} size={34} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>
              {game.creator?.name ?? '?'} & {teamA.find(p => p.player_id !== game.creator_id)?.player?.name ?? '—'}
            </Text>
            <Text style={{ fontSize: 10.5, color: Colors.textMuted }}>{bandLabel(game)}</Text>
          </View>
          <Pill variant="ink">⚡ ×{(game.stake_multiplier ?? 1).toFixed(1)}</Pill>
        </View>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {game.location ? <Pill variant="info">{game.location}</Pill> : null}
          {game.match_date ? <Pill variant="brand">{new Date(game.match_date).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</Pill> : null}
        </View>
        <TouchableOpacity onPress={onRelever} style={[sty.actionBtn, { backgroundColor: Colors.primary }]}>
          <Text style={{ color: Colors.textOnDark, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 13 }}>Relever — choisir mon binôme</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function MyDefiCard({ game }: { game: DefiGame }) {
  const label = game.status === 'draft' ? '⏳ Brouillon (partenaire pas encore OK)'
    : game.status === 'open' ? '🟢 Ouvert — en attente d\'un binôme'
    : '✅ Confirmé';
  return (
    <View style={sty.card}>
      <View style={{ padding: 14, gap: 6 }}>
        <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>{bandLabel(game)} · ⚡ ×{(game.stake_multiplier ?? 1).toFixed(1)}</Text>
        <Text style={{ fontSize: 11.5, color: Colors.textSecondary }}>{label}</Text>
        {game.location || game.match_date ? (
          <Text style={{ fontSize: 11, color: Colors.textMuted }}>
            {game.location ?? ''}{game.match_date ? ` · ${new Date(game.match_date).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function CandidatureCard({ app }: { app: DefiApplication }) {
  const locked = app.status === 'locked';
  return (
    <View style={sty.card}>
      <View style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <PlayerAvatar name={app.initiator?.name ?? '?'} size={32} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBold, fontWeight: '700', color: Colors.textPrimary }}>
            {app.initiator?.name ?? '?'} & {app.partner?.name ?? '?'}
          </Text>
          <Text style={{ fontSize: 10.5, color: Colors.textMuted }}>{locked ? '🏁 Binôme retenu' : '⏳ En attente du partenaire'}</Text>
        </View>
        <Pill variant={locked ? 'success' : 'neutral'}>{locked ? 'Retenu' : 'Pending'}</Pill>
      </View>
    </View>
  );
}

function BinomeInviteCard({ app, onAccept }: { app: DefiApplication; onAccept: () => void; }) {
  return (
    <View style={sty.card}>
      <View style={{ padding: 14, gap: 8 }}>
        <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBold, fontWeight: '700', color: Colors.textPrimary }}>
          {app.initiator?.name ?? '?'} t'invite comme binôme pour relever un défi
        </Text>
        {app.game ? <Text style={{ fontSize: 11, color: Colors.textMuted }}>{bandLabel(app.game)} · ⚡ ×{(app.game.stake_multiplier ?? 1).toFixed(1)}</Text> : null}
        <TouchableOpacity onPress={onAccept} style={[sty.actionBtn, { backgroundColor: Colors.brand }]}>
          <Text style={{ color: Colors.textOnBrand, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 13 }}>Accepter & verrouiller le binôme</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Suggestion card ───────────────────────────────────────────
function SuggestionCard({ player, detail, alreadyChallenged, onChallenge }: {
  player: Player; detail?: CompatDetail; alreadyChallenged: boolean;
  onChallenge: (p: Player) => void;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const score = detail?.score ?? 0;
  const tier = compatTier(score);
  const total = player.win_count + player.loss_count;
  const winRate = total > 0 ? Math.round(player.win_count / total * 100) : null;
  const isPerfect = score >= 80;
  const isGreat = score >= 60;
  const btnBg = isPerfect ? Colors.success : isGreat ? Colors.primary : Colors.primary;

  return (
    <View style={[sty.card, { borderColor: expanded ? tier.border : '#e2e8f0' },
      isPerfect && { shadowColor: tier.color, shadowOpacity: 0.2, shadowRadius: 14, elevation: 6 }]}>
      <View style={{ height: 3, backgroundColor: tier.color }} />
      <View style={{ padding: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ alignItems: 'center', gap: 3 }}>
            <CompatRing score={score} size={54} strokeWidth={5} />
            <Text style={{ fontSize: 7.5, fontWeight: '900', color: tier.color, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {tier.label}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <TouchableOpacity onPress={() => router.push(`/player/${player.id}` as any)} activeOpacity={0.7}>
                <PlayerAvatar name={player.name} size={36} />
              </TouchableOpacity>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }} numberOfLines={1}>{player.name}</Text>
                <Text style={{ fontSize: 10, color: Colors.textMuted, fontWeight: '600', marginTop: 1 }}>Niv. {eloToLevel(player.elo_score).toFixed(1)}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
              <LeaguePill elo={player.elo_score} />
              {winRate !== null && <Pill variant="neutral">{winRate}% W</Pill>}
              {detail?.sideMatch === 'complémentaires' && <Pill variant="success">↔ Comp.</Pill>}
            </View>
          </View>
          <View>
            {alreadyChallenged ? (
              <Pill variant="warning" icon={<Icon name="clock" size={11} color={pillAccent('warning')} stroke={2} />}>En attente</Pill>
            ) : (
              <TouchableOpacity onPress={() => onChallenge(player)}
                style={{ backgroundColor: btnBg, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 5 }}
                activeOpacity={0.8}>
                <Icon name="zap" size={12} color={Colors.textOnDark} stroke={2.2} />
                <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textOnDark, letterSpacing: 0.3 }}>Défier</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {((detail?.sharedClubs.length ?? 0) > 0 || (detail?.sharedDays.length ?? 0) > 0) && (
          <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.bgCardAlt }}>
            {detail?.sharedClubs.slice(0, 2).map(c => <Pill key={c} variant="neutral" icon={<Icon name="mapPin" size={11} color={pillAccent('neutral')} stroke={2} />}>{c}</Pill>)}
            {detail?.sharedDays.slice(0, 2).map(d => <Pill key={d} variant="neutral" icon={<Icon name="calendar" size={11} color={pillAccent('neutral')} stroke={2} />}>{d}</Pill>)}
          </View>
        )}

        {detail && (
          <TouchableOpacity onPress={() => setExpanded(e => !e)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 }} activeOpacity={0.7}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: expanded ? tier.color : '#94a3b8' }}>
              {expanded ? '▲ Masquer la compatibilité' : '▾ Voir la compatibilité détaillée'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
      {detail && expanded && <CompatBreakdown detail={detail} />}
    </View>
  );
}

// ── Incoming challenge card ────────────────────────────────────
function IncomingCard({ challenge, detail, onAction, playerId, myElo }: {
  challenge: Challenge; detail?: CompatDetail;
  onAction: (id: string, action: 'accepted' | 'declined') => Promise<void>;
  playerId: string; myElo: number;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const challenger = challenge.challenger as Player | undefined;
  const isPending = challenge.status === 'pending';
  const score = detail?.score ?? challenge.compat_score ?? 0;
  const tier = compatTier(score);

  const diff = challenge.expires_at ? new Date(challenge.expires_at).getTime() - Date.now() : 0;
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const timeLeft = diff <= 0 ? 'Expiré' : days > 0 ? `${days}j restants` : `${hours}h restants`;

  const statusInfo: Record<string, { label: string; variant: PillVariant }> = {
    pending:  { label: 'En attente', variant: 'warning' },
    accepted: { label: 'Accepté',    variant: 'success' },
    declined: { label: 'Refusé',     variant: 'danger'  },
    expired:  { label: 'Expiré',     variant: 'neutral' },
    played:   { label: 'Joué',       variant: 'ink'     },
  };
  const st = statusInfo[challenge.status] ?? statusInfo.pending;

  // Partie liée au défi, présentée avec la MÊME carte que l'onglet « À venir »
  // (slots des 4 joueurs, niveaux, boutons Relever/Refuser intégrés).
  const game = (challenge as any).game;
  const gameForCard = game
    ? { ...game, my_status: game.my_status ?? 'invited', is_creator: false }
    : null;

  return (
    <View style={[sty.card, { borderColor: isPending ? tier.border : '#e2e8f0' },
      isPending && { shadowColor: tier.color, shadowOpacity: 0.15, shadowRadius: 10, elevation: 4 }]}>
      <View style={{ height: 3, backgroundColor: isPending ? tier.color : '#e2e8f0' }} />
      <View style={{ padding: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ alignItems: 'center', gap: 3 }}>
            <CompatRing score={score} size={54} strokeWidth={5} />
            <Text style={{ fontSize: 7.5, fontWeight: '900', color: tier.color, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {tier.label}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <TouchableOpacity onPress={() => challenger?.id && router.push(`/player/${challenger.id}` as any)} activeOpacity={0.7} disabled={!challenger?.id}>
                <PlayerAvatar name={challenger?.name ?? '?'} size={36} />
              </TouchableOpacity>
              <View>
                <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>{challenger?.name ?? '?'}</Text>
                <Text style={{ fontSize: 10, color: Colors.textMuted, fontWeight: '600' }}>Niv. {eloToLevel(challenger?.elo_score ?? 0).toFixed(1)}</Text>
              </View>
            </View>
            {challenge.message ? (
              <View style={{ backgroundColor: Colors.bg, borderRadius: 10, padding: 8, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: tier.color }}>
                <Text style={{ fontSize: 11.5, color: Colors.textSecondary, fontStyle: 'italic' }}>"{challenge.message}"</Text>
              </View>
            ) : null}
            {((challenge.shared_clubs?.length ?? 0) > 0 || (challenge.shared_days?.length ?? 0) > 0) && (
              <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
                {challenge.shared_clubs?.slice(0, 2).map(c => <Pill key={c} variant="info" icon={<Icon name="mapPin" size={11} color={pillAccent('info')} stroke={2} />}>{c}</Pill>)}
                {challenge.shared_days?.slice(0, 2).map(d => <Pill key={d} variant="brand" icon={<Icon name="calendar" size={11} color={pillAccent('brand')} stroke={2} />}>{d}</Pill>)}
              </View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Pill variant={st.variant}>{st.label}</Pill>
              {isPending && <Text style={{ fontSize: 9, color: Colors.textMuted, fontWeight: '600' }}>⏰ {timeLeft}</Text>}
            </View>
          </View>
        </View>
        {detail && (
          <TouchableOpacity onPress={() => setExpanded(e => !e)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 }} activeOpacity={0.7}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: expanded ? tier.color : '#94a3b8' }}>
              {expanded ? '▲ Masquer le détail' : '▾ Voir le détail de compatibilité'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
      {detail && expanded && <CompatBreakdown detail={detail} />}
      {gameForCard && (
        <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
          <GameCard
            game={gameForCard as any}
            variant="upcoming"
            myElo={myElo}
            playerId={playerId}
            hideActions
            onPress={() => {}}
            onAcceptInvitation={() => onAction(challenge.id, 'accepted')}
            onDeclineInvitation={() => onAction(challenge.id, 'declined')}
          />
        </View>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────
export default function MatchmakingScreen() {
  const { player } = usePlayer();
  const { reload: reloadNotifs } = useNotificationCount();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>('relever');
  const [openDefis, setOpenDefis] = useState<DefiGame[]>([]);
  const [myDefis, setMyDefis] = useState<DefiGame[]>([]);
  const [candidatures, setCandidatures] = useState<DefiApplication[]>([]);
  const [binomeInvites, setBinomeInvites] = useState<DefiApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const fetchData = useCallback(async () => {
    if (!player) return;
    setLoading(true);
    const [open, mine, cands, invites] = await Promise.all([
      fetchOpenDefis(player.id),
      fetchMyDefis(player.id),
      fetchCandidaturesOnMyDefis(player.id),
      fetchBinomeInvitations(player.id),
    ]);
    setOpenDefis(open);
    setMyDefis(mine);
    setCandidatures(cands);
    setBinomeInvites(invites);
    setLoading(false);
  }, [player]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));
  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const handleRelever = (_game: DefiGame) => {
    // Phase 3b : ouvrir un vrai sélecteur de partenaire (recherche + suggestions compat).
    // Phase 3a : on signale juste que l'action arrive.
    showToast('Choix du partenaire — bientôt (Phase 3b)');
  };

  const handleAcceptBinome = async (app: DefiApplication) => {
    try {
      const res = await acceptBinomeInvitation(app.id);
      showToast(res === 'locked' ? '✅ Binôme verrouillé — défi confirmé !' : '⏳ Trop tard : un autre binôme a pris la place');
      fetchData();
      reloadNotifs();
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? 'Action impossible.');
    }
  };

  const pendingCount = binomeInvites.length + candidatures.filter(c => c.status === 'pending').length;

  if (!player) return null;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {/* Pastille Profil — alignée avec le logo (cohérent avec accueil/lobby/classement). */}
      <HeaderActions top={insets.top + 6} right={14} tint="light" />
      {/* Dark header */}
      <View style={{
        backgroundColor: Colors.heroBg,
        paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 16,
        borderBottomLeftRadius: 32, borderBottomRightRadius: 32,
      }}>
        {/* Brand lockup — raquette + wordmark PAGMATCH */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
          <Image
            source={require('../../assets/auth/splash-racket.png')}
            style={{ width: 22, height: 22 }}
            resizeMode="contain"
          />
          <Image
            source={require('../../assets/auth/splash-wordmark.png')}
            style={{ width: 100, height: 22, marginLeft: -7 }}
            resizeMode="contain"
          />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
          <View style={{ flex: 1 }} />
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontSize: 28, fontFamily: Fonts.welcome, color: Colors.textOnDark, letterSpacing: 0.2, textAlign: 'center' }}>
              Les <Text style={{ color: Colors.brand }}>Défis</Text>
            </Text>
            <Text style={{ fontSize: 12, fontFamily: Fonts.uiSemi, fontWeight: '600', color: Colors.textSecondary, marginTop: 2, textAlign: 'center' }}>Défis & joueurs compatibles</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            {pendingCount > 0 && (
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.brand, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.brandDeep }}>{pendingCount}</Text>
              </View>
            )}
          </View>
        </View>
        <View style={{ flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 18, padding: 4, gap: 3 }}>
          {([
            { id: 'relever'      as Tab, label: 'À relever',  badge: 0 },
            { id: 'mes'          as Tab, label: 'Mes défis',  badge: 0 },
            { id: 'candidatures' as Tab, label: 'Candidat.',  badge: candidatures.filter(c => c.status === 'pending').length },
            { id: 'invitations'  as Tab, label: 'Binôme',     badge: binomeInvites.length },
          ]).map(t => {
            const active = tab === t.id;
            return (
              <TouchableOpacity key={t.id} onPress={() => setTab(t.id)} activeOpacity={0.7}
                style={{
                  flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
                  backgroundColor: active ? '#fff' : 'transparent', borderRadius: 14, paddingVertical: 9,
                }}>
                <Text style={{ color: active ? Colors.textPrimary : 'rgba(255,255,255,0.55)', fontSize: 11, fontFamily: Fonts.uiBlack, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                  {t.label}
                </Text>
                {t.badge > 0 && (
                  <View style={{ backgroundColor: active ? Colors.brand : 'rgba(255,255,255,0.2)', borderRadius: 999, paddingHorizontal: 5, paddingVertical: 1 }}>
                    <Text style={{ color: active ? Colors.brandDeep : Colors.textOnDark, fontSize: 9, fontFamily: Fonts.uiBlack, fontWeight: '900' }}>{t.badge}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ flex: 1 }} />
      ) : (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}>
          <View style={{ padding: 14, paddingBottom: 100 }}>
            {tab === 'relever' && (
              openDefis.length === 0
                ? <EmptyCard icon="swords" title="Aucun défi à relever" sub="Reviens plus tard, ou lance le tien." />
                : <View style={{ gap: 10 }}>
                    {openDefis.map(g => (
                      <DefiReleverCard key={g.id} game={g} myElo={player.elo_score}
                        onRelever={() => handleRelever(g)} />
                    ))}
                  </View>
            )}
            {tab === 'mes' && (
              myDefis.length === 0
                ? <EmptyCard icon="swords" title="Aucun défi créé" sub="Lance un défi depuis le bouton Créer." />
                : <View style={{ gap: 10 }}>
                    {myDefis.map(g => <MyDefiCard key={g.id} game={g} />)}
                  </View>
            )}
            {tab === 'candidatures' && (
              candidatures.length === 0
                ? <EmptyCard icon="users" title="Aucune candidature" sub="Les binômes qui relèvent tes défis apparaîtront ici." />
                : <View style={{ gap: 10 }}>
                    {candidatures.map(c => <CandidatureCard key={c.id} app={c} />)}
                  </View>
            )}
            {tab === 'invitations' && (
              binomeInvites.length === 0
                ? <EmptyCard icon="users" title="Aucune invitation" sub="Quand un joueur t'invite comme binôme pour relever un défi, c'est ici." />
                : <View style={{ gap: 10 }}>
                    {binomeInvites.map(c => <BinomeInviteCard key={c.id} app={c} onAccept={() => handleAcceptBinome(c)} />)}
                  </View>
            )}
          </View>
        </ScrollView>
      )}

      {toast && (
        <View style={{
          position: 'absolute', bottom: insets.bottom + 80, alignSelf: 'center',
          backgroundColor: Colors.heroBg, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 10,
          shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
        }}>
          <Text style={{ fontSize: 13, fontFamily: Fonts.uiBold, fontWeight: '700', color: Colors.textOnDark }}>{toast}</Text>
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────
const sty = StyleSheet.create({
  card: {
    backgroundColor: Colors.bgCard, borderRadius: 18,
    borderWidth: 1.5, borderColor: Colors.border, overflow: 'hidden',
    shadowColor: Colors.textPrimary, shadowOpacity: 0.04, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  actionBtn: {
    borderRadius: 13, padding: 12, alignItems: 'center',
  },
});
