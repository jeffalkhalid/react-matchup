import Svg, { Polyline, Polygon, Circle, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { Fonts } from '../../lib/theme';
import { View, Text } from 'react-native';

// Courbe de progression du mois — ligne verte + aire dégradée (handoff). Axes 1ᵉʳ/15/30.
export function LineChartElo({ data, width = 280, height = 120 }: {
  data: { i: number; elo: number }[]; width?: number; height?: number;
}) {
  if (data.length < 2) {
    return (
      <View style={{ width: '100%', height, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Pas assez de données</Text>
      </View>
    );
  }
  const xs = data.map(d => d.i), ys = data.map(d => d.elo);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 8;
  const sx = (x: number) => pad + ((x - minX) / Math.max(1, maxX - minX)) * (width - 2 * pad);
  const sy = (y: number) => height - 22 - ((y - minY) / Math.max(1, maxY - minY)) * (height - 30);
  const pts = data.map(d => `${sx(d.i).toFixed(1)},${sy(d.elo).toFixed(1)}`).join(' ');
  const area = `${sx(minX).toFixed(1)},${(height - 22).toFixed(1)} ${pts} ${sx(maxX).toFixed(1)},${(height - 22).toFixed(1)}`;
  const last = data[data.length - 1];
  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
      <Defs>
        <LinearGradient id="eloGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#10B981" stopOpacity="0.35" />
          <Stop offset="1" stopColor="#10B981" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Polygon points={area} fill="url(#eloGrad)" />
      <Polyline points={pts} fill="none" stroke="#10B981" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={sx(last.i)} cy={sy(last.elo)} r={8} fill="#10B981" opacity={0.25} />
      <Circle cx={sx(last.i)} cy={sy(last.elo)} r={4} fill="#10B981" />
      <SvgText x={0} y={height - 4} fontFamily="Inter" fontSize={9} fontWeight="700" fill="rgba(255,255,255,0.4)">1ᵉʳ</SvgText>
      <SvgText x={width / 2 - 8} y={height - 4} fontFamily="Inter" fontSize={9} fontWeight="700" fill="rgba(255,255,255,0.4)">15</SvgText>
      <SvgText x={width - 18} y={height - 4} fontFamily="Inter" fontSize={9} fontWeight="700" fill="rgba(255,255,255,0.4)">30</SvgText>
    </Svg>
  );
}
