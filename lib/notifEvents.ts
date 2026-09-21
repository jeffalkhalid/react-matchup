// lib/notifEvents.ts — cartes de la cloche liées aux arrivées et départs.
//
// Fonctions PURES (testées dans lib/__tests__/notifEvents.test.ts), branchées
// par lib/notifications.buildNotificationItems.
//
// Trois besoins nés le 2026-09-17 :
//  - un binôme qui rejoint un défi = UNE carte (« Karim & Sofia relèvent le
//    défi »), pas une carte « Nouveau joueur » par personne ;
//  - un binôme PROMU de la file le dit : « Vous avez rejoint le défi — une
//    place s'est libérée » (le verrouillage direct garde « Défi confirmé ») ;
//  - les départs, éjections, réouvertures, annulations et promotions de liste
//    d'attente ne laissent plus de ligne à relire : le serveur écrit un
//    événement (table notification_events), affiché tel quel.
import type { NotifItem } from './notifications';
import type { IconName } from '../components/community/icons';

export interface NotificationEventRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  route: string | null;
  game_id: string | null;
  ref: string | null;
  created_at: string;
}

/** Événements qui annoncent qu'un joueur a rejoint une partie : la carte
 *  « Nouveau joueur » calculée à partir des inscriptions ferait doublon. */
const JOIN_EVENT_KINDS = new Set(['promoted', 'joined_from_waitlist']);

/**
 * L'icône d'un événement serveur, d'après ce qu'il raconte.
 *
 * Tous ces événements sont typés « joined » — c'est leur COMPORTEMENT (info
 * supprimable), pas leur sens. Sans cette table, un départ de binôme et une
 * partie annulée s'affichaient avec la médaille des trophées.
 */
export function eventIcon(kind: string): IconName {
  switch (kind) {
    case 'defi_cancelled':      return 'x';
    case 'defi_binome_left':    return 'logOut';
    case 'defi_reopened':       return 'repeat';
    case 'promoted':
    case 'joined_from_waitlist': return 'users';
    default:                    return 'bell';
  }
}

/** Un événement serveur → une carte. Annulation en rouge, le reste en info. */
export function eventToItem(e: NotificationEventRow): NotifItem {
  return {
    id: `event-${e.id}`,
    type: e.kind === 'defi_cancelled' ? 'cancelled' : 'joined',
    title: e.title,
    subtitle: e.body,
    route: e.route || '/(tabs)/lobby',
    icon: eventIcon(e.kind),
  };
}

/** Participations déjà racontées par un événement (promotion de liste d'attente). */
export function participationsCoveredByEvents(events: NotificationEventRow[]): Set<string> {
  return new Set(events.filter(e => JOIN_EVENT_KINDS.has(e.kind) && e.ref).map(e => e.ref as string));
}

export interface JoinedRow {
  id: string;
  game_id: string;
  player_id: string;
  approvals?: string[] | null;
  created_at: string;
  team_side?: string | null;
  player?: { name?: string | null } | null;
}

export interface JoinedGame {
  location?: string | null;
  is_challenge?: boolean | null;
}

/**
 * Cartes « quelqu'un a rejoint » pour les parties d'un joueur.
 *
 * Défi : les deux membres d'un binôme adverse sont inscrits au même instant
 * (verrouillage ou promotion) → une seule carte pour le binôme. On regroupe par
 * partie + instant d'inscription, côté B uniquement.
 */
export function buildJoinedItems(
  rows: JoinedRow[],
  gamesById: Map<string, JoinedGame>,
  exclude: Set<string> = new Set(),
): NotifItem[] {
  const items: NotifItem[] = [];
  const binomes = new Map<string, { ids: string[]; names: string[]; gameId: string; index: number }>();

  for (const r of rows) {
    if (exclude.has(r.id)) continue;
    const g = gamesById.get(r.game_id);
    const where = g?.location ? ` à ${g.location}` : '';
    const nom = r.player?.name ?? 'Un joueur';
    const isChall = !!g?.is_challenge;

    if (isChall && String(r.team_side ?? '').startsWith('B')) {
      const cle = `${r.game_id}|${r.created_at}`;
      const b = binomes.get(cle);
      if (b) { b.ids.push(r.id); b.names.push(nom); continue; }
      binomes.set(cle, { ids: [r.id], names: [nom], gameId: r.game_id, index: items.length });
      items.push(null as unknown as NotifItem);   // place réservée, remplie plus bas
      continue;
    }

    const wasApproved = (r.approvals ?? []).length > 0;
    items.push({
      id: `joined-${r.id}`,
      type: 'joined',
      title: wasApproved ? '✅ Candidature acceptée' : '👋 Nouveau joueur',
      subtitle: `${nom} a rejoint ${isChall ? 'le défi' : 'la partie'}${where}`,
      route: `/(tabs)/lobby?gameId=${r.game_id}`,
      // Quelqu'un arrive : des joueurs, pas une médaille.
      icon: wasApproved ? 'check' : 'users',
    });
  }

  for (const b of binomes.values()) {
    const g = gamesById.get(b.gameId);
    const where = g?.location ? ` à ${g.location}` : '';
    const seul = b.names.length === 1;
    items[b.index] = {
      // Identifiant stable quel que soit l'ordre de lecture (suppression persistante).
      id: `joined-binome-${[...b.ids].sort()[0]}`,
      type: 'joined',
      title: seul ? '👋 Nouveau joueur' : '⚔️ Nouveau binôme adverse',
      subtitle: seul
        ? `${b.names[0]} a rejoint le défi${where}`
        : `${b.names.join(' & ')} relèvent le défi${where}`,
      route: `/(tabs)/lobby?gameId=${b.gameId}`,
      icon: seul ? 'users' : 'swords',
    };
  }

  return items;
}

export interface LockedApplicationRow {
  id: string;
  game_id: string;
  queued_at?: string | null;
  game?: { location?: string | null } | null;
}

/** Mon binôme retenu sur un défi. Passé par la file (`queued_at`) = promu. */
export function lockedDefiItem(l: LockedApplicationRow): NotifItem {
  const where = l.game?.location ? ` à ${l.game.location}` : '';
  const promu = !!l.queued_at;
  return {
    id: `joined-defi-${l.id}`,
    type: 'joined',
    title: promu ? '⚔️ Vous avez rejoint le défi' : '⚔️ Défi confirmé',
    subtitle: promu
      ? `Une place s'est libérée. Votre binôme relève le défi${where} — rendez-vous sur le terrain !`
      : `Votre binôme relève le défi${where} — rendez-vous sur le terrain !`,
    route: `/(tabs)/lobby?gameId=${l.game_id}`,
    icon: 'swords',
  };
}
