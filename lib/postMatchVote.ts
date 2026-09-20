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
 * Le joueur sur qui porte la question « qu'est-ce qu'il a fait de mieux ? ».
 *
 * L'ADVERSAIRE d'abord, mon binôme ensuite. L'ordre brut [vainqueur,
 * vainqueur_2, perdant, perdant_2] mettait en avant mon propre coéquipier dès
 * que j'étais vainqueur_1 : la question portait alors sur quelqu'un qu'on ne
 * nommait pas, dans une carte qui montre les quatre joueurs. On juge d'abord
 * celui d'en face — et dans tous les cas la carte écrit son nom.
 */
export function featuredReceiver(
  match: Pick<Match, 'winner' | 'winner_2' | 'loser' | 'loser_2'>,
  myId: string,
): Player | null {
  const vainqueurs = [match.winner, match.winner_2];
  const perdants = [match.loser, match.loser_2];
  const jeSuisVainqueur = vainqueurs.some(p => p?.id === myId);
  const jeSuisPerdant = perdants.some(p => p?.id === myId);
  const adversaires = jeSuisVainqueur ? perdants : jeSuisPerdant ? vainqueurs : [];
  const monCamp = jeSuisVainqueur ? vainqueurs : jeSuisPerdant ? perdants : [];
  // Le dernier bloc ne sert que si je ne suis pas dans ce match : on rend
  // alors le premier joueur identifiable plutôt que rien.
  for (const p of [...adversaires, ...monCamp, ...vainqueurs, ...perdants]) {
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
