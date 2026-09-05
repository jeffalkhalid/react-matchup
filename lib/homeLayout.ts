// lib/homeLayout.ts — le budget de hauteur de l'écran d'accueil.
//
// L'accueil ne défile pas : chaque section reçoit une PART de la hauteur
// (`flex`) et un plancher (`minHeight`) sous lequel elle ne s'écrase pas. Tant
// que la somme des planchers tient dans l'écran, tout se voit d'un coup d'œil.
// Dès qu'elle la dépasse, le `ScrollView` de secours prend le relais — et
// l'accueil se met à défiler, ce qu'il n'est pas censé faire.
//
// POURQUOI CE FICHIER EXISTE : ce budget a débordé DEUX FOIS, et les deux fois
// le symptôme n'a pas ressemblé à un problème de hauteur.
//
//   1. À l'arrivée de la section Tournois : elle prenait ~140 dp qu'on avait
//      omis de retirer du budget. Le symptôme rapporté était « il y a du
//      scroll en bas ».
//   2. Quand « Prochain match » est VIDE : la carte réclamait 2,2 parts sur
//      8,3 — autant qu'avec quatre joueurs, une date et un bouton — pour
//      afficher deux lignes de texte. Le symptôme rapporté était « le haut de
//      la carte de profil est coupé » : le débordement pousse la colonne, on
//      fait défiler d'un centimètre, et le héros passe sous l'en-tête.
//
// Dans les deux cas, on regardait le haut de l'écran alors que la cause était
// en bas. D'où un budget calculé À UN SEUL ENDROIT, avec un test qui vérifie
// qu'il tient — plutôt qu'une somme de nombres dispersés dans le JSX que
// personne ne refait de tête.

export interface HomeLayoutInput {
  /** Écran ou police serrés : proportions réduites. */
  compact: boolean;
  /** La section Tournois est-elle rendue ? */
  hasTournaments: boolean;
  /** Y a-t-il un match à venir ? Sinon la carte n'a que deux lignes à dire. */
  hasNextMatch: boolean;
}

export interface SectionSize {
  flex: number;
  minHeight: number;
}

export interface HomeSizes {
  hero: SectionSize;
  ctas: SectionSize;
  /** `null` quand aucun tournoi ouvert : la section n'est pas rendue. */
  tournaments: SectionSize | null;
  nextMatch: SectionSize;
  chips: SectionSize;
  /** L'espace entre deux sections. */
  gap: number;
}

/**
 * La hauteur de colonne d'un téléphone Android courant, en dp.
 *
 * Calculée sur un écran de 690 dp de haut : moins la barre d'état (24), le
 * bloc du logo (39), les marges de la colonne (22) et la barre d'onglets (88).
 * LE CAS LE PLUS CHARGÉ — un match programmé ET des tournois ouverts — doit
 * tenir : le handoff le désigne comme la limite haute de l'écran. Les
 * planchers du mode compact sont calibrés pour ça.
 *
 * Abaisser un plancher ne rétrécit RIEN sur un écran qui a la place : les
 * sections reçoivent leur part (`flex`) et le plancher ne sert que quand
 * l'espace manque. C'est donc uniquement sur les petits écrans que le hero se
 * tasse — c'est-à-dire exactement là où il le doit.
 */
export const ANDROID_COLUMN_H = 517;

export function homeSectionSizes(i: HomeLayoutInput): HomeSizes {
  const c = i.compact;
  return {
    hero:  { flex: 3,   minHeight: c ? 146 : 214 },
    ctas:  { flex: 0.8, minHeight: c ? 50  : 62 },
    tournaments: i.hasTournaments ? { flex: 1.5, minHeight: c ? 92 : 136 } : null,
    // LE CŒUR DU CORRECTIF : une carte vide ne réclame pas la place d'une
    // carte pleine. Deux lignes de texte n'ont pas besoin de quatre créneaux
    // de joueurs, et la place rendue est exactement celle qui manquait.
    nextMatch: i.hasNextMatch
      ? { flex: 2.2, minHeight: c ? 150 : 180 }
      : { flex: 1.1, minHeight: c ? 92  : 104 },
    chips: { flex: 0.8, minHeight: c ? 46 : 56 },
    gap: c ? 6 : 12,
  };
}

/** La hauteur minimale que la colonne réclame, planchers et espaces compris. */
export function totalMinHeight(s: HomeSizes): number {
  const sections = [s.hero, s.ctas, s.tournaments, s.nextMatch, s.chips]
    .filter((x): x is SectionSize => x !== null);
  const planchers = sections.reduce((n, x) => n + x.minHeight, 0);
  return planchers + s.gap * Math.max(0, sections.length - 1);
}

/** L'accueil tient-il sans défiler dans une colonne de cette hauteur ? */
export function fitsWithoutScroll(s: HomeSizes, columnHeight: number): boolean {
  return totalMinHeight(s) <= columnHeight;
}
