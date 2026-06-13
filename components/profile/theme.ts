// ── PagMatch profile (refonte) — tokens & helpers ─────────────────────
// Palette reprise de la maquette « Profil PagMatch » (alignée sur lib/colors.js).
// Couleurs littérales = la charte ; on ne couple pas à Colors pour rester
// pixel-fidèle à la maquette validée.
import { Fonts } from '../../lib/theme';

export const PM = {
  ink:        '#0A0A0A',
  inkAlt:     '#141416',
  inkSoft:    '#1C1C1F',
  page:       '#F4F4F3',
  card:       '#FFFFFF',
  border:     '#E7E5E4',
  borderSoft: '#F0EEEC',
  divider:    '#EDEBE9',
  text:       '#0A0A0A',
  sub:        '#52525B',
  muted:      '#A1A1AA',
  faint:      '#C7C5C2',
  brand:      '#FFC11A',
  brandDeep:  '#E8A906',
  success:    '#10B981',
  successDk:  '#0E9E6E',
  danger:     '#EF4444',
} as const;

export interface Accent { deep: string; on: string; soft: string; line: string }

// Un seul accent en prod : l'or de marque (le panneau « Tweaks » de la maquette
// était un outil de design, non porté). accentOf garde la forme au cas où.
const ACCENTS: Record<string, Accent> = {
  '#FFC11A': { deep: '#E8A906', on: '#0A0A0A', soft: 'rgba(255,193,26,0.14)', line: 'rgba(255,193,26,0.45)' },
};

export const ACCENT = PM.brand;
export const accentOf = (hex: string = ACCENT): Accent => ACCENTS[hex] ?? ACCENTS['#FFC11A'];

export function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return (p.length >= 2 ? p[0][0] + p[1][0] : (p[0]?.[0] ?? '?')).toUpperCase();
}

// Familles de police mappées sur ce que l'app bundle (voir lib/theme Fonts).
export const PFonts = {
  anton:   Fonts.display,           // gros chiffres / display
  barlow:  Fonts.welcome,           // titres italiques condensés (noms)
  ui:      Fonts.ui,                // 500
  uiSemi:  Fonts.uiSemi,            // 600
  uiBold:  Fonts.uiBold,            // 700
  uiXBold: Fonts.uiExtraBold,       // 800
  uiBlack: Fonts.uiBlack,           // 900
} as const;
