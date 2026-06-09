// Jeu d'icônes Lucide (react-native-svg) utilisé par les écrans Communauté.
// Chemins repris de design_handoff_communaute_sociale/reference/icons.jsx.
import React from 'react';
import Svg, { Path, Line, Polyline, Polygon, Circle, G, Rect } from 'react-native-svg';

export type IconName =
  | 'chevronLeft' | 'chevronRight' | 'chevronDown' | 'bell' | 'users' | 'search' | 'plus'
  | 'mapPin' | 'check' | 'x' | 'arrowRight' | 'arrowLeft' | 'message' | 'camera'
  | 'clock' | 'trophy' | 'zap' | 'swords' | 'radar' | 'bellRing' | 'send' | 'qr'
  | 'sliders' | 'trendingUp' | 'share' | 'lifeBuoy' | 'settings';

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  stroke?: number;
  fill?: string;
  rotate?: number;   // degrés
}

export function Icon({ name, size = 24, color = '#0A0A0A', stroke = 2, fill = 'none', rotate }: IconProps) {
  const common = {
    stroke: color, strokeWidth: stroke,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  };
  const body = (() => {
    switch (name) {
      case 'chevronLeft':
        return <Path {...common} d="m15 18-6-6 6-6" />;
      case 'chevronRight':
        return <Path {...common} d="m9 18 6-6-6-6" />;
      case 'bell':
        return <G>
          <Path {...common} d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <Path {...common} d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </G>;
      case 'users':
        return <G>
          <Path {...common} d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <Circle {...common} cx="9" cy="7" r="4" />
          <Path {...common} d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <Path {...common} d="M16 3.13a4 4 0 0 1 0 7.75" />
        </G>;
      case 'search':
        return <G>
          <Circle {...common} cx="11" cy="11" r="8" />
          <Path {...common} d="m21 21-4.3-4.3" />
        </G>;
      case 'plus':
        return <G>
          <Line {...common} x1="12" y1="5" x2="12" y2="19" />
          <Line {...common} x1="5" y1="12" x2="19" y2="12" />
        </G>;
      case 'mapPin':
        return <G>
          <Path {...common} d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
          <Circle {...common} cx="12" cy="10" r="3" />
        </G>;
      case 'check':
        return <Polyline {...common} points="20 6 9 17 4 12" />;
      case 'x':
        return <G>
          <Path {...common} d="M18 6 6 18" />
          <Path {...common} d="m6 6 12 12" />
        </G>;
      case 'arrowRight':
        return <G>
          <Line {...common} x1="5" y1="12" x2="19" y2="12" />
          <Path {...common} d="m13 6 6 6-6 6" />
        </G>;
      case 'message':
        return <Path {...common} d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />;
      case 'camera':
        return <G>
          <Path {...common} d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
          <Circle {...common} cx="12" cy="13" r="3" />
        </G>;
      case 'clock':
        return <G>
          <Circle {...common} cx="12" cy="12" r="10" />
          <Polyline {...common} points="12 6 12 12 16 14" />
        </G>;
      case 'trophy':
        return <G>
          <Path {...common} d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
          <Path {...common} d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
          <Path {...common} d="M4 22h16" />
          <Path {...common} d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
          <Path {...common} d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
          <Path {...common} d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
        </G>;
      case 'zap':
        return <Polygon {...common} fill={color} points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />;
      case 'chevronDown':
        return <Path {...common} d="m6 9 6 6 6-6" />;
      case 'arrowLeft':
        return <G>
          <Path {...common} d="m12 19-7-7 7-7" />
          <Line {...common} x1="19" y1="12" x2="5" y2="12" />
        </G>;
      case 'swords':
        return <G>
          <Polyline {...common} points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
          <Line {...common} x1="13" y1="19" x2="19" y2="13" />
          <Line {...common} x1="16" y1="16" x2="20" y2="20" />
          <Line {...common} x1="19" y1="21" x2="21" y2="19" />
          <Polyline {...common} points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" />
          <Line {...common} x1="5" y1="14" x2="9" y2="18" />
          <Line {...common} x1="7" y1="17" x2="4" y2="20" />
          <Line {...common} x1="3" y1="19" x2="5" y2="21" />
        </G>;
      case 'radar':
        return <G>
          <Path {...common} d="M19.07 4.93A10 10 0 0 0 6.99 3.34" />
          <Path {...common} d="M4 6h.01" />
          <Path {...common} d="M2.29 9.62A10 10 0 1 0 21.31 8.35" />
          <Path {...common} d="M16.24 7.76A6 6 0 1 0 8.23 16.67" />
          <Path {...common} d="M12 18h.01" />
          <Path {...common} d="M17.99 11.66A6 6 0 0 1 15.77 16.67" />
          <Circle {...common} cx="12" cy="12" r="2" />
          <Path {...common} d="m13.41 10.59 5.66-5.66" />
        </G>;
      case 'bellRing':
        return <G>
          <Path {...common} d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <Path {...common} d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          <Path {...common} d="M4 2C2.8 3.7 2 5.7 2 8" />
          <Path {...common} d="M22 8c0-2.3-.8-4.3-2-6" />
        </G>;
      case 'send':
        return <G>
          <Path {...common} d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
          <Path {...common} d="m21.854 2.147-10.94 10.939" />
        </G>;
      case 'qr':
        return <G>
          <Rect {...common} x="3" y="3" width="5" height="5" rx="1" />
          <Rect {...common} x="16" y="3" width="5" height="5" rx="1" />
          <Rect {...common} x="3" y="16" width="5" height="5" rx="1" />
          <Path {...common} d="M21 16h-3a2 2 0 0 0-2 2v3M21 21v.01M12 7v3a2 2 0 0 1-2 2H7M3 12h.01M12 3h.01M12 16v.01M16 12h1M21 12v.01M12 21v-1" />
        </G>;
      case 'sliders':
        return <G>
          <Line {...common} x1="4" y1="21" x2="4" y2="14" />
          <Line {...common} x1="4" y1="10" x2="4" y2="3" />
          <Line {...common} x1="12" y1="21" x2="12" y2="12" />
          <Line {...common} x1="12" y1="8" x2="12" y2="3" />
          <Line {...common} x1="20" y1="21" x2="20" y2="16" />
          <Line {...common} x1="20" y1="12" x2="20" y2="3" />
          <Line {...common} x1="2" y1="14" x2="6" y2="14" />
          <Line {...common} x1="10" y1="8" x2="14" y2="8" />
          <Line {...common} x1="18" y1="16" x2="22" y2="16" />
        </G>;
      case 'trendingUp':
        return <G>
          <Polyline {...common} points="22 7 13.5 15.5 8.5 10.5 2 17" />
          <Polyline {...common} points="16 7 22 7 22 13" />
        </G>;
      case 'share':
        return <G>
          <Circle {...common} cx="18" cy="5" r="3" />
          <Circle {...common} cx="6" cy="12" r="3" />
          <Circle {...common} cx="18" cy="19" r="3" />
          <Line {...common} x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <Line {...common} x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </G>;
      case 'lifeBuoy':
        return <G>
          <Circle {...common} cx="12" cy="12" r="10" />
          <Path {...common} d="m4.93 4.93 4.24 4.24" />
          <Path {...common} d="m14.83 9.17 4.24-4.24" />
          <Path {...common} d="m14.83 14.83 4.24 4.24" />
          <Path {...common} d="m9.17 14.83-4.24 4.24" />
          <Circle {...common} cx="12" cy="12" r="4" />
        </G>;
      case 'settings':
        return <G>
          <Path {...common} d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <Circle {...common} cx="12" cy="12" r="3" />
        </G>;
      default:
        return null;
    }
  })();

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill}
      style={rotate ? { transform: [{ rotate: `${rotate}deg` }] } : undefined}>
      {body}
    </Svg>
  );
}
