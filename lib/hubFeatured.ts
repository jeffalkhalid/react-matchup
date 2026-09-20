// lib/hubFeatured.ts — le bloc « À LA UNE » du hub Activité.
//
// Un seul bloc par jour, en rotation sur la semaine (handoff « Hub Activite »,
// §4) : le club en début de semaine, le week-end qui se prépare au milieu, la
// semaine qu'on referme le dimanche. L'onglet raconte ainsi une chose à la
// fois au lieu d'empiler des cartes.
//
// Le haut du fichier est PUR et testé (lib/__tests__/hubFeatured.test.ts).
// Le bas parle à la base : deux VUES (supabase/migrations/hub_une.sql) qui
// peuvent ne pas exister encore — dans ce cas on renvoie du vide et le bloc
// montre son état calme, jamais une erreur.
import { supabase } from './supabase';
import { eloToLevel } from './theme';

export type FeaturedKey = 'taulier' | 'mercato' | 'pantheon';

/** Lun–mer : le club. Jeu–sam : le week-end. Dim : la semaine écoulée. */
export function featuredBlock(now: Date = new Date()): FeaturedKey {
  const jour = now.getDay(); // 0 = dimanche
  if (jour === 0) return 'pantheon';
  if (jour <= 3) return 'taulier';
  return 'mercato';
}

const JOURS = ['DIMANCHE', 'LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI'];

/** « LUNDI » — la fin de l'en-tête « À LA UNE · {JOUR} ». */
export function featuredDayLabel(now: Date = new Date()): string {
  return JOURS[now.getDay()];
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « août » — le mois en toutes lettres, minuscule (le kicker le met en capitales). */
export function monthLabel(d: Date): string {
  return MOIS[d.getMonth()];
}

const deux = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;

/** Le 1er du mois, au format des vues (`date_trunc('month', …)`). */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-01`;
}

/** Le lundi de la semaine, au format des vues (`date_trunc('week', …)`). */
export function weekKey(d: Date): string {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const versLundi = (x.getDay() + 6) % 7; // dimanche = 6 jours après lundi
  x.setDate(x.getDate() - versLundi);
  return ymd(x);
}

/** Numéro de semaine ISO — la pastille « SEMAINE 38 ». */
export function isoWeekNumber(d: Date): number {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // On se place sur le jeudi de la même semaine : c'est lui qui donne l'année ISO.
  x.setUTCDate(x.getUTCDate() + 3 - ((x.getUTCDay() + 6) % 7));
  const premierJeudi = new Date(Date.UTC(x.getUTCFullYear(), 0, 4));
  premierJeudi.setUTCDate(premierJeudi.getUTCDate() + 3 - ((premierJeudi.getUTCDay() + 6) % 7));
  return 1 + Math.round((x.getTime() - premierJeudi.getTime()) / (7 * 86_400_000));
}

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

// ─── Mercato : le tri, pur ────────────────────────────────────────────────

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
// Les deux vues viennent de supabase/migrations/hub_une.sql. Tant qu'elle
// n'est pas appliquée, Postgres répond 42P01 : on se tait et le bloc montre
// son état calme (même motif que lib/availability.ts).

const MANQUE = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42P01' || /does not exist/i.test(e.message ?? ''));

interface JoueurMini { id: string; name: string; avatar_path: string | null; member_number: number | null; elo_score: number | null }

async function joueursParId(ids: string[]): Promise<Map<string, JoueurMini>> {
  const uniques = [...new Set(ids)];
  if (uniques.length === 0) return new Map();
  const { data } = await supabase
    .from('players')
    .select('id, name, avatar_path, member_number, elo_score')
    .in('id', uniques);
  return new Map(((data ?? []) as any[]).map(p => [p.id as string, p as JoueurMini]));
}

export interface ClubLeader {
  playerId: string;
  name: string;
  avatarPath: string | null;
  memberNumber: number | null;
  matches: number;
  wins: number;
  partners: number;
  place: number;
}

/** Le classement d'un club pour un mois — le 1er est « le taulier ». */
export async function fetchClubLeaders(club: string, month: Date, limit = 4): Promise<ClubLeader[]> {
  if (!club) return [];
  const { data, error } = await supabase
    .from('club_monthly_leaders')
    .select('player_id, matches, wins, partners, place')
    .eq('club', club.trim())
    .eq('mois', monthKey(month))
    .order('place')
    .order('matches', { ascending: false })
    .limit(limit);
  if (error) { if (!MANQUE(error)) console.warn('[hubFeatured] leaders', error); return []; }

  const rows = (data ?? []) as any[];
  const joueurs = await joueursParId(rows.map(r => r.player_id));
  return rows.map(r => {
    const p = joueurs.get(r.player_id);
    return {
      playerId: r.player_id, name: p?.name ?? 'Joueur',
      avatarPath: p?.avatar_path ?? null, memberNumber: p?.member_number ?? null,
      matches: r.matches ?? 0, wins: r.wins ?? 0, partners: r.partners ?? 0, place: r.place ?? 0,
    };
  });
}

export interface PantheonRow {
  badgeKey: string;
  playerId: string;
  name: string;
  avatarPath: string | null;
  memberNumber: number | null;
  votes: number;
  place: number;
}

/** Les badges les plus donnés de la semaine dans une ville, leur lauréat en tête. */
export async function fetchCityPantheon(city: string, week: Date, limit = 3): Promise<PantheonRow[]> {
  if (!city) return [];
  const { data, error } = await supabase
    .from('city_weekly_badges')
    .select('badge_key, player_id, votes, place')
    .eq('city', city)
    .eq('semaine', weekKey(week))
    .eq('place', 1)
    .order('votes', { ascending: false })
    .limit(limit);
  if (error) { if (!MANQUE(error)) console.warn('[hubFeatured] pantheon', error); return []; }

  const rows = (data ?? []) as any[];
  const joueurs = await joueursParId(rows.map(r => r.player_id));
  return rows.map(r => {
    const p = joueurs.get(r.player_id);
    return {
      badgeKey: r.badge_key, playerId: r.player_id, name: p?.name ?? 'Joueur',
      avatarPath: p?.avatar_path ?? null, memberNumber: p?.member_number ?? null,
      votes: r.votes ?? 0, place: r.place ?? 1,
    };
  });
}

/** Ma meilleure place de la semaine dans ma ville, pour le pied du Panthéon. */
export async function fetchMyPantheonPlace(city: string, week: Date, myId: string): Promise<{ badgeKey: string; place: number; votes: number } | null> {
  if (!city || !myId) return null;
  const { data, error } = await supabase
    .from('city_weekly_badges')
    .select('badge_key, votes, place')
    .eq('city', city)
    .eq('semaine', weekKey(week))
    .eq('player_id', myId)
    .order('place')
    .limit(1);
  if (error) { if (!MANQUE(error)) console.warn('[hubFeatured] myPlace', error); return null; }
  const r = (data ?? [])[0] as any;
  return r ? { badgeKey: r.badge_key, place: r.place ?? 0, votes: r.votes ?? 0 } : null;
}

/** La ville d'un club, telle qu'enregistrée dans `clubs`. */
export async function fetchClubCity(club: string): Promise<string | null> {
  if (!club) return null;
  const { data, error } = await supabase.from('clubs').select('city').eq('name', club.trim()).limit(1);
  if (error) { console.warn('[hubFeatured] clubCity', error); return null; }
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
  if (error) { if (!MANQUE(error)) console.warn('[hubFeatured] availability', error); return []; }

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
  if (error) { console.warn('[hubFeatured] mesParties', error); return []; }

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
