import { supabase } from './supabase';

/** Vrai uniquement pour une invitation (status='invited') non expirée. */
export function isInviteActive(p: { status: string; invite_expires_at?: string | null }): boolean {
  if (p.status !== 'invited') return false;
  if (!p.invite_expires_at) return true;
  return new Date(p.invite_expires_at).getTime() > Date.now();
}

/** Occupant vivant d'une place = accepté, ou invité non expiré. */
export function occupiesSpot(p: { status: string; invite_expires_at?: string | null }): boolean {
  return p.status === 'accepted' || isInviteActive(p);
}

export async function joinGame(gameId: string, side?: string, joinWaitlist = false): Promise<string> {
  const { data, error } = await supabase.rpc('join_game', {
    p_game_id: gameId, p_side: side ?? null, p_join_waitlist: joinWaitlist,
  });
  if (error) throw error;
  return data as string; // 'accepted' | 'pending' | 'waitlist'
}

export async function withdrawInvitation(gameId: string, playerId: string): Promise<void> {
  const { error } = await supabase.rpc('withdraw_invitation', { p_game_id: gameId, p_player_id: playerId });
  if (error) throw error;
}
