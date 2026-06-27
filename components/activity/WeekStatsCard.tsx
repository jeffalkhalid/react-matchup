import { View, Text } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { Colors, Fonts } from '../../lib/theme';
import type { WeekStats } from '../../lib/activityFeed';

const TILE = '#F8F8F7', TILE_BD = '#EFEDEA';

function weekRange(): string {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // 0 = lundi
  const mon = new Date(d); mon.setDate(d.getDate() - day);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const mName = (x: Date) => x.toLocaleDateString('fr-FR', { month: 'short' });
  // même mois → « 15 – 21 juin » ; à cheval → « 30 juin – 6 juil. »
  return mon.getMonth() === sun.getMonth()
    ? `${mon.getDate()} – ${sun.getDate()} ${mName(sun)}`
    : `${mon.getDate()} ${mName(mon)} – ${sun.getDate()} ${mName(sun)}`;
}

export function WeekStatsCard({ stats, levelDelta }: { stats: WeekStats; levelDelta: number }) {
  const wins = stats.results.filter(r => r === 'W').length;
  const losses = stats.results.filter(r => r === 'L').length;
  // Forme : 4 dernières + 1 "?" si < 5 (fidèle au handoff).
  const cells: (('W' | 'L') | null)[] = [...stats.results].slice(-4);
  while (cells.length < 5) cells.push(null);
  const deltaStr = `${levelDelta > 0 ? '+' : ''}${levelDelta.toFixed(2)}`;
  const deltaColor = levelDelta > 0 ? Colors.success : levelDelta < 0 ? Colors.danger : Colors.textMuted;
  // Sparkline cumulée à partir des résultats (V = +1, D = −1).
  let acc = 0; const seq = stats.results.map(r => (acc += r === 'W' ? 1 : -1));
  const pts = seq.length >= 2
    ? seq.map((v, i) => {
        const x = (i / (seq.length - 1)) * 80;
        const max = Math.max(1, ...seq.map(Math.abs));
        const y = 7 - (v / max) * 6;
        return `${x.toFixed(0)},${y.toFixed(0)}`;
      }).join(' ')
    : '0,7 80,7';

  return (
    <View style={{ backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, padding: 14, marginTop: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13.5, color: Colors.textPrimary }}>Ta semaine</Text>
        <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: Colors.textMuted }}>{weekRange()}</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        {/* Matchs */}
        <View style={{ flex: 1, backgroundColor: TILE, borderWidth: 1, borderColor: TILE_BD, borderRadius: 12, padding: 10 }}>
          <Label>Matchs</Label>
          <Text style={{ fontFamily: Fonts.display, fontSize: 28, color: Colors.textPrimary, lineHeight: 28, marginTop: 6 }}>{stats.matches}</Text>
          <Text style={{ fontFamily: Fonts.uiBold, fontSize: 10, color: Colors.textSecondary, marginTop: 3 }}>joués</Text>
        </View>

        {/* Forme */}
        <View style={{ flex: 1.3, backgroundColor: TILE, borderWidth: 1, borderColor: TILE_BD, borderRadius: 12, padding: 10 }}>
          <Label>Forme</Label>
          <View style={{ flexDirection: 'row', gap: 4, marginTop: 8 }}>
            {cells.map((c, i) => (
              <View key={i} style={{
                width: 18, height: 22, borderRadius: 5, alignItems: 'center', justifyContent: 'center',
                backgroundColor: c === 'W' ? Colors.success : c === 'L' ? Colors.danger : '#F6F5F3',
                borderWidth: c ? 0 : 1, borderStyle: 'dashed', borderColor: '#D4D4D8',
              }}>
                <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 10, color: c ? '#FFFFFF' : Colors.textMuted }}>{c === 'W' ? 'V' : c === 'L' ? 'D' : '?'}</Text>
              </View>
            ))}
          </View>
          <Text style={{ fontFamily: Fonts.uiBold, fontSize: 10, color: Colors.textSecondary, marginTop: 6 }}>{wins}V · {losses}D</Text>
        </View>

        {/* Niveau */}
        <View style={{ flex: 1, backgroundColor: TILE, borderWidth: 1, borderColor: TILE_BD, borderRadius: 12, padding: 10 }}>
          <Label>Niveau</Label>
          <Text style={{ fontFamily: Fonts.display, fontSize: 26, color: deltaColor, lineHeight: 26, marginTop: 6 }}>{deltaStr}</Text>
          <Svg width="100%" height={14} viewBox="0 0 80 14" style={{ marginTop: 2 }}>
            <Polyline points={pts} fill="none" stroke={deltaColor} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </View>
      </View>
    </View>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 9.5, color: Colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase' }}>{children}</Text>;
}
