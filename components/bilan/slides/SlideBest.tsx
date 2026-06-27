import { View, Text } from 'react-native';
import Svg from 'react-native-svg';
import { Fonts } from '../../../lib/theme';
import { Glyph } from '../../profile/glyphs';
import type { MonthlyRecap } from '../../../lib/bilan';

const initials = (n: string) => (n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const fmtDate = (iso: string) => { try { return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }); } catch { return iso; } };

// Slide 5 — Match du mois (fond gris foncé, score VERT, badge jaune).
export function SlideBest({ recap }: { recap: MonthlyRecap }) {
  const b = recap.bestMatch;
  const badge = recap.badges[0];
  return (
    <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 30, paddingTop: 12, paddingBottom: 34 }}>
      {/* Label */}
      <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: '#FFC11A', letterSpacing: 2, textTransform: 'uppercase' }}>Ton match du mois</Text>

      {b ? (
        <>
          {/* Title */}
          <Text style={{ fontFamily: Fonts.welcome, fontSize: 28, color: '#FFFFFF', lineHeight: 28, marginTop: 8 }}>
            Le <Text style={{ color: '#FFC11A' }}>{fmtDate(b.date)}</Text> tu as fait ça
          </Text>

          {/* Score card */}
          <View style={{ marginTop: 36, backgroundColor: 'rgba(16,185,129,0.06)', borderWidth: 1.5, borderColor: 'rgba(16,185,129,0.4)', borderRadius: 18, padding: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <View style={{ backgroundColor: '#10B981', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 9.5, color: '#FFFFFF', letterSpacing: 0.5 }}>VICTOIRE</Text>
              </View>
              <Text style={{ fontFamily: Fonts.uiBold, fontSize: 10.5, color: 'rgba(255,255,255,0.5)' }} numberOfLines={1}>{b.venue}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ gap: 6 }}>
                <Row label="Toi" mono="black" />
                {b.partnerName ? <Row label={b.partnerName.split(' ')[0]} mono="black" initialsName={b.partnerName} /> : null}
              </View>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                {b.sets.map(([a, c], i) => (
                  <View key={i} style={{ alignItems: 'center' }}>
                    <Text style={{ fontFamily: Fonts.display, fontSize: 40, color: '#10B981', lineHeight: 38 }}>{a}</Text>
                    <Text style={{ fontFamily: Fonts.display, fontSize: 40, color: 'rgba(255,255,255,0.35)', lineHeight: 38 }}>{c}</Text>
                  </View>
                ))}
              </View>
              <View style={{ gap: 6, alignItems: 'flex-end' }}>
                {b.opponents.slice(0, 2).map((o, i) => <Row key={i} label={o.split(' ')[0]} mono="yellow" initialsName={o} right />)}
              </View>
            </View>
          </View>

          {/* Badge card */}
          {badge ? (
            <View style={{ marginTop: 24, backgroundColor: '#FFC11A', borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Svg width={42} height={42} viewBox="0 0 24 24"><Glyph name={badge.glyph} color="#0A0A0A" /></Svg>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 9.5, color: '#0A0A0A', letterSpacing: 1, textTransform: 'uppercase' }}>+ badge débloqué</Text>
                <Text style={{ fontFamily: Fonts.welcome, fontSize: 22, color: '#0A0A0A', lineHeight: 22, marginTop: 2 }}>{badge.name}</Text>
              </View>
            </View>
          ) : null}
        </>
      ) : (
        <Text style={{ fontFamily: Fonts.welcome, fontSize: 24, color: '#FFFFFF', marginTop: 8 }}>Pas de match marquant ce mois-ci.</Text>
      )}
    </View>
  );
}

function Row({ label, mono, initialsName, right }: { label: string; mono: 'black' | 'yellow'; initialsName?: string; right?: boolean }) {
  const av = (
    <View style={{ width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
      backgroundColor: mono === 'black' ? '#0A0A0A' : '#FFC11A', borderWidth: mono === 'black' ? 1 : 0, borderColor: '#FFC11A' }}>
      <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 9, color: mono === 'black' ? '#FFC11A' : '#0A0A0A' }}>{initials(initialsName ?? label)}</Text>
    </View>
  );
  const txt = <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: '#FFFFFF' }}>{label}</Text>;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {right ? <>{txt}{av}</> : <>{av}{txt}</>}
    </View>
  );
}
