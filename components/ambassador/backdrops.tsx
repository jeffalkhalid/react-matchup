// Fonds « ambassadeur » : équivalents RN des gradients CSS du prototype.
// Tout est en react-native-svg (pas d'expo-linear-gradient dans le repo).
import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, {
  Defs, LinearGradient, Line, RadialGradient, Rect, Stop, Text as SvgText,
} from 'react-native-svg';
import { Fonts } from '../../lib/theme';
import { AMB, formatMemberNumber } from '../../lib/ambassador';

let uid = 0;

/** Texture guillochée : fines lignes or diagonales (~115°), très faibles. */
export function Guilloche({ opacity = 0.045, gap = 7 }: { opacity?: number; gap?: number }) {
  const SIZE = 400;
  const lines: React.ReactNode[] = [];
  for (let x = -SIZE; x < SIZE; x += gap) {
    lines.push(
      <Line key={x} x1={x} y1={0} x2={x + SIZE * 0.47} y2={SIZE}
        stroke={AMB.gold} strokeWidth={1} strokeOpacity={opacity} />
    );
  }
  return (
    <Svg pointerEvents="none" style={StyleSheet.absoluteFill}
      viewBox={`0 0 ${SIZE} ${SIZE}`} preserveAspectRatio="xMidYMid slice">
      {lines}
    </Svg>
  );
}

/** Dégradé sombre + halo or radial, en absolute fill (poser sous le contenu). */
export function DarkGoldBackdrop({
  radius, from = AMB.inkCard, to = AMB.inkDeep, glowAt = 'topRight',
}: { radius: number; from?: string; to?: string; glowAt?: 'topRight' | 'topLeft' | 'top' }) {
  const id = `agb${uid++}`;
  const glow = glowAt === 'topRight' ? { cx: '85%', cy: '0%' }
    : glowAt === 'topLeft' ? { cx: '12%', cy: '0%' }
    : { cx: '50%', cy: '0%' };
  return (
    <Svg pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id={`${id}-lin`} x1="0" y1="0" x2="0.35" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
        <RadialGradient id={`${id}-rad`} cx={glow.cx} cy={glow.cy} rx="90%" ry="70%">
          <Stop offset="0" stopColor={AMB.gold} stopOpacity={0.18} />
          <Stop offset="0.6" stopColor={AMB.gold} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width="100%" height="100%" rx={radius} fill={`url(#${id}-lin)`} />
      <Rect x={0} y={0} width="100%" height="100%" rx={radius} fill={`url(#${id}-rad)`} />
    </Svg>
  );
}

/** Numéro « N°042 » en dégradé or vertical (Anton). */
export function GoldGradientNumber({ number, fontSize }: { number: number; fontSize: number }) {
  const id = `agn${uid++}`;
  const label = formatMemberNumber(number);
  // Largeur générique Anton ≈ 0.62em/caractère — marge incluse.
  const width = Math.ceil(label.length * fontSize * 0.62) + 8;
  const height = Math.ceil(fontSize * 1.05);
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0.05" stopColor="#FFE9A8" />
          <Stop offset="0.45" stopColor={AMB.gold} />
          <Stop offset="0.95" stopColor={AMB.goldDark} />
        </LinearGradient>
      </Defs>
      <SvgText x={0} y={fontSize * 0.88} fill={`url(#${id})`}
        fontFamily={Fonts.display} fontSize={fontSize}>
        {label}
      </SvgText>
    </Svg>
  );
}
