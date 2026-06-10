import { Tabs, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { TouchableOpacity, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Path, Line, Polyline } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../hooks/usePlayer';
import { useNotificationCount } from '../../hooks/useNotificationCount';
import { isMatchPast } from '../../hooks/useGameChats';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../lib/theme';
import HelpCenter from '../../components/HelpCenter';
import OnboardingCarousel from '../../components/OnboardingCarousel';
import { GUIDE_KEY } from '../../lib/guideTheme';

const IconHome = ({ color, size = 22 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <Polyline points="9 22 9 12 15 12 15 22" />
  </Svg>
);

const IconSwords = ({ color, size = 22 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
    <Line x1="13" y1="19" x2="19" y2="13" />
    <Line x1="16" y1="16" x2="20" y2="20" />
    <Line x1="19" y1="21" x2="21" y2="19" />
    <Polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" />
    <Line x1="5" y1="14" x2="9" y2="18" />
    <Line x1="7" y1="17" x2="4" y2="20" />
    <Line x1="3" y1="19" x2="5" y2="21" />
  </Svg>
);

const IconMessage = ({ color, size = 22 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </Svg>
);

const IconPlus = ({ size = 20 }: { size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={Colors.brand} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <Line x1="12" y1="5" x2="12" y2="19" />
    <Line x1="5" y1="12" x2="19" y2="12" />
  </Svg>
);

function AvatarTabIcon({ name, focused, badge }: { name: string; focused: boolean; badge: number }) {
  return (
    <View>
      <View style={{
        width: 28, height: 28, borderRadius: 999,
        backgroundColor: focused ? Colors.primary : Colors.bgCardAlt,
        alignItems: 'center', justifyContent: 'center',
        borderWidth: focused ? 0 : 1, borderColor: Colors.border,
      }}>
        <Text style={{ color: focused ? '#fff' : Colors.textMuted, fontSize: 12, fontWeight: '900' }}>
          {name.charAt(0).toUpperCase()}
        </Text>
      </View>
      {badge > 0 && (
        <View style={{
          position: 'absolute', top: -5, right: -8,
          minWidth: 16, height: 16, backgroundColor: Colors.brand,
          borderRadius: 999, alignItems: 'center', justifyContent: 'center',
          paddingHorizontal: 3, borderWidth: 2, borderColor: Colors.bgCard,
        }}>
          <Text style={{ color: Colors.textOnBrand, fontSize: 8, fontWeight: '900' }}>{badge}</Text>
        </View>
      )}
    </View>
  );
}

function CreateTabButton({ ...rest }: any) {
  const router = useRouter();
  return (
    <TouchableOpacity
      {...rest}
      onPress={() => router.push('/(tabs)/lobby?create=1' as any)}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 }}
      activeOpacity={0.85}
    >
      <View style={{
        width: 36, height: 36, borderRadius: 999,
        backgroundColor: Colors.primary,
        alignItems: 'center', justifyContent: 'center',
        shadowColor: Colors.primary, shadowOpacity: 0.3, shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 }, elevation: 5,
      }}>
        <IconPlus size={20} />
      </View>
      <Text style={{ color: Colors.textMuted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 }}>
        Créer
      </Text>
    </TouchableOpacity>
  );
}

export default function TabLayout() {
  const { player, loading } = usePlayer();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Défis reçus — lus depuis l'état notif PARTAGÉ (NotificationProvider), donc le
  // badge se vide dès qu'un défi est accepté/décliné, sans redémarrage de l'app.
  const { challenges: challengeCount } = useNotificationCount();
  const [chatBadge, setChatBadge] = useState(0);
  // null = lecture du flag en cours · false = afficher l'onboarding · true = vu.
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(GUIDE_KEY).then(v => setHasSeenOnboarding(!!v));
  }, []);

  const finishOnboarding = () => {
    AsyncStorage.setItem(GUIDE_KEY, '1');
    setHasSeenOnboarding(true);
  };

  // Auth redirect is handled by the root _layout.tsx navigator — don't redirect here
  // as router.replace('/') from within tabs resolves to (tabs)/index, not app/index.tsx

  // Chat badge: sum of per-game unread messages (mirrors chats.tsx logic),
  // kept live via realtime on `messages` and `game_chat_reads`.
  useEffect(() => {
    if (!player) return;

    let cancelled = false;
    let gameIds: string[] = [];
    const unreadByGame = new Map<string, number>();
    // Archived games are excluded from the badge (badge = active chats only).
    const archivedIds = new Set<string>();

    const recomputeTotal = () => {
      if (cancelled) return;
      let total = 0;
      unreadByGame.forEach((v, gid) => { if (!archivedIds.has(gid)) total += v; });
      setChatBadge(total);
    };

    const load = async () => {
      const [{ data: parts }, { data: created }] = await Promise.all([
        supabase.from('game_participants').select('game:game_id(id, match_date)').eq('player_id', player.id).eq('status', 'accepted'),
        supabase.from('open_games').select('id, match_date').eq('creator_id', player.id),
      ]);
      const matchDateById = new Map<string, string | null>();
      const ids = new Set<string>();
      (parts ?? []).forEach((p: any) => {
        const g = p.game;
        if (g?.id) { ids.add(g.id); matchDateById.set(g.id, g.match_date ?? null); }
      });
      (created ?? []).forEach((g: any) => {
        if (g.id) { ids.add(g.id); matchDateById.set(g.id, g.match_date ?? null); }
      });
      gameIds = [...ids];
      unreadByGame.clear();
      archivedIds.clear();

      if (gameIds.length === 0) { recomputeTotal(); return; }

      // Validated score OR match past (+24h grace) → archived, excluded from badge.
      const { data: validated } = await supabase
        .from('matches').select('game_id').in('game_id', gameIds).eq('status', 'validated');
      const validatedIds = new Set((validated ?? []).map((m: any) => m.game_id).filter(Boolean));
      gameIds.forEach(gid => {
        if (validatedIds.has(gid) || isMatchPast(matchDateById.get(gid))) archivedIds.add(gid);
      });

      const { data: reads } = await supabase
        .from('game_chat_reads')
        .select('game_id, last_read_at')
        .eq('player_id', player.id);
      const readMap = new Map<string, string>((reads ?? []).map((r: any) => [r.game_id, r.last_read_at]));

      await Promise.all(gameIds.map(async (gid) => {
        const lastRead = readMap.get(gid) ?? '1970-01-01';
        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('game_id', gid)
          .gt('created_at', lastRead)
          .neq('player_id', player.id);
        unreadByGame.set(gid, count ?? 0);
      }));
      recomputeTotal();
    };

    load();

    // Unique per mount: avoids reusing a still-subscribed channel after Fast Refresh
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const msgCh = supabase
      .channel(`tab-chat-badge-msgs:${player.id}:${suffix}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        const m = payload.new as { game_id: string; player_id: string } | null;
        if (!m || m.player_id === player.id) return;
        if (!gameIds.includes(m.game_id)) return;
        unreadByGame.set(m.game_id, (unreadByGame.get(m.game_id) ?? 0) + 1);
        recomputeTotal();
      })
      .subscribe();

    const readCh = supabase
      .channel(`tab-chat-badge-reads:${player.id}:${suffix}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_chat_reads', filter: `player_id=eq.${player.id}` }, payload => {
        const r = payload.new as { game_id: string } | null;
        if (!r?.game_id) return;
        unreadByGame.set(r.game_id, 0);
        recomputeTotal();
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(msgCh);
      supabase.removeChannel(readCh);
    };
  }, [player]);

  const playerName = player?.name ?? 'P';
  const totalBadge = challengeCount + chatBadge;

  return (
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: 'rgba(255,255,255,0.97)',
          borderTopColor: Colors.borderLight,
          borderTopWidth: 1,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          height: 64 + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 6,
          shadowColor: Colors.textPrimary,
          shadowOpacity: 0.06,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: -4 },
          elevation: 12,
        },
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Accueil',
          tabBarIcon: ({ color }) => <IconHome color={color} size={22} />,
        }}
      />
      <Tabs.Screen
        name="matchmaking"
        options={{
          title: 'Défi',
          tabBarBadge: challengeCount > 0 ? challengeCount : undefined,
          tabBarBadgeStyle: { backgroundColor: Colors.warning, fontSize: 9, minWidth: 16, height: 16 },
          tabBarIcon: ({ color }) => <IconSwords color={color} size={22} />,
        }}
      />
      <Tabs.Screen
        name="lobby"
        options={{
          title: '',
          tabBarLabel: () => null,
          tabBarButton: (props) => <CreateTabButton {...props} />,
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarBadge: chatBadge > 0 ? chatBadge : undefined,
          tabBarBadgeStyle: { backgroundColor: Colors.danger, fontSize: 9, minWidth: 16, height: 16 },
          tabBarIcon: ({ color }) => <IconMessage color={color} size={22} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ focused }) => <AvatarTabIcon name={playerName} focused={focused} badge={totalBadge} />,
        }}
      />
      {/* Hidden from tab bar */}
      <Tabs.Screen name="ranking" options={{ href: null }} />
      <Tabs.Screen name="GameDetailsSheet" options={{ href: null }} />
      <Tabs.Screen name="CreateWizard" options={{ href: null }} />
      <Tabs.Screen name="player/[id]" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="admin" options={{ href: null }} />
    </Tabs>
    {/* Bouton « ? » + centre d'aide — toujours monté, par-dessus les tabs */}
    <HelpCenter />
    {/* Onboarding plein écran — uniquement au premier lancement, avant les tabs */}
    {hasSeenOnboarding === false && <OnboardingCarousel onDone={finishOnboarding} />}
    </View>
  );
}
