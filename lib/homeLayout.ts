// lib/homeLayout.ts — le budget de hauteur de l'écran d'accueil.
//
// L'accueil NE DÉFILE PAS. C'est une contrainte, pas une préférence : il n'y
// a pas de zone déroulante sur cet écran, et il ne doit jamais y en avoir.
// Tout doit donc tenir dans la place disponible — sans jamais la dépasser,
// et sans gonfler pour la remplir.
//
// ── POURQUOI CE FICHIER A ÉTÉ RÉÉCRIT ──────────────────────────────────────
//
// La version précédente estimait la hauteur disponible à coups de constantes
// (`winH - insets.top - 48 - (64 + insets.bottom) - 18 - 48`), puis donnait à
// chaque section une part ET un plancher. Deux défauts qui se renforçaient :
//
//   1. Les constantes étaient des suppositions. En-tête à 48, marges à 18,
//      espaces à 48 : il suffisait qu'une soit fausse — police système plus
//      grande, en-tête qui grandit — pour que l'accueil se croie plus riche
//      qu'il ne l'est. On corrigeait alors la constante pour CE téléphone-là.
//
//   2. Une part se partage toujours ; un plancher, lui, permet à un bloc de
//      REFUSER sa part. Quand la somme des planchers dépassait la hauteur
//      disponible, aucun moteur de mise en page ne pouvait résoudre le
//      problème : le dernier bloc passait sous la barre d'onglets.
//
// Six corrections ont suivi, chacune sur une erreur de comptabilité
// différente. Le problème n'était aucune d'elles : c'était le modèle.
//
// ── CE QUE FAIT CE FICHIER MAINTENANT ──────────────────────────────────────
//
// Il reçoit la hauteur RÉELLE, mesurée par l'écran, et rend une hauteur en
// points par section. L'invariant, vérifié par les tests sur toute une
// matrice de tailles et d'états :
//
//     Σ hauteurs + Σ espaces  ≤  hauteur disponible
//
// Ce n'est pas un réglage qui tient, c'est une propriété du calcul.
//
// Une INÉGALITÉ, pas une égalité : chaque bloc a une taille juste, dictée par
// son dessin, et au-delà la place supplémentaire ne lui sert à rien. Je
// l'avais d'abord redistribuée pour tomber pile — mesure à l'appui, les
// tuiles montaient à 438 points pour un idéal de 157. Le surplus reste donc
// du blanc.
//
// ── CE QUI REND LES MINIMUMS FIABLES ───────────────────────────────────────
//
// Un minimum n'a de sens que si la hauteur d'un texte est connue. Les textes
// de mise en page de cet écran ne suivent donc plus la taille système (cf.
// lib/uiText, réversible en une ligne). Sans cela, les chiffres ci-dessous
// resteraient des suppositions — et on retomberait dans la boucle des seuils
// ajustés téléphone par téléphone.

/**
 * La composition réelle de chaque bloc, en points.
 *
 * Chaque chiffre est une ADDITION de ce que le bloc dessine, pas une réserve
 * empirique. Les composants lisent ces mêmes constantes pour se dessiner :
 * changer un rembourrage ici change le rendu ET le budget, ensemble.
 */
export const GEO = {
  /** Les deux tuiles « Trouver un match » / « Match défi ». */
  cta: {
    padV: 11,
    pastille: 32,
    titreLigne: 21, titreLignes: 2,
    phraseLigne: 15, phraseLignes: 2,
    /** Largeur / hauteur visé par la maquette. */
    ratio: 1.15,
    /** Marges horizontales de la colonne, plus l'espace entre les deux. */
    margeH: 40, entreTuiles: 10,
  },
  /** Le bandeau « Tournois & événements » — une rangée. */
  tournois: { padV: 14, pastille: 44, titreLigne: 25, phraseLigne: 16, pastilleAvenir: 24 },
  /** La carte « Prochain match ». */
  match: { padV: 12, entete: 22, club: 20, avatarPlein: 52, avatarReduit: 40, nom: 13, niveau: 12, gapInterne: 10 },
  /** « Ça se joue bientôt », quand il n'y a ni match ni tournoi. */
  parties: { entete: 21, gap: 10, carte: 120, carteReduite: 84 },
  /** « Ça bouge chez les PAGUISTES ». */
  pulse: { entete: 21, gap: 10, padCarte: 14, enteteCarte: 22, bouton: 30, phrase: 30, photos: 44 },
  /** La bannière de soirée en cours. */
  soiree: { min: 52, ideal: 58 },
} as const;

/** La hauteur d'une tuile CTA pour une largeur de colonne donnée. */
export function ctaHeightFor(width: number): number {
  const tuile = Math.max(0, (width - GEO.cta.margeH - GEO.cta.entreTuiles) / 2);
  return Math.round(tuile / GEO.cta.ratio);
}

