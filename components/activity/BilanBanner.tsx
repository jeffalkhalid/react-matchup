import { View, Text, TouchableOpacity, Image } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import type { MonthlyRecap } from '../../lib/bilan';

// Bannière bilan riche (façon handoff) — NOUVEAU MOIS · mois · 3 stats · CTA.
// Fond jaune dégradé approximé par aplat jaune + tuile racket. Niveau, pas ELO.
export function BilanBanner({ recap, onPress }: { recap: MonthlyRecap | null; onPress: () => void }) {
  if (!recap) return null;
  const year = recap.month.slice(0, 4);
  const lvl = `${recap.levelDelta >= 0 ? '+' : ''}${recap.levelDelta.toFixed(2)}`;
  const lvlColor = recap.levelDelta > 0 ? '#10B981' : recap.levelDelta < 0 ? Colors.danger : '#0A0A0A';
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9}
      style={{ backgroundColor: Colors.brand, borderRadius: 18, padding: 14, marginTop: 14, overflow: 'hidden' }}>
      <Image source={require('../../assets/auth/splash-racket.png')}
        style={{ position: 'absolute', top: -18, right: -18, width: 110, height: 110, opacity: 0.18 }} resizeMode="contain" />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ backgroundColor: '#0A0A0A', borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 9, color: Colors.brand, letterSpacing: 0.5 }}>NOUVEAU MOIS</Text>
        </View>
        <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 9.5, color: '#0A0A0A', letterSpacing: 1.2, textTransform: 'uppercase' }}>Ton bilan</Text>
      </View>

      <Text style={{ fontFamily: Fonts.welcome, fontSize: 30, color: '#0A0A0A', lineHeight: 30, marginTop: 6 }}>{recap.label} {year}</Text>

      <View style={{ flexDirection: 'row', marginTop: 14 }}>
        <Stat n={recap.matches} l="matchs" />
        <Stat n={`${recap.wins}V·${recap.losses}D`} l="bilan" />
        <Stat n={lvl} l="niveau" color={lvlColor} />
      </View>

      <View style={{ backgroundColor: '#0A0A0A', borderRadius: 10, paddingVertical: 9, alignItems: 'center', marginTop: 14 }}>
        <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11.5, color: Colors.brand }}>Voir ton bilan complet →</Text>
      </View>
    </TouchableOpacity>
  );
}

function Stat({ n, l, color = '#0A0A0A' }: { n: number | string; l: string; color?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontFamily: Fonts.display, fontSize: 24, color, lineHeight: 24 }}>{n}</Text>
      <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10, color: 'rgba(10,10,10,0.75)', marginTop: 1 }}>{l}</Text>
    </View>
  );
}
