/* components/story/storyTheme.ts
 * Tokens + helpers pour les stories PagMatch (port RN des maquettes HTML).
 * S'appuie sur lib/theme (Colors, Fonts) déjà présent dans le repo. */
import { Colors, Fonts } from '../../lib/theme';

export { Colors, Fonts };

/** Facteur d'échelle : les maquettes sont dessinées en canvas logique 1080 px de large.
 *  k = width / 1080. Utilise s(n) pour mettre à l'échelle toutes les tailles. */
export const BASE_W = 1080;
export const makeScale = (width: number) => (n: number) => (n * width) / BASE_W;

/** Couleur de ligue (or, diamant…) — NE PAS confondre avec l'accent `brand`. */
export const leagueColor = (league: string) =>
  (Colors.league as Record<string, string>)[league] ?? Colors.brand;

export const leagueLabel: Record<string, string> = {
  diamond: 'Diamant', gold: 'Or', silver: 'Argent', bronze: 'Bronze', discovery: 'Découverte',
};

export const leagueGrad: Record<string, [string, string]> = {
  diamond: ['#0EA5E9', '#67E8F9'], gold: ['#D97706', '#FBBF24'],
  silver: ['#71717A', '#D4D4D8'], bronze: ['#A16207', '#E8A906'], discovery: ['#52525B', '#A1A1AA'],
};

/** "6-3 7-5" -> [[6,3],[7,5]] (mon score d'abord). */
export function parseSets(text: string | null): Array<[number, number]> {
  if (!text) return [];
  return text.trim().split(/[\s,]+/).flatMap((seg) => {
    const p = seg.split('-').map((n) => parseInt(n, 10));
    return p.length === 2 && !p.some(isNaN) ? [[p[0], p[1]] as [number, number]] : [];
  });
}

export const setsWon = (sets: Array<[number, number]>) => sets.filter(([a, b]) => a > b).length;
export const setsLost = (sets: Array<[number, number]>) => sets.filter(([a, b]) => a < b).length;

export const initialsOf = (name: string) =>
  (name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

/** Données passées aux stories. */
export interface StoryPlayer {
  name: string; league: string; level: number; rank: number;
  frmtRank?: string; frmtVerified?: boolean; fiability?: number; fiabilityLabel?: string;
  wins: number; losses: number; winRate: number; streak: number;
  recentForm: Array<'W' | 'L'>; club?: string;
}
export interface StoryMatchData {
  result: 'win' | 'loss'; sets: Array<[number, number]>;
  winners: string[]; losers: string[];
  location?: string; date?: string; type?: string; eloDelta?: string;
}
export interface InviteData {
  cta: string; link: string; appUrl?: string; showApp?: boolean; showQR?: boolean;
  qrValue: string; // URL réelle encodée dans le QR (deep link / lien de parrainage)
}
