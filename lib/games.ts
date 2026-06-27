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

// Fenêtre de saisie de score : une partie jouée reste « à scorer » 48 h.
export const SCORE_WINDOW_MS = 48 * 60 * 60 * 1000;

// Délai avant ouverture de la saisie : on attend 1 h 30 après l'heure de DÉBUT
// (durée d'un match) pour que la partie soit terminée avant de proposer le score.
export const SCORE_OPEN_DELAY_MS = 90 * 60 * 1000;

// ─── Source de vérité UNIQUE : « cette partie est-elle À SCORER par moi ? » ──
// Partagée par le badge (useNotificationCount), la liste de notifications, le
// lobby (historique) ET l'écran score-entry — qui jusqu'ici se synchronisaient
// « à la main » (cf. l'ancien commentaire suppliant dans score-entry). Critères :
//   • partie terminée : match_date + 1 h 30 passée (le temps de jouer) mais < 48 h ;
//   • complète : 4 vrais joueurs ACCEPTÉS (créateur inclus). Occupation DÉRIVÉE
//     des participants — JAMAIS du compteur `spots_available` (dénormalisé, sujet
//     au drift : un match plein avec compteur ≠ 0 n'était scoré nulle part) ;
//   • ni close ni annulée ;
//   • pas déjà scorée (`scoredGameIds`) ;
//   • j'y participe (créateur ou accepté).
export function isGameReadyToScore(
  game: {
    id?: string | null;
    match_date?: string | null;
    status?: string | null;
    creator_id: string;
    participants?: { player_id: string; status: string }[] | null;
  },
  playerId: string,
  scoredGameIds: Set<string>,
): boolean {
  if (!game.match_date) return false;
  const t = new Date(game.match_date).getTime();
  const now = Date.now();
  // Ouvre 1 h 30 après le DÉBUT (match supposé fini), ferme 48 h après le début.
  if (t + SCORE_OPEN_DELAY_MS > now || t < now - SCORE_WINDOW_MS) return false;
  if (game.status === 'closed' || game.status === 'cancelled') return false;
  if (game.id && scoredGameIds.has(game.id)) return false;
  const accepted = (game.participants ?? []).filter(p => p.status === 'accepted');
  const isCreator = game.creator_id === playerId;
  if (!isCreator && !accepted.some(p => p.player_id === playerId)) return false;
  const creatorAccepted = accepted.some(p => p.player_id === game.creator_id);
  const total = accepted.length + (creatorAccepted ? 0 : 1);
  return total >= 4;
}

// ─── Source de vérité UNIQUE : « cette invitation à une partie est-elle encore
// visible/actionnable ? » ────────────────────────────────────────────────────
// Partagée par la liste de notifications (Source A) et le compteur de badge,
// pour qu'ils affichent EXACTEMENT le même ensemble (cf. le même principe que
// `isReceivedChallengeVisible` côté défis). Pré-requis : l'appelant a déjà
// filtré côté requête `status='invited'`. Reste à vérifier ici :
//   • l'invitation est encore vivante (`isInviteActive` : TTL non dépassé — le
//     cron de bascule 'invited'→'expired' peut avoir jusqu'à 10 min de retard) ;
//   • anti-doublon : si un défi couvre déjà cette partie, c'est lui qui porte la
//     notif (route Matchmaking) — on n'affiche pas l'invitation en double ;
//   • la partie n'est ni close/annulée ni déjà passée.
export function isInvitationVisible(
  inv: {
    invite_expires_at?: string | null;
    game_id?: string | null;
    game?: { id?: string | null; status?: string | null; match_date?: string | null } | null;
  },
  challengeGameIds: Set<string>,
): boolean {
  const g = inv.game;
  if (!g) return false;
  if (!isInviteActive({ status: 'invited', invite_expires_at: inv.invite_expires_at })) return false;
  const gameId = g.id ?? inv.game_id;
  if (gameId && challengeGameIds.has(gameId)) return false;
  if (g.status === 'closed' || g.status === 'cancelled') return false;
  if (g.match_date && new Date(g.match_date).getTime() < Date.now()) return false;
  return true;
}

/** Vrai si l'erreur vient du trigger DB `eject_overlapping_candidatures` :
 *  le joueur organise déjà un autre match dans la fenêtre ±2h. Levé aussi bien
 *  en candidature (join_game) qu'en acceptation directe d'une invitation/défi. */
export function isCreatorConflict(error: unknown): boolean {
  const msg = (error as { message?: string } | null)?.message;
  return typeof msg === 'string' && msg.includes('CREATOR_CONFLICT');
}

export async function joinGame(
  gameId: string,
  side?: string,
  joinWaitlist = false,
  note?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('join_game', {
    p_game_id: gameId,
    p_side: side ?? null,
    p_join_waitlist: joinWaitlist,
    p_note: note ?? null,
  });
  if (error) throw error;
  return data as string; // 'accepted' | 'pending' | 'waitlist'
}

export async function withdrawInvitation(gameId: string, playerId: string): Promise<void> {
  const { error } = await supabase.rpc('withdraw_invitation', { p_game_id: gameId, p_player_id: playerId });
  if (error) throw error;
}

/** Places libres au padel (4 places), dérivées des participants vivants —
 *  jamais du compteur stocké spots_available (qui peut dériver). Repli sur le
 *  compteur si les participants ne sont pas chargés. */
export function freeSpots(game: {
  creator_id: string;
  spots_available?: number | null;
  participants?: { player_id: string; status: string; invite_expires_at?: string | null }[] | null;
}): number {
  if (!game.participants) return game.spots_available ?? 0;
  const occupied = 1 + game.participants.filter(
    p => occupiesSpot(p) && p.player_id !== game.creator_id,
  ).length;
  return Math.max(0, 4 - occupied);
}
