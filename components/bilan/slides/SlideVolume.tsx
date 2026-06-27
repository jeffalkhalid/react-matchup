import { View, Text } from 'react-native';
import { Fonts } from '../../../lib/theme';
import { BarChart6Months } from '../BarChart6Months';
import type { MonthlyRecap } from '../../../lib/bilan';

// Slide 1 — Volume (fond vert foncé). Label vert menthe, "matchs en…" vert.
export function SlideVolume({ recap }: { recap: MonthlyRecap }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 30, paddingTop: 12, paddingBottom: 34 }}>
      {/* Label */}
      <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: '#6EE7B7', letterSpacing: 2, textTransform: 'uppercase' }}>Ton volume</Text>

      {/* Title */}
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 30, color: '#FFFFFF', lineHeight: 30, marginTop: 8 }}>Tu as joué…</Text>

      {/* Big number */}
      <View style={{ marginTop: 30 }}>
        <Text style={{ fontFamily: Fonts.display, fontSize: 140, color: '#FFFFFF', lineHeight: 126, letterSpacing: -3 }}>{recap.matches}</Text>
        <Text style={{ fontFamily: Fonts.welcome, fontSize: 32, color: '#10B981', lineHeight: 32, marginTop: -4 }}>matchs en {recap.shortLabel}</Text>
      </View>

      {/* Trend line */}
      {recap.monthTrend ? (
        <Text style={{ fontFamily: Fonts.uiBold, fontSize: 14, color: 'rgba(255,255,255,0.85)', lineHeight: 22, marginTop: 18 }}>{recap.monthTrend} 🔥</Text>
      ) : null}

      {/* Bar chart — uniquement s'il y a de quoi comparer (≥ 2 mois) */}
      {recap.barChart6.length >= 2 ? (
        <View style={{ marginTop: 36 }}>
          <Text style={{ fontFamily: Fonts.uiBold, fontSize: 10, color: 'rgba(255,255,255,0.5)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>Évolution sur 6 mois</Text>
          <BarChart6Months data={recap.barChart6} />
        </View>
      ) : null}

      {/* Bottom info card — pinned via marginTop auto */}
      {recap.monthTrend ? (
        <View style={{ marginTop: 24, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14 }}>
          <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>vs mois précédent</Text>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14, color: '#10B981', marginTop: 2 }}>{recap.monthTrend} 📈</Text>
        </View>
      ) : null}
    </View>
  );
}
