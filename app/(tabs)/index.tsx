import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Modal,
  ActivityIndicator, Animated, LayoutAnimation, Easing,
  Platform, UIManager, StyleSheet, Image,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Path, Circle, Rect,
  Defs, LinearGradient as SvgLinearGradient, Stop,
} from 'react-native-svg';
import { usePlayer } from '../../hooks/usePlayer';
import { useNotificationCount } from '../../hooks/useNotificationCount';
import { supabase } from '../../lib/supabase';
import { Colors, formatPadelLevel, getLeague, getLeagueLabel, Fonts } from '../../lib/theme';
import { formatFrmtRanking } from '../../lib/frmt-match';
import { CommunityCard } from '../../components/community/CommunityCard';
import type { OpenGame } from '../../types';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Helpers ─────────────────────────────────────────────────
function formatNextGame(matchDate: string, location: string): string {
  const date = new Date(matchDate);
  const now  = new Date();
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nowDay  = new Date(now.getFullYear(),  now.getMonth(),  now.getDate());
  const diffDays = Math.round((dateDay.getTime() - nowDay.getTime()) / (1000 * 60 * 60 * 24));
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const dayLabel = diffDays === 0 ? "Aujourd'hui"
    : diffDays === 1 ? 'Demain'
    : date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const place = location.length > 14 ? location.slice(0, 13) + '…' : location;
  return `${dayLabel} · ${time}\n${place}`;
}

// ─── SVG Icons ───────────────────────────────────────────────
const IconRadar = ({ size = 24, color = Colors.primary }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M19.07 4.93A10 10 0 0 0 6.99 3.34"/>
    <Path stroke={color} d="M4 6h.01"/>
    <Path stroke={color} d="M2.29 9.62A10 10 0 1 0 21.31 8.35"/>
    <Path stroke={color} d="M16.24 7.76A6 6 0 1 0 17.34 14"/>
    <Path stroke={color} d="M12 18h.01"/>
    <Path stroke={color} d="M17.99 11.66A6 6 0 0 1 15.77 16.67"/>
    <Circle cx="12" cy="12" r="2" stroke={color} fill={color}/>
    <Path stroke={color} d="M21.17 8H12V2.83"/>
    <Path stroke={color} d="m22 22-5.5-5.5"/>
  </Svg>
);

const IconPen = ({ size = 24, color = Colors.success }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M12 20h9"/>
    <Path stroke={color} d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
  </Svg>
);

