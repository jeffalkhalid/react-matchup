// components/DisplayTitle.tsx — LE titre en police italique condensée
// (`Fonts.welcome`, Barlow Condensed Black Italic).
//
// Cette police se fait couper sur Android de six façons différentes, trouvées
// une par une sur des téléphones de testeurs (cf. la mémoire
// « feedback_android_title_clipping »). Plutôt que de demander à chaque écran
// de s'en souvenir, ce composant applique d'office les règles qui tiennent :
//
//   - MAJUSCULES écrites dans le texte (`uppercase`), jamais `textTransform` :
//     Android mesure le texte AVANT de le passer en majuscules, plus larges,
//     et coupe les dernières lettres ;
//   - MARGE À DROITE proportionnelle à la taille : l'italique déborde de sa
//     boîte et le dernier glyphe se fait rogner ;
//   - DEUX LIGNES plutôt qu'un titre coupé au mot (mode 'wrap', par défaut) :
//     sur Android, `adjustsFontSizeToFit` ne rétrécit pas toujours cette
//     police, il coupe au mot (« LES » pour « LES JOUEURS ») ;
//   - UNE LIGNE seulement là où la hauteur est comptée (mode 'single', ex.
//     l'accueil qui ne défile pas) : rétrécit sur iPhone, « … » sur Android.
//
// Le test lib/__tests__/androidTitles.test.ts refuse les réglages qui cassent
// sur les titres écrits à la main avec cette police.
import { Children, cloneElement, isValidElement, useState, type ReactNode } from 'react';
import { Text, View, Platform, type StyleProp, type TextStyle, type ViewStyle, type TextProps } from 'react-native';
import { Fonts } from '../lib/theme';
import { fitLabelFontSize } from '../lib/homeLayout';

/** Majuscules dans le texte lui-même, texte imbriqué compris. Un contenu fait
 *  uniquement de texte ressort en UN segment : plusieurs segments natifs
 *  peuvent disparaître au re-rendu sur Android. */
export function upperText(node: ReactNode): ReactNode {
  const parts = Children.toArray(node);
  if (parts.every(p => typeof p === 'string' || typeof p === 'number')) {
    return parts.join('').toUpperCase();
  }
  return Children.map(node, c => {
    if (typeof c === 'string') return c.toUpperCase();
    if (isValidElement<{ children?: ReactNode }>(c) && c.props.children != null) {
      return cloneElement(c, undefined, upperText(c.props.children));
    }
    return c;
  });
}

export function DisplayTitle({
  children, size, uppercase, mode = 'wrap', lines = 2, color, style, ...rest
}: Omit<TextProps, 'numberOfLines' | 'adjustsFontSizeToFit' | 'minimumFontScale' | 'style' | 'children'> & {
  children: ReactNode;
  /** Taille de police (la hauteur de ligne et la marge en découlent). */
  size: number;
  uppercase?: boolean;
  /** 'wrap' (défaut) : jusqu'à `lines` lignes, jamais un mot coupé.
   *  'single' : une seule ligne — rétrécit sur iPhone, « … » sur Android. */
  mode?: 'wrap' | 'single';
  lines?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text
      {...rest}
      numberOfLines={mode === 'single' ? 1 : lines}
      adjustsFontSizeToFit={mode === 'single' && Platform.OS === 'ios'}
      minimumFontScale={0.6}
      style={[
        {
          fontFamily: Fonts.welcome,
          fontSize: size,
          lineHeight: Math.round(size * 1.25),
          paddingRight: Math.ceil(size / 3),
          color,
        },
        style,
      ]}
    >
      {uppercase ? upperText(children) : children}
    </Text>
  );
}

// ─── Titre qui TIENT SUR UNE LIGNE, quoi qu'il arrive ────────────────────────
// Android ne sait pas rétrécir cette police tout seul : `adjustsFontSizeToFit`
// coupe au mot, et un texte comprimé par flexShrink est rogné au lieu de passer
// à la ligne (vu sur device : « LES » pour « LES JOUEURS »,
// « INFORMATIONS DE LA » pour « INFORMATIONS DE LA PARTIE »).
//
// On mesure donc nous-mêmes, comme les boutons de l'accueil : largeur
// disponible (onLayout) + largeur naturelle du texte (rendu hors flux dans une
// boîte de 2000 dp, sans contrainte) → taille de police calculée
// (lib/homeLayout.fitLabelFontSize, testé). Le texte est masqué tant que la
// mesure n'est pas faite, sinon il apparaît une image trop grand.
export function FitTitle({ children, max, color, uppercase, min = 12, style }: {
  children: string;
  /** Taille voulue — jamais dépassée. */
  max: number;
  color?: string;
  uppercase?: boolean;
  min?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [boxWidth, setBoxWidth] = useState(0);
  const [naturalWidth, setNaturalWidth] = useState(0);
  const text = uppercase ? children.toUpperCase() : children;

  const size = boxWidth > 0 && naturalWidth > 0
    ? fitLabelFontSize({ max, width: boxWidth, naturalWidths: [naturalWidth], ref: max, min, safety: 0.98 })
    : max;
  const mesure = boxWidth > 0 && naturalWidth > 0;

  return (
    <View
      style={[{ flex: 1, minWidth: 0 }, style]}
      // La largeur est lue TOUT DE SUITE, jamais dans la fonction passée à
      // setState : celle-ci s'exécute plus tard, quand l'événement a déjà été
      // vidé (nativeEvent = null). Sur iPhone, ça levait « Cannot read property
      // 'layout' of null » et faisait disparaître la fiche d'une partie
      // (constaté le 2026-09-17).
      onLayout={e => { const lw = e.nativeEvent.layout.width; setBoxWidth(w => (w === lw ? w : lw)); }}
    >
      {/* Mesure hors flux, sans contrainte de largeur. */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: 2000, opacity: 0 }}>
        {/* testID « fit-measure » : ce texte-là ne s'affiche jamais, il SERT à
            mesurer. Surtout pas de marge ici, elle fausserait la mesure — le
            garde-fou lib/__tests__/androidTitles.test.ts l'exempte à ce titre. */}
        <Text
          testID="fit-measure"
          numberOfLines={1}
          onLayout={e => { const lw = e.nativeEvent.layout.width; setNaturalWidth(w => (w === lw ? w : lw)); }}
          style={{ fontFamily: Fonts.welcome, fontSize: max }}
        >
          {text}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        style={{
          fontFamily: Fonts.welcome,
          fontSize: size,
          lineHeight: Math.round(size * 1.25),
          color,
          paddingRight: Math.ceil(size / 3),
          opacity: mesure ? 1 : 0,
        }}
      >
        {text}
      </Text>
    </View>
  );
}
