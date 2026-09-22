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
  /**
   * La carte de profil est-elle rendue ?
   *
   * Retirée de l'accueil le 2026-09-22 (décision produit) : sa part revient
   * aux cartes du dessous. Gardée en OPTION plutôt que supprimée — tout le
   * budget est calibré autour d'elle, et la remettre doit rester une ligne.
   */
  hasHero?: boolean;
  /** La section Tournois est-elle rendue ? */
  hasTournaments: boolean;
  /** Y a-t-il un match à venir ? Sinon la carte n'est pas rendue. */
  hasNextMatch: boolean;
  /**
   * Combien de parties ouvertes on propose — voir `lib/homeSlot`.
   *
   * Consulté SEULEMENT quand il n'y a ni match ni tournoi : c'est le seul cas
   * où l'emplacement revient aux suggestions. `0` = la carte « crée le tien »,
   * qui a deux lignes à dire et ne réclame pas la place de deux vignettes.
   */
  openGames?: number;
  /**
   * Une soiree de tournoi se joue MAINTENANT et j'y ai une place.
   *
   * La banniere passe avant tout le reste : pendant une rotation de vingt
   * minutes, la seule chose qui compte est d'atteindre son terrain. Elle ne
   * s'affiche que le temps de la soiree -- quelques heures, deux ou trois fois
   * par mois -- donc elle ne pese pas sur l'accueil ordinaire.
   */
  hasLiveTournament?: boolean;
}

export interface SectionSize {
  flex: number;
  minHeight: number;
}

export interface CtaSize extends SectionSize {
  /**
   * De combien grossit le texte des deux boutons.
   *
   * Ils gardent la même taille depuis toujours, quel que soit le contenu du
   * reste de l'écran. Or l'accueil ne porte pas toujours autant de choses :
   * avec UNE seule section de cartes en dessous, la place existe, et deux
   * boutons minuscules au milieu d'un écran aéré donnent l'impression d'une
   * page inachevée.
   *
   * `adjustsFontSizeToFit` reste actif sur les libellés : si l'agrandissement
   * ne passe pas sur un écran étroit, le texte redescend tout seul au lieu de
   * se tronquer. C'est un plafond qu'on lève, pas une taille qu'on impose.
   */
  textScale: number;
}

export interface HomeSizes {
  /** La banniere « tournoi en cours » -- `null` hors soiree. */
  liveBanner: SectionSize | null;
  /** `null` quand la carte de profil n'est pas rendue (cf. `hasHero`). */
  hero: SectionSize | null;
  ctas: CtaSize;
  /** `null` quand aucun tournoi ouvert : la section n'est pas rendue. */
  tournaments: SectionSize | null;
  /** `null` quand aucun match programmé : la carte n'est pas rendue. */
  nextMatch: SectionSize | null;
  /**
   * « Ça se joue cette semaine » — les parties ouvertes proposées, ou la carte
   * « crée le tien ». Rendu SEULEMENT quand il n'y a ni match ni tournoi.
   */
  openGames: SectionSize | null;
  /**
   * Le vide qui prend la place de « Prochain match » quand il n'y a rien à
   * annoncer ET que les tournois occupent déjà l'écran.
   *
   * Sans lui, retirer la carte ne libère pas de la place : ça REDISTRIBUE sa
   * part aux sections restantes, qui grossissent d'autant. Sur un grand écran
   * la carte de profil réclamerait près de 80 % de la colonne, et les deux
   * boutons deviendraient des pavés. Le vide absorbe la part rendue, donc
   * l'écran se calme au lieu de se déformer.
   */
  filler: SectionSize | null;
  /** L'espace entre deux sections. */
  gap: number;
}

/**
 * La place que la section Tournois occupe quand elle est rendue, en dp.
 *
 * L'écran s'en sert pour la RETIRER de la hauteur disponible avant de décider
 * du mode compact — sinon on garde les proportions pleines, la colonne
 * déborde, et l'accueil se met à défiler. C'est le piège nº 1 ci-dessus ; la
 * valeur vit ici pour qu'on ne puisse plus la régler d'un côté seulement.
 */
export const TOURNAMENTS_RESERVE = 140;

/**
 * En dessous de cette hauteur disponible (tournois déduits, et pondérée par
 * la taille de police système), l'accueil passe en proportions resserrées.
 */
export const COMPACT_THRESHOLD_H = 575;

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

/**
 * La colonne d'un écran qui vient JUSTE d'échapper au mode compact, en dp.
 *
 * Le seuil porte sur la hauteur disponible tournois déduits ; la colonne
 * réelle les reprend. C'est le pire cas des proportions pleines — un écran
 * plus grand a de la marge par construction — et rien ne le vérifiait : les
 * planchers pleins n'étaient comparés à AUCUNE hauteur.
 */
export const NON_COMPACT_COLUMN_H = COMPACT_THRESHOLD_H + TOURNAMENTS_RESERVE;

