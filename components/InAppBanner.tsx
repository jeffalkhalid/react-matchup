import { useEffect, useRef, useState } from 'react';
import { Animated, Text, TouchableOpacity, View, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { onBanner, type BannerItem } from '../lib/inAppBanner';
import { Colors, Fonts } from '../lib/theme';

// Bannière éphémère affichée par-dessus toute l'app quand une notif arrive en
// temps réel (app au premier plan) — pendant du push (qui ne s'affiche qu'en
// arrière-plan). Montée une seule fois à la racine.
const VISIBLE_MS = 4500;

export default function InAppBanner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [banner, setBanner] = useState<BannerItem | null>(null);
  const translateY = useRef(new Animated.Value(-140)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const animateOut = (after?: () => void) => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: -140, duration: 220, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => { setBanner(null); after?.(); });
  };

  useEffect(() => {
    const off = onBanner(item => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setBanner(item);
      translateY.setValue(-140);
      opacity.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 8, speed: 14 }),
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
      hideTimer.current = setTimeout(() => animateOut(), VISIBLE_MS);
    });
    return () => {
      off();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!banner) return null;

  const onPress = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const route = banner.route;
    animateOut(() => router.push(route as any));
  };

  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute', left: 0, right: 0, top: insets.top + 8,
        paddingHorizontal: 12, zIndex: 9999, elevation: 9999,
        transform: [{ translateY }], opacity,
      }}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onPress}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 12,
          backgroundColor: Colors.bgCard,
          borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14,
          borderWidth: 1, borderColor: Colors.brand,
          shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          ...Platform.select({ android: { elevation: 12 } }),
        }}
      >
        <View style={{
          width: 40, height: 40, borderRadius: 12,
          backgroundColor: 'rgba(255,193,26,0.16)',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ fontSize: 20 }}>{banner.emoji}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: Colors.textPrimary, fontSize: 14, fontWeight: '900', fontFamily: Fonts.uiBlack }}>
            {banner.title}
          </Text>
          <Text numberOfLines={2} style={{ color: Colors.textSecondary, fontSize: 12, marginTop: 1 }}>
            {banner.body}
          </Text>
        </View>
        <Text style={{ color: Colors.textMuted, fontSize: 18 }}>›</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}
