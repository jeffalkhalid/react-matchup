import React from 'react';
import { View, Text } from 'react-native';
import { Fonts } from '../../../lib/theme';
import { miniCard, miniLabel, Pill } from './_shared';
import { BadgePill } from '../../profile/BadgePill';

const BADGES: { n: string; got: boolean }[] = [
  { n: 'MVP', got: true },        { n: 'La Bombe', got: true },
  { n: 'Le Smash', got: false },  { n: 'Fair-Play', got: true },
  { n: 'Le Phénix', got: false }, { n: '3e Mi-temps', got: true },
];

// largeur de carte 274 - padding 15*2 - 2 gaps de 9 = 226 / 3 colonnes
const CASE_W = (274 - 30 - 18) / 3;

export function IllustBadges() {
  return (
    <View style={{ ...miniCard(), width: 274, padding: 15 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 }}>
        <Text style={miniLabel}>Badges du match</Text>
        <Pill variant="brand" fontSize={8.5}>Vote des adversaires</Pill>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
        {BADGES.map((b) => (
          <View key={b.n} style={{ width: CASE_W, alignItems: 'center', borderRadius: 13, paddingVertical: 11, paddingHorizontal: 4,
            backgroundColor: b.got ? 'rgba(255,193,26,0.10)' : '#FAFAF9',
            borderWidth: 1, borderColor: b.got ? 'rgba(255,193,26,0.40)' : '#EFEDEA',
            opacity: b.got ? 1 : 0.55 }}>
            <BadgePill badge={b.n} size={32} />
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 9, textAlign: 'center', marginTop: 5,
              color: b.got ? '#0A0A0A' : '#A1A1AA' }}>{b.n}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
