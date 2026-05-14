import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert, Modal, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { usePlayer } from '../hooks/usePlayer';
import { supabase } from '../lib/supabase';
import { Colors, formatPadelLevel } from '../lib/theme';
import { notifyPlayers } from '../lib/notify';

// ─── Constants ────────────────────────────────────────────────
const SCORE_OPTS = [0, 1, 2, 3, 4, 5, 6, 7];

const BADGE_FALLBACK: Record<string, string> = {
  'MVP': '👑', 'La Bombe': '💥', 'Le Smash': '🎯', 'Le Phénix': '🔥',
  'Le Mur': '🧱', "L'Essuie-glace": '🏃', 'Roi du Filet': '🎾',
  'Le Cerveau': '🧠', 'Le Capitaine': '⭐',
  'Fair-Play': '🤝', 'Bonne Ambiance': '😄', '3e Mi-temps': '🍻', 'Ponctuel': '⏰',
  CANNON: '💥', SMASH: '🎯', COMEBACK: '🔥', WALL: '🧱',
  RUNNER: '🏃', NET_KING: '🎾', BRAIN: '🧠', CAPTAIN: '⭐',
  FAIR_PLAY: '🤝', GOOD_VIBES: '😄', DRINKS: '🍻', PUNCTUAL: '⏰',
  'El Cañón': '💥', 'Bon Délire': '😄', 'Essuie-glace': '🏃',
};

type GameType = 'all' | 'competitive' | 'friendly' | 'challenge';

interface SetScore { t1: number | null; t2: number | null }
interface Participant { id: string; name: string; elo_score: number }
interface Game {
  id: string; location: string; match_date: string;
  is_challenge?: boolean; game_format?: string;
  participants: Participant[];
}

function getGameType(g: Game): 'challenge' | 'friendly' | 'competitive' {
  if (g.is_challenge) return 'challenge';
  if (g.game_format === 'friendly') return 'friendly';
  return 'competitive';
}

const TYPE_LABEL: Record<string, string> = { competitive: 'Compétitif', friendly: 'Amical', challenge: 'Défi' };
const TYPE_COLOR: Record<string, string> = { competitive: '#4f46e5', friendly: '#059669', challenge: '#d97706' };
const TYPE_BG:    Record<string, string> = { competitive: '#eef2ff', friendly: '#d1fae5', challenge: '#fef3c7' };

// ─── Per-set validation ───────────────────────────────────────
function validateSet(set: SetScore): string | null {
  const { t1, t2 } = set;
  if (t1 === null || t2 === null) return null;
  if (t1 === t2) return 'Score nul impossible';
  const hi = Math.max(t1, t2), lo = Math.min(t1, t2);
  if (hi === 7 && lo < 5) return 'Score invalide (7-5 ou 7-6 uniquement)';
  if (hi === 6 && lo > 4) return `6-${lo} invalide (max 6-4)`;
  if (hi < 6) return 'Minimum 6 jeux par set';
  if (hi > 7) return 'Maximum 7 jeux par set';
  return null;
}

