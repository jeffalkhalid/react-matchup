import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';

type Props = {
  /** Called once the splash animation has fully faded out. */
  onFinish?: () => void;
  /** Hold the racket on screen for this long before fading the whole overlay out (ms). */
  holdDuration?: number;
};

export default function AnimatedSplash({ onFinish, holdDuration = 700 }: Props) {
  const [visible, setVisible] = useState(true);

  const scale = useRef(new Animated.Value(0.85)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 450,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 6,
        tension: 60,
        useNativeDriver: true,
      }),
    ]).start(() => {
      Animated.sequence([
        Animated.delay(holdDuration),
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 350,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(() => {
        setVisible(false);
        onFinish?.();
      });
    });
  }, []);

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, styles.overlay, { opacity: overlayOpacity }]}
    >
      <View style={styles.center}>
        <Animated.Image
          source={require('../assets/icon.png')}
          style={[styles.icon, { opacity, transform: [{ scale }] }]}
          resizeMode="cover"
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: '#000000',
    zIndex: 9999,
    elevation: 9999,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    width: 220,
    height: 220,
    borderRadius: 50,
  },
});
