import { View, Text } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import { Colors, Fonts } from '../../../lib/theme';
import { LineChartElo } from '../LineChartElo';
import type { MonthlyRecap } from '../../../lib/bilan';

// Slide 3 — Progression de NIVEAU (jamais d'ELO). Gain vert / régression rouge.
export function SlideElo({ recap }: { recap: MonthlyRecap }) {
  const up = recap.levelDelta >= 0;
  const deltaColor = up ? '#10B981' : '#EF4444';
  const leagueColor = recap.nextLeague ? Colors.league[recap.nextLeague] : '#FFC11A';
  return (
    <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 30, paddingTop: 12, paddingBottom: 34 }}>
      {/* Label */}
      <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: '#67E8F9', letterSpacing: 2, textTransform: 'uppercase' }}>Ta progression</Text>

      {/* Title */}
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 30, color: '#FFFFFF', lineHeight: 30, marginTop: 8 }}>Ton niveau a fait…</Text>

      {/* Big number */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 24 }}>
        <Text style={{ fontFamily: Fonts.display, fontSize: 48, color: deltaColor, lineHeight: 48 }}>{up ? '+' : '−'}</Text>
        <Text style={{ fontFamily: Fonts.display, fontSize: 110, color: deltaColor, lineHeight: 99, letterSpacing: -3 }}>{Math.abs(recap.levelDelta).toFixed(2)}</Text>
      </View>
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 24, color: '#FFFFFF', lineHeight: 24, marginTop: -2 }}>de niveau</Text>

      {/* From → To pill */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18 }}>
        <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: 1 }}>Niveau</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 }}>
          <Text style={{ fontFamily: Fonts.display, fontSize: 14, color: '#67E8F9' }}>{recap.fromLvl.toFixed(2)}</Text>
          <Svg width={14} height={14} viewBox="0 0 24 24">
            <Line x1="5" y1="12" x2="19" y2="12" stroke="#67E8F9" strokeWidth={2.4} strokeLinecap="round" />
            <Path d="m13 6 6 6-6 6" stroke="#67E8F9" strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
          <Text style={{ fontFamily: Fonts.display, fontSize: 18, color: '#67E8F9' }}>{recap.toLvl.toFixed(2)}</Text>
        </View>
      </View>

      {/* Line chart */}
      <View style={{ marginTop: 32, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 14, padding: 14 }}>
        <Text style={{ fontFamily: Fonts.uiBold, fontSize: 10, color: 'rgba(255,255,255,0.5)', letterSpacing: 1, textTransform: 'uppercase' }}>
          Ta courbe sur {recap.shortLabel}
        </Text>
        <View style={{ marginTop: 8 }}>
          <LineChartElo data={recap.eloTimeline} />
        </View>
      </View>

      {/* Bottom "Prochaine ligue" card — cyan gradient */}
      {recap.nextLeagueGap != null ? (
        <View style={{ marginTop: 24, backgroundColor: leagueColor, borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ fontSize: 20 }}>🏆</Text>
          <View>
            <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 10.5, color: '#0A0A0A', textTransform: 'uppercase', letterSpacing: 0.5 }}>Prochaine ligue · {recap.nextLeagueLabel}</Text>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14, color: '#0A0A0A' }}>
              À {recap.nextLeagueGap.toFixed(2)} de niveau
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