// ─── Score dropdown ───────────────────────────────────────────
function ScoreDropdown({ label, value, onChange }: {
  label: string; value: number | null; onChange: (v: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <Text style={{ fontSize: 10, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
      <TouchableOpacity onPress={() => setOpen(true)} activeOpacity={0.75} style={sty.dropTrigger}>
        <Text style={[sty.dropValue, value === null && { color: '#cbd5e1' }]}>
          {value !== null ? String(value) : '–'}
        </Text>
        <Text style={{ fontSize: 9, color: '#94a3b8', lineHeight: 10 }}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" statusBarTranslucent>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} activeOpacity={1} onPress={() => setOpen(false)} />
        <View style={[sty.dropSheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: '#e2e8f0', alignSelf: 'center', marginBottom: 14 }} />
          <Text style={{ fontSize: 11, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', textAlign: 'center', letterSpacing: 0.8, marginBottom: 14 }}>
            {label}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
            {SCORE_OPTS.map(n => {
              const sel = value === n;
              return (
                <TouchableOpacity key={n} onPress={() => { onChange(n); setOpen(false); }}
                  style={[sty.dropItem, sel && sty.dropItemSel]} activeOpacity={0.75}>
                  <Text style={[sty.dropItemTxt, sel && sty.dropItemTxtSel]}>{n}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Score set input ──────────────────────────────────────────
function SetRow({ idx, set, onChange, onRemove, canRemove }: {
  idx: number; set: SetScore;
  onChange: (s: SetScore) => void;
  onRemove: () => void; canRemove: boolean;
}) {
  const err = validateSet(set);
  const complete = set.t1 !== null && set.t2 !== null;
  const valid = complete && !err;

  return (
    <View style={{ marginBottom: 8 }}>
      <View style={[
        sty.setRow,
        complete && (valid ? { borderColor: '#6ee7b7' } : { borderColor: '#fca5a5' }),
      ]}>
        <Text style={sty.setLabel}>Set {idx + 1}</Text>
        <View style={sty.setPickersWrap}>
          <ScoreDropdown label="Vous" value={set.t1} onChange={v => onChange({ ...set, t1: v })} />
          <Text style={sty.dash}>–</Text>
          <ScoreDropdown label="Adv." value={set.t2} onChange={v => onChange({ ...set, t2: v })} />
        </View>
        {valid
          ? <Text style={{ fontSize: 16, color: '#10b981' }}>✓</Text>
          : canRemove
            ? <TouchableOpacity onPress={onRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ color: '#cbd5e1', fontSize: 16, fontWeight: '700' }}>✕</Text>
              </TouchableOpacity>
            : null
        }
      </View>
      {err && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, marginLeft: 6 }}>
          <Text style={{ fontSize: 12, color: '#ef4444', fontWeight: '700' }}>⚠ {err}</Text>
        </View>
      )}
    </View>
  );
}

// ─── Badge grid ───────────────────────────────────────────────
function BadgeGrid({ player, votes, badges, onToggle }: {
  player: Participant; votes: string[];
  badges: any[]; onToggle: (label: string) => void;
}) {
  return (
    <View style={sty.badgeCard}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Text style={{ fontSize: 13, fontWeight: '900', color: '#0f172a' }}>Pour {player.name}</Text>
        {votes.length > 0 && (
          <View style={{ backgroundColor: '#e0e7ff', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Text style={{ fontSize: 10, fontWeight: '900', color: '#4338ca' }}>
              {votes.length} trophée{votes.length > 1 ? 's' : ''}
            </Text>
          </View>
        )}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
        {badges.map((b: any) => {
          const sel = votes.includes(b.label);
          return (
            <TouchableOpacity key={b.id} onPress={() => onToggle(b.label)}
              style={[sty.badgeBtn, sel && sty.badgeBtnSel]}
              activeOpacity={0.75}
            >
              <Text style={{ fontSize: 20 }}>{BADGE_FALLBACK[b.label] ?? '🏅'}</Text>
              <Text style={[sty.badgeTxt, sel && sty.badgeTxtSel]}>{b.label}</Text>
              {sel && (
                <View style={sty.badgeCheck}>
                  <Text style={{ fontSize: 7, color: '#fff', fontWeight: '900' }}>✓</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────
export default function ScoreEntryScreen() {
  const { player } = usePlayer();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gameId } = useLocalSearchParams<{ gameId?: string }>();
  const autoOpened = useRef(false);

  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [badges, setBadges] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<GameType>('all');

  const filteredGames = games.filter(g => {
    if (typeFilter !== 'all' && getGameType(g) !== typeFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const inLocation = g.location.toLowerCase().includes(q);
      const inPlayers = g.participants.some(p => p.name.toLowerCase().includes(q));
      if (!inLocation && !inPlayers) return false;
    }
    return true;
  });

  // Per-game scoring state
  const [scoringId, setScoringId] = useState<string | null>(null);
  const [partnerId, setPartnerId] = useState<string>('');
  const [sets, setSets] = useState<SetScore[]>([{ t1: null, t2: null }]);
  const [votes, setVotes] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  const fetchGames = useCallback(async () => {
    if (!player) return;
    setLoading(true);
    const now = new Date().toISOString();
    const GAME_SELECT = 'id, location, match_date, is_challenge, game_format, creator_id, creator:creator_id(id, name, elo_score), participants:game_participants(id, player_id, status, player:player_id(id, name, elo_score))';

    // Games where I'm a participant (accepted)
    const { data: partEntries } = await supabase
      .from('game_participants')
      .select('game_id')
      .eq('player_id', player.id)
      .eq('status', 'accepted');
    const partIds = (partEntries ?? []).map((e: any) => e.game_id as string).filter(Boolean);

    // Build query: creator OR participant
    const baseQuery = supabase
      .from('open_games')
      .select(GAME_SELECT)
      .neq('status', 'cancelled')
      .lt('match_date', now)
      .eq('spots_available', 0)
      .order('match_date', { ascending: false })
      .limit(20);

    const { data } = await (partIds.length > 0
      ? baseQuery.or(`creator_id.eq.${player.id},id.in.(${partIds.join(',')})`)
      : baseQuery.eq('creator_id', player.id));

    const seen = new Set<string>();
    const enriched: Game[] = (data ?? [])
      .filter((g: any) => {
        if (seen.has(g.id)) return false;
        seen.add(g.id);
        const accepted = (g.participants ?? []).filter((p: any) => p.status === 'accepted');
        return accepted.length >= 1;
      })
      .map((g: any) => {
        const accepted = (g.participants ?? []).filter((p: any) => p.status === 'accepted');
        const allParticipants: { id: string; name: string; elo_score: number }[] = accepted.map((p: any) => ({
          id: p.player_id, name: p.player?.name ?? '?', elo_score: p.player?.elo_score ?? 0,
        }));
        // Creator is not in game_participants — add them manually
        const creatorInList = allParticipants.some(p => p.id === g.creator_id);
        if (!creatorInList && g.creator) {
          allParticipants.unshift({ id: g.creator_id, name: g.creator.name ?? '?', elo_score: g.creator.elo_score ?? 0 });
        }
        return {
          id: g.id,
          location: g.location ?? '—',
          match_date: g.match_date,
          is_challenge: g.is_challenge ?? false,
          game_format: g.game_format ?? 'competitive',
          participants: allParticipants,
        };
      });

    setGames(enriched);
    setLoading(false);
  }, [player]);

  useFocusEffect(useCallback(() => { autoOpened.current = false; fetchGames(); }, [fetchGames]));

  useEffect(() => {
    if (!gameId || games.length === 0 || autoOpened.current) return;
    const target = games.find(g => g.id === gameId);
    if (target) { autoOpened.current = true; openScoring(target); }
  }, [gameId, games]);

  useEffect(() => {
    supabase.from('badges').select('*').eq('is_active', true).then(({ data }) => {
      if (data) setBadges(data.filter((b: any) => b.label !== 'MVP'));
    });
  }, []);

  // Auto-add 3rd set when first two sets are 1-1
  useEffect(() => {
    if (sets.length !== 2) return;
    const [s1, s2] = sets;
    if (s1.t1 === null || s1.t2 === null || s2.t1 === null || s2.t2 === null) return;
    if (validateSet(s1) || validateSet(s2)) return;
    const t1Wins = (s1.t1 > s1.t2 ? 1 : 0) + (s2.t1 > s2.t2 ? 1 : 0);
    if (t1Wins === 1) {
      setSets(prev => [...prev, { t1: null, t2: null }]);
    }
  }, [sets]);

  const openScoring = (game: Game) => {
    const others = game.participants.filter(p => p.id !== player?.id);
    setScoringId(game.id);
    setPartnerId(others[0]?.id ?? '');
    setSets([{ t1: null, t2: null }, { t1: null, t2: null }]);
    setVotes({});
  };

  const closeScoring = () => {
    setScoringId(null);
    setSets([{ t1: null, t2: null }]);
    setVotes({});
  };

  const toggleVote = (playerId: string, label: string) => {
    setVotes(prev => {
      const curr = prev[playerId] ?? [];
      return { ...prev, [playerId]: curr.includes(label) ? curr.filter(b => b !== label) : [...curr, label] };
    });
  };

  const validateSets = (active: SetScore[]): string | null => {
    for (let i = 0; i < active.length; i++) {
      const { t1, t2 } = active[i];
      if (t1 === null || t2 === null) return `Remplis le score du set ${i + 1}.`;
      if (t1 === t2) return `Score nul impossible au set ${i + 1}.`;
      const hi = Math.max(t1, t2), lo = Math.min(t1, t2);
      if (hi === 7 && lo < 5) return `Score 7-${lo} invalide au set ${i + 1} (7-5 ou 7-6 uniquement).`;
      if (hi === 6 && lo > 4) return `Score 6-${lo} invalide au set ${i + 1} (max 6-4).`;
      if (hi < 6) return `Score trop bas au set ${i + 1} (minimum 6 jeux).`;
      if (hi > 7) return `Score max 7 au set ${i + 1}.`;
    }
    return null;
  };

  const doSubmit = async (game: Game, activeSets: { t1: number; t2: number }[], t1Sets: number, t2Sets: number) => {
    const iWon = t1Sets > t2Sets;
    const scoreText = activeSets.map(s => `${s.t1}-${s.t2}`).join(', ');
    const opponents = game.participants.filter(p => p.id !== partnerId && p.id !== player!.id);
    const matchPayload = {
      winner_id:   iWon ? player!.id       : opponents[0]?.id ?? null,
      winner_id_2: iWon ? partnerId || null : opponents[1]?.id ?? null,
      loser_id:    iWon ? opponents[0]?.id ?? null : player!.id,
      loser_id_2:  iWon ? opponents[1]?.id ?? null : partnerId || null,
      score_text: scoreText,
      status: 'pending',
      created_by: player!.id,
      game_id: game.id,
    };
    setSubmitting(true);
    try {
      const { data: newMatch, error } = await supabase.from('matches').insert([matchPayload]).select().single();
      if (error) throw error;

      // Notify all other players in the match to validate the score
      const otherIds = [matchPayload.winner_id, matchPayload.winner_id_2, matchPayload.loser_id, matchPayload.loser_id_2]
        .filter((id): id is string => !!id && id !== player!.id);
      notifyPlayers({
        playerIds: otherIds,
        title: '📋 Score à valider',
        body: `${player!.name} a soumis un résultat — valide ou conteste.`,
        data: { type: 'match', matchId: newMatch.id },
      });

      const voteInserts: any[] = [];
      Object.entries(votes).forEach(([rid, labels]) =>
        labels.forEach(label => voteInserts.push({ match_id: newMatch.id, giver_id: player!.id, receiver_id: rid, badge_type: label }))
      );
      if (voteInserts.length > 0) await supabase.from('reputation_votes').insert(voteInserts);
      await supabase.from('open_games').update({ status: 'closed' }).eq('id', game.id);
      setGames(prev => prev.filter(g => g.id !== game.id));
      closeScoring();
      Alert.alert('Score enregistré !', "En attente de validation par l'adversaire.");
    } catch {
      Alert.alert('Erreur', "Réessaie, le score n'a pas été enregistré.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (game: Game) => {
    if (!player) return;
    const activeSets = sets.filter(s => s.t1 !== null && s.t2 !== null) as { t1: number; t2: number }[];
    if (activeSets.length < 2) { Alert.alert('Sets incomplets', 'Un match doit compter au moins 2 sets.'); return; }
    const err = validateSets(activeSets);
    if (err) { Alert.alert('Score invalide', err); return; }

    let t1Sets = 0, t2Sets = 0;
    activeSets.forEach(s => s.t1 > s.t2 ? t1Sets++ : t2Sets++);

    if (t1Sets === t2Sets) {
      Alert.alert(
        'Match nul',
        'Ce match est sans impact sur le classement. Voulez-vous continuer ?',
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Continuer', onPress: () => doSubmit(game, activeSets, t1Sets, t2Sets) },
        ]
      );
      return;
    }

    doSubmit(game, activeSets, t1Sets, t2Sets);
  };

  const formatMatchDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
      + ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: '#102820' }}>
      {/* Dark hero header */}
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 28 }}>
        <TouchableOpacity onPress={() => router.back()}
          style={{ width: 36, height: 36, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M15 18l-6-6 6-6" />
          </Svg>
        </TouchableOpacity>
        <Text style={{ fontSize: 26, fontWeight: '900', color: '#fff', letterSpacing: -0.5 }}>✍️ Saisie du score</Text>
        <Text style={{ fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>
          {loading ? 'Chargement…' : games.length > 0
            ? `${games.length} partie${games.length > 1 ? 's' : ''} en attente`
            : 'Aucune partie à scorer'}
        </Text>
      </View>

      {/* Content card */}
      <View style={{ flex: 1, backgroundColor: '#f8fafc', borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>

        {/* Search + filters */}
        <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 }}>
          <View style={sty.searchBar}>
            <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </Svg>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Lieu ou joueur…"
              placeholderTextColor="#94a3b8"
              style={sty.searchInput}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingVertical: 10 }}>
            {(['all', 'competitive', 'friendly', 'challenge'] as GameType[]).map(t => {
              const active = typeFilter === t;
              const color = t === 'all' ? '#0f172a' : TYPE_COLOR[t];
              const bg    = t === 'all' ? (active ? '#0f172a' : '#f1f5f9') : (active ? TYPE_BG[t] : '#f1f5f9');
              const fg    = active ? (t === 'all' ? '#fff' : color) : '#64748b';
              const border = active ? (t === 'all' ? '#0f172a' : color) : 'transparent';
              return (
                <TouchableOpacity key={t} onPress={() => setTypeFilter(t)} activeOpacity={0.75}
                  style={{ backgroundColor: bg, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1.5, borderColor: border }}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: fg }}>
                    {t === 'all' ? 'Tous' : TYPE_LABEL[t]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32 }}>

        {loading ? (
          <View style={sty.emptyBox}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : filteredGames.length === 0 ? (
          <View style={sty.emptyBox}>
            <Text style={{ fontSize: 36, marginBottom: 10 }}>{games.length === 0 ? '🏝️' : '🔍'}</Text>
            <Text style={{ fontSize: 15, fontWeight: '900', color: '#0f172a', marginBottom: 4 }}>
              {games.length === 0 ? 'Aucune partie à scorer' : 'Aucun résultat'}
            </Text>
            <Text style={{ fontSize: 12, color: '#94a3b8', fontWeight: '600', textAlign: 'center' }}>
              {games.length === 0 ? 'Tes parties Lobby terminées apparaîtront ici' : 'Essaie un autre filtre ou terme de recherche'}
            </Text>
          </View>
        ) : filteredGames.map(game => {
          const isScoring = scoringId === game.id;
          const others = game.participants.filter(p => p.id !== player?.id);
          const partner = game.participants.find(p => p.id === partnerId);
          const activeSets = sets.filter(s => s.t1 !== null && s.t2 !== null) as { t1: number; t2: number }[];
          const scorePreview = activeSets.map(s => `${s.t1}-${s.t2}`).join(' / ');
          const canSubmit = activeSets.length >= 2 && !submitting;

          return (
            <View key={game.id} style={sty.gameCard}>
              {/* Game header */}
              <View style={{ padding: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <Text style={{ fontSize: 16, fontWeight: '900', color: '#0f172a', flex: 1 }} numberOfLines={1}>{game.location}</Text>
                      {(() => { const t = getGameType(game); return (
                        <View style={{ backgroundColor: TYPE_BG[t], borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                          <Text style={{ fontSize: 10, fontWeight: '800', color: TYPE_COLOR[t] }}>{TYPE_LABEL[t]}</Text>
                        </View>
                      ); })()}
                    </View>
                    <Text style={{ fontSize: 12, color: '#64748b', fontWeight: '600', marginTop: 2 }}>
                      📅 {formatMatchDate(game.match_date)}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {game.participants.map(p => (
                        <View key={p.id} style={sty.playerPill}>
                          <Text style={sty.playerPillTxt}>👤 {p.name}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                  {!isScoring && (
                    <TouchableOpacity onPress={() => openScoring(game)} style={sty.scorerBtn} activeOpacity={0.8}>
                      <Text style={sty.scorerBtnTxt}>Scorer</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {/* Scoring form */}
              {isScoring && (
                <View style={sty.scoringArea}>
                  {/* Partner */}
                  <View style={{ marginBottom: 16 }}>
                    <Text style={sty.sectionLabel}>Ton partenaire</Text>
                    <Text style={{ fontSize: 11, color: '#94a3b8', fontWeight: '600', marginBottom: 8 }}>
                      Pré-sélectionné — modifiable si changé en cours de match
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      {others.map(p => {
                        const sel = partnerId === p.id;
                        return (
                          <TouchableOpacity key={p.id} onPress={() => setPartnerId(p.id)}
                            style={[sty.partnerChip, sel && sty.partnerChipSel]}
                            activeOpacity={0.75}
                          >
                            <View style={[sty.partnerAvatar, { backgroundColor: sel ? '#4f46e5' : '#e2e8f0' }]}>
                              <Text style={{ fontSize: 12, fontWeight: '900', color: sel ? '#fff' : '#64748b' }}>
                                {p.name.charAt(0).toUpperCase()}
                              </Text>
                            </View>
                            <View>
                              <Text style={[sty.partnerName, sel && { color: '#4f46e5' }]}>{p.name}</Text>
                              <Text style={{ fontSize: 10, color: '#94a3b8', fontWeight: '600' }}>
                                Niv. {formatPadelLevel(p.elo_score)}
                              </Text>
                            </View>
                            {sel && (
                              <View style={{ marginLeft: 'auto', backgroundColor: '#4f46e5', borderRadius: 999, width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
                                <Text style={{ fontSize: 8, color: '#fff', fontWeight: '900' }}>✓</Text>
                              </View>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>

                  {/* Score sets */}
                  <View style={{ marginBottom: 16 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <Text style={sty.sectionLabel}>Score (tes points en premier)</Text>
                      {sets.length < 3 && (
                        <TouchableOpacity onPress={() => setSets(prev => [...prev, { t1: null, t2: null }])}
                          style={{ backgroundColor: '#e0e7ff', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                          <Text style={{ fontSize: 11, fontWeight: '800', color: '#4338ca' }}>+ Set</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    {sets.map((s, i) => (
                      <SetRow key={i} idx={i} set={s}
                        onChange={ns => setSets(prev => prev.map((x, j) => j === i ? ns : x))}
                        onRemove={() => setSets(prev => prev.filter((_, j) => j !== i))}
                        canRemove={sets.length > 1}
                      />
                    ))}
                  </View>

                  {/* Score preview */}
                  {scorePreview && (
                    <View style={sty.previewBox}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#64748b', marginBottom: 2 }}>Score</Text>
                      <Text style={{ fontSize: 22, fontWeight: '900', color: '#0f172a', letterSpacing: 0.5 }}>{scorePreview}</Text>
                    </View>
                  )}

                  {/* Badges */}
                  {others.length > 0 && badges.length > 0 && (
                    <View style={{ marginBottom: 16 }}>
                      <Text style={sty.sectionLabel}>🌟 Distribue tes trophées</Text>
                      <Text style={{ fontSize: 11, color: '#94a3b8', fontWeight: '600', marginBottom: 10 }}>
                        Optionnel — tu peux en donner plusieurs par joueur
                      </Text>
                      {others.map(p => (
                        <BadgeGrid key={p.id} player={p} votes={votes[p.id] ?? []} badges={badges} onToggle={label => toggleVote(p.id, label)} />
                      ))}
                    </View>
                  )}

                  {/* Actions */}
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity onPress={closeScoring} style={sty.cancelBtn} activeOpacity={0.75}>
                      <Text style={sty.cancelBtnTxt}>Annuler</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleSubmit(game)} disabled={!canSubmit}
                      style={[sty.submitBtn, !canSubmit && { opacity: 0.5 }]} activeOpacity={0.85}>
                      {submitting
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={sty.submitBtnTxt}>Valider le score</Text>
                      }
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const sty = StyleSheet.create({
  emptyBox: {
    backgroundColor: '#fff', borderRadius: 24, borderWidth: 1, borderColor: '#e2e8f0',
    padding: 48, alignItems: 'center', justifyContent: 'center',
  },
  gameCard: {
    backgroundColor: '#fff', borderRadius: 24, borderWidth: 1, borderColor: '#e2e8f0',
    marginBottom: 14, overflow: 'hidden',
    shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  playerPill: {
    backgroundColor: '#eef2ff', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: '#c7d2fe',
  },
  playerPillTxt: { fontSize: 11, fontWeight: '700', color: '#4338ca' },
  scorerBtn: {
    backgroundColor: '#4f46e5', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 8,
  },
  scorerBtnTxt: { fontSize: 13, fontWeight: '900', color: '#fff' },
  scoringArea: {
    borderTopWidth: 1, borderTopColor: '#e0e7ff', backgroundColor: '#f5f3ff',
    padding: 16,
  },
  sectionLabel: { fontSize: 11, fontWeight: '900', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  setRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 14, padding: 12,
    marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0',
  },
  setLabel: { fontSize: 11, fontWeight: '800', color: '#94a3b8', width: 36 },
  setPickersWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, justifyContent: 'center' },
  dash: { fontSize: 20, fontWeight: '900', color: '#cbd5e1' },
  dropTrigger: {
    width: 58, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#e2e8f0', gap: 2,
  },
  dropValue: { fontSize: 24, fontWeight: '900', color: '#0f172a', lineHeight: 28 },
  dropSheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24, paddingTop: 16,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: -4 }, elevation: 12,
  },
  dropItem: {
    width: 64, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: '#e2e8f0',
  },
  dropItemSel: { backgroundColor: '#4f46e5', borderColor: '#4f46e5' },
  dropItemTxt: { fontSize: 22, fontWeight: '900', color: '#334155' },
  dropItemTxtSel: { color: '#fff' },
  previewBox: {
    backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: '#4f46e5',
    padding: 14, alignItems: 'center', marginBottom: 16,
  },
  partnerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0',
    padding: 10, flex: 1,
  },
  partnerChipSel: { borderColor: '#4f46e5', backgroundColor: '#eef2ff' },
  partnerAvatar: { width: 32, height: 32, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  partnerName: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  badgeCard: {
    backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0',
    padding: 12, marginBottom: 10,
  },
  badgeBtn: {
    alignItems: 'center', gap: 4, padding: 10, borderRadius: 14,
    borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#fff',
    width: 72,
  },
  badgeBtnSel: { borderColor: '#6366f1', backgroundColor: '#eef2ff' },
  badgeTxt: { fontSize: 8, fontWeight: '900', color: '#94a3b8', textTransform: 'uppercase', textAlign: 'center', letterSpacing: 0.3 },
  badgeTxtSel: { color: '#4338ca' },
  badgeCheck: {
    position: 'absolute', top: -5, right: -5, width: 14, height: 14,
    backgroundColor: '#4f46e5', borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
  },
  cancelBtn: {
    flex: 1, backgroundColor: '#f1f5f9', borderRadius: 14, padding: 14, alignItems: 'center',
  },
  cancelBtnTxt: { fontSize: 14, fontWeight: '800', color: '#475569' },
  submitBtn: {
    flex: 2, backgroundColor: '#4f46e5', borderRadius: 14, padding: 14, alignItems: 'center',
  },
  submitBtnTxt: { fontSize: 14, fontWeight: '900', color: '#fff' },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0',
    paddingHorizontal: 14, paddingVertical: 10,
  },
  searchInput: {
    flex: 1, fontSize: 14, fontWeight: '600', color: '#0f172a', padding: 0,
  },
});
