import React from 'react';
import Svg, {
  Defs, LinearGradient, RadialGradient, Stop, Rect,
  Path, Circle, G,
} from 'react-native-svg';

/**
 * PagMatchLogo — direction "SMASH".
 * Raquette de padel (face ronde, gorge à triangle creux, manche) + balle en plein impact + traînée.
 *
 * <PagMatchLogo size={120} />                       // icône seule
 * <PagMatchLogo size={220} wordmark />              // splash avec PAGMATCH (texte rendu hors SVG)
 * <PagMatchLogo size={64} background={false} />     // fond transparent (sur surface sombre)
 */

type Palette = 'default' | 'mono';

const COLORS: Record<Palette, {
  racket: string; ball: string; seam: string;
  wordmarkA: string; wordmarkB: string; tagline: string; glow: string;
}> = {
  default: {
    racket: '#FFC11A',
    ball: '#FFD23F',
    seam: '#0A0A0A',
    wordmarkA: '#FFC11A',
    wordmarkB: '#FFFFFF',
    tagline: '#FFFFFF',
    glow: '#FFC11A',
  },
  mono: {
    racket: '#FFFFFF',
    ball: '#FFFFFF',
    seam: '#999999',
    wordmarkA: '#FFFFFF',
    wordmarkB: '#FFFFFF',
    tagline: '#FFFFFF',
    glow: '#FFFFFF',
  },
};

const FACE_PATH =
  'M -125 -10 A 125 120 0 1 1 125 -10 Q 125 75 75 105 Q 40 122 0 125 Q -40 122 -75 105 Q -125 75 -125 -10 Z';
const THROAT_PATH =
  'M -50 108 L 50 108 Q 50 150 38 186 L -38 186 Q -50 150 -50 108 Z M 0 122 L 30 174 L -30 174 Z';

const PERF_ROWS: Array<{ y: number; xs: number[] }> = [
  { y: -75, xs: [-65, -22, 22, 65] },
  { y: -30, xs: [-72, -24, 24, 72] },
  { y: 20, xs: [-65, -22, 22, 65] },
  { y: 67, xs: [-25, 25] },
];

function Racket({ color, gap }: { color: string; gap: string }) {
  return (
    <G>
      <Path d={THROAT_PATH} fill={color} fillRule="evenodd" />
      <Path
        d={FACE_PATH}
        fill="none"
        stroke={color}
        strokeWidth={26}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {PERF_ROWS.flatMap((row, i) =>
        row.xs.map((x, j) => (
          <Circle key={`${i}-${j}`} cx={x} cy={row.y} r={11} fill={color} />
        ))
      )}
      <Rect x={-32} y={186} width={64} height={10} rx={3} fill={color} />
      <Rect x={-28} y={192} width={56} height={70} rx={6} fill={color} />
      <Rect x={-28} y={222} width={56} height={5} fill={gap} />
      <Rect x={-34} y={258} width={68} height={22} rx={5} fill={color} />
      <Rect x={-22} y={278} width={44} height={14} rx={4} fill={color} />
    </G>
  );
}

function Ball({ cx, cy, r, color, seam, seamOpacity = 0.35 }: {
  cx: number; cy: number; r: number; color: string; seam: string; seamOpacity?: number;
}) {
  const sw = Math.max(1, r * 0.13);
  return (
    <G>
      <Circle cx={cx} cy={cy} r={r} fill={color} />
      <Path
        d={`M ${cx - r * 0.85} ${cy - r * 0.18} Q ${cx} ${cy - r} ${cx + r * 0.85} ${cy - r * 0.18}`}
        fill="none" stroke={seam} strokeWidth={sw} strokeLinecap="round" opacity={seamOpacity}
      />
      <Path
        d={`M ${cx - r * 0.85} ${cy + r * 0.18} Q ${cx} ${cy + r} ${cx + r * 0.85} ${cy + r * 0.18}`}
        fill="none" stroke={seam} strokeWidth={sw} strokeLinecap="round" opacity={seamOpacity}
      />
    </G>
  );
}

function Trail({ points, color, startR = 26, endR = 7, startOp = 0.95, endOp = 0.08 }: {
  points: Array<[number, number]>; color: string;
  startR?: number; endR?: number; startOp?: number; endOp?: number;
}) {
  return (
    <G>
      {points.map(([x, y], i) => {
        const t = i / (points.length - 1);
        const r = startR + (endR - startR) * t;
        const op = startOp + (endOp - startOp) * t;
        return <Circle key={i} cx={x} cy={y} r={r} fill={color} opacity={op} />;
      })}
    </G>
  );
}

export default function PagMatchLogo({
  size = 120,
  palette = 'default',
  wordmark = false,
  background = true,
  rounded = true,
}: {
  size?: number;
  palette?: Palette;
  wordmark?: boolean;
  background?: boolean;
  rounded?: boolean;
}) {
  const c = COLORS[palette] || COLORS.default;

  const racketY = wordmark ? 315 : 460;
  const rScale = wordmark ? 1.12 : 1.65;
  const ball = wordmark
    ? { cx: 404, cy: 268, r: 46 }
    : { cx: 412, cy: 388, r: 62 };
  const trail: Array<[number, number]> = wordmark
    ? [[180, 110], [228, 140], [276, 172], [324, 208], [368, 246]]
    : [[150, 170], [210, 210], [270, 255], [325, 305], [375, 355]];
  const glowR = wordmark ? 250 : 290;

  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024">
      <Defs>
        <LinearGradient id="pmBgDark" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1a1a1c" />
          <Stop offset="1" stopColor="#08080a" />
        </LinearGradient>
        <RadialGradient id="pmGlow" cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0" stopColor={c.glow} stopOpacity={palette === 'mono' ? 0.22 : 0.42} />
          <Stop offset="0.6" stopColor={c.glow} stopOpacity={0} />
        </RadialGradient>
      </Defs>

      {background && (
        <Rect
          x={0} y={0} width={1024} height={1024}
          rx={rounded ? 229 : 0}
          fill={palette === 'mono' ? '#0A0A0A' : 'url(#pmBgDark)'}
        />
      )}

      <Circle cx={540} cy={racketY - (wordmark ? 20 : 30)} r={glowR} fill="url(#pmGlow)" />

      <Trail points={trail} color={c.racket} startR={wordmark ? 26 : 30} />

      <G transform={`translate(540 ${racketY}) scale(${rScale}) rotate(18)`}>
        <Racket color={c.racket} gap="#0A0A0A" />
      </G>

      <Ball cx={ball.cx} cy={ball.cy} r={ball.r} color={c.ball} seam={c.seam} />
    </Svg>
  );
}
