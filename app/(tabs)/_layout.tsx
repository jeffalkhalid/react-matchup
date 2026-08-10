import { Tabs, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { TouchableOpacity, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Path, Line, Polyline } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../hooks/usePlayer';
import { useNotificationCount } from '../../hooks/useNotificationCount';
import { useGameChats } from '../../hooks/useGameChats';
import { supabase } from '../../lib/supabase';
import { fetchUnreadCounts } from '../../lib/directChats';
import { Colors } from '../../lib/theme';
import HelpCenter from '../../components/HelpCenter';
import OnboardingCarousel from '../../components/OnboardingCarousel';
import { GUIDE_KEY } from '../../lib/guideTheme';

// Écran d'ouverture de l'app : l'Accueil (hero profil + prochain match).
// API native expo-router (le préfixe `unstable_` est hérité de Next.js, l'option est stable).
export const unstable_settings = {
  initialRouteName: 'index',
};

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

const IconActivity = ({ color, size = 22 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </Svg>
);

const IconPlus = ({ size = 20 }: { size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={Colors.brand} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <Line x1="12" y1="5" x2="12" y2="19" />
    <Line x1="5" y1="12" x2="19" y2="12" />
  </Svg>
);

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
        width: 46, height: 46, borderRadius: 999,
        backgroundColor: Colors.primary,
        alignItems: 'center', justifyContent: 'center',
        borderWidth: 4, borderColor: '#fff',
        transform: [{ translateY: -18 }],
        shadowColor: Colors.primary, shadowOpacity: 0.35, shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 }, elevation: 8, zIndex: 10,
      }}>
        <IconPlus size={22} />
      </View>
      <Text style={{ marginTop: -14, color: Colors.textMuted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 }}>
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
  const [directUnread, setDirectUnread] = useState(0);

  // Badge Chats — DÉRIVÉ de la source unique useGameChats (même liste, mêmes
  // règles d'archivage et de non-lus que l'écran Chats + Archivés, realtime
  // inclus). Avant : logique « miroir » dupliquée ici, qui divergeait déjà
  // (elle comptait les chats de parties ANNULÉES, absentes de l'écran Chats).
  const { games: chatGames, loadGames } = useGameChats();
  useEffect(() => { loadGames(); }, [loadGames]);
  const chatBadge = useMemo(
    () => chatGames.filter(g => !g.archived).reduce((sum, g) => sum + g.unread, 0),
    [chatGames],
  );
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

  // Non-lus directs (DM) = TOTAL des messages non lus (style WhatsApp), demandes
  // reçues incluses (leur message d'intro compte pour 1 tant que non ouvert).
  // Basé sur le non-lu → l'ouverture (mark_direct_read) décrémente le badge.
  // (Le badge des chats de PARTIES, lui, vient de useGameChats ci-dessus.)
  useEffect(() => {
    if (!player) return;

    let cancelled = false;
    const recomputeDirect = async () => {
      try {
        const counts = await fetchUnreadCounts(player.id);
        let dUnread = 0;
        counts.forEach(n => { dUnread += n; });
        if (!cancelled) setDirectUnread(dUnread);
      } catch {}
    };

    recomputeDirect();

    // Unique per mount: avoids reusing a still-subscribed channel after Fast Refresh
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Nouveau message direct → recalcul du non-lu.
    const dmCh = supabase
      .channel(`tab-chat-badge-dm:${player.id}:${suffix}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, payload => {
        const dm = payload.new as { sender_id: string } | null;
        if (!dm || dm.sender_id === player.id) return;
        recomputeDirect();
      })
      .subscribe();

    // Changement de conversation directe (nouvelle demande, accusé de lecture,
    // acceptation/refus) → recalcul. C'est ce qui fait DISPARAÎTRE le badge dès
    // que j'ouvre la demande (mark_direct_read met à jour la conversation).
    const convCh = supabase
      .channel(`tab-chat-badge-dmconv:${player.id}:${suffix}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_conversations' }, () => {
        recomputeDirect();
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(dmCh);
      supabase.removeChannel(convCh);
    };
  }, [player]);

  return (
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: 'rgba(255,255,255,0.97)',
          overflow: 'visible',
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
        name="activite"
        options={{
          title: 'Activité',
          tabBarIcon: ({ color }) => <IconActivity color={color} size={22} />,
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
        name="matchmaking"
        options={{
          title: 'Défi',
          tabBarBadge: challengeCount > 0 ? challengeCount : undefined,
          tabBarBadgeStyle: { backgroundColor: Colors.warning, fontSize: 9, minWidth: 16, height: 16 },
          tabBarIcon: ({ color }) => <IconSwords color={color} size={22} />,
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarBadge: (chatBadge + directUnread) > 0 ? (chatBadge + directUnread) : undefined,
          tabBarBadgeStyle: { backgroundColor: Colors.danger, fontSize: 9, minWidth: 16, height: 16 },
          tabBarIcon: ({ color }) => <IconMessage color={color} size={22} />,
        }}
      />
      {/* Hidden from tab bar */}
      <Tabs.Screen name="GameDetailsSheet" options={{ href: null }} />
      <Tabs.Screen name="CreateWizard" options={{ href: null }} />
      <Tabs.Screen name="admin" options={{ href: null }} />
    </Tabs>
    {/* Bouton « ? » + centre d'aide — toujours monté, par-dessus les tabs */}
    <HelpCenter />
    {/* Onboarding plein écran — uniquement au premier lancement, avant les tabs */}
    {hasSeenOnboarding === false && <OnboardingCarousel onDone={finishOnboarding} />}
    </View>
  );
}
