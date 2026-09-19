// lib/bilanStats.ts — chiffres de la carte « Recap du mois » (slide Partage du
// bilan). PUR ET TESTÉ (lib/__tests__/bilanStats.test.ts).
import { DELETED_CLUB_LOCATION } from './mapsConstants';

export interface StatMatch {
  winner_id: string | null; winner_id_2: string | null;
  loser_id: string | null; loser_id_2: string | null;
  /** Mise d'un défi (1 = partie normale). */
  stake_multiplier?: number | null;
  location?: string | null;
  /** Niveaux des deux perdants (niveau ACTUEL : on ne garde pas celui du jour du match). */
  loserLevels?: (number | null)[];
  /** Date du match (heure de jeu, sinon saisie du score) — pour l'ordre chronologique. */
  when?: string | null;
}

const quand = (x: StatMatch) => { const t = x.when ? Date.parse(x.when) : NaN; return Number.isNaN(t) ? 0 : t; };

/** Les matchs dans l'ordre où ils ont été JOUÉS (le score peut être saisi plus tard). */
export function inPlayOrder<T extends StatMatch>(matches: T[]): T[] {
  return [...matches].sort((a, b) => quand(a) - quand(b));
}

/** « V » / « D » de chaque match, dans l'ordre où ils ont été joués. */
export function chronoResults(matches: StatMatch[], uid: string): ('V' | 'D')[] {
  return inPlayOrder(matches).map(x => (x.winner_id === uid || x.winner_id_2 === uid ? 'V' : 'D'));
}

const aGagne = (x: StatMatch, uid: string) => x.winner_id === uid || x.winner_id_2 === uid;

/** Plus longue suite de victoires, matchs dans l'ordre chronologique. */
export function maxWinStreak(matches: StatMatch[], uid: string): number {
  let best = 0, cur = 0;
  for (const x of inPlayOrder(matches)) {
    cur = aGagne(x, uid) ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

/** Victoires dans des défis (une mise au-delà de ×1). */
export function defisWon(matches: StatMatch[], uid: string): number {
  return matches.filter(x => aGagne(x, uid) && Number(x.stake_multiplier ?? 1) > 1).length;
}

/** Le lieu le plus joué du mois (hors lieu inconnu ou club retiré). */
export function favoriteClub(matches: StatMatch[]): { name: string; count: number } | null {
  const n = new Map<string, number>();
  for (const x of matches) {
    const l = (x.location ?? '').trim();
    if (!l || l === DELETED_CLUB_LOCATION) continue;
    n.set(l, (n.get(l) ?? 0) + 1);
  }
  let best: { name: string; count: number } | null = null;
  for (const [name, count] of n) if (!best || count > best.count) best = { name, count };
  return best;
}

/** Niveau moyen (2 décimales) de la paire la plus forte battue ce mois-ci. */
export function bestWinLevel(matches: StatMatch[], uid: string): number | null {
  let best: number | null = null;
  for (const x of matches) {
    if (!aGagne(x, uid)) continue;
    const lv = (x.loserLevels ?? []).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (lv.length === 0) continue;
    const moy = +(lv.reduce((s, v) => s + v, 0) / lv.length).toFixed(2);
    if (best === null || moy > best) best = moy;
  }
  return best;
}
