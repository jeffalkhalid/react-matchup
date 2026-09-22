// components/InvitePartnerSheet.tsx — « Amène ton partenaire ».
//
// Sur un défi nominatif, on a défié une PERSONNE : elle complète son camp
// avec qui elle veut. Rien ne le permettait — toutes les invitations
// partaient de l'assistant de création, donc un défi nominatif restait à
// trois pour toujours.
//
// Volontairement minimal : une recherche, une liste, un tap. Pas de
// suggestions ni de tri par compatibilité — on cherche quelqu'un de précis,
// pas un joueur au hasard.
import { useEffect, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts, formatPadelLevel } from '../lib/theme';
import { Icon } from './community/icons';
import { PlayerAvatar } from './PlayerAvatar';
import { supabase } from '../lib/supabase';

export interface PartnerCandidate {
  id: string;
  name: string;
  elo_score: number;
  avatar_path?: string | null;
}

export function InvitePartnerSheet({ visible, excludeIds, onClose, onPick, busyId }: {
  visible: boolean;
  /** Déjà dans la partie : on ne les propose pas. */
  excludeIds: string[];
  onClose: () => void;
  onPick: (p: PartnerCandidate) => void;
  /** Identifiant en cours d'invitation — évite le double tap. */
  busyId?: string | null;
}) {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PartnerCandidate[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (!visible) { setQ(''); setRows([]); } }, [visible]);

  useEffect(() => {
    if (!visible || q.trim().length < 2) { setRows([]); return; }
    setLoading(true);
    const t = setTimeout(() => {
      supabase.from('players')
        .select('id, name, elo_score, avatar_path')
        .is('deleted_at', null)
        .ilike('name', `%${q.trim()}%`)
        .limit(20)
        .then(({ data }) => {
          setRows(((data as any[]) ?? []).filter(p => !excludeIds.includes(p.id)).slice(0, 10));
          setLoading(false);
        });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, visible, excludeIds.join(',')]);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{
            backgroundColor: Colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22,
            paddingBottom: insets.bottom + 14, maxHeight: '80%',
          }}>
            <View style={{ alignItems: 'center', paddingTop: 10 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border }} />
            </View>

            <View style={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: 10 }}>
              <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 16, color: Colors.textPrimary }}>
                Amène ton partenaire
              </Text>
              <Text style={{ fontFamily: Fonts.ui, fontSize: 12.5, color: Colors.textSecondary, marginTop: 3, lineHeight: 17 }}>
                Il recevra une invitation. Le défi ne sera confirmé qu'une fois qu'il aura accepté.
              </Text>
            </View>

            <View style={{ paddingHorizontal: 18, paddingBottom: 10 }}>
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 8,
                backgroundColor: Colors.bgCard, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
                paddingHorizontal: 12, height: 46,
              }}>
                <Icon name="search" size={16} color={Colors.textMuted} stroke={2} />
                <TextInput
                  value={q}
                  onChangeText={setQ}
                  placeholder="Chercher un joueur"
                  placeholderTextColor={Colors.textMuted}
                  autoFocus
                  style={{ flex: 1, fontFamily: Fonts.ui, fontSize: 14, color: Colors.textPrimary }}
                />
                {loading ? <ActivityIndicator size="small" color={Colors.primary} /> : null}
              </View>
            </View>

            <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 8, gap: 8 }} keyboardShouldPersistTaps="handled">
              {q.trim().length < 2 ? (
                <Text style={{ fontFamily: Fonts.ui, fontSize: 12.5, color: Colors.textMuted, textAlign: 'center', paddingVertical: 20 }}>
                  Tape au moins deux lettres.
                </Text>
              ) : !loading && rows.length === 0 ? (
                <Text style={{ fontFamily: Fonts.ui, fontSize: 12.5, color: Colors.textMuted, textAlign: 'center', paddingVertical: 20 }}>
                  Aucun joueur trouvé.
                </Text>
              ) : rows.map(p => {
                const busy = busyId === p.id;
                return (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => onPick(p)}
                    disabled={!!busyId}
                    activeOpacity={0.8}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                      backgroundColor: Colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: Colors.border,
                      padding: 12, opacity: busyId && !busy ? 0.5 : 1,
                    }}
                  >
                    <PlayerAvatar name={p.name} path={p.avatar_path} size={44}
                      backgroundColor={Colors.brand} textColor={Colors.primary}
                      fontFamily={Fonts.uiBlack} fontSize={16} initialsMax={2} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontFamily: Fonts.uiBold, fontSize: 14, color: Colors.textPrimary }}>{p.name}</Text>
                      <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11.5, color: Colors.textMuted, marginTop: 1 }}>
                        Niv. {formatPadelLevel(p.elo_score)}
                      </Text>
                    </View>
                    {busy
                      ? <ActivityIndicator size="small" color={Colors.primary} />
                      : <Icon name="chevronRight" size={16} color={Colors.border} stroke={2.5} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export default InvitePartnerSheet;
