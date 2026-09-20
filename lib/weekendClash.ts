// lib/weekendClash.ts — « Le choc à venir » du hub Activité.
//
// Une partie complète pas encore jouée, celle dont les deux paires sont les
// plus proches en niveau. Les autres joueurs donnent leur avis ; personne ne
// mise rien.
//
// Le handoff (§4c) le réservait au week-end et au dimanche. Essayé sur
// téléphone : on ne voyait jamais rien. Un pronostic ne coûte rien au joueur
// et marche même à dix personnes — c'est le levier collectif le moins cher
// qu'on ait, l'étrangler par une fenêtre de deux jours le rendait inutile.
// On regarde donc TOUTES les parties à venir, sur PREDICTION_DAYS jours.
//
// Le haut du fichier est pur et testé (lib/__tests__/weekendClash.test.ts).
// Le bas parle à la base : table `predictions`
// (supabase/migrations/predictions.sql), qui peut ne pas exister encore.
import { supabase } from './supabase';
import { eloToLevel } from './theme';
import { occupiesSpot } from './games';

export type Team = 'A' | 'B';

/** Jusqu'où on va chercher une partie à pronostiquer. */
export const PREDICTION_DAYS = 14;

/** De maintenant à PREDICTION_DAYS jours : les parties pronostiquables. */
export function predictionWindow(now: Date = new Date(), days = PREDICTION_DAYS): { start: Date; end: Date } {
  const end = new Date(now);
  end.setDate(end.getDate() + days);
  return { start: new Date(now), end };
}

export interface ClashPlayer {
  id: string;
  name: string;
  avatarPath: string | null;
  memberNumber: number | null;
  elo: number | null;
  team: Team;
}

export interface ClashGame {
  gameId: string;
  matchDate: string;
  location: string | null;
  city: string | null;
  players: ClashPlayer[];
}

export interface Clash extends ClashGame {
  teamA: ClashPlayer[];
  teamB: ClashPlayer[];
  /** Écart de niveau entre les deux paires, deux décimales. */
  gap: number;
}

/** 'A_GAU' → 'A'. Tout le reste → null. */
export function teamOf(side: string | null | undefined): Team | null {
  const s = (side ?? '').trim().toUpperCase();
  if (s.startsWith('A')) return 'A';
  if (s.startsWith('B')) return 'B';
  return null;
}

/** Niveau moyen d'une paire. `null` si aucun ELO connu. */
export function teamLevel(players: ClashPlayer[]): number | null {
  const niveaux = players.map(p => p.elo).filter((e): e is number => e != null).map(eloToLevel);
  if (niveaux.length === 0) return null;
  return niveaux.reduce((a, b) => a + b, 0) / niveaux.length;
}

/**
 * Le choc : parmi les parties complètes (2 contre 2) encore à venir, celle
 * dont l'écart de niveau entre les deux paires est le plus faible. À égalité,
 * la plus proche dans le temps.
 */
export function pickClash(games: ClashGame[], now: Date = new Date()): Clash | null {
  let best: Clash | null = null;
  for (const g of games) {
    const debut = Date.parse(g.matchDate);
    if (Number.isNaN(debut) || debut <= now.getTime()) continue;

    const teamA = g.players.filter(p => p.team === 'A');
    const teamB = g.players.filter(p => p.team === 'B');
    if (teamA.length !== 2 || teamB.length !== 2) continue;

    const na = teamLevel(teamA);
    const nb = teamLevel(teamB);
    if (na == null || nb == null) continue;

    const gap = Math.round(Math.abs(na - nb) * 100) / 100;
    const candidat: Clash = { ...g, teamA, teamB, gap };
    if (!best || gap < best.gap || (gap === best.gap && Date.parse(g.matchDate) < Date.parse(best.matchDate))) {
      best = candidat;
    }
  }
  return best;
}

/** Une ligne de `game_participants`, telle que la base la rend. */
export interface ClashParticipant {
  player_id: string;
  status: string;
  team_side?: string | null;
  invite_expires_at?: string | null;
  player?: { name?: string | null; elo_score?: number | null; avatar_path?: string | null; member_number?: number | null } | null;
}

/**
 * Les joueurs d'une partie, au sens du reste de l'app : `occupiesSpot`.
 *
 * Un joueur invité et non expiré occupe sa place — le Lobby l'affiche déjà
 * sur la carte et compte la partie « COMPLET ». Filtrer sur
 * `status === 'accepted'` écartait ces parties, qui n'apparaissaient donc
 * jamais comme choc alors qu'elles étaient pleines à l'écran.
 */
export function clashPlayersFrom(participants: ClashParticipant[]): ClashPlayer[] {
  return participants
    .filter(p => occupiesSpot(p) && teamOf(p.team_side))
    .map(p => ({
      id: p.player_id,
      name: p.player?.name ?? 'Joueur',
      avatarPath: p.player?.avatar_path ?? null,
      memberNumber: p.player?.member_number ?? null,
      elo: p.player?.elo_score ?? null,
      team: teamOf(p.team_side) as Team,
    }));
}

