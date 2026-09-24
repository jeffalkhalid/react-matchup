// lib/clashResult.ts — ce qu'un pronostic devient une fois le match joué.
//
// Jusqu'ici un vote était une impasse : au coup d'envoi la carte disparaissait
// du rail et personne n'apprenait jamais s'il avait vu juste. Les lignes de
// `predictions` étaient écrites, puis plus jamais relues. Ce fichier ferme la
// boucle.
//
// Il ne crée AUCUNE donnée : le résultat vit déjà dans `matches` (validé), le
// pronostic dans `predictions`, et les deux se rejoignent par `game_id`. Pas
// de migration, rien à appliquer côté serveur.
//
// Une seule voix, ici comme avant le match : on parle d'EUX — « ils avaient vu
// juste » — jamais « du club ». La même carte ne change pas de bouche entre
// l'avant et l'après.
//
// Le haut est pur et testé (lib/__tests__/clashResult.test.ts) ; le bas parle
// à la base.
import { supabase } from './supabase';
import { parseSetsLocal } from './matchView';
import {
  PREDICTION_DAYS, predictionShare,
  type Clash, type ClashPlayer, type PredictionCounts, type Team,
} from './weekendClash';

/** Combien de temps un résultat reste visible après le match. */
export const RESULT_DAYS = 7;

/**
 * Passé ce délai, un match dont personne n'a saisi le score cesse d'être « en
 * cours » et quitte le rail. Sans cette borne il y resterait pour toujours.
 */
export const EN_COURS_HEURES = 24;

/**
 * La fenêtre du rail : une semaine en arrière pour les résultats, deux
 * semaines en avant pour les pronostics.
 */
export function clashWindow(now: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(now);
  start.setDate(start.getDate() - RESULT_DAYS);
  const end = new Date(now);
  end.setDate(end.getDate() + PREDICTION_DAYS);
  return { start, end };
}

/** Les trois âges d'une carte de pronostic. */
export type ClashPhase = 'a_venir' | 'en_cours' | 'termine';

/** Le résultat validé d'une partie, réduit à ce dont la carte a besoin. */
export interface ClashResult {
  winnerIds: string[];
  scoreText: string;
}

/**
 * L'âge d'une carte. `null` veut dire « plus rien à dire » : le match est
 * passé depuis longtemps et aucun score n'est jamais arrivé.
 */
export function clashPhase(
  matchDate: string,
  result: ClashResult | null | undefined,
  now: Date = new Date(),
): ClashPhase | null {
  if (result) return 'termine';
  const debut = Date.parse(matchDate);
  if (Number.isNaN(debut)) return null;
  if (debut > now.getTime()) return 'a_venir';
  if (now.getTime() - debut < EN_COURS_HEURES * 3_600_000) return 'en_cours';
  return null;
}

/**
 * Le camp vainqueur, vu des deux paires qui ont été pronostiquées.
 *
 * `null` quand les vainqueurs ne se rangent pas proprement d'un seul côté :
 * un joueur a pu changer de partenaire à la saisie du score (le bouton
 * « Changé de partenaire ? »), et la partie jouée n'est alors plus celle qui
 * a été pronostiquée. Trancher ici, ce serait rendre un verdict faux.
 */
export function winnerTeam(clash: Pick<Clash, 'teamA' | 'teamB'>, winnerIds: string[]): Team | null {
  const ids = new Set(winnerIds.filter(Boolean));
  const a = clash.teamA.filter(p => ids.has(p.id)).length;
  const b = clash.teamB.filter(p => ids.has(p.id)).length;
  if (a > 0 && b === 0) return 'A';
  if (b > 0 && a === 0) return 'B';
  return null;
}

/** Ce que MON pronostic est devenu. */
export type MyVerdict = 'juste' | 'rate' | 'sans_prono' | 'indecidable';

export function myVerdict(mine: Team | null | undefined, winner: Team | null): MyVerdict {
  if (!mine) return 'sans_prono';
  if (!winner) return 'indecidable';
  return mine === winner ? 'juste' : 'rate';
}

/**
 * La part des PAGUISTES qui avaient choisi les vainqueurs. `null` quand il n'y
 * a ni vainqueur identifiable ni le moindre avis.
 */
export function crowdShare(counts: PredictionCounts, winner: Team | null): number | null {
  if (!winner || counts.total === 0) return null;
  return predictionShare(counts, winner);
}

