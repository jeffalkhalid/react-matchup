import { useCallback, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import { usePlayer } from '../../hooks/usePlayer';
import { useNotificationCount } from '../../hooks/useNotificationCount';
import { getNotificationsEnabled, enableNotificationsFromApp } from '../../hooks/usePushNotifications';
import { supabase } from '../../lib/supabase';
import { buildNotificationItems, isDismissibleNotif, type NotifItem } from '../../lib/notifications';
import { Colors, Fonts } from '../../lib/theme';

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

// ─── Screen ───────────────────────────────────────────────────
export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { player } = usePlayer();
  // Compteur partagé de la cloche : on le rafraîchit après une suppression "info"
  // pour que le badge reste cohérent avec la liste affichée ici.
  const { reload: reloadNotifs } = useNotificationCount();
  const [items, setItems] = useState<NotifItem[]>([]);
  const [loading, setLoading] = useState(true);
  // null = pas encore vérifié ; false = notifs désactivées → on montre la bannière.
  const [notifsOn, setNotifsOn] = useState<boolean | null>(null);
  const hasLoadedRef = useRef(false);

  const fetchNotifs = useCallback(async () => {
    if (!player) return;
    // Stale-while-revalidate : spinner seulement au 1er chargement ; ensuite on
    // garde la liste affichée et on rafraîchit en arrière-plan.
    if (!hasLoadedRef.current) setLoading(true);

    // Source UNIQUE de la liste (lib/notifications.buildNotificationItems),
    // partagée avec le compteur de la cloche (useNotificationCount) — le total
    // de la cloche EST le nombre de cartes affichées ici, donc jamais de
    // divergence possible.
    const built = await buildNotificationItems(player.id);
    setItems(built);
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
    reloadNotifs();
  }, [player, reloadNotifs]);

  // "Effacer les infos" — supprime toutes les notifs "info" affichées, laisse
  // intactes celles qui exigent une action.
  const dismissAllInfo = useCallback(async () => {
    const infoItems = items.filter(i => isDismissibleNotif(i.type));
    if (infoItems.length === 0) return;
    setItems(prev => prev.filter(i => !isDismissibleNotif(i.type)));
    if (!player) return;
    await supabase
      .from('dismissed_notifications')
      .upsert(
        infoItems.map(i => ({ player_id: player.id, notif_key: i.id })),
        { onConflict: 'player_id,notif_key' },
      );
    reloadNotifs();
  }, [items, player, reloadNotifs]);

  // Re-vérifie l'état des notifs à chaque focus → la bannière se met à jour
  // automatiquement au retour des réglages système (cas refus définitif).
  useFocusEffect(useCallback(() => {
    fetchNotifs();
    getNotificationsEnabled().then(setNotifsOn);
  }, [fetchNotifs]));

  const handleEnableNotifs = useCallback(async () => {
    if (!player) return;
    await enableNotificationsFromApp(player.id);
    setNotifsOn(await getNotificationsEnabled());
  }, [player]);

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
        {items.some(i => isDismissibleNotif(i.type)) && (
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

      {/* Bannière « Activer les notifications » — visible tant que c'est désactivé.
          Au tap : prompt OS si possible, sinon ouverture des réglages système. */}
      {notifsOn === false && (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleEnableNotifs}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 12,
            marginHorizontal: 14, marginTop: 14,
            backgroundColor: 'rgba(255,193,26,0.14)',
            borderWidth: 1, borderColor: 'rgba(255,193,26,0.55)',
            borderRadius: 16, padding: 14,
          }}
        >
          <View style={{
            width: 40, height: 40, borderRadius: 12,
            backgroundColor: Colors.bgCard,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <IconBell size={20} color={Colors.brandDeep} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 14, fontWeight: '900', color: Colors.brandDeep, fontFamily: Fonts.uiBlack }}>
              Notifications désactivées
            </Text>
            <Text style={{ fontSize: 12, color: '#A16207', marginTop: 2 }}>
              Active-les pour être prévenu des défis, invitations et résultats.
            </Text>
          </View>
          <View style={{
            paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
            backgroundColor: Colors.brandDeep,
          }}>
            <Text style={{ fontSize: 12.5, fontWeight: '900', color: Colors.textOnDark, fontFamily: Fonts.uiBlack }}>
              Activer
            </Text>
          </View>
        </TouchableOpacity>
      )}

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
                {isDismissibleNotif(item.type) && (
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
