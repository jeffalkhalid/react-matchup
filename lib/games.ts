import { supabase } from './supabase';
import { eloToLevel } from './theme';

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
  if (error) throw new Error(joinErrorLabel(error.message));
  return data as string; // 'accepted' | 'pending' | 'waitlist'
}

/**
 * Les refus de `join_game`, en français.
 *
 * La RPC lève des messages techniques en anglais. Sans traduction, un joueur
 * qui tente une partie réservée lisait « gender not allowed » — un message
 * qui ne dit ni ce qui s'est passé, ni quoi faire.
 */
export function joinErrorLabel(raw: string | null | undefined): string {
  const m = (raw ?? '').toLowerCase();
  if (m.includes('gender not allowed')) {
    return 'Cette partie est réservée à un autre genre.';
  }
  if (m.includes('gender not set')) {
    return 'Renseigne ton genre dans ton profil pour rejoindre cette partie.';
  }
  if (m.includes('defi requires binome')) {
    return 'Un défi se relève à deux : passe par l’onglet Défi.';
  }
  if (m.includes('game not found')) {
    return 'Cette partie n’existe plus.';
  }
  if (m.includes('not authenticated')) {
    return 'Reconnecte-toi pour rejoindre une partie.';
  }
  return raw || 'La demande a échoué.';
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

/**
 * Le terrain est-il déjà réservé ? Réglé à la création (« J'ai une
 * réservation ») et jusqu'ici jamais affiché ensuite : les joueurs
 * découvraient sur place qu'il fallait encore réserver.
 *
 * `null` quand la partie ne le dit pas (créée avant le réglage) : mieux vaut
 * ne rien afficher que d'affirmer « à réserver » à tort.
 *
 * Source UNIQUE : la carte du lobby et la fiche du match lisent la même
 * règle, et le libellé reste court pour tenir sur la ligne de pastilles.
 */
export function courtBooking(game: { has_reservation?: boolean | null }): { booked: boolean; short: string; long: string } | null {
  const v = game?.has_reservation;
  if (v == null) return null;
  return v
    ? { booked: true,  short: 'Réservé',    long: 'Terrain réservé' }
    : { booked: false, short: 'À réserver', long: 'Terrain à réserver' };
}

/**
 * Le libellé de niveau d'une partie : « 3.1 – 4.1 », une seule valeur quand
 * les bornes se confondent, `null` sans fourchette connue.
 *
 * Source UNIQUE : la carte de partie du lobby et le panneau de la carte
 * l'affichent ; deux copies finiraient par annoncer deux niveaux différents.
 */
export function levelRangeLabel(game: Parameters<typeof gameEloRange>[0]): string | null {
  const r = gameEloRange(game);
  if (!r) return null;
  const bas = eloToLevel(r.min).toFixed(1);
  const haut = eloToLevel(r.max).toFixed(1);
  return bas === haut ? bas : `${bas} – ${haut}`;
}

// ─── Source de vérité UNIQUE : « dans ma fourchette de niveau » ─────────────
/**
 * Mon ELO est-il dans la fourchette DÉCLARÉE de cette partie ?
 *
 * Le lobby (`getEloFit`) et les suggestions de l'accueil (lib/homeSlot) s'en
 * servent. Avant, la règle vivait dans une fonction privée du lobby, utilisée
 * à quatre endroits : l'accueil en aurait fait une cinquième copie — et deux
 * copies d'une même règle finissent toujours par diverger (le filtre « Urgent »
 * en a eu trois, avec le même bug dans chacune).
 *
 * Bornes absentes = ouvert : `min_elo` nul vaut 0, `max_elo` nul vaut 9999,
 * exactement comme `getEloFit`. Une partie sans fourchette déclarée accepte
 * donc tout le monde.
 *
 * ⚠️ Ce n'est PAS `gameEloRange`, qui pour un défi ciblé DÉRIVE une fourchette
 * des joueurs présents, pour l'AFFICHAGE. L'accès se juge sur la fourchette
 * déclarée.
 */
export function eloFitsGame(
  game: { min_elo?: number | null; max_elo?: number | null },
  elo: number,
): boolean {
  const min = game.min_elo ?? 0;
  const max = game.max_elo ?? 9999;
  return elo >= min && elo <= max;
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
  game: Parameters<typeof freeSpots>[0] & { match_date?: string | null; is_challenge?: boolean | null },
  now: Date = new Date(),
): boolean {
  const libres = freeSpots(game);
  // UN DÉFI SE REJOINT À DEUX : il lui manque un binôme entier, soit DEUX
  // places, et c'est à un message de se compléter — exactement ce que la
  // pastille annonce. Avec la règle « exactement une place », un défi n'était
  // JAMAIS urgent (relevé sur téléphone le 2026-09-17 : défi dans 52 minutes,
  // aucune pastille). Une place seule ne doit pas exister dans un défi
  // (garde-fou serveur defi_no_lone_player.sql) ; si elle existe malgré tout,
  // la partie est bien à un joueur près : on la marque aussi.
  const attendu = game.is_challenge ? libres === 1 || libres === 2 : libres === 1;
  if (!attendu) return false;
  if (!game.match_date) return false;
  const m = minutesUntil(game.match_date, now);
  if (Number.isNaN(m)) return false;
  return m > 0 && m <= URGENT_WINDOW_MINUTES;
}

/**
 * La partie se joue-t-elle EN CE MOMENT ?
 *
 * Deux conditions, pas une : l'heure est passée (et de moins d'1 h 30), ET la
 * partie est COMPLÈTE. La pastille « EN COURS » ne regardait que l'heure : une
 * partie à qui il manquait un joueur s'affichait « en cours » alors que
 * personne ne pouvait jouer (relevé sur téléphone le 2026-09-17).
 */
export function isOngoingGame(
  game: Parameters<typeof freeSpots>[0] & { match_date?: string | null },
  now: Date = new Date(),
): boolean {
  if (!game.match_date) return false;
  const t = new Date(game.match_date).getTime();
  if (Number.isNaN(t)) return false;
  if (freeSpots(game) > 0) return false;
  return now.getTime() >= t && now.getTime() < t + SCORE_OPEN_DELAY_MS;
}

/**
 * Cette partie reste-t-elle dans « À venir » ?
 *
 * Avant l'heure : toujours. Après l'heure : seulement si elle est complète —
 * elle se joue, puis la saisie du score la reprend à +1 h 30. Une partie
 * incomplète dont l'heure est passée ne peut ni se jouer ni se noter : elle
 * quitte la liste tout de suite (décision utilisateur, 2026-09-17), au lieu de
 * s'y afficher « en cours » pendant 1 h 30 puis de disparaître sans un mot.
 */
export function staysInUpcoming(
  game: Parameters<typeof freeSpots>[0] & { match_date?: string | null },
  now: Date = new Date(),
): boolean {
  if (!game.match_date) return true;
  const t = new Date(game.match_date).getTime();
  if (Number.isNaN(t)) return true;
  if (now.getTime() < t) return true;
  return freeSpots(game) === 0 && now.getTime() < t + SCORE_OPEN_DELAY_MS;
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

/**
 * Ce que fait « Refuser » sur une invitation de l'onglet « À venir ».
 *
 * Une invitation retirée automatiquement (créneau pris ailleurs ±2h : status
 * 'declined' + auto_declined) est REPROPOSÉE par le lobby comme 'invited',
 * pour que le joueur puisse revenir. La refuser, c'est seulement effacer le
 * marqueur : elle devient un refus manuel, que le lobby cache. Sa place avait
 * déjà été rendue et l'organisateur déjà prévenu au retrait automatique.
 */
const JOURS_ABBR = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MOIS_ABBR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/**
 * Quand se joue une partie : « mar. 22 sept. · 20h30 ».
 *
 * Source unique du « quand » d'une partie dans les listes. Sans le
 * quantième, « mardi » peut être ce mardi ou celui d'après ; sans l'heure,
 * on ne sait pas si ça tombe pendant le travail.
 */
export function gameWhenLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const min = d.getMinutes();
  const heure = min ? `${d.getHours()}h${String(min).padStart(2, '0')}` : `${d.getHours()}h`;
  return `${JOURS_ABBR[d.getDay()]} ${d.getDate()} ${MOIS_ABBR[d.getMonth()]} · ${heure}`;
}

/**
 * Ce qu'on annonce avant de quitter une partie.
 *
 * « Ta place sera libérée » était vrai d'une partie ordinaire, faux d'un
 * défi. Un défi se joue par PAIRES : le serveur
 * (supabase/migrations/defi_leave_atomic.sql) retire les deux coéquipiers
 * d'un coup, et si c'est le partenaire du créateur qui s'en va, il supprime
 * le défi — le créateur ne peut pas jouer seul. Quatre personnes perdaient
 * leur match derrière une phrase qui parlait d'une seule place.
 *
 * `side` est le côté du terrain ('A…' ou 'B…') de celui qui part :
 *   • B = le binôme qui a relevé le défi → les deux partent, le défi rouvre ;
 *   • A = le partenaire du créateur      → le défi est supprimé.
 * Côté inconnu (anomalie de données), on annonce la conséquence la plus
 * lourde : mieux vaut faire hésiter à tort que détruire un match en silence.
 */
export function leaveGamePrompt(opts: {
  isChallenge?: boolean | null;
  /** Le statut de MA participation : 'accepted', 'waitlist', autre. */
  status?: string | null;
  side?: string | null;
  /** Le coéquipier nommé : l'autre du côté B, ou le créateur si je suis en A. */
  partnerName?: string | null;
}): { title: string; message: string } {
  if (opts.status === 'waitlist') {
    return { title: "Quitter la liste d'attente ?", message: 'Tu seras retiré de la liste.' };
  }
  if (opts.status !== 'accepted') {
    return { title: 'Retirer ta candidature ?', message: 'Ta demande sera annulée.' };
  }
  if (opts.isChallenge) {
    const cote = String(opts.side ?? '').trim().toUpperCase().charAt(0);
    if (cote === 'B') {
      const qui = opts.partnerName?.trim().split(/\s+/)[0] || 'ton binôme';
      return {
        title: 'Quitter ce défi ?',
        message: `Vous partez à deux : ${qui} perd sa place en même temps que toi.`,
      };
    }
    return { title: 'Quitter ce défi ?', message: 'Le défi sera supprimé pour tout le monde.' };
  }
  return { title: 'Quitter cette partie ?', message: 'Ta place sera libérée.' };
}

export function declineInvitationPlan(row: { status: string; auto_declined?: boolean | null }): {
  update: { status?: 'declined'; auto_declined: false };
  freeSpot: boolean;
  notifyCreator: boolean;
} {
  if (row.status === 'declined' && row.auto_declined) {
    return { update: { auto_declined: false }, freeSpot: false, notifyCreator: false };
  }
  return { update: { status: 'declined', auto_declined: false }, freeSpot: true, notifyCreator: true };
}
