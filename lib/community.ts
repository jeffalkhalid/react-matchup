// Couche données "Communauté & flux sociaux".
// S'appuie sur la migration supabase/migrations/community_social.sql
// (follows, activity_events, game_alerts, parrainage, RPC réactions, matching).

import { supabase } from './supabase';
import { notifyPlayers } from './notify';
import { getLeague, eloToLevel } from './theme';
import type {
  Player, SocialPlayer, ActivityEvent, GameAlert, ReferralStats, League, ActivityComment,
} from '../types';

// Base des liens de partage. Cible actuelle : le web app (Vercel).
// 🔜 Bascule prévue vers `https://pagmatch.com` (domaine de partage de l'app,
//    custom domain Vercel sur matchup_padel) → UNE seule ligne à changer ici,
//    tous les liens de partage passent par cette constante.
export const SHARE_BASE = 'https://matchup-padel.vercel.app';
// Libellé de marque affiché en watermark des stories (décoratif).
export const SHARE_LABEL = 'pagmatch.com';
export const REFERRAL_GOAL = 3; // 3 amis parrainés = Trophée Parrain

// ─── Hydratation joueur → SocialPlayer ───────────────────────
function toSocial(p: Player, following: boolean, extra?: Partial<SocialPlayer>): SocialPlayer {
  return {
    ...p,
    league: getLeague(p.elo_score) as League,
    level: eloToLevel(p.elo_score),
    following,
    ...extra,
  };
}

// ─── Suivis (mes amis) ───────────────────────────────────────

// Ids des joueurs que JE suis.
export async function getFollowingIds(myId: string): Promise<string[]> {
  const { data } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', myId);
  return (data ?? []).map((r: any) => r.following_id);
}

// Compte d'amis en commun pour une liste de candidats (1 requête).
// mutual(C) = nb de joueurs suivis à la fois par MOI et par C.
async function mutualCounts(myId: string, candidateIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (candidateIds.length === 0) return out;
  const myFollowing = await getFollowingIds(myId);
  if (myFollowing.length === 0) return out;
  const { data } = await supabase
    .from('follows')
    .select('follower_id, following_id')
    .in('follower_id', candidateIds)
    .in('following_id', myFollowing);
  (data ?? []).forEach((r: any) => out.set(r.follower_id, (out.get(r.follower_id) ?? 0) + 1));
  return out;
}

// Mes amis (ceux que je suis), avec compteur d'amis en commun.
export async function getFriends(myId: string): Promise<SocialPlayer[]> {
  const ids = await getFollowingIds(myId);
  if (ids.length === 0) return [];
  const { data: players } = await supabase.from('players').select('*').in('id', ids);
  const mutual = await mutualCounts(myId, ids);
  return (players ?? []).map((p: any) =>
    toSocial(p, true, { mutual: mutual.get(p.id) ?? 0 }));
}

