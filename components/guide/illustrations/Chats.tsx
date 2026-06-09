import React from 'react';
import { View, Text } from 'react-native';
import { Avatar } from '../../community/Avatar';
import { Icon } from '../../community/icons';
import { Fonts } from '../../../lib/theme';
import { miniCard, Pill } from './_shared';

export function IllustChats() {
  return (
    <View style={{ ...miniCard(), width: 268, padding: 14 }}>
      {/* en-tête */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingBottom: 10, marginBottom: 9,
        borderBottomWidth: 1, borderBottomColor: '#F1F0EE' }}>
        <Avatar name="Padel Dim" size={30} radius={9} league="gold" />
        <View style={{ flex: 1, marginLeft: 9 }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: '#0A0A0A' }}>Partie de dimanche</Text>
          <Text style={{ fontFamily: Fonts.ui, fontSize: 9.5, color: '#A1A1AA' }}>4 joueurs · 10:30</Text>
        </View>
        <Pill variant="danger" fontSize={8}>2 non lus</Pill>
      </View>

      {/* message entrant + réaction */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: 9 }}>
        <Avatar name="Omar T" size={22} radius={7} league="bronze" />
        <View style={{ marginLeft: 7 }}>
          <View style={{ backgroundColor: '#F4F2EF', borderTopLeftRadius: 14, borderTopRightRadius: 14,
            borderBottomRightRadius: 14, borderBottomLeftRadius: 4, paddingVertical: 8, paddingHorizontal: 11, maxWidth: 168 }}>
            <Text style={{ fontFamily: Fonts.ui, fontSize: 11.5, color: '#0A0A0A' }}>On se cale à 10h au club ? 🎾</Text>
          </View>
          {/* badge réaction */}
          <View style={{ position: 'absolute', bottom: -8, left: 8, backgroundColor: '#fff', borderWidth: 1,
            borderColor: '#ECEAE7', borderRadius: 999, paddingVertical: 1, paddingHorizontal: 5 }}>
            <Text style={{ fontSize: 10 }}>👍 2</Text>
          </View>
        </View>
      </View>

      {/* message sortant */}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 }}>
        <View style={{ backgroundColor: '#0A0A0A', borderTopLeftRadius: 14, borderTopRightRadius: 14,
          borderBottomRightRadius: 4, borderBottomLeftRadius: 14, paddingVertical: 8, paddingHorizontal: 11, maxWidth: 168 }}>
          <Text style={{ fontFamily: Fonts.ui, fontSize: 11.5, color: '#fff' }}>Parfait, j'amène les balles 💪</Text>
        </View>
      </View>

      {/* barre de saisie */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 9, backgroundColor: '#FAFAF9',
        borderWidth: 1, borderColor: '#EFEDEA', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12 }}>
        <Text style={{ flex: 1, fontFamily: Fonts.ui, fontSize: 11, color: '#A1A1AA' }}>Un message…</Text>
        <View style={{ width: 24, height: 24, borderRadius: 999, backgroundColor: '#FFC11A',
          alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="send" size={12} color="#0A0A0A" />
        </View>
      </View>
    </View>
  );
}
