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
import { Colors, formatPadelLevel, Fonts } from '../lib/theme';
import { Pill, type PillVariant } from '../components/Pill';
import { CreatorCrownBadge } from '../components/CreatorCrownBadge';
import { notifyPlayers } from '../lib/notify';
import { isGameReadyToScore } from '../lib/games';
import { BadgePill } from '../components/profile/BadgePill';

// ─── Constants ────────────────────────────────────────────────
const SCORE_OPTS = [0, 1, 2, 3, 4, 5, 6, 7];

type GameType = 'all' | 'competitive' | 'friendly' | 'challenge';

interface SetScore { t1: number | null; t2: number | null }
interface Participant { id: string; name: string; elo_score: number; team_side?: string }
interface Game {
  id: string; location: string; match_date: string;
  is_challenge?: boolean; game_format?: string;
  creator_id?: string; creator_side?: string;
  participants: Participant[];
}

// Côté → équipe (A_GAU/A_DRO → A, B_GAU/B_DRO → B)
const teamOf = (side?: string | null) => (side ? side.charAt(0) : null);

// Coéquipier « par défaut » = le joueur de MON équipe au moment de la création.
// On le déduit du team_side (et creator_side pour le créateur). En l'absence
// d'info d'équipe fiable, on retombe sur le 1er autre participant (ancien défaut).
function defaultPartnerId(game: Game, meId: string): string {
  const me = game.participants.find(p => p.id === meId);
  const mySide = game.creator_id === meId ? (game.creator_side ?? me?.team_side) : me?.team_side;
  const myTeam = teamOf(mySide);
  if (myTeam) {
    const mate = game.participants.find(p => p.id !== meId && teamOf(p.team_side) === myTeam);
    if (mate) return mate.id;
  }
  return game.participants.find(p => p.id !== meId)?.id ?? '';
}

function getGameType(g: Game): 'challenge' | 'friendly' | 'competitive' {
  if (g.is_challenge) return 'challenge';
  if (g.game_format === 'friendly') return 'friendly';
  return 'competitive';
}

