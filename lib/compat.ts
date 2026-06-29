// react-matchup/lib/compat.ts
// Moteur de COMPATIBILITÉ entre joueurs (port de web compatibility.ts).
// Extrait de l'ancien matchmaking.tsx (Phase 3a l'avait retiré). Pur data +
// supabase : aucun JSX. Réutilisé par le hub Défi (classement « À relever » +
// suggestions de partenaire).
import { supabase } from './supabase';

export interface CompatDetail {
  score: number;
  eloScore: number; eloGap: number;
  clubScore: number; sharedClubs: string[];
  dayScore: number; sharedDays: string[];
  sideScore: number; sideMatch: string;
}

export const DAYS_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

export function scoreElo(eloA: number, eloB: number): number {
  const gap = Math.abs(eloA - eloB);
  if (gap <= 75)  return 40;
  if (gap <= 150) return 32;
  if (gap <= 250) return 20;
  if (gap <= 400) return 10;
  return 0;
}

export async function getPlayerGameData(playerId: string): Promise<{ clubs: Map<string, number>; days: Set<number> }> {
  const { data: parts } = await supabase
    .from('game_participants')
    .select('game_id')
    .eq('player_id', playerId);
  const gameIds = (parts ?? []).map((p: any) => p.game_id as string).filter(Boolean);
  if (gameIds.length === 0) return { clubs: new Map(), days: new Set() };

  const { data: games } = await supabase
    .from('open_games')
    .select('location, match_date')
    .in('id', gameIds)
    .neq('status', 'cancelled');

  const clubs = new Map<string, number>();
  const days = new Set<number>();
  for (const row of games ?? []) {
    if (row.location) clubs.set(row.location, (clubs.get(row.location) ?? 0) + 1);
    if (row.match_date) days.add(new Date(row.match_date).getDay());
  }
  return { clubs, days };
}

export function scoreClubs(a: Map<string, number>, b: Map<string, number>): { score: number; shared: string[] } {
  const shared: string[] = [];
  for (const club of a.keys()) { if (b.has(club)) shared.push(club); }
  if (shared.length === 0) return { score: 0, shared: [] };
  return { score: shared.length >= 2 ? 30 : 20, shared };
}

export function scoreDays(a: Set<number>, b: Set<number>): { score: number; shared: string[] } {
  const nums = [...a].filter(d => b.has(d));
  const shared = nums.map(d => DAYS_FR[d]);
  if (shared.length === 0) return { score: 0, shared: [] };
  return { score: shared.length >= 2 ? 20 : 12, shared };
}

export function scoreSide(sideA: string | null | undefined, sideB: string | null | undefined): { score: number; sideMatch: string } {
  const norm = (s: string | null | undefined) => {
    if (!s) return 'mixte';
    if (s === 'left'  || s === 'Gauche') return 'gauche';
    if (s === 'right' || s === 'Droit')  return 'droit';
    return 'mixte';
  };
  const a = norm(sideA), b = norm(sideB);
  if (a === 'mixte' || b === 'mixte') return { score: 5,  sideMatch: 'flexible' };
  if ((a === 'gauche' && b === 'droit') || (a === 'droit' && b === 'gauche'))
    return { score: 10, sideMatch: 'complémentaires' };
  return { score: 2, sideMatch: 'même côté' };
}

export async function computeCompatDetail(
  meId: string, myElo: number, mySide: string | null | undefined,
  myData: { clubs: Map<string, number>; days: Set<number> },
  otherId: string, otherElo: number, otherSide: string | null | undefined,
): Promise<CompatDetail> {
  const otherData = await getPlayerGameData(otherId);
  const eloGap   = Math.abs(myElo - otherElo);
  const eloScore = scoreElo(myElo, otherElo);
  const { score: clubScore, shared: sharedClubs } = scoreClubs(myData.clubs, otherData.clubs);
  const { score: dayScore,  shared: sharedDays  } = scoreDays(myData.days, otherData.days);
  const { score: sideScore, sideMatch            } = scoreSide(mySide, otherSide);
  return { score: eloScore + clubScore + dayScore + sideScore, eloScore, eloGap, clubScore, sharedClubs, dayScore, sharedDays, sideScore, sideMatch };
}