// Suggestions : amis d'amis (non suivis) classés par amis en commun,
// complétés par des joueurs du même club, puis du même niveau.
export async function getSuggestions(me: Player, limit = 8): Promise<SocialPlayer[]> {
  const myId = me.id;
  const myFollowing = await getFollowingIds(myId);
  const exclude = new Set<string>([myId, ...myFollowing]);

  // Amis d'amis
  let fof: string[] = [];
  if (myFollowing.length > 0) {
    const { data } = await supabase
      .from('follows')
      .select('following_id')
      .in('follower_id', myFollowing);
    fof = [...new Set((data ?? []).map((r: any) => r.following_id))].filter(id => !exclude.has(id));
  }

  const candidateIds = new Set<string>(fof);

  // Compléter avec des joueurs du même club
  if (candidateIds.size < limit && me.clubs && me.clubs.length > 0) {
    const { data } = await supabase
      .from('players')
      .select('id')
      .is('deleted_at', null)
      .overlaps('clubs', me.clubs)
      .limit(limit * 2);
    (data ?? []).forEach((r: any) => { if (!exclude.has(r.id)) candidateIds.add(r.id); });
  }

  // Compléter avec des joueurs de niveau proche
  if (candidateIds.size < limit) {
    const { data } = await supabase
      .from('players')
      .select('id, elo_score')
      .is('deleted_at', null)
      .gte('elo_score', me.elo_score - 150)
      .lte('elo_score', me.elo_score + 150)
      .limit(limit * 2);
    (data ?? []).forEach((r: any) => { if (!exclude.has(r.id)) candidateIds.add(r.id); });
  }

  const list = [...candidateIds].slice(0, limit * 2);
  if (list.length === 0) return [];

  const [{ data: players }, mutual] = await Promise.all([
    supabase.from('players').select('*').in('id', list),
    mutualCounts(myId, list),
  ]);

  const myClubs = new Set(me.clubs ?? []);
  const sugg = (players ?? []).map((p: any) => {
    const m = mutual.get(p.id) ?? 0;
    const sharedClub = (p.clubs ?? []).find((c: string) => myClubs.has(c));
    const reason = m > 0
      ? `${m} ami${m > 1 ? 's' : ''} en commun`
      : sharedClub
        ? `Joue à ${sharedClub}`
        : 'Niveau proche du tien';
    return toSocial(p, false, { mutual: m, reason });
  });

  sugg.sort((a, b) => (b.mutual ?? 0) - (a.mutual ?? 0));
  return sugg.slice(0, limit);
}

// Recherche de joueurs par nom (≥ 3 lettres côté écran).
export async function searchPlayers(myId: string, q: string): Promise<SocialPlayer[]> {
  const term = q.trim();
  if (term.length < 1) return [];
  const [{ data: players }, myFollowing] = await Promise.all([
    supabase.from('players').select('*').is('deleted_at', null).ilike('name', `%${term}%`).neq('id', myId).limit(30),
    getFollowingIds(myId),
  ]);
  const followingSet = new Set(myFollowing);
  return (players ?? []).map((p: any) => toSocial(p, followingSet.has(p.id)));
}

// Suivre / ne plus suivre.
export async function setFollow(myId: string, targetId: string, follow: boolean): Promise<void> {
  if (follow) {
    await supabase.from('follows').upsert(
      { follower_id: myId, following_id: targetId },
      { onConflict: 'follower_id,following_id' },
    );
  } else {
    await supabase.from('follows').delete()
      .eq('follower_id', myId).eq('following_id', targetId);
  }
}

// ─── Fil d'activité ──────────────────────────────────────────

// Fil des amis (+ soi). Hydrate l'acteur, la ligue et le nb de commentaires.
export async function getActivityFeed(myId: string, limit = 50): Promise<ActivityEvent[]> {
  const following = await getFollowingIds(myId);
  const authorIds = [...new Set([myId, ...following])];

  const { data: events } = await supabase
    .from('activity_events')
    .select('*')
    .in('player_id', authorIds)
    .order('created_at', { ascending: false })
    .limit(limit);

  const list = (events ?? []) as ActivityEvent[];
  if (list.length === 0) return [];

  const actorIds = [...new Set(list.map(e => e.player_id))];
  const eventIds = list.map(e => e.id);

  const [{ data: actors }, { data: comments }] = await Promise.all([
    supabase.from('players').select('id, name, elo_score').in('id', actorIds),
    supabase.from('activity_comments').select('event_id').in('event_id', eventIds),
  ]);

  const actorById = new Map((actors ?? []).map((a: any) => [a.id, a]));
  const commentCount = new Map<string, number>();
  (comments ?? []).forEach((c: any) =>
    commentCount.set(c.event_id, (commentCount.get(c.event_id) ?? 0) + 1));

  return list.map(e => {
    const actor: any = actorById.get(e.player_id);
    return {
      ...e,
      reactions: e.reactions ?? {},
      actor,
      league: actor ? (getLeague(actor.elo_score) as League) : 'discovery',
      comment_count: commentCount.get(e.id) ?? 0,
    };
  });
}

