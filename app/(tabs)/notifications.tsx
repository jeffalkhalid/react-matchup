import { useCallback, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import { usePlayer } from '../../hooks/usePlayer';
import { supabase } from '../../lib/supabase';
import { Colors, getLeague, getLeagueLabel, eloToLevel, Fonts } from '../../lib/theme';

// ─── Icons ───────────────────────────────────────────────────
const IconChevronLeft = ({ size = 20, color = Colors.textPrimary }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M15 18l-6-6 6-6" />
  </Svg>
);

const IconBell = ({ size = 32, color = Colors.border }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <Path stroke={color} d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </Svg>
);

const IconSwords = ({ size = 18, color = Colors.brandDeep }) => (
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

const IconMedal = ({ size = 18, color = Colors.success }) => (
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

const IconChevronRight = ({ size = 16, color = Colors.border }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M9 18l6-6-6-6" />
  </Svg>
);

const IconX = ({ size = 14, color = Colors.textMuted }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M18 6L6 18M6 6l12 12" />
  </Svg>
);

// ─── Types ────────────────────────────────────────────────────
interface NotifItem {
  id: string;
  type: 'challenge' | 'invitation' | 'match' | 'badge' | 'levelup' | 'to_score' | 'to_approve' | 'joined';
  title: string;
  subtitle: string;
  route: string;
}

// Notifs "info" sans action requise : supprimables définitivement (persistées
// dans la table dismissed_notifications). Les autres types disparaissent en
// traitant l'action correspondante.
const DISMISSIBLE: ReadonlySet<NotifItem['type']> = new Set(['joined', 'levelup']);
const isDismissible = (t: NotifItem['type']) => DISMISSIBLE.has(t);

// ─── Screen ───────────────────────────────────────────────────
export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { player } = usePlayer();
  const [items, setItems] = useState<NotifItem[]>([]);
  const [loading, setLoading] = useState(true);
  const hasLoadedRef = useRef(false);

  const fetchNotifs = useCallback(async () => {
    if (!player) return;
    // Stale-while-revalidate : spinner seulement au 1er chargement ; ensuite on
    // garde la liste affichée et on rafraîchit en arrière-plan.
    if (!hasLoadedRef.current) setLoading(true);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const playerOr = [
      `winner_id.eq.${player.id}`,
      `loser_id.eq.${player.id}`,
      `winner_id_2.eq.${player.id}`,
      `loser_id_2.eq.${player.id}`,
    ].join(',');

    // "Partie à scorer" : mêmes critères que score-entry et lobby.readyToScore.
    const nowIso = new Date().toISOString();
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: acceptedGames } = await supabase
      .from('game_participants')
      .select('game_id')
      .eq('player_id', player.id)
      .eq('status', 'accepted');
    const acceptedGameIds = (acceptedGames ?? []).map((e: any) => e.game_id).filter(Boolean) as string[];
    const orParts = [
      `creator_id.eq.${player.id}`,
      ...(acceptedGameIds.length > 0 ? [`id.in.(${acceptedGameIds.join(',')})`] : []),
    ].join(',');

    const [
      { data: challenges },
      { data: pending },
      { data: recentMatches },
      { data: alreadyVoted },
      { data: eloHistory },
      { data: toScoreGames },
      { data: invitations },
      { data: myGames },
      { data: dismissedRows },
    ] = await Promise.all([
      supabase
        .from('challenges')
        .select('id, game_id, challenger:players!challenger_id(name)')
        .eq('challenged_id', player.id)
        .eq('status', 'pending'),
      supabase
        .from('matches')
        .select('id, winner:winner_id(name), created_by, winner_id, winner_id_2, loser_id, loser_id_2')
        .or(playerOr)
        .eq('status', 'pending'),
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
        .select('elo_score, elo_change, match_id')
        .eq('player_id', player.id)
        .gt('elo_change', 0)
        .gte('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false }),
      supabase
        .from('open_games')
        .select('id, creator_id, participants:game_participants(player_id, status)')
        .neq('status', 'cancelled')
        .neq('status', 'closed')
        .lt('match_date', nowIso)
        .gte('match_date', fortyEightHoursAgo)
        .eq('spots_available', 0)
        .or(orParts),
      supabase
        .from('game_participants')
        .select('id, game:game_id(id, location, is_challenge, match_date, status, creator:creator_id(name))')
        .eq('player_id', player.id)
        .eq('status', 'invited'),
      // Mes parties (créateur ou participant validé) — pour les demandes à valider.
      supabase
        .from('open_games')
        .select('id, location, status, match_date')
        .neq('status', 'cancelled')
        .or(orParts),
      // Notifs "info" déjà supprimées par l'utilisateur (joined / levelup).
      supabase
        .from('dismissed_notifications')
        .select('notif_key')
        .eq('player_id', player.id),
    ]);

    const dismissedKeys = new Set((dismissedRows ?? []).map((d: any) => d.notif_key));

    const votedIds = new Set((alreadyVoted ?? []).map((v: any) => v.match_id));
    const unvotedCount = (recentMatches ?? []).filter((m: any) => !votedIds.has(m.id)).length;

    // "Partie à scorer" — MÊMES critères que score-entry.fetchGames et
    // useNotificationCount.toScore : doubles uniquement (4 joueurs réels). On ne
    // se fie PAS au seul spots_available (compteur dénormalisé sujet au drift),
    // sinon une partie incomplète génère une notif fantôme sans match en face.
    const toScoreCount = (toScoreGames ?? []).filter((g: any) => {
      const accepted = (g.participants ?? []).filter((p: any) => p.status === 'accepted');
      const creatorAccepted = accepted.some((p: any) => p.player_id === g.creator_id);
      const total = accepted.length + (creatorAccepted ? 0 : 1);
      const meIn = g.creator_id === player.id || accepted.some((p: any) => p.player_id === player.id);
      return total >= 4 && meIn;
    }).length;

    // Filter pending: exclude matches submitted by me OR by my doubles partner
    const visiblePending = (pending ?? []).filter((m: any) => {
      if (m.created_by === player.id) return false;
      const cb = m.created_by;
      if (
        (cb === m.winner_id   && m.winner_id_2 === player.id) ||
        (cb === m.winner_id_2 && m.winner_id   === player.id) ||
        (cb === m.loser_id    && m.loser_id_2  === player.id) ||
        (cb === m.loser_id_2  && m.loser_id    === player.id)
      ) return false;
      return true;
    });

    // Detect most recent league or full-level promotion in the last 7 days
    const levelUpEntry = (eloHistory ?? []).find((h: any) => {
      const prevElo = h.elo_score - h.elo_change;
      const leagueChanged = getLeague(h.elo_score) !== getLeague(prevElo);
      const levelIncreased = Math.floor(eloToLevel(h.elo_score)) > Math.floor(eloToLevel(prevElo));
      return leagueChanged || levelIncreased;
    });

    // Anti-doublon : un défi crée à la fois une ligne `challenges` ET un
    // game_participants 'invited' sur la même partie. On exclut l'invitation
    // si un défi existe déjà pour cette partie (la ligne `challenges` la couvre).
    const challengeGameIds = new Set((challenges ?? []).map((c: any) => c.game_id).filter(Boolean));

    // Filter active invitations: skip those whose game is closed/cancelled or already past
    const activeInvites = (invitations ?? []).filter((inv: any) => {
      const g = inv.game;
      if (!g) return false;
      if (g.id && challengeGameIds.has(g.id)) return false;
      if (g.status === 'closed' || g.status === 'cancelled') return false;
      if (g.match_date && new Date(g.match_date).getTime() < Date.now()) return false;
      return true;
    });

    // Demandes à valider — candidatures 'pending' sur mes parties (créateur ou
    // participant validé) que je n'ai pas encore approuvées. Lien → carte détail.
    const myGameById = new Map((myGames ?? []).map((g: any) => [g.id, g]));
    const validReqGameIds = (myGames ?? []).filter((g: any) => {
      if (g.status === 'closed' || g.status === 'cancelled') return false;
      if (g.match_date && new Date(g.match_date).getTime() < Date.now()) return false;
      return true;
    }).map((g: any) => g.id);

    let pendingReqItems: NotifItem[] = [];
    let joinedItems: NotifItem[] = [];
    if (validReqGameIds.length > 0) {
      const { data: reqs } = await supabase
        .from('game_participants')
        .select('id, game_id, player_id, approvals, player:player_id(name)')
        .in('game_id', validReqGameIds)
        .eq('status', 'pending');
      pendingReqItems = (reqs ?? [])
        .filter((r: any) => r.player_id !== player.id && !(r.approvals ?? []).includes(player.id))
        .map((r: any) => {
          const g = myGameById.get(r.game_id);
          const where = g?.location ? ` à ${g.location}` : '';
          return {
            id: `req-${r.id}`,
            type: 'to_approve' as const,
            title: 'Demande à valider',
            subtitle: `${r.player?.name ?? 'Un joueur'} veut rejoindre la partie${where}`,
            route: `/(tabs)/lobby?gameId=${r.game_id}`,
          };
        });

      // Joined events — accepted participants sur mes parties dans les 7 derniers jours,
      // que ce soit auto-accept, invitation acceptée ou candidature approuvée.
      const { data: joined } = await supabase
        .from('game_participants')
        .select('id, game_id, player_id, approvals, created_at, player:player_id(name)')
        .in('game_id', validReqGameIds)
        .eq('status', 'accepted')
        .neq('player_id', player.id)
        .gte('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false });
      joinedItems = (joined ?? []).map((j: any) => {
        const g = myGameById.get(j.game_id);
        const where = g?.location ? ` à ${g.location}` : '';
        const wasApproved = (j.approvals ?? []).length > 0;
        return {
          id: `joined-${j.id}`,
          type: 'joined' as const,
          title: wasApproved ? '✅ Candidature acceptée' : '👋 Nouveau joueur',
          subtitle: `${j.player?.name ?? 'Un joueur'} a rejoint la partie${where}`,
          route: `/(tabs)/lobby?gameId=${j.game_id}`,
        };
      });
    }

    const result: NotifItem[] = [
      ...pendingReqItems,
      ...joinedItems,
      ...activeInvites.map((inv: any) => {
        const isChall = !!inv.game?.is_challenge;
        const who = inv.game?.creator?.name ?? '?';
        const where = inv.game?.location ? ` à ${inv.game.location}` : '';
        return {
          id: `invitation-${inv.id}`,
          type: (isChall ? 'challenge' : 'invitation') as 'challenge' | 'invitation',
          title: isChall ? '⚡ Défi reçu' : '✉️ Invitation reçue',
          subtitle: isChall ? `${who} te défie en duel${where}` : `${who} t'invite à jouer${where}`,
          route: `/(tabs)/lobby?gameId=${inv.game.id}`,
        };
      }),
      ...(challenges ?? []).map((c: any) => ({
        id: `challenge-${c.id}`,
        type: 'challenge' as const,
        title: 'Nouveau défi reçu',
        subtitle: `${c.challenger?.name ?? '?'} t'a lancé un défi`,
        route: '/(tabs)/matchmaking',
      })),
      ...visiblePending.map((m: any) => ({
        id: `match-${m.id}`,
        type: 'match' as const,
        title: 'Score à valider',
        subtitle: `Soumis par ${m.winner?.name ?? '?'}`,
        route: '/(tabs)/lobby?tab=history&openValidation=1',
      })),
      ...((toScoreCount ?? 0) > 0 ? [{
        id: 'to-score',
        type: 'to_score' as const,
        title: 'Partie à scorer',
        subtitle: `${toScoreCount} partie${(toScoreCount ?? 0) > 1 ? 's' : ''} en attente de score`,
        route: '/(tabs)/lobby?tab=history',
      }] : []),
      ...(unvotedCount > 0 ? [{
        id: 'badge-prompt',
        type: 'badge' as const,
        title: 'Note tes coéquipiers',
        subtitle: `${unvotedCount} match${unvotedCount > 1 ? 's' : ''} en attente de badges`,
        route: '/(tabs)?openBadge=1',
      }] : []),
      ...(levelUpEntry ? [{
        id: `levelup-${levelUpEntry.match_id ?? 'last'}`,
        type: 'levelup' as const,
        title: 'Montée de niveau 🎉',
        subtitle: (() => {
          const prev = levelUpEntry.elo_score - levelUpEntry.elo_change;
          if (getLeague(levelUpEntry.elo_score) !== getLeague(prev)) {
            return `Tu es passé en ligue ${getLeagueLabel(getLeague(levelUpEntry.elo_score))} !`;
          }
          return `Tu as atteint le niveau ${Math.floor(eloToLevel(levelUpEntry.elo_score))} !`;
        })(),
        route: '/(tabs)',
      }] : []),
    ];

    // Retirer les notifs "info" déjà supprimées par l'utilisateur.
    setItems(result.filter(it => !(isDismissible(it.type) && dismissedKeys.has(it.id))));
    hasLoadedRef.current = true;
    setLoading(false);
  }, [player]);

  // Suppression persistante d'une notif "info" (joined / levelup).
  const dismissOne = useCallback(async (item: NotifItem) => {
    setItems(prev => prev.filter(i => i.id !== item.id));
    if (!player) return;
    await supabase
      .from('dismissed_notifications')
      .upsert({ player_id: player.id, notif_key: item.id }, { onConflict: 'player_id,notif_key' });
  }, [player]);

  // "Effacer les infos" — supprime toutes les notifs "info" affichées, laisse
  // intactes celles qui exigent une action.
  const dismissAllInfo = useCallback(async () => {
    const infoItems = items.filter(i => isDismissible(i.type));
    if (infoItems.length === 0) return;
    setItems(prev => prev.filter(i => !isDismissible(i.type)));
    if (!player) return;
    await supabase
      .from('dismissed_notifications')
      .upsert(
        infoItems.map(i => ({ player_id: player.id, notif_key: i.id })),
        { onConflict: 'player_id,notif_key' },
      );
  }, [items, player]);

  useFocusEffect(useCallback(() => {
    fetchNotifs();
  }, [fetchNotifs]));

  const iconFor = (type: NotifItem['type']) => {
    if (type === 'challenge')  return <IconSwords size={18} color={Colors.brandDeep} />;
    if (type === 'invitation') return <IconSwords size={18} color="#0891b2" />;
    if (type === 'to_approve') return <IconCheckSquare size={18} color="#7c3aed" />;
    if (type === 'joined')     return <IconMedal size={18} color={Colors.success} />;
    if (type === 'badge')      return <IconMedal size={18} color={Colors.success} />;
    if (type === 'levelup')    return <IconTrendingUp size={18} color="#b45309" />;
    if (type === 'to_score')   return <IconCheckSquare size={18} color="#0891b2" />;
    return <IconCheckSquare size={18} color="#d97706" />;
  };

  const bgFor = (type: NotifItem['type']) => {
    if (type === 'challenge')  return { bg: 'rgba(255,193,26,0.14)', border: 'rgba(255,193,26,0.55)' };
    if (type === 'invitation') return { bg: 'rgba(8,145,178,0.10)',  border: 'rgba(8,145,178,0.40)' };
    if (type === 'to_approve') return { bg: 'rgba(124,58,237,0.10)', border: 'rgba(124,58,237,0.40)' };
    if (type === 'joined')     return { bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.45)' };
    if (type === 'badge')      return { bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.45)' };
    if (type === 'levelup')    return { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.50)' };
    if (type === 'to_score')   return { bg: 'rgba(8,145,178,0.10)',  border: 'rgba(8,145,178,0.40)' };
    return { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.50)' };
  };

  const textFor = (type: NotifItem['type']) => {
    if (type === 'challenge')  return { title: Colors.brandDeep, sub: '#A16207' };
    if (type === 'invitation') return { title: '#155e75', sub: '#0e7490' };
    if (type === 'to_approve') return { title: '#5b21b6', sub: '#7c3aed' };
    if (type === 'joined')     return { title: '#065f46', sub: '#059669' };
    if (type === 'badge')     return { title: '#065f46', sub: '#059669' };
    if (type === 'levelup')   return { title: '#92400e', sub: '#b45309' };
    if (type === 'to_score')  return { title: '#155e75', sub: '#0e7490' };
    return { title: '#7c2d12', sub: '#c2410c' };
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {/* Header */}
      <View style={{
        paddingTop: insets.top + 12,
        paddingHorizontal: 16,
        paddingBottom: 14,
        backgroundColor: Colors.bgCard,
        borderBottomWidth: 1,
        borderBottomColor: Colors.bgCardAlt,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      }}>
        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.7}
          style={{
            width: 36, height: 36, borderRadius: 10,
            backgroundColor: Colors.bgCardAlt,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <IconChevronLeft size={20} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={{ fontSize: 26, color: Colors.textPrimary, flex: 1, fontFamily: Fonts.welcome, letterSpacing: -0.5 }}>
          Tes <Text style={{ color: Colors.brand }}>notifications</Text>
        </Text>
        {items.length > 0 && (
          <View style={{
            backgroundColor: Colors.danger, borderRadius: 999,
            paddingHorizontal: 8, paddingVertical: 2,
          }}>
            <Text style={{ color: Colors.textOnDark, fontSize: 11, fontWeight: '900', fontFamily: Fonts.uiBlack }}>{items.length}</Text>
          </View>
        )}
        {items.some(i => isDismissible(i.type)) && (
          <TouchableOpacity
            onPress={dismissAllInfo}
            activeOpacity={0.7}
            style={{
              paddingHorizontal: 10, paddingVertical: 6,
              borderRadius: 8, backgroundColor: Colors.bgCardAlt,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.textSecondary, fontFamily: Fonts.uiBold }}>Effacer les infos</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ flex: 1 }} />
      ) : items.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <View style={{
            width: 72, height: 72, borderRadius: 20,
            backgroundColor: Colors.bgCardAlt,
            alignItems: 'center', justifyContent: 'center',
            marginBottom: 16,
          }}>
            <IconBell size={32} color={Colors.border} />
          </View>
          <Text style={{ fontSize: 17, fontWeight: '900', color: Colors.textSecondary, textAlign: 'center', fontFamily: Fonts.uiBlack }}>
            Tout est à jour !
          </Text>
          <Text style={{ fontSize: 13, color: Colors.textMuted, marginTop: 6, textAlign: 'center' }}>
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
                onPress={() => router.push(item.route as any)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  backgroundColor: colors.bg,
                  borderWidth: 1, borderColor: colors.border,
                  borderRadius: 16, padding: 14, marginBottom: 10,
                }}
              >
                <View style={{
                  width: 40, height: 40, borderRadius: 12,
                  backgroundColor: Colors.bgCard,
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: '#000', shadowOpacity: 0.05,
                  shadowOffset: { width: 0, height: 1 }, shadowRadius: 3,
                  elevation: 1,
                }}>
                  {iconFor(item.type)}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 14, fontWeight: '900', color: text.title, fontFamily: Fonts.uiBlack }} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={{ fontSize: 12, color: text.sub, marginTop: 2 }} numberOfLines={1}>
                    {item.subtitle}
                  </Text>
                </View>
                <IconChevronRight size={16} color={Colors.border} />
                {isDismissible(item.type) && (
                  <TouchableOpacity
                    onPress={() => dismissOne(item)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={{
                      width: 28, height: 28, borderRadius: 8,
                      backgroundColor: 'rgba(0,0,0,0.06)',
                      alignItems: 'center', justifyContent: 'center',
                      marginLeft: 4,
                    }}
                  >
                    <IconX size={14} color={Colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
