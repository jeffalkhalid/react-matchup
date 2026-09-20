// lib/weekendClash.ts — « Le choc du week-end » du hub Activité.
//
// Une partie complète du week-end, pas encore jouée, celle dont les deux
// paires sont les plus proches en niveau (handoff « Hub Activite » §4c). Les
// autres joueurs donnent leur avis ; personne ne mise rien.
//
// Le haut du fichier est pur et testé (lib/__tests__/weekendClash.test.ts).
// Le bas parle à la base : table `predictions`
// (supabase/migrations/predictions.sql), qui peut ne pas exister encore.
import { supabase } from './supabase';
import { eloToLevel } from './theme';

export type Team = 'A' | 'B';

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

/** « Dim. 18h · Padel Art » — la ligne de contexte sous le titre. */
export function clashWhenLabel(c: Pick<ClashGame, 'matchDate' | 'location'>): string {
  const d = new Date(c.matchDate);
  if (Number.isNaN(d.getTime())) return c.location ?? '';
  const min = d.getMinutes() ? `h${String(d.getMinutes()).padStart(2, '0')}` : 'h';
  const quand = `${JOURS[d.getDay()]} ${d.getHours()}${min}`;
  return c.location ? `${quand} · ${c.location}` : quand;
}

/** Le motif de la sélection, en une phrase. */
export function clashReasonLabel(c: Pick<Clash, 'gap' | 'city'>): string {
  const ou = c.city ? ` de ${c.city}` : '';
  return `L'écart de niveau le plus serré${ou} ce week-end (${c.gap.toFixed(2)}).`;
}

// ─── Base de données ──────────────────────────────────────────────────────

const MANQUE = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42P01' || /does not exist/i.test(e.message ?? ''));

/** Les parties complètes d'un intervalle, avec leurs quatre joueurs. */
export async function fetchClashCandidates(start: Date, end: Date, limit = 40): Promise<ClashGame[]> {
  const { data, error } = await supabase
    .from('open_games')
    .select('id, match_date, location, status, participants:game_participants(player_id, status, team_side, player:player_id(id, name, elo_score, avatar_path, member_number))')
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
    players: ((g.participants ?? []) as any[])
      .filter(p => p.status === 'accepted' && teamOf(p.team_side))
      .map(p => ({
        id: p.player_id,
        name: p.player?.name ?? 'Joueur',
        avatarPath: p.player?.avatar_path ?? null,
        memberNumber: p.player?.member_number ?? null,
        elo: p.player?.elo_score ?? null,
        team: teamOf(p.team_side) as Team,
      })),
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
