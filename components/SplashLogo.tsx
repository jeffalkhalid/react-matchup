import React from 'react';
import { View, Image } from 'react-native';

// Lockup de marque statique — même géométrie que l'écran de chargement (AnimatedSplash) :
// traînées + raquette (.smash) · wordmark (.word) · baseline (.base), boîte de réf 364×348.
// `onDark` : fond sombre → wordmark/baseline blancs ; fond clair → wordmark sombre (la baseline
// blanche n'a pas de variante sombre, on la masque en clair).
const RATIO = 364 / 348;
const RACKET = require('../assets/auth/splash-racket.png');
const TRAILS = require('../assets/auth/splash-trails.png');
const WORDMARK = require('../assets/auth/splash-wordmark.png');
const WORDMARK_DARK = require('../assets/auth/splash-wordmark-dark.png');
const BASELINE = require('../assets/auth/splash-baseline.png');

export default function SplashLogo({ width = 220, onDark = true }: { width?: number; onDark?: boolean }) {
  const w = width;
  const h = w / RATIO;
  const smashW = w * 0.7472;
  const smashH = h * 0.4483;

  return (
    <View style={{ width: w, height: h }}>
      {/* .smash — left 14.56% top 0 · width 74.72% height 44.83% */}
      <View style={{ position: 'absolute', left: w * 0.1456, top: 0, width: smashW, height: smashH }}>
        {/* trails — left 0 top 29.49% · w 47.79% h 70.51% */}
        <Image source={TRAILS} resizeMode="contain"
          style={{ position: 'absolute', left: 0, top: smashH * 0.2949, width: smashW * 0.4779, height: smashH * 0.7051 }} />
        {/* racket — left 44.49% top 0 · w 55.52% h 96.79% */}
        <Image source={RACKET} resizeMode="contain"
          style={{ position: 'absolute', left: smashW * 0.4449, top: 0, width: smashW * 0.5552, height: smashH * 0.9679 }} />
      </View>

      {/* .word — left 0 top 44.83% · width 100% height 30.17% */}
      <View style={{ position: 'absolute', left: 0, top: h * 0.4483, width: w, height: h * 0.3017 }}>
        <Image source={onDark ? WORDMARK : WORDMARK_DARK} resizeMode="contain" style={{ width: '100%', height: '100%' }} />
      </View>

      {/* .base — left 15.38% top 76.72% · width 43.13% height 23.28% (uniquement sur fond sombre) */}
      {onDark && (
        <View style={{ position: 'absolute', left: w * 0.1538, top: h * 0.7672, width: w * 0.4313, height: h * 0.2328 }}>
          <Image source={BASELINE} resizeMode="contain" style={{ width: '100%', height: '100%' }} />
        </View>
      )}
    </View>
  );
}
