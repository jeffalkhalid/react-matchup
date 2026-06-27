import { useEffect, useRef } from 'react';
import { TouchableOpacity, Text, View, Animated, Easing } from 'react-native';
import { Colors } from '../lib/theme';
import { Icon } from './community/icons';

const BADGE_RED = '#E5484D';
const OUTLINE_DARK = '#0E2A22'; // contour badge sur header sombre
const OUTLINE_LIGHT = '#FFFFFF'; // contour badge sur fond clair (Accueil)

// Cloche de notifications réutilisable. Pastille 40×40 NON positionnée (le parent,
// p.ex. HeaderActions, la place en absolu). Animation swing + anneau pulse repris
// de l'ancienne cloche d'Accueil. `tint` adapte les couleurs au fond.
export function NotificationBell({ count, onPress, tint = 'light' }: {
  count: number; onPress: () => void; tint?: 'light' | 'dark';
}) {
  const has = count > 0;
  const display = count > 9 ? '9+' : String(count);

  const iconColor = tint === 'light' ? '#fff' : Colors.textPrimary;
  const bgColor = tint === 'light' ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)';
  const outline = tint === 'light' ? OUTLINE_DARK : OUTLINE_LIGHT;

  // Bell swing — 2.6 s loop, ±12°, pivot top-center
  const swing = useRef(new Animated.Value(0)).current;
  // Pulse ring — 1.8 s loop, scale 0.85→1.6 + fade
  const ringScale = useRef(new Animated.Value(0.85)).current;
  const ringOpacity = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (!has) {
      swing.stopAnimation(); swing.setValue(0);
      ringScale.stopAnimation(); ringOpacity.stopAnimation();
      ringScale.setValue(0.85); ringOpacity.setValue(0.9);
      return;
    }
    const swingLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(swing, { toValue: -12, duration: 260, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(swing, { toValue: 12, duration: 260, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(swing, { toValue: -12, duration: 260, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(swing, { toValue: 12, duration: 260, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(swing, { toValue: -12, duration: 260, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(swing, { toValue: 12, duration: 260, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(swing, { toValue: 0, duration: 260, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.delay(780),
      ])
    );
    const pulseLoop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(ringScale, { toValue: 1.6, duration: 1440, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.delay(360),
        ]),
        Animated.sequence([
          Animated.timing(ringOpacity, { toValue: 0, duration: 1440, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.delay(360),
        ]),
      ])
    );
    swingLoop.start(); pulseLoop.start();
    return () => { swingLoop.stop(); pulseLoop.stop(); };
  }, [has]);

  const rotate = swing.interpolate({ inputRange: [-12, 12], outputRange: ['-12deg', '12deg'] });

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={{
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: bgColor,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Animated.View style={{ transform: [{ rotate }] }}>
        <Icon name="bell" size={20} color={iconColor} stroke={1.4} />
      </Animated.View>

      {has && (
        <>
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
          <View
            pointerEvents="none"
            style={{
              position: 'absolute', top: -6, right: -8,
              borderRadius: 11, backgroundColor: outline, padding: 2,
            }}
          >
            <View style={{
              minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9,
              backgroundColor: BADGE_RED, alignItems: 'center', justifyContent: 'center',
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
