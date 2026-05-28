import { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import { usePlayer } from '../hooks/usePlayer';
import { supabase } from '../lib/supabase';
import { Colors, getLeague, getLeagueLabel, eloToLevel } from '../lib/theme';

// ─── Icons ───────────────────────────────────────────────────
const IconChevronLeft = ({ size = 20, color = '#0f172a' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M15 18l-6-6 6-6" />
  </Svg>
);

const IconBell = ({ size = 32, color = '#cbd5e1' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <Path stroke={color} d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </Svg>
);

const IconSwords = ({ size = 18, color = '#4f46e5' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M14.5 17.5 3 6V3h3l11.5 11.5" />
    <Path stroke={color} d="m13 19 6-6" />
    <Path stroke={color} d="m2 22 6-6" />
    <Path stroke={color} d="M17.5 14.5 21 21h-3l-3.5-3.5" />
    <Path stroke={color} d="M3 3h3v3L21 21h-3L3 6V3z" />
    <Path stroke={color} d="m13.5 6.5 3-3" />
  </Svg>
);

const IconCheckSquare = ({ size = 18, color = '#d97706' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M9 11l3 3L22 4" />
    <Path stroke={color} d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </Svg>
);

const IconMedal = ({ size = 18, color = '#059669' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Circle cx="12" cy="8" r="6" stroke={color} />
    <Path stroke={color} d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
  </Svg>
);

const IconTrendingUp = ({ size = 18, color = '#b45309' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M22 7l-8.5 8.5-5-5L2 17" />
    <Path stroke={color} d="M16 7h6v6" />
  </Svg>
);

const IconUserPlus = ({ size = 18, color = '#0891b2' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <Circle cx="9" cy="7" r="4" stroke={color} />
    <Path stroke={color} d="M19 8v6M22 11h-6" />
  </Svg>
);

const IconUsers = ({ size = 18, color = '#b45309' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <Circle cx="9" cy="7" r="4" stroke={color} />
    <Path stroke={color} d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <Path stroke={color} d="M16 3.13a4 4 0 0 1 0 7.75" />
  </Svg>
);

const IconChevronRight = ({ size = 16, color = '#cbd5e1' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M9 18l6-6-6-6" />
  </Svg>
);

const IconX = ({ size = 14, color = '#94a3b8' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M18 6L6 18M6 6l12 12" />
  </Svg>
);

const IconClipboard = ({ size = 18, color = '#0891b2' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <Path stroke={color} d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z" />
    <Path stroke={color} d="M9 12h6M9 16h4" />
  </Svg>
);

// ─── Types ────────────────────────────────────────────────────
type NavTarget =
  | { pathname: string; params?: Record<string, string> };

interface NotifItem {
  id: string;
  type: 'challenge' | 'match' | 'badge' | 'levelup' | 'invitation' | 'pending_approval' | 'to_score';
  title: string;
  subtitle: string;
  target: NavTarget;
}

// ─── Screen ───────────────────────────────────────────────────
export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { player } = usePlayer();
  const [items, setItems] = useState<NotifItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifs = useCallback(async () => {
    if (!player) return;
    setLoading(true);

    const nowIso = new Date().toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const playerOr = [
      `winner_id.eq.${player.id}`,
      `loser_id.eq.${player.id}`,
      `winner_id_2.eq.${player.id}`,
      `loser_id_2.eq.${player.id}`,
    ].join(',');

    const [
      { data: challenges },
      { data: pending },
      { data: recentMatches },
      { data: alreadyVoted },
      { data: eloHistory },
      { data: invitations },
      { data: createdGames },
      { data: acceptedGames },
    ] = await Promise.all([
      supabase
        .from('challenges')
        .select('id, challenger:players!challenger_id(name)')
        .eq('challenged_id', player.id)
        .eq('status', 'pending'),
      supabase
        .from('matches')
        .select('id, winner:winner_id(name), created_by')
        .or(playerOr)
        .eq('status', 'pending')
        .neq('created_by', player.id),
      supabase
        .from('matches')
        .select('id')
        .or(playerOr)
        .in('status', ['pending', 'validated'])
        .gte('created_at', sevenDaysAgo),
      supabase
        .from('reputation_votes')
        .select('match_id')
        .eq('giver_id', player.id),
      supabase
        .from('elo_history')
        .select('elo_score, elo_change')
        .eq('player_id', player.id)
        .gt('elo_change', 0)
        .gte('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false }),
      supabase
        .from('game_participants')
        .select('id, game:game_id(id, location, is_challenge, creator:creator_id(name))')
        .eq('player_id', player.id)
        .eq('status', 'invited'),
      supabase
        .from('open_games')
        .select('id, location, participants:game_participants(status)')
        .eq('creator_id', player.id)
        .eq('status', 'open')
        .or(`match_date.is.null,match_date.gt.${nowIso}`),
      supabase
        .from('game_participants')
        .select('game:game_id(id, location, match_date, status, participants:game_participants(status))')
        .eq('player_id', player.id)
        .eq('status', 'accepted'),
    ]);

    // ── "À scorer" sequential query ──────────────────────────────
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const acceptedGameIds = (acceptedGames ?? [])
      .map((e: any) => e.game?.id)
      .filter(Boolean) as string[];
    const orParts = [
      `creator_id.eq.${player.id}`,
      ...(acceptedGameIds.length > 0 ? [`id.in.(${acceptedGameIds.join(',')})`] : []),
    ].join(',');
    const { count: toScoreCount } = await supabase
      .from('open_games')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'cancelled')
      .neq('status', 'closed')
      .lt('match_date', nowIso)
      .gte('match_date', fortyEightHoursAgo)
      .eq('spots_available', 0)
      .or(orParts);

    const votedIds = new Set((alreadyVoted ?? []).map((v: any) => v.match_id));
    const unvotedCount = (recentMatches ?? []).filter((m: any) => !votedIds.has(m.id)).length;

    // Detect most recent league or full-level promotion in the last 7 days
    const levelUpEntry = (eloHistory ?? []).find((h: any) => {
      const prevElo = h.elo_score - h.elo_change;
      const leagueChanged = getLeague(h.elo_score) !== getLeague(prevElo);
      const levelIncreased = Math.floor(eloToLevel(h.elo_score)) > Math.floor(eloToLevel(prevElo));
      return leagueChanged || levelIncreased;
    });

    // Merge creator games + accepted games, deduplicate by id, keep only those with pending candidates
    // Only include games that haven't started yet (match_date null or future)
    const allApprovalGames = new Map<string, { id: string; location: string; pendingCount: number }>();
    for (const g of (createdGames ?? []) as any[]) {
      const count = (g.participants ?? []).filter((p: any) => p.status === 'pending').length;
      if (count > 0) allApprovalGames.set(g.id, { id: g.id, location: g.location ?? '', pendingCount: count });
    }
    for (const e of (acceptedGames ?? []) as any[]) {
      const g = e.game;
      if (!g?.id) continue;
      if (g.status === 'cancelled' || g.status === 'closed') continue;
      if (g.match_date && g.match_date < nowIso) continue;
      const count = (g.participants ?? []).filter((p: any) => p.status === 'pending').length;
      if (count > 0 && !allApprovalGames.has(g.id))
        allApprovalGames.set(g.id, { id: g.id, location: g.location ?? '', pendingCount: count });
    }

    const result: NotifItem[] = [
      ...[...allApprovalGames.values()].map(g => ({
        id: `approval-${g.id}`,
        type: 'pending_approval' as const,
        title: `${g.pendingCount} candidature${g.pendingCount > 1 ? 's' : ''} en attente`,
        subtitle: g.location ? `Partie à ${g.location}` : 'Partie sans lieu défini',
        target: { pathname: '/(tabs)/lobby', params: { gameId: g.id } },
      })),
      ...(invitations ?? []).map((inv: any) => {
        const isChallengeInvite = !!inv.game?.is_challenge;
        const creatorName = inv.game?.creator?.name ?? '?';
        const locationSuffix = inv.game?.location ? ` à ${inv.game.location}` : '';
        return {
          id: `invitation-${inv.id}`,
          type: (isChallengeInvite ? 'challenge' : 'invitation') as 'challenge' | 'invitation',
          title: isChallengeInvite ? 'Défi reçu' : 'Invitation reçue',
          subtitle: isChallengeInvite
            ? `${creatorName} te défie en duel${locationSuffix}`
            : `${creatorName} t'invite à jouer${locationSuffix}`,
          target: { pathname: '/(tabs)/lobby', params: { gameId: inv.game?.id } },
        };
      }),
      ...(challenges ?? []).map((c: any) => ({
        id: `challenge-${c.id}`,
        type: 'challenge' as const,
        title: 'Nouveau défi reçu',
        subtitle: `${c.challenger?.name ?? '?'} t'a lancé un défi`,
        target: { pathname: '/(tabs)/matchmaking' },
      })),
      ...(pending ?? []).map((m: any) => ({
        id: `match-${m.id}`,
        type: 'match' as const,
        title: 'Score à valider',
        subtitle: `Soumis par ${m.winner?.name ?? '?'}`,
        target: { pathname: '/(tabs)', params: { openPending: '1' } },
      })),
      ...(unvotedCount > 0 ? [{
        id: 'badge-prompt',
        type: 'badge' as const,
        title: 'Note tes coéquipiers',
        subtitle: `${unvotedCount} match${unvotedCount > 1 ? 's' : ''} en attente de badges`,
        target: { pathname: '/(tabs)', params: { openBadge: '1' } },
      }] : []),
      ...(levelUpEntry ? [{
        id: 'levelup',
        type: 'levelup' as const,
        title: 'Montée de niveau 🎉',
        subtitle: (() => {
          const prev = levelUpEntry.elo_score - levelUpEntry.elo_change;
          if (getLeague(levelUpEntry.elo_score) !== getLeague(prev)) {
            return `Tu es passé en ligue ${getLeagueLabel(getLeague(levelUpEntry.elo_score))} !`;
          }
          return `Tu as atteint le niveau ${Math.floor(eloToLevel(levelUpEntry.elo_score))} !`;
        })(),
        target: { pathname: '/(tabs)' },
      }] : []),
      ...((toScoreCount ?? 0) > 0 ? [{
        id: 'to-score',
        type: 'to_score' as const,
        title: 'Partie à scorer',
        subtitle: `${toScoreCount} partie${(toScoreCount ?? 0) > 1 ? 's' : ''} en attente de score`,
        target: { pathname: '/score-entry' },
      }] : []),
    ];

    setItems(result);
    setLoading(false);
  }, [player]);

  useFocusEffect(useCallback(() => {
    fetchNotifs();
  }, [fetchNotifs]));

  const iconFor = (type: NotifItem['type']) => {
    if (type === 'pending_approval') return <IconUsers size={18} color="#b45309" />;
    if (type === 'invitation') return <IconUserPlus size={18} color="#0891b2" />;
    if (type === 'challenge')  return <IconSwords size={18} color="#4f46e5" />;
    if (type === 'badge')      return <IconMedal size={18} color="#059669" />;
    if (type === 'levelup')    return <IconTrendingUp size={18} color="#b45309" />;
    if (type === 'to_score')   return <IconClipboard size={18} color="#0891b2" />;
    return <IconCheckSquare size={18} color="#d97706" />;
  };

  const bgFor = (type: NotifItem['type']) => {
    if (type === 'pending_approval') return { bg: '#fffbeb', border: '#fde68a' };
    if (type === 'invitation') return { bg: '#f0f9ff', border: '#bae6fd' };
    if (type === 'challenge')  return { bg: '#eef2ff', border: '#c7d2fe' };
    if (type === 'badge')      return { bg: '#ecfdf5', border: '#a7f3d0' };
    if (type === 'levelup')    return { bg: '#fffbeb', border: '#fde68a' };
    if (type === 'to_score')   return { bg: '#f0f9ff', border: '#bae6fd' };
    return { bg: '#fff7ed', border: '#fed7aa' };
  };

  const textFor = (type: NotifItem['type']) => {
    if (type === 'pending_approval') return { title: '#92400e', sub: '#b45309' };
    if (type === 'invitation') return { title: '#0c4a6e', sub: '#0ea5e9' };
    if (type === 'challenge')  return { title: '#3730a3', sub: '#6366f1' };
    if (type === 'badge')      return { title: '#065f46', sub: '#059669' };
    if (type === 'levelup')    return { title: '#92400e', sub: '#b45309' };
    if (type === 'to_score')   return { title: '#0c4a6e', sub: '#0ea5e9' };
    return { title: '#7c2d12', sub: '#c2410c' };
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
      {/* Header */}
      <View style={{
        paddingTop: insets.top + 12,
        paddingHorizontal: 16,
        paddingBottom: 14,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      }}>
        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.7}
          style={{
            width: 36, height: 36, borderRadius: 10,
            backgroundColor: '#f1f5f9',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <IconChevronLeft size={20} color="#0f172a" />
        </TouchableOpacity>
        <Text style={{ fontSize: 20, fontWeight: '900', color: '#0f172a', flex: 1 }}>
          Notifications
        </Text>
        {items.length > 0 && (
          <>
            <View style={{
              backgroundColor: '#ef4444', borderRadius: 999,
              paddingHorizontal: 8, paddingVertical: 2,
            }}>
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '900' }}>{items.length}</Text>
            </View>
            <TouchableOpacity
              onPress={() => setItems([])}
              activeOpacity={0.7}
              style={{
                paddingHorizontal: 10, paddingVertical: 6,
                borderRadius: 8, backgroundColor: '#f1f5f9',
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748b' }}>Tout effacer</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ flex: 1 }} />
      ) : items.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <View style={{
            width: 72, height: 72, borderRadius: 20,
            backgroundColor: '#f1f5f9',
            alignItems: 'center', justifyContent: 'center',
            marginBottom: 16,
          }}>
            <IconBell size={32} color="#cbd5e1" />
          </View>
          <Text style={{ fontSize: 17, fontWeight: '900', color: '#475569', textAlign: 'center' }}>
            Tout est à jour !
          </Text>
          <Text style={{ fontSize: 13, color: '#94a3b8', marginTop: 6, textAlign: 'center' }}>
            Aucune notification en attente pour le moment.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
        >
          {items.map(item => {
            const colors = bgFor(item.type);
            const text   = textFor(item.type);
            return (
              <TouchableOpacity
                key={item.id}
                activeOpacity={0.75}
                onPress={() => router.push(item.target as any)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  backgroundColor: colors.bg,
                  borderWidth: 1, borderColor: colors.border,
                  borderRadius: 16, padding: 14, marginBottom: 10,
                }}
              >
                <View style={{
                  width: 40, height: 40, borderRadius: 12,
                  backgroundColor: '#fff',
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: '#000', shadowOpacity: 0.05,
                  shadowOffset: { width: 0, height: 1 }, shadowRadius: 3,
                  elevation: 1,
                }}>
                  {iconFor(item.type)}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 14, fontWeight: '900', color: text.title }} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={{ fontSize: 12, color: text.sub, marginTop: 2 }} numberOfLines={1}>
                    {item.subtitle}
                  </Text>
                </View>
                <IconChevronRight size={16} color="#cbd5e1" />
                <TouchableOpacity
                  onPress={() => setItems(prev => prev.filter(i => i.id !== item.id))}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{
                    width: 28, height: 28, borderRadius: 8,
                    backgroundColor: 'rgba(0,0,0,0.06)',
                    alignItems: 'center', justifyContent: 'center',
                    marginLeft: 4,
                  }}
                >
                  <IconX size={14} color="#64748b" />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