// Fil d'activité d'UN joueur (pour sa page profil). Même hydratation que getActivityFeed.
export async function getPlayerActivity(playerId: string, limit = 20): Promise<ActivityEvent[]> {
  const { data: events } = await supabase
    .from('activity_events')
    .select('*')
    .eq('player_id', playerId)
    .order('created_at', { ascending: false })
    .limit(limit);

  const list = (events ?? []) as ActivityEvent[];
  if (list.length === 0) return [];

  const eventIds = list.map(e => e.id);
  const [{ data: actor }, { data: comments }] = await Promise.all([
    supabase.from('players').select('id, name, elo_score').eq('id', playerId).single(),
    supabase.from('activity_comments').select('event_id').in('event_id', eventIds),
  ]);

  const commentCount = new Map<string, number>();
  (comments ?? []).forEach((c: any) =>
    commentCount.set(c.event_id, (commentCount.get(c.event_id) ?? 0) + 1));

  const a: any = actor;
  const league = a ? (getLeague(a.elo_score) as League) : 'discovery';
  return list.map(e => ({
    ...e,
    reactions: e.reactions ?? {},
    actor: a,
    league,
    comment_count: commentCount.get(e.id) ?? 0,
  }));
}

// Toggle réaction 🔥 (RPC SECURITY DEFINER). Renvoie l'event mis à jour.
export async function toggleReaction(eventId: string, emoji = '🔥'): Promise<Record<string, string[]> | null> {
  const { data, error } = await supabase.rpc('toggle_activity_reaction', {
    p_event_id: eventId, p_emoji: emoji,
  });
  if (error) { console.log('[toggleReaction]', error.message); return null; }
  return (data?.reactions ?? {}) as Record<string, string[]>;
}

// ─── Commentaires d'activité ─────────────────────────────────

export type AddCommentResult =
  | { ok: true; comment: ActivityComment }
  | { ok: false; reason: 'policy' | 'blocked' | 'rate' | 'length' | 'unknown' };

function mapCommentError(message: string): AddCommentResult {
  const m = (message || '').toLowerCase();
  if (m.includes('disabled') || m.includes('not allowed')) return { ok: false, reason: 'policy' };
  if (m.includes('blocked')) return { ok: false, reason: 'blocked' };
  if (m.includes('rate')) return { ok: false, reason: 'rate' };
  if (m.includes('length')) return { ok: false, reason: 'length' };
  return { ok: false, reason: 'unknown' };
}

// Commentaires d'un événement (triés du plus ancien au plus récent), acteur hydraté.
export async function getComments(eventId: string): Promise<ActivityComment[]> {
  const { data: rows } = await supabase
    .from('activity_comments')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });

  const list = (rows ?? []) as ActivityComment[];
  if (list.length === 0) return [];

  const actorIds = [...new Set(list.map(c => c.player_id))];
  const { data: actors } = await supabase
    .from('players').select('id, name, elo_score').in('id', actorIds);
  const actorById = new Map((actors ?? []).map((a: any) => [a.id, a]));

  return list.map(c => {
    const actor: any = actorById.get(c.player_id);
    return {
      ...c,
      reactions: c.reactions ?? {},
      actor,
      league: actor ? (getLeague(actor.elo_score) as League) : 'discovery',
    };
  });
}

// Ajoute un commentaire via l'RPC sécurisée. Notifie l'auteur du post (sauf soi-même).
export async function addComment(eventId: string, content: string, me: Player): Promise<AddCommentResult> {
  const { data, error } = await supabase.rpc('add_activity_comment', {
    p_event_id: eventId, p_content: content,
  });
  if (error) { console.log('[addComment]', error.message); return mapCommentError(error.message); }

  const row = data as ActivityComment;
  const comment: ActivityComment = {
    ...row,
    reactions: row.reactions ?? {},
    actor: { id: me.id, name: me.name, elo_score: me.elo_score },
    league: getLeague(me.elo_score) as League,
  };

  // Notif auteur (fire-and-forget)
  const { data: ev } = await supabase
    .from('activity_events').select('player_id').eq('id', eventId).single();
  const authorId = (ev as any)?.player_id as string | undefined;
  if (authorId && authorId !== me.id) {
    notifyPlayers({
      playerIds: [authorId],
      title: `${me.name} a commenté ton activité`,
      body: content.slice(0, 80),
      data: { type: 'activity', eventId },
    });
  }

  return { ok: true, comment };
}

