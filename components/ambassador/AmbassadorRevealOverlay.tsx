// Overlay plein écran joué à l'arrivée sur le profil d'un ambassadeur.
// Purement visuel : pointerEvents="none", ne bloque jamais l'interaction.
// Timing : fade-in 300ms → tient 900ms → fade-out 300ms → onDone (total 1,5 s).
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Fonts } from '../../lib/theme';
import { AMB, formatMemberNumber } from '../../lib/ambassador';
import { LaurelMedallion } from './primitives';

const HOLD_MS = 900;

function sectorPath(cx: number, cy: number, r: number, a1: number, a2: number): string {
  const rad = (a: number) => ((a - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(rad(a1)), y1 = cy + r * Math.sin(rad(a1));
  const x2 = cx + r * Math.cos(rad(a2)), y2 = cy + r * Math.sin(rad(a2));
  return `M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2} Z`;
}

function Spark({ top, left, size, color, duration, delay }: {
  top: string; left: string; size: number; color: string; duration: number; delay: number;
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: duration / 2, delay, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: duration / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v, duration, delay]);
  return (
    <Animated.View style={{
      position: 'absolute', top: top as any, left: left as any,
      width: size, height: size, borderRadius: 999, backgroundColor: color,
      opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.15, 1] }),
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.15] }) }],
    }} />
  );
}

export function AmbassadorRevealOverlay({ number, since, onDone }: {
  number: number; since: string; onDone: () => void;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const textIn = useRef(new Animated.Value(0)).current;
  const footIn = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const sequence = Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 300, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.delay(HOLD_MS),
      Animated.timing(opacity, { toValue: 0, duration: 300, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]);
    sequence.start(({ finished }) => { if (finished) onDone(); });
    const popAnim = Animated.timing(pop, { toValue: 1, duration: 450, delay: 100, easing: Easing.out(Easing.back(1.7)), useNativeDriver: true });
    popAnim.start();
    const textAnim = Animated.timing(textIn, { toValue: 1, duration: 300, delay: 250, easing: Easing.out(Easing.ease), useNativeDriver: true });
    textAnim.start();
    const footAnim = Animated.timing(footIn, { toValue: 1, duration: 300, delay: 350, easing: Easing.out(Easing.ease), useNativeDriver: true });
    footAnim.start();
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => {
      sequence.stop();
      popAnim.stop();
      textAnim.stop();
      footAnim.stop();
      loop.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const R = 130;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, {
      zIndex: 50, opacity, alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(6,5,4,0.94)', overflow: 'hidden',
    }]}>
      <Svg pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="ambRevealGlow" cx="50%" cy="42%" rx="70%" ry="55%">
            <Stop offset="0" stopColor={AMB.gold} stopOpacity={0.16} />
            <Stop offset="0.7" stopColor={AMB.gold} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#ambRevealGlow)" />
      </Svg>
      <Animated.View style={{
        position: 'absolute', top: '40%', left: '50%',
        width: R * 2, height: R * 2, marginLeft: -R, marginTop: -R,
        transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
      }}>
        <Svg width={R * 2} height={R * 2}>
          <Path d={sectorPath(R, R, R, 5, 42)} fill={AMB.gold} fillOpacity={0.10} />
          <Path d={sectorPath(R, R, R, 150, 192)} fill={AMB.gold} fillOpacity={0.085} />
          <Path d={sectorPath(R, R, R, 300, 342)} fill={AMB.gold} fillOpacity={0.10} />
        </Svg>
      </Animated.View>
      <Spark top="26%" left="30%" size={5} color={AMB.goldBright} duration={1600} delay={0} />
      <Spark top="22%" left="68%" size={4} color={AMB.gold} duration={1900} delay={300} />
      <Spark top="62%" left="22%" size={4} color={AMB.gold} duration={1700} delay={600} />
      <Spark top="66%" left="74%" size={5} color={AMB.goldBright} duration={2100} delay={150} />
      <Spark top="38%" left="82%" size={3} color={AMB.gold} duration={1500} delay={450} />
      <Animated.View style={{
        opacity: pop,
        transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
      }}>
        <LaurelMedallion width={98} doubleRing />
      </Animated.View>
      <Animated.View style={{ opacity: textIn, alignItems: 'center', marginTop: 14 }}>
        <Text
          numberOfLines={1} adjustsFontSizeToFit
          style={{ fontFamily: Fonts.welcome, fontSize: 40, color: '#FFFFFF', paddingRight: 8 }}>
          Cercle des 100
        </Text>
        <Text style={{ fontFamily: Fonts.uiBold, fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 8 }}>
          Ambassadeur{' '}
          <Text style={{ fontFamily: Fonts.uiBlack, color: AMB.gold }}>
            {formatMemberNumber(number)}
          </Text>
        </Text>
      </Animated.View>
      <Animated.View style={{ position: 'absolute', bottom: 30, alignItems: 'center', gap: 6, opacity: footIn }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Image source={require('../../assets/auth/splash-racket.png')}
            style={{ width: 18, height: 18 }} resizeMode="contain" />
          <Image source={require('../../assets/auth/splash-wordmark.png')}
            style={{ width: 84, height: 18, marginLeft: -6 }} resizeMode="contain" />
        </View>
        <Text style={{ fontFamily: Fonts.uiBold, fontSize: 10, color: 'rgba(255,255,255,0.5)', letterSpacing: 0.3 }}>
          Membre depuis {since}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}
