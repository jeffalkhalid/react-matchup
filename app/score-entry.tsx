import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { usePlayer } from '../hooks/usePlayer';
import { supabase } from '../lib/supabase';
import { Colors, formatPadelLevel, Fonts, eloToLevel } from '../lib/theme';
import { Pill, type PillVariant } from '../components/Pill';
import { CreatorCrownBadge } from '../components/CreatorCrownBadge';
import { notifyPlayers } from '../lib/notify';
import { isGameReadyToScore } from '../lib/games';
import { getLiveScoringEnabled, fetchLiveSession } from '../lib/liveSession';
import { BadgePill } from '../components/profile/BadgePill';
import { useActiveVoteBadges } from '../components/profile/BadgeDefsProvider';
import type { VoteBadge } from '../lib/badges';
import { matchToView } from '../lib/matchView';
import { MatchCard as MatchScoreCard, Avatar, LevelPill } from '../components/profile/components';
import { PM, ACCENT, accentOf, PFonts } from '../components/profile/theme';
import type { Match } from '../types';

// ─── Constants ────────────────────────────────────────────────
type GameType = 'all' | 'competitive' | 'friendly' | 'challenge';

interface SetScore { t1: number | null; t2: number | null }
interface Participant { id: string; name: string; elo_score: number; team_side?: string }
interface Game {
  id: string; location: string; match_date: string;
  is_challenge?: boolean; game_format?: string; stake_multiplier?: number;
  creator_id?: string; creator_side?: string;
  participants: Participant[];
}

// Côté → équipe (A_GAU/A_DRO → A, B_GAU/B_DRO → B)
const teamOf = (side?: string | null) => (side ? side.charAt(0) : null);

// Pastilles joueurs par équipe (identité PagMatch : A = jaune brand, B = noir) ;
// joueur sans team_side connu → pastille neutre, rangé en dernier.
const TEAM_PILL: Record<string, { bg: string; border: string; txt: string }> = {
  A: { bg: Colors.brand, border: Colors.brandDeep, txt: Colors.textOnBrand },
  B: { bg: Colors.primary, border: Colors.primary, txt: Colors.textOnDark },
};
const teamRank = (p: Participant) => { const t = teamOf(p.team_side); return t === 'A' ? 0 : t === 'B' ? 1 : 2; };

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

// ─── Saisie au format carte historique ────────────────────────
// Même visuel que la carte de match du profil/historique (équipes à gauche,
// grille de score à droite), mais les cases de la grille sont des champs :
// on tape le chiffre (0-7) et le focus saute à la case suivante.
// Ligne du haut = mon équipe ; la ligne qui mène est surlignée comme sur la carte.
const AC = accentOf(ACCENT);
const CELL_W = 46;

