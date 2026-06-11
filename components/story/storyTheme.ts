/* components/story/storyTheme.ts
 * Tokens + helpers pour les stories PagMatch (port RN des maquettes HTML).
 * S'appuie sur lib/theme (Colors, Fonts) déjà présent dans le repo. */
import { Colors, Fonts } from '../../lib/theme';
import { displayName, type JoinedPlayer } from '../../lib/players';

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

/** Éléments affichables/masquables sur une story de match. */
export interface StoryToggles {
  elo: boolean; location: boolean; date: boolean; type: boolean; qr: boolean; logo: boolean;
}

export const DEFAULT_TOGGLES: StoryToggles = {
  elo: true, location: true, date: true, type: true, qr: true, logo: true,
};

/** Options de personnalisation passées aux cartes de match. */
export interface StoryMatchOpts {
  accent?: string;        // couleur d'accent (override du jaune marque)
  caption?: string;       // légende libre
  bgUri?: string | null;  // photo de fond optionnelle
  toggles?: StoryToggles; // éléments à afficher/masquer
}

/** Palette d'accents sélectionnables pour personnaliser une story. */
export const STORY_ACCENTS: Array<{ id: string; name: string; color: string }> = [
  { id: 'brand',  name: 'Jaune',  color: Colors.brand },
  { id: 'green',  name: 'Vert',   color: Colors.success },
  { id: 'red',    name: 'Rouge',  color: Colors.danger },
  { id: 'blue',   name: 'Bleu',   color: '#3B82F6' },
  { id: 'violet', name: 'Violet', color: '#8B5CF6' },
  { id: 'cyan',   name: 'Cyan',   color: '#06B6D4' },
];

/** Ligne de match (DB) suffisante pour construire une StoryMatchData. */
export interface StoryMatchSource {
  winner_id?: string | null; loser_id?: string | null;
  winner_id_2?: string | null; loser_id_2?: string | null;
  winner?: JoinedPlayer | null; loser?: JoinedPlayer | null;
  winner_2?: JoinedPlayer | null; loser_2?: JoinedPlayer | null;
  score_text: string | null;
  is_challenge?: boolean | null;
  created_at: string;
  game?: { location: string | null; match_date: string | null } | null;
}

/** Construit la StoryMatchData orientée côté `playerId` (mon score d'abord),
 *  en anonymisant les comptes supprimés par rôle (Partenaire / Adversaire).
 *  Source unique réutilisée par le profil, le lobby et le sélecteur de match. */
export function buildStoryMatch(
  m: StoryMatchSource,
  playerId: string,
  opts?: { eloDelta?: string },
): StoryMatchData {
  const won = m.winner_id === playerId || m.winner_id_2 === playerId;
  const dateSrc = m.game?.match_date ?? m.created_at;
  // score_text est stocké côté vainqueur ; on l'oriente côté joueur.
  const raw = parseSets(m.score_text);
  const sets = won ? raw : raw.map(([a, b]) => [b, a] as [number, number]);
  const team = (
    a: JoinedPlayer | null | undefined,
    b: JoinedPlayer | null | undefined,
    role: 'partner' | 'opponent',
  ) => [a, b].filter(Boolean).map((p) => displayName(p as JoinedPlayer, role));
  return {
    result: won ? 'win' : 'loss',
    sets,
    winners: team(m.winner, m.winner_2, won ? 'partner' : 'opponent'),
    losers: team(m.loser, m.loser_2, won ? 'opponent' : 'partner'),
    location: m.game?.location ?? undefined,
    date: dateSrc
      ? new Date(dateSrc).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
      : undefined,
    type: m.is_challenge ? 'Défi' : 'Compétitif',
    eloDelta: opts?.eloDelta,
  };
}
