import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, StyleSheet, Image, Alert, Modal, TextInput,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../hooks/usePlayer';
import { useNotificationCount } from '../../hooks/useNotificationCount';
import { Colors, eloToLevel, Fonts } from '../../lib/theme';
import { Pill } from '../../components/Pill';
import { HeaderActions } from '../../components/HeaderActions';
import { Icon, type IconName } from '../../components/community/icons';
import {
  fetchOpenDefis, fetchMyDefis, fetchCandidaturesOnMyDefis, fetchBinomeInvitations,
  acceptBinomeInvitation, applyToDefi, cancelDefi,
  type DefiGame, type DefiApplication,
} from '../../lib/defis';
import { fetchVitrine, type ShowcaseBinome } from '../../lib/showcase';
import { notifyPartnerInvitedToRelever, notifyDefiConfirmed } from '../../lib/defiNotify';
import { supabase } from '../../lib/supabase';
import { computeCompatDetail, getPlayerGameData, scoreElo, scoreClubs, scoreDays } from '../../lib/compat';

// ── Types ─────────────────────────────────────────────────────
type Tab = 'relever' | 'mes' | 'candidatures' | 'invitations' | 'vitrine';

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

function GhostAvatar({ size = 38 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderStyle: 'dashed',
      borderColor: Colors.border, backgroundColor: Colors.bgCardAlt, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.42, color: Colors.textMuted, fontWeight: '700' }}>?</Text>
    </View>
  );
}

