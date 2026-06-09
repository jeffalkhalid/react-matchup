import { useColorScheme } from 'react-native';

// Tokens auth (splash + login) — voir design_handoff_auth_flow/README.md.
// L'accent jaune #FFC11A reste fixe quel que soit le thème.
export const AUTH_BRAND = '#FFC11A';
export const AUTH_SPLASH_BG = '#000000';
export const AUTH_ERROR_BORDER = '#EF4444';
export const AUTH_ERROR_TEXT = '#F87171';

export type AuthThemeTokens = {
  bg: string;
  cardBg: string;
  cardBorder: string;
  cardShadow: string;
  fieldBg: string;
  fieldBorder: string;
  fieldFocusBg: string;
  textPrimary: string;
  label: string;
  textSecondary: string;
  placeholder: string;
  fieldIcon: string;
  ctaBg: string;
  ctaText: string;
  wordmarkAsset: number;
};

const wordmarkDarkBg = require('../assets/auth/splash-wordmark.png');
const wordmarkLightBg = require('../assets/auth/splash-wordmark-dark.png');

const dark: AuthThemeTokens = {
  bg: '#0A0A0A',
  cardBg: '#151518',
  cardBorder: '#28282E',
  cardShadow: 'rgba(0,0,0,0.45)',
  fieldBg: '#131316',
  fieldBorder: '#2A2A30',
  fieldFocusBg: '#17171B',
  textPrimary: '#FFFFFF',
  label: '#9A9AA2',
  textSecondary: '#8A8A92',
  placeholder: '#5D5D66',
  fieldIcon: '#6E6E78',
  ctaBg: AUTH_BRAND,
  ctaText: '#0A0A0A',
  wordmarkAsset: wordmarkDarkBg,
};

const light: AuthThemeTokens = {
  bg: '#FFFFFF',
  cardBg: '#FFFFFF',
  cardBorder: '#E5E7EB',
  cardShadow: 'rgba(0,0,0,0.08)',
  fieldBg: '#F5F5F7',
  fieldBorder: '#E5E7EB',
  fieldFocusBg: '#FFFFFF',
  textPrimary: '#0A0A0A',
  label: '#6B7280',
  textSecondary: '#6B7280',
  placeholder: '#9CA3AF',
  fieldIcon: '#9CA3AF',
  ctaBg: '#0A0A0A',
  ctaText: '#FFFFFF',
  wordmarkAsset: wordmarkLightBg,
};

export function useAuthTheme(): { tokens: AuthThemeTokens; isDark: boolean } {
  const scheme = useColorScheme();
  const isDark = scheme !== 'light';
  return { tokens: isDark ? dark : light, isDark };
}
