// Voyant « match en cours » : pastille avec point rouge qui pulse en boucle,
// pour distinguer d'un coup d'œil les parties en train de se jouer (À venir,
// Prochain match). Purement visuel — la condition d'affichage reste au parent.
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';

const RED = '#DC2626';

export function LiveDot({ label = 'EN COURS', s = 1 }: { label?: string; s?: number }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 650, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] });
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1.15] });
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 4 * s,
      borderRadius: 999, paddingHorizontal: 6 * s, paddingVertical: 1.5 * s,
      backgroundColor: 'rgba(220,38,38,0.10)',
    }}>
      <Animated.View style={{
        width: 6 * s, height: 6 * s, borderRadius: 3 * s,
        backgroundColor: RED, opacity, transform: [{ scale }],
      }} />
      <Text style={{ fontSize: 8.5 * s, fontWeight: '900', letterSpacing: 0.4, color: RED }}>{label}</Text>
    </View>
  );
}
