// Thème clair/sombre du centre d'aide (« ? ») et de ses surfaces.
// Isolé : seuls les composants du guide le consomment. Suit l'OS via useColorScheme().
// Refonte « Guide d'aide » (design_handoff_guide_aide) : un SEUL accent — le jaune
// de la charte — les 9 accents par rubrique ont disparu avec l'ancien hub.
import { useColorScheme } from 'react-native';

// Clé de persistance du 1er lancement — posée par la visite guidée (components/tour/GuidedTour)
// et lue par app/(tabs)/_layout.tsx pour ne l'auto-ouvrir qu'une fois.
// « Me montrer sur l'écran » (spotlight rejoué depuis le guide) ne la touche JAMAIS.
export const GUIDE_KEY = 'matchup_guide_rn_v1';

// Jaune de la charte — fixe, indépendant du thème (pills « Tu es ici », anneau spotlight).
export const BRAND = '#FFC11A';

export interface GuideTheme {
  mode: 'light' | 'dark';
  bg: string; bgAlt: string; card: string; cardAlt: string;
  border: string; divider: string; chip: string;
  text: string; sub: string; muted: string;
  ctaBg: string; ctaFg: string; overlay: string;
  // Accent unique du guide. En clair, le jaune vif ne tient pas sur fond blanc :
  // les textes accentués passent en jaune profond ; les boutons pleins en noir (ctaBg).
  accent: string; accentSoft: string; accentBorder: string;
}

const LIGHT: GuideTheme = {
  mode: 'light',
  bg: '#F5F5F4', bgAlt: '#FAFAF9', card: '#FFFFFF', cardAlt: '#FAFAF9',
  border: '#E7E5E4', divider: '#F1F0EE', chip: '#F6F5F3',
  text: '#0A0A0A', sub: '#52525B', muted: '#A1A1AA',
  ctaBg: '#0A0A0A', ctaFg: '#FFFFFF', overlay: 'rgba(10,10,10,0.45)',
  accent: '#B98200', accentSoft: 'rgba(232,169,6,0.10)', accentBorder: 'rgba(232,169,6,0.45)',
};

const DARK: GuideTheme = {
  mode: 'dark',
  bg: '#0A0A0A', bgAlt: '#08080A', card: '#151518', cardAlt: '#1A1A1E',
  border: '#28282E', divider: 'rgba(255,255,255,0.07)', chip: '#202026',
  text: '#FFFFFF', sub: '#8A8A92', muted: '#5D5D66',
  ctaBg: '#FFC11A', ctaFg: '#0A0A0A', overlay: 'rgba(0,0,0,0.6)',
  accent: '#FFC11A', accentSoft: 'rgba(255,193,26,0.08)', accentBorder: 'rgba(255,193,26,0.34)',
};

export function useGuideTheme(): GuideTheme {
  return useColorScheme() === 'dark' ? DARK : LIGHT;
}
