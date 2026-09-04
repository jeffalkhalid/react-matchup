// lib/disputeEvidence.ts — mettre les deux versions d'un score en face l'une
// de l'autre, avec le score enregistré en direct comme tiers.
//
// Implémente `design_handoff_panel_arbitre`, fiche de décision de litige.
//
// LE PIÈGE, ET LA RAISON D'ÊTRE DE CE FICHIER : « 6-3 » et « 3-6 » ne veulent
// pas dire la même chose, et les trois sources ne sont PAS écrites dans le
// même sens.
//
//   - score_text est saisi dans la perspective de celui qui l'a soumis
//     (cf. lib/matchView) ;
//   - counter_score_text est saisi CAMP DU CONTESTATAIRE EN PREMIER
//     (cf. app/score-entry, doSubmit) ;
//   - les sets du direct sont écrits équipe 1 puis équipe 2, l'ordre de
//     live_match_sessions.team1_ids.
//
// Les comparer tels quels ferait passer une inversion pour un accord, et un
// accord pour une inversion — sur exactement le genre de litige où l'arbitre
// tranche. Tout est donc ramené ici dans UN repère : le camp du vainqueur
// initialement déclaré est toujours à gauche.
//
// L'orientation n'est jamais devinée : chaque source porte de quoi la
// déterminer (counter_by, team1_ids), et une source dont on ne peut pas
// établir le sens est écartée plutôt qu'affichée de travers.

import { parseSetsLocal } from './matchView';

/** Un set, camp du vainqueur initialement déclaré à gauche. */
export interface SetPair { a: number; b: number }

/**
 * Lit « 6-3, 7-5 » SANS rien normaliser.
 *
 * Volontairement différent de `parseSetsLocal` de lib/matchView, qui remet le
 * vainqueur devant à la majorité des sets : cette normalisation-là est juste
 * pour AFFICHER un match tranché, et fausse pour COMPARER deux versions —
 * appliquée aux deux, elle rendrait « 6-3 » et « 3-6 » identiques, c'est-à-dire
 * qu'elle effacerait le litige.
 */
export function parseRawSets(text: string | null | undefined): SetPair[] {
  if (!text) return [];
  return text.trim().split(/[\s,]+/).flatMap(s => {
    const p = s.split(/[-/]/).map(Number);
    return p.length === 2 && p.every(n => Number.isFinite(n)) ? [{ a: p[0], b: p[1] }] : [];
  });
}

/** Retourne les sets côté pour côté. */
export function flipSets(sets: SetPair[]): SetPair[] {
  return sets.map(s => ({ a: s.b, b: s.a }));
}

/**
 * Le score contesté doit-il être retourné pour rejoindre le repère commun ?
 *
 * Il est saisi camp du contestataire en premier. Si le contestataire est
 * lui-même du côté déclaré vainqueur, il écrit déjà dans le bon sens.
 */
export function counterNeedsFlip(m: {
  counter_by?: string | null;
  winner_id?: string | null;
  winner_id_2?: string | null;
}): boolean {
  const by = m.counter_by ?? null;
  if (!by) return false;
  return !(by === m.winner_id || by === m.winner_id_2);
}

/**
 * Le score du direct doit-il être retourné ?
 *
 * Ses sets sont écrits équipe 1 puis équipe 2. On regarde de quel côté se
 * trouve le vainqueur déclaré. Vainqueur introuvable dans les deux équipes :
 * on ne sait pas, et `liveSets` écarte alors la source.
 */
export function liveNeedsFlip(team1Ids: string[], team2Ids: string[], winnerId: string | null): boolean | null {
  if (!winnerId) return null;
  if (team1Ids.includes(winnerId)) return false;
  if (team2Ids.includes(winnerId)) return true;
  return null;
}

/** L'état d'une session live, tel qu'il est stocké en jsonb. */
export interface LiveState {
  sets?: { t1: number; t2: number }[];
}

/**
 * Les sets du direct, ramenés dans le repère commun — ou `null` quand on ne
 * peut pas établir leur sens. Un set encore à 0-0 (celui en cours au moment
 * de l'abandon) n'est pas une preuve : il est écarté.
 */
export function liveSets(
  state: LiveState | null | undefined,
  team1Ids: string[],
  team2Ids: string[],
  winnerId: string | null,
): SetPair[] | null {
  const raw = (state?.sets ?? []).filter(s => (s.t1 ?? 0) > 0 || (s.t2 ?? 0) > 0);
  if (raw.length === 0) return null;
  const flip = liveNeedsFlip(team1Ids, team2Ids, winnerId);
  if (flip === null) return null;
  const pairs = raw.map(s => ({ a: s.t1, b: s.t2 }));
  return flip ? flipSets(pairs) : pairs;
}

const same = (x: SetPair | null, y: SetPair | null) => !!x && !!y && x.a === y.a && x.b === y.b;

/** Ce que le direct appuie, set par set. */
export type Backing = 'initial' | 'counter' | 'both' | 'neither' | null;

export interface EvidenceRow {
  /** Numéro de set, à partir de 1. */
  set: number;
  initial: SetPair | null;
  counter: SetPair | null;
  live: SetPair | null;
  /** Les deux versions divergent sur ce set — c'est ce qu'on met en évidence. */
  differs: boolean;
  /** `null` quand il n'y a pas de score en direct pour ce set. */
  liveBacks: Backing;
}

