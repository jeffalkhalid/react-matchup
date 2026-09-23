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
import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon, type IconName } from '../community/icons';

/**
 * La phrase du bas, qui n'affiche que les lignes qui TIENNENT.
 *
 * Elle etait figee a deux lignes. Sur un Android a grande police, la tuile
 * n'avait pas la hauteur pour les deux : la seconde etait coupee en son
 * milieu, moitie visible sous le bord de la carte. Une demi-ligne de texte
 * est pire que pas de ligne du tout.
 *
 * La zone ne DEVINE pas sa place, elle la mesure — sa hauteur lui vient du
 * dessus, jamais de son contenu, donc la mesure est stable. On en deduit
 * combien de lignes entrent, et le texte s'arrete proprement.
 */
function Phrase({ children, couleur }: { children: string; couleur: string }) {
  const LIGNE = 15;
  const [h, setH] = useState(0);
  const lignes = h > 0 ? Math.max(1, Math.floor(h / LIGNE)) : 2;
  return (
    <View
      onLayout={e => { const v = e.nativeEvent.layout.height; setH(p => (Math.abs(p - v) > 0.5 ? v : p)); }}
      style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
    >
      <Text numberOfLines={lignes} style={{ fontFamily: Fonts.uiSemi, fontSize: 11.5, lineHeight: LIGNE, color: couleur, paddingRight: 24 }}>
        {children}
      </Text>
    </View>
  );
}

function Tuile({ variant, icon, titre, accent, sous, onPress, compact }: {
  variant: 'brand' | 'dark';
  icon: IconName;
  /**
   * Ecran ou police serres.
   *
   * Au plancher du bloc (112 points), la tuile doit loger 129 points de
   * contenu : rembourrage 28 + pastille 38 + titre sur deux lignes 48 +
   * phrase 15. Il en manque 17, et c'est le texte qui les prenait — d'ou la
   * ligne tranchee en son milieu. On les rend ici plutot que de rogner.
   *
   * Seulement en compact : sur un ecran qui a la place, les grands titres de
   * la maquette restent tels quels.
   */
  compact?: boolean;
  /** Première partie du titre, en couleur de texte normale. */
  titre: string;
  /** Seconde partie, mise en valeur — c'est elle qui nomme l'action. */
  accent: string;
  sous: string;
  onPress: () => void;
}) {
  const jaune = variant === 'brand';
  const c = !!compact;
  const pastilleTaille = c ? 32 : 38;
  const titreTaille = c ? 18 : 21;
  const titreLigne = c ? 21 : 24;
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
        paddingVertical: c ? 11 : 14, paddingHorizontal: c ? 12 : 14, justifyContent: 'space-between',
        minHeight: c ? 108 : 132, overflow: 'hidden',
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
        width: pastilleTaille, height: pastilleTaille, borderRadius: 12, backgroundColor: pastille,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={icon} size={c ? 17 : 20} color={jaune ? Colors.primary : Colors.brand} stroke={2.2} />
      </View>

      {/* `flexShrink: 1` : c'est ce bloc qui cede quand la tuile est courte,
          pas la pastille du haut ni la fleche. */}
      <View style={{ gap: 3, flexShrink: 1, minHeight: 0 }}>
        {/* Le titre a le DROIT de passer à la ligne : c'est ce qui évite la
            coupure au mot vue sur Android. */}
        <Text numberOfLines={2} style={{ fontFamily: Fonts.welcome, fontSize: titreTaille, lineHeight: titreLigne, color: texte, paddingRight: 4 }}>
          {titre}
          <Text style={{ color: accentCouleur }}>{` ${accent}`}</Text>
        </Text>
        <Phrase couleur={secondaire}>{sous}</Phrase>
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

export function HomePrimaryActions({ onMatchmaking, onChallenge, compact }: {
  onMatchmaking: () => void;
  onChallenge: () => void;
  /** Écran ou police serrés : titres et pastilles resserrés. */
  compact?: boolean;
  /** Conservé pour l'appelant — la taille du texte ne se calcule plus. */
  textScale?: number;
}) {
  return (
    <View style={{ flex: 1, flexDirection: 'row', gap: 10 }}>
      <Tuile
        compact={compact}
        variant="brand"
        icon="search"
        titre="Trouver"
        accent="un match"
        sous="Des matchs à ton niveau, près de chez toi"
        onPress={onMatchmaking}
      />
      <Tuile
        compact={compact}
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
