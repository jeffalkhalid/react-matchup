import React from 'react';
import { View, Text } from 'react-native';
import { Avatar } from '../../community/Avatar';
import { Icon } from '../../community/icons';
import { Fonts } from '../../../lib/theme';
import { miniCard, Pill } from './_shared';

// Note : Fonts.welcome est déjà la variante Black Italic — pas besoin de fontStyle.
export function IllustDefi() {
  return (
    <View style={{ ...miniCard(), width: 280, paddingVertical: 18, paddingHorizontal: 16, overflow: 'hidden' }}>
      {/* halo décoratif */}
      <View style={{ position: 'absolute', top: -30, right: -30, width: 110, height: 110, borderRadius: 60,
        backgroundColor: 'rgba(217,119,6,0.08)' }} />

      <View style={{ alignItems: 'center', marginBottom: 14 }}>
        <Pill variant="warning" fontSize={9}>⚡ Défi en attente</Pill>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
        {/* Toi */}
        <View style={{ alignItems: 'center' }}>
          <Avatar name="Toi K" size={54} radius={18} league="gold" />
          <Text style={{ fontFamily: Fonts.welcome, fontSize: 14, textTransform: 'uppercase', color: '#0A0A0A', marginTop: 6 }}>Toi</Text>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10, color: '#E8A906' }}>Niv. 6.02</Text>
        </View>

        {/* VS */}
        <View style={{ alignItems: 'center', marginHorizontal: 14 }}>
          <View style={{ width: 38, height: 38, borderRadius: 999, backgroundColor: '#0A0A0A',
            alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="swords" size={19} color="#FFC11A" stroke={2.2} />
          </View>
          <Text style={{ fontFamily: Fonts.display, fontSize: 13, color: '#A1A1AA', letterSpacing: 0.5, marginTop: 4 }}>VS</Text>
        </View>

        {/* Sami */}
        <View style={{ alignItems: 'center' }}>
          <Avatar name="Sami L" size={54} radius={18} league="silver" />
          <Text style={{ fontFamily: Fonts.welcome, fontSize: 14, textTransform: 'uppercase', color: '#0A0A0A', marginTop: 6 }}>Sami</Text>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10, color: '#A1A1AA' }}>Niv. 5.40</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', marginTop: 16 }}>
        <View style={{ flex: 1, height: 38, borderRadius: 999, borderWidth: 1, borderColor: '#E7E5E4',
          backgroundColor: '#FAFAF9', alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: '#52525B' }}>Refuser</Text>
        </View>
        <View style={{ flex: 1.4, height: 38, borderRadius: 999, backgroundColor: '#FFC11A',
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="zap" size={14} color="#0A0A0A" fill="#0A0A0A" />
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12.5, color: '#0A0A0A', marginLeft: 6 }}>Relever le défi</Text>
        </View>
      </View>
    </View>
  );
}
