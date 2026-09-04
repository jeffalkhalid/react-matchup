// components/admin/RefereeQueue.tsx — la file de travail de l'arbitre.
// Implémente `design_handoff_panel_arbitre`.
//
// Le panel demandait de visiter NEUF onglets pour savoir ce qu'il y avait à
// faire. Rien ne disait où était l'urgence, ni même s'il y avait quelque
// chose : il fallait ouvrir chaque onglet et compter.
//
// La file répond à « qu'est-ce que je dois traiter, et dans quel ordre ». Le
// tri vit dans `lib/refereeQueue.ts` avec ses tests — ici, il n'y a que du
// rendu.
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import {
  ageLabel, countByKind, KIND_LABEL, KIND_COUNTER,
  type QueueItem, type QueueKind,
} from '../../lib/refereeQueue';

/** La couleur d'un type — le liseré de la carte et sa pastille. */
const TONE: Record<QueueKind, string> = {
  dispute: Colors.danger,
  report: Colors.warning,
  frmt: Colors.info,
  gender: '#8B5CF6',
  tournament: Colors.success,
};

/** La rangée de compteurs : d'un coup d'œil, ce qui attend et de quel type. */
export function QueueCounters({ items, onPick }: {
  items: QueueItem[];
  onPick?: (kind: QueueKind) => void;
}) {
  const c = countByKind(items);
  const kinds: QueueKind[] = ['dispute', 'report', 'frmt', 'gender', 'tournament'];
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {kinds.map(k => (
        <TouchableOpacity
          key={k}
          onPress={() => onPick?.(k)}
          disabled={!onPick || c[k] === 0}
          activeOpacity={0.8}
          style={{
            flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 14,
            backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
            opacity: c[k] === 0 ? 0.45 : 1,
          }}
        >
          <Text style={{ fontSize: 20, fontFamily: Fonts.display, color: c[k] > 0 ? TONE[k] : Colors.textMuted }}>
            {c[k]}
          </Text>
          <Text style={{ fontSize: 8, fontFamily: Fonts.uiBlack, letterSpacing: 0.5, color: Colors.textMuted, marginTop: 1 }}>
            {KIND_COUNTER[k]}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/** Une carte de la file — type, âge, titre, ce qu'il faut savoir, contexte. */
export function QueueCard({ item, onPress }: { item: QueueItem; onPress: () => void }) {
  const tone = TONE[item.kind];
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={{
        flexDirection: 'row', overflow: 'hidden',
        backgroundColor: Colors.bgCard, borderRadius: 16,
        borderWidth: 1, borderColor: Colors.border,
        shadowColor: '#0A0A0A', shadowOpacity: 0.04, shadowRadius: 4,
        shadowOffset: { width: 0, height: 1 }, elevation: 1,
      }}
    >
      {/* Liseré de type : on identifie la nature du dossier avant de lire. */}
      <View style={{ width: 4, backgroundColor: tone }} />

      <View style={{ flex: 1, minWidth: 0, padding: 13, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ backgroundColor: tone + '22', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ fontSize: 9, fontFamily: Fonts.uiBlack, letterSpacing: 0.6, color: tone }}>
              {KIND_LABEL[item.kind]}
            </Text>
          </View>
          <View style={{ flex: 1 }} />
          <Text style={{ fontSize: 11, fontFamily: Fonts.uiExtraBold, color: Colors.textMuted }}>
            {ageLabel(item.createdAt)}
          </Text>
        </View>

        <Text numberOfLines={2} style={{ fontSize: 14.5, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, lineHeight: 19 }}>
          {item.title}
        </Text>

        {!!item.summary && (
          <Text numberOfLines={2} style={{ fontSize: 12.5, fontFamily: Fonts.ui, color: Colors.textSecondary, lineHeight: 17 }}>
            {item.summary}
          </Text>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 11, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>
            {item.context}
          </Text>
          {(item.flags ?? []).map(f => (
            <View key={f} style={{
              backgroundColor: Colors.danger + '18', borderRadius: 999,
              paddingHorizontal: 8, paddingVertical: 3,
            }}>
              <Text style={{ fontSize: 9, fontFamily: Fonts.uiBlack, letterSpacing: 0.4, color: Colors.danger }}>
                {f}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </TouchableOpacity>
  );
}

/** L'état « rien à traiter » — le plus fréquent, et il doit être agréable. */
export function QueueEmpty() {
  return (
    <View style={{
      backgroundColor: Colors.bgCard, borderRadius: 18, padding: 26,
      alignItems: 'center', gap: 6, borderWidth: 1, borderColor: Colors.border,
    }}>
      <Text style={{ fontSize: 16, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
        Rien à traiter
      </Text>
      <Text style={{ fontSize: 12.5, fontFamily: Fonts.ui, color: Colors.textSecondary, textAlign: 'center', lineHeight: 18 }}>
        Aucun litige, signalement, rattachement ni demande en attente.
      </Text>
    </View>
  );
}
