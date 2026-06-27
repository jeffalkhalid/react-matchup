import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Rect, Defs, LinearGradient, Stop } from 'react-native-svg';

// Fond dégradé plein écran. On mesure la taille réelle (onLayout) plutôt que
// d'utiliser "100%" qui peut mal se résoudre côté Android (bande/rect partiel).
export function GradientBg({ colors, angle = 160, children }: {
  colors: string[]; angle?: number; children?: React.ReactNode;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
  };
  const rad = (angle * Math.PI) / 180;
  const x2 = (Math.cos(rad) * 0.5 + 0.5).toFixed(3);
  const y2 = (Math.sin(rad) * 0.5 + 0.5).toFixed(3);
  const stops = colors.length >= 2 ? colors : [colors[0] ?? '#0A0A0A', colors[0] ?? '#0A0A0A'];
  return (
    <View style={{ flex: 1, backgroundColor: stops[stops.length - 1] }} onLayout={onLayout}>
      {size.w > 0 ? (
        <Svg width={size.w} height={size.h} style={{ position: 'absolute' }}>
          <Defs>
            <LinearGradient id="bilanbg" x1="0" y1="0" x2={x2} y2={y2}>
              {stops.map((c, i) => (
                <Stop key={i} offset={(i / (stops.length - 1)).toFixed(3)} stopColor={c} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={size.w} height={size.h} fill="url(#bilanbg)" />
        </Svg>
      ) : null}
      {children}
    </View>
  );
}
