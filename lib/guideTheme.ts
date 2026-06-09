// Thème clair/sombre + accents par rubrique pour les surfaces Guide (onboarding + aide).
// Isolé : seuls les composants du guide le consomment. Suit l'OS via useColorScheme().
// Miroir de design_handoff_onboarding_aide/kit.jsx (theme(mode) + RUBRIC).
import { useColorScheme } from 'react-native';

// Clé de persistance du 1er lancement — partagée par OnboardingCarousel et app/(tabs)/_layout.tsx.
export const GUIDE_KEY = 'matchup_guide_rn_v1';

export interface GuideTheme {
  mode: 'light' | 'dark';
  bg: string; bgAlt: string; card: string; cardAlt: string;
  border: string; divider: string; chip: string;
  text: string; sub: string; muted: string;
  ctaBg: string; ctaFg: string; overlay: string;
}

const LIGHT: GuideTheme = {
  mode: 'light',
  bg: '#F5F5F4', bgAlt: '#FAFAF9', card: '#FFFFFF', cardAlt: '#FAFAF9',
  border: '#E7E5E4', divider: '#F1F0EE', chip: '#F6F5F3',
  text: '#0A0A0A', sub: '#52525B', muted: '#A1A1AA',
  ctaBg: '#0A0A0A', ctaFg: '#FFFFFF', overlay: 'rgba(10,10,10,0.45)',
};

const DARK: GuideTheme = {
  mode: 'dark',
  bg: '#0A0A0A', bgAlt: '#08080A', card: '#151518', cardAlt: '#1A1A1E',
  border: '#28282E', divider: 'rgba(255,255,255,0.07)', chip: '#202026',
  text: '#FFFFFF', sub: '#8A8A92', muted: '#5D5D66',
  ctaBg: '#FFC11A', ctaFg: '#0A0A0A', overlay: 'rgba(0,0,0,0.6)',
};

export function useGuideTheme(): GuideTheme {
  return useColorScheme() === 'dark' ? DARK : LIGHT;
}

// Thème forcé (indépendant de l'OS) — l'onboarding utilise toujours le sombre,
// aligné sur l'écran de chargement (splash noir + logo blanc).
export function guideThemeFor(mode: 'light' | 'dark'): GuideTheme {
  return mode === 'dark' ? DARK : LIGHT;
}

export interface Rubric {
  key: string; accent: string; soft: string; emoji: string; title: string; sub: string;
}

// Accents par rubrique (fixes, indépendants du thème). Onboarding utilise accent/soft/emoji/title.
export const RUBRIC: Record<string, Rubric> = {
  welcome:   { key: 'welcome',   accent: '#E8A906', soft: 'rgba(232,169,6,0.12)',  emoji: '👋', title: 'Bienvenue',           sub: 'À quoi sert PagMatch' },
  lobby:     { key: 'lobby',     accent: '#2563EB', soft: 'rgba(37,99,235,0.10)',  emoji: '📋', title: 'Lobby',               sub: 'Trouve ou crée ta partie' },
  defis:     { key: 'defis',     accent: '#D97706', soft: 'rgba(217,119,6,0.11)',  emoji: '⚡', title: 'Défis',               sub: 'Affronte un joueur directement' },
  recherche: { key: 'recherche', accent: '#4F46E5', soft: 'rgba(79,70,229,0.10)',  emoji: '🔎', title: 'Recherche de joueurs', sub: 'Trouve qui défier ou inviter' },
  ranking:   { key: 'ranking',   accent: '#059669', soft: 'rgba(5,150,105,0.10)',  emoji: '🏆', title: 'Classement & Ligues', sub: 'Ton ELO, tes ligues' },
  chats:     { key: 'chats',     accent: '#0891B2', soft: 'rgba(8,145,178,0.11)',  emoji: '💬', title: 'Chats',               sub: 'Un fil par partie' },
  badges:    { key: 'badges',    accent: '#B45309', soft: 'rgba(180,83,9,0.11)',   emoji: '🎖️', title: 'Palmarès & Badges',  sub: 'Des trophées votés par tes adversaires' },
  stories:   { key: 'stories',   accent: '#DB2777', soft: 'rgba(219,39,119,0.10)', emoji: '📤', title: 'Stories & Partage',  sub: 'Partage et invite en 9:16' },
  faq:       { key: 'faq',       accent: '#7C3AED', soft: 'rgba(124,58,237,0.10)', emoji: '🆘', title: 'Dépannage',          sub: 'Un souci ? On te débloque' },
};
