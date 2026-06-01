import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePlayer } from './usePlayer';

export interface GameChat {
  id: string;
  location: string;
  match_date: string;
  is_challenge: boolean;
  game_format: string | null;
  creator_id: string;
  creator: { name: string } | null;
  participants: Array<{ player_id: string; status: string; player: { name: string } | null }>;
  unread: number;
  last_message_at: string | null;
  archived: boolean;
}

// A chat is archived once the match score is VALIDATED, or the match is past by
// more than the grace window. A 24h grace keeps the chat active through the
// score accept/refuse flow (a pending score must NOT archive — that's exactly
// when players relaunch the discussion to settle the score).
export const ARCHIVE_GRACE_MS = 24 * 60 * 60 * 1000;

// Whether a match is past the active window (grace included). Shared with the
// tab badge so "active" means the same thing everywhere.
export function isMatchPast(matchDate: string | null | undefined): boolean {
  if (!matchDate) return false;
  return new Date(matchDate).getTime() + ARCHIVE_GRACE_MS < Date.now();
}

const GAME_SELECT =
  'id, location, match_date, is_challenge, game_format, creator_id, creator:creator_id(name), participants:game_participants(player_id, status, player:player_id(name))';

// WhatsApp-like order: unread first, then most recent activity (last message
// or match_date as fallback for chats with no messages yet).
export function sortGames<T extends { unread: number; last_message_at: string | null; match_date: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => {
    if (b.unread !== a.unread) return b.unread - a.unread;
    const aTs = new Date(a.last_message_at ?? a.match_date).getTime();
    const bTs = new Date(b.last_message_at ?? b.match_date).getTime();
    return bTs - aTs;
  });
}

/**
 * Loads the player's game chats (created + accepted) with unread counts and an
 * `archived` flag, and keeps unread/order live. Shared by the Chats tab and the
 * Archived screen so both stay in sync from a single source of truth.
 */
export function useGameChats() {
  const { player } = usePlayer();
  const [games, setGames] = useState<GameChat[]>([]);
  const [loading, setLoading] = useState(true);

  const loadGames = useCallback(async () => {
    if (!player) return;
    setLoading(true);

    // Games created by the player
    const { data: created } = await supabase
      .from('open_games').select(GAME_SELECT)
      .eq('creator_id', player.id).in('status', ['open', 'closed']);

    // Games where the player is an accepted participant
    const { data: joinedParts } = await supabase
      .from('game_participants').select('game_id')
      .eq('player_id', player.id).eq('status', 'accepted');
    const joinedIds = (joinedParts ?? []).map((j: any) => j.game_id);
    let joined: any[] = [];
    if (joinedIds.length > 0) {
      const { data } = await supabase
        .from('open_games').select(GAME_SELECT)
        .in('id', joinedIds).in('status', ['open', 'closed']).neq('creator_id', player.id);
      joined = data ?? [];
    }

    // Deduplicate
    const seen = new Set<string>();
    const all = [...(created ?? []), ...joined].filter(g => {
      if (seen.has(g.id)) return false;
      seen.add(g.id);
      return true;
    });

    const ids = all.map(g => g.id);

    // Games whose score is VALIDATED → archived. A pending score is left active
    // so the chat stays reachable during the accept/refuse-score flow.
    let scoredIds = new Set<string>();
    if (ids.length > 0) {
      const { data: scored } = await supabase
        .from('matches').select('game_id')
        .in('game_id', ids).eq('status', 'validated');
      scoredIds = new Set((scored ?? []).map((m: any) => m.game_id).filter(Boolean));
    }

    // Unread baselines
    const { data: reads } = await supabase
      .from('game_chat_reads').select('game_id, last_read_at').eq('player_id', player.id);
    const readMap = Object.fromEntries((reads ?? []).map((r: any) => [r.game_id, r.last_read_at]));

    const enriched: GameChat[] = await Promise.all(
      all.map(async (game) => {
        const lastRead = readMap[game.id] ?? '1970-01-01';
        const [{ count }, { data: latest }] = await Promise.all([
          supabase
            .from('messages').select('id', { count: 'exact', head: true })
            .eq('game_id', game.id).gt('created_at', lastRead)
            // Exclude my own messages — consistent with the tab badge.
            .neq('player_id', player.id),
          supabase
            .from('messages').select('created_at')
            .eq('game_id', game.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        ]);
        return {
          ...game,
          unread: count ?? 0,
          last_message_at: (latest as { created_at: string } | null)?.created_at ?? null,
          archived: scoredIds.has(game.id) || isMatchPast(game.match_date),
        };
      })
    );

    setGames(sortGames(enriched));
    setLoading(false);
  }, [player]);

  // Live updates: new messages bump unread + reorder, read receipts zero out.
  useEffect(() => {
    if (!player) return;
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const msgCh = supabase
      .channel(`chats-list-msgs:${player.id}:${suffix}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        const m = payload.new as { game_id: string; player_id: string; created_at: string } | null;
        if (!m) return;
        setGames(prev => {
          if (!prev.some(g => g.id === m.game_id)) return prev;
          return sortGames(prev.map(g => g.id !== m.game_id ? g : {
            ...g,
            last_message_at: m.created_at,
            unread: m.player_id === player.id ? g.unread : g.unread + 1,
          }));
        });
      })
      .subscribe();

    const readCh = supabase
      .channel(`chats-list-reads:${player.id}:${suffix}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_chat_reads', filter: `player_id=eq.${player.id}` }, payload => {
        const r = payload.new as { game_id: string } | null;
        if (!r?.game_id) return;
        setGames(prev => prev.some(g => g.id === r.game_id)
          ? sortGames(prev.map(g => g.id === r.game_id ? { ...g, unread: 0 } : g))
          : prev);
      })
      .subscribe();

    return () => { supabase.removeChannel(msgCh); supabase.removeChannel(readCh); };
  }, [player]);

  return { games, loading, loadGames };
}
