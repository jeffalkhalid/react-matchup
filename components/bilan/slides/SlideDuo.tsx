import { View, Text, TouchableOpacity } from 'react-native';
import { Fonts } from '../../../lib/theme';
import type { MonthlyRecap } from '../../../lib/bilan';

const initials = (n: string) => (n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

// Slide 4 — Meilleur duo (fond noir, accents jaune).
export function SlideDuo({ recap, onProposer }: { recap: MonthlyRecap; onProposer: () => void }) {
  const p = recap.topPartner;
  if (!p) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 }}>
        <Text style={{ fontFamily: Fonts.welcome, fontSize: 24, color: '#FFFFFF', textAlign: 'center' }}>Pas encore de duo ce mois-ci.</Text>
      </View>
    );
  }
  const first = p.name.split(' ')[0];
  const winrate = p.matchesTogether ? Math.round((100 * p.winsTogether) / p.matchesTogether) : 0;
  return (
    <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 30, paddingTop: 12, paddingBottom: 34 }}>
      {/* Label */}
      <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: '#FFC11A', letterSpacing: 2, textTransform: 'uppercase' }}>Ton meilleur duo</Text>

      {/* Title */}
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 28, color: '#FFFFFF', lineHeight: 28, marginTop: 8 }}>
        Avec qui tu as <Text style={{ color: '#FFC11A' }}>le plus gagné</Text>
      </Text>

      {/* Avatar block — horizontally centered per HTML */}
      <View style={{ alignItems: 'center', marginTop: 36 }}>
        <View style={{ width: 164, height: 164, borderRadius: 999, borderWidth: 2, borderColor: 'rgba(255,193,26,0.4)', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 140, height: 140, borderRadius: 999, backgroundColor: '#FFC11A', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: Fonts.display, fontSize: 54, color: '#0A0A0A', letterSpacing: -1 }}>{initials(p.name)}</Text>
          </View>
        </View>
        <Text style={{ fontFamily: Fonts.welcome, fontSize: 36, color: '#FFFFFF', lineHeight: 36, marginTop: 18 }}>{p.name}</Text>
        <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>@{first.toLowerCase()}</Text>
      </View>

      {/* Stats tiles */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 30 }}>
        <Tile n={p.matchesTogether} l="matchs" c="#FFFFFF" bg="rgba(255,255,255,0.05)" bd="rgba(255,255,255,0.1)" lc="rgba(255,255,255,0.6)" />
        <Tile n={`${p.winsTogether}V`} l="ensemble" c="#10B981" bg="rgba(16,185,129,0.12)" bd="rgba(16,185,129,0.3)" lc="#10B981" />
        <Tile n={`${winrate}%`} l="winrate" c="#FFC11A" bg="rgba(255,193,26,0.12)" bd="rgba(255,193,26,0.35)" lc="#FFC11A" />
      </View>

      {/* CTA button — pinned via marginTop auto */}
      <View style={{ marginTop: 24 }}>
        <TouchableOpacity onPress={onProposer} activeOpacity={0.85} style={{ backgroundColor: '#FFC11A', borderRadius: 14, paddingVertical: 13, alignItems: 'center' }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13.5, color: '#0A0A0A' }}>Proposer un match à {first} →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Tile({ n, l, c, bg, bd, lc }: { n: number | string; l: string; c: string; bg: string; bd: string; lc: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: bg, borderWidth: 1, borderColor: bd, borderRadius: 14, padding: 14, alignItems: 'center' }}>
      <Text style={{ fontFamily: Fonts.display, fontSize: 34, color: c, lineHeight: 34 }}>{n}</Text>
      <Text style={{ fontFamily: Fonts.uiBold, fontSize: 10, color: lc, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 4 }}>{l}</Text>
    </View>
  );
}
