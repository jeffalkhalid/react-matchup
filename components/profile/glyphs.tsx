// ── Glyphes SVG sur-mesure du Palmarès (24×24, trait 1.7) ─────────────
// Portés depuis la maquette (pm-parts.jsx GLYPHS) vers react-native-svg.
// `currentColor` n'existe pas en RN → on passe une couleur explicite.
import React from 'react';
import { G, Path, Circle, Ellipse } from 'react-native-svg';

export function Glyph({ name, color, strokeWidth = 1.7 }: { name: string; color: string; strokeWidth?: number }) {
  const stroke = { stroke: color, fill: 'none' as const };
  const solid = { fill: color, stroke: 'none' as const };
  let body: React.ReactNode = null;

  switch (name) {
    case 'ball':
      body = (<>
        <Circle cx={12} cy={12} r={9} {...stroke} />
        <Path d="M3.5 9 Q 12 13 20.5 9" {...stroke} />
        <Path d="M3.5 15 Q 12 11 20.5 15" {...stroke} />
      </>); break;
    case 'paddle':
      body = (<>
        <Ellipse cx={12} cy={10} rx={6.5} ry={7.5} {...stroke} />
        <Path d="M10 17.5 v4.5 M14 17.5 v4.5" {...stroke} />
        <Circle cx={9.5} cy={9} r={0.9} {...solid} />
        <Circle cx={14.5} cy={9} r={0.9} {...solid} />
        <Circle cx={12} cy={12} r={0.9} {...solid} />
      </>); break;
    case 'medal':
      body = (<>
        <Path d="M7.5 2 L 12 9 L 16.5 2" {...stroke} />
        <Circle cx={12} cy={15} r={6} {...stroke} />
        <Path d="M12 11.5 l 1 2.4 2.6 .2 -2 1.8 .6 2.6 -2.2 -1.4 -2.2 1.4 .6 -2.6 -2 -1.8 2.6 -.2 z" {...solid} />
      </>); break;
    case 'stadium':
      body = (<>
        <Ellipse cx={12} cy={12} rx={10} ry={6} {...stroke} />
        <Ellipse cx={12} cy={12} rx={5.5} ry={2.8} {...stroke} />
        <Path d="M12 9.2 v5.6" {...stroke} />
      </>); break;
    case 'map':
      body = (<>
        <Path d="M3 5.5 l 6 -2 6 2 6 -2 v 13 l -6 2 -6 -2 -6 2 z" {...stroke} />
        <Path d="M9 3.5 v 13 M15 5.5 v 13" {...stroke} />
      </>); break;
    case 'flame':
      body = (<>
        <Path d="M12 22 c -4.5 0 -7 -3 -7 -7 c 0 -3 2 -4.5 3.5 -6 c .8 1.5 1.5 1.7 1.5 3.2 c 0 -3 1.8 -5.5 5 -10 c 0 4 5 7 5 12.5 c 0 4 -3 7.3 -8 7.3 z" {...stroke} />
        <Path d="M12 18 c -1.8 0 -3 -1.3 -3 -3 c 0 -1.6 1.2 -2.4 2 -3.5 c .2 .8 .5 1 .8 1.6 c .2 -1.4 1 -2.4 2.2 -3.8 c 0 1.8 2 3 2 5.6 c 0 2 -1.5 3.1 -4 3.1 z" {...solid} opacity={0.55} />
      </>); break;
    case 'bagel':
      body = (<>
        <Circle cx={12} cy={12} r={8.5} {...stroke} />
        <Circle cx={12} cy={12} r={3.2} {...stroke} />
        <Path d="M6 7.5 l .5 .8 M17.5 7 l -.6 .9 M6.5 17 l .6 -.8 M17 16.5 l -.7 -.7" {...stroke} />
      </>); break;
    case 'target':
      body = (<>
        <Circle cx={12} cy={12} r={9} {...stroke} />
        <Circle cx={12} cy={12} r={5.5} {...stroke} />
        <Circle cx={12} cy={12} r={2} {...stroke} />
        <Circle cx={12} cy={12} r={0.9} {...solid} />
        <Path d="M12 1 v3 M12 20 v3 M1 12 h3 M20 12 h3" {...stroke} />
      </>); break;
    case 'hourglass':
      body = (<>
        <Path d="M6 3 h12 M6 21 h12" {...stroke} />
        <Path d="M6.5 3 v 2.5 c 0 2.5 5.5 4.5 5.5 6.5 s -5.5 4 -5.5 6.5 v 2.5" {...stroke} />
        <Path d="M17.5 3 v 2.5 c 0 2.5 -5.5 4.5 -5.5 6.5 s 5.5 4 5.5 6.5 v 2.5" {...stroke} />
        <Path d="M9 18.5 c 1.4 -1.5 4.6 -1.5 6 0" {...stroke} />
      </>); break;
    case 'crown':
      body = (<>
        <Path d="M3 8 l 3 11 12 0 3 -11 -5.5 4.5 -3.5 -7 -3.5 7 z" {...stroke} />
        <Path d="M5.5 19 h13" {...stroke} />
        <Circle cx={3} cy={8} r={1.2} {...solid} />
        <Circle cx={21} cy={8} r={1.2} {...solid} />
        <Circle cx={12} cy={5.5} r={1.2} {...solid} />
      </>); break;
    case 'rise':
      body = (<>
        <Path d="M3 18 l 6 -6 4 4 8 -9" {...stroke} />
        <Path d="M15 7 h6 v6" {...stroke} />
        <Circle cx={9} cy={12} r={1.4} {...solid} />
        <Circle cx={13} cy={16} r={1.4} {...solid} />
      </>); break;
    case 'handshake':
      body = (<>
        <Path d="M2 11 l 3.5 -3 4 1 2.5 -2 2.5 2 4 -1 3.5 3" {...stroke} />
        <Path d="M5.5 8 l 2.5 6 4 -2 4 2 2.5 -6" {...stroke} />
        <Path d="M9 16 l 2.5 1.5 1 -1 1 1 2.5 -1.5" {...stroke} />
      </>); break;
    case 'moon':
      body = (<>
        <Path d="M20 14 a 8.5 8.5 0 1 1 -10 -10 a 6 6 0 0 0 10 10 z" {...stroke} />
        <Circle cx={6.5} cy={6} r={0.9} {...solid} />
        <Circle cx={18} cy={4} r={0.7} {...solid} />
        <Circle cx={20.5} cy={9.5} r={0.7} {...solid} />
      </>); break;
    case 'sun':
      body = (<>
        <Circle cx={12} cy={12} r={4} {...stroke} />
        <Path d="M12 2 v3 M12 19 v3 M2 12 h3 M19 12 h3 M5 5 l 2 2 M17 17 l 2 2 M5 19 l 2 -2 M17 7 l 2 -2" {...stroke} />
      </>); break;
    case 'star':
    default:
      body = (
        <Path d="M12 2.5 l 2.8 6.4 6.9 .6 -5.2 4.6 1.5 6.8 -6 -3.6 -6 3.6 1.5 -6.8 -5.2 -4.6 6.9 -.6 z" {...stroke} />
      ); break;
  }

  return (
    <G strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">{body}</G>
  );
}