export async function deleteComment(id: string): Promise<void> {
  await supabase.from('activity_comments').delete().eq('id', id);
}

// Toggle réaction 🔥 sur un commentaire (RPC SECURITY DEFINER). Renvoie les réactions à jour.
export async function toggleCommentReaction(commentId: string, emoji = '🔥'): Promise<Record<string, string[]> | null> {
  const { data, error } = await supabase.rpc('toggle_comment_reaction', {
    p_comment_id: commentId, p_emoji: emoji,
  });
  if (error) { console.log('[toggleCommentReaction]', error.message); return null; }
  return (data?.reactions ?? {}) as Record<string, string[]>;
}

// ─── Alertes ─────────────────────────────────────────────────

export async function getAlerts(myId: string): Promise<GameAlert[]> {
  const { data } = await supabase
    .from('game_alerts')
    .select('*')
    .eq('player_id', myId)
    .order('created_at', { ascending: false });
  return (data ?? []) as GameAlert[];
}

export type AlertInput = Omit<GameAlert, 'id' | 'player_id' | 'created_at' | 'updated_at'>;

export async function createAlert(myId: string, input: AlertInput): Promise<GameAlert | null> {
  const { data, error } = await supabase
    .from('game_alerts')
    .insert({ ...input, player_id: myId })
    .select('*')
    .single();
  if (error) { console.log('[createAlert]', error.message); return null; }
  return data as GameAlert;
}

export async function setAlertActive(id: string, active: boolean): Promise<void> {
  await supabase.from('game_alerts')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', id);
}

export async function deleteAlert(id: string): Promise<void> {
  await supabase.from('game_alerts').delete().eq('id', id);
}

// ─── Parrainage ──────────────────────────────────────────────

export async function getReferralStats(player: Player): Promise<ReferralStats> {
  const code = (player as any).referral_code ?? player.id.slice(0, 8);
  const { count } = await supabase
    .from('players')
    .select('id', { count: 'exact', head: true })
    .eq('referred_by', player.id);
  return { code, joined: count ?? 0, goal: REFERRAL_GOAL };
}

export function referralLink(code: string): string {
  return `${SHARE_BASE}/u/${code}`;
}

export function referralQRValue(code: string): string {
  return `${SHARE_BASE}/u/${code}?ref=invite`;
}

// Lien de partage d'une partie ouverte (route /lobby du web app).
export function lobbyGameLink(gameId: string): string {
  return `${SHARE_BASE}/lobby?game=${gameId}`;
}

// QR/lien d'une fiche joueur partagée en story (route /player du web app).
export function playerStoryLink(playerId: string): string {
  return `${SHARE_BASE}/player/${playerId}?ref=story`;
}

// ─── Matching alertes → push ─────────────────────────────────
// À appeler juste après la création d'une partie (open_games) pour pousser
// une notif aux joueurs dont une alerte correspond. Fire-and-forget.
export async function notifyMatchingAlerts(gameId: string, location?: string): Promise<void> {
  try {
    const { data, error } = await supabase.rpc('find_matching_alerts', { p_game_id: gameId });
    if (error) { console.log('[notifyMatchingAlerts]', error.message); return; }
    const targets = (data ?? []).filter((r: any) => r.push_on).map((r: any) => r.player_id);
    if (targets.length === 0) return;
    await notifyPlayers({
      playerIds: targets,
      title: 'Une partie pour toi',
      body: location ? `Nouvelle partie à ${location} correspond à ton alerte.` : 'Une nouvelle partie correspond à ton alerte.',
      data: { type: 'application', gameId },
    });
  } catch (e) {
    console.log('[notifyMatchingAlerts] threw', String(e));
  }
}