/** Le minimum incompressible d'une tuile CTA : ce qu'elle dessine, additionné. */
export const CTA_MIN =
  GEO.cta.padV * 2
  + GEO.cta.pastille
  + GEO.cta.titreLigne * GEO.cta.titreLignes
  + GEO.cta.phraseLigne;

/** Le bandeau Tournois, sans puis avec sa phrase et sa pastille. */
export const TOURNOIS_MIN = GEO.tournois.padV * 2 + GEO.tournois.pastille;
export const TOURNOIS_IDEAL =
  GEO.tournois.padV * 2
  + GEO.tournois.titreLigne + GEO.tournois.phraseLigne + GEO.tournois.pastilleAvenir + 6;

/** « Prochain match », avatars réduits puis pleins. */
export const MATCH_MIN =
  GEO.match.padV * 2 + GEO.match.entete + GEO.match.club
  + GEO.match.avatarReduit + GEO.match.nom + GEO.match.niveau + GEO.match.gapInterne;
export const MATCH_IDEAL = MATCH_MIN + (GEO.match.avatarPlein - GEO.match.avatarReduit) + 10;

/** « Ça bouge » : titre + carte réduite à son en-tête et son bouton, puis complète. */
export const PULSE_MIN =
  GEO.pulse.entete + GEO.pulse.gap
  + GEO.pulse.padCarte * 2 + GEO.pulse.enteteCarte + GEO.pulse.bouton;
export const PULSE_IDEAL = PULSE_MIN + GEO.pulse.phrase + GEO.pulse.photos;

/** « Ça se joue bientôt ». */
export const PARTIES_MIN = GEO.parties.entete + GEO.parties.gap + GEO.parties.carteReduite;
export const PARTIES_IDEAL = GEO.parties.entete + GEO.parties.gap + GEO.parties.carte;

// ── Le calculateur ─────────────────────────────────────────────────────────

/** Ce qu'un bloc demande à l'écran. */
export interface HomeSection {
  key: string;
  /** Sous cette hauteur, le bloc ne sait plus s'afficher. */
  min: number;
  /** Au-delà, la place supplémentaire ne lui sert plus à rien. */
  ideal: number;
  /** Sa part du surplus, quand il y en a un. */
  weight: number;
  /**
   * Il peut rendre sa place, puis disparaître, pour que les autres tiennent.
   *
   * Un seul bloc l'est : « Ça bouge ». C'est la hiérarchie de compression —
   * mieux vaut un bloc secondaire absent qu'un « Prochain match » coupé ou du
   * contenu derrière la barre d'onglets. Et son contenu reste entier dans
   * l'onglet Activité, où « Voir tout » mène déjà.
   */
  yields?: boolean;
}

export interface HomeLayoutInput {
  /** Mesurée par l'écran (onLayout), jamais estimée. */
  availableHeight: number;
  /** Mesurée aussi : elle détermine la hauteur des tuiles. */
  availableWidth: number;
  gap?: number;
  hasLiveBanner?: boolean;
  hasTournaments: boolean;
  hasNextMatch: boolean;
  /** Nombre de parties proposées quand il n'y a ni match ni tournoi. */
  openGames?: number;
  hasPulse?: boolean;
}

export interface HomeLayoutResult {
  /** La hauteur de chaque bloc, en points. Absent ou 0 = pas rendu. */
  heights: Record<string, number>;
  gap: number;
  /**
   * Vrai quand il a fallu descendre SOUS les minimums : l'écran est trop
   * petit même sans les blocs cédables. Rien ne déborde pour autant.
   */
  contraint: boolean;
}

/** L'espace entre deux blocs, choisi sur la place disponible et rien d'autre. */
export function gapFor(availableHeight: number): number {
  return availableHeight < 560 ? 10 : 16;
}

/** Les blocs présents, dans l'ordre de l'écran. */
export function homeSections(i: HomeLayoutInput): HomeSection[] {
  // L'emplacement du milieu revient aux suggestions dans UN seul cas : rien de
  // programmé et rien d'ouvert. Même règle que lib/homeSlot, et elle doit le
  // rester — un test compare les deux.
  const suggere = !i.hasNextMatch && !i.hasTournaments;
  const ctaIdeal = Math.max(CTA_MIN, ctaHeightFor(i.availableWidth));
  const out: HomeSection[] = [];

  if (i.hasLiveBanner) {
    out.push({ key: 'liveBanner', min: GEO.soiree.min, ideal: GEO.soiree.ideal, weight: 0.4 });
  }
  out.push({ key: 'ctas', min: CTA_MIN, ideal: ctaIdeal, weight: 1.4 });
  // Pendant une soirée, le bandeau disparaît : la bannière du haut dit déjà où
  // aller, et deux appels au même endroit se nuisent.
  if (!i.hasLiveBanner) {
    out.push({ key: 'tournaments', min: TOURNOIS_MIN, ideal: TOURNOIS_IDEAL, weight: 0.8 });
  }
  if (i.hasNextMatch) {
    out.push({ key: 'nextMatch', min: MATCH_MIN, ideal: MATCH_IDEAL, weight: 1.7 });
  }
  if (suggere) {
    out.push({ key: 'openGames', min: PARTIES_MIN, ideal: PARTIES_IDEAL, weight: 1.6 });
  }
  if (i.hasPulse) {
    out.push({ key: 'pulse', min: PULSE_MIN, ideal: PULSE_IDEAL, weight: 2.2, yields: true });
  }
  return out;
}