const TYPE_LABEL: Record<string, string> = { competitive: 'Compétitif', friendly: 'Amical', challenge: 'Défi' };
const TYPE_COLOR: Record<string, string> = { competitive: Colors.textPrimary, friendly: '#047857', challenge: Colors.brandDeep };
const TYPE_BG:    Record<string, string> = { competitive: Colors.bgCardAlt, friendly: 'rgba(16,185,129,0.10)', challenge: 'rgba(255,193,26,0.14)' };
const TYPE_VARIANT: Record<string, PillVariant> = { competitive: 'ink', friendly: 'success', challenge: 'brand' };

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
      <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
      <TouchableOpacity onPress={() => setOpen(true)} activeOpacity={0.75} style={sty.dropTrigger}>
        <Text style={[sty.dropValue, value === null && { color: Colors.border }]}>
          {value !== null ? String(value) : '–'}
        </Text>
        <Text style={{ fontSize: 9, color: Colors.textMuted, lineHeight: 10 }}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" statusBarTranslucent>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} activeOpacity={1} onPress={() => setOpen(false)} />
        <View style={[sty.dropSheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 14 }} />
          <Text style={{ fontSize: 11, fontWeight: '800', color: Colors.textSecondary, textTransform: 'uppercase', textAlign: 'center', letterSpacing: 0.8, marginBottom: 14 }}>
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
          ? <Text style={{ fontSize: 16, color: Colors.success }}>✓</Text>
          : canRemove
            ? <TouchableOpacity onPress={onRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ color: Colors.border, fontSize: 16, fontWeight: '700' }}>✕</Text>
              </TouchableOpacity>
            : null
        }
      </View>
      {err && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, marginLeft: 6 }}>
          <Text style={{ fontSize: 12, color: Colors.danger, fontWeight: '700' }}>⚠ {err}</Text>
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
        <Text style={{ fontSize: 13, fontWeight: '900', color: Colors.textPrimary, fontFamily: Fonts.uiBlack }}>Pour {player.name}</Text>
        {votes.length > 0 && (
          <View style={{ backgroundColor: 'rgba(255,193,26,0.14)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: 'rgba(255,193,26,0.55)' }}>
            <Text style={{ fontSize: 10, fontWeight: '900', color: Colors.brandDeep, fontFamily: Fonts.uiBlack }}>
              {votes.length} badge{votes.length > 1 ? 's' : ''}
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
              <BadgePill badge={b.label} size={24} />
              <Text style={[sty.badgeTxt, sel && sty.badgeTxtSel]}>{b.label}</Text>
              {sel && (
                <View style={sty.badgeCheck}>
                  <Text style={{ fontSize: 7, color: Colors.textOnDark, fontWeight: '900' }}>✓</Text>
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
  const { gameId, matchId: contestMatchId } = useLocalSearchParams<{ gameId?: string; matchId?: string }>();
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
  const [partnerChanged, setPartnerChanged] = useState(false);
  const [sets, setSets] = useState<SetScore[]>([{ t1: null, t2: null }]);
  const [votes, setVotes] = useState<Record<string, string[]>>({});
  const [contestReason, setContestReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchGames = useCallback(async () => {
    if (!player) return;
    setLoading(true);
    const now = new Date().toISOString();
    const GAME_SELECT = 'id, location, match_date, status, is_challenge, game_format, creator_id, creator_side, creator:creator_id(id, name, elo_score), participants:game_participants(id, player_id, status, team_side, player:player_id(id, name, elo_score))';

    // Games where I'm a participant (accepted)
    const { data: partEntries } = await supabase
      .from('game_participants')
      .select('game_id')
      .eq('player_id', player.id)
      .eq('status', 'accepted');
    const partIds = (partEntries ?? []).map((e: any) => e.game_id as string).filter(Boolean);

    // Fenêtre 48 h : DOIT rester alignée sur lobby.readyToScore et
    // useNotificationCount.toScore, sinon le badge « à scorer » compte des
    // parties (jouées il y a 24-48 h) que cet écran ne montre pas.
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    // Build query: creator OR participant — exclude closed & cancelled, within 48h window.
    // L'occupation (« partie pleine ») et les critères « à scorer » sont jugés par
    // lib/games.isGameReadyToScore (dérivé des participants), pas par spots_available.
    const baseQuery = supabase
      .from('open_games')
      .select(GAME_SELECT)
      .neq('status', 'cancelled')
      .neq('status', 'closed')
      .lt('match_date', now)
      .gte('match_date', twoDaysAgo)
      .order('match_date', { ascending: false })
      .limit(20);

    const { data } = await (partIds.length > 0
      ? baseQuery.or(`creator_id.eq.${player.id},id.in.(${partIds.join(',')})`)
      : baseQuery.eq('creator_id', player.id));

    // Parties déjà closes (donc scorées) déjà exclues par la requête → set vide.
    const noScored = new Set<string>();
    const seen = new Set<string>();
    const enriched: Game[] = (data ?? [])
      .filter((g: any) => {
        if (seen.has(g.id)) return false;
        seen.add(g.id);
        return isGameReadyToScore(g, player.id, noScored);
      })
      .map((g: any) => {
        const accepted = (g.participants ?? []).filter((p: any) => p.status === 'accepted');
        const allParticipants: Participant[] = accepted.map((p: any) => ({
          id: p.player_id, name: p.player?.name ?? '?', elo_score: p.player?.elo_score ?? 0,
          team_side: p.team_side ?? undefined,
        }));
        const creatorInList = allParticipants.some(p => p.id === g.creator_id);
        if (!creatorInList && g.creator) {
          allParticipants.unshift({ id: g.creator_id, name: g.creator.name ?? '?', elo_score: g.creator.elo_score ?? 0, team_side: g.creator_side ?? undefined });
        }
        return {
          id: g.id,
          location: g.location ?? '—',
          match_date: g.match_date,
          is_challenge: g.is_challenge ?? false,
          game_format: g.game_format ?? 'competitive',
          creator_id: g.creator_id,
          creator_side: g.creator_side ?? undefined,
          participants: allParticipants,
        };
      });

    setGames(enriched);
    setLoading(false);
  }, [player]);

  const loadContestGame = useCallback(async () => {
    if (!player || !contestMatchId) return;
    setLoading(true);
    const { data: match } = await supabase
      .from('matches')
      .select('game_id, game_format, is_challenge, winner:winner_id(id, name, elo_score), winner_2:winner_id_2(id, name, elo_score), loser:loser_id(id, name, elo_score), loser_2:loser_id_2(id, name, elo_score)')
      .eq('id', contestMatchId)
      .single();

    if (match) {
      // team_side synthétique : vainqueurs = équipe A, perdants = équipe B, pour
      // que defaultPartnerId retrouve le bon coéquipier en mode contestation.
      const SIDES: Record<number, string> = { 0: 'A_GAU', 1: 'A_DRO', 2: 'B_GAU', 3: 'B_DRO' };
      const participants: Participant[] = ([match.winner, match.winner_2, match.loser, match.loser_2] as any[])
        .map((p: any, i: number) => (p ? { id: p.id, name: p.name ?? '?', elo_score: p.elo_score ?? 0, team_side: SIDES[i] } : null))
        .filter(Boolean) as Participant[];

      let location = '—';
      let match_date = new Date().toISOString();
      if ((match as any).game_id) {
        const { data: game } = await supabase
          .from('open_games')
          .select('location, match_date')
          .eq('id', (match as any).game_id)
          .single();
        if (game) { location = game.location ?? '—'; match_date = game.match_date; }
      }

      setGames([{
        id: (match as any).game_id ?? contestMatchId,
        location,
        match_date,
        is_challenge: (match as any).is_challenge ?? false,
        game_format: (match as any).game_format ?? 'competitive',
        participants,
      }]);
      autoOpened.current = false;
    }
    setLoading(false);
  }, [player, contestMatchId]);

  useFocusEffect(useCallback(() => {
    autoOpened.current = false;
    if (contestMatchId) { loadContestGame(); } else { fetchGames(); }
  }, [fetchGames, loadContestGame, contestMatchId]));

  useEffect(() => {
    if (!gameId || games.length === 0 || autoOpened.current) return;
    const target = games.find(g => g.id === gameId);
    if (target) { autoOpened.current = true; openScoring(target); }
  }, [gameId, games]);

  useEffect(() => {
    if (!contestMatchId || games.length === 0 || autoOpened.current) return;
    autoOpened.current = true;
    openScoring(games[0]);
  }, [contestMatchId, games]);

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
    setScoringId(game.id);
    setPartnerId(defaultPartnerId(game, player?.id ?? ''));
    setPartnerChanged(false);
    setSets([{ t1: null, t2: null }, { t1: null, t2: null }]);
    setVotes({});
    setContestReason('');
  };

  const closeScoring = () => {
    setScoringId(null);
    setPartnerChanged(false);
    setSets([{ t1: null, t2: null }]);
    setVotes({});
    setContestReason('');
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
    const scoreText = activeSets.map(s => `${s.t1}-${s.t2}`).join(', ');
    setSubmitting(true);

    // ── Contest (counter-proposal) mode ──────────────────────
    if (contestMatchId) {
      try {
        // On mémorise le RÉSULTAT COMPLET proposé (pas juste le score) pour que
        // l'auteur original puisse l'« accepter » et que le trigger ELO reçoive
        // le bon vainqueur (cf. migration counter_resolution.sql).
        const iWon = t1Sets > t2Sets;
        const opponents = game.participants.filter(p => p.id !== partnerId && p.id !== player!.id);
        const { data: origMatch, error } = await supabase
          .from('matches')
          .update({
            status: 'counter_proposed',
            counter_score_text: scoreText,
            counter_reason: contestReason.trim() || null,
            counter_by: player!.id,
            counter_proposed_at: new Date().toISOString(),
            counter_winner_id:   iWon ? player!.id        : opponents[0]?.id ?? null,
            counter_winner_id_2: iWon ? partnerId || null : opponents[1]?.id ?? null,
            counter_loser_id:    iWon ? opponents[0]?.id ?? null : player!.id,
            counter_loser_id_2:  iWon ? opponents[1]?.id ?? null : partnerId || null,
          })
          .eq('id', contestMatchId)
          .select('created_by')
          .single();
        if (error) throw error;

        if (origMatch?.created_by) {
          notifyPlayers({
            playerIds: [origMatch.created_by],
            title: '⚠️ Score contesté',
            body: `${player!.name} a proposé un score alternatif — ${scoreText}`,
            data: { type: 'match', matchId: contestMatchId },
          });
        }

        const voteInserts: any[] = [];
        Object.entries(votes).forEach(([rid, labels]) =>
          labels.forEach(label => voteInserts.push({ match_id: contestMatchId, giver_id: player!.id, receiver_id: rid, badge_type: label }))
        );
        if (voteInserts.length > 0) await supabase.from('reputation_votes').insert(voteInserts);

        closeScoring();
        Alert.alert('Contestation envoyée', "Le score alternatif a été soumis.", [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } catch (e) {
        console.error('[doSubmit/contest]', e);
        Alert.alert('Erreur', "Impossible d'envoyer la contestation.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // ── Normal submission mode ────────────────────────────────
    const iWon = t1Sets > t2Sets;
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
      game_format: game.game_format ?? 'competitive',
      is_challenge: game.is_challenge ?? false,
    };
    try {
      const { data: newMatch, error } = await supabase.from('matches').insert([matchPayload]).select().single();
      if (error) throw error;

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
    } catch (e) {
      console.error('[doSubmit]', e);
      Alert.alert('Erreur', "Réessaie, le score n'a pas été enregistré.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (game: Game) => {
    if (!player) return;
    // Doubles uniquement (pas de 1v1) : partenaire + exactement 2 adversaires
    const oppCount = game.participants.filter(p => p.id !== player.id && p.id !== partnerId).length;
    if (!partnerId || oppCount !== 2) {
      Alert.alert('Match en double', 'Le padel se joue en 2 contre 2 : sélectionne ton partenaire et assure-toi qu’il y a bien 4 joueurs (toi + partenaire + 2 adversaires).');
      return;
    }
    const activeSets = sets.filter(s => s.t1 !== null && s.t2 !== null) as { t1: number; t2: number }[];
    if (activeSets.length < 2) { Alert.alert('Sets incomplets', 'Un match doit compter au moins 2 sets.'); return; }
    const err = validateSets(activeSets);
    if (err) { Alert.alert('Score invalide', err); return; }

    let t1Sets = 0, t2Sets = 0;
    activeSets.forEach(s => s.t1 > s.t2 ? t1Sets++ : t2Sets++);

    // Pas de match nul : un match doit avoir un vainqueur, sinon le score
    // serait enregistré avec un gagnant arbitraire (opponents[0]) et le
    // trigger ELO distribuerait des points à tort.
    if (t1Sets === t2Sets) {
      Alert.alert(
        'Match nul impossible',
        'Un match doit avoir un vainqueur. Ajoute un set décisif pour départager les équipes (nombre impair de sets gagnés).',
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
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: Colors.heroBg }}>
      {/* Dark hero header */}
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 28 }}>
        <TouchableOpacity onPress={() => router.back()}
          style={{ width: 36, height: 36, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={Colors.textOnDark} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M15 18l-6-6 6-6" />
          </Svg>
        </TouchableOpacity>
        <Text style={{ fontSize: 30, color: Colors.textOnDark, letterSpacing: -0.5, fontFamily: Fonts.welcome }}>
          {contestMatchId ? (<>Contester le <Text style={{ color: Colors.brand }}>score</Text></>) : (<>Le <Text style={{ color: Colors.brand }}>score</Text></>)}
        </Text>
        <Text style={{ fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>
          {loading ? 'Chargement…' : contestMatchId
            ? 'Entre ton score — il sera soumis en contre-proposition'
            : games.length > 0
              ? `${games.length} partie${games.length > 1 ? 's' : ''} en attente`
              : 'Aucune partie à scorer'}
        </Text>
      </View>

      {/* Content card */}
      <View style={{ flex: 1, backgroundColor: Colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>

        {/* Search + filters */}
        <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 }}>
          <View style={sty.searchBar}>
            <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={Colors.textMuted} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </Svg>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Lieu ou joueur…"
              placeholderTextColor={Colors.textMuted}
              style={sty.searchInput}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingVertical: 10 }}>
            {(['all', 'competitive', 'friendly', 'challenge'] as GameType[]).map(t => {
              const active = typeFilter === t;
              const color = t === 'all' ? Colors.textPrimary : TYPE_COLOR[t];
              const bg    = t === 'all' ? (active ? Colors.primary : Colors.bgCardAlt) : (active ? TYPE_BG[t] : Colors.bgCardAlt);
              const fg    = active ? (t === 'all' ? Colors.textOnDark : color) : Colors.textSecondary;
              const border = active ? (t === 'all' ? Colors.primary : color) : 'transparent';
              return (
                <TouchableOpacity key={t} onPress={() => setTypeFilter(t)} activeOpacity={0.75}
                  style={{ backgroundColor: bg, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1.5, borderColor: border }}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: fg, fontFamily: Fonts.uiExtraBold }}>
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
            <Text style={{ fontSize: 15, fontWeight: '900', color: Colors.textPrimary, marginBottom: 4, fontFamily: Fonts.uiBlack }}>
              {games.length === 0 ? 'Aucune partie à scorer' : 'Aucun résultat'}
            </Text>
            <Text style={{ fontSize: 12, color: Colors.textMuted, fontWeight: '600', textAlign: 'center' }}>
              {games.length === 0 ? 'Tes parties Lobby terminées apparaîtront ici' : 'Essaie un autre filtre ou terme de recherche'}
            </Text>
          </View>
        ) : filteredGames.map(game => {
          const isScoring = scoringId === game.id;
          const others = game.participants.filter(p => p.id !== player?.id);
          const partner = game.participants.find(p => p.id === partnerId);
          const oppCount = others.filter(p => p.id !== partnerId).length;
          const activeSets = sets.filter(s => s.t1 !== null && s.t2 !== null) as { t1: number; t2: number }[];
          const scorePreview = activeSets.map(s => `${s.t1}-${s.t2}`).join(' / ');
          // Doubles obligatoire : partenaire sélectionné + exactement 2 adversaires
          const canSubmit = activeSets.length >= 2 && !!partnerId && oppCount === 2 && !submitting;

          return (
            <View key={game.id} style={sty.gameCard}>
              {/* Game header */}
              <View style={{ padding: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <Text style={{ fontSize: 16, fontWeight: '900', color: Colors.textPrimary, flex: 1, fontFamily: Fonts.uiBlack }} numberOfLines={1}>{game.location}</Text>
                      {(() => { const t = getGameType(game); return (
                        <Pill variant={TYPE_VARIANT[t]}>{TYPE_LABEL[t]}</Pill>
                      ); })()}
                    </View>
                    <Text style={{ fontSize: 12, color: Colors.textSecondary, fontWeight: '600', marginTop: 2 }}>
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
                    <Text style={sty.sectionLabel}>🤝 Avec qui as-tu joué ?</Text>

                    {/* Partenaire par défaut (celui de la création) — affiché tant qu'on n'a pas changé */}
                    {!partnerChanged && (
                      partner ? (
                        <View style={[sty.partnerChip, sty.partnerChipSel, { marginTop: 8 }]}>
                          <View style={[sty.partnerAvatar, { backgroundColor: Colors.primary }]}>
                            <Text style={{ fontSize: 15, fontWeight: '900', color: Colors.textOnDark }}>
                              {partner.name.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[sty.partnerName, { color: Colors.primary }]} numberOfLines={1}>{partner.name}</Text>
                            <Text style={{ fontSize: 10, color: Colors.textMuted, fontWeight: '600' }}>
                              Niv. {formatPadelLevel(partner.elo_score)}
                            </Text>
                          </View>
                        </View>
                      ) : (
                        <Text style={{ fontSize: 11, color: Colors.danger, fontWeight: '700', marginTop: 8 }}>
                          Partenaire introuvable — réponds « Oui » pour le sélectionner.
                        </Text>
                      )
                    )}

                    {/* As-tu changé de partenaire ? Non (défaut) / Oui */}
                    <Text style={{ fontSize: 12, color: Colors.textSecondary, fontWeight: '700', marginTop: 12, marginBottom: 8 }}>
                      As-tu changé de partenaire ?
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {([['Non', false], ['Oui', true]] as const).map(([label, val]) => {
                        const active = partnerChanged === val;
                        return (
                          <TouchableOpacity key={label} activeOpacity={0.8}
                            onPress={() => {
                              if (val) setPartnerChanged(true);
                              else { setPartnerChanged(false); setPartnerId(defaultPartnerId(game, player?.id ?? '')); }
                            }}
                            style={{ flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center',
                              borderWidth: 2, borderColor: active ? Colors.primary : Colors.border,
                              backgroundColor: active ? Colors.primary : Colors.bgCard }}
                          >
                            <Text style={{ fontSize: 13, fontWeight: '900', color: active ? Colors.textOnDark : Colors.textSecondary }}>{label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    {/* Sélecteur du nouveau partenaire — seulement si « Oui » */}
                    {partnerChanged && (
                      <>
                        <Text style={{ fontSize: 11, color: Colors.textMuted, fontWeight: '600', marginTop: 12, marginBottom: 10 }}>
                          Sélectionne ton partenaire — les 2 autres seront tes adversaires.
                        </Text>
                        <View style={{ gap: 8 }}>
                          {others.map(p => {
                            const sel = partnerId === p.id;
                            return (
                              <TouchableOpacity key={p.id} onPress={() => setPartnerId(p.id)}
                                style={[sty.partnerChip, sel && sty.partnerChipSel]}
                                activeOpacity={0.75}
                              >
                                <View style={[sty.partnerAvatar, { backgroundColor: sel ? Colors.primary : Colors.border }]}>
                                  <Text style={{ fontSize: 15, fontWeight: '900', color: sel ? Colors.textOnDark : Colors.textSecondary }}>
                                    {p.name.charAt(0).toUpperCase()}
                                  </Text>
                                  {p.id === game.creator_id ? <CreatorCrownBadge avatarSize={36} /> : null}
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Text style={[sty.partnerName, sel && { color: Colors.primary }]} numberOfLines={1}>{p.name}</Text>
                                  <Text style={{ fontSize: 10, color: Colors.textMuted, fontWeight: '600' }}>
                                    Niv. {formatPadelLevel(p.elo_score)}
                                  </Text>
                                </View>
                                {sel && (
                                  <View style={{ marginLeft: 'auto', backgroundColor: Colors.primary, borderRadius: 999, width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
                                    <Text style={{ fontSize: 8, color: Colors.textOnDark, fontWeight: '900' }}>✓</Text>
                                  </View>
                                )}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </>
                    )}
                  </View>

                  {/* Score sets */}
                  <View style={{ marginBottom: 16 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <Text style={sty.sectionLabel}>Score (tes points en premier)</Text>
                      {sets.length < 3 && (
                        <TouchableOpacity onPress={() => setSets(prev => [...prev, { t1: null, t2: null }])}
                          style={{ backgroundColor: 'rgba(255,193,26,0.14)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(255,193,26,0.55)' }}>
                          <Text style={{ fontSize: 11, fontWeight: '800', color: Colors.brandDeep, fontFamily: Fonts.uiExtraBold }}>+ Set</Text>
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
                      <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textSecondary, marginBottom: 2 }}>Score</Text>
                      <Text style={{ fontSize: 22, fontWeight: '900', color: Colors.textPrimary, letterSpacing: 0.5, fontFamily: Fonts.uiBlack }}>{scorePreview}</Text>
                    </View>
                  )}

                  {/* Badges */}
                  {others.length > 0 && badges.length > 0 && (
                    <View style={{ marginBottom: 16 }}>
                      <Text style={sty.sectionLabel}>🌟 Distribue tes badges</Text>
                      <Text style={{ fontSize: 11, color: Colors.textMuted, fontWeight: '600', marginBottom: 10 }}>
                        Optionnel — tu peux en donner plusieurs par joueur
                      </Text>
                      {others.map(p => (
                        <BadgeGrid key={p.id} player={p} votes={votes[p.id] ?? []} badges={badges} onToggle={label => toggleVote(p.id, label)} />
                      ))}
                    </View>
                  )}

                  {/* Motif de contestation (mode contestation uniquement) */}
                  {contestMatchId && (
                    <View style={{ marginBottom: 16 }}>
                      <Text style={sty.sectionLabel}>✏️ Pourquoi contestes-tu ce score ?</Text>
                      <Text style={{ fontSize: 11, color: Colors.textMuted, fontWeight: '600', marginBottom: 8 }}>
                        Optionnel — aide l'administrateur à trancher en cas de litige
                      </Text>
                      <TextInput
                        value={contestReason}
                        onChangeText={t => setContestReason(t.slice(0, 200))}
                        placeholder="Ex. : le 3e set était 7-5, pas 6-4"
                        placeholderTextColor={Colors.textMuted}
                        multiline
                        style={sty.reasonInput}
                      />
                      <Text style={{ fontSize: 10, color: Colors.textMuted, fontWeight: '600', textAlign: 'right', marginTop: 4 }}>
                        {contestReason.length}/200
                      </Text>
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
                        ? <ActivityIndicator color={Colors.textOnDark} size="small" />
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
    backgroundColor: Colors.bgCard, borderRadius: 24, borderWidth: 1, borderColor: Colors.border,
    padding: 48, alignItems: 'center', justifyContent: 'center',
  },
  gameCard: {
    backgroundColor: Colors.bgCard, borderRadius: 24, borderWidth: 1, borderColor: Colors.border,
    marginBottom: 14, overflow: 'hidden',
    shadowColor: Colors.textPrimary, shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  playerPill: {
    backgroundColor: Colors.bgCardAlt, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.border,
  },
  playerPillTxt: { fontSize: 11, fontWeight: '700', color: Colors.textPrimary, fontFamily: Fonts.uiBold },
  scorerBtn: {
    backgroundColor: Colors.primary, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 8,
  },
  scorerBtnTxt: { fontSize: 13, fontWeight: '900', color: Colors.textOnDark, fontFamily: Fonts.uiBlack },
  scoringArea: {
    borderTopWidth: 1, borderTopColor: '#e0e7ff', backgroundColor: Colors.bgCardAlt,
    padding: 16,
  },
  sectionLabel: { fontSize: 11, fontWeight: '900', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6, fontFamily: Fonts.uiBlack },
  setRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.bgCard, borderRadius: 14, padding: 12,
    marginBottom: 8, borderWidth: 1, borderColor: Colors.border,
  },
  setLabel: { fontSize: 11, fontWeight: '800', color: Colors.textMuted, width: 36 },
  setPickersWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, justifyContent: 'center' },
  dash: { fontSize: 20, fontWeight: '900', color: Colors.border },
  dropTrigger: {
    width: 58, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.border, gap: 2,
  },
  dropValue: { fontSize: 24, fontWeight: '900', color: Colors.textPrimary, lineHeight: 28 },
  dropSheet: {
    backgroundColor: Colors.bgCard, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24, paddingTop: 16,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: -4 }, elevation: 12,
  },
  dropItem: {
    width: 64, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.bg, borderWidth: 1.5, borderColor: Colors.border,
  },
  dropItemSel: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dropItemTxt: { fontSize: 22, fontWeight: '900', color: Colors.textSecondary },
  dropItemTxtSel: { color: Colors.textOnDark },
  previewBox: {
    backgroundColor: Colors.bgCard, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.primary,
    padding: 14, alignItems: 'center', marginBottom: 16,
  },
  partnerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.bgCard, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border,
    paddingVertical: 11, paddingHorizontal: 12,
  },
  partnerChipSel: { borderColor: Colors.brand, backgroundColor: 'rgba(255,193,26,0.14)' },
  partnerAvatar: { width: 36, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  partnerName: { fontSize: 13, fontWeight: '800', color: Colors.textPrimary, fontFamily: Fonts.uiExtraBold },
  badgeCard: {
    backgroundColor: Colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: Colors.border,
    padding: 12, marginBottom: 10,
  },
  badgeBtn: {
    alignItems: 'center', gap: 4, padding: 10, borderRadius: 14,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.bgCard,
    width: 72,
  },
  badgeBtnSel: { borderColor: Colors.brand, backgroundColor: 'rgba(255,193,26,0.14)' },
  badgeTxt: { fontSize: 8, fontWeight: '900', color: Colors.textMuted, textTransform: 'uppercase', textAlign: 'center', letterSpacing: 0.3, fontFamily: Fonts.uiBlack },
  badgeTxtSel: { color: Colors.brandDeep },
  badgeCheck: {
    position: 'absolute', top: -5, right: -5, width: 14, height: 14,
    backgroundColor: Colors.primary, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.bgCard,
  },
  cancelBtn: {
    flex: 1, backgroundColor: Colors.bgCardAlt, borderRadius: 14, padding: 14, alignItems: 'center',
  },
  cancelBtnTxt: { fontSize: 14, fontWeight: '800', color: Colors.textSecondary, fontFamily: Fonts.uiExtraBold },
  submitBtn: {
    flex: 2, backgroundColor: Colors.primary, borderRadius: 14, padding: 14, alignItems: 'center',
  },
  submitBtnTxt: { fontSize: 14, fontWeight: '900', color: Colors.textOnDark, fontFamily: Fonts.uiBlack },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  searchInput: {
    flex: 1, fontSize: 14, fontWeight: '600', color: Colors.textPrimary, padding: 0,
  },
  reasonInput: {
    backgroundColor: Colors.bgCard, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontWeight: '600',
    color: Colors.textPrimary, minHeight: 64, textAlignVertical: 'top',
  },
});
