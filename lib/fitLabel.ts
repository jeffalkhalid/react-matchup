// lib/fitLabel.ts — faire tenir un libellé sur UNE ligne, dans une largeur
// mesurée.
//
// Vivait dans lib/homeLayout, qui n'a plus rien à voir : ce budget-là
// distribue de la HAUTEUR entre des blocs, celui-ci choisit une taille de
// police pour une LARGEUR. Deux sujets qui n'avaient en commun que d'avoir
// été écrits le même jour.
//
// À ne pas confondre avec `adjustsFontSizeToFit`, qui ne tient pas ses
// promesses sur Android avec Barlow Condensed Italic : il s'arrête à son
// plancher puis coupe au mot. Ici c'est la largeur RÉELLE du texte qui décide,
// mesurée une fois à une taille de référence.

/**
 * La plus grande taille de police qui fait tenir TOUS les libellés sur une
 * ligne dans la largeur donnée, plafonnée à `max`.
 *
 * POURQUOI ON CALCULE AU LIEU DE LAISSER FAIRE `adjustsFontSizeToFit`. Le
 * texte des deux boutons de l'accueil grossit quand l'écran se dégarnit
 * (`textScale`). On comptait sur la réduction automatique pour le faire
 * redescendre s'il ne tenait pas. Sur Android, avec la police Barlow
 * Condensed Italic, elle n'est pas fiable : elle s'arrête à son plancher puis
 * coupe au mot — vu sur un téléphone, « TROUVER UN MATCH » devenait « TROUVER
 * UN ». Elle a déjà été prise en défaut ailleurs (no-op sur texte imbriqué,
 * texte invisible au premier rendu).
 *
 * Ici la taille dérive de la largeur RÉELLE, mesurée : on connaît la largeur
 * naturelle de chaque libellé à une taille de référence, et la largeur est
 * proportionnelle à la taille. Le plus long libellé impose la taille, et les
 * deux boutons la partagent — deux tailles différentes côte à côte se liraient
 * comme un défaut.
 *
 * `safety` couvre le débord de l'italique et les arrondis de mesure. Tant que
 * rien n'est mesuré, on rend `max` : l'appelant doit masquer le texte pendant
 * ce premier rendu, sinon il apparaît une frame tronqué.
 */
export function fitLabelFontSize(i: {
  /** Taille voulue — jamais dépassée. */
  max: number;
  /** Largeur disponible pour les glyphes, en dp. 0 ou moins = pas mesurée. */
  width: number;
  /** Largeur naturelle de chaque libellé, mesurée à la taille `ref`. */
  naturalWidths: number[];
  /** La taille à laquelle `naturalWidths` ont été mesurées. */
  ref: number;
  /** Plancher de lisibilité. */
  min?: number;
  /** Fraction de la largeur réellement utilisée. */
  safety?: number;
}): number {
  const min = i.min ?? 9;
  const safety = i.safety ?? 0.92;
  const mesures = i.naturalWidths.filter(n => n > 0);
  if (i.width <= 0 || i.ref <= 0 || mesures.length === 0 || mesures.length !== i.naturalWidths.length) {
    return i.max;
  }
  const plusLong = Math.max(...mesures);
  const tient = (i.ref * i.width * safety) / plusLong;
  return Math.max(min, Math.min(i.max, tient));
}
