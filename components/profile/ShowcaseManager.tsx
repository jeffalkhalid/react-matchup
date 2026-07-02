// components/profile/ShowcaseManager.tsx
// Gestion des binômes ouverts aux défis — accessible depuis la vue self du profil.
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, Modal, Pressable, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { Colors, Fonts } from '../../lib/theme';
import {
  fetchMyShowcases, fetchShowcaseInvites, openShowcase, confirmShowcase, closeShowcase,
  type ShowcaseBinome,
} from '../../lib/showcase';
import { notifyShowcaseNominated } from '../../lib/defiNotify';

// ── Types ────────────────────────────────────────────────────────────
interface PlayerLite { id: string; name: string; elo_score: number; }

interface Props {
  visible: boolean;
  onClose: () => void;
  player: { id: string; name: string };
}

// ── Helpers ──────────────────────────────────────────────────────────
function partnerOf(binome: ShowcaseBinome, myId: string): { id: string; name: string } | null {
  if (binome.player_a === myId) {
    return binome.b ? { id: binome.b.id, name: binome.b.name } : null;
  }
  return binome.a ? { id: binome.a.id, name: binome.a.name } : null;
}

function StatusBadge({ status }: { status: string }) {
  const isPending = status === 'pending';
  return (
    <View style={{
      borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
      backgroundColor: isPending ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.12)',
    }}>
      <Text style={{
        fontSize: 10, fontFamily: Fonts.uiBlack, fontWeight: '900', letterSpacing: 0.4,
        color: isPending ? '#D97706' : Colors.success,
      }}>
        {isPending ? 'EN ATTENTE' : 'ACTIF'}
      </Text>
    </View>
  );
}

