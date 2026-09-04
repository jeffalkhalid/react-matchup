// components/admin/AdminJournal.tsx — le journal d'arbitrage.
// Implémente `design_handoff_panel_arbitre`, journal d'arbitrage.
//
// Rien ne gardait trace de ce que l'arbitre décide. Un match validé de force,
// un compte bloqué, un signalement classé : une fois l'écran refermé, il ne
// restait que l'état final, sans qui l'avait décidé ni quand.
//
// Le journal se lit comme un fil : par journée, la plus récente en haut, une
// ligne par décision. La recherche porte sur le nom de l'arbitre, celui du
// joueur concerné et le type d'action — les trois entrées par lesquelles on
// revient sur une décision.
//
// Les lignes sont écrites par la base, pas par cet écran (admin_actions_log.sql) :
// une décision ne PEUT pas être prise sans laisser de trace. Le tri, les
// libellés et le découpage par jour vivent dans lib/adminLog.ts avec leurs
// tests ; ici, il n'y a que du rendu.
import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import {
  actionLabel, actionTone, actionSummary, timeLabel, groupByDay,
  type AdminAction, type ActionTone,
} from '../../lib/adminLog';

const TONE_COLOR: Record<ActionTone, string> = {
  danger: Colors.danger,
  warning: Colors.warning,
  success: Colors.success,
  info: Colors.info,
  muted: Colors.textMuted,
};

function Entry({ a, onSubject }: { a: AdminAction; onSubject?: (id: string) => void }) {
  const tone = TONE_COLOR[actionTone(a.action)];
  const resume = actionSummary(a);
  const tappable = !!a.subject_id && !!onSubject;

  return (
    <TouchableOpacity
      onPress={() => a.subject_id && onSubject?.(a.subject_id)}
      disabled={!tappable}
      activeOpacity={0.75}
      style={{ flexDirection: 'row', gap: 10, paddingVertical: 9 }}
    >
      {/* La colonne de gauche tient le fil : l'heure, puis la pastille de
          couleur. On parcourt une journée en lisant une seule colonne. */}
      <View style={{ width: 42, alignItems: 'flex-end', paddingTop: 1 }}>
        <Text style={{ fontSize: 10.5, fontFamily: Fonts.uiExtraBold, color: Colors.textMuted }}>
          {timeLabel(a.created_at)}
        </Text>
      </View>
      <View style={{ width: 8, alignItems: 'center', paddingTop: 5 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone }} />
      </View>

      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
          {actionLabel(a.action)}
        </Text>
        {!!resume && (
          <Text numberOfLines={2} style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: Colors.textSecondary, lineHeight: 16 }}>
            {resume}
          </Text>
        )}
        <Text style={{ fontSize: 10.5, fontFamily: Fonts.ui, color: Colors.textMuted }}>
          par {a.actor_name ?? 'un compte supprimé'}
        </Text>
      </View>

      {tappable && <Icon name="chevronRight" size={15} color={Colors.textMuted} stroke={2.2} />}
    </TouchableOpacity>
  );
}

export function AdminJournal({
  actions, loading, loadingMore, hasMore, search, onSearch, onMore, onSubject,
}: {
  actions: AdminAction[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  search: string;
  onSearch: (q: string) => void;
  onMore: () => void;
  onSubject?: (playerId: string) => void;
}) {
  const groups = groupByDay(actions);

  return (
    <View style={{ gap: 12 }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 8,
        backgroundColor: Colors.bgCard, borderRadius: 13,
        borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12,
      }}>
        <Icon name="search" size={15} color={Colors.textMuted} stroke={2.3} />
        <TextInput
          value={search}
          onChangeText={onSearch}
          placeholder="Un arbitre, un joueur, un type de décision…"
          placeholderTextColor={Colors.textMuted}
          style={{ flex: 1, paddingVertical: 11, fontSize: 13, color: Colors.textPrimary }}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => onSearch('')} hitSlop={10} activeOpacity={0.7}>
            <Icon name="x" size={15} color={Colors.textMuted} stroke={2.5} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={{ paddingVertical: 30, alignItems: 'center' }}>
          <ActivityIndicator color={Colors.brand} />
        </View>
      ) : actions.length === 0 ? (
        <View style={{
          backgroundColor: Colors.bgCard, borderRadius: 16, padding: 24,
          alignItems: 'center', gap: 6, borderWidth: 1, borderColor: Colors.border,
        }}>
          <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
            {search ? 'Aucune décision trouvée' : 'Aucune décision enregistrée'}
          </Text>
          <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: Colors.textSecondary, textAlign: 'center', lineHeight: 17 }}>
            {search
              ? 'Essaie un autre nom, ou vide la recherche.'
              : 'Le journal se remplit tout seul dès la première décision prise depuis ce panel.'}
          </Text>
        </View>
      ) : (
        groups.map(g => (
          <View key={g.key} style={{
            backgroundColor: Colors.bgCard, borderRadius: 16,
            borderWidth: 1, borderColor: Colors.border, padding: 12,
          }}>
            <Text style={{
              fontSize: 10, fontFamily: Fonts.uiBlack, letterSpacing: 0.7,
              color: Colors.textMuted, textTransform: 'uppercase', marginBottom: 4,
            }}>
              {g.label}
            </Text>
            {g.items.map((a, i) => (
              <View key={a.id} style={
                i > 0 ? { borderTopWidth: 1, borderTopColor: Colors.borderLight } : undefined
              }>
                <Entry a={a} onSubject={onSubject} />
              </View>
            ))}
          </View>
        ))
      )}

      {hasMore && !loading && (
        <TouchableOpacity
          onPress={onMore}
          disabled={loadingMore}
          activeOpacity={0.85}
          style={{
            alignItems: 'center', paddingVertical: 13, borderRadius: 13,
            backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
            opacity: loadingMore ? 0.6 : 1,
          }}
        >
          {loadingMore
            ? <ActivityIndicator color={Colors.brand} size="small" />
            : <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiExtraBold, color: Colors.textPrimary }}>
                Voir plus ancien
              </Text>}
        </TouchableOpacity>
      )}
    </View>
  );
}

export default AdminJournal;