/**
 * Répartit la hauteur mesurée entre les blocs.
 *
 * Trois cas, un seul invariant : la somme des hauteurs et des espaces ne
 * DÉPASSE JAMAIS la hauteur disponible. Ce qui reste est du blanc — un bloc
 * ne grossit jamais au-delà de sa taille juste pour remplir l'écran.
 *
 *  1. Tout tient : chacun a son minimum, le surplus se partage au prorata des
 *     poids, PLAFONNÉ à l'idéal. Le reliquat reste en espace.
 *  2. Ça ne tient pas : le bloc cédable de plus faible priorité s'efface, et
 *     on recommence avec un espace de moins à poser.
 *  3. Plus rien à céder et ça ne tient toujours pas : tout le monde rétrécit
 *     ensemble. On ne promet plus rien, mais rien ne déborde — ce qui reste la
 *     seule chose à tenir.
 */
export function solveHomeLayout(i: HomeLayoutInput): HomeLayoutResult {
  const gap = i.gap ?? gapFor(i.availableHeight);
  const toutes = homeSections(i);
  const vide: Record<string, number> = {};
  for (const s of toutes) vide[s.key] = 0;

  let actives = toutes.slice();
  for (;;) {
    if (actives.length === 0 || i.availableHeight <= 0) {
      return { heights: { ...vide }, gap, contraint: true };
    }
    const budget = i.availableHeight - gap * (actives.length - 1);
    if (budget <= 0) {
      const cedable = actives.filter(s => s.yields);
      if (cedable.length > 0) {
        actives = actives.filter(s => s.key !== cedable[cedable.length - 1].key);
        continue;
      }
      return { heights: { ...vide }, gap, contraint: true };
    }

    const besoin = actives.reduce((n, s) => n + s.min, 0);

    if (besoin > budget) {
      const cedable = actives.filter(s => s.yields);
      if (cedable.length > 0) {
        actives = actives.filter(s => s.key !== cedable[cedable.length - 1].key);
        continue;
      }
      // Cas 3 : tout le monde au prorata de son minimum.
      const h = { ...vide };
      const f = budget / besoin;
      for (const s of actives) h[s.key] = s.min * f;
      return { heights: h, gap, contraint: true };
    }

    // Cas 1 : le surplus se partage.
    const h = { ...vide };
    for (const s of actives) h[s.key] = s.min;
    let reste = budget - besoin;

    let candidats = actives.filter(s => s.ideal > s.min);
    while (reste > 0.01 && candidats.length > 0) {
      const poids = candidats.reduce((n, s) => n + s.weight, 0) || 1;
      let consomme = 0;
      const suivants: HomeSection[] = [];
      for (const s of candidats) {
        const part = (s.weight / poids) * reste;
        const place = s.ideal - h[s.key];
        const pris = Math.min(part, place);
        h[s.key] += pris;
        consomme += pris;
        if (h[s.key] < s.ideal - 0.01) suivants.push(s);
      }
      if (consomme <= 0.01) break;
      reste -= consomme;
      candidats = suivants;
    }

    // AUCUNE redistribution au-delà de l'idéal. Ce qui reste reste du BLANC.
    //
    // Je l'avais d'abord reparti, pour que la somme fasse exactement la
    // hauteur. Mesure a l'appui : sur un Android 412x892 avec match et
    // tournoi mais sans « Ca bouge », les tuiles passaient a 251 points pour
    // un ideal de 157, et la carte du match a 277 pour 163. Sans match ni
    // Pulse, les tuiles atteignaient 438 — les « tuiles geantes », revenues
    // par un autre chemin.
    //
    // Un bloc a une taille juste, dictee par son dessin. Au-dela, la place
    // supplementaire ne lui sert a rien : elle doit rester de l'espace, pas
    // devenir une carte demesuree. L'invariant devient donc une INEGALITE —
    // somme + espaces <= hauteur disponible — ce qui suffit a garantir que
    // rien ne deborde.
    return { heights: h, gap, contraint: false };
  }
}

/** La somme réellement occupée : hauteurs plus espaces entre les blocs rendus. */
export function occupiedHeight(r: HomeLayoutResult): number {
  const rendus = Object.values(r.heights).filter(v => v > 0);
  if (rendus.length === 0) return 0;
  return rendus.reduce((a, b) => a + b, 0) + r.gap * (rendus.length - 1);
}
