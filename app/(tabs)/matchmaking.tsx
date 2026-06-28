import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, StyleSheet, Image, Alert,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../hooks/usePlayer';
import { useNotificationCount } from '../../hooks/useNotificationCount';
import { Colors, eloToLevel, Fonts } from '../../lib/theme';
import { Pill } from '../../components/Pill';
import { HeaderActions } from '../../components/HeaderActions';
import { Icon, type IconName } from '../../components/community/icons';
import {
  fetchOpenDefis, fetchMyDefis, fetchCandidaturesOnMyDefis, fetchBinomeInvitations,
  acceptBinomeInvitation,
  type DefiGame, type DefiApplication,
} from '../../lib/defis';

// ── Types ─────────────────────────────────────────────────────
type Tab = 'relever' | 'mes' | 'candidatures' | 'invitations';

// ── Avatar ────────────────────────────────────────────────────
const AV_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#84cc16', '#ec4899', '#8b5cf6'];
function hashColor(name: string) {
  return AV_COLORS[(name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % AV_COLORS.length];
}
function PlayerAvatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: Math.round(size * 0.36), backgroundColor: hashColor(name), alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: Colors.textOnDark, fontSize: Math.round(size * 0.38), fontWeight: '900' }}>
        {(name || '?').charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

// ── Empty state ───────────────────────────────────────────────
function EmptyCard({ icon, title, sub }: { icon: IconName; title: string; sub: string }) {
  return (
    <View style={{ backgroundColor: Colors.bgCard, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, padding: 40, alignItems: 'center' }}>
      <View style={{ marginBottom: 10 }}>
        <Icon name={icon} size={40} color={Colors.textMuted} stroke={1.8} />
      </View>
      <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary, marginBottom: 4, textAlign: 'center' }}>{title}</Text>
      <Text style={{ fontSize: 12, color: Colors.textMuted, fontWeight: '600', textAlign: 'center' }}>{sub}</Text>
    </View>
  );
}

// ── 2v2 Défi card helpers ─────────────────────────────────────
function bandLabel(g: DefiGame): string {
  const lo = g.min_elo != null ? eloToLevel(g.min_elo).toFixed(1) : '?';
  const hi = g.max_elo != null ? eloToLevel(g.max_elo).toFixed(1) : '?';
  return `Moy. ${lo} → ${hi}`;
}