const IconTrophy = ({ size = 24, color = '#f59e0b' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
    <Path stroke={color} d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
    <Path stroke={color} d="M4 22h16"/>
    <Path stroke={color} d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
    <Path stroke={color} d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
    <Path stroke={color} d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
  </Svg>
);

const IconCalendar = ({ size = 24, color = '#8b5cf6' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/>
    <Path stroke={color} d="M16 2v4"/>
    <Path stroke={color} d="M8 2v4"/>
    <Path stroke={color} d="M3 10h5"/>
    <Path stroke={color} d="M17.5 17.5 16 16.25V14"/>
    <Circle cx="16" cy="16" r="6" stroke={color}/>
  </Svg>
);

// Filled bell — chemin exact du design Bell V2
const BellFilledIcon = ({ size = 20 }: { size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24"
    fill="#fff" stroke={Colors.textOnDark} strokeWidth={1.4} strokeLinejoin="round">
    <Path d="M6 8a6 6 0 0 1 12 0c0 6.2 2.6 8.4 2.9 8.7a.6.6 0 0 1-.4 1H3.5a.6.6 0 0 1-.4-1C3.4 16.4 6 14.2 6 8z" />
    <Path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" fill="none" />
  </Svg>
);

// ─── Notification Bell V2 ─────────────────────────────────────
// Specs: design_handoff_notification_bell/README.md
const BADGE_RED  = '#E5484D';
const HERO_GREEN = '#0E2A22';

function NotificationBell({ count, onPress }: { count: number; onPress: () => void }) {
  const has = count > 0;
  const display = count > 9 ? '9+' : String(count);

  // Bell swing — 2.6 s loop, ±12°, pivot top-center
  const swing    = useRef(new Animated.Value(0)).current;
  // Pulse ring — 1.8 s loop, scale 0.85→1.6 + fade
  const ringScale   = useRef(new Animated.Value(0.85)).current;
  const ringOpacity = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (!has) {
      swing.stopAnimation();
      swing.setValue(0);
      ringScale.stopAnimation();
      ringOpacity.stopAnimation();
      ringScale.setValue(0.85);
      ringOpacity.setValue(0.9);
      return;
    }

    // Bell swing: 7 steps × 260 ms + 780 ms pause = 2600 ms
    const swingLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(swing, { toValue: -12, duration: 260, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(swing, { toValue:  12, duration: 260, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(swing, { toValue: -12, duration: 260, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(swing, { toValue:  12, duration: 260, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(swing, { toValue: -12, duration: 260, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(swing, { toValue:  12, duration: 260, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(swing, { toValue:   0, duration: 260, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.delay(780),
      ])
    );

    // Pulse ring: scale + fade over 1440 ms, hold 360 ms = 1800 ms
    const pulseLoop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(ringScale,   { toValue: 1.6, duration: 1440, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.delay(360),
        ]),
        Animated.sequence([
          Animated.timing(ringOpacity, { toValue: 0,   duration: 1440, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.delay(360),
        ]),
      ])
    );

    swingLoop.start();
    pulseLoop.start();
    return () => { swingLoop.stop(); pulseLoop.stop(); };
  }, [has]);

  const rotate = swing.interpolate({ inputRange: [-12, 12], outputRange: ['-12deg', '12deg'] });

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={{
        position: 'absolute', top: 14, right: 14,
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.08)',
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      {/* Bell icon — animé quand has */}
      <Animated.View style={{ transform: [{ rotate }] }}>
        <BellFilledIcon size={20} />
      </Animated.View>

      {has && (
        <>
          {/* Pulse ring */}
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute', top: -2, right: -2,
              width: 22, height: 22, borderRadius: 11,
              borderWidth: 2, borderColor: BADGE_RED,
              transform: [{ scale: ringScale }],
              opacity: ringOpacity,
            }}
          />
          {/* Badge pill — outline via wrapper HERO_GREEN */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute', top: -6, right: -8,
              borderRadius: 11,
              backgroundColor: HERO_GREEN,
              padding: 2,
            }}
          >
            <View style={{
              minWidth: 18, height: 18,
              paddingHorizontal: 5,
              borderRadius: 9,
              backgroundColor: BADGE_RED,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ color: Colors.textOnDark, fontSize: 11, fontWeight: '700', letterSpacing: 0.2, lineHeight: 14 }}>
                {display}
              </Text>
            </View>
          </View>
        </>
      )}
    </TouchableOpacity>
  );
}

// ─── Gradient avatar ─────────────────────────────────────────
function GradientAvatar({ letter, size = 68 }: { letter: string; size?: number }) {
  const r = Math.round(size * 0.28);
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Defs>
          <SvgLinearGradient id="avGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#6366f1" />
            <Stop offset="1" stopColor="#34d399" />
          </SvgLinearGradient>
        </Defs>
        <Rect x="0" y="0" width={size} height={size} rx={r} fill="url(#avGrad)" />
      </Svg>
      <View style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={{ color: Colors.textOnDark, fontSize: size * 0.42, fontWeight: '900' }}>
          {letter.toUpperCase()}
        </Text>
      </View>
    </View>
  );
}

// ─── Badge emoji lookup (subset) ─────────────────────────────
const BADGE_EMOJI: Record<string, string> = {
  'MVP': '👑', 'La Bombe': '💥', 'Le Smash': '🎯', 'Le Phénix': '🔥',
  'Le Mur': '🧱', "L'Essuie-glace": '🏃', 'Roi du Filet': '🥅',
  'Le Cerveau': '🧠', 'Le Capitaine': '⭐',
  'Fair-Play': '🤝', 'Bonne Ambiance': '😄', '3e Mi-temps': '🍻', 'Ponctuel': '⏰',
};

// ─── Hero compact — identité horizontale + bande de stats (handoff) ───
function ProfileBanner({ name, elo, wins, losses, badgeCount, notifCount, frmt, onBellPress }: {
  name: string; elo: number; wins: number; losses: number; badgeCount: number;
  notifCount: number; frmt?: { text: string; verified: boolean } | null;
  onBellPress: () => void;
}) {
  const leagueType = getLeague(elo);
  const leagueLabel = 'Ligue ' + getLeagueLabel(leagueType);
  const leagueHex = Colors.league[leagueType];
  const level = formatPadelLevel(elo);
  const total = wins + losses;
  const winPct = total > 0 ? Math.round((wins / total) * 100) : 0;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.35, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 1000, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const stats: { label: string; value: number | string; color: string }[] = [
    { label: 'MATCHS',    value: total,          color: Colors.textOnDark },
    { label: 'VICTOIRES', value: wins,           color: Colors.textOnDark },
    { label: 'WIN',       value: `${winPct}%`,   color: Colors.brand },
    { label: 'BADGES',    value: badgeCount,     color: '#fb923c' },
  ];

  return (
    <View style={{
      flex: 1, minHeight: 150, justifyContent: 'center',
      backgroundColor: Colors.heroBg, borderRadius: 22, overflow: 'hidden',
      paddingHorizontal: 18, paddingVertical: 16,
      shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 }, elevation: 7,
    }}>
      <NotificationBell count={notifCount} onPress={onBellPress} />

      {/* Glow orbs */}
      <View pointerEvents="none" style={{ position: 'absolute', top: -50, right: -30, width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(255,193,26,0.16)' }} />
      <View pointerEvents="none" style={{ position: 'absolute', bottom: -60, left: -40, width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(255,193,26,0.06)' }} />

      {/* Identity row — paddingRight pour laisser la cloche (absolue) respirer */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingRight: 44 }}>
        <GradientAvatar letter={name.charAt(0)} size={56} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 }}>
            <Animated.View style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: leagueHex, opacity: pulseAnim }} />
            <Text numberOfLines={1} style={{ fontSize: 9, fontWeight: '900', color: leagueHex, textTransform: 'uppercase', letterSpacing: 1.5 }}>
              {leagueLabel}
            </Text>
            {frmt ? (
              <Text numberOfLines={1} style={{ fontSize: 9, fontWeight: '900', color: frmt.verified ? '#34d399' : '#fbbf24', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                {`· FRMT ${frmt.text}${frmt.verified ? ' ✓' : ''}`}
              </Text>
            ) : null}
          </View>
          <Text numberOfLines={1} style={{ fontFamily: Fonts.welcome, fontSize: 23, color: Colors.textOnDark, letterSpacing: 0.3 }}>
            {name}
          </Text>
          <Text style={{ fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 15, color: Colors.brand, marginTop: 4 }}>
            Niveau {level}
          </Text>
        </View>
      </View>

      {/* Stats strip */}
      <View style={{ flexDirection: 'row', marginTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 12 }}>
        {stats.map((s, i) => (
          <View key={s.label} style={{ flex: 1, alignItems: 'center', borderLeftWidth: i ? 1 : 0, borderLeftColor: 'rgba(255,255,255,0.08)' }}>
            <Text style={{ fontFamily: Fonts.display, fontSize: 24, letterSpacing: -0.5, color: s.color }}>{s.value}</Text>
            <Text style={{ fontFamily: Fonts.uiBold, fontSize: 8.5, fontWeight: '700', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1.2, marginTop: 5 }}>{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Action card — flex-based, fills available space ──────────
const cardStyles = StyleSheet.create({
  wrapper: { flex: 1 },
  card: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderWidth: 1.5,
    borderColor: '#B8C8D8',
    shadowColor: '#0F172A',
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  badge: {
    position: 'absolute',
    top: -7,
    right: -7,
    minWidth: 20,
    height: 20,
    backgroundColor: '#7c3aed',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    paddingHorizontal: 3,
  },
  title: {
    fontFamily: Fonts.uiBold,
    fontWeight: '700',
    color: '#334155',
    fontSize: 13,
    textAlign: 'center',
  },
  sub: {
    color: Colors.textMuted,
    fontSize: 10,
    textAlign: 'center',
    lineHeight: 13,
    marginTop: 2,
  },
});

function ActionCard({ icon, iconBg, title, sub, badge, onPress }: {
  icon: React.ReactNode; iconBg: string; title: string; sub?: string;
  badge?: number; onPress: () => void;
}) {
  return (
    <View style={cardStyles.wrapper}>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.88}
        style={cardStyles.card}
      >
        {/* Icon + badge */}
        <View style={[cardStyles.iconBox, { backgroundColor: iconBg }]}>
          {icon}
          {badge != null && badge > 0 && (
            <View style={cardStyles.badge}>
              <Text style={{ color: Colors.textOnDark, fontSize: 10, fontWeight: '900' }}>{badge}</Text>
            </View>
          )}
        </View>

        <Text numberOfLines={1} style={cardStyles.title}>{title}</Text>
        {sub ? <Text numberOfLines={2} style={cardStyles.sub}>{sub}</Text> : null}
      </TouchableOpacity>
    </View>
  );
}

// ─── 2×2 action grid — flex fills remaining screen space ──────
function ActionsGrid({ upcomingGames, onNavigate }: {
  upcomingGames: OpenGame[];
  onNavigate: (path: string) => void;
}) {
  const nextGame = upcomingGames[0];
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 12, height: 132 }}>
        <ActionCard
          icon={<IconRadar size={24} color="#4f46e5" />}
          iconBg="#e0e7ff"
          title="Matchmaking"
          onPress={() => onNavigate('/(tabs)/lobby')}
        />
        <ActionCard
          icon={<IconPen size={24} color="#059669" />}
          iconBg="#d1fae5"
          title="Saisir un score"
          onPress={() => onNavigate('/score-entry')}
        />
      </View>
      <View style={{ flexDirection: 'row', gap: 12, height: 132 }}>
        <ActionCard
          icon={<IconTrophy size={24} color="#f59e0b" />}
          iconBg="#fef3c7"
          title="Classement"
          onPress={() => onNavigate('/(tabs)/ranking')}
        />
        <ActionCard
          icon={<IconCalendar size={24} color="#8b5cf6" />}
          iconBg="#ede9fe"
          title="À Venir"
          badge={upcomingGames.length}
          sub={nextGame?.match_date && nextGame?.location
            ? formatNextGame(nextGame.match_date, nextGame.location)
            : undefined}
          onPress={() => onNavigate('/(tabs)/lobby?tab=upcoming')}
        />
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────
export default function HomeScreen() {
  const { player, refresh } = usePlayer();
  const { total: notifTotal, reload: reloadNotifs } = useNotificationCount();
  const [badgeCount, setBadgeCount] = useState(0);
  const [upcomingGames, setUpcomingGames] = useState<OpenGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [badgeMatches, setBadgeMatches] = useState<any[]>([]);
  const [badgeDefs, setBadgeDefs] = useState<any[]>([]);
  const [badgeModalMatch, setBadgeModalMatch] = useState<any>(null);
  const [badgeVotes, setBadgeVotes] = useState<Record<string, string[]>>({});
  const [submittingBadges, setSubmittingBadges] = useState(false);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    supabase.from('badges').select('*').eq('is_active', true).then(({ data }) => {
      if (data) setBadgeDefs(data.filter((b: any) => b.label !== 'MVP'));
    });
  }, []);

  const fetchData = useCallback(async () => {
    if (!player) return;
    const now = new Date().toISOString();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const playerOr = `winner_id.eq.${player.id},loser_id.eq.${player.id},winner_id_2.eq.${player.id},loser_id_2.eq.${player.id}`;

    const [
      { count: badges },
      { data: participations },
      { data: recentMatches },
      { data: alreadyVoted },
    ] = await Promise.all([
      supabase
        .from('reputation_votes')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', player.id),
      supabase
        .from('game_participants')
        .select('game_id')
        .eq('player_id', player.id)
        .eq('status', 'accepted'),
      supabase
        .from('matches')
        .select('id, score_text, winner_id, winner_id_2, loser_id, loser_id_2, winner:winner_id(id, name), winner_2:winner_id_2(id, name), loser:loser_id(id, name), loser_2:loser_id_2(id, name)')
        .or(playerOr)
        .in('status', ['pending', 'validated'])
        .gte('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false }),
      supabase
        .from('reputation_votes')
        .select('match_id')
        .eq('giver_id', player.id),
    ]);

    setBadgeCount(badges ?? 0);

    const votedIds = new Set((alreadyVoted ?? []).map((v: any) => v.match_id));
    const pendingBadge = (recentMatches ?? []).filter((m: any) => !votedIds.has(m.id));
    setBadgeMatches(pendingBadge);

    const ids = (participations ?? []).map((p: any) => p.game_id);
    const orFilter = ids.length > 0
      ? `creator_id.eq.${player.id},id.in.(${ids.join(',')})`
      : `creator_id.eq.${player.id}`;

    const { data: upcoming } = await supabase
      .from('open_games')
      .select('id, location, match_date, status, creator_id, spots_available, game_format')
      .gt('match_date', now)
      .neq('status', 'cancelled')
      .or(orFilter)
      .order('match_date', { ascending: true })
      .limit(5);

    setUpcomingGames((upcoming as OpenGame[]) ?? []);

    setLoading(false);
  }, [player]);

  const { openBadge } = useLocalSearchParams<{ openBadge?: string }>();
  const autoOpenedBadge = useRef(false);

  useFocusEffect(useCallback(() => {
    fetchData();
    reloadNotifs();
  }, [fetchData, reloadNotifs]));

  useEffect(() => {
    if (openBadge === '1' && !loading && badgeMatches.length > 0 && !autoOpenedBadge.current) {
      autoOpenedBadge.current = true;
      openBadgeModal(badgeMatches[0]);
      router.setParams({ openBadge: undefined });
    }
  }, [openBadge, loading, badgeMatches]);

  const openBadgeModal = (m: any) => {
    setBadgeModalMatch(m);
    setBadgeVotes({});
  };

  const toggleBadgeVote = (playerId: string, label: string) => {
    setBadgeVotes(prev => {
      const curr = prev[playerId] ?? [];
      return { ...prev, [playerId]: curr.includes(label) ? curr.filter(b => b !== label) : [...curr, label] };
    });
  };

  const handleSubmitBadges = async () => {
    if (!player || !badgeModalMatch) return;
    setSubmittingBadges(true);
    const inserts = Object.entries(badgeVotes).flatMap(([rid, labels]) =>
      labels.map(label => ({ match_id: badgeModalMatch.id, giver_id: player.id, receiver_id: rid, badge_type: label }))
    );
    if (inserts.length > 0) await supabase.from('reputation_votes').insert(inserts);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setBadgeMatches(prev => prev.filter(m => m.id !== badgeModalMatch.id));
    setBadgeModalMatch(null);
    setBadgeVotes({});
    setSubmittingBadges(false);
  };

  if (!player) return null;

  const matchCount = player.win_count + player.loss_count;
  // Bell total comes from the shared hook so Home and Profile always match.
  const totalNotifs = notifTotal;
  const now = new Date();
  const visibleUpcoming = upcomingGames.filter(g => !g.match_date || new Date(g.match_date) > now);

  return (
    <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
      <View style={{
        flex: 1,
        paddingHorizontal: 14,
        paddingTop: insets.top + 8,
        paddingBottom: 8,
      }}>
        {/* Header — logo PAG MATCH (identique au splash de chargement) */}
        <View style={{ alignItems: 'center', marginBottom: 12 }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: Colors.heroBg,
            paddingHorizontal: 18, paddingVertical: 9,
            borderRadius: 999,
          }}>
            <Image
              source={require('../../assets/auth/splash-racket.png')}
              style={{ width: 26, height: 26 }}
              resizeMode="contain"
            />
            <Image
              source={require('../../assets/auth/splash-wordmark.png')}
              style={{ width: 118, height: 26, marginLeft: -8 }}
              resizeMode="contain"
            />
          </View>
        </View>

        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ flex: 1 }} />
        ) : (
          <>
            {/* Badge modal — déclenché depuis la cloche via ?openBadge=1 */}
            <Modal visible={!!badgeModalMatch} animationType="slide" presentationStyle="pageSheet">
              <View style={{ flex: 1, backgroundColor: Colors.bg }}>
                <View style={{ backgroundColor: Colors.heroBg, paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: 24 }}>
                  <TouchableOpacity onPress={() => setBadgeModalMatch(null)} style={{ marginBottom: 12, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 }}>
                    <Text style={{ color: Colors.textOnDark, fontFamily: Fonts.uiBold, fontWeight: '700', fontSize: 13 }}>✕ Fermer</Text>
                  </TouchableOpacity>
                  <Text style={{ fontSize: 22, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textOnDark }}>
                    <Text>🏅 Distribue tes </Text>
                    <Text style={{ color: Colors.brand }}>trophées</Text>
                  </Text>
                  <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>
                    {badgeModalMatch?.score_text ?? ''}
                  </Text>
                </View>
                <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
                  {badgeModalMatch && (
                    [badgeModalMatch.winner, badgeModalMatch.winner_2, badgeModalMatch.loser, badgeModalMatch.loser_2]
                      .filter((p: any) => p && p.id !== player.id)
                      .map((p: any) => {
                        const myVotes = badgeVotes[p.id] ?? [];
                        return (
                          <View key={p.id} style={{ backgroundColor: Colors.bgCard, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, padding: 14, marginBottom: 12 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                              <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>Pour {p.name}</Text>
                              {myVotes.length > 0 && (
                                <View style={{ backgroundColor: '#EDE9FE', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                                  <Text style={{ fontSize: 10, fontWeight: '900', color: '#5B21B6' }}>
                                    {myVotes.length} trophée{myVotes.length > 1 ? 's' : ''}
                                  </Text>
                                </View>
                              )}
                            </View>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                              {badgeDefs.map((b: any) => {
                                const sel = myVotes.includes(b.label);
                                return (
                                  <TouchableOpacity key={b.id} onPress={() => toggleBadgeVote(p.id, b.label)} activeOpacity={0.75}
                                    style={{ alignItems: 'center', gap: 4, padding: 10, borderRadius: 14, width: 72, borderWidth: 1.5, borderColor: sel ? '#6366f1' : '#e2e8f0', backgroundColor: sel ? '#eef2ff' : '#fff', position: 'relative' }}>
                                    <Text style={{ fontSize: 20 }}>{BADGE_EMOJI[b.label] ?? '🏅'}</Text>
                                    <Text style={{ fontSize: 8, fontWeight: '900', color: sel ? '#4338ca' : '#94a3b8', textTransform: 'uppercase', textAlign: 'center', letterSpacing: 0.3 }}>{b.label}</Text>
                                    {sel && (
                                      <View style={{ position: 'absolute', top: -5, right: -5, width: 14, height: 14, backgroundColor: Colors.primary, borderRadius: 999, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' }}>
                                        <Text style={{ fontSize: 7, color: Colors.textOnDark, fontWeight: '900' }}>✓</Text>
                                      </View>
                                    )}
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          </View>
                        );
                      })
                  )}
                  <TouchableOpacity onPress={handleSubmitBadges} disabled={submittingBadges}
                    style={{ backgroundColor: Colors.primary, borderRadius: 16, padding: 16, alignItems: 'center', opacity: submittingBadges ? 0.6 : 1 }}>
                    {submittingBadges
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textOnDark }}>Envoyer les trophées</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { setBadgeMatches(prev => prev.filter(m => m.id !== badgeModalMatch?.id)); setBadgeModalMatch(null); }}
                    style={{ marginTop: 10, alignItems: 'center', padding: 12 }}>
                    <Text style={{ fontSize: 13, color: Colors.textMuted, fontWeight: '600' }}>Passer sans noter</Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
            </Modal>

            <View style={{ flex: 1, marginTop: 12 }}>
              <ProfileBanner
                name={player.name}
                elo={player.elo_score}
                wins={player.win_count}
                losses={player.loss_count}
                badgeCount={badgeCount}
                notifCount={totalNotifs}
                frmt={formatFrmtRanking(player)}
                onBellPress={() => router.push('/notifications' as any)}
              />
            </View>
            <View style={{ marginTop: 12 }}>
              <ActionsGrid
                upcomingGames={visibleUpcoming}
                onNavigate={(path) => router.push(path as any)}
              />
              <View style={{ marginTop: 12 }}>
                <CommunityCard />
              </View>
            </View>
          </>
        )}
      </View>
    </View>
  );
}
