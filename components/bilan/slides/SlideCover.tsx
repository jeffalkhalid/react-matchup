import { View, Text, Image } from 'react-native';
import { Fonts } from '../../../lib/theme';
import { MonthPicker } from '../MonthPicker';
import type { MonthlyRecap } from '../../../lib/bilan';

const INK = '#0A0A0A';

// Slide 0 — Cover (fond jaune→noir fourni par le conteneur). Texte sombre. Padel, pas tennis.
export function SlideCover({ recap, months, onPickMonth }: {
  recap: MonthlyRecap; months: { key: string; label: string }[]; onPickMonth: (k: string) => void;
}) {
  const year = recap.month.slice(0, 4);
  const lvl = `${recap.levelDelta >= 0 ? '+' : ''}${recap.levelDelta.toFixed(2)}`;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingTop: 12, paddingBottom: 34 }}>
      {/* Month picker pills — top, relative to flow */}
      {months.length > 0 ? (
        <View style={{ marginTop: 6 }}>
          <MonthPicker months={months} current={recap.month} onPick={onPickMonth} />
        </View>
      ) : null}

      {/* Padel logo tile */}
      <View style={{ width: 80, height: 80, borderRadius: 22, backgroundColor: INK, alignItems: 'center', justifyContent: 'center', marginTop: 18 }}>
        <Image source={require('../../../assets/auth/splash-racket.png')} style={{ width: 48, height: 48 }} resizeMode="contain" />
      </View>

      {/* "TON MOIS EN PADEL" label */}
      <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: INK, letterSpacing: 2.5, textTransform: 'uppercase', marginTop: 14 }}>
        Ton mois en padel
      </Text>

      {/* Big month + year */}
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 62, color: INK, lineHeight: 58, textAlign: 'center', marginTop: 4 }}>
        {recap.label}{'\n'}{year}
      </Text>

      {/* Strip noir 3 stats */}
      <View style={{ flexDirection: 'row', gap: 18, backgroundColor: INK, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 16, marginTop: 22 }}>
        <Stat n={recap.matches} l="matchs" color="#FFFFFF" />
        <Divider />
        <Stat n={`${recap.wins}V`} l="victoires" color="#10B981" />
        <Divider />
        <Stat n={lvl} l="niveau" color="#10B981" />
      </View>

      {/* "Tape pour découvrir →" */}
      <View style={{ marginTop: 26 }}>
        <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: INK }}>Tape pour découvrir →</Text>
      </View>
    </View>
  );
}

function Stat({ n, l, color }: { n: number | string; l: string; color: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontFamily: Fonts.display, fontSize: 22, color, lineHeight: 22 }}>{n}</Text>
      <Text style={{ fontFamily: Fonts.uiBold, fontSize: 9.5, color: '#A1A1AA', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 3 }}>{l}</Text>
    </View>
  );
}
function Divider() { return <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.1)' }} />; }
