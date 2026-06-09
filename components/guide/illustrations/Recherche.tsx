import React from 'react';
import { View, Text } from 'react-native';
import { Avatar } from '../../community/Avatar';
import { Icon } from '../../community/icons';
import { Fonts, getLeagueLabel } from '../../../lib/theme';
import type { League } from '../../../types';
import { miniCard, miniLabel } from './_shared';

const ROWS: { n: string; lvl: string; lg: League; frmt: boolean }[] = [
  { n: 'Sami Lahlou',  lvl: '5.40', lg: 'silver', frmt: true },
  { n: 'Inès Berrada', lvl: '6.10', lg: 'gold',   frmt: false },
];

export function IllustRecherche() {
  return (
    <View style={{ ...miniCard(), width: 278, padding: 14 }}>
      {/* champ de recherche */}
      <View style={{ flexDirection: 'row', alignItems: 'center', height: 40, borderRadius: 12,
        backgroundColor: '#FAFAF9', borderWidth: 1.5, borderColor: 'rgba(79,70,229,0.45)', paddingHorizontal: 12 }}>
        <Icon name="search" size={16} color="#4F46E5" />
        <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 12.5, color: '#0A0A0A', marginLeft: 9 }}>
          Sami<Text style={{ color: '#4F46E5' }}>|</Text>
        </Text>
        <View style={{ flex: 1 }} />
        <Icon name="sliders" size={15} color="#A1A1AA" />
      </View>

      <Text style={{ ...miniLabel, marginTop: 12, marginBottom: 8 }}>Résultats</Text>

      {ROWS.map((r, i) => (
        <View key={r.n} style={{ flexDirection: 'row', alignItems: 'center', padding: 8, borderRadius: 12,
          marginBottom: i === ROWS.length - 1 ? 0 : 8,
          backgroundColor: i === 0 ? 'rgba(79,70,229,0.06)' : '#FAFAF9',
          borderWidth: 1, borderColor: i === 0 ? 'rgba(79,70,229,0.30)' : '#EFEDEA' }}>
          <Avatar name={r.n} size={32} radius={10} league={r.lg} />
          <View style={{ flex: 1, minWidth: 0, marginLeft: 9 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: '#0A0A0A' }}>{r.n}</Text>
              {r.frmt && <Text style={{ fontSize: 9, color: '#10B981', marginLeft: 5 }}>✓</Text>}
            </View>
            <Text style={{ fontFamily: Fonts.uiBold, fontSize: 9.5, color: '#A1A1AA', marginTop: 1 }}>
              Niv. {r.lvl} · {getLeagueLabel(r.lg)}
            </Text>
          </View>
          <View style={{ borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
            backgroundColor: i === 0 ? '#0A0A0A' : '#fff',
            borderWidth: i === 0 ? 0 : 1, borderColor: '#E7E5E4' }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10, color: i === 0 ? '#fff' : '#52525B' }}>Défier</Text>
          </View>
        </View>
      ))}
    </View>
  );
}
