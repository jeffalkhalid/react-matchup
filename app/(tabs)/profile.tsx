import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal,
  TextInput, Alert, ActivityIndicator, RefreshControl, StyleSheet,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../hooks/usePlayer';
import { useNotificationCount } from '../../hooks/useNotificationCount';
import { supabase } from '../../lib/supabase';
import { Colors, getLeague, getLeagueLabel, eloToLevel, Fonts } from '../../lib/theme';

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
      <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: textColor, fontFamily: Fonts.uiBold }}>{label}</Text>
      {badge != null && badge > 0 && (
        <View style={{ backgroundColor: Colors.primary, borderRadius: 999, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}>
          <Text style={{ fontSize: 10, fontWeight: '900', color: Colors.textOnDark, fontFamily: Fonts.uiBlack }}>{badge}</Text>
        </View>
      )}
      {!subtle && <Text style={{ fontSize: 18, color: Colors.border }}>›</Text>}
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
        <Text style={{ fontSize: 13, fontWeight: '900', color, fontFamily: Fonts.uiBlack }}>{title}</Text>
        <Text style={{ fontSize: 11, fontWeight: '600', color: color + 'aa', marginTop: 1 }}>{sub}</Text>
      </View>
      <Text style={{ fontSize: 16, color: color + '80' }}>›</Text>
    </TouchableOpacity>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <Text style={{ fontSize: 10, fontWeight: '900', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginHorizontal: 16, marginTop: 22, marginBottom: 6, fontFamily: Fonts.uiBlack }}>
      {title}
    </Text>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  return (
    <View style={[{ backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, marginHorizontal: 16, overflow: 'hidden' }, style]}>
      {children}
    </View>
  );
}

function Divider() {
  return <View style={{ height: 1, backgroundColor: Colors.bgCardAlt, marginLeft: 62 }} />;
}

