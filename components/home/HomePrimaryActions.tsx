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
import { GEO } from '../../lib/homeLayout';
import { texteUI } from '../../lib/uiText';

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
  // Tailles FIXES, et lues au meme endroit que le budget de hauteur
  // (lib/homeLayout GEO) : le minimum reclame par la tuile est l'addition de
  // ces nombres-la. Les faire varier ici sans les changer la-bas, c'etait
  // rendre le calcul faux — et c'est ce qui arrivait avec le mode « compact ».
  const G = GEO.cta;
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
        // `flex: 1` sur la tuile ET sur la rangee : la hauteur reservee par
        // l'accueil leur revient au lieu de rester en blanc sous les cartes.
        flex: 1, backgroundColor: fond, borderRadius: 20,
        // Pas de `minHeight` : la hauteur vient de l'accueil, qui l'a
        // calculee sur la largeur reelle (`ctaHeightFor`). Un plancher ici
        // permettrait a la tuile de REFUSER sa part, et la somme deborderait.
        paddingVertical: G.padV, paddingHorizontal: 12, justifyContent: 'space-between',
        overflow: 'hidden',
      }}
    >
      {/* Fond travaillé : de GRANDS anneaux concentriques qui traversent la
          tuile, pas un aplat dans le coin. Un rond plein se lit comme une
          tache ; des arcs qui balaient la carte lui donnent du relief.
          Ils débordent largement du cadre, d'où `overflow: hidden`.

          Ils étaient trop timides au premier jet : petits, fins, et si peu
          contrastés qu'on les devinait à peine. Un effet qu'on ne voit pas ne
          sert à rien — autant l'enlever que le laisser à moitié. */}
      {[248, 196, 144, 96].map((d, i) => (
        <View key={d} pointerEvents="none" style={{
          position: 'absolute', right: -d * 0.32, top: -d * 0.42,
          width: d, height: d, borderRadius: 999,
          borderWidth: i === 0 ? 2.5 : 2,
          borderColor: jaune
            ? `rgba(255,255,255,${0.42 - i * 0.07})`
            : `rgba(255,193,26,${0.22 - i * 0.04})`,
        }} />
      ))}
      {/* Une lueur diffuse en bas à gauche : elle décolle la tuile du fond
          gris sans créer de second aplat. */}
      <View pointerEvents="none" style={{
        position: 'absolute', left: -58, bottom: -58, width: 150, height: 150, borderRadius: 999,
        backgroundColor: jaune ? 'rgba(255,255,255,0.20)' : 'rgba(255,193,26,0.06)',
      }} />

      <View style={{
        width: G.pastille, height: G.pastille, borderRadius: 12, backgroundColor: pastille,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={icon} size={17} color={jaune ? Colors.primary : Colors.brand} stroke={2.2} />
      </View>

      <View style={{ gap: 3 }}>
        {/* Le titre a le DROIT de passer à la ligne : c'est ce qui évite la
            coupure au mot vue sur Android. */}
        <Text {...texteUI} numberOfLines={GEO.cta.titreLignes} style={{ fontFamily: Fonts.welcome, fontSize: G.titreLigne - 3, lineHeight: G.titreLigne, color: texte, paddingRight: 4 }}>
          {titre}
          <Text style={{ color: accentCouleur }}>{` ${accent}`}</Text>
        </Text>
        <Text {...texteUI} numberOfLines={GEO.cta.phraseLignes} style={{ fontFamily: Fonts.uiSemi, fontSize: 11.5, lineHeight: G.phraseLigne, color: secondaire, paddingRight: 24 }}>
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
}) {
  return (
    <View style={{ flex: 1, flexDirection: 'row', gap: 10 }}>
      <Tuile
        variant="brand"
        icon="search"
        titre="Trouver"
        accent="un match"
        sous="À ton niveau, près de chez toi"
        onPress={onMatchmaking}
      />
      <Tuile
        variant="dark"
        icon="swords"
        titre="Match"
        accent="défi"
        sous="Défie un joueur, mise ton niveau"
        onPress={onChallenge}
      />
    </View>
  );
}

export default HomePrimaryActions;
