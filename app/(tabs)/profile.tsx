import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal,
  TextInput, Alert, ActivityIndicator, RefreshControl, StyleSheet,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../hooks/usePlayer';
import { supabase } from '../../lib/supabase';
import { Colors, getLeague, getLeagueLabel, eloToLevel } from '../../lib/theme';

// ─── Reusable row components ──────────────────────────────────
function NavRow({ icon, label, badge, onPress, danger, subtle }: {
  icon: string; label: string; badge?: number;
  onPress: () => void; danger?: boolean; subtle?: boolean;
}) {
  const textColor = danger ? (subtle ? '#94a3b8' : '#ef4444') : '#0f172a';
  const iconBg    = danger ? (subtle ? '#f8fafc' : '#fef2f2') : '#f8fafc';
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 16 }}>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 16 }}>{icon}</Text>
      </View>
      <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: textColor }}>{label}</Text>
      {badge != null && badge > 0 && (
        <View style={{ backgroundColor: '#4f46e5', borderRadius: 999, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}>
          <Text style={{ fontSize: 10, fontWeight: '900', color: '#fff' }}>{badge}</Text>
        </View>
      )}
      {!subtle && <Text style={{ fontSize: 18, color: '#cbd5e1' }}>›</Text>}
    </TouchableOpacity>
  );
}

function NotifRow({ emoji, title, sub, color, bg, onPress }: {
  emoji: string; title: string; sub: string;
  color: string; bg: string; onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 8, backgroundColor: bg, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: color + '30' }}>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: color + '22', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 18 }}>{emoji}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, fontWeight: '900', color }}>{title}</Text>
        <Text style={{ fontSize: 11, fontWeight: '600', color: color + 'aa', marginTop: 1 }}>{sub}</Text>
      </View>
      <Text style={{ fontSize: 16, color: color + '80' }}>›</Text>
    </TouchableOpacity>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <Text style={{ fontSize: 10, fontWeight: '900', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginHorizontal: 16, marginTop: 22, marginBottom: 6 }}>
      {title}
    </Text>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  return (
    <View style={[{ backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: '#e2e8f0', marginHorizontal: 16, overflow: 'hidden' }, style]}>
      {children}
    </View>
  );
}

function Divider() {
  return <View style={{ height: 1, backgroundColor: '#f1f5f9', marginLeft: 62 }} />;
}

