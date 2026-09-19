// lib/postMatchVote.ts — remonte le vote d'après-match dans le hub Activité
// (carte « Ton match d'hier »), étape 1.
//
// AUCUN nouveau circuit : on relit le même vivier que la modale de vote de
// l'accueil (app/(tabs)/index.tsx) — matchs des dernières 48 h non encore
// votés/passés — et on écrit dans `reputation_votes` / `badge_prompt_skips`,
// exactement comme elle. Seule différence : la carte du hub ne propose
// qu'UN seul destinataire à la fois (le plus pertinent, cf. `featuredReceiver`)
// alors que la modale de l'accueil les propose tous — un vote (même passé)
// marque le match comme traité pour les DEUX lecteurs, puisqu'ils partagent
// la même règle « déjà voté ce match ? » (giver_id + match_id).
import { supabase } from './supabase';
import { isBadgeVisible } from './badges';
import type { Match, Player } from '../types';

const VOTE_WINDOW_MS = 48 * 60 * 60 * 1000;

const MATCH_SELECT = [
  'id', 'score_text', 'status', 'created_at',
  'winner_id', 'winner_id_2', 'loser_id', 'loser_id_2',
  'game:game_id(location, match_date, creator_id)',
  'winner:winner_id(id, name, elo_score, avatar_path, gender)',
  'winner_2:winner_id_2(id, name, elo_score, avatar_path, gender)',
  'loser:loser_id(id, name, elo_score, avatar_path, gender)',
  'loser_2:loser_id_2(id, name, elo_score, avatar_path, gender)',
].join(', ');

/**
 * Le joueur mis en avant par la carte « Ton match d'hier » : le premier
 * autre joueur du match, dans l'ordre [vainqueur, vainqueur_2, perdant,
 * perdant_2] — le même ordre que la modale de vote de l'accueil, pour rester
 * cohérent avec elle. Ce n'est PAS toujours l'adversaire : si mon binôme
 * apparaît avant l'adversaire dans cet ordre (je suis vainqueur_1), c'est lui
 * qui est mis en avant — « qu'est-ce qu'il a fait de mieux ? » vaut aussi
 * bien pour un coéquipier que pour un adversaire.
 */
export function featuredReceiver(
  match: Pick<Match, 'winner' | 'winner_2' | 'loser' | 'loser_2'>,
  myId: string,
): Player | null {
  const candidates = [match.winner, match.winner_2, match.loser, match.loser_2];
  for (const p of candidates) {
    if (p && p.id !== myId) return p as Player;
  }
  return null;
}

/** Le match le plus récent qui attend encore un vote de ma part, ou `null`. */
export async function getPendingVoteMatch(playerId: string): Promise<Match | null> {
  try {
    const windowAgo = new Date(Date.now() - VOTE_WINDOW_MS).toISOString();
    const playerOr = [
      `winner_id.eq.${playerId}`, `loser_id.eq.${playerId}`,
      `winner_id_2.eq.${playerId}`, `loser_id_2.eq.${playerId}`,
    ].join(',');
    const [{ data: recentMatches }, { data: alreadyVoted }, { data: skips }] = await Promise.all([
      supabase.from('matches').select(MATCH_SELECT)
        .or(playerOr).in('status', ['pending', 'validated'])
        .gte('created_at', windowAgo).order('created_at', { ascending: false }).limit(10),
      supabase.from('reputation_votes').select('match_id').eq('giver_id', playerId),
      supabase.from('badge_prompt_skips').select('match_id').eq('player_id', playerId),
    ]);
    const done = new Set<string>([
      ...((alreadyVoted ?? []) as { match_id: string }[]).map(v => v.match_id),
      ...((skips ?? []) as { match_id: string }[]).map(s => s.match_id),
    ]);
    const pending = ((recentMatches ?? []) as unknown as Match[]).find(m => !done.has(m.id));
    return pending ?? null;
  } catch (e) {
    console.log('[postMatchVote] getPendingVoteMatch threw', String(e));
    return null;
  }
}

/** Envoie les badges choisis pour UN destinataire ; vide = passer ce match. */
export async function submitSingleVote(
  matchId: string, giverId: string, receiverId: string, badgeKeys: string[],
): Promise<void> {
  if (badgeKeys.length > 0) {
    const rows = badgeKeys.map(key => ({ match_id: matchId, giver_id: giverId, receiver_id: receiverId, badge_type: key }));
    await supabase.from('reputation_votes').insert(rows);
  } else {
    await supabase.from('badge_prompt_skips')
      .upsert({ player_id: giverId, match_id: matchId }, { onConflict: 'player_id,match_id' });
  }
}

/** Mes badges reçus les plus fréquents (état calme : « tuiles de réputation »). */
export async function getTopBadgeCounts(playerId: string, max = 3): Promise<{ key: string; count: number }[]> {
  try {
    const { data } = await supabase.from('reputation_votes').select('badge_type').eq('receiver_id', playerId);
    const counts = new Map<string, number>();
    for (const row of (data ?? []) as { badge_type: string }[]) {
      if (!isBadgeVisible(row.badge_type)) continue;
      counts.set(row.badge_type, (counts.get(row.badge_type) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([key, count]) => ({ key, count }));
  } catch {
    return [];
  }
}
