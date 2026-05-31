import React from 'react';
import { View, Text } from 'react-native';
import { Colors, Fonts } from '../lib/theme';

// Système Pill unifié, partagé par toute l'app.
// Variants alignés sur la charte PagMatch :
// - neutral : gris sobre (info passive, ⚧ Mixte)
// - brand   : jaune marque (Défi, état "spicy", filtres actifs)
// - success : vert (Inscrit, Mon niveau, Victoire)
// - warning : ambre (En attente, Limite, à scorer)
// - danger  : rouge (Urgent, Hors niveau, Défaite)
// - info    : bleu (♂ Hommes, info générique)
// - magenta : violet/rose (♀ Femmes)
// - ink     : noir doux (Compétitif, mode "standard")

export type PillVariant =
  | 'neutral' | 'brand' | 'success' | 'warning'
  | 'danger'  | 'info'  | 'magenta' | 'ink';

const PILL_STYLES: Record<PillVariant, { bg: string; fg: string; border: string }> = {
  neutral: { bg: Colors.bgCardAlt,        fg: Colors.textSecondary, border: Colors.border },
  brand:   { bg: 'rgba(255,193,26,0.14)', fg: Colors.brandDeep,     border: 'rgba(255,193,26,0.55)' },
  success: { bg: 'rgba(16,185,129,0.10)', fg: '#047857',            border: 'rgba(16,185,129,0.45)' },
  warning: { bg: 'rgba(245,158,11,0.12)', fg: '#B45309',            border: 'rgba(245,158,11,0.50)' },
  danger:  { bg: 'rgba(239,68,68,0.10)',  fg: '#B91C1C',            border: 'rgba(239,68,68,0.45)' },
  info:    { bg: 'rgba(59,130,246,0.10)', fg: '#1D4ED8',            border: 'rgba(59,130,246,0.45)' },
  magenta: { bg: 'rgba(217,70,239,0.10)', fg: '#A21CAF',            border: 'rgba(217,70,239,0.40)' },
  ink:     { bg: 'rgba(10,10,10,0.06)',   fg: Colors.textPrimary,   border: Colors.border },
};

export function Pill({ variant = 'neutral', icon, children }: {
  variant?: PillVariant;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const s = PILL_STYLES[variant];
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: s.bg, borderWidth: 1, borderColor: s.border,
      paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999,
    }}>
      {icon}
      <Text style={{
        color: s.fg, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase',
        fontFamily: Fonts.uiBlack,
      }}>
        {children}
      </Text>
    </View>
  );
}

// Helper : couleur "fg" du variant — utile pour les icônes accent (ex. swords sur Défi).
export function pillAccent(variant: PillVariant): string {
  return PILL_STYLES[variant].fg;
}
