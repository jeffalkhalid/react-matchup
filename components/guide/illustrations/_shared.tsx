// Primitives partagées par les mini-mockups d'onboarding (port de illustrations.jsx + kit.jsx).
import React from 'react';
import { View, Text, ViewStyle, TextStyle } from 'react-native';
import Svg, { Rect, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import { Fonts, LeagueGradients } from '../../../lib/theme';
import type { League } from '../../../types';

// Carte blanche flottante — volontairement claire dans les deux thèmes (« product feel »).
export function miniCard(extra: ViewStyle = {}): ViewStyle {
  return {
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#ECEAE7', borderRadius: 16,
    shadowColor: '#0A0A0A', shadowOpacity: 0.18, shadowRadius: 15, shadowOffset: { width: 0, height: 10 },
    elevation: 6, ...extra,
  };
}

export const miniLabel: TextStyle = {
  fontFamily: Fonts.uiBold, fontSize: 9, letterSpacing: 1.4,
  textTransform: 'uppercase', color: '#A1A1AA',
};

// Rectangle dégradé via react-native-svg (même approche que components/community/Avatar.tsx).
// Remplace `background: 'linear-gradient(...)'` du prototype. L'id est local à chaque <Svg>.
export function GradientRect({ colors, width, height, radius = 0, diagonal = true }:
  { colors: readonly [string, string]; width: number; height: number; radius?: number; diagonal?: boolean }) {
  return (
    <Svg width={width} height={height}>
      <Defs>
        <SvgLinearGradient id="g" x1="0" y1="0" x2={diagonal ? '1' : '0'} y2="1">
          <Stop offset="0" stopColor={colors[0]} />
          <Stop offset="1" stopColor={colors[1]} />
        </SvgLinearGradient>
      </Defs>
      <Rect x="0" y="0" width={width} height={height} rx={radius} ry={radius} fill="url(#g)" />
    </Svg>
  );
}

// Petit dégradé de ligue (carré arrondi) — remplace `background: LEAGUE_GRAD[k]` du prototype.
export function LeagueSwatch({ league, size = 26, radius = 8 }: { league: League; size?: number; radius?: number }) {
  const g = (LeagueGradients[league] ?? LeagueGradients.gold) as [string, string];
  return <GradientRect colors={g} width={size} height={size} radius={radius} />;
}

type PillVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';
const PILL: Record<PillVariant, { bg: string; fg: string; bd: string }> = {
  neutral: { bg: '#FAFAF9', fg: '#52525B', bd: '#E7E5E4' },
  brand:   { bg: 'rgba(255,193,26,0.14)', fg: '#E8A906', bd: 'rgba(255,193,26,0.55)' },
  success: { bg: 'rgba(16,185,129,0.10)', fg: '#047857', bd: 'rgba(16,185,129,0.45)' },
  warning: { bg: 'rgba(245,158,11,0.12)', fg: '#B45309', bd: 'rgba(245,158,11,0.50)' },
  danger:  { bg: 'rgba(239,68,68,0.10)', fg: '#B91C1C', bd: 'rgba(239,68,68,0.45)' },
  info:    { bg: 'rgba(59,130,246,0.10)', fg: '#1D4ED8', bd: 'rgba(59,130,246,0.45)' },
};

export function Pill({ variant = 'neutral', children, fontSize = 10 }:
  { variant?: PillVariant; children: React.ReactNode; fontSize?: number }) {
  const s = PILL[variant];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
      backgroundColor: s.bg, borderWidth: 1, borderColor: s.bd, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text style={{ color: s.fg, fontFamily: Fonts.uiBlack, fontSize, letterSpacing: 0.4, textTransform: 'uppercase' }}>
        {children}
      </Text>
    </View>
  );
}
