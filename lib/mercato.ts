// lib/mercato.ts — « Mercato du week-end » : qui s'est déclaré libre.
//
// Ancien `lib/hubFeatured`, qui portait aussi le « Taulier du club » et le
// « Panthéon de la ville ». Les deux ont été retirés après essai sur
// téléphone : ils découpaient une activité déjà rare (par club, par ville,
// par semaine, par badge) et n'avaient donc presque jamais rien à afficher.
// Il ne reste que le mercato, qui se contente des dispos déjà déclarées.
//
// Le haut du fichier est PUR et testé (lib/__tests__/mercato.test.ts) ;
// le bas parle à la base.
import { supabase } from './supabase';
import { isMissingRelation } from './pgErrors';
import { eloToLevel } from './theme';

/** Samedi 8 h → dimanche minuit du week-end à venir (ou en cours). */
export function weekendWindow(now: Date = new Date()): { start: Date; end: Date } {
  const jour = now.getDay();
  const versSamedi = jour === 6 ? 0 : jour === 0 ? -1 : 6 - jour;
  const samedi = new Date(now);
  samedi.setDate(samedi.getDate() + versSamedi);
  samedi.setHours(8, 0, 0, 0);
  const dimanche = new Date(samedi);
  dimanche.setDate(dimanche.getDate() + 1);
  dimanche.setHours(23, 59, 59, 999);
  return { start: samedi, end: dimanche };
}

export interface MercatoRow {
  playerId: string;
  name: string;
  avatarPath: string | null;
  memberNumber: number | null;
  elo: number | null;
  clubs: string[];
  slotStart: string;
  slotEnd: string;
}

/** Écart de niveau accepté quand le joueur n'est pas déjà dans mon cercle. */
export const MERCATO_LEVEL_BAND = 0.5;

/** « Sam. matin », « Sam. ou dim. » — le créneau, en court, sous le prénom. */
export function mercatoSlotLabel(start: string, end: string): string {
  const d = new Date(start);
  const f = new Date(end);
  if (Number.isNaN(d.getTime())) return '';
  const jour = d.getDay() === 0 ? 'Dim.' : 'Sam.';
  const couvreLesDeux = !Number.isNaN(f.getTime()) && f.getDate() !== d.getDate();
  if (couvreLesDeux) return 'Sam. ou dim.';
  return d.getHours() < 13 ? `${jour} matin` : `${jour} après-midi`;
}

/**
 * Qui proposer pour le week-end : mon cercle, plus les joueurs de mon niveau.
 * Priorité à ceux qui jouent dans mes clubs, puis au cercle, puis au niveau le
 * plus proche. Un joueur n'apparaît qu'une fois, sur son créneau le plus tôt.
 */
export function pickMercato(rows: MercatoRow[], opts: {
  myId: string;
  myElo?: number | null;
  friendIds?: string[];
  myClubs?: string[];
  /** Joueurs déjà dans une de mes parties du week-end. */
  excludeIds?: string[];
  limit?: number;
}): MercatoRow[] {
  const amis = new Set(opts.friendIds ?? []);
  const exclus = new Set([opts.myId, ...(opts.excludeIds ?? [])]);
  const mesClubs = new Set(opts.myClubs ?? []);
  const monNiveau = opts.myElo != null ? eloToLevel(opts.myElo) : null;

  const ecart = (elo: number | null) =>
    monNiveau == null || elo == null ? Number.POSITIVE_INFINITY : Math.abs(eloToLevel(elo) - monNiveau);

  const retenus = rows.filter(r => {
    if (exclus.has(r.playerId)) return false;
    return amis.has(r.playerId) || ecart(r.elo) <= MERCATO_LEVEL_BAND;
  });

  // Un seul créneau par joueur : le plus tôt.
  const parJoueur = new Map<string, MercatoRow>();
  for (const r of retenus) {
    const vu = parJoueur.get(r.playerId);
    if (!vu || Date.parse(r.slotStart) < Date.parse(vu.slotStart)) parJoueur.set(r.playerId, r);
  }

  const note = (r: MercatoRow): [number, number, number] => [
    r.clubs.some(c => mesClubs.has(c)) ? 0 : 1,
    amis.has(r.playerId) ? 0 : 1,
    ecart(r.elo),
  ];

  return Array.from(parJoueur.values())
    .sort((a, b) => {
      const [ca, aa, na] = note(a);
      const [cb, ab, nb] = note(b);
      return ca - cb || aa - ab || na - nb || a.name.localeCompare(b.name);
    })
    .slice(0, opts.limit ?? 8);
}

/** La fourchette de niveau annoncée sous le titre du mercato. */
export function mercatoBandLabel(myElo?: number | null): string | null {
  if (myElo == null) return null;
  const n = eloToLevel(myElo);
  return `${(n - MERCATO_LEVEL_BAND).toFixed(1)} – ${(n + MERCATO_LEVEL_BAND).toFixed(1)}`;
}

// ─── Base de données ──────────────────────────────────────────────────────

const MANQUE = isMissingRelation;

/** La ville d'un club, telle qu'enregistrée dans `clubs` (sous-titre du header). */
export async function fetchClubCity(club: string): Promise<string | null> {
  if (!club) return null;
  const { data, error } = await supabase.from('clubs').select('city').eq('name', club.trim()).limit(1);
  if (error) { console.warn('[mercato] clubCity', error); return null; }
  return ((data ?? [])[0] as any)?.city ?? null;
}

/** Les dispos déclarées sur un intervalle, tous joueurs confondus. */
export async function fetchAvailabilityWindow(start: Date, end: Date, limit = 60): Promise<MercatoRow[]> {
  const { data, error } = await supabase
    .from('availability')
    .select('player_id, slot_start, slot_end, player:player_id(id, name, elo_score, avatar_path, member_number, clubs)')
    .lt('slot_start', end.toISOString())
    .gt('slot_end', start.toISOString())
    .order('slot_start')
    .limit(limit);
  if (error) { if (!MANQUE(error)) console.warn('[mercato] availability', error); return []; }

  return ((data ?? []) as any[]).map(r => ({
    playerId: r.player_id,
    name: r.player?.name ?? 'Joueur',
    avatarPath: r.player?.avatar_path ?? null,
    memberNumber: r.player?.member_number ?? null,
    elo: r.player?.elo_score ?? null,
    clubs: (r.player?.clubs ?? []) as string[],
    slotStart: r.slot_start,
    slotEnd: r.slot_end,
  }));
}

/** Les joueurs déjà avec moi dans une partie du week-end — inutile de les proposer. */
export async function fetchWeekendPartners(myId: string, start: Date, end: Date): Promise<string[]> {
  const { data: miennes, error } = await supabase
    .from('game_participants')
    .select('game_id, game:game_id(match_date, status)')
    .eq('player_id', myId)
    .eq('status', 'accepted');
  if (error) { console.warn('[mercato] mesParties', error); return []; }

  const ids = ((miennes ?? []) as any[])
    .filter(r => {
      const t = Date.parse(r.game?.match_date ?? '');
      return r.game?.status !== 'cancelled' && !Number.isNaN(t) && t >= start.getTime() && t <= end.getTime();
    })
    .map(r => r.game_id as string);
  if (ids.length === 0) return [];

  const { data: autres } = await supabase
    .from('game_participants')
    .select('player_id')
    .in('game_id', ids);
  return [...new Set(((autres ?? []) as any[]).map(r => r.player_id as string))];
}