export function homeSectionSizes(i: HomeLayoutInput): HomeSizes {
  const c = i.compact;
  // L'emplacement du milieu revient aux suggestions dans UN seul cas : rien de
  // programmé et rien d'ouvert. C'est la même règle que `homeSlot`, et elle
  // doit le rester — deux lectures divergentes donneraient une section rendue
  // sans place réservée, ou l'inverse. Un test compare les deux.
  const suggere = !i.hasNextMatch && !i.hasTournaments;
  const nb = i.openGames ?? 0;
  // Combien de CARTES l'écran porte sous les boutons — au plus deux : la
  // section Tournois, et l'occupant de l'emplacement du milieu. Le vide n'en
  // est pas une, justement : c'est lui qui laisse la place.
  const cartes = (i.hasTournaments ? 1 : 0)
    + (i.hasNextMatch ? 1 : 0)
    + (suggere ? 1 : 0);
  // Une seule carte = de la place à rendre. On la rend au texte des boutons,
  // pas au blanc. Le compact lève moins haut : sur un petit écran, la marge
  // qu'on croit avoir est celle qui manquera à la carte du dessous.
  const ctaScale = cartes >= 2 ? 1 : (c ? 1.08 : 1.18);
  return {
    // Hauteur FIXE (flex 0) : une bannière ne s'étire pas. Sans ça elle
    // prendrait sa part de l'écran comme une carte, et volerait au hero la
    // place qu'on vient de lui rendre.
    liveBanner: i.hasLiveTournament ? { flex: 0, minHeight: c ? 52 : 58 } : null,
    // La rangée de raccourcis du bas (Classement · Score) a été retirée : le
    // rang est monté dans l'en-tête, et « Score » s'atteint depuis le lobby
    // avec le match en contexte. Les ~52 dp rendus ne sont pas laissés en
    // blanc au pied de la page — ils repartent aux planchers et aux espaces,
    // c'est-à-dire à l'air entre les cartes, qui est ce qu'on cherchait.
    // Le profil ne prend 0,3 part de plus que dans le cas où PERSONNE ne le
    // relaie — ni match, ni tournoi, ni suggestion. Le compte est fait pour
    // que le total des parts ne bouge pas (3,3 + 0,8 de vide = 3 + 1,1) : les
    // boutons et les tournois gardent exactement la même proportion.
    // Sans carte de profil, sa part (3 a 3,3) n'est pas redistribuee aux
    // autres : elles doubleraient de hauteur pour remplir un ecran qui, de
    // toute facon, defile maintenant. Elles gardent leurs proportions et la
    // page est simplement plus courte en haut.
    hero:  i.hasHero === false ? null : { flex: i.hasNextMatch || suggere ? 3 : 3.3, minHeight: c ? 158 : 228 },
    // Deux TUILES depuis le 2026-09-22 : titre sur deux lignes, phrase et
    // fleche. Elles reclament trois fois la hauteur des anciens boutons, et
    // c'est la seule section dont le plancher a change.
    ctas:  { flex: 1.8, minHeight: c ? 118 : 132, textScale: ctaScale },
    // PAS DE SECTION TOURNOIS PENDANT UNE SOIRÉE. On est déjà à un tournoi :
    // la liste des autres soirées ouvertes est du bruit à ce moment précis, et
    // elle coûte 92 à 136 dp — bien plus que la bannière n'en prend.
    //
    // Sans ce retrait, le cas le plus chargé (bannière + tournois + match
    // programmé) réclamait 728 dp pour une colonne de 715. J'ai d'abord essayé
    // de rétrécir le hero jusqu'à repasser sous la barre : ça tenait à un
    // pixel près, c'est-à-dire que ça ne tenait pas. Retirer ce qui ne sert
    // pas vaut mieux que rogner ce qui sert.
    tournaments: i.hasTournaments && !i.hasLiveTournament
      ? { flex: 1.5, minHeight: c ? 92 : 136 } : null,
    // La carte n'est plus rendue quand il n'y a rien à annoncer. Elle disait
    // « Aucun match programmé · explore les parties ouvertes », avec une
    // flèche vers le lobby — soit mot pour mot le bouton « Trouver un match »
    // situé juste au-dessus. Deux fois le même message et la même destination.
    nextMatch: i.hasNextMatch ? { flex: 2.2, minHeight: c ? 150 : 180 } : null,
    // La carte du lobby (`GameCard`) précédée de son titre, ou la carte
    // « crée le tien ». Le pli est le même que pour « Prochain match » : ce
    // qui n'a que deux lignes à dire ne réclame pas la place de ce qui en a
    // dix. Le plancher haut tient compte de la densité de `GameCard` — date,
    // club, niveau, pastilles ET quatre créneaux — plus la ligne de titre.
    openGames: !suggere ? null
      : nb > 0 ? { flex: 2.2, minHeight: c ? 186 : 210 }
               : { flex: 1.1, minHeight: c ? 92  : 104 },
    filler: i.hasNextMatch || suggere ? null : { flex: 0.8, minHeight: 0 },
    gap: c ? 10 : 16,
  };
}

/** La hauteur minimale que la colonne réclame, planchers et espaces compris. */
export function totalMinHeight(s: HomeSizes): number {
  const sections = [s.liveBanner, s.hero, s.ctas, s.tournaments, s.nextMatch, s.openGames, s.filler]
    .filter((x): x is SectionSize => x !== null);
  const planchers = sections.reduce((n, x) => n + x.minHeight, 0);
  return planchers + s.gap * Math.max(0, sections.length - 1);
}

/** L'accueil tient-il sans défiler dans une colonne de cette hauteur ? */
export function fitsWithoutScroll(s: HomeSizes, columnHeight: number): boolean {
  return totalMinHeight(s) <= columnHeight;
}

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
