import { View, Text } from 'react-native';
import { Fonts } from '../../../lib/theme';
import type { MonthlyRecap } from '../../../lib/bilan';

// Slide 2 — Forme. Winrate en VERT (handoff) ; label "TA FORME" jaune ; carrés V/D vert/rouge (sémantique).
export function SlideForme({ recap }: { recap: MonthlyRecap }) {
  // grille V/D : uniquement les vrais matchs (pas de cases vides).
  const cells: ('V' | 'D')[] = [...Array(recap.wins).fill('V'), ...Array(recap.losses).fill('D')];

  return (
    <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 30, paddingTop: 12, paddingBottom: 34 }}>
      {/* Label */}
      <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: '#FFC11A', letterSpacing: 2, textTransform: 'uppercase' }}>Ta forme</Text>

      {/* Title */}
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 30, color: '#FFFFFF', lineHeight: 30, marginTop: 8 }}>Tu as gagné…</Text>

      {/* Big number */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12, marginTop: 24 }}>
        <Text style={{ fontFamily: Fonts.display, fontSize: 130, color: '#10B981', lineHeight: 117, letterSpacing: -3 }}>{recap.winRate}</Text>
        <Text style={{ fontFamily: Fonts.display, fontSize: 54, color: '#10B981', lineHeight: 54 }}>%</Text>
      </View>
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 24, color: '#FFFFFF', lineHeight: 24, marginTop: -6 }}>de tes matchs</Text>

      {/* V/D summary line */}
      <Text style={{ fontFamily: Fonts.uiBold, fontSize: 14, color: 'rgba(255,255,255,0.85)', marginTop: 18 }}>
        {recap.wins} victoires, {recap.losses} défaites.
      </Text>

      {/* V/D grid */}
      <View style={{ marginTop: 28 }}>
        <Text style={{ fontFamily: Fonts.uiBold, fontSize: 10, color: 'rgba(255,255,255,0.5)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
          Tes matchs · {recap.shortLabel}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {cells.map((c, i) => (
            <View key={i} style={{
              width: 40, height: 40, borderRadius: 7, alignItems: 'center', justifyContent: 'center',
              backgroundColor: c === 'V' ? '#10B981' : '#EF4444',
            }}>
              <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 14, color: '#FFFFFF' }}>{c}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Bottom info card — pinned via marginTop auto */}
      <View style={{ marginTop: 24, backgroundColor: 'rgba(255,193,26,0.12)', borderWidth: 1, borderColor: 'rgba(255,193,26,0.35)', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14 }}>
        <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: '#FFC11A' }}>Ta réussite ce mois-ci</Text>
        <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14, color: '#FFFFFF', marginTop: 2 }}>{recap.winRate}% sur {recap.matches} matchs 🥇</Text>
      </View>
    </View>
  );
}