/**
 * Le tableau de comparaison. Autant de lignes que le plus long des trois
 * relevés : un set présent dans une version et absent de l'autre est
 * justement une divergence, il ne doit pas disparaître du tableau.
 */
export function buildEvidence(
  initial: SetPair[],
  counter: SetPair[],
  live: SetPair[] | null,
): EvidenceRow[] {
  const n = Math.max(initial.length, counter.length, live?.length ?? 0);
  const rows: EvidenceRow[] = [];
  for (let i = 0; i < n; i++) {
    const ini = initial[i] ?? null;
    const con = counter[i] ?? null;
    const liv = live?.[i] ?? null;
    const backsIni = same(liv, ini);
    const backsCon = same(liv, con);
    rows.push({
      set: i + 1,
      initial: ini,
      counter: con,
      live: liv,
      differs: !same(ini, con),
      liveBacks: !liv ? null
        : backsIni && backsCon ? 'both'
        : backsIni ? 'initial'
        : backsCon ? 'counter'
        : 'neither',
    });
  }
  return rows;
}

export interface Verdict {
  supports: 'initial' | 'counter' | 'neither' | 'none';
  label: string;
}

/**
 * La conclusion, en une phrase — ce que l'arbitre lit avant le tableau.
 *
 * Elle ne se prononce QUE sur les sets où les deux versions divergent : un
 * accord sur les sets non contestés ne prouve rien, et le compter ferait dire
 * au direct qu'il « appuie » une version alors qu'il ne départage rien.
 *
 * « Aucune des deux » est une réponse à part entière : le direct qui ne
 * correspond ni à l'une ni à l'autre est souvent le vrai score, celui que
 * personne n'a resaisi correctement.
 */
export function evidenceVerdict(rows: EvidenceRow[]): Verdict {
  const litigieux = rows.filter(r => r.differs);
  if (litigieux.length === 0) {
    return { supports: 'none', label: 'Les deux versions sont identiques — le désaccord porte sur autre chose.' };
  }
  if (litigieux.every(r => r.liveBacks === null)) {
    return { supports: 'none', label: 'Aucun score enregistré en direct : rien pour départager.' };
  }
  const tranchants = litigieux.filter(r => r.liveBacks !== null);
  const pourIni = tranchants.filter(r => r.liveBacks === 'initial').length;
  const pourCon = tranchants.filter(r => r.liveBacks === 'counter').length;
  if (pourIni > 0 && pourCon === 0 && pourIni === tranchants.length) {
    return { supports: 'initial', label: 'Le score en direct confirme la version initiale.' };
  }
  if (pourCon > 0 && pourIni === 0 && pourCon === tranchants.length) {
    return { supports: 'counter', label: 'Le score en direct confirme la version contestée.' };
  }
  return {
    supports: 'neither',
    label: 'Le score en direct ne correspond exactement à aucune des deux versions.',
  };
}

/** Recompose « 6-3, 7-5 » à partir de sets du repère commun. */
export function setsToText(sets: SetPair[]): string {
  return sets.map(s => `${s.a}-${s.b}`).join(', ');
}

/**
 * Cette version renverse-t-elle le vainqueur ?
 *
 * Dans le repère commun, le camp de gauche est le vainqueur initialement
 * déclaré. Si une version lui donne moins de sets qu'à l'autre, la retenir ne
 * change pas seulement le score : elle change QUI a gagné, donc l'ELO des
 * quatre joueurs. Forcer la validation, qui garde le vainqueur enregistré,
 * écrirait alors une ligne incohérente — le bouton doit le dire.
 */
export function reversesWinner(sets: SetPair[]): boolean {
  const gauche = sets.filter(s => s.a > s.b).length;
  const droite = sets.filter(s => s.b > s.a).length;
  return droite > gauche;
}

/**
 * La version initiale, dans le repère commun.
 *
 * Elle passe par `parseSetsLocal` de lib/matchView — le parseur PARTAGÉ, celui
 * qui remet le vainqueur devant à la majorité des sets. C'est exactement ce
 * qu'il faut ici : le vainqueur enregistré a été déduit de cette saisie, donc
 * la majorité des sets désigne bien le camp de gauche du repère.
 *
 * C'est aussi la seule des trois sources pour laquelle cette normalisation est
 * juste : appliquée au score contesté, elle mettrait devant le vainqueur QUE
 * LE CONTESTATAIRE REVENDIQUE, et une inversion passerait pour un accord.
 */
export function initialSets(text: string | null | undefined): SetPair[] {
  return parseSetsLocal(text).map(([a, b]) => ({ a, b }));
}

/**
 * La confiance d'un camp : la moyenne du fiability_pct de ses joueurs.
 *
 * Elle ne DÉSIGNE pas un coupable — deux joueurs fiables peuvent se tromper de
 * bonne foi. Elle dit seulement lequel des deux camps a l'historique le plus
 * mince, ce qui aide quand aucune autre pièce ne départage. `null` quand aucun
 * joueur du camp n'a de valeur : afficher « 0 % » accuserait à tort.
 */
export function campTrust(players: ({ fiability_pct?: number | null } | null | undefined)[]): number | null {
  const vals = players
    .map(p => p?.fiability_pct)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  if (vals.length === 0) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}
