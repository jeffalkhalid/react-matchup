import { View, Text } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import { Colors, Fonts } from '../../lib/theme';
import { BarChart6Months } from '../bilan/BarChart6Months';
import { LineChartElo } from '../bilan/LineChartElo';
import type { MonthlyRecap } from '../../lib/bilan';

// Affiche un bilan mensuel EN ENTIER (toutes les sections), pour un post partagé.
// Rendu sur fond sombre (overlay). Lecture seule.
export function BilanRecapFull({ recap }: { recap: MonthlyRecap }) {
  const up = recap.levelDelta >= 0;
  const deltaColor = up ? '#10B981' : '#EF4444';
  const cells: ('V' | 'D')[] = [...Array(recap.wins).fill('V'), ...Array(recap.losses).fill('D')];
  const p = recap.topPartner;
  const b = recap.bestMatch;

  return (
    <View style={{ gap: 12 }}>
      {/* En-tête + 3 chiffres */}
      <Section>
        <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: Colors.brand, letterSpacing: 1.5, textTransform: 'uppercase' }}>Bilan {recap.label}</Text>
        <View style={{ flexDirection: 'row', gap: 22, marginTop: 10 }}>
          <Stat n={recap.matches} l="matchs" c="#FFFFFF" />
          <Stat n={`${recap.winRate}%`} l="winrate" c="#10B981" />
          <Stat n={`${up ? '+' : ''}${recap.levelDelta.toFixed(2)}`} l="niveau" c={deltaColor} />
        </View>
      </Section>

      {/* Volume */}
      {recap.barChart6.length >= 2 ? (
        <Section>
          <Label>Volume · 6 mois</Label>
          <View style={{ marginTop: 8 }}><BarChart6Months data={recap.barChart6} /></View>
        </Section>
      ) : null}

      {/* Forme */}
      {cells.length > 0 ? (
        <Section>
          <Label>Forme · {recap.wins}V · {recap.losses}D</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {cells.map((c, i) => (
              <View key={i} style={{ width: 30, height: 30, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: c === 'V' ? '#10B981' : '#EF4444' }}>
                <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 12, color: '#FFFFFF' }}>{c}</Text>
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      {/* Progression */}
      <Section>
        <Label>Progression</Label>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 }}>
          <Text style={{ fontFamily: Fonts.display, fontSize: 34, color: deltaColor }}>{up ? '+' : '−'}{Math.abs(recap.levelDelta).toFixed(2)}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 }}>
            <Text style={{ fontFamily: Fonts.display, fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>{recap.fromLvl.toFixed(2)}</Text>
            <Svg width={12} height={12} viewBox="0 0 24 24"><Line x1="5" y1="12" x2="19" y2="12" stroke="#67E8F9" strokeWidth={2.4} strokeLinecap="round" /><Path d="m13 6 6 6-6 6" stroke="#67E8F9" strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg>
            <Text style={{ fontFamily: Fonts.display, fontSize: 16, color: '#67E8F9' }}>{recap.toLvl.toFixed(2)}</Text>
          </View>
        </View>
        {recap.eloTimeline.length >= 2 ? <View style={{ marginTop: 8 }}><LineChartElo data={recap.eloTimeline} /></View> : null}
      </Section>

      {/* Meilleur duo */}
      {p ? (
        <Section>
          <Label>Meilleur duo</Label>
          <Text style={{ fontFamily: Fonts.welcome, fontSize: 22, color: '#FFFFFF', marginTop: 4 }}>{p.name}</Text>
          <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>{p.matchesTogether} matchs · {p.winsTogether}V ensemble</Text>
        </Section>
      ) : null}

      {/* Meilleur match */}
      {b ? (
        <Section>
          <Label>Match du mois</Label>
          <Text style={{ fontFamily: Fonts.display, fontSize: 30, color: '#10B981', marginTop: 4 }}>{b.sets.map(([a, c]) => `${a}/${c}`).join('  ')}</Text>
          <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
            {b.venue}{b.opponents.length ? ` · vs ${b.opponents.map(o => o.split(' ')[0]).join(' & ')}` : ''}
          </Text>
        </Section>
      ) : null}

      {/* Badges */}
      {recap.badges.length ? (
        <Section>
          <Label>Badge{recap.badges.length > 1 ? 's' : ''} débloqué{recap.badges.length > 1 ? 's' : ''}</Label>
          <Text style={{ fontFamily: Fonts.uiBold, fontSize: 14, color: '#FFFFFF', marginTop: 4 }}>{recap.badges.map(bd => bd.name).join(' · ')}</Text>
        </Section>
      ) : null}
    </View>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16, padding: 16 }}>{children}</View>;
}
function Label({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontFamily: Fonts.uiBold, fontSize: 10, color: 'rgba(255,255,255,0.5)', letterSpacing: 1, textTransform: 'uppercase' }}>{children}</Text>;
}
function Stat({ n, l, c }: { n: number | string; l: string; c: string }) {
  return (
    <View>
      <Text style={{ fontFamily: Fonts.display, fontSize: 28, color: c, lineHeight: 28 }}>{n}</Text>
      <Text style={{ fontFamily: Fonts.uiBold, fontSize: 10, color: 'rgba(255,255,255,0.6)', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 2 }}>{l}</Text>
    </View>
  );
}
