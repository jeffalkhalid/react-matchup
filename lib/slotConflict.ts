// lib/slotConflict.ts — « ce joueur peut-il jouer à cette heure-là ? »
//
// Un match occupe sa durée de jeu plus une marge déplacement/repos : deux
// parties se chevauchent quand leurs intervalles [début, début + durée + marge)
// se croisent, soit |début₁ − début₂| < durée + marge. Comparaison STRICTE :
// un écart pile de 2 h (19 h contre 21 h) ne se chevauche pas.
//
// La même fenêtre vit côté serveur (trigger block_accepted_overlaps) : c'est
// lui qui a le dernier mot. L'app l'applique en avance pour ne pas proposer un
// joueur dont l'invitation serait refusée à l'acceptation.
//
// Ce fichier existe parce que la valeur était écrite TROIS fois (assistant de
// création, lobby, matchmaking) : trois copies d'une règle finissent par
// diverger sans que rien ne le signale.
import { supabase } from './supabase';

export const MATCH_DURATION_MS = 90 * 60 * 1000;   // 1h30 de jeu
export const BUFFER_MS = 30 * 60 * 1000;           // marge déplacement/repos
export const OVERLAP_MS = MATCH_DURATION_MS + BUFFER_MS;

/** Ces deux départs se chevauchent-ils ? */
export function overlapsSlot(gameTs: number, slotTs: number): boolean {
  if (!Number.isFinite(gameTs) || !Number.isFinite(slotTs)) return false;
  return Math.abs(gameTs - slotTs) < OVERLAP_MS;
}

/** Une participation confirmée, telle que la base la rend. */
export interface BusyParticipation {
  player_id: string;
  game?: { match_date?: string | null; status?: string | null } | null;
}

/** Une partie annulée ou déjà scorée n'occupe plus le créneau de personne. */
const compte = (statut: string | null | undefined) => statut !== 'cancelled' && statut !== 'closed';

/**
 * Qui, parmi ces participations, est déjà pris sur ce créneau.
 *
 * On ne regarde que les engagements CONFIRMÉS (le `status: 'accepted'` doit
 * être filtré en amont) : une invitation qu'on n'a pas encore acceptée n'est
 * pas un engagement, et griser quelqu'un pour ça l'exclurait à tort.
 */
export function busyPlayerIds(rows: BusyParticipation[], slotTs: number): Set<string> {
  const out = new Set<string>();
  if (!Number.isFinite(slotTs)) return out;
  for (const r of rows) {
    const g = r?.game;
    if (!g || !g.match_date || !compte(g.status)) continue;
    if (overlapsSlot(Date.parse(g.match_date), slotTs)) out.add(r.player_id);
  }
  return out;
}

/**
 * Parmi ces joueurs, lesquels ont déjà une partie confirmée sur le créneau.
 * En cas d'échec réseau : personne n'est marqué indisponible — mieux vaut
 * laisser inviter (le serveur refusera) que d'interdire à tort.
 */
export async function fetchBusyPlayerIds(playerIds: string[], slotTs: number): Promise<Set<string>> {
  const ids = [...new Set(playerIds.filter(Boolean))];
  if (ids.length === 0 || !Number.isFinite(slotTs)) return new Set();

  // Le tri par date se fait ici et non en SQL : filtrer sur une colonne d'une
  // table jointe demande un `!inner` dont le comportement se prête aux
  // mauvaises surprises, et la liste de candidats tient en une poignée de
  // joueurs — leurs parties confirmées se comptent sur les doigts.
  const { data, error } = await supabase
    .from('game_participants')
    .select('player_id, game:game_id(match_date, status)')
    .in('player_id', ids)
    .eq('status', 'accepted');
  if (error) { console.warn('[slotConflict] fetchBusy', error); return new Set(); }

  return busyPlayerIds((data ?? []) as unknown as BusyParticipation[], slotTs);
}
