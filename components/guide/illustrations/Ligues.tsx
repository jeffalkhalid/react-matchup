import React from 'react';
import { View, Text } from 'react-native';
import { Icon } from '../../community/icons';
import { Fonts } from '../../../lib/theme';
import type { League } from '../../../types';
import { miniCard, miniLabel, Pill, LeagueSwatch } from './_shared';

// Pastille « progression » avec icône — inline car un <Icon> (SVG) ne peut pas vivre dans un <Text>.
function ProgressPill() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
      backgroundColor: 'rgba(16,185,129,0.10)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.45)',
      borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Icon name="trendingUp" size={10} color="#047857" />
      <Text style={{ color: '#047857', fontFamily: Fonts.uiBlack, fontSize: 8.5, letterSpacing: 0.4,
        textTransform: 'uppercase', marginLeft: 4 }}>+0.18 niv.</Text>
    </View>
  );
}

const ROWS: { k: League; n: string; lvl: string; cur?: boolean }[] = [
  { k: 'diamond',   n: 'Diamant',    lvl: '7.0+' },
  { k: 'gold',      n: 'Or',         lvl: '5.5', cur: true },
  { k: 'silver',    n: 'Argent',     lvl: '4.0' },
  { k: 'bronze',    n: 'Bronze',     lvl: '2.5' },
  { k: 'discovery', n: 'Découverte', lvl: '1.0' },
];

export function IllustLigues() {
  return (
    <View style={{ ...miniCard(), width: 270, padding: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Text style={miniLabel}>Ta progression</Text>
        <ProgressPill />
      </View>

      {ROWS.map((r, i) => (
        <View key={r.k} style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 11, paddingVertical: 6, paddingHorizontal: 9,
          marginBottom: i === ROWS.length - 1 ? 0 : 6,
          backgroundColor: r.cur ? 'rgba(255,193,26,0.10)' : 'transparent',
          borderWidth: 1, borderColor: r.cur ? 'rgba(255,193,26,0.45)' : 'transparent' }}>
          <LeagueSwatch league={r.k} size={26} radius={8} />
          <Text style={{ flex: 1, marginLeft: 10, fontFamily: r.cur ? Fonts.uiExtraBold : Fonts.uiBold,
            fontSize: 12.5, color: r.cur ? '#0A0A0A' : '#52525B' }}>{r.n}</Text>
          {r.cur && <View style={{ marginRight: 8 }}><Pill variant="brand" fontSize={8}>Tu es ici</Pill></View>}
          <Text style={{ fontFamily: Fonts.display, fontSize: 14, color: r.cur ? '#0A0A0A' : '#C0BBB2' }}>{r.lvl}</Text>
        </View>
      ))}
    </View>
  );
}
