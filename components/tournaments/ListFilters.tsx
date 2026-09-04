// components/tournaments/ListFilters.tsx — la barre de filtres de la liste des
// tournois, son compteur, et la sortie de secours quand tout est masqué.
// Implémente `design_handoff_tournois`, chantier 3.
//
// Tout est côté client : `fetchTournaments` remonte déjà tout, trié par date.
// La logique de filtrage vit dans `lib/tournaments.ts` avec ses tests — ici,
// il n'y a que du rendu.
import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import type { TournamentFilters } from '../../lib/tournaments';

export interface FilterChip {
  key: keyof TournamentFilters;
  label: string;
  active: boolean;
  onToggle: () => void;
}

export function FilterBar({ chips }: { chips: FilterChip[] }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 14 }}
      style={{ marginHorizontal: -14 }}
    >
      {chips.map(c => (
        <TouchableOpacity
          key={String(c.key)}
          onPress={c.onToggle}
          activeOpacity={0.8}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9,
            backgroundColor: c.active ? Colors.primary : Colors.bgCard,
            borderWidth: 1, borderColor: c.active ? Colors.primary : Colors.border,
          }}
        >
          {c.active && <Icon name="check" size={13} color={Colors.textOnDark} stroke={2.8} />}
          <Text style={{
            fontSize: 12.5, fontFamily: Fonts.uiExtraBold,
            color: c.active ? Colors.textOnDark : Colors.textPrimary,
          }}>
            {c.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

/** « 2 tournois sur 7 · 3 filtres » — le compteur dit toujours ce qu'on cache. */
export function FilterCounter({ kept, total, count, onClear }: {
  kept: number; total: number; count: number; onClear: () => void;
}) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: Colors.bgCard, borderRadius: 14,
      borderWidth: 1, borderColor: Colors.border,
      paddingHorizontal: 14, paddingVertical: 11,
    }}>
      <Text style={{ flex: 1, fontSize: 12.5, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>
        <Text style={{ fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
          {kept} tournoi{kept > 1 ? 's' : ''}
        </Text>
        {' '}sur {total} · {count} filtre{count > 1 ? 's' : ''}
      </Text>
      <TouchableOpacity onPress={onClear} hitSlop={8}>
        <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBlack, color: Colors.brandDeep }}>
          TOUT EFFACER
        </Text>
      </TouchableOpacity>
    </View>
  );
}

/**
 * La sortie de secours : plutôt qu'un « aucun résultat », on nomme le filtre
 * dont le retrait révèle le plus, et on propose de l'enlever d'un tap.
 *
 * Jamais un cul-de-sac — c'est la règle du handoff, et elle vaut d'être tenue :
 * un écran vide sans issue donne le sentiment que l'app est cassée.
 */
export function FilterDeadEnd({ unlocked, filterName, onDrop }: {
  unlocked: number; filterName: string; onDrop: () => void;
}) {
  return (
    <View style={{
      backgroundColor: Colors.bgCard, borderRadius: 18, padding: 20, gap: 6,
      alignItems: 'center', borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed',
    }}>
      <Text style={{ fontSize: 15.5, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, textAlign: 'center' }}>
        C’est tout pour ces filtres
      </Text>
      <Text style={{ fontSize: 12.5, fontFamily: Fonts.ui, color: Colors.textSecondary, textAlign: 'center', lineHeight: 18 }}>
        {unlocked} autre{unlocked > 1 ? 's' : ''} tournoi{unlocked > 1 ? 's' : ''} t’attend{unlocked > 1 ? 'ent' : ''}
        {'\n'}en retirant « {filterName} ».
      </Text>
      <TouchableOpacity
        onPress={onDrop}
        activeOpacity={0.85}
        style={{
          marginTop: 8, backgroundColor: Colors.primary, borderRadius: 14,
          paddingHorizontal: 20, paddingVertical: 12,
        }}
      >
        <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>
          Retirer ce filtre
        </Text>
      </TouchableOpacity>
    </View>
  );
}

/** Le titre d'un groupe : « MES INSCRIPTIONS », « CETTE SEMAINE »… */
export function GroupHeader({ label, count, tone }: {
  label: string; count: number; tone?: 'brand' | 'success' | 'muted';
}) {
  const color = tone === 'brand' ? Colors.brandDeep : tone === 'success' ? Colors.success : Colors.textMuted;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
      <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, letterSpacing: 1, color: Colors.textMuted }}>
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: Colors.border }} />
      <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBlack, color }}>{count}</Text>
    </View>
  );
}
