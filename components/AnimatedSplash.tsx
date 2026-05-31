import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, Dimensions, Easing,
  Image, StyleSheet, Text, View,
} from 'react-native';
import { AUTH_BRAND, AUTH_SPLASH_BG } from '../lib/auth-theme';
import { Fonts } from '../lib/theme';

type Props = {
  onFinish?: () => void;
  /** Délai après la fin de la séquence avant de fade out. */
  holdDuration?: number;
};

const RACKET = require('../assets/auth/splash-racket.png');
const TRAILS = require('../assets/auth/splash-trails.png');
const WORDMARK = require('../assets/auth/splash-wordmark.png');
const BASELINE = require('../assets/auth/splash-baseline.png');

// Géométrie du lockup : boîte de référence 364×348 (cf. README handoff).
const RATIO = 364 / 348;

export default function AnimatedSplash({ onFinish, holdDuration = 700 }: Props) {
  const [visible, setVisible] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);

  // Animated values pour chaque pièce.
  const smashX = useRef(new Animated.Value(-1.5)).current;     // translateX en proportion (×width)
  const smashScale = useRef(new Animated.Value(0.94)).current;
  const smashOp = useRef(new Animated.Value(0)).current;

  const wordY = useRef(new Animated.Value(18)).current;
  const wordOp = useRef(new Animated.Value(0)).current;

  const baseTx = useRef(new Animated.Value(1)).current;        // 1 = totalement à droite (caché), 0 = en place
  const baseOp = useRef(new Animated.Value(0)).current;

  const glowScale = useRef(new Animated.Value(0.6)).current;
  const glowOp = useRef(new Animated.Value(0)).current;

  const floatY = useRef(new Animated.Value(0)).current;
  const loaderOp = useRef(new Animated.Value(0)).current;
  const loaderTrack = useRef(new Animated.Value(-1)).current;  // -1 → 1 : balaie de gauche à droite

  const overlayOp = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then(v => {
      if (mounted) setReduceMotion(!!v);
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      // Tout afficher immédiatement, sans animation.
      smashX.setValue(0); smashScale.setValue(1); smashOp.setValue(1);
      wordY.setValue(0); wordOp.setValue(1);
      baseTx.setValue(0); baseOp.setValue(1);
      glowScale.setValue(1); glowOp.setValue(0.85);
      loaderOp.setValue(1);
      const t = setTimeout(() => fadeOut(), holdDuration);
      return () => clearTimeout(t);
    }

    // glow-in (delay 0.5s) puis glow-breathe en boucle
    const glowIn = Animated.parallel([
      Animated.timing(glowOp, { toValue: 0.85, duration: 700, delay: 500, useNativeDriver: true }),
      Animated.timing(glowScale, { toValue: 1, duration: 700, delay: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);

    const glowBreathe = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(glowScale, { toValue: 1.07, duration: 1700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(glowOp, { toValue: 1, duration: 1700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(glowScale, { toValue: 1, duration: 1700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(glowOp, { toValue: 0.7, duration: 1700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      ])
    );

    // racket-fly (smash) — delay 0.15s
    const racketFly = Animated.parallel([
      Animated.timing(smashOp, { toValue: 1, duration: 700, delay: 150, useNativeDriver: true }),
      Animated.timing(smashX, { toValue: 0, duration: 700, delay: 150, easing: Easing.bezier(0.22, 0.61, 0.36, 1), useNativeDriver: true }),
      Animated.timing(smashScale, { toValue: 1, duration: 700, delay: 150, easing: Easing.bezier(0.22, 0.61, 0.36, 1), useNativeDriver: true }),
    ]);

    // word-rise — delay 0.7s
    const wordRise = Animated.parallel([
      Animated.timing(wordOp, { toValue: 1, duration: 650, delay: 700, useNativeDriver: true }),
      Animated.timing(wordY, { toValue: 0, duration: 650, delay: 700, easing: Easing.bezier(0.2, 0.8, 0.25, 1), useNativeDriver: true }),
    ]);

    // streak-in (base) — delay 0.9s — simulé avec translateX (vs clip-path web)
    const streakIn = Animated.parallel([
      Animated.timing(baseOp, { toValue: 1, duration: 550, delay: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(baseTx, { toValue: 0, duration: 550, delay: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);

    // loader fade-up — delay 1.35s
    const loaderFade = Animated.timing(loaderOp, { toValue: 1, duration: 350, delay: 1350, useNativeDriver: true });

    // loader-slide en boucle
    const loaderSlide = Animated.loop(
      Animated.timing(loaderTrack, { toValue: 1, duration: 1250, easing: Easing.inOut(Easing.quad), useNativeDriver: true, isInteraction: false }),
    );

    // float (logo entier) — démarre vers 1.6s, boucle 4.2s ±7px
    const float = Animated.loop(
      Animated.sequence([
        Animated.timing(floatY, { toValue: -7, duration: 2100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(floatY, { toValue: 7, duration: 2100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );

    glowIn.start(() => glowBreathe.start());
    racketFly.start();
    wordRise.start();
    streakIn.start();
    loaderFade.start();
    loaderSlide.start();
    const floatTimer = setTimeout(() => float.start(), 1600);

    const t = setTimeout(() => fadeOut(), 1600 + holdDuration);
    return () => {
      clearTimeout(t);
      clearTimeout(floatTimer);
      glowBreathe.stop();
      loaderSlide.stop();
      float.stop();
    };
  }, [reduceMotion]);

  const fadeOut = () => {
    Animated.timing(overlayOp, {
      toValue: 0, duration: 400, easing: Easing.in(Easing.cubic), useNativeDriver: true,
    }).start(() => {
      setVisible(false);
      onFinish?.();
    });
  };

  if (!visible) return null;

  const { width: screenW, height: screenH } = Dimensions.get('window');
  const logoW = Math.min(screenW * 0.55, 300);
  const logoH = logoW / RATIO;

  // Translations en pixels (Animated supporte interpolate de proportion → px).
  const smashTx = smashX.interpolate({
    inputRange: [-1.5, 0],
    outputRange: [-logoW * 1.5, 0],
  });

  // Le loader track : la barre fait 200px de large, l'indicateur 30% (60px).
  const loaderWidth = 200;
  const indicatorWidth = 60;
  const indicatorTx = loaderTrack.interpolate({
    inputRange: [-1, 1],
    outputRange: [-indicatorWidth, loaderWidth],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, styles.overlay, { opacity: overlayOp }]}
    >
      {/* Conteneur logo centré, animé par float (translateY) */}
      <Animated.View style={[styles.logoWrap, {
        width: logoW, height: logoH,
        transform: [{ translateY: floatY }],
      }]}>
        {/* Lueur radiale derrière (faux radial gradient via View jaune avec opacity + scale) */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: -logoW * 0.25, top: -logoH * 0.25,
            width: logoW * 1.5, height: logoH * 1.5,
            borderRadius: logoW * 0.75,
            backgroundColor: AUTH_BRAND,
            opacity: glowOp.interpolate({ inputRange: [0, 1], outputRange: [0, 0.18] }),
            transform: [{ scale: glowScale }],
          }}
        />

        {/* .smash (racket + trails) — left 14.56% top 0 width 74.72% height 44.83% */}
        <Animated.View style={{
          position: 'absolute',
          left: logoW * 0.1456, top: 0,
          width: logoW * 0.7472, height: logoH * 0.4483,
          opacity: smashOp,
          transform: [{ translateX: smashTx }, { scale: smashScale }],
        }}>
          {/* trails dans .smash : left 0 top 29.49% w 47.79% h 70.51% */}
          <Image
            source={TRAILS}
            style={{
              position: 'absolute',
              left: 0, top: logoH * 0.4483 * 0.2949,
              width: logoW * 0.7472 * 0.4779,
              height: logoH * 0.4483 * 0.7051,
            }}
            resizeMode="contain"
          />
          {/* racket dans .smash : left 44.49% top 0 w 55.52% h 96.79% */}
          <Image
            source={RACKET}
            style={{
              position: 'absolute',
              left: logoW * 0.7472 * 0.4449, top: 0,
              width: logoW * 0.7472 * 0.5552,
              height: logoH * 0.4483 * 0.9679,
            }}
            resizeMode="contain"
          />
        </Animated.View>

        {/* .word — left 0 top 44.83% width 100% height 30.17% */}
        <Animated.View style={{
          position: 'absolute',
          left: 0, top: logoH * 0.4483,
          width: logoW, height: logoH * 0.3017,
          opacity: wordOp,
          transform: [{ translateY: wordY }],
        }}>
          <Image
            source={WORDMARK}
            style={{ width: '100%', height: '100%' }}
            resizeMode="contain"
          />
        </Animated.View>

        {/* .base — left 15.38% top 76.72% width 43.13% height 23.28% */}
        <Animated.View style={{
          position: 'absolute',
          left: logoW * 0.1538, top: logoH * 0.7672,
          width: logoW * 0.4313, height: logoH * 0.2328,
          opacity: baseOp,
          overflow: 'hidden',
        }}>
          <Animated.View style={{
            width: '100%', height: '100%',
            transform: [{ translateX: baseTx.interpolate({ inputRange: [0, 1], outputRange: [0, logoW * 0.4313] }) }],
          }}>
            <Image
              source={BASELINE}
              style={{ width: '100%', height: '100%' }}
              resizeMode="contain"
            />
          </Animated.View>
        </Animated.View>
      </Animated.View>

      {/* Loader en bas */}
      <Animated.View style={[styles.loader, { bottom: screenH * 0.09, opacity: loaderOp }]}>
        <View style={[styles.loaderTrack, { width: loaderWidth }]}>
          <Animated.View
            style={[
              styles.loaderIndicator,
              { width: indicatorWidth, transform: [{ translateX: indicatorTx }] },
            ]}
          />
        </View>
        <Text style={styles.loaderLabel}>CHARGEMENT</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: AUTH_SPLASH_BG,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  logoWrap: {
    position: 'relative',
  },
  loader: {
    position: 'absolute',
    alignSelf: 'center',
    alignItems: 'center',
    gap: 10,
  },
  loaderTrack: {
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
    borderRadius: 1,
  },
  loaderIndicator: {
    height: 2,
    backgroundColor: AUTH_BRAND,
    borderRadius: 1,
  },
  loaderLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontFamily: Fonts.uiBold,
    fontSize: 10,
    letterSpacing: 3.2,
    marginTop: 4,
  },
});
