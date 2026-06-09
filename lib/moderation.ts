// Couche données "Modération" — blocage d'utilisateurs + signalement de contenus.
// S'appuie sur la migration supabase/migrations/moderation.sql
// (tables user_blocks, content_reports + RLS).
//
// Convention alignée sur lib/community.ts : chaque fonction reçoit `myId`
// (= players.id du joueur courant), fourni par les écrans via usePlayer().

import { supabase } from './supabase';

export type ReportTargetType = 'message' | 'story' | 'activity' | 'comment' | 'player';

// ─── Blocage ─────────────────────────────────────────────────

/** Ids des joueurs QUE J'AI bloqués. */
export async function getBlockedByMe(myId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_blocks')
    .select('blocked_id')
    .eq('blocker_id', myId);
  if (error) throw error;
  return (data ?? []).map((r) => r.blocked_id as string);
}

/**
 * Ids de tous les joueurs à masquer dans les flux : ceux que j'ai bloqués
 * ET ceux qui m'ont bloqué (filtrage bidirectionnel).
 */
export async function getHiddenPlayerIds(myId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('user_blocks')
    .select('blocker_id, blocked_id')
    .or(`blocker_id.eq.${myId},blocked_id.eq.${myId}`);
  if (error) throw error;
  const ids = new Set<string>();
  for (const row of data ?? []) {
    const other = row.blocker_id === myId ? row.blocked_id : row.blocker_id;
    if (other) ids.add(other as string);
  }
  return ids;
}

export async function isBlocked(myId: string, targetId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_blocks')
    .select('blocked_id')
    .eq('blocker_id', myId)
    .eq('blocked_id', targetId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function blockUser(myId: string, targetId: string): Promise<void> {
  const { error } = await supabase
    .from('user_blocks')
    .upsert({ blocker_id: myId, blocked_id: targetId }, { onConflict: 'blocker_id,blocked_id' });
  if (error) throw error;
}

export async function unblockUser(myId: string, targetId: string): Promise<void> {
  const { error } = await supabase
    .from('user_blocks')
    .delete()
    .eq('blocker_id', myId)
    .eq('blocked_id', targetId);
  if (error) throw error;
}

// ─── Signalement ─────────────────────────────────────────────

export async function reportContent(input: {
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reportedPlayerId?: string | null;
  reason?: string | null;
}): Promise<void> {
  const { error } = await supabase.from('content_reports').insert({
    reporter_id: input.reporterId,
    target_type: input.targetType,
    target_id: input.targetId,
    reported_player_id: input.reportedPlayerId ?? null,
    reason: input.reason ?? null,
  });
  if (error) throw error;
}
