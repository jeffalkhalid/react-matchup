// Les deux CTA principaux de l'accueil : « Matchmaking » (jaune, dominant) →
// Explorer, et « Match défi » (noir) → onglet Défi. UI pure — la navigation
// est fournie par l'écran.
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon, type IconName } from '../community/icons';

function PrimaryCta({ variant, icon, title, onPress }: {
  variant: 'brand' | 'dark';
  icon: IconName; title: string;
  onPress: () => void;
}) {
  const dark = variant === 'dark';
  const fg = dark ? Colors.textOnDark : Colors.primary;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.88}
      style={{
        flex: 1,
        backgroundColor: dark ? Colors.heroBg : Colors.brand,
        borderRadius: 20,
        paddingVertical: 10, paddingHorizontal: 11,
        flexDirection: 'row', alignItems: 'center', gap: 8,
        shadowColor: dark ? '#000' : Colors.brandDeep,
        shadowOpacity: 0.25, shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 }, elevation: 5,
      }}
    >
      <View style={{
        width: 34, height: 34, borderRadius: 12,
        backgroundColor: dark ? 'rgba(255,255,255,0.12)' : Colors.primary,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={icon} size={19} color={dark ? Colors.textOnDark : Colors.brand} stroke={2.2} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {/* 1 seule ligne : sur écran étroit la police se réduit au lieu de
            casser le mot (« MATCHMAKI / NG »). */}
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
          style={{ fontFamily: Fonts.welcome, fontSize: 18.5, lineHeight: 22, color: fg, letterSpacing: 0.3, paddingRight: 5 }}>
          {title}
        </Text>
      </View>
      <Icon name="chevronRight" size={13} color={fg} stroke={2.6} />
    </TouchableOpacity>
  );
}

export function HomePrimaryActions({ onMatchmaking, onChallenge }: {
  onMatchmaking: () => void; onChallenge: () => void;
}) {
  return (
    <View style={{ flex: 1, flexDirection: 'row', gap: 10 }}>
      <PrimaryCta
        variant="brand"
        icon="racket"
        title="MATCHMAKING"
        onPress={onMatchmaking}
      />
      <PrimaryCta
        variant="dark"
        icon="swords"
        title="MATCH DÉFI"
        onPress={onChallenge}
      />
    </View>
  );
}
