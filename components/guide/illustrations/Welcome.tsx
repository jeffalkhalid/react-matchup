import React from 'react';
import { View, Text } from 'react-native';
import { Icon, IconName } from '../../community/icons';
import { Fonts } from '../../../lib/theme';
import { miniCard } from './_shared';

const STEPS: { ic: IconName; c: string; bg: string; t: string; s: string }[] = [
  { ic: 'radar',  c: '#2563EB', bg: 'rgba(37,99,235,0.10)', t: 'Trouve une partie',     s: 'Lobby & recherche' },
  { ic: 'swords', c: '#D97706', bg: 'rgba(217,119,6,0.11)', t: 'Joue & valide le score', s: 'Les 4 joueurs confirment' },
  { ic: 'trophy', c: '#059669', bg: 'rgba(5,150,105,0.10)', t: 'Grimpe les ligues',      s: 'Ton ELO évolue' },
];

export function IllustWelcome() {
  return (
    <View style={{ ...miniCard(), width: 268, paddingVertical: 16, paddingHorizontal: 15 }}>
      {STEPS.map((s, i) => (
        <View key={s.t} style={{ flexDirection: 'row' }}>
          {/* colonne icône + connecteur */}
          <View style={{ alignItems: 'center' }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: s.bg,
              alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={s.ic} size={19} color={s.c} />
            </View>
            {i < STEPS.length - 1 && <View style={{ width: 2, height: 22, backgroundColor: '#ECEAE7', marginVertical: 4 }} />}
          </View>
          <View style={{ flex: 1, marginLeft: 12, paddingTop: 4, paddingBottom: i < STEPS.length - 1 ? 12 : 0 }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: '#0A0A0A' }}>{s.t}</Text>
            <Text style={{ fontFamily: Fonts.ui, fontSize: 11, color: '#A1A1AA', marginTop: 1 }}>{s.s}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}
