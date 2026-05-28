import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';
import { usePlayer } from '../../hooks/usePlayer';
import { supabase } from '../../lib/supabase';
import { Colors, eloToLevel } from '../../lib/theme';
import type { Player, Challenge } from '../../types';

// ── Types ─────────────────────────────────────────────────────
type Tab = 'suggestions' | 'defis';
type SortMode = 'compat' | 'elo';

interface CompatDetail {
  score: number;
  eloScore: number; eloGap: number;
  clubScore: number; sharedClubs: string[];
  dayScore: number; sharedDays: string[];
  sideScore: number; sideMatch: string;
}

// ── Helpers ───────────────────────────────────────────────────
function compatTier(score: number) {
  if (score >= 80) return { label: 'Match parfait',   color: '#059669', bg: '#ecfdf5', border: '#6ee7b7' };
  if (score >= 60) return { label: 'Très compatible', color: '#4f46e5', bg: '#eef2ff', border: '#c7d2fe' };
  if (score >= 40) return { label: 'Compatible',      color: '#d97706', bg: '#fffbeb', border: '#fde68a' };
  return             { label: 'Passable',            color: '#94a3b8', bg: '#f8fafc', border: '#e2e8f0' };
}

function leagueColors(elo: number) {
  if (elo >= 1800) return { label: 'Diamant',    color: '#06b6d4', bg: '#ecfeff', border: '#a5f3fc' };
  if (elo >= 1500) return { label: 'Or',         color: '#d97706', bg: '#fffbeb', border: '#fde68a' };
  if (elo >= 1200) return { label: 'Argent',     color: '#64748b', bg: '#f1f5f9', border: '#cbd5e1' };
  if (elo >= 1000) return { label: 'Bronze',     color: '#ea580c', bg: '#fff7ed', border: '#fed7aa' };
  return             { label: 'Découverte',    color: '#059669', bg: '#ecfdf5', border: '#6ee7b7' };
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
      <Text style={{ color: '#fff', fontSize: Math.round(size * 0.38), fontWeight: '900' }}>
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
      <Circle cx={cx} cy={cy} r={r} fill="none" stroke="#e2e8f0" strokeWidth={strokeWidth} />
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
    <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: '#f1f5f9', gap: 8 }}>
      {bars.map(b => (
        <View key={b.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
              <Text style={{ fontSize: 9, fontWeight: '900', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6 }}>{b.label}</Text>
              <Text style={{ fontSize: 9, color: '#94a3b8', fontWeight: '600' }} numberOfLines={1}>{b.info}</Text>
            </View>
            <View style={{ height: 4, backgroundColor: '#f1f5f9', borderRadius: 2, overflow: 'hidden', flexDirection: 'row' }}>
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
    <View style={{ flexDirection: 'row', backgroundColor: '#f1f5f9', borderRadius: 12, padding: 3, gap: 2, marginBottom: 14 }}>
      {([
        { val: 'compat' as SortMode, label: '⚡ Compatibilité' },
        { val: 'elo'    as SortMode, label: '📊 Niveau ELO'    },
      ]).map(t => {
        const active = mode === t.val;
        const disabled = t.val === 'compat' && computing;
        return (
          <TouchableOpacity key={t.val} onPress={() => onChange(t.val)} disabled={disabled} activeOpacity={0.75}
            style={{
              flex: 1, paddingVertical: 7, borderRadius: 9, alignItems: 'center',
              backgroundColor: active ? '#fff' : 'transparent',
              opacity: disabled ? 0.6 : 1,
              shadowColor: '#0f172a', shadowOpacity: active ? 0.1 : 0,
              shadowRadius: active ? 4 : 0, shadowOffset: { width: 0, height: 2 }, elevation: active ? 2 : 0,
            }}>
            <Text style={{ fontSize: 11, fontWeight: '900', color: active ? '#0f172a' : '#94a3b8' }}>
              {disabled ? '⏳ …' : t.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Pill ──────────────────────────────────────────────────────
function Pill({ bg, fg, border, children }: { bg: string; fg: string; border: string; children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: bg, borderWidth: 1, borderColor: border, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
      <Text style={{ fontSize: 9, fontWeight: '900', color: fg, letterSpacing: 0.3 }}>{children}</Text>
    </View>
  );
}

// ── Empty state ───────────────────────────────────────────────
function EmptyCard({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: '#e2e8f0', padding: 40, alignItems: 'center' }}>
      <Text style={{ fontSize: 36, marginBottom: 10 }}>{icon}</Text>
      <Text style={{ fontSize: 14, fontWeight: '900', color: '#0f172a', marginBottom: 4, textAlign: 'center' }}>{title}</Text>
      <Text style={{ fontSize: 12, color: '#94a3b8', fontWeight: '600', textAlign: 'center' }}>{sub}</Text>
    </View>
  );
}

// ── Suggestion card ───────────────────────────────────────────
function SuggestionCard({ player, detail, alreadyChallenged, onChallenge }: {
  player: Player; detail?: CompatDetail; alreadyChallenged: boolean;
  onChallenge: (p: Player) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const score = detail?.score ?? 0;
  const tier = compatTier(score);
  const league = leagueColors(player.elo_score);
  const total = player.win_count + player.loss_count;
  const winRate = total > 0 ? Math.round(player.win_count / total * 100) : null;
  const isPerfect = score >= 80;
  const isGreat = score >= 60;
  const btnBg = isPerfect ? '#059669' : isGreat ? '#4f46e5' : '#0f172a';

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
              <PlayerAvatar name={player.name} size={36} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 14, fontWeight: '900', color: '#0f172a' }} numberOfLines={1}>{player.name}</Text>
                <Text style={{ fontSize: 10, color: '#94a3b8', fontWeight: '600', marginTop: 1 }}>Niv. {eloToLevel(player.elo_score).toFixed(1)}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
              <Pill bg={league.bg} fg={league.color} border={league.border}>{league.label}</Pill>
              {winRate !== null && <Pill bg="#f8fafc" fg="#64748b" border="#e2e8f0">{winRate}% W</Pill>}
              {detail?.sideMatch === 'complémentaires' && <Pill bg="#ecfdf5" fg="#059669" border="#6ee7b7">↔ Comp.</Pill>}
            </View>
          </View>
          <View>
            {alreadyChallenged ? (
              <Pill bg="#fffbeb" fg="#d97706" border="#fde68a">⏳ En attente</Pill>
            ) : (
              <TouchableOpacity onPress={() => onChallenge(player)}
                style={{ backgroundColor: btnBg, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 8 }}
                activeOpacity={0.8}>
                <Text style={{ fontSize: 11.5, fontWeight: '900', color: '#fff' }}>⚡ Défier</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {((detail?.sharedClubs.length ?? 0) > 0 || (detail?.sharedDays.length ?? 0) > 0) && (
          <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' }}>
            {detail?.sharedClubs.slice(0, 2).map(c => <Pill key={c} bg="#f8fafc" fg="#64748b" border="#e2e8f0">📍 {c}</Pill>)}
            {detail?.sharedDays.slice(0, 2).map(d => <Pill key={d} bg="#f8fafc" fg="#64748b" border="#e2e8f0">📅 {d}</Pill>)}
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
function IncomingCard({ challenge, detail, onAction, onViewProfile }: {
  challenge: Challenge; detail?: CompatDetail;
  onAction: (id: string, action: 'accepted' | 'declined') => Promise<void>;
  onViewProfile?: (playerId: string) => void;
}) {
  const [acting, setActing] = useState<'accepted' | 'declined' | null>(null);
  const [expanded, setExpanded] = useState(true);
  const challenger = challenge.challenger as Player | undefined;
  const isPending = challenge.status === 'pending';
  const score = detail?.score ?? challenge.compat_score ?? 0;
  const tier = compatTier(score);

  const diff = challenge.expires_at ? new Date(challenge.expires_at).getTime() - Date.now() : 0;
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const timeLeft = diff <= 0 ? 'Expiré' : days > 0 ? `${days}j restants` : `${hours}h restants`;

  const statusInfo: Record<string, { label: string; bg: string; color: string; border: string }> = {
    pending:  { label: 'En attente', bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
    accepted: { label: 'Accepté',    bg: '#ecfdf5', color: '#059669', border: '#6ee7b7' },
    declined: { label: 'Refusé',     bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
    expired:  { label: 'Expiré',     bg: '#f8fafc', color: '#94a3b8', border: '#e2e8f0' },
    played:   { label: 'Joué',       bg: '#eef2ff', color: '#4f46e5', border: '#c7d2fe' },
  };
  const st = statusInfo[challenge.status] ?? statusInfo.pending;

  const handle = async (action: 'accepted' | 'declined') => {
    setActing(action);
    await onAction(challenge.id, action);
  };

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
              <TouchableOpacity activeOpacity={onViewProfile ? 0.7 : 1} onPress={onViewProfile && challenger?.id ? () => onViewProfile(challenger.id) : undefined}>
                <PlayerAvatar name={challenger?.name ?? '?'} size={36} />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontSize: 14, fontWeight: '900', color: '#0f172a' }}>{challenger?.name ?? '?'}</Text>
                  {onViewProfile && challenger?.id && (
                    <TouchableOpacity onPress={() => onViewProfile(challenger.id)} activeOpacity={0.7}>
                      <Text style={{ fontSize: 10, color: '#6366f1', fontWeight: '700' }}>Profil →</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 }}>
                  <Text style={{ fontSize: 10, color: '#94a3b8', fontWeight: '600' }}>Niv. {eloToLevel(challenger?.elo_score ?? 0).toFixed(1)}</Text>
                  {((challenger as any)?.win_count != null || (challenger as any)?.loss_count != null) && (
                    <>
                      <Text style={{ fontSize: 10, color: '#e2e8f0' }}>·</Text>
                      <Text style={{ fontSize: 10, color: '#64748b', fontWeight: '600' }}>
                        {(challenger as any).win_count ?? 0}V {(challenger as any).loss_count ?? 0}D
                        {((challenger as any).win_count ?? 0) + ((challenger as any).loss_count ?? 0) > 0
                          ? ` — ${Math.round(((challenger as any).win_count ?? 0) / (((challenger as any).win_count ?? 0) + ((challenger as any).loss_count ?? 0)) * 100)}% win`
                          : ''}
                      </Text>
                    </>
                  )}
                </View>
              </View>
            </View>
            {challenge.message ? (
              <View style={{ backgroundColor: '#f8fafc', borderRadius: 10, padding: 8, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: tier.color }}>
                <Text style={{ fontSize: 11.5, color: '#334155', fontStyle: 'italic' }}>"{challenge.message}"</Text>
              </View>
            ) : null}
            {((challenge.shared_clubs?.length ?? 0) > 0 || (challenge.shared_days?.length ?? 0) > 0) && (
              <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
                {challenge.shared_clubs?.slice(0, 2).map(c => <Pill key={c} bg="#eef2ff" fg="#4f46e5" border="#c7d2fe">📍 {c}</Pill>)}
                {challenge.shared_days?.slice(0, 2).map(d => <Pill key={d} bg="#fffbeb" fg="#d97706" border="#fde68a">📅 {d}</Pill>)}
              </View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Pill bg={st.bg} fg={st.color} border={st.border}>{st.label}</Pill>
              {isPending && <Text style={{ fontSize: 9, color: '#94a3b8', fontWeight: '600' }}>⏰ {timeLeft}</Text>}
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
      {isPending && (
        <View style={{ flexDirection: 'row', gap: 8, padding: 14, paddingTop: 0 }}>
          <TouchableOpacity onPress={() => handle('declined')} disabled={acting !== null}
            style={[sty.actionBtn, { flex: 1, borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#fff', opacity: acting ? 0.5 : 1 }]}
            activeOpacity={0.75}>
            <Text style={{ fontSize: 13, fontWeight: '900', color: '#334155' }}>{acting === 'declined' ? '…' : '✕ Décliner'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handle('accepted')} disabled={acting !== null}
            style={[sty.actionBtn, { flex: 2, backgroundColor: '#0f172a', opacity: acting ? 0.5 : 1 }]}
            activeOpacity={0.85}>
            <Text style={{ fontSize: 13, fontWeight: '900', color: '#fff' }}>{acting === 'accepted' ? '…' : '✓ Accepter le défi'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────
export default function MatchmakingScreen() {
  const { player } = usePlayer();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>('suggestions');
  const [sortMode, setSortMode] = useState<SortMode>('compat');
  const [suggestions, setSuggestions] = useState<Player[]>([]);
  const [incoming, setIncoming] = useState<Challenge[]>([]);
  const [challengedIds, setChallengedIds] = useState<Set<string>>(new Set());
  const [compatMap, setCompatMap] = useState<Map<string, CompatDetail>>(new Map());
  const [incomingCompatMap, setIncomingCompatMap] = useState<Map<string, CompatDetail>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [computing, setComputing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const fetchData = useCallback(async () => {
    if (!player) return;
    setLoading(true);

    const [playersRes, incomingRes, sentRes] = await Promise.all([
      supabase.from('players')
        .select('*')
        .neq('id', player.id)
        .order('elo_score', { ascending: false })
        .limit(50),
      supabase.from('challenges')
        .select('*, challenger:challenger_id(*)')
        .eq('challenged_id', player.id)
        .eq('status', 'pending')
        .order('compat_score', { ascending: false }),
      supabase.from('challenges')
        .select('challenged_id, status')
        .eq('challenger_id', player.id)
        .eq('status', 'pending'),
    ]);

    const allPlayers = (playersRes.data ?? []) as Player[];
    const sorted = [...allPlayers]
      .sort((a, b) => Math.abs(a.elo_score - player.elo_score) - Math.abs(b.elo_score - player.elo_score))
      .slice(0, 20);

    setSuggestions(sorted);

    // Deduplicate: one challenge per challenger (highest compat_score first due to ordering)
    const seen = new Set<string>();
    const challenges = ((incomingRes.data ?? []) as Challenge[]).filter(c => {
      const key = (c as any).challenger_id;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    setIncoming(challenges);
    setChallengedIds(new Set(((sentRes.data ?? []) as any[]).map((c: any) => c.challenged_id)));
    setLoading(false);

    setComputing(true);
    // Fetch my game data once, reuse for all computations
    const myData = await getPlayerGameData(player.id);

    const [detailMap, incDetailMap] = await Promise.all([
      Promise.all(sorted.map(async s => {
        const detail = await computeCompatDetail(player.id, player.elo_score, player.court_side, myData, s.id, s.elo_score, (s as any).court_side ?? (s as any).preferred_side);
        return [s.id, detail] as const;
      })).then(entries => new Map(entries)),

      Promise.all(challenges.map(async c => {
        const ch = c.challenger as Player | undefined;
        if (!ch) return null;
        const detail = await computeCompatDetail(player.id, player.elo_score, player.court_side, myData, ch.id, ch.elo_score, (ch as any).court_side ?? (ch as any).preferred_side);
        return [c.id, detail] as const;
      })).then(entries => new Map(entries.filter(Boolean) as [string, CompatDetail][])),
    ]);

    setCompatMap(detailMap);
    setIncomingCompatMap(incDetailMap);
    setComputing(false);
  }, [player]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));
  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const handleAction = async (id: string, action: 'accepted' | 'declined') => {
    await supabase.from('challenges').update({ status: action }).eq('id', id);
    setIncoming(prev => prev.map(c => c.id === id ? { ...c, status: action } : c));
    showToast(action === 'accepted' ? '✅ Défi accepté !' : 'Défi décliné');
  };

  const sortedSuggestions = sortMode === 'compat' && compatMap.size > 0
    ? [...suggestions].sort((a, b) => (compatMap.get(b.id)?.score ?? 0) - (compatMap.get(a.id)?.score ?? 0))
    : [...suggestions].sort((a, b) => Math.abs(a.elo_score - (player?.elo_score ?? 1000)) - Math.abs(b.elo_score - (player?.elo_score ?? 1000)));

  const pendingCount = incoming.filter(c => c.status === 'pending').length;

  if (!player) return null;

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      {/* Dark header */}
      <View style={{
        backgroundColor: '#102820',
        paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 16,
        borderBottomLeftRadius: 32, borderBottomRightRadius: 32,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
          <View>
            <Text style={{ fontSize: 24, fontWeight: '900', color: '#fff', letterSpacing: -0.5 }}>Défi</Text>
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#475569', marginTop: 2 }}>Défis & joueurs compatibles</Text>
          </View>
          {pendingCount > 0 && (
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#4f46e5', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 12, fontWeight: '900', color: '#fff' }}>{pendingCount}</Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 18, padding: 4, gap: 3 }}>
          {([
            { id: 'suggestions' as Tab, label: 'Suggestions', badge: 0 },
            { id: 'defis'       as Tab, label: 'Défis reçus', badge: pendingCount },
          ]).map(t => {
            const active = tab === t.id;
            return (
              <TouchableOpacity key={t.id} onPress={() => setTab(t.id)} activeOpacity={0.7}
                style={{
                  flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
                  backgroundColor: active ? '#fff' : 'transparent', borderRadius: 14, paddingVertical: 9,
                }}>
                <Text style={{ color: active ? '#0f172a' : 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                  {t.label}
                </Text>
                {t.badge > 0 && (
                  <View style={{ backgroundColor: active ? '#4f46e5' : 'rgba(255,255,255,0.2)', borderRadius: 999, paddingHorizontal: 5, paddingVertical: 1 }}>
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '900' }}>{t.badge}</Text>
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
            {tab === 'suggestions' && (
              <>
                <SortToggle mode={sortMode} onChange={setSortMode} computing={computing} />
                {sortedSuggestions.length === 0
                  ? <EmptyCard icon="🔍" title="Aucune suggestion" sub="Reviens quand plus de joueurs ont rejoint l'app." />
                  : <View style={{ gap: 10 }}>
                      {sortedSuggestions.map(p => (
                        <SuggestionCard key={p.id} player={p} detail={compatMap.get(p.id)}
                          alreadyChallenged={challengedIds.has(p.id)}
                          onChallenge={(target) => router.push((`/(tabs)/lobby?create=1&challenge=1&with=${target.id}&pname=${encodeURIComponent(target.name)}&pelo=${target.elo_score}`) as any)} />
                      ))}
                    </View>
                }
              </>
            )}
            {tab === 'defis' && (
              <>
                {incoming.length === 0
                  ? <EmptyCard icon="🎯" title="Aucun défi reçu" sub="Les joueurs peuvent te défier depuis les Suggestions." />
                  : <View style={{ gap: 10 }}>
                      {incoming.map(c => (
                        <IncomingCard
                          key={c.id}
                          challenge={c}
                          detail={incomingCompatMap.get(c.id)}
                          onAction={handleAction}
                          onViewProfile={(pid) => router.push(`/player/${pid}` as any)}
                        />
                      ))}
                    </View>
                }
              </>
            )}
          </View>
        </ScrollView>
      )}

      {toast && (
        <View style={{
          position: 'absolute', bottom: insets.bottom + 80, alignSelf: 'center',
          backgroundColor: '#102820', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 10,
          shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
        }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>{toast}</Text>
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────
const sty = StyleSheet.create({
  card: {
    backgroundColor: '#fff', borderRadius: 18,
    borderWidth: 1.5, borderColor: '#e2e8f0', overflow: 'hidden',
    shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  actionBtn: {
    borderRadius: 13, padding: 12, alignItems: 'center',
  },
});
