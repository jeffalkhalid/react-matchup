// lib/playerStats.ts — « combien de matchs, combien de victoires » : UNE seule
// définition pour tous les écrans.
//
// Le piège (vu sur device le 2026-09-16) : `players.win_count` / `loss_count`
// sont les compteurs CLASSÉS — le trigger ELO les laisse tels quels pour un
// match amical (il ne touche ni l'ELO ni ces compteurs). L'accueil et la carte
// Stats affichaient donc « 5 matchs » pendant que la liste des matchs, qui
// montre TOUT, en affichait 6. Décision utilisateur : partout, on compte TOUS
// les matchs validés, amicaux compris.
//
// Ne pas « corriger » win_count/loss_count côté serveur : l'ELO s'en sert
// (facteur K, phase de placement, fiabilité, enjeu des défis).
import { supabase } from './supabase';

export interface PlayerTotals {
  /** Matchs validés, amicaux COMPRIS. */
  played: number;
  wins: number;
  losses: number;
  /** Pourcentage de victoires sur ces matchs (0 quand aucun match). */
  winRate: number;
}

export const EMPTY_TOTALS: PlayerTotals = { played: 0, wins: 0, losses: 0, winRate: 0 };

/** Les quatre places d'un match : deux gagnants, deux perdants. */
export interface MatchSides {
  winner_id?: string | null;
  winner_id_2?: string | null;
  loser_id?: string | null;
  loser_id_2?: string | null;
}

/** Totaux d'un joueur à partir d'une liste de matchs DÉJÀ validés. */
export function totalsFromMatches(matches: MatchSides[], playerId: string): PlayerTotals {
  let wins = 0, losses = 0;
  for (const m of matches) {
    if (m.winner_id === playerId || m.winner_id_2 === playerId) wins += 1;
    else if (m.loser_id === playerId || m.loser_id_2 === playerId) losses += 1;
  }
  const played = wins + losses;
  return { played, wins, losses, winRate: played > 0 ? Math.round((wins / played) * 100) : 0 };
}

/** Totaux de plusieurs joueurs, en UNE requête (fiche match : les 4 joueurs). */
export async function fetchPlayersTotals(playerIds: string[]): Promise<Map<string, PlayerTotals>> {
  const out = new Map<string, PlayerTotals>();
  const ids = [...new Set(playerIds.filter(Boolean))];
  if (ids.length === 0) return out;
  const list = ids.join(',');
  const { data, error } = await supabase
    .from('matches')
    .select('winner_id, winner_id_2, loser_id, loser_id_2')
    .eq('status', 'validated')
    .or(`winner_id.in.(${list}),winner_id_2.in.(${list}),loser_id.in.(${list}),loser_id_2.in.(${list})`);
  if (error) { console.warn('[playerStats] fetchPlayersTotals', error); return out; }
  const rows = (data ?? []) as MatchSides[];
  for (const id of ids) out.set(id, totalsFromMatches(rows, id));
  return out;
}

/** Totaux d'un seul joueur. */
export async function fetchPlayerTotals(playerId: string): Promise<PlayerTotals> {
  const m = await fetchPlayersTotals([playerId]);
  return m.get(playerId) ?? EMPTY_TOTALS;
}
