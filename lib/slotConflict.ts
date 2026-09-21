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

/** Une partie vue par son CRÉATEUR — qui n'a pas de ligne de participation. */
export interface BusyCreatedGame {
  creator_id: string;
  match_date?: string | null;
  status?: string | null;
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
 * Qui, parmi ces parties, est pris sur ce créneau en tant que CRÉATEUR.
 *
 * Le créateur n'est pas une ligne de `game_participants` : il vit sur la
 * partie (`creator_id`). Ne lire que les participations laissait donc
 * l'organisateur d'une partie apparaître comme libre à la même heure — vu à
 * l'écran, et déjà payé une fois côté pronostics.
 */
export function busyCreatorIds(games: BusyCreatedGame[], slotTs: number): Set<string> {
  const out = new Set<string>();
  if (!Number.isFinite(slotTs)) return out;
  for (const g of games) {
    if (!g?.creator_id || !g.match_date || !compte(g.status)) continue;
    if (overlapsSlot(Date.parse(g.match_date), slotTs)) out.add(g.creator_id);
  }
  return out;
}

/**
 * Parmi ces joueurs, lesquels ont déjà une partie confirmée sur le créneau —
 * qu'ils y participent ou qu'ils l'aient créée.
 * En cas d'échec réseau : personne n'est marqué indisponible — mieux vaut
 * laisser inviter (le serveur refusera) que d'interdire à tort.
 */
export async function fetchBusyPlayerIds(playerIds: string[], slotTs: number): Promise<Set<string>> {
  if (!Number.isFinite(slotTs)) return new Set();
  const engagements = await fetchEngagements(playerIds);
  if (!engagements) return new Set();

  const pris = busyPlayerIds(engagements.parts, slotTs);
  for (const id of busyCreatorIds(engagements.creees, slotTs)) pris.add(id);
  return pris;
}

/**
 * Les engagements confirmés de ces joueurs, des DEUX sources : leurs
 * participations et les parties qu'ils organisent.
 *
 * Elles ne se lisent qu'ici. Le créateur n'ayant pas de ligne de
 * participation, tout code qui n'interroge qu'une table annonce
 * l'organisateur comme libre à sa propre heure — erreur déjà payée trois
 * fois (pronostics, assistant de création, onglet Défi).
 *
 * `null` en cas d'échec réseau : l'appelant ne marque alors personne comme
 * pris, plutôt que d'interdire à tort.
 */
async function fetchEngagements(playerIds: string[]): Promise<{
  parts: BusyParticipation[]; creees: BusyCreatedGame[];
} | null> {
  const ids = [...new Set(playerIds.filter(Boolean))];
  if (ids.length === 0) return { parts: [], creees: [] };

  // Le tri par date se fait côté client et non en SQL : filtrer sur une
  // colonne d'une table jointe demande un `!inner` dont le comportement se
  // prête aux mauvaises surprises, et la liste de candidats tient en une
  // poignée de joueurs — leurs parties confirmées se comptent sur les doigts.
  const [{ data: parts, error }, { data: creees }] = await Promise.all([
    supabase
      .from('game_participants')
      .select('player_id, game:game_id(match_date, status)')
      .in('player_id', ids)
      .eq('status', 'accepted'),
    supabase
      .from('open_games')
      .select('creator_id, match_date, status')
      .in('creator_id', ids),
  ]);
  if (error) { console.warn('[slotConflict] fetchEngagements', error); return null; }

  return {
    parts: (parts ?? []) as unknown as BusyParticipation[],
    creees: (creees ?? []) as unknown as BusyCreatedGame[],
  };
}

/** Ce joueur est-il engagé quelque part entre ces deux instants ? */
const dansLaFenetre = (iso: string | null | undefined, statut: string | null | undefined, debut: number, fin: number) => {
  if (!iso || !compte(statut)) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= debut && t < fin;
};

/**
 * Parmi ces joueurs, lesquels ont déjà une partie dans cette fenêtre — une
 * JOURNÉE, pas un créneau de deux heures.
 *
 * La carte « Dispos demain » raisonne par jour : quelqu'un qui vient d'être
 * invité à une partie de demain continuait d'y figurer comme libre, et on
 * repartait monter un deuxième match avec les mêmes personnes.
 */
export async function fetchEngagedInRange(playerIds: string[], start: Date, end: Date): Promise<Set<string>> {
  const debut = start.getTime();
  const fin = end.getTime();
  if (!Number.isFinite(debut) || !Number.isFinite(fin) || fin <= debut) return new Set();

  const engagements = await fetchEngagements(playerIds);
  if (!engagements) return new Set();

  const pris = new Set<string>();
  for (const r of engagements.parts) {
    if (dansLaFenetre(r?.game?.match_date, r?.game?.status, debut, fin)) pris.add(r.player_id);
  }
  for (const g of engagements.creees) {
    if (g?.creator_id && dansLaFenetre(g.match_date, g.status, debut, fin)) pris.add(g.creator_id);
  }
  return pris;
}
