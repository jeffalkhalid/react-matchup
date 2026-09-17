// Les deux CTA principaux de l'accueil : « Trouver un match » (jaune, dominant)
// → Explorer, et « Match défi » (noir) → onglet Défi. UI pure — la navigation
// est fournie par l'écran.
//
// LA TAILLE DU TEXTE DÉRIVE DE LA LARGEUR DU BOUTON, MESURÉE. Elle grossit
// quand l'accueil se dégarnit (`textScale`, calculé dans lib/homeLayout), et
// on comptait sur `adjustsFontSizeToFit` pour la faire redescendre si le
// libellé ne tenait plus. Sur Android, avec Barlow Condensed Italic, ce
// mécanisme n'est pas fiable : il s'arrête à son plancher puis coupe au mot.
// Vu sur un téléphone : « TROUVER UN MATCH » affiché « TROUVER UN ».
//
// Désormais : on mesure la largeur disponible dans chaque bouton et la largeur
// naturelle des deux libellés à une taille de référence, puis on calcule la
// plus grande taille qui les fait tenir TOUS LES DEUX (fitLabelFontSize). Les
// deux boutons partagent la même taille — deux tailles différentes côte à côte
// se liraient comme un défaut.
//
// Le texte reste INVISIBLE tant que la mesure n'est pas faite : sans ça, il
// apparaît une frame à la taille maximale, donc tronqué, avant de se corriger.
import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon, type IconName } from '../community/icons';
import { fitLabelFontSize } from '../../lib/homeLayout';

const LIBELLES = { match: 'TROUVER UN MATCH', defi: 'MATCH DÉFI' } as const;
type Cle = keyof typeof LIBELLES;

/** Taille à laquelle on mesure la largeur naturelle des libellés. */
const REF = 20;
const LETTER_SPACING = 0.2;

function PrimaryCta({ variant, icon, title, textScale, fontSize, pad, visible, onTextWidth, onPress }: {
  variant: 'brand' | 'dark';
  icon: IconName; title: string;
  textScale: number;
  fontSize: number;
  /** Marge horizontale du texte : l'italique déborde de sa boîte. */
  pad: number;
  visible: boolean;
  /** Largeur disponible pour le texte dans CE bouton. */
  onTextWidth: (w: number) => void;
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
        paddingVertical: 10, paddingHorizontal: 9,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        shadowColor: dark ? '#000' : Colors.brandDeep,
        shadowOpacity: 0.25, shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 }, elevation: 5,
      }}
    >
      <View style={{
        width: 25 * textScale, height: 25 * textScale, borderRadius: 9,
        backgroundColor: dark ? 'rgba(255,255,255,0.12)' : Colors.primary,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={icon} size={14 * textScale} color={dark ? Colors.textOnDark : Colors.brand} stroke={2.2} />
      </View>
      {/* Conteneur flex:1 = largeur BORNÉE, et c'est elle qu'on mesure. */}
      <View
        style={{ flex: 1, minWidth: 0 }}
        onLayout={(e: LayoutChangeEvent) => onTextWidth(e.nativeEvent.layout.width)}
      >
        <Text
          numberOfLines={1}
          style={{
            textAlign: 'center', fontFamily: Fonts.welcome,
            fontSize, lineHeight: Math.round(fontSize * 1.3),
            color: fg, letterSpacing: LETTER_SPACING,
            // La marge grandit avec la taille (~⅓ du fontSize) : à grande
            // taille, quelques points ne suffisent plus à loger le débord de
            // l'italique (cf. mémoire « titres rognés Android »).
            paddingHorizontal: pad,
            opacity: visible ? 1 : 0,
          }}
        >
          {title}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export function HomePrimaryActions({ onMatchmaking, onChallenge, textScale = 1 }: {
  onMatchmaking: () => void; onChallenge: () => void;
  /** Fourni par le budget de l'accueil (lib/homeLayout). 1 = taille d'origine. */
  textScale?: number;
}) {
  // Plafond : l'échelle par largeur d'écran d'avant (pleine taille dès 392 dp),
  // agrandie quand l'accueil a de la place. Ce n'est plus qu'un MAXIMUM.
  const { width: winW } = useWindowDimensions();
  const s = Math.min(1, Math.max(0.85, winW / 392));
  const max = 14 * s * textScale;
  const pad = Math.max(2, Math.round(max / 3));

  const [dispo, setDispo] = useState<Partial<Record<Cle, number>>>({});
  const [naturelles, setNaturelles] = useState<Partial<Record<Cle, number>>>({});

  // Ne met l'état à jour que si la valeur CHANGE : un onLayout rappelé avec la
  // même largeur ne doit pas relancer un rendu.
  const noter = useCallback(
    (set: typeof setDispo, cle: Cle) => (w: number) =>
      set(prev => (prev[cle] === w ? prev : { ...prev, [cle]: w })),
    [],
  );

  const largeurs = [dispo.match, dispo.defi];
  const tailles = [naturelles.match, naturelles.defi];
  const pret = largeurs.every(w => typeof w === 'number' && w > 0)
    && tailles.every(w => typeof w === 'number' && w > 0);

  const fontSize = pret
    ? fitLabelFontSize({
        max,
        ref: REF,
        // Les deux boutons ont la même largeur ; on prend la plus petite par
        // prudence, moins la marge anti-débord des deux côtés.
        width: Math.min(largeurs[0]!, largeurs[1]!) - 2 * pad,
        naturalWidths: tailles as number[],
      })
    : max;

  return (
    <View style={{ flex: 1, flexDirection: 'row', gap: 10 }}>
      {/* MESURE, invisible et hors flux : les libellés à la taille de
          référence, sans contrainte de largeur (conteneur très large +
          alignSelf flex-start = la boîte épouse le texte). */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, top: 0, width: 2000, opacity: 0 }}
      >
        {(Object.keys(LIBELLES) as Cle[]).map(cle => (
          <Text
            key={cle}
            onLayout={e => noter(setNaturelles, cle)(e.nativeEvent.layout.width)}
            style={{
              alignSelf: 'flex-start', fontFamily: Fonts.welcome,
              fontSize: REF, letterSpacing: LETTER_SPACING,
            }}
          >
            {LIBELLES[cle]}
          </Text>
        ))}
      </View>

      <PrimaryCta
        variant="brand"
        icon="racket"
        title={LIBELLES.match}
        textScale={textScale}
        fontSize={fontSize}
        pad={pad}
        visible={pret}
        onTextWidth={noter(setDispo, 'match')}
        onPress={onMatchmaking}
      />
      <PrimaryCta
        variant="dark"
        icon="swords"
        title={LIBELLES.defi}
        textScale={textScale}
        fontSize={fontSize}
        pad={pad}
        visible={pret}
        onTextWidth={noter(setDispo, 'defi')}
        onPress={onChallenge}
      />
    </View>
  );
}
