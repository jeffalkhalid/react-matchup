// Les deux entrées de l'accueil : « Trouver un match » (jaune, dominante) →
// Explorer, et « Match défi » (noire) → onglet Défi. UI pure — la navigation
// est fournie par l'écran.
//
// Deux TUILES et non deux boutons, d'après la maquette du 2026-09-22 : chacune
// porte un titre, une phrase qui dit ce qu'on y trouve, et une flèche. Les
// boutons précédents n'avaient qu'un libellé en capitales — « MATCH DÉFI » ne
// disait pas qu'on y provoque quelqu'un.
//
// Ce format règle aussi un problème d'affichage tenace. Le libellé tenait sur
// UNE ligne dont la taille devait être calculée à partir de la largeur mesurée
// (`fitLabelFontSize`) : sur Android, avec Barlow Condensed Italic,
// `adjustsFontSizeToFit` s'arrêtait à son plancher puis coupait au mot —
// « TROUVER UN MATCH » s'affichait « TROUVER UN ». Un titre qui a le droit de
// passer à la ligne n'a plus ce problème : il n'y a plus rien à mesurer.
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon, type IconName } from '../community/icons';

function Tuile({ variant, icon, titre, accent, sous, onPress }: {
  variant: 'brand' | 'dark';
  icon: IconName;
  /** Première partie du titre, en couleur de texte normale. */
  titre: string;
  /** Seconde partie, mise en valeur — c'est elle qui nomme l'action. */
  accent: string;
  sous: string;
  onPress: () => void;
}) {
  const jaune = variant === 'brand';
  const fond = jaune ? Colors.brand : '#0A0A0A';
  const texte = jaune ? Colors.primary : Colors.textOnDark;
  const accentCouleur = jaune ? Colors.primary : Colors.brand;
  const secondaire = jaune ? 'rgba(10,10,10,0.62)' : 'rgba(255,255,255,0.6)';
  const pastille = jaune ? 'rgba(10,10,10,0.12)' : 'rgba(255,193,26,0.16)';

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.88}
      accessibilityRole="button"
      accessibilityLabel={`${titre} ${accent}`}
      style={{
        flex: 1, backgroundColor: fond, borderRadius: 20,
        paddingVertical: 14, paddingHorizontal: 14, justifyContent: 'space-between',
        minHeight: 132, overflow: 'hidden',
      }}
    >
      {/* Rond décoratif : il déborde du cadre, d'où `overflow: hidden`. */}
      <View pointerEvents="none" style={{
        position: 'absolute', right: -34, top: -34, width: 116, height: 116, borderRadius: 999,
        backgroundColor: jaune ? 'rgba(255,255,255,0.18)' : 'rgba(255,193,26,0.07)',
      }} />

      <View style={{
        width: 38, height: 38, borderRadius: 12, backgroundColor: pastille,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={icon} size={20} color={jaune ? Colors.primary : Colors.brand} stroke={2.2} />
      </View>

      <View style={{ gap: 3 }}>
        {/* Le titre a le DROIT de passer à la ligne : c'est ce qui évite la
            coupure au mot vue sur Android. */}
        <Text style={{ fontFamily: Fonts.welcome, fontSize: 21, lineHeight: 24, color: texte, paddingRight: 4 }}>
          {titre}
          <Text style={{ color: accentCouleur }}>{` ${accent}`}</Text>
        </Text>
        <Text numberOfLines={2} style={{ fontFamily: Fonts.uiSemi, fontSize: 11.5, lineHeight: 15, color: secondaire, paddingRight: 24 }}>
          {sous}
        </Text>
      </View>

      <View pointerEvents="none" style={{
        position: 'absolute', right: 12, bottom: 12,
        width: 28, height: 28, borderRadius: 999,
        borderWidth: 1.5, borderColor: jaune ? 'rgba(10,10,10,0.25)' : 'rgba(255,255,255,0.35)',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="chevronRight" size={13} color={jaune ? Colors.primary : Colors.textOnDark} stroke={2.6} />
      </View>
    </TouchableOpacity>
  );
}

export function HomePrimaryActions({ onMatchmaking, onChallenge }: {
  onMatchmaking: () => void;
  onChallenge: () => void;
  /** Conservé pour l'appelant — la taille du texte ne se calcule plus. */
  textScale?: number;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <Tuile
        variant="brand"
        icon="racket"
        titre="Trouver"
        accent="un match"
        sous="Des joueurs à ton niveau, près de chez toi"
        onPress={onMatchmaking}
      />
      <Tuile
        variant="dark"
        icon="swords"
        titre="Match"
        accent="défi"
        sous="Provoque un joueur, mise ton niveau"
        onPress={onChallenge}
      />
    </View>
  );
}

export default HomePrimaryActions;
