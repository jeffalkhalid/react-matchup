import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity,
  ActivityIndicator, Animated, LayoutAnimation,
  Platform, UIManager, Alert, StyleSheet,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Path, Circle, Rect,
  Defs, LinearGradient as SvgLinearGradient, Stop,
} from 'react-native-svg';
import { usePlayer } from '../../hooks/usePlayer';
import { supabase } from '../../lib/supabase';
import { Colors, formatPadelLevel, getLeague, getLeagueLabel } from '../../lib/theme';
import type { Match, OpenGame } from '../../types';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Helpers ─────────────────────────────────────────────────
function formatNextGame(matchDate: string, location: string): string {
  const date = new Date(matchDate);
  const now  = new Date();
  const diffDays = Math.floor((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const dayLabel = diffDays === 0 ? "Aujourd'hui"
    : diffDays === 1 ? 'Demain'
    : date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const place = location.length > 14 ? location.slice(0, 13) + '…' : location;
  return `${dayLabel} · ${time}\n${place}`;
}

// ─── SVG Icons ───────────────────────────────────────────────
const IconRadar = ({ size = 24, color = '#4f46e5' }) => (
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

const IconPen = ({ size = 24, color = '#059669' }) => (
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

const IconAlertTriangle = ({ size = 18, color = '#92400e' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <Path stroke={color} d="M12 9v4"/>
    <Path stroke={color} d="M12 17h.01"/>
  </Svg>
);

const IconChevronUp = ({ size = 14, color = '#fbbf24' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M18 15l-6-6-6 6"/>
  </Svg>
);

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
        <Text style={{ color: '#fff', fontSize: size * 0.42, fontWeight: '900' }}>
          {letter.toUpperCase()}
        </Text>
      </View>
    </View>
  );
}

// ─── Pending banner ───────────────────────────────────────────
function PendingBanner({ matches, onValidate, onContest }: {
  matches: Match[];
  onValidate: (m: Match) => void;
  onContest: (m: Match) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (matches.length === 0) return null;

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(v => !v);
  };

  return (
    <View style={{ marginBottom: 10 }}>
      <TouchableOpacity
        onPress={toggle}
        activeOpacity={0.85}
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 14, paddingVertical: 11,
          backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FDE68A', borderRadius: 14,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <IconAlertTriangle size={16} color="#92400e" />
          <Text style={{ fontWeight: '900', color: '#78350F', fontSize: 13 }}>
            {matches.length} match{matches.length > 1 ? 's' : ''} à traiter
          </Text>
          <View style={{
            backgroundColor: '#F59E0B', width: 18, height: 18, borderRadius: 999,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ color: '#fff', fontSize: 9, fontWeight: '900' }}>{matches.length}</Text>
          </View>
        </View>
        <Animated.View style={{ transform: [{ rotate: expanded ? '0deg' : '180deg' }] }}>
          <IconChevronUp size={13} color="#fbbf24" />
        </Animated.View>
      </TouchableOpacity>

      {expanded && (
        <View style={{
          marginTop: 4, borderWidth: 1, borderColor: '#FEF3C7',
          borderRadius: 14, backgroundColor: '#fff', overflow: 'hidden',
        }}>
          {matches.map((m, i) => {
            const winnerNames = [m.winner?.name, m.winner_2?.name].filter(Boolean).join(' & ') || '?';
            const loserNames  = [m.loser?.name,  m.loser_2?.name ].filter(Boolean).join(' & ') || '?';
            return (
              <View key={m.id} style={{
                padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10,
                borderBottomWidth: i < matches.length - 1 ? 1 : 0, borderBottomColor: '#f8fafc',
              }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3, alignItems: 'baseline' }}>
                    <Text style={{ fontWeight: '900', color: '#059669', fontSize: 11 }}>{winnerNames}</Text>
                    <Text style={{ color: '#94a3b8', fontSize: 9 }}>bat</Text>
                    <Text style={{ fontWeight: '900', color: '#ef4444', fontSize: 11 }}>{loserNames}</Text>
                    {m.score_text ? (
                      <Text style={{ color: '#64748b', fontWeight: '700', fontSize: 10, fontStyle: 'italic' }}>— {m.score_text}</Text>
                    ) : null}
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 5 }}>
                  <TouchableOpacity onPress={() => onValidate(m)} style={{
                    height: 30, paddingHorizontal: 9, borderRadius: 10,
                    backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ fontSize: 12 }}>✅</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onContest(m)} style={{
                    height: 30, paddingHorizontal: 9, borderRadius: 10,
                    backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ fontSize: 12 }}>✏️</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ─── Profile hero card — centered vertical layout ─────────────
function ProfileBanner({ name, elo, matchCount, badgeCount }: {
  name: string; elo: number; matchCount: number; badgeCount: number;
}) {
  const leagueType = getLeague(elo);
  const leagueLabel = 'Ligue ' + getLeagueLabel(leagueType);
  const leagueHex = Colors.league[leagueType];
  const level = formatPadelLevel(elo);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.35, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 1000, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <View style={{
      backgroundColor: '#102820', borderRadius: 24, overflow: 'hidden',
      paddingTop: 22, paddingBottom: 20, paddingHorizontal: 20,
      alignItems: 'center',
      shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 }, elevation: 7,
    }}>
      {/* Glow orbs */}
      <View style={{
        position: 'absolute', top: -60, right: -40,
        width: 180, height: 180, borderRadius: 90,
        backgroundColor: 'rgba(99,102,241,0.22)',
      }} />
      <View style={{
        position: 'absolute', bottom: -60, left: -40,
        width: 180, height: 180, borderRadius: 90,
        backgroundColor: 'rgba(16,185,129,0.22)',
      }} />

      {/* Avatar */}
      <GradientAvatar letter={name.charAt(0)} size={68} />

      {/* League badge */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: 'rgba(148,163,184,0.12)',
        borderWidth: 1, borderColor: 'rgba(148,163,184,0.22)',
        paddingHorizontal: 12, paddingVertical: 4,
        borderRadius: 999, marginTop: 12, marginBottom: 5,
      }}>
        <Animated.View style={{
          width: 5, height: 5, borderRadius: 999,
          backgroundColor: leagueHex, opacity: pulseAnim,
        }} />
        <Text style={{
          fontSize: 9, fontWeight: '900', color: leagueHex,
          textTransform: 'uppercase', letterSpacing: 1.5,
        }}>
          {leagueLabel}
        </Text>
      </View>

      {/* Name */}
      <Text style={{
        fontSize: 26, fontWeight: '900', color: '#fff',
        letterSpacing: -0.5, textAlign: 'center', marginBottom: 3,
      }}>
        {name}
      </Text>

      {/* Level */}
      <Text style={{
        fontSize: 17, fontWeight: '900', color: '#34d399',
        textAlign: 'center', marginBottom: 3,
      }}>
        Niveau {level}
      </Text>

      {/* Subtitle */}
      <Text style={{
        fontSize: 12, color: '#94a3b8', fontWeight: '500',
        textAlign: 'center', marginBottom: 16,
      }}>
        Prêt à jouer ?
      </Text>

      {/* Divider */}
      <View style={{
        height: 1, width: '100%',
        backgroundColor: 'rgba(255,255,255,0.1)', marginBottom: 16,
      }} />

      {/* Stats */}
      <View style={{ flexDirection: 'row', gap: 48 }}>
        {[
          { label: 'MATCHS', value: matchCount, color: '#fff',    bg: 'rgba(255,255,255,0.08)',    border: 'rgba(255,255,255,0.14)' },
          { label: 'BADGES', value: badgeCount, color: '#fb923c', bg: 'rgba(251,146,60,0.13)',     border: 'rgba(251,146,60,0.28)'  },
        ].map(s => (
          <View key={s.label} style={{ alignItems: 'center', gap: 6 }}>
            <Text style={{
              fontSize: 9, fontWeight: '700', color: '#64748b',
              textTransform: 'uppercase', letterSpacing: 1.2,
            }}>
              {s.label}
            </Text>
            <View style={{
              width: 48, height: 48, borderRadius: 999,
              backgroundColor: s.bg, borderWidth: 1, borderColor: s.border,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ fontSize: 18, fontWeight: '900', color: s.color }}>
                {s.value}
              </Text>
            </View>
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
    paddingVertical: 14,
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
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
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
    fontWeight: '700',
    color: '#334155',
    fontSize: 13,
    textAlign: 'center',
  },
  sub: {
    color: '#94a3b8',
    fontSize: 10,
    textAlign: 'center',
    lineHeight: 14,
    marginTop: 3,
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
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '900' }}>{badge}</Text>
            </View>
          )}
        </View>

        <Text style={cardStyles.title}>{title}</Text>
        {sub ? <Text style={cardStyles.sub}>{sub}</Text> : null}
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
    <View style={{ flex: 1, gap: 12 }}>
      <View style={{ flex: 1, flexDirection: 'row', gap: 12 }}>
        <ActionCard
          icon={<IconRadar size={24} color="#4f46e5" />}
          iconBg="#e0e7ff"
          title="Trouver un match"
          onPress={() => onNavigate('/(tabs)/lobby')}
        />
        <ActionCard
          icon={<IconPen size={24} color="#059669" />}
          iconBg="#d1fae5"
          title="Saisir un score"
          onPress={() => onNavigate('/score-entry')}
        />
      </View>
      <View style={{ flex: 1, flexDirection: 'row', gap: 12 }}>
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
          onPress={() => onNavigate('/(tabs)/lobby?tab=upcoming&role=playing')}
        />
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────
export default function HomeScreen() {
  const { player, refresh } = usePlayer();
  const [pendingMatches, setPendingMatches] = useState<Match[]>([]);
  const [badgeCount, setBadgeCount] = useState(0);
  const [upcomingGames, setUpcomingGames] = useState<OpenGame[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const fetchData = useCallback(async () => {
    if (!player) return;
    const now = new Date().toISOString();

    const [
      { data: pending },
      { count: badges },
      { data: participations },
    ] = await Promise.all([
      supabase
        .from('matches')
        .select('*, winner:winner_id(name), winner_2:winner_id_2(name), loser:loser_id(name), loser_2:loser_id_2(name)')
        .or(`winner_id.eq.${player.id},loser_id.eq.${player.id},winner_id_2.eq.${player.id},loser_id_2.eq.${player.id}`)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('reputation_votes')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', player.id),
      supabase
        .from('game_participants')
        .select('game_id')
        .eq('player_id', player.id)
        .eq('status', 'accepted'),
    ]);

    setPendingMatches((pending as Match[]) ?? []);
    setBadgeCount(badges ?? 0);

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

  useFocusEffect(useCallback(() => {
    fetchData();
  }, [fetchData]));

  const handleValidate = async (match: Match) => {
    const { error } = await supabase
      .from('matches')
      .update({ status: 'validated' })
      .eq('id', match.id);
    if (error) { Alert.alert('Erreur', 'Impossible de valider ce match.'); return; }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setPendingMatches(prev => prev.filter(m => m.id !== match.id));
  };

  const handleContest = () => router.push('/score-entry' as any);

  if (!player) return null;

  const matchCount = player.win_count + player.loss_count;

  return (
    <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
      <View style={{
        flex: 1,
        paddingHorizontal: 14,
        paddingTop: insets.top + 8,
        paddingBottom: 8,
      }}>
        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ flex: 1 }} />
        ) : (
          <>
            <PendingBanner
              matches={pendingMatches}
              onValidate={handleValidate}
              onContest={handleContest}
            />
            <ProfileBanner
              name={player.name}
              elo={player.elo_score}
              matchCount={matchCount}
              badgeCount={badgeCount}
            />
            <View style={{ flex: 1, marginTop: 12 }}>
              <ActionsGrid
                upcomingGames={upcomingGames}
                onNavigate={(path) => router.push(path as any)}
              />
            </View>
          </>
        )}
      </View>
    </View>
  );
}
