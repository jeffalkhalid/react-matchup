// components/admin/TournamentToRun.tsx — la carte d'un tournoi dans l'onglet
// Tournois du panel. Implémente `design_handoff_panel_arbitre`.
//
// La liste montrait le nom, la date, le statut et le format — mais pas ce
// qu'il fallait FAIRE. L'organisateur ouvrait chaque tournoi pour découvrir
// qu'il n'y avait rien à y faire, ou au contraire qu'un tour attendait depuis
// une heure.
//
// Chaque carte porte donc UNE action principale, celle du moment, et rien
// d'autre. La barre segmentée dit où en est la soirée d'un coup d'œil.
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Pill } from '../Pill';
import {
  statusLabel, statusTone, formatTournamentDate, ROUND_MINUTES,
  type Tournament,
} from '../../lib/tournaments';

export interface NextAction {
  label: string;
  /** `brand` = le geste attendu maintenant ; `dark` = disponible, pas urgent. */
  tone: 'brand' | 'dark';
  onPress: () => void;
}

/**
 * La barre d'avancement des rotations. Segmentée plutôt que continue : on lit
 * « 3 sur 6 » sans chiffre, et un tournoi qui n'a pas commencé se distingue
 * d'un tournoi à mi-parcours au premier regard.
 */
function RoundBar({ done, total, tone }: { done: number; total: number; tone: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {Array.from({ length: Math.max(1, total) }, (_, i) => (
        <View key={i} style={{
          flex: 1, height: 5, borderRadius: 999,
          backgroundColor: i < done ? tone : Colors.borderLight,
        }} />
      ))}
    </View>
  );
}

export function TournamentToRun({ tournament: t, subtitle, action, onDetails }: {
  tournament: Tournament;
  /** La ligne de contexte — ce qui manque, ce qui est fait. */
  subtitle: string;
  /** L'action du moment. `null` quand il n'y a rien à faire. */
  action: NextAction | null;
  onDetails: () => void;
}) {
  const tone = statusTone(t.status);
  const barTone =
    t.status === 'TERMINE' || t.status === 'CLASSEMENT_VALIDE' ? Colors.textMuted
    : t.status === 'EN_COURS' ? Colors.success
    : Colors.brand;

  return (
    <View style={{
      backgroundColor: Colors.bgCard, borderRadius: 16, padding: 14, gap: 10,
      borderWidth: 1, borderColor: Colors.border,
      shadowColor: '#0A0A0A', shadowOpacity: 0.04, shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 }, elevation: 1,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pill variant={tone}>{statusLabel(t.status)}</Pill>
        <View style={{ flex: 1 }} />
        <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>
          {formatTournamentDate(t.starts_at)}
        </Text>
      </View>

      <View style={{ gap: 3 }}>
        <Text numberOfLines={1} style={{ fontSize: 15, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
          {t.name}
        </Text>
        <Text numberOfLines={2} style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: Colors.textSecondary, lineHeight: 16 }}>
          {subtitle}
        </Text>
      </View>

      <RoundBar done={t.current_round} total={t.round_count} tone={barTone} />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {action ? (
          <TouchableOpacity
            onPress={action.onPress}
            activeOpacity={0.85}
            style={{
              flex: 1, borderRadius: 13, paddingVertical: 13, alignItems: 'center',
              backgroundColor: action.tone === 'brand' ? Colors.brand : Colors.primary,
            }}
          >
            <Text style={{
              fontSize: 13.5, fontFamily: Fonts.uiBlack,
              color: action.tone === 'brand' ? Colors.primary : Colors.textOnDark,
            }}>
              {action.label}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <TouchableOpacity
          onPress={onDetails}
          activeOpacity={0.85}
          style={{
            borderRadius: 13, paddingVertical: 13, paddingHorizontal: 18,
            backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
          }}
        >
          <Text style={{ fontSize: 13, fontFamily: Fonts.uiExtraBold, color: Colors.textPrimary }}>
            Détails
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** L'invite de création, en tête de l'onglet — le format en une phrase. */
export function CreateTournamentCard({ onPress }: { onPress: () => void }) {
  return (
    <View style={{
      backgroundColor: Colors.bgCard, borderRadius: 16, padding: 16, gap: 12,
      borderWidth: 1, borderColor: Colors.border,
    }}>
      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 16, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
          Créer une soirée
        </Text>
        <Text style={{ fontSize: 12.5, fontFamily: Fonts.ui, color: Colors.textSecondary, lineHeight: 18 }}>
          Huit binômes, quatre terrains, six rotations de {ROUND_MINUTES} minutes.
          On monte vers le Terrain 1.
        </Text>
      </View>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.85}
        style={{ backgroundColor: Colors.brand, borderRadius: 14, paddingVertical: 15, alignItems: 'center' }}
      >
        <Text style={{ fontSize: 14.5, fontFamily: Fonts.uiBlack, color: Colors.primary }}>
          +  Nouveau tournoi
        </Text>
      </TouchableOpacity>
    </View>
  );
}
