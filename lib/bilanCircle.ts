// lib/bilanCircle.ts — « Les bilans de ton cercle » (hub Activité).
//
// Le fil ne montre que les 14 derniers jours : un bilan publié il y a trois
// semaines en disparaît. Ce bloc va les chercher directement, sans limite de
// date, pour que les bilans des joueurs suivis restent consultables.
//
// Rien de nouveau en base : ce sont les mêmes `activity_events` de type
// 'bilan' que le fil, avec le recap rangé dans `payload.recap`.
import { supabase } from './supabase';
import { getFollowingIds } from './community';
import type { MonthlyRecap } from './bilan';

export interface CircleBilan {
  eventId: string;
  playerId: string;
  name: string;
  avatarPath: string | null;
  memberNumber: number | null;
  /** « AOÛT », tel que publié avec le bilan. */
  label: string;
  createdAt: string;
  /** Réactions du post (🔥), pour le lecteur plein écran. */
  reactions: Record<string, string[]>;
  recap: MonthlyRecap;
}

/** Le plus récent d'abord ; un seul bilan par joueur (le dernier publié). */
export function keepLatestPerPlayer(list: CircleBilan[]): CircleBilan[] {
  const vus = new Set<string>();
  const out: CircleBilan[] = [];
  for (const b of list) {
    if (vus.has(b.playerId)) continue;
    vus.add(b.playerId);
    out.push(b);
  }
  return out;
}

/**
 * Les bilans publiés par les joueurs que je suis (et le mien), sans limite de
 * date. Un bilan sans recap lisible est ignoré : il n'y aurait rien à ouvrir.
 */
export async function fetchCircleBilans(myId: string, limit = 12): Promise<CircleBilan[]> {
  const following = await getFollowingIds(myId);
  const ids = [...new Set([...following, myId])];
  if (ids.length === 0) return [];

  const { data: events, error } = await supabase
    .from('activity_events')
    .select('id, player_id, payload, reactions, created_at')
    .eq('type', 'bilan')
    .in('player_id', ids)
    .order('created_at', { ascending: false })
    .limit(limit * 2);
  if (error) { console.warn('[bilanCircle] events', error); return []; }

  const rows = (events ?? []) as { id: string; player_id: string; payload: any; reactions: Record<string, string[]> | null; created_at: string }[];
  const avecRecap = rows.filter(e => e.payload?.recap);
  if (avecRecap.length === 0) return [];

  const { data: joueurs } = await supabase
    .from('players')
    .select('id, name, avatar_path, member_number')
    .in('id', [...new Set(avecRecap.map(e => e.player_id))]);
  const parId = new Map((joueurs ?? []).map((p: any) => [p.id, p]));

  const list: CircleBilan[] = avecRecap.map(e => {
    const p = parId.get(e.player_id);
    return {
      eventId: e.id,
      playerId: e.player_id,
      name: p?.name ?? 'Joueur',
      avatarPath: p?.avatar_path ?? null,
      memberNumber: p?.member_number ?? null,
      label: String(e.payload?.label ?? e.payload?.recap?.label ?? ''),
      createdAt: e.created_at,
      reactions: e.reactions ?? {},
      recap: e.payload.recap as MonthlyRecap,
    };
  });
  return keepLatestPerPlayer(list).slice(0, limit);
}
