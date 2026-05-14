import { type League } from '../types';

export const Colors = {
  // Surfaces
  bg: '#F8FAFC',
  bgCard: '#FFFFFF',
  bgCardAlt: '#F1F5F9',

  // Borders
  border: '#E2E8F0',
  borderLight: '#F1F5F9',

  // Brand — indigo primary + emerald accent (aligned with web)
  primary: '#4F46E5',
  primaryDark: '#4338CA',
  primaryLight: '#6366F1',
  accent: '#10B981',
  accentDark: '#059669',
  accentLight: '#34D399',

  // Feedback
  danger: '#EF4444',
  warning: '#F59E0B',
  info: '#3B82F6',

  // Text
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',

  // Hero dark background (same as web #102820)
  heroBg: '#102820',

  league: {
    diamond: '#67E8F9',
    gold: '#FBBF24',
    silver: '#9CA3AF',
    bronze: '#F97316',
    discovery: '#34D399',
  },
} as const;

export const LeagueGradients: Record<League, string[]> = {
  diamond: ['#0EA5E9', '#67E8F9'],
  gold: ['#D97706', '#FBBF24'],
  silver: ['#6B7280', '#D1D5DB'],
  bronze: ['#B45309', '#F97316'],
  discovery: ['#059669', '#34D399'],
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const FontSize = {
  xs: 11,
  sm: 13,
  base: 15,
  md: 17,
  lg: 20,
  xl: 24,
  xxl: 30,
  xxxl: 36,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export function getLeague(elo: number): League {
  if (elo >= 1400) return 'diamond';
  if (elo >= 1200) return 'gold';
  if (elo >= 1000) return 'silver';
  if (elo >= 800) return 'bronze';
  return 'discovery';
}

export function getLeagueLabel(league: League): string {
  const labels: Record<League, string> = {
    diamond: 'Diamant',
    gold: 'Or',
    silver: 'Argent',
    bronze: 'Bronze',
    discovery: 'Découverte',
  };
  return labels[league];
}

const PADEL_ANCHORS: [number, number][] = [
  [0, 1.0], [650, 2.0], [800, 3.0], [950, 4.0],
  [1100, 5.0], [1250, 6.0], [1500, 7.0], [1750, 8.0],
];

export function eloToLevel(elo: number): number {
  if (elo <= 0) return 1.0;
  if (elo >= 1750) return 8.0;
  for (let i = 0; i < PADEL_ANCHORS.length - 1; i++) {
    const [eloLow, lvLow] = PADEL_ANCHORS[i];
    const [eloHigh, lvHigh] = PADEL_ANCHORS[i + 1];
    if (elo >= eloLow && elo < eloHigh) {
      const t = (elo - eloLow) / (eloHigh - eloLow);
      return Math.round((lvLow + t * (lvHigh - lvLow)) * 100) / 100;
    }
  }
  return 8.0;
}

export function padelLevelToElo(level: number): number {
  if (level <= 1.0) return 0;
  if (level >= 8.0) return 1750;
  for (let i = 0; i < PADEL_ANCHORS.length - 1; i++) {
    const [eloLow, lvLow] = PADEL_ANCHORS[i];
    const [eloHigh, lvHigh] = PADEL_ANCHORS[i + 1];
    if (level >= lvLow && level <= lvHigh) {
      const t = (level - lvLow) / (lvHigh - lvLow);
      return Math.round(eloLow + t * (eloHigh - eloLow));
    }
  }
  return 1750;
}

export function formatPadelLevel(elo: number): string {
  return eloToLevel(elo).toFixed(2);
}

export function getCompatTier(score: number): { label: string; emoji: string; color: string } {
  if (score >= 80) return { label: 'Top', emoji: '🔥', color: '#EF4444' };
  if (score >= 60) return { label: 'Élevé', emoji: '⚡', color: '#F59E0B' };
  if (score >= 40) return { label: 'Bon', emoji: '👍', color: '#10B981' };
  return { label: 'Faible', emoji: '〜', color: '#6B7280' };
}
