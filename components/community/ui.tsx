// Primitives UI partagées par les écrans Communauté.
// Reprennent le design system du handoff en réutilisant lib/theme.ts.
import React from 'react';
import { View, Text, TouchableOpacity, TextStyle, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from './icons';

// Tokens additionnels du handoff absents de lib/theme.
export const Chips = '#F6F5F3';     // fonds boutons icône / segmented inactif
export const Divider = '#F1F0EE';   // séparateurs internes
// Ex-crème neutralisé en blanc pur (cohérent avec lib/colors.js). Bordure neutre
// pour conserver la définition des cartes sur fond clair.
export const Cream = '#FFFFFF';
export const CreamBorder = '#E7E5E4';

// ─── Kicker ──────────────────────────────────────────────────
export function Kicker({ children, color = Colors.textMuted, style }: {
  children: React.ReactNode; color?: string; style?: TextStyle;
}) {
  return (
    <Text style={[{
      fontFamily: Fonts.uiBold, fontSize: 11, letterSpacing: 1.8,
      textTransform: 'uppercase', color,
    }, style]}>{children}</Text>
  );
}

// ─── Card ────────────────────────────────────────────────────
export function Card({ children, style, pad = 18 }: {
  children: React.ReactNode; style?: ViewStyle; pad?: number;
}) {
  return (
    <View style={[{
      backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
      borderRadius: 18, padding: pad,
      shadowColor: '#0F172A', shadowOpacity: 0.06, shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 }, elevation: 3,
    }, style]}>{children}</View>
  );
}

// ─── NavBar (retour + titre centré + slot droit) ─────────────
export function NavBar({ title, onBack, right }: {
  title: string; onBack: () => void; right?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center',
      paddingTop: insets.top + 8, paddingBottom: 8, paddingHorizontal: 14,
      backgroundColor: Colors.bgCard, borderBottomWidth: 1, borderBottomColor: Colors.border,
    }}>
      <TouchableOpacity onPress={onBack} activeOpacity={0.85} style={{
        width: 38, height: 38, borderRadius: 12, backgroundColor: Chips,
        borderWidth: 1, borderColor: Colors.border,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="chevronLeft" size={20} color={Colors.textPrimary} />
      </TouchableOpacity>
      <Text style={{
        flex: 1, textAlign: 'center', fontFamily: Fonts.uiBold, fontSize: 16,
        color: Colors.textPrimary,
      }}>{title}</Text>
      <View style={{ width: 38, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

// ─── Boutons ─────────────────────────────────────────────────
export function PrimaryBtn({ label, onPress, style }: {
  label: string; onPress: () => void; style?: ViewStyle;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[{
      backgroundColor: Colors.primary, borderRadius: 999, height: 54,
      alignItems: 'center', justifyContent: 'center',
    }, style]}>
      <Text style={{ color: '#fff', fontFamily: Fonts.uiExtraBold, fontSize: 15.5 }}>{label}</Text>
    </TouchableOpacity>
  );
}

export function BrandBtn({ label, icon, onPress, style }: {
  label: string; icon?: React.ReactNode; onPress: () => void; style?: ViewStyle;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[{
      backgroundColor: Colors.brand, borderRadius: 16, height: 52,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      shadowColor: Colors.brand, shadowOpacity: 0.4, shadowRadius: 18,
      shadowOffset: { width: 0, height: 6 }, elevation: 6,
    }, style]}>
      {icon}
      <Text style={{ color: Colors.primary, fontFamily: Fonts.uiExtraBold, fontSize: 16 }}>{label}</Text>
    </TouchableOpacity>
  );
}

export function GhostBtn({ label, onPress, style }: {
  label: string; onPress: () => void; style?: ViewStyle;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[{
      backgroundColor: Chips, borderWidth: 1, borderColor: Colors.border,
      borderRadius: 14, height: 50, alignItems: 'center', justifyContent: 'center',
    }, style]}>
      <Text style={{ color: Colors.textPrimary, fontFamily: Fonts.uiExtraBold, fontSize: 14 }}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Toggle (piste 46×28, pastille glissante) ────────────────
export function Toggle({ on, onPress }: { on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={{
      width: 46, height: 28, borderRadius: 999, padding: 3,
      backgroundColor: on ? Colors.brand : '#D9D7D3',
    }}>
      <View style={{
        width: 22, height: 22, borderRadius: 999, backgroundColor: '#fff',
        transform: [{ translateX: on ? 18 : 0 }],
        shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 3,
        shadowOffset: { width: 0, height: 1 }, elevation: 2,
      }} />
    </TouchableOpacity>
  );
}

// ─── Chip (sélection multi : jours, créneaux) ────────────────
export function Chip({ label, sub, on, onPress, pill, icon }: {
  label: string; sub?: string; on: boolean; onPress: () => void;
  pill?: boolean; icon?: React.ReactNode;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={{
      borderWidth: 1.5, borderColor: on ? Colors.brand : Colors.border,
      backgroundColor: on ? 'rgba(255,193,26,0.14)' : Colors.bgCard,
      borderRadius: pill ? 999 : 12,
      paddingVertical: 9, paddingHorizontal: pill ? 14 : 15,
      flexDirection: pill ? 'row' : 'column',
      alignItems: pill ? 'center' : 'flex-start', gap: pill ? 6 : 1,
    }}>
      {icon}
      <Text style={{
        fontFamily: Fonts.uiExtraBold, fontSize: pill ? 12.5 : 13.5,
        color: on ? Colors.brandDeep : Colors.textPrimary,
      }}>{label}</Text>
      {sub ? (
        <Text style={{
          fontFamily: Fonts.uiSemi, fontSize: 10.5,
          color: on ? Colors.brandDeep : Colors.textMuted,
        }}>{sub}</Text>
      ) : null}
    </TouchableOpacity>
  );
}