function DefiReleverCard({ game, myElo, onRelever, compatScore }: { game: DefiGame; myElo: number; onRelever: () => void; compatScore?: number; }) {
  const teamA = (game.participants ?? []).filter(p => (p.team_side ?? '').startsWith('A') || p.player_id === game.creator_id);
  const partnerName = teamA.find(p => p.player_id !== game.creator_id)?.player?.name ?? '—';
  const avgLvl = game.min_elo != null ? eloToLevel(game.min_elo).toFixed(1) : '?';
  const hot = compatScore !== undefined && compatScore >= 60;
  const when = game.match_date
    ? new Date(game.match_date).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;
  return (
    <View style={[sty.card, { overflow: 'hidden' }]}>
      {/* bandeau accent */}
      <View style={{ height: 3, backgroundColor: hot ? Colors.brand : Colors.primary }} />
      <View style={{ padding: 14, gap: 12 }}>
        {/* Ligne VERSUS : paire créatrice vs binôme à trouver */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row' }}>
            <PlayerAvatar name={game.creator?.name ?? '?'} size={38} />
            <View style={{ marginLeft: -13 }}><PlayerAvatar name={partnerName} size={38} /></View>
          </View>
          <View style={{ flex: 1, marginLeft: 11 }}>
            <Text numberOfLines={1} style={{ fontSize: 13.5, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>
              {game.creator?.name ?? '?'} & {partnerName}
            </Text>
            <Text style={{ fontSize: 10.5, color: Colors.textMuted, fontWeight: '600', marginTop: 1 }}>moy. niv. {avgLvl}</Text>
          </View>
          <Text style={{ fontSize: 11, fontWeight: '900', color: Colors.textMuted, marginHorizontal: 8 }}>VS</Text>
          <View style={{ flexDirection: 'row' }}>
            <GhostAvatar />
            <View style={{ marginLeft: -13 }}><GhostAvatar /></View>
          </View>
        </View>

        {/* Bande de pills : mise, niveau, lieu, date, compat */}
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <View style={{ backgroundColor: Colors.primary, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ color: Colors.brand, fontSize: 11.5, fontFamily: Fonts.uiBlack, fontWeight: '900' }}>⚡ ×{(game.stake_multiplier ?? 1).toFixed(1)}</Text>
          </View>
          <Pill variant="brand">Niv. {avgLvl}+</Pill>
          {game.location ? <Pill variant="info">{game.location}</Pill> : null}
          {when ? <Pill variant="neutral">{when}</Pill> : null}
          {hot ? <Pill variant="warning">🔥 Compatible</Pill> : null}
        </View>

        {/* Bouton */}
        <TouchableOpacity onPress={onRelever} activeOpacity={0.85}
          style={{ backgroundColor: Colors.primary, borderRadius: 13, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7,
            shadowColor: Colors.primary, shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 }}>
          <Icon name="swords" size={15} color={Colors.brand} stroke={2.2} />
          <Text style={{ color: Colors.textOnDark, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 13.5, letterSpacing: 0.2 }}>Relever le défi</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function MyDefiCard({ game, onCancel }: { game: DefiGame; onCancel?: () => void }) {
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
        {onCancel && game.status !== 'confirmed' && (
          <TouchableOpacity onPress={onCancel}
            style={{ marginTop: 10, alignSelf: 'flex-start', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.bgCardAlt }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: Colors.danger }}>Annuler le défi</Text>
          </TouchableOpacity>
        )}
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

// ── Vitrine card ──────────────────────────────────────────────
function VitrineCard({ sb, onDefier }: { sb: ShowcaseBinome; onDefier: () => void }) {
  const a = sb.a;
  const b = sb.b;
  const avgElo = (a && b) ? (a.elo_score + b.elo_score) / 2 : null;
  const avgLevel = avgElo != null ? eloToLevel(avgElo).toFixed(1) : '?';
  return (
    <View style={[sty.card, { overflow: 'hidden' }]}>
      <View style={{ height: 3, backgroundColor: Colors.brand }} />
      <View style={{ padding: 14, gap: 12 }}>
        {/* Paire */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row' }}>
            <PlayerAvatar name={a?.name ?? '?'} size={38} />
            <View style={{ marginLeft: -13 }}><PlayerAvatar name={b?.name ?? '?'} size={38} /></View>
          </View>
          <View style={{ flex: 1, marginLeft: 11 }}>
            <Text numberOfLines={1} style={{ fontSize: 13.5, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>
              {a?.name ?? '?'} & {b?.name ?? '?'}
            </Text>
            <Text style={{ fontSize: 10.5, color: Colors.textMuted, fontWeight: '600', marginTop: 1 }}>moy. niv. {avgLevel}</Text>
          </View>
        </View>
        {/* Pills */}
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Pill variant="brand">Niv. {avgLevel}</Pill>
          {a && <Pill variant="neutral">{a.name.split(' ')[0]} Niv.{eloToLevel(a.elo_score).toFixed(1)}</Pill>}
          {b && <Pill variant="neutral">{b.name.split(' ')[0]} Niv.{eloToLevel(b.elo_score).toFixed(1)}</Pill>}
        </View>
        {/* Bouton */}
        <TouchableOpacity onPress={onDefier} activeOpacity={0.85}
          style={{ backgroundColor: Colors.primary, borderRadius: 13, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7,
            shadowColor: Colors.primary, shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 }}>
          <Icon name="swords" size={15} color={Colors.brand} stroke={2.2} />
          <Text style={{ color: Colors.textOnDark, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 13.5, letterSpacing: 0.2 }}>Défier ce binôme</Text>
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
  const [vitrine, setVitrine] = useState<ShowcaseBinome[]>([]);
  const [openDefis, setOpenDefis] = useState<DefiGame[]>([]);
  const [myDefis, setMyDefis] = useState<DefiGame[]>([]);
  const [candidatures, setCandidatures] = useState<DefiApplication[]>([]);
  const [binomeInvites, setBinomeInvites] = useState<DefiApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // ── Partner picker state ─────────────────────────────────────
  const [releverGame, setReleverGame] = useState<DefiGame | null>(null);
  const [partnerSearch, setPartnerSearch] = useState('');
  const [partnerResults, setPartnerResults] = useState<{ id: string; name: string; elo_score: number; court_side?: string }[]>([]);
  const [applying, setApplying] = useState(false);
  const [suggestedPartners, setSuggestedPartners] = useState<{ id: string; name: string; elo_score: number; court_side?: string; compatScore?: number }[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // ── Per-défi compat scores (for "À relever" sort) ────────────
  const myGameDataRef = useRef<{ clubs: Map<string, number>; days: Set<number> } | null>(null);
  const [defiCompatScores, setDefiCompatScores] = useState<Map<string, number>>(new Map());

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const fetchData = useCallback(async () => {
    if (!player) return;
    setLoading(true);
    const [open, mine, cands, invites, vit] = await Promise.all([
      fetchOpenDefis(player.id),
      fetchMyDefis(player.id),
      fetchCandidaturesOnMyDefis(player.id),
      fetchBinomeInvitations(player.id),
      fetchVitrine(player.id),
    ]);
    setOpenDefis(open);
    setMyDefis(mine);
    setCandidatures(cands);
    setBinomeInvites(invites);
    setVitrine(vit);
    setLoading(false);
  }, [player]);

  const router = useRouter();
  const launchDefi = () => router.push('/(tabs)/lobby?create=1&challenge=1' as any);

  const handleDefierBinome = (sb: ShowcaseBinome) => {
    const a = sb.a, b = sb.b;
    if (!a || !b) return;
    router.push(('/(tabs)/lobby?create=1&challenge=1&targeted=1'
      + `&b0=${a.id}&b0n=${encodeURIComponent(a.name)}&b0e=${a.elo_score}`
      + `&b1=${b.id}&b1n=${encodeURIComponent(b.name)}&b1e=${b.elo_score}`) as any);
  };

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));
  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  // Joueurs à EXCLURE du sélecteur de partenaire : moi + tous ceux déjà dans le
  // défi que je relève (créateur + son partenaire Team A). On ne peut pas prendre
  // comme binôme quelqu'un qui est déjà côté défieur (defi_apply le rejette aussi).
  const excludedPartnerIds = useMemo(() => {
    const s = new Set<string>();
    if (player) s.add(player.id);
    if (releverGame) {
      if (releverGame.creator_id) s.add(releverGame.creator_id);
      (releverGame.participants ?? []).forEach(p => p.player_id && s.add(p.player_id));
    }
    return s;
  }, [releverGame, player]);

  // ── Debounced player search ──────────────────────────────────
  useEffect(() => {
    if (partnerSearch.length < 2) { setPartnerResults([]); return; }
    const t = setTimeout(() => {
      supabase.from('players').select('id,name,elo_score,court_side')
        .is('deleted_at', null)
        .ilike('name', `%${partnerSearch}%`)
        .neq('id', player?.id ?? '')
        .limit(12)
        .then(({ data }) => {
          setPartnerResults(((data as any[]) || []).filter(p => !excludedPartnerIds.has(p.id)).slice(0, 8));
        });
    }, 300);
    return () => clearTimeout(t);
  }, [partnerSearch, player, excludedPartnerIds]);

  // ── Compute per-défi compat scores (drives "À relever" sort) ─
  useEffect(() => {
    if (!player || openDefis.length === 0) return;
    const myElo = player.elo_score;
    const myId = player.id;
    (async () => {
      // Load myGameData once; reuse the cached ref on subsequent openDefis changes
      if (!myGameDataRef.current) {
        myGameDataRef.current = await getPlayerGameData(myId);
      }
      const { clubs: myClubs, days: myDays } = myGameDataRef.current;
      const scores = new Map<string, number>();
      for (const g of openDefis) {
        const bandMid = ((g.min_elo ?? myElo) + (g.max_elo ?? myElo)) / 2;
        const elo = scoreElo(myElo, bandMid);
        const { score: club } = scoreClubs(myClubs, new Map(g.location ? [[g.location, 1]] : []));
        const { score: day } = scoreDays(myDays, new Set(g.match_date ? [new Date(g.match_date).getDay()] : []));
        scores.set(g.id, elo + club + day);
      }
      setDefiCompatScores(scores);
    })();
  }, [openDefis, player]);

  // ── Sorted "À relever" list (DESC by compat, then ASC by date) ─
  const sortedOpenDefis = useMemo(() => {
    if (defiCompatScores.size === 0) return openDefis;
    return [...openDefis].sort((a, b) => {
      const sa = defiCompatScores.get(a.id) ?? 0;
      const sb = defiCompatScores.get(b.id) ?? 0;
      if (sb !== sa) return sb - sa;
      // Fallback: earlier date first
      const da = a.match_date ? new Date(a.match_date).getTime() : Infinity;
      const db = b.match_date ? new Date(b.match_date).getTime() : Infinity;
      return da - db;
    });
  }, [openDefis, defiCompatScores]);

  // ── Load compat suggestions when modal opens ─────────────────
  useEffect(() => {
    if (!releverGame || !player) return;
    setLoadingSuggestions(true);
    const myId = player.id;
    (async () => {
      try {
        // 1) Frequent partners from matches
        const { data: recentMatches } = await supabase.from('matches')
          .select('winner_id,winner_id_2,loser_id,loser_id_2')
          .or(`winner_id.eq.${myId},winner_id_2.eq.${myId},loser_id.eq.${myId},loser_id_2.eq.${myId}`)
          .eq('status', 'validated').order('created_at', { ascending: false }).limit(30);
        if (!recentMatches?.length) { setLoadingSuggestions(false); return; }
        const freq: Record<string, number> = {};
        recentMatches.forEach((m: any) => {
          [m.winner_id, m.winner_id_2, m.loser_id, m.loser_id_2].forEach((id: string | null) => {
            if (id && id !== myId) freq[id] = (freq[id] || 0) + 1;
          });
        });
        const topIds = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => id);
        if (!topIds.length) { setLoadingSuggestions(false); return; }
        const { data: freqPlayers } = await supabase.from('players')
          .select('id,name,elo_score,court_side').in('id', topIds).is('deleted_at', null);
        if (!freqPlayers?.length) { setLoadingSuggestions(false); return; }
        // 2) Rank by compat
        const myData = await getPlayerGameData(myId);
        const ranked = await Promise.all(
          (freqPlayers as any[]).map(async (p) => {
            const compat = await computeCompatDetail(
              myId, player.elo_score, player.court_side,
              myData, p.id, p.elo_score, p.court_side,
            );
            return { ...p, compatScore: compat.score };
          }),
        );
        ranked.sort((a, b) => b.compatScore - a.compatScore);
        setSuggestedPartners(ranked.filter(p => !excludedPartnerIds.has(p.id)).slice(0, 5));
      } catch {
        // suggestions are optional — silent fail
      } finally {
        setLoadingSuggestions(false);
      }
    })();
  }, [releverGame, player, excludedPartnerIds]);

  const handleRelever = (game: DefiGame) => {
    setReleverGame(game);
    setPartnerSearch('');
    setPartnerResults([]);
    setSuggestedPartners([]);
  };

  // ── Submit candidature ───────────────────────────────────────
  const submitRelever = async (partner: { id: string; name: string }) => {
    if (!releverGame || applying) return;
    setApplying(true);
    try {
      await applyToDefi(releverGame.id, partner.id);
      notifyPartnerInvitedToRelever(partner.id, player?.name ?? '');
      setReleverGame(null);
      showToast(`Candidature envoyée — ${partner.name} doit accepter pour verrouiller le binôme.`);
      fetchData();
    } catch (e: any) {
      if (e?.message?.includes('out of level band')) {
        const lo = releverGame.min_elo != null ? eloToLevel(releverGame.min_elo).toFixed(1) : '?';
        const hi = releverGame.max_elo != null ? eloToLevel(releverGame.max_elo).toFixed(1) : '?';
        Alert.alert(
          'Niveau de la paire',
          `Pour relever ce défi, la paire doit avoir un niveau moyen entre ${lo} et ${hi}.\n\nLa moyenne de ${player?.name ?? 'toi'} + ${partner.name} est en dehors. Choisis un partenaire pour rapprocher la moyenne de cette fourchette.`,
        );
      } else if (e?.message?.includes('already in game')) {
        Alert.alert('Déjà engagés', 'Toi ou ton partenaire êtes déjà engagés sur ce défi.');
      } else {
        Alert.alert('Impossible', e?.message ?? 'Candidature impossible.');
      }
    } finally {
      setApplying(false);
    }
  };

  const handleAcceptBinome = async (app: DefiApplication) => {
    try {
      const res = await acceptBinomeInvitation(app.id);
      if (res === 'locked') notifyDefiConfirmed(app, player?.id ?? '');
      showToast(res === 'locked' ? '✅ Binôme verrouillé — défi confirmé !' : '⏳ Trop tard : un autre binôme a pris la place');
      await fetchData();
      reloadNotifs();
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? 'Action impossible.');
    }
  };

  const handleCancelDefi = (game: DefiGame) => {
    Alert.alert(
      'Annuler ce défi ?',
      game.status === 'draft'
        ? 'Ton brouillon sera supprimé.'
        : 'Le défi sera retiré et les candidatures en cours annulées.',
      [
        { text: 'Retour', style: 'cancel' },
        {
          text: 'Annuler le défi', style: 'destructive',
          onPress: async () => {
            try {
              await cancelDefi(game.id);
              showToast('Défi annulé.');
              fetchData();
            } catch (e: any) {
              Alert.alert('Erreur', e?.message ?? 'Annulation impossible.');
            }
          },
        },
      ],
    );
  };

  const pendingCount = binomeInvites.length + candidatures.filter(c => c.status === 'pending').length;

  if (!player) return null;

  // ── Partner Picker Modal ─────────────────────────────────────
  const partnerPickerModal = (
    <Modal
      visible={releverGame !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setReleverGame(null)}
    >
      <View style={{ flex: 1, backgroundColor: Colors.bg }}>
        {/* Header */}
        <View style={{
          backgroundColor: Colors.heroBg,
          paddingTop: 20, paddingHorizontal: 16, paddingBottom: 20,
          borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
          flexDirection: 'row', alignItems: 'center', gap: 10,
        }}>
          <TouchableOpacity onPress={() => setReleverGame(null)} style={{ padding: 4 }}>
            <Icon name="chevronLeft" size={22} color={Colors.textOnDark} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textOnDark }}>
              Choisis ton binôme pour relever
            </Text>
            {releverGame && (
              <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
                {bandLabel(releverGame)} · ⚡ ×{(releverGame.stake_multiplier ?? 1).toFixed(1)}
              </Text>
            )}
          </View>
          {applying && <ActivityIndicator color={Colors.brand} size="small" />}
        </View>

        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={{ padding: 14, gap: 12 }}>
            {/* Search input */}
            <TextInput
              style={{
                backgroundColor: Colors.bgCard,
                borderWidth: 1.5, borderColor: Colors.border,
                borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
                fontSize: 14, color: Colors.textPrimary,
                fontFamily: Fonts.uiSemi,
              }}
              placeholder="Rechercher un joueur…"
              placeholderTextColor={Colors.textMuted}
              value={partnerSearch}
              onChangeText={setPartnerSearch}
              autoFocus
              returnKeyType="search"
            />

            {/* Search results */}
            {partnerSearch.length >= 2 && partnerResults.length > 0 && (
              <View>
                <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                  Résultats
                </Text>
                <View style={{ gap: 8 }}>
                  {partnerResults.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      onPress={() => submitRelever(p)}
                      disabled={applying}
                      style={[sty.card, { opacity: applying ? 0.6 : 1 }]}
                      activeOpacity={0.75}
                    >
                      <View style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <PlayerAvatar name={p.name} size={38} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, fontFamily: Fonts.uiBold, fontWeight: '700', color: Colors.textPrimary }}>{p.name}</Text>
                          <Text style={{ fontSize: 11, color: Colors.textMuted }}>Niv. {eloToLevel(p.elo_score).toFixed(1)} · ELO {Math.round(p.elo_score)}</Text>
                        </View>
                        <Icon name="chevronRight" size={16} color={Colors.textMuted} />
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {partnerSearch.length >= 2 && partnerResults.length === 0 && (
              <Text style={{ textAlign: 'center', color: Colors.textMuted, fontSize: 13, paddingVertical: 16 }}>
                Aucun joueur trouvé
              </Text>
            )}

            {/* Suggestions (shown when search is empty) */}
            {partnerSearch.length < 2 && (
              <View>
                <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                  Suggérés pour toi
                </Text>
                {loadingSuggestions && (
                  <ActivityIndicator color={Colors.primary} style={{ marginVertical: 20 }} />
                )}
                {!loadingSuggestions && suggestedPartners.length === 0 && (
                  <Text style={{ textAlign: 'center', color: Colors.textMuted, fontSize: 12, paddingVertical: 12 }}>
                    Joue des parties pour voir des suggestions ici
                  </Text>
                )}
                {!loadingSuggestions && suggestedPartners.length > 0 && (
                  <View style={{ gap: 8 }}>
                    {suggestedPartners.map(p => (
                      <TouchableOpacity
                        key={p.id}
                        onPress={() => submitRelever(p)}
                        disabled={applying}
                        style={[sty.card, { opacity: applying ? 0.6 : 1 }]}
                        activeOpacity={0.75}
                      >
                        <View style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <PlayerAvatar name={p.name} size={38} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 13, fontFamily: Fonts.uiBold, fontWeight: '700', color: Colors.textPrimary }}>{p.name}</Text>
                            <Text style={{ fontSize: 11, color: Colors.textMuted }}>Niv. {eloToLevel(p.elo_score).toFixed(1)} · ELO {Math.round(p.elo_score)}</Text>
                          </View>
                          {p.compatScore !== undefined && (
                            <View style={{ backgroundColor: Colors.brand + '22', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
                              <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.brand }}>
                                ★ {p.compatScore}
                              </Text>
                            </View>
                          )}
                          <Icon name="chevronRight" size={16} color={Colors.textMuted} />
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );

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
            { id: 'vitrine'      as Tab, label: 'Ouverts',    badge: 0 },
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
            {/* CTA : lancer un défi (ouvre le wizard en mode Défi) */}
            <TouchableOpacity onPress={launchDefi} activeOpacity={0.85}
              style={{ backgroundColor: Colors.brand, borderRadius: 14, paddingVertical: 13, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginBottom: 14,
                shadowColor: Colors.brand, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 }}>
              <Icon name="swords" size={17} color={Colors.textOnBrand} stroke={2.4} />
              <Text style={{ color: Colors.textOnBrand, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 14.5, letterSpacing: 0.2 }}>Lancer un défi</Text>
            </TouchableOpacity>
            {tab === 'relever' && (
              openDefis.length === 0
                ? <EmptyCard icon="swords" title="Aucun défi à relever" sub="Reviens plus tard, ou lance le tien." />
                : <View style={{ gap: 10 }}>
                    {sortedOpenDefis.map(g => (
                      <DefiReleverCard key={g.id} game={g} myElo={player.elo_score}
                        onRelever={() => handleRelever(g)}
                        compatScore={defiCompatScores.get(g.id)} />
                    ))}
                  </View>
            )}
            {tab === 'mes' && (
              myDefis.length === 0
                ? <EmptyCard icon="swords" title="Aucun défi créé" sub="Lance un défi depuis le bouton Créer." />
                : <View style={{ gap: 10 }}>
                    {myDefis.map(g => <MyDefiCard key={g.id} game={g} onCancel={() => handleCancelDefi(g)} />)}
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
            {tab === 'vitrine' && (
              vitrine.length === 0
                ? <EmptyCard icon="users" title="Aucun binôme ouvert" sub="Déclare le tien depuis ton profil, ou reviens plus tard." />
                : <View style={{ gap: 10 }}>
                    {vitrine.map(sb => <VitrineCard key={sb.id} sb={sb} onDefier={() => handleDefierBinome(sb)} />)}
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

      {partnerPickerModal}
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