/**
 * Ce qu'ILS avaient vu, maintenant qu'on sait — sur MON match.
 *
 * Le pendant d'après-match de `oddsLine` : mêmes personnes, même voix,
 * l'issue en plus.
 */
export function oddsOutcomeLine(
  counts: PredictionCounts,
  myTeam: Team | null,
  winner: Team | null,
): string | null {
  if (!myTeam || !winner || counts.total === 0) return null;
  const pourMoi = predictionShare(counts, myTeam);
  const gagne = myTeam === winner;
  if (pourMoi === 50) {
    return gagne ? "Ils n'arrivaient pas à trancher. Tu as tranché." : "Ils n'arrivaient pas à trancher.";
  }
  if (pourMoi > 50) {
    return gagne ? "Confirmé. Ils t'avaient vu gagner." : "Pas cette fois. Ils t'avaient vu gagner.";
  }
  return gagne ? 'Tu leur as donné tort.' : 'Ils avaient vu juste.';
}

/**
 * Le rang d'une carte dans le rail : ce qu'elle me doit.
 *
 *   0. un résultat sur lequel j'avais voté — ma récompense, je viens la chercher
 *   1. une partie à voter — actionnable, et ça expire au coup d'envoi
 *   2. un match en cours — l'attente, rien à faire
 *   3. un résultat sans mon prono — une nouvelle, pas une récompense
 *
 * Plafonner le nombre de résultats ferait la même chose en pire : ça
 * jetterait des cartes pour résoudre un problème d'ordre.
 */
export function clashRank(phase: ClashPhase, mien: Team | null | undefined): number {
  if (phase === 'termine') return mien ? 0 : 3;
  if (phase === 'a_venir') return 1;
  return 2;
}

export interface RailCard {
  matchDate: string;
  phase: ClashPhase;
  /**
   * Mon intérêt personnel dans cette carte, et le camp qu'il désigne.
   *
   * Ce n'est pas la même chose des deux côtés : dans « Qui va gagner ? » c'est
   * MON pronostic, dans « Prono des PAGUISTES » c'est MON camp. Dans les deux
   * cas il répond à la seule question qui décide de l'ordre — est-ce que ce
   * résultat me doit quelque chose ?
   */
  mien?: Team | null;
}

/** Le rail ordonné : par rang, puis par date. */
export function orderRail<T extends RailCard>(cards: T[]): T[] {
  return [...cards].sort((x, y) => {
    const rx = clashRank(x.phase, x.mien);
    const ry = clashRank(y.phase, y.mien);
    if (rx !== ry) return rx - ry;
    const dx = Date.parse(x.matchDate);
    const dy = Date.parse(y.matchDate);
    // À venir : le plus proche d'abord. Déjà joué : le plus récent d'abord.
    return x.phase === 'a_venir' ? dx - dy : dy - dx;
  });
}

/** « 6 - 4 · 3 - 6 · 10 - 7 », toujours du côté des vainqueurs. */
export function scoreLabel(scoreText: string | null | undefined): string {
  return parseSetsLocal(scoreText).map(([a, b]) => `${a} - ${b}`).join(' · ');
}

/** « GALAN / MOUNIR » — les prénoms d'une paire. */
export function pairLabel(players: ClashPlayer[]): string {
  return players.map(p => p.name.trim().split(/\s+/)[0]).join(' / ');
}

// ─── Base de données ──────────────────────────────────────────────────────

/**
 * Les résultats validés de plusieurs parties, en UNE requête.
 *
 * Seuls les scores VALIDÉS comptent : un score en attente ou contesté peut
 * encore changer de vainqueur, et un verdict qu'il faut retirer ensuite vaut
 * moins que pas de verdict du tout.
 */
export async function fetchResultsForGames(gameIds: string[]): Promise<Map<string, ClashResult>> {
  const out = new Map<string, ClashResult>();
  const ids = [...new Set(gameIds.filter(Boolean))];
  if (ids.length === 0) return out;

  const { data, error } = await supabase
    .from('matches')
    .select('game_id, winner_id, winner_id_2, score_text, status')
    .in('game_id', ids)
    .eq('status', 'validated');
  if (error) { console.warn('[clashResult] results', error); return out; }

  for (const r of (data ?? []) as any[]) {
    if (!r.game_id) continue;
    out.set(r.game_id, {
      winnerIds: [r.winner_id, r.winner_id_2].filter(Boolean) as string[],
      scoreText: r.score_text ?? '',
    });
  }
  return out;
}
