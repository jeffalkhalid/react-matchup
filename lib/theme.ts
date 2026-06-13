import { type League } from '../types';
import { Colors as ColorsRaw, LeagueGradients as LeagueGradientsRaw } from './colors';

export const Colors = ColorsRaw as {
  bg: string; bgCard: string; bgCardAlt: string; bgCream: string;
  bgDark: string; bgDarkAlt: string; bgDarkFrom: string; bgDarkTo: string;
  border: string; borderLight: string; borderDark: string;
  brand: string; brandBright: string; brandDeep: string;
  primary: string; primaryDark: string; primaryLight: string;
  accent: string; accentDark: string; accentLight: string;
  danger: string; warning: string; info: string; success: string;
  textPrimary: string; textSecondary: string; textMuted: string;
  textOnDark: string; textOnBrand: string;
  heroBg: string;
  league: Record<League, string>;
};

export const LeagueGradients = LeagueGradientsRaw as Record<League, string[]>;

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

// Polices bundlées via expo-font (voir app/_layout.tsx).
// - Inter : UI générale (labels, inputs, boutons, liens) — design system auth flow.
// - Barlow Condensed Italic Black : titres de bienvenue ("Bon retour sur la piste !").
// - Anton : display historique (wordmark hors PNG, gros titres legacy).
// - Manrope : tagline et UI uppercase (legacy, conservé pour compat).
export const Fonts = {
  display: 'Anton_400Regular',
  ui: 'Inter_500Medium',
  uiBold: 'Inter_700Bold',
  uiBlack: 'Inter_900Black',
  uiExtraBold: 'Inter_800ExtraBold',
  uiSemi: 'Inter_600SemiBold',
  welcome: 'BarlowCondensed_900Black_Italic',
  manrope: 'Manrope_600SemiBold',
  manropeBold: 'Manrope_700Bold',
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

// Échelle concave : bandes d'ELO qui s'élargissent vers le haut → plus on
// monte, plus un niveau coûte cher (ex. 7→8 = 350 ELO vs 2→3 = 150). Le bas
// est calé sur la réalité d'entrée (plancher signup ELO 800 ≈ niveau 1.7,
// vrai débutant, pas niveau 3). Plafonné à 8.0 (l'élite sature à 8). À
// re-caler une fois sur les vérifiés FRMT (cf.
// project_elo_level_scaling). Le matching lit l'ELO brut — ne jamais
// re-convertir un niveau en ELO ailleurs qu'à la création de match.
const PADEL_ANCHORS: [number, number][] = [
  [700, 1.0], [850, 2.0], [1000, 3.0], [1200, 4.0],
  [1400, 5.0], [1650, 6.0], [1950, 7.0], [2300, 8.0],
];

export function eloToLevel(elo: number): number {
  if (elo <= 700) return 1.0;
  if (elo >= 2300) return 8.0;
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
  if (level <= 1.0) return 700;
  if (level >= 8.0) return 2300;
  for (let i = 0; i < PADEL_ANCHORS.length - 1; i++) {
    const [eloLow, lvLow] = PADEL_ANCHORS[i];
    const [eloHigh, lvHigh] = PADEL_ANCHORS[i + 1];
    if (level >= lvLow && level <= lvHigh) {
      const t = (level - lvLow) / (lvHigh - lvLow);
      return Math.round(eloLow + t * (eloHigh - eloLow));
    }
  }
  return 2300;
}

export function formatPadelLevel(elo: number): string {
  return eloToLevel(elo).toFixed(2);
}

export function getCompatTier(score: number): { label: string; emoji: string; color: string } {
  if (score >= 80) return { label: 'Top', emoji: '🔥', color: Colors.danger };
  if (score >= 60) return { label: 'Élevé', emoji: '⚡', color: Colors.brand };
  if (score >= 40) return { label: 'Bon', emoji: '👍', color: Colors.success };
  return { label: 'Faible', emoji: '〜', color: Colors.textMuted };
}