// LeaguePill — préserve les couleurs de ligue
function LeaguePill({ league }: { league: ReturnType<typeof getLeague> }) {
  const c = Colors.league[league];
  return (
    <View style={{ backgroundColor: c + '33', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: c + '55' }}>
      <Text style={{ fontSize: 10, color: c, textTransform: 'uppercase', letterSpacing: 0.8, fontFamily: Fonts.uiBlack }}>
        ● {getLeagueLabel(league)}
      </Text>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────
export default function ProfileScreen() {
  const { player, refresh, signOut } = usePlayer();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [refreshing, setRefreshing] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showComments, setShowComments] = useState(false);

  // Shared notification counts (same total as the Home bell). Unread chat
  // messages are intentionally excluded — they live on the Chats tab badge.
  const {
    challenges: challengeCount,
    toValidate: pendingMatchCount,
    invitations: invitationCount,
    trophies: trophyCount,
    toScore: toScoreCount,
    total: totalNotif,
    reload: reloadNotifs,
  } = useNotificationCount();

  useFocusEffect(useCallback(() => { reloadNotifs(); }, [reloadNotifs]));

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refresh(), reloadNotifs()]);
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

  return (
    <View style={{ flex: 1, backgroundColor: Colors.heroBg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
      >
        {/* ── Dark hero header ── */}
        <View style={{ backgroundColor: Colors.heroBg, paddingTop: insets.top + 10, paddingHorizontal: 20, paddingBottom: 28 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 20 }}>
            {/* Avatar */}
            <View style={{
              width: 60, height: 60, borderRadius: 18,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: leagueColor,
              shadowColor: leagueColor, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
            }}>
              <Text style={{ fontSize: 26, fontWeight: '900', color: Colors.textOnDark, fontFamily: Fonts.uiBlack }}>{player.name.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 26, color: Colors.textOnDark, letterSpacing: -0.5, fontFamily: Fonts.welcome }} numberOfLines={1}>
                Mon <Text style={{ color: Colors.brand }}>profil</Text>
              </Text>
              <Text style={{ fontSize: 14, fontWeight: '900', color: Colors.textOnDark, fontFamily: Fonts.uiBlack, marginTop: 2 }} numberOfLines={1}>{player.name}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <LeaguePill league={league} />
                {player.frmt_verified && (
                  <View style={{ backgroundColor: '#78350f33', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ fontSize: 10, fontWeight: '900', color: '#fbbf24', fontFamily: Fonts.uiBlack }}>🏆 FRMT</Text>
                  </View>
                )}
                {totalNotif > 0 && (
                  <View style={{ backgroundColor: '#f97316', borderRadius: 999, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}>
                    <Text style={{ fontSize: 10, fontWeight: '900', color: Colors.textOnDark, fontFamily: Fonts.uiBlack }}>{totalNotif > 9 ? '9+' : totalNotif}</Text>
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
              { label: 'Matchs', value: String(player.win_count + player.loss_count), color: Colors.textMuted },
            ].map(s => (
              <View key={s.label} style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 14, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                <Text style={{ fontSize: 20, fontWeight: '900', color: s.color, fontFamily: Fonts.uiBlack }}>{s.value}</Text>
                <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── White content ── */}
        <View style={{ backgroundColor: Colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, minHeight: 400 }}>

          {/* Notifications — same categories & total as the Home bell.
              Unread chat messages are NOT here (they're on the Chats tab). */}
          {totalNotif > 0 && (
            <>
              <SectionHeader title="Notifications" />
              {invitationCount > 0 && (
                <NotifRow emoji="✉️" title={`${invitationCount} invitation${invitationCount > 1 ? 's' : ''} reçue${invitationCount > 1 ? 's' : ''}`}
                  sub="Tu es attendu sur une partie" color="#0e7490" bg="rgba(8,145,178,0.10)"
                  onPress={() => router.push('/notifications' as any)} />
              )}
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
              {toScoreCount > 0 && (
                <NotifRow emoji="✍️" title={`${toScoreCount} match${toScoreCount > 1 ? 's' : ''} à scorer`}
                  sub="Saisis le score de tes parties jouées" color="#0d9488" bg="rgba(13,148,136,0.10)"
                  onPress={() => router.push('/(tabs)/lobby?tab=history' as any)} />
              )}
              {trophyCount > 0 && (
                <NotifRow emoji="🏅" title={`${trophyCount} match${trophyCount > 1 ? 's' : ''} à noter`}
                  sub="Distribue tes trophées" color="#b45309" bg="rgba(251,146,60,0.13)"
                  onPress={() => router.push('/(tabs)?openBadge=1' as any)} />
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
            <NavRow icon="🔔" label="Notifications" badge={totalNotif > 0 ? totalNotif : undefined} onPress={() => router.push('/notifications' as any)} />
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
            <NavRow icon="💬" label="Qui peut commenter mes activités" onPress={() => setShowComments(true)} />
            <Divider />
            <NavRow icon="🚪" label="Se déconnecter" danger onPress={handleSignOut} />
          </Card>

          {/* Légal */}
          <SectionHeader title="Légal" />
          <Card style={{ marginBottom: 8 }}>
            <NavRow icon="🔒" label="Politique de confidentialité" onPress={() => router.push('/legal/confidentialite' as any)} />
            <Divider />
            <NavRow icon="📄" label="Conditions d'utilisation" onPress={() => router.push('/legal/cgu' as any)} />
          </Card>

          <Card>
            <NavRow icon="🗑️" label="Supprimer mon compte" danger subtle onPress={() => setShowDelete(true)} />
          </Card>
        </View>
      </ScrollView>

      <EditProfileModal visible={showEdit} onClose={() => setShowEdit(false)} player={player} onSaved={refresh} />
      <CommentsPolicyModal visible={showComments} onClose={() => setShowComments(false)} player={player} onSaved={refresh} />
      <DeleteAccountModal visible={showDelete} onClose={() => setShowDelete(false)} playerName={player.name} onConfirm={async () => {
        // Purge serveur (données perso + anonymisation + suppression du compte auth)
        // via RPC SECURITY DEFINER — cf. supabase/migrations/account_deletion.sql.
        const { error } = await supabase.rpc('delete_my_account');
        if (error) { Alert.alert('Suppression impossible', error.message); return; }
        signOut();
      }} />
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
      <View style={{ flex: 1, backgroundColor: Colors.bg, padding: 20 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <Text style={{ fontSize: 22, color: Colors.textPrimary, fontFamily: Fonts.welcome }}>Modifier le <Text style={{ color: Colors.brand }}>profil</Text></Text>
          <TouchableOpacity onPress={onClose} style={{ width: 32, height: 32, borderRadius: 999, backgroundColor: Colors.bgCardAlt, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 14, color: Colors.textSecondary, fontWeight: '700' }}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 16 }}>

          {/* Pseudo */}
          <ModalField label="Pseudo affiché">
            <ModalInput value={name} onChange={setName} />
          </ModalField>

          {/* Genre — read-only */}
          <ModalField label="Genre">
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>
                {player.gender === 'male' ? '♂ Homme' : player.gender === 'female' ? '♀ Femme' : '—'}
              </Text>
              <Text style={{ fontSize: 11, color: Colors.textMuted, fontWeight: '600' }}>Modifiable sur demande</Text>
            </View>
          </ModalField>

          {/* Côté de jeu */}
          <ModalField label="Côté préféré">
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[['left', 'Gauche'], ['right', 'Droit'], ['both', 'Les deux']].map(([v, l]) => {
                const sel = courtSide === v;
                return (
                  <TouchableOpacity key={v} onPress={() => setCourtSide(sel ? '' : v)}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: sel ? 'rgba(255,193,26,0.14)' : Colors.bgCard, borderWidth: 1.5, borderColor: sel ? Colors.brand : Colors.border }}>
                    <Text style={{ color: sel ? Colors.brandDeep : Colors.textSecondary, fontSize: 11, fontWeight: '700', fontFamily: sel ? Fonts.uiExtraBold : Fonts.uiBold }}>{l}</Text>
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
                      borderColor: sel ? Colors.brand : Colors.border, backgroundColor: sel ? 'rgba(255,193,26,0.14)' : Colors.bgCard }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: sel ? Colors.brandDeep : Colors.textSecondary, fontFamily: sel ? Fonts.uiExtraBold : Fonts.uiBold }}>{day}</Text>
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
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: sel ? 'rgba(255,193,26,0.14)' : Colors.bgCard, borderWidth: 1.5, borderColor: sel ? Colors.brand : Colors.border }}>
                    <Text style={{ color: sel ? Colors.brandDeep : Colors.textSecondary, fontSize: 11, fontWeight: '700', textAlign: 'center', fontFamily: sel ? Fonts.uiExtraBold : Fonts.uiBold }}>{court}</Text>
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
          style={{ backgroundColor: Colors.primary, borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 16, opacity: (loading || !name.trim()) ? 0.6 : 1 }}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: Colors.textOnDark, fontWeight: '900', fontSize: 15, fontFamily: Fonts.uiBlack }}>Enregistrer</Text>}
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
        <View style={{ backgroundColor: Colors.bgCard, borderRadius: 24, padding: 24, width: '100%', maxWidth: 360 }}>
          <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: '#fef2f2', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 16 }}>
            <Text style={{ fontSize: 24 }}>🗑️</Text>
          </View>
          <Text style={{ fontSize: 18, fontWeight: '900', color: Colors.textPrimary, textAlign: 'center', marginBottom: 8, fontFamily: Fonts.uiBlack }}>Supprimer mon compte</Text>
          <Text style={{ fontSize: 13, color: Colors.textSecondary, fontWeight: '500', textAlign: 'center', marginBottom: 20 }}>
            Cette action est <Text style={{ fontWeight: '900', color: Colors.textPrimary }}>irréversible</Text>. Ton profil, tes matchs et tes badges seront définitivement supprimés.
          </Text>
          <Text style={{ fontSize: 11, fontWeight: '900', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Tape ton pseudo pour confirmer
          </Text>
          <TextInput
            value={confirmText}
            onChangeText={setConfirmText}
            placeholder={playerName}
            placeholderTextColor="#cbd5e1"
            style={{ borderWidth: 1.5, borderColor: Colors.border, borderRadius: 12, padding: 12, fontSize: 14, fontWeight: '700', color: Colors.textPrimary, marginBottom: 20 }}
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity onPress={onClose} style={{ flex: 1, backgroundColor: Colors.bgCardAlt, borderRadius: 12, padding: 14, alignItems: 'center' }}>
              <Text style={{ fontSize: 14, fontWeight: '800', color: Colors.textSecondary }}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDelete} disabled={confirmText !== playerName || deleting}
              style={{ flex: 2, backgroundColor: Colors.danger, borderRadius: 12, padding: 14, alignItems: 'center', opacity: confirmText !== playerName || deleting ? 0.4 : 1 }}>
              {deleting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ fontSize: 14, fontWeight: '900', color: Colors.textOnDark, fontFamily: Fonts.uiBlack }}>Supprimer définitivement</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Comments policy modal ────────────────────────────────────
