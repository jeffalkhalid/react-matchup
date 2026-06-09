import React from 'react';
import { View, Text } from 'react-native';
import { Avatar } from '../../community/Avatar';
import { Icon } from '../../community/icons';
import { Fonts } from '../../../lib/theme';
import { miniCard, miniLabel, Pill } from './_shared';

export function IllustLobby() {
  return (
    <View style={{ width: 290 }}>
      {/* carte fantôme en fond pour la profondeur */}
      <View style={{ ...miniCard(), position: 'absolute', top: -14, left: 16, right: 16, height: 70,
        transform: [{ rotate: '-2.5deg' }], opacity: 0.5 }} />

      {/* partie urgente */}
      <View style={{ ...miniCard({ borderColor: 'rgba(239,68,68,0.30)' }), padding: 14, marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 }}>
          <Pill variant="danger" fontSize={9}>🆘 Urgent · 1 place</Pill>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: '#52525B' }}>Auj. 19:00</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <Avatar name="Karim B" size={30} radius={10} league="gold" />
          <View style={{ width: 6 }} />
          <Avatar name="Sofia I" size={30} radius={10} league="silver" />
          <View style={{ width: 6 }} />
          <Avatar name="Omar T" size={30} radius={10} league="gold" />
          <View style={{ width: 6 }} />
          <View style={{ width: 30, height: 30, borderRadius: 10, borderWidth: 2, borderStyle: 'dashed',
            borderColor: '#D8D4CE', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: Fonts.display, fontSize: 16, color: '#C0BBB2' }}>?</Text>
          </View>
          <View style={{ flex: 1 }} />
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ ...miniLabel, fontSize: 8 }}>Niveau</Text>
            <Text style={{ fontFamily: Fonts.display, fontSize: 17, color: '#0A0A0A' }}>5.5–6</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 11, borderTopWidth: 1, borderTopColor: '#F1F0EE' }}>
          <Icon name="mapPin" size={13} color="#A1A1AA" />
          <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: '#52525B', marginLeft: 6 }}>Padel Club Casa · Piste 3</Text>
          <View style={{ flex: 1 }} />
          <View style={{ backgroundColor: '#FFC11A', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}>
            <Text style={{ color: '#0A0A0A', fontFamily: Fonts.uiExtraBold, fontSize: 10.5 }}>Rejoindre</Text>
          </View>
        </View>
      </View>

      {/* partie normale */}
      <View style={{ ...miniCard(), paddingVertical: 11, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row' }}>
          <View style={{ borderWidth: 2, borderColor: '#fff', borderRadius: 9 }}>
            <Avatar name="Yassine R" size={26} radius={8} league="gold" />
          </View>
          <View style={{ marginLeft: -9, borderWidth: 2, borderColor: '#fff', borderRadius: 9 }}>
            <Avatar name="Nadia E" size={26} radius={8} league="bronze" />
          </View>
        </View>
        <View style={{ flex: 1, marginLeft: 9 }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11.5, color: '#0A0A0A' }}>Double · Dimanche</Text>
          <Text style={{ fontFamily: Fonts.ui, fontSize: 10, color: '#A1A1AA' }}>2 places · Niv. 4–5</Text>
        </View>
        <Pill variant="success" fontSize={8.5}>10:30</Pill>
      </View>
    </View>
  );
}
