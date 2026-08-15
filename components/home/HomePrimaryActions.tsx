// Les deux CTA principaux de l'accueil : « Trouver un match » (jaune, dominant)
// → Explorer, et « Match défi » (noir) → onglet Défi. UI pure — la navigation
// est fournie par l'écran.
// Même taille de police FIXE sur les deux boutons (pas d'auto-rétrécissement
// asymétrique) : le chrome est compacté pour que le libellé long tienne sur
// une ligne même sur 360 dp.
import React from 'react';
import { View, Text, TouchableOpacity, useWindowDimensions } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon, type IconName } from '../community/icons';

function PrimaryCta({ variant, icon, title, onPress }: {
  variant: 'brand' | 'dark';
  icon: IconName; title: string;
  onPress: () => void;
}) {
  const dark = variant === 'dark';
  const fg = dark ? Colors.textOnDark : Colors.primary;
  // Échelle par largeur d'écran (comme les pastilles des cartes) : pleine
  // taille dès 392 dp (iPhone), réduite sur les écrans étroits (Android 360).
  const { width: winW } = useWindowDimensions();
  const s = Math.min(1, Math.max(0.85, winW / 392));
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.88}
      style={{
        flex: 1,
        backgroundColor: dark ? Colors.heroBg : Colors.brand,
        borderRadius: 20,
        paddingVertical: 10, paddingHorizontal: 9,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        shadowColor: dark ? '#000' : Colors.brandDeep,
        shadowOpacity: 0.25, shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 }, elevation: 5,
      }}
    >
      <View style={{
        width: 25, height: 25, borderRadius: 9,
        backgroundColor: dark ? 'rgba(255,255,255,0.12)' : Colors.primary,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={icon} size={14} color={dark ? Colors.textOnDark : Colors.brand} stroke={2.2} />
      </View>
      {/* Texte CENTRÉ dans l'espace restant. Conteneur flex:1 = largeur bornée :
          indispensable sur Android pour que adjustsFontSizeToFit réduise la
          police au lieu de tronquer au premier mot (« MATCH » au lieu de
          « MATCH DÉFI »). */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
          style={{ textAlign: 'center', fontFamily: Fonts.welcome, fontSize: 14 * s, lineHeight: 18 * s, color: fg, letterSpacing: 0.2, paddingHorizontal: 2 }}>
          {title}
        </Text>
      </View>
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
        title="TROUVER UN MATCH"
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