function CommentsPolicyModal({ visible, onClose, player, onSaved }: {
  visible: boolean; onClose: () => void; player: any; onSaved: () => void;
}) {
  const options: { key: 'everyone' | 'friends' | 'nobody'; label: string; sub: string }[] = [
    { key: 'everyone', label: 'Tout le monde', sub: 'Tous les joueurs peuvent commenter.' },
    { key: 'friends', label: 'Amis', sub: 'Seuls tes amis (suivis dans un sens) peuvent commenter.' },
    { key: 'nobody', label: 'Personne', sub: 'Personne ne peut commenter tes activités.' },
  ];
  const current = (player?.comments_policy ?? 'friends') as 'everyone' | 'friends' | 'nobody';

  const choose = async (key: 'everyone' | 'friends' | 'nobody') => {
    const { error } = await supabase.from('players').update({ comments_policy: key }).eq('id', player.id);
    if (error) { Alert.alert('Erreur', "Le réglage n'a pas pu être enregistré."); return; }
    onSaved();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}}
          style={{ backgroundColor: Colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 34 }}>
          <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 16, color: Colors.textPrimary, marginBottom: 4 }}>
            Qui peut commenter mes activités
          </Text>
          <View style={{ marginTop: 10, gap: 8 }}>
            {options.map(o => {
              const on = o.key === current;
              return (
                <TouchableOpacity key={o.key} onPress={() => choose(o.key)} activeOpacity={0.8}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: on ? Colors.primary : Colors.border, backgroundColor: on ? Colors.primary + '12' : Colors.bgCard }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14, color: Colors.textPrimary }}>{o.label}</Text>
                    <Text style={{ fontFamily: Fonts.ui, fontSize: 12, color: Colors.textSecondary, marginTop: 2 }}>{o.sub}</Text>
                  </View>
                  {on && <Text style={{ fontSize: 16, color: Colors.primary }}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Form helpers ─────────────────────────────────────────────
function ModalField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 12, fontWeight: '800', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
      {children}
    </View>
  );
}

function ModalInput({ value, onChange, placeholder, keyboardType }: { value: string; onChange: (v: string) => void; placeholder?: string; keyboardType?: any }) {
  return (
    <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#94a3b8" keyboardType={keyboardType}
      style={{ backgroundColor: Colors.bgCard, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border, color: Colors.textPrimary, padding: 12, fontSize: 14, fontWeight: '600' }} />
  );
}
