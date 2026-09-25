export function rankFromPoints(points: number | null | undefined): string | null {
  if (points == null) return null;
  if (points >= 2000) return 'P2000';
  if (points >= 1000) return 'P1000';
  if (points >= 500)  return 'P500';
  if (points >= 250)  return 'P250';
  if (points >= 100)  return 'P100';
  if (points >= 25)   return 'P25';
  return null;
}

// Affichage du classement FRMT.
// On n'affiche QUE le VRAI classement scrapé : joueur lié au scraper (vérifié)
// AVEC une position connue → « #position · points pts ». On n'affiche JAMAIS le
// bracket auto-déclaré au signup (`frmt_rank`, type « P100 »), pas fiable.
// Renvoie null s'il n'y a pas de vrai classement vérifié à afficher.
export function formatFrmtRanking(p: {
  frmt_verified?: boolean | null;
  frmt_position?: number | null;
  frmt_points?: number | null;
  frmt_rank?: string | null;
}): { text: string; verified: boolean } | null {
  if (!p.frmt_verified || p.frmt_position == null) return null;
  const pts = p.frmt_points != null ? ` · ${p.frmt_points} pts` : '';
  return { text: `#${p.frmt_position}${pts}`, verified: true };
}

// « Prénom Nom » → deux champs. Coupe au PREMIER espace : le prénom est rarement
// composé, le nom souvent (« El Amrani », « Ben Ali »). Recoller « prénom + nom »
// redonne la chaîne d'origine, donc un découpage de travers ne casse aucune liaison.
export function splitFullName(full?: string | null): { first: string; last: string } {
  const s = (full ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return { first: '', last: '' };
  const i = s.indexOf(' ');
  return i < 0 ? { first: s, last: '' } : { first: s.slice(0, i), last: s.slice(i + 1) };
}

/**
 * « IRROU ALAMINE » → « Irrou Alamine ». On adoucit la CASSE, rien d'autre : les
 * mots et leur ordre restent ceux de la fédération. Réordonner serait deviner,
 * et la FRMT écrit « NOM PRÉNOM », l'inverse de l'app.
 */
export function prettyFrmtName(frmtName?: string | null): string {
  return (frmtName ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map(mot => mot.split('-')
      .map(p => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p))
      .join('-'))
    .join(' ');
}

/**
 * Ce que montre la section « Prénom et nom » de « Modifier le profil ».
 *
 * `frmt` : joueur lié au classement — son nom vient de `frmt_rankings`, en UN
 * seul bloc non modifiable. On ne le découpe pas en prénom/nom : l'ordre fédéral
 * est l'inverse du nôtre, tout découpage inverserait les deux.
 * `free` : tout le monde d'autre — deux champs saisis par le joueur, pré-remplis
 * à défaut avec le nom FRMT déclaré à l'inscription.
 */
export function profileIdentity(
  p: {
    first_name?: string | null;
    last_name?: string | null;
    frmt_full_name?: string | null;
    frmt_verified?: boolean | null;
  },
  frmtName?: string | null,
): { mode: 'frmt'; full: string } | { mode: 'free'; first: string; last: string } {
  const federal = prettyFrmtName(frmtName);
  if (p.frmt_verified && federal) return { mode: 'frmt', full: federal };
  const fromFrmt = splitFullName(p.frmt_full_name);
  // `||` et non `??` : une chaîne vide en base vaut une absence de nom.
  return {
    mode: 'free',
    first: (p.first_name ?? '').trim() || fromFrmt.first,
    last: (p.last_name ?? '').trim() || fromFrmt.last,
  };
}

/**
 * Le vrai nom affiché SOUS le pseudo sur la fiche joueur, ou null.
 *
 * Joueur lié au classement : le nom vient de la FÉDÉRATION, jamais de sa saisie,
 * et le réglage ne s'y applique pas. Sinon on pourrait se lier sous le nom d'un
 * classé puis afficher le sien : le vol de classement deviendrait invisible.
 *
 * Tout le monde d'autre : ce qu'il a renseigné, s'il l'a laissé visible
 * (`show_real_name`, vrai par défaut — colonne absente = visible).
 */
export function realNameLine(
  p: {
    first_name?: string | null;
    last_name?: string | null;
    frmt_verified?: boolean | null;
    show_real_name?: boolean | null;
  },
  frmtName?: string | null,
): string | null {
  if (p.frmt_verified) return prettyFrmtName(frmtName) || null;
  if (p.show_real_name === false) return null;
  const nom = [(p.first_name ?? '').trim(), (p.last_name ?? '').trim()].filter(Boolean).join(' ');
  return nom || null;
}
