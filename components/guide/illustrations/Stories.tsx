import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Icon, IconName } from '../../community/icons';
import { Fonts } from '../../../lib/theme';
import { miniCard, GradientRect, Pill } from './_shared';

const TILES: { ic: IconName; label: string }[] = [
  { ic: 'camera', label: 'Photo' },
  { ic: 'trophy', label: 'Résultat' },
  { ic: 'share',  label: 'Profil' },
];

export function IllustStories() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {/* carte story 9:16 */}
      <View style={{ width: 138, height: 232, borderRadius: 22, overflow: 'hidden', borderWidth: 3, borderColor: '#0A0A0A' }}>
        <View style={StyleSheet.absoluteFill}>
          <GradientRect colors={['#1A1A1C', '#0A0A0A']} width={138} height={232} />
        </View>
        {/* halo rose */}
        <View style={{ position: 'absolute', top: -20, right: -20, width: 90, height: 90, borderRadius: 50,
          backgroundColor: 'rgba(219,39,119,0.30)' }} />

        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, padding: 13 }}>
          <Pill variant="brand" fontSize={7.5}>🎾 Victoire</Pill>
          <View style={{ flex: 1 }} />
          <Text style={{ fontFamily: Fonts.welcome, fontSize: 24, lineHeight: 24, textTransform: 'uppercase', color: '#fff' }}>
            Karim{'\n'}gagne 6-3 6-4
          </Text>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10, color: '#FFC11A', marginTop: 6 }}>Niveau 6.02 · +0.18</Text>
          {/* bloc QR */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 11, borderRadius: 12, padding: 8,
            backgroundColor: 'rgba(255,255,255,0.10)' }}>
            <View style={{ width: 34, height: 34, borderRadius: 7, backgroundColor: '#fff',
              alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="qr" size={22} color="#0A0A0A" />
            </View>
            <Text style={{ fontFamily: Fonts.uiBold, fontSize: 8.5, color: 'rgba(255,255,255,0.85)', marginLeft: 8, lineHeight: 11 }}>
              Rejoins-moi sur{'\n'}<Text style={{ color: '#fff' }}>PagMatch</Text>
            </Text>
          </View>
        </View>
      </View>

      {/* colonne de tuiles */}
      <View style={{ marginLeft: 12 }}>
        {TILES.map((t, i) => (
          <View key={t.label} style={{ ...miniCard({ borderColor: i === 0 ? 'rgba(219,39,119,0.4)' : '#ECEAE7' }),
            flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 11,
            marginBottom: i === TILES.length - 1 ? 0 : 9 }}>
            <View style={{ width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
              backgroundColor: i === 0 ? 'rgba(219,39,119,0.12)' : '#FAFAF9' }}>
              <Icon name={t.ic} size={14} color={i === 0 ? '#DB2777' : '#52525B'} />
            </View>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: '#0A0A0A', marginLeft: 8 }}>{t.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
