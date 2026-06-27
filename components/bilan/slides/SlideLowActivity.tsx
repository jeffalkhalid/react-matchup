import { View, Text, TouchableOpacity } from 'react-native';
import { Fonts } from '../../../lib/theme';
import type { MonthlyRecap } from '../../../lib/bilan';

// Frame C : mois calme (<3 matchs). 1 slide, ton non-culpabilisant, PAS de partage.
export function SlideLowActivity({ recap, onPrevMonth, onPing, onClose }: {
  recap: MonthlyRecap;
  onPrevMonth: () => void;
  onPing: () => void;
  onClose: () => void;
}) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 16 }}>
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 26, color: '#FFFFFF' }}>Mois en sommeil 🌱</Text>
      <View style={{ flexDirection: 'row', gap: 22, marginTop: 6 }}>
        <Stat n={recap.matches} l="matchs" />
        <Stat n={`${recap.winRate}%`} l="victoires" />
        <Stat n={`${recap.levelDelta >= 0 ? '+' : ''}${recap.levelDelta.toFixed(2)}`} l="niveau" dim />
      </View>
      <View style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16, padding: 16, marginTop: 6 }}>
        <Text style={{ fontFamily: Fonts.uiBold, fontSize: 14, color: '#FFFFFF' }}>🌱 Pas de quoi rougir</Text>
        <Text style={{ fontFamily: Fonts.ui, fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 6 }}>
          {recap.winRate >= 50 && recap.matches > 0
            ? `Tu as gagné ${recap.wins}/${recap.matches}. ${recap.winRate}% de réussite — la base est bonne.`
            : 'Une partie suffit à relancer la machine.'}
        </Text>
      </View>
      <TouchableOpacity onPress={onClose} activeOpacity={0.85}
        style={{ marginTop: 8, borderRadius: 999, paddingVertical: 13, alignItems: 'center', backgroundColor: '#FFC11A' }}>
        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 14, color: '#0A0A0A' }}>Recommencer {recap.label} sur les chapeaux →</Text>
      </TouchableOpacity>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <TouchableOpacity onPress={onPrevMonth} activeOpacity={0.85} style={{ flex: 1, borderRadius: 999, paddingVertical: 11, alignItems: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)' }}>
          <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 12, color: '#FFFFFF' }}>Voir le mois précédent</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onPing} activeOpacity={0.85} style={{ flex: 1, borderRadius: 999, paddingVertical: 11, alignItems: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)' }}>
          <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 12, color: '#FFFFFF' }}>Partager mon bilan</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
function Stat({ n, l, dim }: { n: number | string; l: string; dim?: boolean }) {
  return (
    <View>
      <Text style={{ fontFamily: Fonts.display, fontSize: 30, color: dim ? 'rgba(255,255,255,0.55)' : '#FFFFFF' }}>{n}</Text>
      <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{l}</Text>
    </View>
  );
}
