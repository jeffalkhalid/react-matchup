import React from 'react';
import { View, Text } from 'react-native';
import { Icon, IconName } from '../../community/icons';
import { Fonts } from '../../../lib/theme';
import { miniCard } from './_shared';

const ITEMS: { ic: IconName; c: string; bg: string; t: string; s: string }[] = [
  { ic: 'zap',     c: '#D97706', bg: 'rgba(217,119,6,0.12)', t: 'Nouveau défi de Sami',      s: 'à l’instant' },
  { ic: 'message', c: '#0891B2', bg: 'rgba(8,145,178,0.12)', t: 'Omar a répondu au chat',    s: 'il y a 2 min' },
  { ic: 'check',   c: '#059669', bg: 'rgba(5,150,105,0.12)', t: 'Score validé · +0.18 niv.', s: 'il y a 1 h' },
];

export function IllustNotif() {
  return (
    <View style={{ width: 286 }}>
      {ITEMS.map((n, i) => (
        <View key={i} style={{ ...miniCard(), paddingVertical: 12, paddingHorizontal: 13, flexDirection: 'row',
          alignItems: 'center', marginBottom: 10, transform: [{ translateX: i * 8 }], opacity: 1 - i * 0.12,
          shadowOpacity: 0.16 - i * 0.04, shadowRadius: 26 - i * 4, shadowOffset: { width: 0, height: 10 - i * 2 } }}>
          <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: n.bg,
            alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={n.ic} size={18} color={n.c} />
          </View>
          <View style={{ flex: 1, minWidth: 0, marginLeft: 11 }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12.5, color: '#0A0A0A' }}>{n.t}</Text>
            <Text style={{ fontFamily: Fonts.ui, fontSize: 10.5, color: '#A1A1AA' }}>{n.s}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}
