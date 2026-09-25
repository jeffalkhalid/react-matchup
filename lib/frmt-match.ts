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
 * Identité à afficher dans « Modifier le profil », et faut-il la verrouiller.
 *
 * `locked` NE dépend PAS du seul `frmt_verified` : un joueur peut être vérifié
 * SANS aucun nom dans `players` — son nom fédéral vit alors dans `frmt_rankings`,
 * et la FRMT l'écrit « NOM PRÉNOM », l'inverse d'ici : impossible de le découper
 * à l'aveugle. Verrouiller dans ce cas donnait deux champs vides ET grisés :
 * rien à lire, rien à saisir. On ne verrouille donc que si les DEUX champs ont
 * quelque chose à montrer ; sinon le joueur écrit son nom lui-même.
 */
export function profileIdentity(p: {
  first_name?: string | null;
  last_name?: string | null;
  frmt_full_name?: string | null;
  frmt_verified?: boolean | null;
}): { first: string; last: string; locked: boolean } {
  const fromFrmt = splitFullName(p.frmt_full_name);
  // `||` et non `??` : une chaîne vide en base vaut une absence de nom.
  const first = (p.first_name ?? '').trim() || fromFrmt.first;
  const last = (p.last_name ?? '').trim() || fromFrmt.last;
  return { first, last, locked: !!p.frmt_verified && !!first && !!last };
}
