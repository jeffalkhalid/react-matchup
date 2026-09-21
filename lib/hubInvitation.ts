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

/**
 * TOUTES mes invitations actives, la plus proche d'abord.
 *
 * La carte n'en montrait qu'une : on pouvait avoir trois parties qui
 * attendent une reponse sans jamais le savoir depuis le hub.
 */
export async function fetchMyInvitations(playerId: string, limit = 6): Promise<HubInvitation[]> {
  try {
    const { data, error } = await supabase
      .from('game_participants')
      .select(SELECT)
      .eq('player_id', playerId)
      .eq('status', 'invited');
    if (error || !data) return [];
    const visible = (data as any[]).filter(inv => isInvitationVisible(inv, new Set()));
    visible.sort((a, b) => {
      const ta = a.game?.match_date ? new Date(a.game.match_date).getTime() : Infinity;
      const tb = b.game?.match_date ? new Date(b.game.match_date).getTime() : Infinity;
      return ta - tb;
    });
    return visible.slice(0, limit).map(inv => ({
      participantId: inv.id,
      inviteExpiresAt: inv.invite_expires_at ?? null,
      game: inv.game as OpenGame & { creator: Player },
    }));
  } catch (e) {
    console.log('[hubInvitation] fetchMyInvitations threw', String(e));
    return [];
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

/**
 * Combien de joueurs sont DEJA confirmes sur la partie, moi exclu :
 * le createur plus les participants acceptes.
 *
 * C'est ce compte qui dit si je complete l'equipe ou s'il manquera encore
 * du monde apres moi.
 */
export function confirmedCount(
  game: { creator_id?: string | null; participants?: { player_id: string; status: string }[] | null },
  viewerId: string,
): number {
  const autres = (game.participants ?? []).filter(
    p => p.status === 'accepted' && p.player_id !== game.creator_id && p.player_id !== viewerId,
  ).length;
  return Math.min(4, 1 + autres);
}

/**
 * « Yassir & Kenza cherchent un 4ᵉ » — mais SEULEMENT si je serais vraiment
 * le quatrieme.
 *
 * Le « 4ᵉ » etait ecrit en dur et ne comptait que les photos affichees : sur
 * une partie ou il manquait trois joueurs, on faisait croire qu'on completait
 * l'equipe — l'argument meme qui pousse a accepter.
 *
 * `rang` = ma place si j'accepte (confirmes + moi). En dessous de trois on ne
 * dit pas « un 2ᵉ », qui ne se dit pas au padel.
 */
export function invitationTitle(duo: Player[], rang: number): string {
  const noms = duo.map(p => p.name.split(' ')[0]);
  const qui = noms.length >= 2 ? `${noms[0]} & ${noms[1]}` : noms[0] ?? 'On';
  const verbe = noms.length >= 2 ? 'cherchent' : 'cherche';
  if (rang >= 4) return `${qui} ${verbe} un 4ᵉ`;
  if (rang === 3) return `${qui} ${verbe} un 3ᵉ`;
  return `${qui} ${verbe} des joueurs`;
}

const JOURS_ABBR = ['DIM.', 'LUN.', 'MAR.', 'MER.', 'JEU.', 'VEN.', 'SAM.'];
const MOIS_ABBR = ['JANV.', 'FÉVR.', 'MARS', 'AVR.', 'MAI', 'JUIN', 'JUIL.', 'AOÛT', 'SEPT.', 'OCT.', 'NOV.', 'DÉC.'];

/**
 * « MAR. 22 SEPT. · 20H30 » — la pastille de date noire de la carte.
 *
 * Elle ne disait que le jour de la semaine : « MAR. · 10H30 » peut être ce
 * mardi ou celui d'après, et on accepte une partie sans savoir laquelle.
 */
export function invitationDatePill(iso: string): string {
  const d = new Date(iso);
  const jour = JOURS_ABBR[d.getDay()];
  const mois = MOIS_ABBR[d.getMonth()];
  const min = d.getMinutes();
  const heure = min ? `${d.getHours()}H${String(min).padStart(2, '0')}` : `${d.getHours()}H`;
  return `${jour} ${d.getDate()} ${mois} · ${heure}`;
}