// ─── Main screen ──────────────────────────────────────────────
export default function ProfileScreen() {
  const { player, refresh, signOut } = usePlayer();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [refreshing, setRefreshing] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const [challengeCount, setChallengeCount] = useState(0);
  const [pendingMatchCount, setPendingMatchCount] = useState(0);
  const [unreadChatCount, setUnreadChatCount] = useState(0);

  const fetchData = useCallback(async () => {
    if (!player) return;

    const [cRes, mRes] = await Promise.all([
      supabase.from('challenges').select('id', { count: 'exact', head: true }).eq('challenged_id', player.id).eq('status', 'pending'),
      supabase.from('matches').select('id', { count: 'exact', head: true })
        .or(`winner_id.eq.${player.id},loser_id.eq.${player.id},winner_id_2.eq.${player.id},loser_id_2.eq.${player.id}`)
        .eq('status', 'pending').neq('created_by', player.id),
    ]);

    setChallengeCount(cRes.count ?? 0);
    setPendingMatchCount(mRes.count ?? 0);

    // Unread chats
    const { data: reads } = await supabase.from('game_chat_reads').select('game_id, last_read_at').eq('player_id', player.id);
    const readMap = Object.fromEntries((reads ?? []).map((r: any) => [r.game_id, r.last_read_at]));
    const { data: parts } = await supabase.from('game_participants').select('game_id').eq('player_id', player.id).eq('status', 'accepted');
    const { data: created } = await supabase.from('open_games').select('id').eq('creator_id', player.id).in('status', ['open', 'closed']);
    const gameIds = [...new Set([...(parts ?? []).map((p: any) => p.game_id), ...(created ?? []).map((g: any) => g.id)])];

    let total = 0;
    await Promise.all(gameIds.slice(0, 15).map(async (gid) => {
      const lastRead = readMap[gid] ?? '1970-01-01';
      const { count } = await supabase.from('messages').select('id', { count: 'exact', head: true }).eq('game_id', gid).gt('created_at', lastRead).neq('player_id', player.id);
      total += count ?? 0;
    }));
    setUnreadChatCount(total);
  }, [player]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refresh(), fetchData()]);
    setRefreshing(false);
  };

  const handleSignOut = () => {
    Alert.alert('Déconnexion', 'Tu vas être déconnecté.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Se déconnecter', style: 'destructive', onPress: signOut },
    ]);
  };

  if (!player) return null;

  const league = getLeague(player.elo_score);
  const level = eloToLevel(player.elo_score);
  const leagueColor = Colors.league[league];
  const totalNotif = challengeCount + pendingMatchCount + unreadChatCount;

  return (
    <View style={{ flex: 1, backgroundColor: '#102820' }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
      >
        {/* ── Dark hero header ── */}
        <View style={{ backgroundColor: '#102820', paddingTop: insets.top + 10, paddingHorizontal: 20, paddingBottom: 28 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 20 }}>
            {/* Avatar */}
            <View style={{
              width: 60, height: 60, borderRadius: 18,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: leagueColor,
              shadowColor: leagueColor, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
            }}>
              <Text style={{ fontSize: 26, fontWeight: '900', color: '#fff' }}>{player.name.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 20, fontWeight: '900', color: '#fff', letterSpacing: -0.5 }} numberOfLines={1}>{player.name}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <View style={{ backgroundColor: leagueColor + '33', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: leagueColor + '55' }}>
                  <Text style={{ fontSize: 10, fontWeight: '900', color: leagueColor, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                    ● {getLeagueLabel(league)}
                  </Text>
                </View>
                {player.frmt_verified && (
                  <View style={{ backgroundColor: '#78350f33', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ fontSize: 10, fontWeight: '900', color: '#fbbf24' }}>🏆 FRMT</Text>
                  </View>
                )}
                {totalNotif > 0 && (
                  <View style={{ backgroundColor: '#f97316', borderRadius: 999, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}>
                    <Text style={{ fontSize: 10, fontWeight: '900', color: '#fff' }}>{totalNotif > 9 ? '9+' : totalNotif}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Stats row */}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {[
              { label: 'Niveau', value: level.toFixed(1), color: '#818cf8' },
              { label: 'Points', value: String(player.season_points ?? 0), color: '#34d399' },
              { label: 'Matchs', value: String(player.win_count + player.loss_count), color: '#94a3b8' },
            ].map(s => (
              <View key={s.label} style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 14, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                <Text style={{ fontSize: 20, fontWeight: '900', color: s.color }}>{s.value}</Text>
                <Text style={{ fontSize: 10, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── White content ── */}
        <View style={{ backgroundColor: '#f8fafc', borderTopLeftRadius: 24, borderTopRightRadius: 24, minHeight: 400 }}>

          {/* Notifications */}
          {(challengeCount > 0 || pendingMatchCount > 0 || unreadChatCount > 0) && (
            <>
              <SectionHeader title="Notifications" />
              {challengeCount > 0 && (
                <NotifRow emoji="⚔️" title={`${challengeCount} défi${challengeCount > 1 ? 's' : ''} reçu${challengeCount > 1 ? 's' : ''}`}
                  sub="En attente de ta réponse" color="#7c3aed" bg="#f5f3ff"
                  onPress={() => router.push('/(tabs)/matchmaking' as any)} />
              )}
              {pendingMatchCount > 0 && (
                <NotifRow emoji="📋" title={`${pendingMatchCount} score${pendingMatchCount > 1 ? 's' : ''} à valider`}
                  sub="Un adversaire a soumis un résultat" color="#d97706" bg="#fffbeb"
                  onPress={() => router.push('/(tabs)/index' as any)} />
              )}
              {unreadChatCount > 0 && (
                <NotifRow emoji="💬" title={`${unreadChatCount} message${unreadChatCount > 1 ? 's' : ''} non lu${unreadChatCount > 1 ? 's' : ''}`}
                  sub="Dans tes matchs actifs" color="#4f46e5" bg="#eef2ff"
                  onPress={() => router.push('/(tabs)/chats' as any)} />
              )}
            </>
          )}

          {/* Navigation */}
          <SectionHeader title="Navigation" />
          <Card>
            <NavRow icon="👤" label="Mon Profil complet" onPress={() => router.push(`/player/${player.id}` as any)} />
            <Divider />
            <NavRow icon="⚔️" label="Défi" badge={challengeCount} onPress={() => router.push('/(tabs)/matchmaking' as any)} />
            <Divider />
            <NavRow icon="🏆" label="Classement" onPress={() => router.push('/(tabs)/ranking' as any)} />
            <Divider />
            <NavRow icon="🔔" label="Notifications" badge={totalNotif > 0 ? totalNotif : undefined} onPress={() => router.push('/(tabs)/index' as any)} />
          </Card>

          {player.is_admin && (
            <>
              <SectionHeader title="Administration" />
              <Card>
                <NavRow icon="🛡️" label="Panel Arbitre" danger onPress={() => router.push('/admin' as any)} />
              </Card>
            </>
          )}

          {/* Account */}
          <SectionHeader title="Compte" />
          <Card style={{ marginBottom: 8 }}>
            <NavRow icon="✏️" label="Modifier le profil" onPress={() => setShowEdit(true)} />
            <Divider />
            <NavRow icon="🚪" label="Se déconnecter" danger onPress={handleSignOut} />
          </Card>
          <Card>
            <NavRow icon="🗑️" label="Supprimer mon compte" danger subtle onPress={() => setShowDelete(true)} />
          </Card>
        </View>
      </ScrollView>

      <EditProfileModal visible={showEdit} onClose={() => setShowEdit(false)} player={player} onSaved={refresh} />
      <DeleteAccountModal visible={showDelete} onClose={() => setShowDelete(false)} playerName={player.name} onConfirm={async () => { await supabase.from('players').delete().eq('id', player.id); signOut(); }} />
    </View>
  );
}

// ─── Edit profile modal ───────────────────────────────────────
function EditProfileModal({ visible, onClose, player, onSaved }: {
  visible: boolean; onClose: () => void;
  player: {
    id: string; name: string; gender?: string;
    court_side?: string; playing_days?: string[]; preferred_court?: string;
    frmt_rank?: string; clubs?: string[];
  };
  onSaved: () => void;
}) {
  const [name,           setName]           = useState(player.name);
  const [courtSide,      setCourtSide]      = useState(player.court_side ?? '');
  const [playingDays,    setPlayingDays]    = useState<string[]>(Array.isArray(player.playing_days) ? [...player.playing_days] : []);
  const [preferredCourt, setPreferredCourt] = useState(player.preferred_court ?? '');
  const [frmtRank,       setFrmtRank]       = useState(player.frmt_rank ?? '');
  const [clubs,          setClubs]          = useState(player.clubs?.join(', ') ?? '');
  const [loading,        setLoading]        = useState(false);

  // Sync state when modal reopens with fresh player data
  useEffect(() => {
    if (!visible) return;
    setName(player.name);
    setCourtSide(player.court_side ?? '');
    setPlayingDays(Array.isArray(player.playing_days) ? [...player.playing_days] : []);
    setPreferredCourt(player.preferred_court ?? '');
    setFrmtRank(player.frmt_rank ?? '');
    setClubs(player.clubs?.join(', ') ?? '');
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleDay = (day: string) =>
    setPlayingDays(days => days.includes(day) ? days.filter(d => d !== day) : [...days, day]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setLoading(true);
    const { error } = await supabase.from('players').update({
      name:            name.trim(),
      court_side:      courtSide || null,
      playing_days:    playingDays.length > 0 ? playingDays : null,
      preferred_court: preferredCourt || null,
      frmt_rank:       frmtRank.trim() || null,
      clubs:           clubs ? clubs.split(',').map(c => c.trim()).filter(Boolean) : [],
    }).eq('id', player.id);
    setLoading(false);
    if (error) Alert.alert('Erreur', error.message);
    else { await onSaved(); onClose(); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#f8fafc', padding: 20 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <Text style={{ fontSize: 18, fontWeight: '900', color: '#0f172a' }}>Modifier le profil</Text>
          <TouchableOpacity onPress={onClose} style={{ width: 32, height: 32, borderRadius: 999, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 14, color: '#64748b', fontWeight: '700' }}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 16 }}>

          {/* Pseudo */}
          <ModalField label="Pseudo affiché">
            <ModalInput value={name} onChange={setName} />
          </ModalField>

          {/* Genre — read-only */}
          <ModalField label="Genre">
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f172a' }}>
                {player.gender === 'male' ? '♂ Homme' : player.gender === 'female' ? '♀ Femme' : '—'}
              </Text>
              <Text style={{ fontSize: 11, color: '#94a3b8', fontWeight: '600' }}>Modifiable sur demande</Text>
            </View>
          </ModalField>

          {/* Côté de jeu */}
          <ModalField label="Côté préféré">
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[['left', 'Revers'], ['right', 'Drive'], ['both', 'Les deux']].map(([v, l]) => {
                const sel = courtSide === v;
                return (
                  <TouchableOpacity key={v} onPress={() => setCourtSide(sel ? '' : v)}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: sel ? '#4f46e5' : '#fff', borderWidth: 1.5, borderColor: sel ? '#4f46e5' : '#e2e8f0' }}>
                    <Text style={{ color: sel ? '#fff' : '#64748b', fontSize: 11, fontWeight: '700' }}>{l}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ModalField>

          {/* Jours préférés */}
          <ModalField label="Jours préférés">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(day => {
                const sel = playingDays.includes(day);
                return (
                  <TouchableOpacity key={day} onPress={() => toggleDay(day)}
                    style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5,
                      borderColor: sel ? '#4f46e5' : '#e2e8f0', backgroundColor: sel ? '#4f46e5' : '#fff' }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: sel ? '#fff' : '#64748b' }}>{day}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ModalField>

          {/* Terrain préféré */}
          <ModalField label="Terrain préféré">
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {['Intérieur', 'Extérieur', 'Les deux'].map(court => {
                const sel = preferredCourt === court;
                return (
                  <TouchableOpacity key={court} onPress={() => setPreferredCourt(sel ? '' : court)}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: sel ? '#4f46e5' : '#fff', borderWidth: 1.5, borderColor: sel ? '#4f46e5' : '#e2e8f0' }}>
                    <Text style={{ color: sel ? '#fff' : '#64748b', fontSize: 11, fontWeight: '700', textAlign: 'center' }}>{court}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ModalField>

          {/* Classement FRMT */}
          <ModalField label="Classement FRMT (numéro)">
            <ModalInput value={frmtRank} onChange={setFrmtRank} placeholder="Ex : 147" keyboardType="numeric" />
          </ModalField>

          {/* Clubs */}
          <ModalField label="Clubs (séparés par des virgules)">
            <ModalInput value={clubs} onChange={setClubs} placeholder="Racing Club, Tennis Park…" />
          </ModalField>

        </ScrollView>

        <TouchableOpacity onPress={handleSave} disabled={loading || !name.trim()}
          style={{ backgroundColor: '#4f46e5', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 16, opacity: (loading || !name.trim()) ? 0.6 : 1 }}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '900', fontSize: 15 }}>Enregistrer</Text>}
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ─── Delete account modal ─────────────────────────────────────
function DeleteAccountModal({ visible, onClose, playerName, onConfirm }: {
  visible: boolean; onClose: () => void; playerName: string; onConfirm: () => void;
}) {
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try { await onConfirm(); } catch { Alert.alert('Erreur', 'La suppression a échoué. Contacte le support.'); }
    setDeleting(false);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 24, width: '100%', maxWidth: 360 }}>
          <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: '#fef2f2', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 16 }}>
            <Text style={{ fontSize: 24 }}>🗑️</Text>
          </View>
          <Text style={{ fontSize: 18, fontWeight: '900', color: '#0f172a', textAlign: 'center', marginBottom: 8 }}>Supprimer mon compte</Text>
          <Text style={{ fontSize: 13, color: '#64748b', fontWeight: '500', textAlign: 'center', marginBottom: 20 }}>
            Cette action est <Text style={{ fontWeight: '900', color: '#0f172a' }}>irréversible</Text>. Ton profil, tes matchs et tes badges seront définitivement supprimés.
          </Text>
          <Text style={{ fontSize: 11, fontWeight: '900', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Tape ton pseudo pour confirmer
          </Text>
          <TextInput
            value={confirmText}
            onChangeText={setConfirmText}
            placeholder={playerName}
            placeholderTextColor="#cbd5e1"
            style={{ borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 12, padding: 12, fontSize: 14, fontWeight: '700', color: '#0f172a', marginBottom: 20 }}
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity onPress={onClose} style={{ flex: 1, backgroundColor: '#f1f5f9', borderRadius: 12, padding: 14, alignItems: 'center' }}>
              <Text style={{ fontSize: 14, fontWeight: '800', color: '#475569' }}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDelete} disabled={confirmText !== playerName || deleting}
              style={{ flex: 2, backgroundColor: '#ef4444', borderRadius: 12, padding: 14, alignItems: 'center', opacity: confirmText !== playerName || deleting ? 0.4 : 1 }}>
              {deleting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ fontSize: 14, fontWeight: '900', color: '#fff' }}>Supprimer définitivement</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Form helpers ─────────────────────────────────────────────
function ModalField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 12, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
      {children}
    </View>
  );
}

function ModalInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#94a3b8"
      style={{ backgroundColor: '#fff', borderRadius: 12, borderWidth: 1.5, borderColor: '#e2e8f0', color: '#0f172a', padding: 12, fontSize: 14, fontWeight: '600' }} />
  );
}
