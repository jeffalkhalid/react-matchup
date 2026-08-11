import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, StyleSheet, Image, Alert, Modal, TextInput,
} from 'react-native';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../hooks/usePlayer';
import { useNotificationCount } from '../../hooks/useNotificationCount';
import { Colors, eloToLevel, Fonts } from '../../lib/theme';
import { Pill } from '../../components/Pill';
import { HeaderActions } from '../../components/HeaderActions';
import { Icon, type IconName } from '../../components/community/icons';
import {
  fetchOpenDefis, fetchMyDefis, fetchDefisInvolved, fetchCandidaturesOnMyDefis,
  fetchMyApplications, fetchBinomeInvitations, fetchMyDefiInvites, defiGameWithMyBinome, defiOtherBinomeCount,
  acceptBinomeInvitation, declineBinomeInvitation, withdrawApplication, applyToDefi, cancelDefi,
  type DefiGame, type DefiApplication, type DefiInvite,
} from '../../lib/defis';
import { fetchVitrine, fetchActiveBinomes, type ShowcaseBinome } from '../../lib/showcase';
import { notifyPartnerInvitedToRelever, notifyDefiConfirmed, notifyReleverDeclined, notifyBinomeQueued, notifyBinomeWithdrawn } from '../../lib/defiNotify';
import { isCreatorConflict } from '../../lib/games';
import { notifyPlayers } from '../../lib/notify';
import { supabase } from '../../lib/supabase';
import { computeCompatDetail, getPlayerGameData, scoreElo, scoreClubs, scoreDays } from '../../lib/compat';
import { getHiddenPlayerIds } from '../../lib/moderation';
import { GameCard } from './lobby';

// ── Types ─────────────────────────────────────────────────────
type Tab = 'relever' | 'mes' | 'invitations' | 'vitrine';

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

// Carte de défi = la carte du lobby (GameCard) en LECTURE SEULE (aucun handler de
// join/change → grille non interactive) + un pied d'action propre au défi.
function DefiActionButton({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}
      style={{ backgroundColor: danger ? Colors.bgCardAlt : Colors.primary, borderRadius: 12, paddingVertical: 11,
        alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7,
        borderWidth: danger ? 1 : 0, borderColor: Colors.border }}>
      {!danger && <Icon name="swords" size={15} color={Colors.brand} stroke={2.2} />}
      <Text style={{ color: danger ? Colors.danger : Colors.textOnDark, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 13 }}>{label}</Text>
    </TouchableOpacity>
  );
}

function DefiGameCard({ game, myId, myElo, onPress, children }: { game: DefiGame; myId: string; myElo: number; onPress?: () => void; children?: ReactNode }) {
  // is_creator / my_status absents d'un DefiGame → sinon GameCard masque
  // calendrier + chat (gated sur `is_creator || my_status==='accepted'`).
  // On les dérive pour que le CRÉATEUR ET les participants ACCEPTÉS aient le pied complet.
  const mine = (game.participants ?? []).find(p => p.player_id === myId);
  const isCreator = game.creator_id === myId;
  return (
    <GameCard
      game={{ ...game, is_creator: isCreator, my_status: mine?.status } as any}
      variant="upcoming" myElo={myElo} playerId={myId}
      onPress={onPress ?? (() => {})}
      footerSlot={children}
    />
  );
}

