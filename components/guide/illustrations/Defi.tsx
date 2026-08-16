import React from 'react';
import { View, Text } from 'react-native';
import { Avatar } from '../../community/Avatar';
import { Icon } from '../../community/icons';
import { Fonts } from '../../../lib/theme';
import { miniCard, Pill } from './_shared';

// Défi 2v2 (refonte binôme vs binôme) : on relève À DEUX — le mockup montre le
// binôme adverse déjà formé, et côté « Toi » l'emplacement binôme à choisir.
// Note : Fonts.welcome est déjà la variante Black Italic — pas besoin de fontStyle.
export function IllustDefi() {
  return (
    <View style={{ ...miniCard(), width: 280, paddingVertical: 18, paddingHorizontal: 16, overflow: 'hidden' }}>
      {/* halo décoratif */}
      <View style={{ position: 'absolute', top: -30, right: -30, width: 110, height: 110, borderRadius: 60,
        backgroundColor: 'rgba(245,158,11,0.08)' }} />

      <View style={{ alignItems: 'center', marginBottom: 14 }}>
        <Pill variant="warning" fontSize={9}>⚡ Défi 2v2 · Mise ×2.0</Pill>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center' }}>
        {/* Binôme adverse (déjà verrouillé) */}
        <View style={{ alignItems: 'center' }}>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ borderWidth: 2, borderColor: '#fff', borderRadius: 16, zIndex: 2 }}>
              <Avatar name="Karim B" size={44} radius={14} league="gold" />
            </View>
            <View style={{ marginLeft: -10, borderWidth: 2, borderColor: '#fff', borderRadius: 16 }}>
              <Avatar name="Sofia I" size={44} radius={14} league="silver" />
            </View>
          </View>
          <Text style={{ fontFamily: Fonts.welcome, fontSize: 13, lineHeight: 17, textTransform: 'uppercase', color: '#0A0A0A', marginTop: 6 }}>Karim & Sofia</Text>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10, color: '#E8A906' }}>Moy. 5.3</Text>
        </View>

        {/* VS */}
        <View style={{ alignItems: 'center', marginHorizontal: 12, marginTop: 4 }}>
          <View style={{ width: 38, height: 38, borderRadius: 999, backgroundColor: '#0A0A0A',
            alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="swords" size={19} color="#FFC11A" stroke={2.2} />
          </View>
          <Text style={{ fontFamily: Fonts.display, fontSize: 13, lineHeight: 17, color: '#A1A1AA', letterSpacing: 0.5, marginTop: 4 }}>VS</Text>
        </View>

        {/* Toi + binôme à choisir */}
        <View style={{ alignItems: 'center' }}>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ borderWidth: 2, borderColor: '#fff', borderRadius: 16, zIndex: 2 }}>
              <Avatar name="Toi K" size={44} radius={14} league="gold" />
            </View>
            <View style={{ marginLeft: -10, width: 48, height: 48, borderRadius: 16, borderWidth: 2, borderStyle: 'dashed',
              borderColor: '#D8D4CE', backgroundColor: '#FAFAF9', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: Fonts.display, fontSize: 18, lineHeight: 23, color: '#C0BBB2' }}>?</Text>
            </View>
          </View>
          <Text style={{ fontFamily: Fonts.welcome, fontSize: 13, lineHeight: 17, textTransform: 'uppercase', color: '#0A0A0A', marginTop: 6 }}>Toi + binôme</Text>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10, color: '#A1A1AA' }}>À choisir</Text>
        </View>
      </View>

      <View style={{ marginTop: 16, height: 38, borderRadius: 999, backgroundColor: '#FFC11A',
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="swords" size={14} color="#0A0A0A" stroke={2.4} />
        <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12.5, color: '#0A0A0A', marginLeft: 6 }}>Relever à deux</Text>
      </View>
    </View>
  );
}