function DefiReleverCard({ game, myElo, onRelever }: { game: DefiGame; myElo: number; onRelever: () => void; }) {
  const teamA = (game.participants ?? []).filter(p => (p.team_side ?? '').startsWith('A') || p.player_id === game.creator_id);
  return (
    <View style={sty.card}>
      <View style={{ padding: 14, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <PlayerAvatar name={game.creator?.name ?? '?'} size={34} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>
              {game.creator?.name ?? '?'} & {teamA.find(p => p.player_id !== game.creator_id)?.player?.name ?? '—'}
            </Text>
            <Text style={{ fontSize: 10.5, color: Colors.textMuted }}>{bandLabel(game)}</Text>
          </View>
          <Pill variant="ink">⚡ ×{(game.stake_multiplier ?? 1).toFixed(1)}</Pill>
        </View>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {game.location ? <Pill variant="info">{game.location}</Pill> : null}
          {game.match_date ? <Pill variant="brand">{new Date(game.match_date).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</Pill> : null}
        </View>
        <TouchableOpacity onPress={onRelever} style={[sty.actionBtn, { backgroundColor: Colors.primary }]}>
          <Text style={{ color: Colors.textOnDark, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 13 }}>Relever — choisir mon binôme</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function MyDefiCard({ game }: { game: DefiGame }) {
  const label = game.status === 'draft' ? '⏳ Brouillon (partenaire pas encore OK)'
    : game.status === 'open' ? '🟢 Ouvert — en attente d\'un binôme'
    : '✅ Confirmé';
  return (
    <View style={sty.card}>
      <View style={{ padding: 14, gap: 6 }}>
        <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>{bandLabel(game)} · ⚡ ×{(game.stake_multiplier ?? 1).toFixed(1)}</Text>
        <Text style={{ fontSize: 11.5, color: Colors.textSecondary }}>{label}</Text>
        {game.location || game.match_date ? (
          <Text style={{ fontSize: 11, color: Colors.textMuted }}>
            {game.location ?? ''}{game.match_date ? ` · ${new Date(game.match_date).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function CandidatureCard({ app }: { app: DefiApplication }) {
  const locked = app.status === 'locked';
  return (
    <View style={sty.card}>
      <View style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <PlayerAvatar name={app.initiator?.name ?? '?'} size={32} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBold, fontWeight: '700', color: Colors.textPrimary }}>
            {app.initiator?.name ?? '?'} & {app.partner?.name ?? '?'}
          </Text>
          <Text style={{ fontSize: 10.5, color: Colors.textMuted }}>{locked ? '🏁 Binôme retenu' : '⏳ En attente du partenaire'}</Text>
        </View>
        <Pill variant={locked ? 'success' : 'neutral'}>{locked ? 'Retenu' : 'Pending'}</Pill>
      </View>
    </View>
  );
}

function BinomeInviteCard({ app, onAccept }: { app: DefiApplication; onAccept: () => void; }) {
  return (
    <View style={sty.card}>
      <View style={{ padding: 14, gap: 8 }}>
        <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBold, fontWeight: '700', color: Colors.textPrimary }}>
          {app.initiator?.name ?? '?'} t'invite comme binôme pour relever un défi
        </Text>
        {app.game ? <Text style={{ fontSize: 11, color: Colors.textMuted }}>{bandLabel(app.game)} · ⚡ ×{(app.game.stake_multiplier ?? 1).toFixed(1)}</Text> : null}
        <TouchableOpacity onPress={onAccept} style={[sty.actionBtn, { backgroundColor: Colors.brand }]}>
          <Text style={{ color: Colors.textOnBrand, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 13 }}>Accepter & verrouiller le binôme</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────
export default function MatchmakingScreen() {
  const { player } = usePlayer();
  const { reload: reloadNotifs } = useNotificationCount();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>('relever');
  const [openDefis, setOpenDefis] = useState<DefiGame[]>([]);
  const [myDefis, setMyDefis] = useState<DefiGame[]>([]);
  const [candidatures, setCandidatures] = useState<DefiApplication[]>([]);
  const [binomeInvites, setBinomeInvites] = useState<DefiApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const fetchData = useCallback(async () => {
    if (!player) return;
    setLoading(true);
    const [open, mine, cands, invites] = await Promise.all([
      fetchOpenDefis(player.id),
      fetchMyDefis(player.id),
      fetchCandidaturesOnMyDefis(player.id),
      fetchBinomeInvitations(player.id),
    ]);
    setOpenDefis(open);
    setMyDefis(mine);
    setCandidatures(cands);
    setBinomeInvites(invites);
    setLoading(false);
  }, [player]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));
  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const handleRelever = (_game: DefiGame) => {
    // Phase 3b : ouvrir un vrai sélecteur de partenaire (recherche + suggestions compat).
    // Phase 3a : on signale juste que l'action arrive.
    showToast('Choix du partenaire — bientôt (Phase 3b)');
  };

  const handleAcceptBinome = async (app: DefiApplication) => {
    try {
      const res = await acceptBinomeInvitation(app.id);
      showToast(res === 'locked' ? '✅ Binôme verrouillé — défi confirmé !' : '⏳ Trop tard : un autre binôme a pris la place');
      await fetchData();
      reloadNotifs();
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? 'Action impossible.');
    }
  };

  const pendingCount = binomeInvites.length + candidatures.filter(c => c.status === 'pending').length;

  if (!player) return null;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {/* Pastille Profil — alignée avec le logo (cohérent avec accueil/lobby/classement). */}
      <HeaderActions top={insets.top + 6} right={14} tint="light" />
      {/* Dark header */}
      <View style={{
        backgroundColor: Colors.heroBg,
        paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 16,
        borderBottomLeftRadius: 32, borderBottomRightRadius: 32,
      }}>
        {/* Brand lockup — raquette + wordmark PAGMATCH */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
          <Image
            source={require('../../assets/auth/splash-racket.png')}
            style={{ width: 22, height: 22 }}
            resizeMode="contain"
          />
          <Image
            source={require('../../assets/auth/splash-wordmark.png')}
            style={{ width: 100, height: 22, marginLeft: -7 }}
            resizeMode="contain"
          />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
          <View style={{ flex: 1 }} />
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontSize: 28, fontFamily: Fonts.welcome, color: Colors.textOnDark, letterSpacing: 0.2, textAlign: 'center' }}>
              Les <Text style={{ color: Colors.brand }}>Défis</Text>
            </Text>
            <Text style={{ fontSize: 12, fontFamily: Fonts.uiSemi, fontWeight: '600', color: Colors.textSecondary, marginTop: 2, textAlign: 'center' }}>Défis 2v2 & candidatures</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            {pendingCount > 0 && (
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.brand, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.brandDeep }}>{pendingCount}</Text>
              </View>
            )}
          </View>
        </View>
        <View style={{ flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 18, padding: 4, gap: 3 }}>
          {([
            { id: 'relever'      as Tab, label: 'À relever',  badge: 0 },
            { id: 'mes'          as Tab, label: 'Mes défis',  badge: 0 },
            { id: 'candidatures' as Tab, label: 'Candidat.',  badge: candidatures.filter(c => c.status === 'pending').length },
            { id: 'invitations'  as Tab, label: 'Binôme',     badge: binomeInvites.length },
          ]).map(t => {
            const active = tab === t.id;
            return (
              <TouchableOpacity key={t.id} onPress={() => setTab(t.id)} activeOpacity={0.7}
                style={{
                  flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
                  backgroundColor: active ? '#fff' : 'transparent', borderRadius: 14, paddingVertical: 9,
                }}>
                <Text style={{ color: active ? Colors.textPrimary : 'rgba(255,255,255,0.55)', fontSize: 11, fontFamily: Fonts.uiBlack, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                  {t.label}
                </Text>
                {t.badge > 0 && (
                  <View style={{ backgroundColor: active ? Colors.brand : 'rgba(255,255,255,0.2)', borderRadius: 999, paddingHorizontal: 5, paddingVertical: 1 }}>
                    <Text style={{ color: active ? Colors.brandDeep : Colors.textOnDark, fontSize: 9, fontFamily: Fonts.uiBlack, fontWeight: '900' }}>{t.badge}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ flex: 1 }} />
      ) : (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}>
          <View style={{ padding: 14, paddingBottom: 100 }}>
            {tab === 'relever' && (
              openDefis.length === 0
                ? <EmptyCard icon="swords" title="Aucun défi à relever" sub="Reviens plus tard, ou lance le tien." />
                : <View style={{ gap: 10 }}>
                    {openDefis.map(g => (
                      <DefiReleverCard key={g.id} game={g} myElo={player.elo_score}
                        onRelever={() => handleRelever(g)} />
                    ))}
                  </View>
            )}
            {tab === 'mes' && (
              myDefis.length === 0
                ? <EmptyCard icon="swords" title="Aucun défi créé" sub="Lance un défi depuis le bouton Créer." />
                : <View style={{ gap: 10 }}>
                    {myDefis.map(g => <MyDefiCard key={g.id} game={g} />)}
                  </View>
            )}
            {tab === 'candidatures' && (
              candidatures.length === 0
                ? <EmptyCard icon="users" title="Aucune candidature" sub="Les binômes qui relèvent tes défis apparaîtront ici." />
                : <View style={{ gap: 10 }}>
                    {candidatures.map(c => <CandidatureCard key={c.id} app={c} />)}
                  </View>
            )}
            {tab === 'invitations' && (
              binomeInvites.length === 0
                ? <EmptyCard icon="users" title="Aucune invitation" sub="Quand un joueur t'invite comme binôme pour relever un défi, c'est ici." />
                : <View style={{ gap: 10 }}>
                    {binomeInvites.map(c => <BinomeInviteCard key={c.id} app={c} onAccept={() => handleAcceptBinome(c)} />)}
                  </View>
            )}
          </View>
        </ScrollView>
      )}

      {toast && (
        <View style={{
          position: 'absolute', bottom: insets.bottom + 80, alignSelf: 'center',
          backgroundColor: Colors.heroBg, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 10,
          shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
        }}>
          <Text style={{ fontSize: 13, fontFamily: Fonts.uiBold, fontWeight: '700', color: Colors.textOnDark }}>{toast}</Text>
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────
const sty = StyleSheet.create({
  card: {
    backgroundColor: Colors.bgCard, borderRadius: 18,
    borderWidth: 1.5, borderColor: Colors.border, overflow: 'hidden',
    shadowColor: Colors.textPrimary, shadowOpacity: 0.04, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  actionBtn: {
    borderRadius: 13, padding: 12, alignItems: 'center',
  },
});
