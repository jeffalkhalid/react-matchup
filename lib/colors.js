// Source unique de vérité pour les couleurs PagMatch.
// Lu à la fois par lib/theme.ts (runtime) et par tailwind.config.js (build NativeWind).
// Identité : raquette jaune + balle, fond noir. Voir design_handoff_pagmatch_icon/README.md.

const Colors = {
  // Surfaces claires (UI courante)
  bg: '#F5F5F4',
  bgCard: '#FFFFFF',
  bgCardAlt: '#FAFAF9',
  bgCream: '#FAF5E8',

  // Surfaces sombres (hero, splash, sections immersives)
  bgDark: '#0A0A0A',
  bgDarkAlt: '#1A1A1C',
  bgDarkFrom: '#1A1A1C',
  bgDarkTo: '#08080A',

  // Borders
  border: '#E7E5E4',
  borderLight: '#F5F5F4',
  borderDark: 'rgba(255,255,255,0.1)',

  // Brand jaune — à utiliser avec parcimonie (accents, liens, pills, badges)
  brand: '#FFC11A',
  brandBright: '#FFD23F',
  brandDeep: '#E8A906',

  // Primary CTA = NOIR (boutons/FAB) selon charte
  primary: '#0A0A0A',
  primaryDark: '#000000',
  primaryLight: '#27272A',

  // Accent jaune (alias sémantique du brand pour les usages décoratifs)
  accent: '#FFC11A',
  accentDark: '#E8A906',
  accentLight: '#FFD23F',

  // Feedback
  danger: '#EF4444',
  warning: '#F59E0B',
  info: '#3B82F6',
  success: '#10B981',

  // Texte (sur fond clair)
  textPrimary: '#0A0A0A',
  textSecondary: '#52525B',
  textMuted: '#A1A1AA',
  textOnDark: '#FFFFFF',
  textOnBrand: '#0A0A0A',

  // Hero dark (aligné sur fond du logo)
  heroBg: '#0A0A0A',

  league: {
    diamond: '#67E8F9',
    gold: '#FBBF24',
    silver: '#A1A1AA',
    bronze: '#E8A906',
    discovery: '#71717A',
  },
};

const LeagueGradients = {
  diamond: ['#0EA5E9', '#67E8F9'],
  gold: ['#D97706', '#FBBF24'],
  silver: ['#71717A', '#D4D4D8'],
  bronze: ['#A16207', '#E8A906'],
  discovery: ['#52525B', '#A1A1AA'],
};

module.exports = { Colors, LeagueGradients };
