// lib/hubInvitation.ts — la carte d'invitation du hub Activité (étape 1).
//
// Rien de nouveau côté données : une invitation, c'est une ligne
// `game_participants` en statut 'invited' (comme le lobby). On relit
// exactement la même visibilité que la liste de notifications
// (lib/games.isInvitationVisible) pour ne jamais montrer une invitation
// expirée / sur une partie annulée ou déjà passée.
import { supabase } from './supabase';
import { isInvitationVisible } from './games';
import type { OpenGame, Player } from '../types';

export interface HubInvitation {
  participantId: string;
  inviteExpiresAt: string | null;
  game: OpenGame & { creator: Player };
}

const SELECT = [
  'id', 'invite_expires_at', 'team_side',
  // game_format + stake_multiplier : la carte annonce la nature et la mise.
  // spots_available manquait alors qu'un refus l'incremente — il repartait
  // donc de 0, ecrasant le vrai compte de places libres.
  'game:game_id(id, location, match_date, status, is_challenge, game_format, ' +
    'stake_multiplier, spots_available, min_elo, max_elo, ' +
    'creator_id, creator:creator_id(id, name, avatar_path, elo_score), ' +
    'participants:game_participants(player_id, status, invite_expires_at, ' +
    'player:player_id(id, name, avatar_path, elo_score)))',
].join(', ');

/** Mon invitation active la plus proche dans le temps, ou `null`. */
export async function fetchMyInvitation(playerId: string): Promise<HubInvitation | null> {
  try {
    const { data, error } = await supabase
      .from('game_participants')
      .select(SELECT)
      .eq('player_id', playerId)
      .eq('status', 'invited');
    if (error || !data) return null;
    const visible = (data as any[]).filter(inv => isInvitationVisible(inv, new Set()));
    if (visible.length === 0) return null;
    visible.sort((a, b) => {
      const ta = a.game?.match_date ? new Date(a.game.match_date).getTime() : Infinity;
      const tb = b.game?.match_date ? new Date(b.game.match_date).getTime() : Infinity;
      return ta - tb;
    });
    const first = visible[0];
    return {
      participantId: first.id,
      inviteExpiresAt: first.invite_expires_at ?? null,
      game: first.game as OpenGame & { creator: Player },
    };
  } catch (e) {
    console.log('[hubInvitation] fetchMyInvitation threw', String(e));
    return null;
  }
}

/**
 * Le duo qui invite, pour le titre de la carte : le créateur + le premier
 * autre joueur confirmé (hors moi). S'il n'y a que le créateur de confirmé,
 * on ne montre que lui — la carte l'affiche alors seul, sans le chevauchement
 * à deux photos.
 */
export function invitingDuo(
  game: { creator_id?: string | null; creator?: Player | null; participants?: { player_id: string; status: string; player?: Player | null }[] | null },
  viewerId: string,
): Player[] {
  const out: Player[] = [];
  if (game.creator) out.push(game.creator);
  for (const p of game.participants ?? []) {
    if (p.status !== 'accepted') continue;
    if (p.player_id === game.creator_id || p.player_id === viewerId) continue;
    if (p.player) { out.push(p.player); break; }
  }
  return out;
}

/** « Yassir & Kenza cherchent un 4ᵉ » — ou la forme au singulier s'il n'y en a qu'un. */
export function invitationTitle(duo: Player[]): string {
  const firstNames = duo.map(p => p.name.split(' ')[0]);
  if (firstNames.length >= 2) return `${firstNames[0]} & ${firstNames[1]} cherchent un 4ᵉ`;
  if (firstNames.length === 1) return `${firstNames[0]} cherche un 4ᵉ`;
  return 'On cherche un 4ᵉ';
}

const JOURS_ABBR = ['DIM.', 'LUN.', 'MAR.', 'MER.', 'JEU.', 'VEN.', 'SAM.'];

/** « JEU. · 20H » — la pastille de date noire de la carte. */
export function invitationDatePill(iso: string): string {
  const d = new Date(iso);
  const jour = JOURS_ABBR[d.getDay()];
  const min = d.getMinutes();
  const heure = min ? `${d.getHours()}H${String(min).padStart(2, '0')}` : `${d.getHours()}H`;
  return `${jour} · ${heure}`;
}