// ── Main component ───────────────────────────────────────────────────
export default function ShowcaseManager({ visible, onClose, player }: Props) {
  const insets = useSafeAreaInsets();
  const [myShowcases, setMyShowcases] = useState<ShowcaseBinome[]>([]);
  const [invites, setInvites] = useState<ShowcaseBinome[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionIds, setActionIds] = useState<Set<string>>(new Set());

  // Partner search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlayerLite[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mine, inv] = await Promise.all([
        fetchMyShowcases(player.id),
        fetchShowcaseInvites(player.id),
      ]);
      setMyShowcases(mine);
      // fetchShowcaseInvites already returns only player_b=me+pending,
      // but we filter out any that are already in myShowcases to avoid dup display.
      const myIds = new Set(mine.map(b => b.id));
      setInvites(inv.filter(b => !myIds.has(b.id)));
    } finally {
      setLoading(false);
    }
  }, [player.id]);

  useEffect(() => {
    if (visible) {
      load();
      setShowSearch(false);
      setSearchQuery('');
      setSearchResults([]);
    }
  }, [visible, load]);

  // ── Debounced search ─────────────────────────────────────────────
  useEffect(() => {
    if (searchQuery.length < 2) { setSearchResults([]); return; }
    setSearchLoading(true);
    const t = setTimeout(() => {
      supabase.from('players')
        .select('id,name,elo_score')
        .is('deleted_at', null)
        .ilike('name', `%${searchQuery}%`)
        .neq('id', player.id)
        .limit(8)
        .then(({ data }) => {
          setSearchResults((data as PlayerLite[] | null) ?? []);
          setSearchLoading(false);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, player.id]);

  // ── Actions ──────────────────────────────────────────────────────
  const withAction = (id: string, fn: () => Promise<void>) => async () => {
    setActionIds(s => new Set(s).add(id));
    try { await fn(); await load(); }
    catch (e: any) { Alert.alert('Erreur', e?.message ?? 'Action impossible.'); }
    finally { setActionIds(s => { const n = new Set(s); n.delete(id); return n; }); }
  };

  const handleRemove  = (id: string) => withAction(id, () => closeShowcase(id))();

  const handleOpen = async (partner: PlayerLite) => {
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults([]);
    const key = `open-${partner.id}`;
    setActionIds(s => new Set(s).add(key));
    try {
      await openShowcase(partner.id);
      notifyShowcaseNominated(partner.id, player.name);
      await load();
      Alert.alert('Vitrine créée', `Tu as proposé à ${partner.name} d'être ton binôme ouvert aux défis. Il/Elle doit confirmer.`);
    } catch (e: any) {
      const msg: string = e?.message ?? '';
      if (msg.includes('showcase already exists') || msg.includes('duplicate') || msg.includes('unique')) {
        Alert.alert('Déjà existante', 'Tu as déjà une vitrine avec ce joueur.');
      } else {
        Alert.alert('Erreur', msg || 'Impossible de créer la vitrine.');
      }
    } finally {
      setActionIds(s => { const n = new Set(s); n.delete(key); return n; });
    }
  };

  // ── Render helpers ───────────────────────────────────────────────
  const renderBinomeRow = (b: ShowcaseBinome) => {
    const partner = partnerOf(b, player.id);
    if (!partner) return null;
    const busy = actionIds.has(b.id);
    return (
      <View key={b.id} style={{
        flexDirection: 'row', alignItems: 'center', gap: 10,
        paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: Colors.bgCardAlt,
      }}>
        {/* Avatar */}
        <View style={{
          width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.primary,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ color: Colors.textOnDark, fontSize: 13, fontWeight: '900' }}>
            {(partner.name[0] ?? '?').toUpperCase()}
          </Text>
        </View>

        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.textPrimary }} numberOfLines={1}>
            {partner.name}
          </Text>
          <StatusBadge status={b.status} />
        </View>

        <TouchableOpacity
          onPress={() => handleRemove(b.id)}
          disabled={busy}
          activeOpacity={0.7}
          style={{
            paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
            borderWidth: 1, borderColor: Colors.danger, opacity: busy ? 0.5 : 1,
          }}
        >
          {busy
            ? <ActivityIndicator size="small" color={Colors.danger} />
            : <Text style={{ fontSize: 11, fontWeight: '800', color: Colors.danger }}>Fermer</Text>
          }
        </TouchableOpacity>
      </View>
    );
  };

  const renderInviteRow = (b: ShowcaseBinome) => {
    const nominator = b.a ? { id: b.a.id, name: b.a.name } : null;
    if (!nominator) return null;
    const busyConfirm = actionIds.has(`confirm-${b.id}`);
    const busyDecline = actionIds.has(`decline-${b.id}`);
    const busy = busyConfirm || busyDecline;
    return (
      <View key={b.id} style={{
        backgroundColor: Colors.bgCard, borderRadius: 14, borderWidth: 1,
        borderColor: Colors.border, padding: 13, gap: 10,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{
            width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.brandDeep,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ color: '#0A0A0A', fontSize: 13, fontWeight: '900' }}>
              {(nominator.name[0] ?? '?').toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, color: Colors.textMuted }}>
              <Text style={{ fontWeight: '800', color: Colors.textPrimary }}>{nominator.name}</Text>
              {' '}veut être ton binôme ouvert aux défis
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            onPress={() => {
              const key = `decline-${b.id}`;
              setActionIds(s => new Set(s).add(key));
              closeShowcase(b.id)
                .then(() => load())
                .catch((e: any) => Alert.alert('Erreur', e?.message ?? 'Action impossible.'))
                .finally(() => setActionIds(s => { const n = new Set(s); n.delete(key); return n; }));
            }}
            disabled={busy}
            activeOpacity={0.7}
            style={{
              flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center',
              borderWidth: 1, borderColor: Colors.border, opacity: busy ? 0.5 : 1,
            }}
          >
            {busyDecline
              ? <ActivityIndicator size="small" color={Colors.textMuted} />
              : <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.textSecondary }}>Refuser</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              const key = `confirm-${b.id}`;
              setActionIds(s => new Set(s).add(key));
              confirmShowcase(b.id)
                .then(() => load())
                .catch((e: any) => Alert.alert('Erreur', e?.message ?? 'Action impossible.'))
                .finally(() => setActionIds(s => { const n = new Set(s); n.delete(key); return n; }));
            }}
            disabled={busy}
            activeOpacity={0.85}
            style={{
              flex: 1.5, paddingVertical: 9, borderRadius: 10, alignItems: 'center',
              backgroundColor: Colors.success, opacity: busy ? 0.5 : 1,
            }}
          >
            {busyConfirm
              ? <ActivityIndicator size="small" color={Colors.textOnDark} />
              : <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>Confirmer</Text>
            }
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ── JSX ──────────────────────────────────────────────────────────
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable onPress={() => {}}>
            <View style={{
              backgroundColor: Colors.bgCard,
              borderTopLeftRadius: 28, borderTopRightRadius: 28,
              maxHeight: '90%',
            }}>
              {/* Handle */}
              <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
                <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border }} />
              </View>

              {/* Header */}
              <View style={{
                paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                borderBottomWidth: 1, borderBottomColor: Colors.bgCardAlt,
              }}>
                <Text style={{ fontSize: 20, color: Colors.textPrimary, fontFamily: Fonts.welcome }}>
                  ⚔️ Binômes <Text style={{ color: Colors.brand }}>ouverts</Text>
                </Text>
                <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
                  <Text style={{ fontSize: 22, color: Colors.textMuted }}>×</Text>
                </TouchableOpacity>
              </View>

              <ScrollView
                style={{ maxHeight: 560 }}
                contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: insets.bottom + 28, gap: 24 }}
                keyboardShouldPersistTaps="handled"
              >
                {loading ? (
                  <ActivityIndicator color={Colors.primary} style={{ marginVertical: 32 }} />
                ) : (
                  <>
                    {/* ── Nominations à confirmer ── */}
                    {invites.length > 0 && (
                      <View style={{ gap: 10 }}>
                        <Text style={{
                          fontSize: 11, fontWeight: '700', letterSpacing: 1.4,
                          color: Colors.textMuted, textTransform: 'uppercase',
                        }}>
                          À confirmer
                        </Text>
                        {invites.map(renderInviteRow)}
                      </View>
                    )}

                    {/* ── Mes binômes ouverts ── */}
                    <View style={{ gap: 4 }}>
                      <Text style={{
                        fontSize: 11, fontWeight: '700', letterSpacing: 1.4,
                        color: Colors.textMuted, textTransform: 'uppercase', marginBottom: 4,
                      }}>
                        Mes binômes ouverts
                      </Text>
                      {myShowcases.length === 0 && (
                        <Text style={{ fontSize: 13, color: Colors.textMuted, fontStyle: 'italic', paddingVertical: 8 }}>
                          Aucun binôme pour l'instant.
                        </Text>
                      )}
                      {myShowcases.map(renderBinomeRow)}
                    </View>

                    {/* ── Ajouter un binôme ── */}
                    <View style={{ gap: 10 }}>
                      {!showSearch ? (
                        <TouchableOpacity
                          onPress={() => setShowSearch(true)}
                          activeOpacity={0.85}
                          style={{
                            flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                            gap: 8, paddingVertical: 13, borderRadius: 14,
                            backgroundColor: Colors.primary,
                          }}
                        >
                          <Text style={{ fontSize: 18, color: Colors.textOnDark }}>⚔️</Text>
                          <Text style={{
                            fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textOnDark,
                          }}>
                            M'ouvrir aux défis avec…
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={{ gap: 8 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <TextInput
                              autoFocus
                              value={searchQuery}
                              onChangeText={setSearchQuery}
                              placeholder="Rechercher un joueur…"
                              placeholderTextColor={Colors.textMuted}
                              style={{
                                flex: 1, backgroundColor: Colors.bg,
                                borderWidth: 1, borderColor: Colors.border, borderRadius: 12,
                                paddingHorizontal: 14, paddingVertical: 10,
                                fontSize: 14, fontWeight: '600', color: Colors.textPrimary,
                              }}
                            />
                            <TouchableOpacity
                              onPress={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]); }}
                              style={{ padding: 6 }}
                            >
                              <Text style={{ fontSize: 18, color: Colors.textMuted }}>×</Text>
                            </TouchableOpacity>
                          </View>

                          {searchLoading && (
                            <ActivityIndicator size="small" color={Colors.primary} style={{ marginTop: 4 }} />
                          )}

                          {searchResults.length > 0 && (
                            <View style={{
                              backgroundColor: Colors.bg, borderRadius: 14,
                              borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
                            }}>
                              {searchResults.map((p, idx) => (
                                <TouchableOpacity
                                  key={p.id}
                                  onPress={() => handleOpen(p)}
                                  activeOpacity={0.7}
                                  style={{
                                    flexDirection: 'row', alignItems: 'center', gap: 10,
                                    paddingHorizontal: 14, paddingVertical: 12,
                                    borderTopWidth: idx > 0 ? 1 : 0,
                                    borderTopColor: Colors.bgCardAlt,
                                  }}
                                >
                                  <View style={{
                                    width: 32, height: 32, borderRadius: 9,
                                    backgroundColor: Colors.bgCardAlt,
                                    alignItems: 'center', justifyContent: 'center',
                                  }}>
                                    <Text style={{ fontSize: 13, fontWeight: '800', color: Colors.textSecondary }}>
                                      {(p.name[0] ?? '?').toUpperCase()}
                                    </Text>
                                  </View>
                                  <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.textPrimary, flex: 1 }} numberOfLines={1}>
                                    {p.name}
                                  </Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          )}

                          {searchQuery.length >= 2 && !searchLoading && searchResults.length === 0 && (
                            <Text style={{ fontSize: 12, color: Colors.textMuted, textAlign: 'center', paddingVertical: 8 }}>
                              Aucun joueur trouvé.
                            </Text>
                          )}
                        </View>
                      )}
                    </View>
                  </>
                )}
              </ScrollView>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}