function ScoreCardEntry({ sets, meId, myTeam, oppTeam, onCell, onRemoveLast, canRemoveLast }: {
  sets: SetScore[]; meId: string;
  myTeam: Participant[]; oppTeam: Participant[];
  onCell: (setIdx: number, row: 0 | 1, v: number | null) => void;
  onRemoveLast: () => void; canRemoveLast: boolean;
}) {
  const inputs = useRef<Record<string, TextInput | null>>({});

  // Équipe qui mène = plus de sets gagnés (complets et valides uniquement).
  let w0 = 0, w1 = 0;
  sets.forEach(s => {
    if (s.t1 === null || s.t2 === null || validateSet(s)) return;
    if (s.t1 > s.t2) w0++; else w1++;
  });
  const leadRow: 0 | 1 | null = w0 === w1 ? null : w0 > w1 ? 0 : 1;

  const focusNext = (i: number, row: 0 | 1) => {
    inputs.current[row === 0 ? `${i}-1` : `${i + 1}-0`]?.focus();
  };

  const renderPlayer = (p: Participant, team: 0 | 1) => {
    const me = p.id === meId;
    return (
      <View key={p.id} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Avatar name={p.name} size={28} me={me} team={team} />
        <View style={{ minWidth: 0, gap: 2 }}>
          <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: me ? '800' : '600', color: PM.text, maxWidth: 90 }}>
            {p.name.split(' ')[0]}
          </Text>
          <LevelPill lvl={p.elo_score ? eloToLevel(p.elo_score) : undefined} />
        </View>
      </View>
    );
  };

  const renderCell = (i: number, row: 0 | 1) => {
    const v = row === 0 ? sets[i].t1 : sets[i].t2;
    const lead = leadRow === row;
    return (
      <TextInput
        key={`${i}-${row}`}
        ref={r => { inputs.current[`${i}-${row}`] = r; }}
        value={v === null ? '' : String(v)}
        onChangeText={txt => {
          const d = txt.replace(/[^0-7]/g, '').slice(-1);
          if (d === '') { onCell(i, row, null); return; }
          onCell(i, row, Number(d));
          focusNext(i, row);
        }}
        keyboardType="number-pad"
        selectTextOnFocus
        placeholder="–"
        placeholderTextColor={PM.faint}
        style={{
          width: CELL_W, paddingVertical: 10, textAlign: 'center',
          fontFamily: PFonts.anton, fontSize: 19,
          color: lead ? ACCENT : PM.muted,
          backgroundColor: lead ? AC.soft : 'transparent',
          borderRightWidth: i < sets.length - 1 ? 1 : 0, borderRightColor: PM.divider,
          borderBottomWidth: row === 0 ? 1 : 0, borderBottomColor: PM.divider,
        }}
      />
    );
  };

  return (
    <View style={{ backgroundColor: PM.card, borderRadius: 18, borderWidth: 1, borderColor: PM.border, padding: 12 }}>
      {/* Libellés des sets, alignés sur les colonnes de la grille */}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 4, paddingRight: 1 }}>
        {sets.map((_, i) => (
          <View key={i} style={{ width: CELL_W, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
            <Text style={{ fontSize: 8.5, fontWeight: '900', letterSpacing: 0.4, color: PM.faint }}>SET {i + 1}</Text>
            {canRemoveLast && i === sets.length - 1 && (
              <TouchableOpacity onPress={onRemoveLast} hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: PM.faint }}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>{myTeam.map(p => renderPlayer(p, 0))}</View>
          <View style={{ flexDirection: 'row', gap: 10 }}>{oppTeam.map(p => renderPlayer(p, 1))}</View>
        </View>
        <View style={{ borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: PM.border, backgroundColor: '#FBFBFA' }}>
          <View style={{ flexDirection: 'row' }}>{sets.map((_, i) => renderCell(i, 0))}</View>
          <View style={{ flexDirection: 'row' }}>{sets.map((_, i) => renderCell(i, 1))}</View>
        </View>
      </View>
    </View>
  );
}

// ─── Badge grid ───────────────────────────────────────────────
function BadgeGrid({ player, votes, badges, onToggle }: {
  player: Participant; votes: string[];
  badges: VoteBadge[]; onToggle: (key: string) => void;
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
        {badges.map(b => {
          const sel = votes.includes(b.key);
          return (
            <TouchableOpacity key={b.key} onPress={() => onToggle(b.key)}
              style={[sty.badgeBtn, sel && sty.badgeBtnSel]}
              activeOpacity={0.75}
            >
              <BadgePill badge={b.key} size={24} />
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
  // gameId -> session id, uniquement pour les sessions live actives (flag
  // live_scoring_enabled). Flag éteint ⇒ jamais peuplé, jamais de requête.
  const [liveSessionByGame, setLiveSessionByGame] = useState<Record<string, string>>({});
  // gameId -> brouillon de sets issu d'une session live ABANDONNÉE : le travail
  // du scoreur n'est pas perdu, il est pré-rempli dans la saisie classique.
  const [abandonedSetsByGame, setAbandonedSetsByGame] = useState<Record<string, { t1: number; t2: number }[]>>({});
  // Badges votables = badge_defs actifs (source unique, pilotée par l'admin) ; MVP exclu du vote.
  const badges = useActiveVoteBadges().filter(b => b.key !== 'MVP');
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
  // Mode contestation : ligne `matches` complète du score contesté, pour le
  // rappel du match via la carte standard (source unique matchToView + <MatchCard>).
  const [contestMatch, setContestMatch] = useState<Match | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchGames = useCallback(async () => {
    if (!player) return;
    setLoading(true);
    const now = new Date().toISOString();
    const GAME_SELECT = 'id, location, match_date, status, is_challenge, game_format, stake_multiplier, creator_id, creator_side, creator:creator_id(id, name, elo_score), participants:game_participants(id, player_id, status, team_side, player:player_id(id, name, elo_score))';

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
      // Pas de limit : la fenêtre 48 h borne déjà le volume, et une partie
      // tronquée ici serait impossible à scorer.
      .order('match_date', { ascending: false });

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
          stake_multiplier: g.stake_multiplier ?? 1.0,
          creator_id: g.creator_id,
          creator_side: g.creator_side ?? undefined,
          participants: allParticipants,
        };
      });

    setGames(enriched);
    setLoading(false);

    // Masquage des parties en live actif — derrière le flag : zéro requête
    // live_match_sessions si désactivé.
    setLiveSessionByGame({});
    setAbandonedSetsByGame({});
    if (await getLiveScoringEnabled()) {
      const sessions = await Promise.all(enriched.map(g => fetchLiveSession(g.id)));
      const byGame: Record<string, string> = {};
      const draftByGame: Record<string, { t1: number; t2: number }[]> = {};
      sessions.forEach((s, i) => {
        if (s?.status === 'live') { byGame[enriched[i].id] = s.id; return; }
        if (s?.status !== 'abandoned') return;
        // Sets terminés + set courant s'il n'est pas vierge, plafonnés au max
        // de l'UI (3 sets).
        const all = s.current_state?.sets ?? [];
        const done = all.slice(0, -1);
        const cur = all[all.length - 1];
        const draft = [...done, ...(cur && (cur.t1 > 0 || cur.t2 > 0) ? [cur] : [])].slice(0, 3);
        if (draft.length > 0) draftByGame[enriched[i].id] = draft.map(x => ({ t1: x.t1, t2: x.t2 }));
      });
      setLiveSessionByGame(byGame);
      setAbandonedSetsByGame(draftByGame);
    }
  }, [player]);

  const loadContestGame = useCallback(async () => {
    if (!player || !contestMatchId) return;
    setLoading(true);
    // Mêmes jointures que le lobby (MATCH_SELECT) : la ligne complète alimente
    // le rappel du match (matchToView) ET la construction du Game ci-dessous.
    const { data: match } = await supabase
      .from('matches')
      .select('*, winner:winner_id(id, name, deleted_at, elo_score), winner_2:winner_id_2(id, name, deleted_at, elo_score), loser:loser_id(id, name, deleted_at, elo_score), loser_2:loser_id_2(id, name, deleted_at, elo_score), game:game_id(location, match_date, creator_id)')
      .eq('id', contestMatchId)
      .single();

    if (match) {
      setContestMatch(match as unknown as Match);
      // team_side synthétique : vainqueurs = équipe A, perdants = équipe B, pour
      // que defaultPartnerId retrouve le bon coéquipier en mode contestation.
      const SIDES: Record<number, string> = { 0: 'A_GAU', 1: 'A_DRO', 2: 'B_GAU', 3: 'B_DRO' };
      const participants: Participant[] = ([match.winner, match.winner_2, match.loser, match.loser_2] as any[])
        .map((p: any, i: number) => (p ? { id: p.id, name: p.name ?? '?', elo_score: p.elo_score ?? 0, team_side: SIDES[i] } : null))
        .filter(Boolean) as Participant[];

      const location = (match as any).game?.location ?? '—';
      const match_date = (match as any).game?.match_date ?? (match as any).created_at ?? new Date().toISOString();

      setGames([{
        id: (match as any).game_id ?? contestMatchId,
        location,
        match_date,
        is_challenge: (match as any).is_challenge ?? false,
        game_format: (match as any).game_format ?? 'competitive',
        stake_multiplier: (match as any).stake_multiplier ?? 1.0,
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
    // Suivi live abandonné : on repart du score déjà saisi jeu par jeu.
    const draft = abandonedSetsByGame[game.id];
    setSets(draft && draft.length > 0
      ? draft.map(s => ({ t1: s.t1, t2: s.t2 } as SetScore))
      : [{ t1: null, t2: null }, { t1: null, t2: null }]);
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
      stake_multiplier: game.stake_multiplier ?? 1.0,
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
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontSize: 30, lineHeight: 39, color: Colors.textOnDark, letterSpacing: -0.5, fontFamily: Fonts.welcome, paddingRight: 5 }}>
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

        {/* Mode contestation : rappel du match contesté via la carte standard
            (source unique matchToView + <MatchCard>) — score soumis, joueurs, lieu, date. */}
        {!loading && !!contestMatchId && !!contestMatch && !!player && (
          <View style={{ marginBottom: 14 }}>
            <Text style={sty.sectionLabel}>📋 Score soumis — c'est lui que tu contestes</Text>
            <View style={{ marginTop: 8 }}>
              <MatchScoreCard m={matchToView(contestMatch, player.id)} showDelta={false} showActions={false} />
            </View>
          </View>
        )}

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
          const liveSessionId = liveSessionByGame[game.id];
          if (liveSessionId) {
            return (
              <TouchableOpacity
                key={game.id}
                style={[sty.gameCard, { padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }]}
                activeOpacity={0.8}
                onPress={() => router.push(`/live/${liveSessionId}` as any)}
              >
                <Text style={{ fontSize: 14, fontWeight: '800', color: Colors.textPrimary, fontFamily: Fonts.uiBold, flex: 1 }} numberOfLines={1}>
                  🔴 Score en direct en cours — {game.location}
                </Text>
              </TouchableOpacity>
            );
          }
          const isScoring = scoringId === game.id;
          const others = game.participants.filter(p => p.id !== player?.id);
          const partner = game.participants.find(p => p.id === partnerId);
          const oppCount = others.filter(p => p.id !== partnerId).length;
          const activeSets = sets.filter(s => s.t1 !== null && s.t2 !== null) as { t1: number; t2: number }[];
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
                      {[...game.participants].sort((a, b) => teamRank(a) - teamRank(b)).map(p => {
                        const tc = TEAM_PILL[teamOf(p.team_side) ?? ''];
                        return (
                          <View key={p.id} style={[sty.playerPill, tc && { backgroundColor: tc.bg, borderColor: tc.border }]}>
                            <Text style={[sty.playerPillTxt, tc && { color: tc.txt }]}>👤 {p.name}</Text>
                          </View>
                        );
                      })}
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

                  {/* Score — saisie directe dans la carte au format historique */}
                  <View style={{ marginBottom: 16 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <Text style={sty.sectionLabel}>Score — remplis les cases</Text>
                      {sets.length < 3 && (
                        <TouchableOpacity onPress={() => setSets(prev => [...prev, { t1: null, t2: null }])}
                          style={{ backgroundColor: 'rgba(255,193,26,0.14)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(255,193,26,0.55)' }}>
                          <Text style={{ fontSize: 11, fontWeight: '800', color: Colors.brandDeep, fontFamily: Fonts.uiExtraBold }}>+ Set</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <ScoreCardEntry
                      sets={sets}
                      meId={player?.id ?? ''}
                      myTeam={[
                        ...(player ? [{ id: player.id, name: player.name, elo_score: player.elo_score ?? 0 }] : []),
                        ...(partner ? [partner] : []),
                      ]}
                      oppTeam={others.filter(p => p.id !== partnerId)}
                      onCell={(i, row, v) => setSets(prev => prev.map((s, j) => j === i ? (row === 0 ? { ...s, t1: v } : { ...s, t2: v }) : s))}
                      onRemoveLast={() => setSets(prev => prev.slice(0, -1))}
                      canRemoveLast={sets.length > 1}
                    />
                    {sets.map((s, i) => {
                      const err = validateSet(s);
                      return err ? (
                        <Text key={i} style={{ fontSize: 12, color: Colors.danger, fontWeight: '700', marginTop: 6, marginLeft: 6 }}>
                          ⚠ Set {i + 1} : {err}
                        </Text>
                      ) : null;
                    })}
                  </View>

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
    alignItems: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 14,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.bgCard,
    // 4 colonnes (2 lignes pour 8 badges) : largeur relative au conteneur, gap 8 absorbé.
    flexBasis: '22%', flexGrow: 1, maxWidth: '23.5%',
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
