// components/tournaments/HiddenByFilters.tsx — ce que les filtres cachent.
// Implémente `design_handoff_tournois`, chantier 3.
//
// Le compteur disait déjà « 2 sur 7 · 3 filtres ». Il disait COMBIEN on cache,
// jamais QUOI. Et un filtre qui écarte une soirée du bon soir, au bon club,
// pour une raison qu'on a oubliée d'avoir cochée, se corrige tout de suite —
// à condition de voir ce qu'on rate.
//
// Les soirées masquées apparaissent donc en gris, repliées, avec la raison de
// leur mise à l'écart. Elles restent tapables : voir un tournoi qu'un filtre
// écarte ne doit pas empêcher d'y aller.
//
// Distinct du cul-de-sac (`FilterDeadEnd`), qui ne s'affiche que lorsque plus
// RIEN ne passe. Ici il reste des résultats — c'est un complément, pas un
// secours.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import {
  filterLabel, formatTournamentDate,
  type HiddenReason, type Tournament,
} from '../../lib/tournaments';

export function HiddenByFilters({ hidden, clubName, onPress }: {
  hidden: { tournament: Tournament; reason: HiddenReason }[];
  /** Le nom du club filtré, pour nommer la raison « clubId ». */
  clubName?: string;
  onPress: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (hidden.length === 0) return null;

  return (
    <View style={{ gap: 8, marginTop: 4 }}>
      <TouchableOpacity
        onPress={() => setOpen(o => !o)}
        activeOpacity={0.75}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 4 }}
      >
        <Icon name="eye" size={13} color={Colors.textMuted} stroke={2.2} />
        <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiExtraBold, color: Colors.textMuted }}>
          {hidden.length === 1
            ? '1 soirée masquée par tes filtres'
            : `${hidden.length} soirées masquées par tes filtres`}
        </Text>
        <View style={{ flex: 1 }} />
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} color={Colors.textMuted} stroke={2.3} />
      </TouchableOpacity>

      {open && hidden.map(({ tournament: t, reason }) => (
        <TouchableOpacity
          key={t.id}
          onPress={() => onPress(t.id)}
          activeOpacity={0.75}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 10,
            backgroundColor: Colors.bg, borderRadius: 13, padding: 11,
            borderWidth: 1, borderColor: Colors.borderLight,
            // Gris, pas caché : on lit qu'elles sont hors filtre sans avoir
            // à relire le libellé de chaque ligne.
            opacity: 0.62,
          }}
        >
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
              {t.name}
            </Text>
            <Text numberOfLines={1} style={{ fontSize: 10.5, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>
              {formatTournamentDate(t.starts_at)}
              {t.club?.name ? ` · ${t.club.name}` : ''}
            </Text>
          </View>
          {/* La raison, nommée : « écartée par Mon niveau » se corrige d'un
              tap sur la puce du haut, « aucun résultat » ne se corrige pas. */}
          <View style={{
            backgroundColor: Colors.bgCard, borderRadius: 999,
            paddingHorizontal: 8, paddingVertical: 3,
            borderWidth: 1, borderColor: Colors.border,
          }}>
            <Text style={{ fontSize: 9, fontFamily: Fonts.uiBlack, letterSpacing: 0.3, color: Colors.textMuted }}>
              {filterLabel(reason, clubName).toUpperCase()}
            </Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default HiddenByFilters;
