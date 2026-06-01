import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePlayer } from './usePlayer';

// Single source of truth for the notification bell total, shared by the Home
// hero bell and the Profile screen so both ALWAYS show the same number.
// Unread chat messages are intentionally NOT included here — they belong to the
// Chats tab badge, not the notifications.
export interface NotificationCounts {
  challenges: number;   // défis reçus
  toValidate: number;   // scores à valider (saisis par un adversaire)
  invitations: number;  // invitations à une partie
  toApprove: number;    // demandes de joueurs à valider (sur mes parties)
  trophies: number;     // trophées à distribuer
  toScore: number;      // matchs à scorer (saisir le score)
  total: number;
}

const EMPTY: NotificationCounts = { challenges: 0, toValidate: 0, invitations: 0, toApprove: 0, trophies: 0, toScore: 0, total: 0 };

export function useNotificationCount() {
  const { player } = usePlayer();
  const [counts, setCounts] = useState<NotificationCounts>(EMPTY);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!player) { setCounts(EMPTY); setLoading(false); return; }
    const id = player.id;
    const now = Date.now();
    const h48 = now - 48 * 60 * 60 * 1000;
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const playerOr = `winner_id.eq.${id},winner_id_2.eq.${id},loser_id.eq.${id},loser_id_2.eq.${id}`;

    // Game ids where I'm creator or accepted — needed for "à scorer".
    const [{ data: accParts }, { data: myCreated }] = await Promise.all([
      supabase.from('game_participants').select('game_id').eq('player_id', id).eq('status', 'accepted'),
      supabase.from('open_games').select('id').eq('creator_id', id).in('status', ['open', 'closed']),
    ]);
    const gameIds = [...new Set([
      ...(accParts ?? []).map((p: any) => p.game_id),
      ...(myCreated ?? []).map((g: any) => g.id),
    ])];

    const [
      { data: challengeRows },
      { data: pendingMatches },
      { data: invites },
      { data: recentMatches },
      { data: myVotes },
    ] = await Promise.all([
      supabase.from('challenges').select('game_id')
        .eq('challenged_id', id).eq('status', 'pending'),
      supabase.from('matches')
        .select('id, created_by, winner_id, winner_id_2, loser_id, loser_id_2, status')
        .or(playerOr).in('status', ['pending', 'counter_proposed']),
      supabase.from('game_participants')
        .select('id, game_id, game:game_id(status, match_date)').eq('player_id', id).eq('status', 'invited'),
      supabase.from('matches').select('id')
        .or(playerOr).in('status', ['pending', 'validated']).gte('created_at', sevenDaysAgo),
      supabase.from('reputation_votes').select('match_id').eq('giver_id', id),
    ]);

    // Scores à valider — mirror index.tsx visiblePending:
    //  • counter_proposed → it's the original author who responds
    //  • pending          → the opponents validate (not the author nor partner)
    const toValidate = (pendingMatches ?? []).filter((m: any) => {
      if (m.status === 'counter_proposed') return m.created_by === id;
      if (m.created_by === id) return false;
      const cb = m.created_by;
      if (
        (cb === m.winner_id   && m.winner_id_2 === id) ||
        (cb === m.winner_id_2 && m.winner_id   === id) ||
        (cb === m.loser_id    && m.loser_id_2  === id) ||
        (cb === m.loser_id_2  && m.loser_id    === id)
      ) return false;
      return true;
    }).length;

    // Anti-doublon : un défi crée à la fois une ligne `challenges` ET un
    // game_participants 'invited' sur la même partie. On exclut ces invitations
    // pour ne pas compter le défi deux fois (il est déjà dans `challenges`).
    const challengeGameIds = new Set((challengeRows ?? []).map((c: any) => c.game_id).filter(Boolean));

    // Active invitations (status='invited' on a non-past, non-cancelled game).
    const invitations = (invites ?? []).filter((inv: any) => {
      const g = inv.game;
      if (!g) return false;
      if (inv.game_id && challengeGameIds.has(inv.game_id)) return false;
      if (g.status === 'closed' || g.status === 'cancelled') return false;
      if (g.match_date && new Date(g.match_date).getTime() < now) return false;
      return true;
    }).length;

    // Trophées à distribuer — recent matches I haven't voted badges on.
    const votedIds = new Set((myVotes ?? []).map((v: any) => v.match_id));
    const trophies = (recentMatches ?? []).filter((m: any) => !votedIds.has(m.id)).length;

    // Matchs à scorer — mirror lobby.tsx readyToScore (full game, played < 48h, no score).
    // + Demandes à valider — candidatures 'pending' sur mes parties que je n'ai
    //   pas encore approuvées (miroir du push envoyé dans handleApply).
    let toScore = 0;
    let toApprove = 0;
    if (gameIds.length > 0) {
      const [{ data: scGames }, { data: scored }] = await Promise.all([
        supabase.from('open_games')
          .select('id, match_date, spots_available, status, creator_id, participants:game_participants(player_id, status, approvals)')
          .in('id', gameIds),
        supabase.from('matches').select('game_id').in('game_id', gameIds).in('status', ['pending', 'validated']),
      ]);
      const scoredSet = new Set((scored ?? []).map((m: any) => m.game_id).filter(Boolean));
      toScore = (scGames ?? []).filter((g: any) => {
        if (!g.match_date) return false;
        const t = new Date(g.match_date).getTime();
        if (t >= now || t < h48) return false;
        if (scoredSet.has(g.id)) return false;
        if (g.status === 'closed' || g.status === 'cancelled') return false;
        if (g.spots_available !== 0) return false;
        const isCreator = g.creator_id === id;
        const accepted = (g.participants ?? []).filter((p: any) => p.status === 'accepted');
        if (!isCreator && !accepted.some((p: any) => p.player_id === id)) return false;
        return 1 + accepted.length >= 4;
      }).length;

      toApprove = (scGames ?? []).reduce((acc: number, g: any) => {
        if (g.status === 'closed' || g.status === 'cancelled') return acc;
        if (g.match_date && new Date(g.match_date).getTime() < now) return acc;
        const pend = (g.participants ?? []).filter((p: any) =>
          p.status === 'pending' && p.player_id !== id && !(p.approvals ?? []).includes(id));
        return acc + pend.length;
      }, 0);
    }

    const challenges = (challengeRows ?? []).length;
    setCounts({
      challenges, toValidate, invitations, toApprove, trophies, toScore,
      total: challenges + toValidate + invitations + toApprove + trophies + toScore,
    });
    setLoading(false);
  }, [player]);

  useEffect(() => { reload(); }, [reload]);

  return { ...counts, loading, reload };
}
