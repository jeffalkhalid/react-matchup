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

// ─── Source de vérité UNIQUE : « suis-je CONFIRMÉ dans cette partie ? » ──────
// (créateur ou participant accepté — les candidatures pending/waitlist et les
// invitations reçues n'en font PAS partie). Définit ce que comptent les badges
// « À venir » de l'accueil ET du lobby, même si le match n'est pas complet.
// Côté accueil la restriction équivalente est faite dans la requête (creator_id
// OU participation accepted) — garder les deux alignés sur cette définition.
export function isConfirmedInGame(
  game: {
    creator_id?: string | null;
    is_creator?: boolean;
    my_status?: string | null;
    participants?: { player_id: string; status: string }[] | null;
  },
  playerId: string,
): boolean {
  if (game.is_creator || game.creator_id === playerId) return true;
  if (game.my_status === 'accepted') return true;
  return (game.participants ?? []).some(p => p.player_id === playerId && p.status === 'accepted');
}

// ─── Source de vérité UNIQUE : « cette invitation à une partie est-elle encore
// visible/actionnable ? » ────────────────────────────────────────────────────
// Partagée par la liste de notifications (Source A) et le compteur de badge,
// pour qu'ils affichent EXACTEMENT le même ensemble. Pré-requis : l'appelant a
// déjà filtré côté requête `status='invited'`. Reste à vérifier ici :
//   • l'invitation est encore vivante (`isInviteActive` : TTL non dépassé — le
//     cron de bascule 'invited'→'expired' peut avoir jusqu'à 10 min de retard) ;
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

/** Invitations en cours (non expirées), hors créateur. */
export function pendingInviteCount(game: {
  creator_id: string;
  participants?: { player_id: string; status: string; invite_expires_at?: string | null }[] | null;
}): number {
  return (game.participants ?? []).filter(
    p => isInviteActive(p) && p.player_id !== game.creator_id,
  ).length;
}

// ─── Source de vérité UNIQUE : libellé des places d'une partie ───────────────
// (messages de partage + cartes + fiche détail). Une place tenue par une
// invitation EN COURS bloque la jonction (anti-overbooking) mais n'est JAMAIS
// annoncée « Complet » : l'invité peut refuser. On affiche « en attente de
// réponse » tant que les 4 joueurs ne sont pas tous confirmés.
export function spotsLabel(game: {
  creator_id: string;
  spots_available?: number | null;
  participants?: { player_id: string; status: string; invite_expires_at?: string | null }[] | null;
}): string {
  const free = freeSpots(game);
  if (free > 0) return `${free} place${free > 1 ? 's' : ''} dispo`;
  const pending = pendingInviteCount(game);
  if (pending > 0) return `${pending} place${pending > 1 ? 's' : ''} en attente de réponse`;
  return 'Complet';
}

// ─── Source de vérité UNIQUE : fourchette de niveau affichable ───────────────
// (cartes lobby + fiche détail + messages de partage). Défi CIBLÉ : min/max_elo
// sont null (aucune contrainte d'accès) — un fallback 0/1750 afficherait un faux
// « 1.0 – 6.0 ». On dérive alors la fourchette des ELO réels de TOUS les
// occupants du match (créateur + acceptés + invités non expirés, cf.
// occupiesSpot) : les invités d'un défi ciblé SONT le match — les exclure
// donnait une fourchette absurde (ex. « 5.03 - 5.04 » sur 2 confirmés alors
// que les invités vont de 4.14 à 4.74). null = vraiment rien à afficher.
export function gameEloRange(game: {
  creator_id: string;
  min_elo?: number | null; max_elo?: number | null;
  creator?: { elo_score?: number | null } | null;
  participants?: { player_id: string; status: string; invite_expires_at?: string | null; player?: { elo_score?: number | null } | null }[] | null;
}): { min: number; max: number; derived: boolean } | null {
  if (game.min_elo != null || game.max_elo != null) {
    return { min: game.min_elo ?? 0, max: game.max_elo ?? 9999, derived: false };
  }
  const elos: number[] = [];
  const creatorElo = game.creator?.elo_score;
  if (typeof creatorElo === 'number') elos.push(creatorElo);
  for (const p of game.participants ?? []) {
    if (!occupiesSpot(p) || p.player_id === game.creator_id) continue;
    const e = p.player?.elo_score;
    if (typeof e === 'number') elos.push(e);
  }
  if (elos.length === 0) return null;
  return { min: Math.min(...elos), max: Math.max(...elos), derived: true };
}

// ─── Le filtre « Urgent » de l'Explorer ──────────────────────────────────────
//
// Une partie est urgente quand IL MANQUE UNE PERSONNE et que ça se joue
// bientôt. Deux conditions, et rien d'autre.
//
// POURQUOI CE PRÉDICAT VIT ICI : il était écrit DEUX FOIS dans lobby.tsx — une
// fois pour la liste, une fois pour le compteur de la pastille — alors que le
// commentaire au-dessus de la fonction de filtrage affirmait le contraire
// (« factorisé pour que le badge ET la liste utilisent EXACTEMENT la même
// logique »). Les deux copies étaient identiques, donc rien ne se voyait. Le
// jour où l'une change, la pastille annonce un nombre que la liste ne montre
// pas — sans erreur, sans alerte.

/** La fenêtre au-delà de laquelle une partie n'est plus « urgente ». */
export const URGENT_WINDOW_MINUTES = 6 * 60;

/** Minutes jusqu'au coup d'envoi. Négatif si c'est déjà commencé. */
export function minutesUntil(iso: string, now: Date = new Date()): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Number.NaN;
  return (t - now.getTime()) / 60_000;
}

/**
 * Cette partie est-elle urgente ?
 *
 * EXACTEMENT une place libre : à deux places manquantes, la partie n'est pas à
 * un message de se compléter, elle est à deux — ce n'est plus le même geste.
 *
 * LE COMPTE SE FAIT EN MINUTES, et c'est le correctif. Il se faisait en heures
 * ARRONDIES : une partie dans 20 minutes donnait « 0 heure », la condition
 * exigeait « plus de 0 », et la partie disparaissait du filtre — au moment
 * précis où elle était la plus urgente. Tout ce qui commençait dans moins de
 * trente minutes tombait dans ce trou.
 *
 * Une partie sans date n'est jamais urgente : rien ne presse tant qu'aucune
 * heure n'est fixée.
 */
export function isUrgentGame(
  game: Parameters<typeof freeSpots>[0] & { match_date?: string | null },
  now: Date = new Date(),
): boolean {
  if (freeSpots(game) !== 1) return false;
  if (!game.match_date) return false;
  const m = minutesUntil(game.match_date, now);
  if (Number.isNaN(m)) return false;
  return m > 0 && m <= URGENT_WINDOW_MINUTES;
}

/**
 * Le délai affiché sur la pastille urgente : « 20 min », « 2 h ».
 *
 * L'ancienne carte affichait `{hoursUntil()}h`, donc « 🔥 0h » pour une partie
 * dans vingt minutes — la plus pressante de toutes annonçait zéro. En dessous
 * d'une heure on compte en minutes, au-dessus en heures pleines.
 */
export function urgentDelayLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const m = minutesUntil(iso, now);
  if (Number.isNaN(m) || m <= 0) return '';
  if (m < 60) return `${Math.max(1, Math.round(m))} min`;
  return `${Math.floor(m / 60)} h`;
}
