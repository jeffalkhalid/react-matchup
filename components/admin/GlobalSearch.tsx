// components/admin/GlobalSearch.tsx — la barre de recherche du Panel Arbitre.
// Implémente `design_handoff_panel_arbitre`, barre de recherche globale.
//
// Le panel obligeait à savoir DANS QUEL ONGLET chercher avant de chercher.
// Quand on arrive avec un nom en tête — celui d'un joueur qui vient
// d'écrire — c'est la mauvaise question.
//
// La barre est au-dessus des onglets, toujours là. Tant qu'on n'y touche
// pas, elle ne prend qu'une ligne ; dès qu'on tape, les résultats
// RECOUVRENT le contenu de l'onglet plutôt que de s'insérer dedans : une
// recherche est une parenthèse, on y entre et on en ressort.
//
// Le classement et le repli des accents vivent dans lib/adminSearch.ts avec
// leurs tests. Ici, il n'y a que du rendu.
import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import { KIND_LABEL, MIN_QUERY, type SearchHit, type SearchKind } from '../../lib/adminSearch';

const TONE: Record<SearchKind, string> = {
  player: Colors.info,
  game: Colors.success,
  tournament: Colors.brandDeep,
};

export function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: Colors.bgCard, borderRadius: 13,
      borderWidth: 1, borderColor: value ? Colors.brand : Colors.border,
      paddingHorizontal: 12,
    }}>
      <Icon name="search" size={15} color={value ? Colors.brandDeep : Colors.textMuted} stroke={2.3} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Un joueur, une partie, un tournoi…"
        placeholderTextColor={Colors.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
        style={{ flex: 1, paddingVertical: 10, fontSize: 13, color: Colors.textPrimary }}
      />
      {value.length > 0 && (
        <TouchableOpacity onPress={() => onChange('')} hitSlop={10} activeOpacity={0.7}>
          <Icon name="x" size={15} color={Colors.textMuted} stroke={2.5} />
        </TouchableOpacity>
      )}
    </View>
  );
}

export function SearchResults({ query, hits, onPick }: {
  query: string;
  hits: SearchHit[];
  onPick: (hit: SearchHit) => void;
}) {
  // Sous le plancher, on explique au lieu de montrer une liste vide : « rien
  // trouvé » serait faux, on n'a simplement pas encore cherché.
  if (query.trim().length < MIN_QUERY) {
    return (
      <View style={{
        backgroundColor: Colors.bgCard, borderRadius: 16, padding: 22,
        alignItems: 'center', borderWidth: 1, borderColor: Colors.border,
      }}>
        <Text style={{ fontSize: 12.5, fontFamily: Fonts.ui, color: Colors.textSecondary, textAlign: 'center', lineHeight: 18 }}>
          Encore une lettre — la recherche démarre à {MIN_QUERY} caractères.
        </Text>
      </View>
    );
  }

  if (hits.length === 0) {
    return (
      <View style={{
        backgroundColor: Colors.bgCard, borderRadius: 16, padding: 22,
        alignItems: 'center', gap: 5, borderWidth: 1, borderColor: Colors.border,
      }}>
        <Text style={{ fontSize: 14.5, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
          Rien pour « {query.trim()} »
        </Text>
        <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: Colors.textSecondary, textAlign: 'center', lineHeight: 17 }}>
          La recherche porte sur les joueurs, les parties et les tournois déjà
          chargés dans le panel.
        </Text>
      </View>
    );
  }

  return (
    <View style={{
      backgroundColor: Colors.bgCard, borderRadius: 16,
      borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
    }}>
      {hits.map((h, i) => (
        <TouchableOpacity
          key={`${h.kind}:${h.id}`}
          onPress={() => onPick(h)}
          activeOpacity={0.75}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 10,
            paddingVertical: 11, paddingHorizontal: 12,
            borderTopWidth: i > 0 ? 1 : 0, borderTopColor: Colors.borderLight,
          }}
        >
          <View style={{
            backgroundColor: TONE[h.kind] + '1F', borderRadius: 999,
            paddingHorizontal: 8, paddingVertical: 3, minWidth: 62, alignItems: 'center',
          }}>
            <Text style={{ fontSize: 8.5, fontFamily: Fonts.uiBlack, letterSpacing: 0.5, color: TONE[h.kind] }}>
              {KIND_LABEL[h.kind]}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 13.5, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
              {h.title}
            </Text>
            <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>
              {h.subtitle}
            </Text>
          </View>
          <Icon name="chevronRight" size={15} color={Colors.textMuted} stroke={2.2} />
        </TouchableOpacity>
      ))}
    </View>
  );
}