function BinomeInviteCard({ app, onAccept, onDecline, busy }: { app: DefiApplication; onAccept: () => void; onDecline?: () => void; busy?: boolean; }) {
  return (
    <View style={sty.card}>
      <View style={{ padding: 14, gap: 10 }}>
        <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBold, fontWeight: '700', color: Colors.textPrimary }}>
          {app.initiator?.name ?? '?'} t'invite comme binôme pour relever un défi
        </Text>
        {app.game ? <Text style={{ fontSize: 11, color: Colors.textMuted }}>{bandLabel(app.game)} · ⚡ ×{(app.game.stake_multiplier ?? 1).toFixed(1)}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 8, opacity: busy ? 0.5 : 1 }}>
          {onDecline && (
            <TouchableOpacity onPress={onDecline} disabled={busy} style={[sty.actionBtn, { flex: 1, backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border }]}>
              <Text style={{ color: Colors.danger, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 13 }}>Refuser</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onAccept} disabled={busy} style={[sty.actionBtn, { flex: 1.6, backgroundColor: Colors.brand }]}>
            {busy
              ? <ActivityIndicator size="small" color={Colors.textOnBrand} />
              : <Text style={{ color: Colors.textOnBrand, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 13 }}>Accepter</Text>}
          </TouchableOpacity>
        </View>
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
  // Ouverture directe sur un onglet depuis une notif (ex. ?tab=invitations).
  const params = useLocalSearchParams<{ tab?: string; relever?: string }>();
  useEffect(() => {
    const t = params.tab;
    if (t === 'relever' || t === 'mes' || t === 'invitations' || t === 'vitrine') setTab(t);
  }, [params.tab]);
  const [vitrine, setVitrine] = useState<ShowcaseBinome[]>([]);
  const [myBinomes, setMyBinomes] = useState<{ id: string; name: string; elo_score: number }[]>([]);
  const [binomeBusy, setBinomeBusy] = useState<Set<string>>(new Set());   // anti double-submit accepter/refuser
  const [otherBinomeCounts, setOtherBinomeCounts] = useState<Record<string, number>>({});   // « X autres binômes » par défi candidaté
  const [partnerInvites, setPartnerInvites] = useState<DefiInvite[]>([]);   // invitations défi (binôme du créateur / défi ciblé)
  const [openDefis, setOpenDefis] = useState<DefiGame[]>([]);
  const [myDefis, setMyDefis] = useState<DefiGame[]>([]);
  const [candidatures, setCandidatures] = useState<DefiApplication[]>([]);
  const [myApplications, setMyApplications] = useState<DefiApplication[]>([]);
  const [binomeInvites, setBinomeInvites] = useState<DefiApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // ── Partner picker state ─────────────────────────────────────
  const [releverGame, setReleverGame] = useState<DefiGame | null>(null);
  const [partnerSearch, setPartnerSearch] = useState('');
  const [partnerResults, setPartnerResults] = useState<{ id: string; name: string; elo_score: number; court_side?: string }[]>([]);
  const [partnerBusy, setPartnerBusy] = useState<Set<string>>(new Set()); // résultats occupés au créneau du défi
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());     // joueurs bloqués (modération, 2 sens)
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
    const [open, mine, cands, myApps, invites, vit, actives, pInvites] = await Promise.all([
      fetchOpenDefis(player.id),
      fetchDefisInvolved(player.id),   // « Mes défis » = créés + où je joue
      fetchCandidaturesOnMyDefis(player.id),
      fetchMyApplications(player.id),  // mes candidatures sortantes (pour « déjà postulé »)
      fetchBinomeInvitations(player.id),
      fetchVitrine(player.id),
      fetchActiveBinomes(player.id),   // « Mes binômes » (paires actives)
      fetchMyDefiInvites(player.id),   // invitations défi (binôme du créateur / ciblé)
    ]);
    setOpenDefis(open);
    setMyDefis(mine);
    setCandidatures(cands);
    setMyApplications(myApps);
    setBinomeInvites(invites);
    setPartnerInvites(pInvites);
    setVitrine(vit);
    setMyBinomes(actives.flatMap(bn => {
      const other = bn.player_a === player.id ? bn.b : bn.a;   // l'AUTRE joueur de la paire
      return other ? [{ id: other.id, name: other.name, elo_score: other.elo_score }] : [];
    }));
    setLoading(false);

    // « X autres binômes » : compte les autres candidatures sur chaque défi où j'ai postulé.
    const counts: Record<string, number> = {};
    await Promise.all(myApps.map(async a => {
      if (a.game_id) counts[a.game_id] = await defiOtherBinomeCount(a.game_id);
    }));
    setOtherBinomeCounts(counts);
  }, [player]);

  const router = useRouter();
  const launchDefi = () => router.push('/(tabs)/lobby?create=1&challenge=1' as any);
  // Taper une carte défi → détail complet (réutilise le GameDetailsSheet du lobby).
  // On passe l'onglet d'origine : à la fermeture du détail, le lobby REVIENT au hub
  // (sinon l'utilisateur resterait bloqué dans le lobby).
  const openDefiDetails = (id: string) => router.push(('/(tabs)/lobby?gameId=' + id + '&backToDefi=' + tab) as any);

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
    const s = new Set<string>(hiddenIds);   // joueurs bloqués exclus du sélecteur
    if (player) s.add(player.id);
    if (releverGame) {
      if (releverGame.creator_id) s.add(releverGame.creator_id);
      (releverGame.participants ?? []).forEach(p => p.player_id && s.add(p.player_id));
    }
    return s;
  }, [releverGame, player, hiddenIds]);

  // Charger les joueurs bloqués à l'ouverture du sélecteur (modération, 2 sens).
  useEffect(() => {
    if (!releverGame || !player) return;
    getHiddenPlayerIds(player.id).then(setHiddenIds);
  }, [releverGame, player]);

  // ── Debounced player search ──────────────────────────────────
  useEffect(() => {
    if (partnerSearch.length < 2) { setPartnerResults([]); setPartnerBusy(new Set()); return; }
    const t = setTimeout(() => {
      supabase.from('players').select('id,name,elo_score,court_side')
        .is('deleted_at', null)
        .ilike('name', `%${partnerSearch}%`)
        .neq('id', player?.id ?? '')
        .limit(12)
        .then(async ({ data }) => {
          const results = ((data as any[]) || []).filter(p => !excludedPartnerIds.has(p.id)).slice(0, 8);
          setPartnerResults(results);
          // Dispo au créneau du défi : marquer ceux déjà pris ±2h (pastille « Occupé »).
          const slotTs = releverGame?.match_date ? new Date(releverGame.match_date).getTime() : null;
          if (slotTs != null && results.length > 0) {
            const { data: busyRows } = await supabase
              .from('game_participants')
              .select('player_id, game:game_id(match_date, status)')
              .in('player_id', results.map(p => p.id))
              .eq('status', 'accepted');
            const busy = new Set<string>();
            (busyRows ?? []).forEach((r: any) => {
              const g = r.game;
              if (!g || g.status === 'cancelled' || g.status === 'closed' || !g.match_date) return;
              if (Math.abs(new Date(g.match_date).getTime() - slotTs) < 2 * 60 * 60 * 1000) busy.add(r.player_id);
            });
            setPartnerBusy(busy);
          } else {
            setPartnerBusy(new Set());
          }
        });
    }, 300);
    return () => clearTimeout(t);
  }, [partnerSearch, player, excludedPartnerIds, releverGame]);

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
        // 2) Filtrer les candidats : éligibilité (moyenne du binôme {moi, p} dans la
        //    bande du défi) + disponibilité au créneau (pas de partie acceptée à ±2h).
        const myElo = player.elo_score;
        const minE = releverGame.min_elo ?? 0;
        const maxE = releverGame.max_elo ?? 999999;
        const OVERLAP_MS = 2 * 60 * 60 * 1000; // même fenêtre ±2h que l'anti-chevauchement
        const slotTs = releverGame.match_date ? new Date(releverGame.match_date).getTime() : null;

        let cands = (freqPlayers as any[]).filter(p => {
          if (excludedPartnerIds.has(p.id)) return false;
          const avg = (myElo + p.elo_score) / 2;
          return avg >= minE && avg <= maxE;
        });

        if (slotTs != null && cands.length > 0) {
          const { data: busyRows } = await supabase
            .from('game_participants')
            .select('player_id, game:game_id(match_date, status)')
            .in('player_id', cands.map(p => p.id))
            .eq('status', 'accepted');
          const busy = new Set<string>();
          (busyRows ?? []).forEach((r: any) => {
            const g = r.game;
            if (!g || g.status === 'cancelled' || g.status === 'closed' || !g.match_date) return;
            if (Math.abs(new Date(g.match_date).getTime() - slotTs) < OVERLAP_MS) busy.add(r.player_id);
          });
          cands = cands.filter(p => !busy.has(p.id));
        }

        if (!cands.length) { setSuggestedPartners([]); setLoadingSuggestions(false); return; }

        // 3) Classer les candidats retenus par compatibilité
        const myData = await getPlayerGameData(myId);
        const ranked = await Promise.all(
          cands.map(async (p) => {
            const compat = await computeCompatDetail(
              myId, player.elo_score, player.court_side,
              myData, p.id, p.elo_score, p.court_side,
            );
            return { ...p, compatScore: compat.score };
          }),
        );
        ranked.sort((a, b) => b.compatScore - a.compatScore);
        setSuggestedPartners(ranked.slice(0, 5));
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

  // Arrivée depuis l'explorer du lobby (?relever=<id>) → ouvre directement le
  // sélecteur de binôme pour ce défi une fois la liste chargée.
  useEffect(() => {
    const rid = params.relever;
    if (!rid || openDefis.length === 0) return;
    const g = openDefis.find(d => d.id === rid);
    if (g) { setTab('relever'); handleRelever(g); }
    router.setParams({ relever: undefined });
  }, [params.relever, openDefis]);

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
    if (binomeBusy.has(app.id)) return;   // ignore les taps répétés (sinon le 2e appel renvoie « too_late »)
    setBinomeBusy(s => new Set(s).add(app.id));
    try {
      const res = await acceptBinomeInvitation(app.id);
      if (res === 'locked') {
        notifyDefiConfirmed(app, player?.id ?? '');
        showToast('✅ Binôme verrouillé — défi confirmé !');
      } else if (res === 'queued') {
        if (app.initiator_id && player) notifyBinomeQueued(app.initiator_id, player.name);
        showToast('⏳ En file d\'attente — promus si une place se libère');
      } else {
        showToast('⏳ Trop tard : un autre binôme a pris la place');
      }
      await fetchData();
      reloadNotifs();
    } catch (e: any) {
      if (isCreatorConflict(e)) {
        Alert.alert('⚠️ Conflit de créneau', 'Toi ou ton binôme êtes déjà engagés sur une autre partie au même créneau (±2h).');
      } else {
        Alert.alert('Erreur', e?.message ?? 'Action impossible.');
      }
    } finally {
      setBinomeBusy(s => { const n = new Set(s); n.delete(app.id); return n; });
    }
  };

  // Retirer ma candidature (pending) ou sortir de la file (queued) — toute la paire sort.
  const handleWithdrawApp = (app: DefiApplication) => {
    Alert.alert(
      app.status === 'queued' ? 'Quitter la file ?' : 'Retirer la candidature ?',
      app.status === 'queued'
        ? 'Votre binôme perdra sa place dans la file d\'attente.'
        : 'Ta proposition à ton binôme sera annulée.',
      [
        { text: 'Garder', style: 'cancel' },
        {
          text: 'Retirer', style: 'destructive',
          onPress: async () => {
            if (binomeBusy.has(app.id)) return;
            setBinomeBusy(s => new Set(s).add(app.id));
            try {
              const otherId = await withdrawApplication(app.id);
              // Ne prévenir le partenaire que s'il était ENGAGÉ (file) — une simple
              // invitation pending retirée disparaît silencieusement de son côté.
              if (app.status === 'queued' && otherId && player) notifyBinomeWithdrawn(otherId, player.name);
              showToast('Candidature retirée');
              await fetchData();
              reloadNotifs();
            } catch (e: any) {
              Alert.alert('Erreur', e?.message ?? 'Action impossible.');
            } finally {
              setBinomeBusy(s => { const n = new Set(s); n.delete(app.id); return n; });
            }
          },
        },
      ],
    );
  };

  // Invitation défi via game_participants (binôme du créateur / défi ciblé) —
  // mêmes effets que les handlers du lobby, accessibles depuis le hub.
  const handleAcceptPartnerInvite = async (inv: DefiInvite) => {
    const key = 'pinv-' + inv.participantId;
    if (binomeBusy.has(key)) return;
    setBinomeBusy(s => new Set(s).add(key));
    try {
      const { error } = await supabase.from('game_participants')
        .update({ status: 'accepted' }).eq('id', inv.participantId);
      if (error) {
        if (isCreatorConflict(error)) Alert.alert('⚠️ Conflit de créneau', 'Tu es déjà sur une autre partie au même créneau (±2h).');
        else Alert.alert('Erreur', error.message);
        return;
      }
      const g = inv.game;
      const otherIds = [g.creator_id, ...(g.participants ?? []).filter(p => p.status === 'accepted').map(p => p.player_id)]
        .filter((id): id is string => !!id && id !== player?.id);
      if (otherIds.length > 0) {
        notifyPlayers({
          playerIds: [...new Set(otherIds)],
          title: '✅ Nouveau joueur confirmé !',
          body: `${player?.name ?? '?'} a rejoint le défi.`,
          data: { type: 'lobby', gameId: g.id },
        });
      }
      showToast('✅ Défi rejoint !');
      await fetchData();
      reloadNotifs();
    } finally {
      setBinomeBusy(s => { const n = new Set(s); n.delete(key); return n; });
    }
  };

  const handleDeclinePartnerInvite = async (inv: DefiInvite) => {
    const key = 'pinv-' + inv.participantId;
    if (binomeBusy.has(key)) return;
    setBinomeBusy(s => new Set(s).add(key));
    try {
      const { error } = await supabase.from('game_participants')
        .update({ status: 'declined' }).eq('id', inv.participantId);
      if (error) { Alert.alert('Erreur', error.message); return; }
      if (inv.game.creator_id && inv.game.creator_id !== player?.id) {
        // Team A (son binôme) refuse → le trigger serveur ANNULE le défi
        // (draft non ciblé : trg_defi_draft_binome_gone ; ciblé :
        // fn_defi_targeted_decline). Team B (ciblé) → conversion en ouvert.
        const isTeamA = String(inv.team_side ?? '').startsWith('A');
        notifyPlayers({
          playerIds: [inv.game.creator_id],
          title: '❌ Invitation refusée',
          body: isTeamA
            ? `${player?.name ?? '?'} a refusé d'être ton binôme — le défi est annulé`
            : `${player?.name ?? '?'} a refusé ton défi — il est proposé aux autres binômes`,
          data: { type: 'challenge', tab: 'mes', gameId: inv.game.id },
        });
      }
      showToast('Invitation refusée');
      await fetchData();
      reloadNotifs();
    } finally {
      setBinomeBusy(s => { const n = new Set(s); n.delete(key); return n; });
    }
  };

  const handleDeclineBinome = async (app: DefiApplication) => {
    if (binomeBusy.has(app.id)) return;
    setBinomeBusy(s => new Set(s).add(app.id));
    try {
      await declineBinomeInvitation(app.id);
      if (app.initiator_id && player) notifyReleverDeclined(app.initiator_id, player.name);
      showToast('Invitation déclinée');
      await fetchData();
      reloadNotifs();
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? 'Action impossible.');
    } finally {
      setBinomeBusy(s => { const n = new Set(s); n.delete(app.id); return n; });
    }
  };

  const handleCancelDefi = (game: DefiGame) => {
    Alert.alert(
      'Annuler ce défi ?',
      game.status === 'draft'
        ? 'Ton brouillon sera supprimé.'
        : game.status === 'confirmed'
          ? 'Les joueurs et les binômes en file seront notifiés. Cette action est irréversible.'
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
                  {partnerResults.map(p => {
                    const avg = ((player?.elo_score ?? 0) + p.elo_score) / 2;
                    const eligible = !releverGame || (avg >= (releverGame.min_elo ?? 0) && avg <= (releverGame.max_elo ?? 999999));
                    const busy = partnerBusy.has(p.id);
                    const selectable = eligible && !busy && !applying;
                    return (
                      <TouchableOpacity
                        key={p.id}
                        onPress={() => submitRelever(p)}
                        disabled={!selectable}
                        style={[sty.card, { opacity: selectable ? 1 : 0.55 }]}
                        activeOpacity={0.75}
                      >
                        <View style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <PlayerAvatar name={p.name} size={38} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 13, fontFamily: Fonts.uiBold, fontWeight: '700', color: Colors.textPrimary }}>{p.name}</Text>
                            <Text style={{ fontSize: 11, color: Colors.textMuted }}>Niv. {eloToLevel(p.elo_score).toFixed(1)} · ELO {Math.round(p.elo_score)}</Text>
                          </View>
                          {!eligible ? <Pill variant="danger">Non éligible</Pill>
                            : busy ? <Pill variant="warning">Occupé</Pill>
                            : <Icon name="chevronRight" size={16} color={Colors.textMuted} />}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
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
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontSize: 28, lineHeight: 36, fontFamily: Fonts.welcome, color: Colors.textOnDark, letterSpacing: 0.2, textAlign: 'center', paddingRight: 5 }}>
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
        {/* Onglets soulignés (même esprit que la page profil) */}
        <View style={{ flexDirection: 'row', marginTop: 6 }}>
          {([
            { id: 'relever'      as Tab, label: 'À relever',  badge: 0 },
            { id: 'mes'          as Tab, label: 'Mes défis',  badge: binomeInvites.length + partnerInvites.length },
            { id: 'invitations'  as Tab, label: 'Binôme',     badge: 0 },
            { id: 'vitrine'      as Tab, label: 'À défier',   badge: 0 },
          ]).map(t => {
            const active = tab === t.id;
            return (
              <TouchableOpacity key={t.id} onPress={() => setTab(t.id)} activeOpacity={0.7}
                style={{ flex: 1, paddingTop: 10, paddingBottom: 12, alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={{ fontSize: 11, fontWeight: active ? '900' : '600', fontFamily: active ? Fonts.uiBlack : Fonts.uiSemi, color: active ? Colors.brand : 'rgba(255,255,255,0.5)' }}>
                    {t.label}
                  </Text>
                  {t.badge > 0 && (
                    <View style={{ backgroundColor: Colors.brand, borderRadius: 999, minWidth: 15, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: Colors.brandDeep, fontSize: 9, fontFamily: Fonts.uiBlack, fontWeight: '900' }}>{t.badge}</Text>
                    </View>
                  )}
                </View>
                {active && <View style={{ position: 'absolute', bottom: 0, height: 3, left: '18%', right: '18%', borderRadius: 3, backgroundColor: Colors.brand }} />}
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
                : <View style={{ gap: 12 }}>
                    {sortedOpenDefis.map(g => {
                      const myApp = myApplications.find(a => a.game_id === g.id);
                      return (
                        <DefiGameCard key={g.id} game={g} myId={player.id} myElo={player.elo_score} onPress={() => openDefiDetails(g.id)}>
                          {myApp ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 }}>
                              <Pill variant="warning">⏳ Postulé</Pill>
                              <Text style={{ flex: 1, fontSize: 11.5, color: Colors.textSecondary }} numberOfLines={1}>
                                avec <Text style={{ fontWeight: '900', color: Colors.textPrimary }}>{myApp.partner?.name ?? '?'}</Text> — touche pour changer
                              </Text>
                            </View>
                          ) : (
                            <DefiActionButton
                              label={g.status === 'confirmed' ? 'Rejoindre la file d\'attente' : 'Relever le défi'}
                              onPress={() => handleRelever(g)}
                            />
                          )}
                        </DefiGameCard>
                      );
                    })}
                  </View>
            )}
            {tab === 'mes' && (
              <View style={{ gap: 12 }}>
                <TouchableOpacity onPress={launchDefi} activeOpacity={0.85}
                  style={{ backgroundColor: Colors.brand, borderRadius: 14, paddingVertical: 13, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
                    shadowColor: Colors.brand, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 }}>
                  <Icon name="swords" size={17} color={Colors.textOnBrand} stroke={2.4} />
                  <Text style={{ color: Colors.textOnBrand, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 14.5, letterSpacing: 0.2 }}>Lancer un défi</Text>
                </TouchableOpacity>
                {/* Invitations défi via game_participants : binôme du créateur (A)
                    ou adversaire d'un défi ciblé (B) → carte + accepter / refuser. */}
                {partnerInvites.map(inv => {
                  const key = 'pinv-' + inv.participantId;
                  const isTeamA = String(inv.team_side ?? '').startsWith('A');
                  return (
                    <DefiGameCard key={key} game={inv.game} myId={player.id} myElo={player.elo_score} onPress={() => openDefiDetails(inv.game.id)}>
                      <View style={{ gap: 8 }}>
                        <Text style={{ fontSize: 12, color: Colors.textSecondary }}>
                          <Text style={{ fontWeight: '900', color: Colors.textPrimary }}>{inv.game.creator?.name ?? '?'}</Text>
                          {isTeamA ? " t'invite comme binôme pour ce défi." : ' te défie avec son binôme.'}
                        </Text>
                        <View style={{ flexDirection: 'row', gap: 8, opacity: binomeBusy.has(key) ? 0.5 : 1 }}>
                          <TouchableOpacity onPress={() => handleDeclinePartnerInvite(inv)} disabled={binomeBusy.has(key)}
                            style={{ flex: 1, backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingVertical: 11, alignItems: 'center' }}>
                            <Text style={{ color: Colors.danger, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 13 }}>Refuser</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => handleAcceptPartnerInvite(inv)} disabled={binomeBusy.has(key)}
                            style={{ flex: 1, backgroundColor: Colors.brand, borderRadius: 12, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' }}>
                            {binomeBusy.has(key)
                              ? <ActivityIndicator size="small" color={Colors.textOnBrand} />
                              : <Text style={{ color: Colors.textOnBrand, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 13 }}>{isTeamA ? 'Rejoindre le binôme' : 'Relever le défi'}</Text>}
                          </TouchableOpacity>
                        </View>
                      </View>
                    </DefiGameCard>
                  );
                })}

                {/* Invitations à relever : je suis invité comme binôme → carte
                    COMPLÈTE du défi (adversaires / lieu / date) + accepter / refuser. */}
                {binomeInvites.map(c => c.game ? (
                  <DefiGameCard key={'inv-' + c.id} game={c.game} myId={player.id} myElo={player.elo_score} onPress={() => openDefiDetails(c.game!.id)}>
                    <View style={{ gap: 8 }}>
                      <Text style={{ fontSize: 12, color: Colors.textSecondary }}>
                        <Text style={{ fontWeight: '900', color: Colors.textPrimary }}>{c.initiator?.name ?? '?'}</Text> t'invite à relever ce défi avec lui.
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 8, opacity: binomeBusy.has(c.id) ? 0.5 : 1 }}>
                        <TouchableOpacity onPress={() => handleDeclineBinome(c)} disabled={binomeBusy.has(c.id)}
                          style={{ flex: 1, backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingVertical: 11, alignItems: 'center' }}>
                          <Text style={{ color: Colors.danger, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 13 }}>Refuser</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleAcceptBinome(c)} disabled={binomeBusy.has(c.id)}
                          style={{ flex: 1, backgroundColor: Colors.brand, borderRadius: 12, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' }}>
                          {binomeBusy.has(c.id)
                            ? <ActivityIndicator size="small" color={Colors.textOnBrand} />
                            : <Text style={{ color: Colors.textOnBrand, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 13 }}>Accepter</Text>}
                        </TouchableOpacity>
                      </View>
                    </View>
                  </DefiGameCard>
                ) : null)}

                {/* Mes candidatures : en cours (attente de mon binôme) OU en file d'attente. */}
                {myApplications.map(a => {
                  const g = defiGameWithMyBinome(a);   // injecte MON binôme (transparent) sur Team B si pending/open
                  if (!g) return null;
                  const mate = a.initiator_id === player.id ? a.partner : a.initiator;   // mon coéquipier
                  const others = (a.game_id && otherBinomeCounts[a.game_id]) || 0;
                  return (
                    <DefiGameCard key={'app-' + a.id} game={g} myId={player.id} myElo={player.elo_score} onPress={() => openDefiDetails(a.game!.id)}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 }}>
                        <Pill variant="warning">{a.status === 'queued' ? '⏳ En file d\'attente' : '⏳ Candidature en cours'}</Pill>
                        {others > 0 && <Pill variant="neutral">+{others} binôme{others > 1 ? 's' : ''}</Pill>}
                        <Text style={{ flex: 1, fontSize: 11.5, color: Colors.textSecondary }} numberOfLines={1}>
                          avec <Text style={{ fontWeight: '900', color: Colors.textPrimary }}>{mate?.name ?? '?'}</Text>
                          {a.status === 'queued' ? ' — promus si libre' : ''}
                        </Text>
                        <TouchableOpacity onPress={() => handleWithdrawApp(a)} disabled={binomeBusy.has(a.id)}
                          style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9, borderWidth: 1, borderColor: Colors.border, opacity: binomeBusy.has(a.id) ? 0.5 : 1 }}>
                          <Text style={{ fontSize: 11, fontWeight: '800', color: Colors.danger }}>Retirer</Text>
                        </TouchableOpacity>
                      </View>
                    </DefiGameCard>
                  );
                })}

                {myDefis.length === 0 && binomeInvites.length === 0 && myApplications.length === 0 && partnerInvites.length === 0
                  ? <EmptyCard icon="swords" title="Aucun défi en cours" sub="Lance ton premier défi avec le bouton ci-dessus, ou relève-en un." />
                  : myDefis.map(g => {
                      const isMine = g.creator_id === player.id;
                      // Sur un défi OUVERT : binômes en train de relever (pending).
                      // Sur un défi CONFIRMÉ : file d'attente FIFO (queued) — promus si un binôme se retire.
                      const racing = g.status === 'open'
                        ? candidatures.filter(c => c.game_id === g.id && c.status === 'pending')
                        : [];
                      const queued = g.status === 'confirmed'
                        ? candidatures.filter(c => c.game_id === g.id && c.status === 'queued')
                        : [];
                      const rowsOf = (list: typeof candidatures) => list.map(c => (
                        <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 }}>
                          <Text style={{ flex: 1, fontSize: 12, color: Colors.textSecondary }} numberOfLines={1}>
                            <Text style={{ fontWeight: '900', color: Colors.textPrimary }}>{c.initiator?.name ?? '?'} & {c.partner?.name ?? '?'}</Text>
                          </Text>
                          <Pill variant="warning">{c.status === 'queued' ? '⏳ en file' : '⏳ à finaliser'}</Pill>
                        </View>
                      ));
                      return (
                        <DefiGameCard key={g.id} game={g} myId={player.id} myElo={player.elo_score} onPress={() => openDefiDetails(g.id)}>
                          {racing.length > 0 && (
                            <View style={{ gap: 6 }}>
                              <Text style={{ fontSize: 10.5, fontWeight: '900', color: Colors.brandDeep, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                                {racing.length} binôme{racing.length > 1 ? 's' : ''} en train de relever
                              </Text>
                              {rowsOf(racing)}
                            </View>
                          )}
                          {queued.length > 0 && (
                            <View style={{ gap: 6 }}>
                              <Text style={{ fontSize: 10.5, fontWeight: '900', color: Colors.textMuted, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                                File d'attente · {queued.length} binôme{queued.length > 1 ? 's' : ''}
                              </Text>
                              {rowsOf(queued)}
                            </View>
                          )}
                          {isMine
                            ? <DefiActionButton label="Annuler le défi" danger onPress={() => handleCancelDefi(g)} />
                            : null}
                        </DefiGameCard>
                      );
                    })}
              </View>
            )}
            {tab === 'invitations' && (
              // « Avec qui je suis en binôme » (paires actives). Les demandes/invitations
              // à relever sont désormais dans « Mes défis » (avec la carte).
              myBinomes.length === 0
                ? <EmptyCard icon="users" title="Aucun binôme" sub="Tes binômes actifs apparaîtront ici. Déclare-en un depuis ton profil (« M'ouvrir aux défis »)." />
                : <View style={{ gap: 8 }}>
                    <Text style={sty.sectionLabel}>Mes binômes</Text>
                    {myBinomes.map(p => (
                      <TouchableOpacity key={p.id} onPress={() => router.push(`/player/${p.id}` as any)} activeOpacity={0.7}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 }}>
                        <PlayerAvatar name={p.name} size={34} />
                        <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontFamily: Fonts.uiBold, fontWeight: '700', color: Colors.textPrimary }}>{p.name}</Text>
                        <Pill variant="neutral">Niv. {eloToLevel(p.elo_score).toFixed(1)}</Pill>
                      </TouchableOpacity>
                    ))}
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
  sectionLabel: {
    fontSize: 11, fontFamily: Fonts.uiBlack, fontWeight: '900',
    letterSpacing: 0.8, textTransform: 'uppercase', color: Colors.textMuted,
  },
});