export interface PredictionCounts { A: number; B: number; total: number }

/** Compte les avis par camp. */
export function countPredictions(rows: { team: Team }[]): PredictionCounts {
  const A = rows.filter(r => r.team === 'A').length;
  const B = rows.filter(r => r.team === 'B').length;
  return { A, B, total: A + B };
}

/** Part d'un camp, en pourcentage entier. Sans avis, 0. */
export function predictionShare(counts: PredictionCounts, team: Team): number {
  if (counts.total === 0) return 0;
  return Math.round((counts[team] / counts.total) * 100);
}

/** « 58 % comme toi » — la part de ceux qui ont dit la même chose. */
export function agreementLabel(counts: PredictionCounts, mine: Team | null): string | null {
  if (!mine || counts.total === 0) return null;
  return `${predictionShare(counts, mine)} % comme toi`;
}

const JOURS = ['Dim.', 'Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'];
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/**
 * « Dim. 18h · Padel Art ». Au-delà d'une semaine, le nom du jour ne suffit
 * plus à situer la partie : on ajoute la date.
 */
export function clashWhenLabel(c: Pick<ClashGame, 'matchDate' | 'location'>, now: Date = new Date()): string {
  const d = new Date(c.matchDate);
  if (Number.isNaN(d.getTime())) return c.location ?? '';
  const min = d.getMinutes() ? `h${String(d.getMinutes()).padStart(2, '0')}` : 'h';
  const loin = d.getTime() - now.getTime() >= 6 * 86_400_000;
  const jour = loin ? `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}` : JOURS[d.getDay()];
  const quand = `${jour} ${d.getHours()}${min}`;
  return c.location ? `${quand} · ${c.location}` : quand;
}

/** Le motif de la sélection, en une phrase. */
export function clashReasonLabel(c: Pick<Clash, 'gap' | 'city'>): string {
  const ou = c.city ? ` de ${c.city}` : '';
  return `L'écart de niveau le plus serré${ou} en ce moment (${c.gap.toFixed(2)}).`;
}

// ─── Base de données ──────────────────────────────────────────────────────

const MANQUE = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42P01' || /does not exist/i.test(e.message ?? ''));

/**
 * Les parties complètes d'un intervalle, avec leurs quatre joueurs.
 *
 * Qui « joue » se lit avec `occupiesSpot`, comme partout ailleurs : un joueur
 * invité et non expiré occupe sa place, et le Lobby l'affiche déjà sur la
 * carte de la partie. Le filtre brut `status === 'accepted'` écartait ces
 * parties-là — elles s'affichaient « COMPLET » dans le Lobby et restaient
 * invisibles ici.
 */
export async function fetchClashCandidates(start: Date, end: Date, limit = 40): Promise<ClashGame[]> {
  const { data, error } = await supabase
    .from('open_games')
    .select('id, match_date, location, status, participants:game_participants(player_id, status, team_side, invite_expires_at, player:player_id(id, name, elo_score, avatar_path, member_number))')
    .neq('status', 'cancelled')
    .gte('match_date', start.toISOString())
    .lte('match_date', end.toISOString())
    .order('match_date')
    .limit(limit);
  if (error) { console.warn('[weekendClash] candidates', error); return []; }

  return ((data ?? []) as any[]).map(g => ({
    gameId: g.id,
    matchDate: g.match_date,
    location: g.location ?? null,
    city: null,
    players: clashPlayersFrom((g.participants ?? []) as ClashParticipant[]),
  }));
}

/** Tous les pronostics d'une partie. */
export async function fetchPredictions(gameId: string): Promise<{ playerId: string; team: Team }[]> {
  const { data, error } = await supabase
    .from('predictions')
    .select('player_id, team')
    .eq('game_id', gameId);
  if (error) { if (!MANQUE(error)) console.warn('[weekendClash] predictions', error); return []; }
  return ((data ?? []) as any[]).map(r => ({ playerId: r.player_id, team: r.team as Team }));
}

/**
 * Poser ou changer son pronostic. Renvoie un message si ça n'a pas pu se
 * faire (match commencé, table absente), `null` si c'est passé.
 */
export async function castPrediction(gameId: string, playerId: string, team: Team): Promise<string | null> {
  const { error } = await supabase
    .from('predictions')
    .upsert({ game_id: gameId, player_id: playerId, team }, { onConflict: 'game_id,player_id' });
  if (!error) return null;
  if (MANQUE(error)) return 'Les pronostics ne sont pas encore ouverts.';
  if (/commencé/i.test(error.message ?? '')) return 'Le match a commencé, les pronostics sont fermés.';
  console.warn('[weekendClash] cast', error);
  return "Ton pronostic n'a pas pu être enregistré.";
}
