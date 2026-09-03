import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, FlatList, LayoutAnimation, Modal, StyleSheet, Switch,
} from 'react-native';
import ColorPicker, { HueSlider, Panel1, Preview } from 'reanimated-color-picker';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../hooks/usePlayer';
import { supabase } from '../../lib/supabase';
import {
  simulateElo,
  type EloSimResult,
} from '../../lib/elo';
import { Colors, Fonts, eloToLevel } from '../../lib/theme';
import { displayName } from '../../lib/players';
import { formatFrmtRanking } from '../../lib/frmt-match';
import { Icon } from '../../components/community/icons';
import { BADGE_ICONS, BADGE_ICON_VIEWBOX, FALLBACK_ICON_KEY } from '../../components/profile/badgeIcons';
import { SvgXml } from 'react-native-svg';
import { loadBadgeDefs } from '../../lib/badges';
import {
  type Tournament, type TournamentRegistration, type TournamentTeam,
  type TournamentMatch, type TournamentMatchEntry, type TournamentMovement,
  type TournamentStanding, type TournamentResult, type TournamentMissingMatch,
  type TournamentStake, type TournamentResultTeamRow,
  getTournamentsEnabled, isFeatureDisabled, resultMessage,
  fetchTournaments, fetchTournament, fetchRegistrations, fetchTeams, fetchRoundMatches, fetchRoundMovements,
  fetchMatchEntries, fetchStandings, fetchTournamentMatches, fetchTournamentResults, createTournament,
  autopairTournament, startTournament, generateTournamentRound, generateFinalTournamentRound,
  resolveTournamentDispute, forfeitTournamentTeam, reopenTournamentMatch, closeTournament,
  validateTournament, openCheckIn, markNoShow, canOpenCheckIn, acceptsCheckIn,
  seatsLabel, seatsTaken, seatCount, waitlistCount, soloRegistrations, seatedTeams,
  statusLabel, statusTone, levelRangeLabel, priceLabel, formatTournamentDate, formatLabel, ROUND_MINUTES,
  nextRoundIsFinal, missingMatchLabel, countLaterRoundMatches, stakeLabel, groupResultsByTeam,
  validateTournamentScore, matchLiveStatus, pointsScaleValid, DEFAULT_POINTS_SCALE,
} from '../../lib/tournaments';
import { GENERIC_REASON } from '../../lib/tournamentReasons';
import { CourtRow, type CourtTeamInfo } from '../../components/tournaments/CourtRow';
import { StandingsTable, type StandingRowData } from '../../components/tournaments/StandingsTable';
import { FinalStandings, type FinalStandingRowData } from '../../components/tournaments/FinalStandings';
import { Pill } from '../../components/Pill';

type AdminTab = 'disputes' | 'frmt' | 'games' | 'gender' | 'reports' | 'players' | 'badges' | 'settings' | 'tournaments';

// ─── Helpers ─────────────────────────────────────────────────
function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) +
    ' ' + new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// ─── Simulation ELO card ──────────────────────────────────────
function EloSimCard({ sim }: { sim: EloSimResult }) {
  return (
    <View style={sty.simCard}>
      <Text style={sty.simLabel}>🔬 Simulation moteur ELO — K par joueur</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {sim.antiFarmMultiplier < 1 && (
          <View style={[sty.simBadge, { borderColor: '#f59e0b55', backgroundColor: '#f59e0b15' }]}>
            <Text style={[sty.simBadgeText, { color: Colors.warning }]}>Anti-farming ×{sim.antiFarmMultiplier}</Text>
          </View>
        )}
        {sim.marginMultiplier !== 1 && (
          <View style={[sty.simBadge, { borderColor: '#8b5cf655', backgroundColor: '#8b5cf615' }]}>
            <Text style={[sty.simBadgeText, { color: '#a78bfa' }]}>Marge ×{sim.marginMultiplier}</Text>
          </View>
        )}
      </View>
      {sim.players.map(p => (
        <View key={p.id} style={sty.simRow}>
          <Text style={{ fontSize: 13, flex: 1, fontWeight: '700', color: Colors.textPrimary }} numberOfLines={1}>
            {p.isWinner ? '🏆' : '💔'} {p.name}
            {p.decayFactor < 1 && (
              <Text style={{ fontSize: 10, color: '#f97316' }}> (-{Math.round((1 - p.decayFactor) * 100)}% inact.)</Text>
            )}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={[sty.simBadge, { paddingVertical: 1, paddingHorizontal: 5 }]}>
              <Text style={[sty.simBadgeText, { fontSize: 9 }]}>K{p.kFactor}</Text>
            </View>
            <Text style={{ fontSize: 12, color: Colors.textSecondary, fontWeight: '700' }}>{p.oldElo}</Text>
            <Text style={{ fontSize: 10, color: Colors.textSecondary }}>→</Text>
            <Text style={{ fontSize: 12, color: Colors.textPrimary, fontWeight: '900' }}>{p.newElo}</Text>
            <View style={{
              backgroundColor: p.change >= 0 ? '#05966915' : '#dc262615',
              borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
              borderWidth: 1, borderColor: p.change >= 0 ? '#05966955' : '#dc262655',
            }}>
              <Text style={{ fontSize: 11, fontWeight: '900', color: p.change >= 0 ? Colors.success : Colors.danger }}>
                {p.change >= 0 ? '+' : ''}{p.change}
              </Text>
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── Disputes tab ─────────────────────────────────────────────
function DisputesTab({ matches, editedScores, setEditedScores, loadingId, onForceValidate, onCancel }: {
  matches: any[];
  editedScores: Record<string, string>;
  setEditedScores: (s: Record<string, string>) => void;
  loadingId: string | null;
  onForceValidate: (m: any) => void;
  onCancel: (id: string) => void;
}) {
  if (matches.length === 0) {
    return (
      <View style={sty.emptyCard}>
        <Text style={{ fontSize: 40, marginBottom: 10 }}>🕊️</Text>
        <Text style={{ fontSize: 15, fontWeight: '900', color: Colors.textMuted, textAlign: 'center', fontFamily: Fonts.uiBlack }}>Aucun litige en cours</Text>
        <Text style={{ fontSize: 12, color: Colors.textSecondary, marginTop: 4, textAlign: 'center' }}>Tout le monde est d'accord sur les terrains !</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 14 }}>
      {matches.map(match => {
        const sim: EloSimResult | null = match.winner ? simulateElo([
          { id: match.winner.id, name: match.winner.name, elo_score: match.winner.elo_score ?? 1000, win_count: match.winner.win_count ?? 0, loss_count: match.winner.loss_count ?? 0, last_match_at: match.winner.last_match_at ?? null, fiability_pct: match.winner.fiability_pct ?? 50, isWinner: true },
          ...(match.winner_2 ? [{ id: match.winner_2.id, name: match.winner_2.name, elo_score: match.winner_2.elo_score ?? 1000, win_count: match.winner_2.win_count ?? 0, loss_count: match.winner_2.loss_count ?? 0, last_match_at: match.winner_2.last_match_at ?? null, fiability_pct: match.winner_2.fiability_pct ?? 50, isWinner: true }] : []),
          { id: match.loser.id, name: match.loser.name, elo_score: match.loser.elo_score ?? 1000, win_count: match.loser.win_count ?? 0, loss_count: match.loser.loss_count ?? 0, last_match_at: match.loser.last_match_at ?? null, fiability_pct: match.loser.fiability_pct ?? 50, isWinner: false },
          ...(match.loser_2 ? [{ id: match.loser_2.id, name: match.loser_2.name, elo_score: match.loser_2.elo_score ?? 1000, win_count: match.loser_2.win_count ?? 0, loss_count: match.loser_2.loss_count ?? 0, last_match_at: match.loser_2.last_match_at ?? null, fiability_pct: match.loser_2.fiability_pct ?? 50, isWinner: false }] : []),
        ], match.score_text) : null;

        return (
          <View key={match.id} style={sty.disputeCard}>
            <View style={sty.disputeTag}><Text style={sty.disputeTagText}>⚠ LITIGE</Text></View>

            <Text style={{ fontSize: 11, color: Colors.textSecondary, marginBottom: 6, fontWeight: '600' }}>
              Saisi par <Text style={{ color: Colors.brand, fontWeight: '800' }}>{match.creator?.name ?? '—'}</Text>
            </Text>

            {match.counter_score_text && (
              <View style={sty.counterBox}>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 3 }}>
                  <Text style={{ fontSize: 10, color: Colors.textMuted, fontWeight: '900', textTransform: 'uppercase' }}>Initial :</Text>
                  <Text style={{ fontSize: 12, color: Colors.textSecondary, textDecorationLine: 'line-through' }}>{match.score_text}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: match.counter_reason ? 3 : 0 }}>
                  <Text style={{ fontSize: 10, color: Colors.warning, fontWeight: '900', textTransform: 'uppercase' }}>Contesté :</Text>
                  <Text style={{ fontSize: 12, color: Colors.textPrimary, fontWeight: '900' }}>{match.counter_score_text}</Text>
                </View>
                {match.counter_reason && (
                  <Text style={{ fontSize: 11, color: Colors.textMuted, fontStyle: 'italic' }}>Contestataire : "{match.counter_reason}"</Text>
                )}
                {match.dispute_reason && (
                  <Text style={{ fontSize: 11, color: Colors.textMuted, fontStyle: 'italic', marginTop: match.counter_reason ? 3 : 0 }}>Auteur : "{match.dispute_reason}"</Text>
                )}
              </View>
            )}

            <Text style={sty.matchTitle}>
              <Text style={{ color: Colors.success }}>
                {match.winner?.name}{match.winner_2 ? ` & ${match.winner_2.name}` : ''}
              </Text>
              <Text style={{ color: Colors.textSecondary, fontSize: 14 }}> vs </Text>
              <Text style={{ color: Colors.danger }}>
                {match.loser?.name}{match.loser_2 ? ` & ${match.loser_2.name}` : ''}
              </Text>
            </Text>

            <View style={{ marginTop: 10, marginBottom: 12 }}>
              <Text style={sty.fieldLabel}>Score final</Text>
              <TextInput
                value={editedScores[match.id] ?? ''}
                onChangeText={v => setEditedScores({ ...editedScores, [match.id]: v })}
                placeholder="6-3, 7-5"
                placeholderTextColor={Colors.textSecondary}
                style={sty.scoreInput}
              />
            </View>

            {sim && <EloSimCard sim={sim} />}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity
                onPress={() => onForceValidate(match)}
                disabled={loadingId === match.id}
                style={[sty.btnValidate, { opacity: loadingId === match.id ? 0.5 : 1 }]}
                activeOpacity={0.8}
              >
                {loadingId === match.id
                  ? <ActivityIndicator color={Colors.textOnDark} size="small" />
                  : <Text style={{ color: Colors.textOnDark, fontWeight: '900', fontSize: 13, fontFamily: Fonts.uiBlack }}>⚖️ Forcer la Validation</Text>
                }
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onCancel(match.id)}
                disabled={loadingId === match.id}
                style={[sty.btnCancel, { opacity: loadingId === match.id ? 0.5 : 1 }]}
                activeOpacity={0.8}
              >
                <Text style={{ color: Colors.danger, fontWeight: '700', fontSize: 13, fontFamily: Fonts.uiBold }}>🗑️ Annuler</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ─── Players dashboard tab ────────────────────────────────────
function PlayersTab({ players, loading, actingId, onUnlink, onFraud, onUnblock, onRefresh }: {
  players: any[];
  loading: boolean;
  actingId: string | null;
  onUnlink: (playerId: string, name: string) => void;
  onFraud: (playerId: string, name: string) => void;
  onUnblock: (playerId: string) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'verified' | 'unlinked' | 'blocked' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 30;

  // Inactivité : aucune partie depuis 30 j. On prend last_match_at ; à défaut
  // (jamais joué) created_at sert de référence — un compte récent qui n'a pas
  // encore joué n'est donc PAS compté inactif tant qu'il a < 30 j.
  const INACTIVE_DAYS = 30;
  const inactiveCutoff = Date.now() - INACTIVE_DAYS * 24 * 60 * 60 * 1000;
  const lastSeenMs = (p: any) => new Date(p.last_match_at ?? p.created_at ?? 0).getTime();
  const isInactive = (p: any) => lastSeenMs(p) < inactiveCutoff;

  const filtered = players.filter(p => {
    if (filter === 'verified' && !p.frmt_verified) return false;
    if (filter === 'unlinked' && (p.frmt_verified || p.frmt_blocked)) return false;
    if (filter === 'blocked' && !p.frmt_blocked) return false;
    if (filter === 'inactive' && !isInactive(p)) return false;
    if (search && !(p.name ?? '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  // En vue « Inactifs », on remonte les plus dormants en premier.
  if (filter === 'inactive') filtered.sort((a, b) => lastSeenMs(a) - lastSeenMs(b));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const verifiedCount = players.filter(p => p.frmt_verified).length;
  const blockedCount = players.filter(p => p.frmt_blocked).length;
  const inactiveCount = players.filter(isInactive).length;

  if (loading) return <ActivityIndicator color={Colors.brand} style={{ marginTop: 40 }} />;

  return (
    <>
      {/* Stats */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
        {[
          { label: 'Inscrits', value: players.length, color: Colors.textPrimary },
          { label: 'Vérifiés', value: verifiedCount, color: Colors.success },
          { label: 'Bloqués', value: blockedCount, color: Colors.danger },
        ].map(s => (
          <View key={s.label} style={sty.statBox}>
            <Text style={{ fontSize: 20, fontWeight: '900', color: s.color, fontFamily: Fonts.uiBlack }}>{s.value}</Text>
            <Text style={{ fontSize: 9, fontWeight: '900', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8, fontFamily: Fonts.uiBlack }}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Search + refresh */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={[sty.searchRow, { flex: 1 }]}>
          <Icon name="search" size={13} color={Colors.textSecondary} stroke={2.2} />
          <TextInput
            value={search}
            onChangeText={v => { setSearch(v); setPage(1); }}
            placeholder="Rechercher un joueur…"
            placeholderTextColor={Colors.textSecondary}
            style={{ flex: 1, fontSize: 13, color: Colors.textPrimary, fontWeight: '600' }}
          />
        </View>
        <TouchableOpacity onPress={() => onRefresh()} style={sty.refreshBtn}>
          <Text style={{ fontSize: 16 }}>⟳</Text>
        </TouchableOpacity>
      </View>

      {/* Filters */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {([['all', 'Tous'], ['verified', '✅ Vérifiés'], ['unlinked', '◯ Non liés'], ['blocked', '🚫 Bloqués'], ['inactive', `😴 Inactifs (${inactiveCount})`]] as [string, string][]).map(([v, l]) => (
          <TouchableOpacity key={v} onPress={() => { setFilter(v as any); setPage(1); }}
            style={[sty.chip, filter === v && sty.chipActive]}>
            <Text style={[sty.chipText, filter === v && sty.chipTextActive]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {filtered.length === 0 ? (
        <Text style={{ color: Colors.textSecondary, textAlign: 'center', marginTop: 24, fontWeight: '700' }}>Aucun joueur</Text>
      ) : (
        <View style={{ gap: 8 }}>
          {paged.map(p => {
            const frmt = formatFrmtRanking(p);
            const lvl = eloToLevel(p.elo_score ?? 800).toFixed(1);
            const dateStr = p.created_at
              ? new Date(p.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })
              : '—';
            const lastMatchStr = p.last_match_at
              ? new Date(p.last_match_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })
              : 'Jamais';
            const pushOn = !!p.push_token;
            const acting = actingId === p.id;
            return (
              <View key={p.id} style={[sty.frmtRow, { flexDirection: 'column', alignItems: 'stretch', gap: 8 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontSize: 14, fontWeight: '900', color: Colors.textPrimary, fontFamily: Fonts.uiBlack, flexShrink: 1 }} numberOfLines={1}>{p.name}</Text>
                  {p.frmt_blocked && (
                    <View style={{ backgroundColor: '#ef444420', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: '#ef444450' }}>
                      <Text style={{ fontSize: 9, fontWeight: '900', color: Colors.danger }}>🚫 Bloqué</Text>
                    </View>
                  )}
                </View>
                <Text style={{ fontSize: 11, color: Colors.textSecondary, fontWeight: '700' }}>
                  Inscrit le {dateStr} · Niv. {lvl}{p.frmt_elo_bonus > 0 ? ` · FRMT +${p.frmt_elo_bonus} ELO` : ''}
                </Text>
                <Text style={{ fontSize: 11, color: frmt ? Colors.brand : Colors.textSecondary, fontWeight: '800' }} numberOfLines={1}>
                  {frmt ? `FRMT ${frmt.text} ✓` : (p.frmt_full_name ? `FRMT non lié (${p.frmt_full_name})` : 'Pas de FRMT déclaré')}
                </Text>
                <Text style={{ fontSize: 11, color: Colors.textSecondary, fontWeight: '700' }}>
                  Dernier match : <Text style={{ color: p.last_match_at ? Colors.textPrimary : Colors.textSecondary, fontWeight: '900' }}>{lastMatchStr}</Text>
                  {'  ·  '}
                  <Text style={{ color: pushOn ? Colors.success : Colors.textSecondary, fontWeight: '900' }}>
                    {pushOn ? '🔔 Notifs ON' : '🔕 Notifs OFF'}
                  </Text>
                </Text>

                {/* Actions */}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                  {acting ? (
                    <ActivityIndicator color={Colors.brand} />
                  ) : p.frmt_blocked ? (
                    <TouchableOpacity onPress={() => onUnblock(p.id)} style={[sty.chip, { borderColor: Colors.success + '60' }]}>
                      <Text style={[sty.chipText, { color: Colors.success }]}>Débloquer</Text>
                    </TouchableOpacity>
                  ) : p.frmt_verified ? (
                    <>
                      <TouchableOpacity onPress={() => onUnlink(p.id, p.name)} style={sty.chip}>
                        <Text style={sty.chipText}>Délier</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => onFraud(p.id, p.name)} style={[sty.chip, { borderColor: '#ef444450', backgroundColor: '#ef444415' }]}>
                        <Text style={[sty.chipText, { color: Colors.danger }]}>🚫 Fraudeur</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <Text style={{ fontSize: 11, color: Colors.textSecondary, fontWeight: '700' }}>—</Text>
                  )}
                </View>
              </View>
            );
          })}

          {/* Pagination */}
          {totalPages > 1 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 12 }}>
              <TouchableOpacity disabled={safePage <= 1} onPress={() => setPage(safePage - 1)} style={[sty.chip, safePage <= 1 && { opacity: 0.4 }]}>
                <Text style={sty.chipText}>‹ Préc.</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 12, color: Colors.textSecondary, fontWeight: '800' }}>{safePage} / {totalPages}</Text>
              <TouchableOpacity disabled={safePage >= totalPages} onPress={() => setPage(safePage + 1)} style={[sty.chip, safePage >= totalPages && { opacity: 0.4 }]}>
                <Text style={sty.chipText}>Suiv. ›</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </>
  );
}

// ─── FRMT tab ─────────────────────────────────────────────────
// Libellés du journal d'audit des liaisons (frmt_link_events).
const FRMT_EVENT_CFG: Record<string, { icon: string; label: string; color: string }> = {
  auto_link:  { icon: '🔗', label: 'Liaison auto',  color: Colors.success },
  admin_link: { icon: '🔗', label: 'Liaison admin', color: Colors.brand },
  unlink:     { icon: '🔓', label: 'Délié',         color: Colors.textSecondary },
  fraud:      { icon: '🚫', label: 'Fraudeur',      color: Colors.danger },
};

function FrmtTab({ entries, events, allPlayers, loading, onLink, onUnlink, onRefresh }: {
  entries: any[];
  events: any[];
  allPlayers: any[];
  loading: boolean;
  onLink: (entryId: string, entry: any, playerId: string) => Promise<void>;
  onUnlink: (entryId: string, playerName: string) => void;
  onRefresh: () => Promise<void> | void;
}) {
  const [search, setSearch] = useState('');
  const [scraping, setScraping] = useState(false);
  const [catFilter, setCatFilter] = useState<'all' | 'Masculin' | 'Féminin'>('all');
  const [linkedFilter, setLinkedFilter] = useState<'all' | 'linked' | 'unlinked'>('all');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 30;

  const [pickerEntry, setPickerEntry] = useState<any | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [linking, setLinking] = useState(false);

  const filtered = entries.filter(e => {
    if (catFilter !== 'all' && e.category !== catFilter) return false;
    if (linkedFilter === 'linked' && !e.player_id) return false;
    if (linkedFilter === 'unlinked' && e.player_id) return false;
    if (search && !e.frmt_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const linkedCount = entries.filter(e => e.player_id).length;

  const pickerPlayers = allPlayers.filter(p =>
    !pickerSearch || p.name.toLowerCase().includes(pickerSearch.toLowerCase())
  );

  const handleLink = async (playerId: string) => {
    if (!pickerEntry) return;
    setLinking(true);
    await onLink(pickerEntry.id, pickerEntry, playerId);
    setLinking(false);
    setPickerEntry(null);
    setPickerSearch('');
  };

  // Déclenche le scraper FRMT (GitHub Actions, via l'edge function). C'est
  // asynchrone : l'Action tourne 3-5 min, on ne récupère pas le résultat ici.
  const handleScrape = async () => {
    setScraping(true);
    const { error } = await supabase.functions.invoke('trigger-frmt-scrape');
    setScraping(false);
    if (error) { Alert.alert('Erreur', error.message ?? 'Déclenchement impossible.'); return; }
    Alert.alert('✅ Scrape lancé', 'Le classement se met à jour dans ~3-5 min. Reviens rafraîchir.');
  };

  // Date du dernier scrape = max(scraped_at) des entrées chargées.
  const lastScrape = entries.reduce<string | null>((max, e) => {
    const t = e.scraped_at as string | undefined;
    return t && (!max || t > max) ? t : max;
  }, null);
  const lastScrapeLabel = lastScrape
    ? new Date(lastScrape).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

  if (loading) return <ActivityIndicator color={Colors.brand} style={{ marginTop: 40 }} />;

  return (
    <>
      {/* Scrape + dernier scrape */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <TouchableOpacity
          onPress={handleScrape}
          disabled={scraping}
          style={[sty.scrapeBtn, scraping && { opacity: 0.6 }]}
        >
          {scraping
            ? <ActivityIndicator color={Colors.textOnBrand} size="small" />
            : <Text style={sty.scrapeBtnText}>🔄 Lancer un scrape</Text>}
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 9, fontWeight: '900', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8, fontFamily: Fonts.uiBlack }}>Dernier scrape</Text>
          <Text style={{ fontSize: 12, fontWeight: '900', color: Colors.textPrimary, fontFamily: Fonts.uiBlack }}>{lastScrapeLabel}</Text>
        </View>
        <TouchableOpacity onPress={() => onRefresh()} style={sty.refreshBtn}>
          <Text style={{ fontSize: 16 }}>⟳</Text>
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
        {[
          { label: 'Total', value: entries.length, color: Colors.textPrimary },
          { label: 'Liés', value: linkedCount, color: Colors.success },
          { label: 'Non liés', value: entries.length - linkedCount, color: Colors.textSecondary },
        ].map(s => (
          <View key={s.label} style={sty.statBox}>
            <Text style={{ fontSize: 20, fontWeight: '900', color: s.color, fontFamily: Fonts.uiBlack }}>{s.value}</Text>
            <Text style={{ fontSize: 9, fontWeight: '900', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8, fontFamily: Fonts.uiBlack }}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Journal des liaisons — vigilance anti-usurpation : chaque liaison
          (auto ou admin), déliage et marquage fraudeur passe ici. */}
      {events.length > 0 && (
        <View style={{ marginBottom: 14 }}>
          <Text style={{ fontSize: 9, fontWeight: '900', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8, fontFamily: Fonts.uiBlack, marginBottom: 6 }}>
            🕘 Liaisons récentes
          </Text>
          <View style={{ gap: 5 }}>
            {events.map((ev: any) => {
              const cfg = FRMT_EVENT_CFG[ev.event] ?? { icon: '•', label: ev.event, color: Colors.textSecondary };
              const d = new Date(ev.created_at);
              const dateStr = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
                + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
              return (
                <View key={ev.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3 }}>
                  <Text style={{ fontSize: 10, fontWeight: '900', color: cfg.color, minWidth: 88 }}>{cfg.icon} {cfg.label}</Text>
                  <Text style={{ fontSize: 11, fontWeight: '800', color: Colors.textPrimary, flexShrink: 1 }} numberOfLines={1}>
                    {ev.player_name ?? '?'}
                    <Text style={{ color: Colors.textSecondary, fontWeight: '600' }}>
                      {ev.frmt_name ? ` → ${ev.frmt_name}` : ''}{ev.ranking_position != null ? ` (#${ev.ranking_position})` : ''}
                    </Text>
                  </Text>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.textSecondary, marginLeft: 'auto' }}>
                    {ev.elo_bonus > 0 ? `${ev.event === 'unlink' || ev.event === 'fraud' ? '−' : '+'}${ev.elo_bonus} · ` : ''}{dateStr}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* Search */}
      <View style={sty.searchRow}>
        <Icon name="search" size={13} color={Colors.textSecondary} stroke={2.2} />
        <TextInput
          value={search}
          onChangeText={v => { setSearch(v); setPage(1); }}
          placeholder="Rechercher un joueur FRMT…"
          placeholderTextColor={Colors.textSecondary}
          style={{ flex: 1, fontSize: 13, color: Colors.textPrimary, fontWeight: '600' }}
        />
      </View>

      {/* Cat filter */}
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
        {([['all', 'Tous'], ['Masculin', '♂ H'], ['Féminin', '♀ F']] as [string, string][]).map(([v, l]) => (
          <TouchableOpacity key={v} onPress={() => { setCatFilter(v as any); setPage(1); }}
            style={[sty.chip, catFilter === v && sty.chipActive]}>
            <Text style={[sty.chipText, catFilter === v && sty.chipTextActive]}>{l}</Text>
          </TouchableOpacity>
        ))}
        <View style={{ width: 1 }} />
        {([['all', 'Tous'], ['linked', '✅ Liés'], ['unlinked', '◯ Non liés']] as [string, string][]).map(([v, l]) => (
          <TouchableOpacity key={v} onPress={() => { setLinkedFilter(v as any); setPage(1); }}
            style={[sty.chip, linkedFilter === v && sty.chipActive]}>
            <Text style={[sty.chipText, linkedFilter === v && sty.chipTextActive]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={{ fontSize: 11, color: Colors.textSecondary, marginBottom: 10 }}>
        {filtered.length} résultat{filtered.length !== 1 ? 's' : ''} · page {safePage}/{totalPages}
      </Text>

      {/* List */}
      <View style={{ gap: 8 }}>
        {paged.map(entry => (
          <View key={entry.id} style={sty.frmtRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <Text style={{ fontSize: 11, color: Colors.textSecondary, fontWeight: '700', minWidth: 26 }}>#{entry.ranking_position ?? '—'}</Text>
                <Text style={{ fontSize: 13, fontWeight: '900', color: Colors.textPrimary, flexShrink: 1 }} numberOfLines={1}>{entry.frmt_name}</Text>
                {/* Année de naissance scrapée : seul discriminant entre homonymes. */}
                {entry.birth_year != null && (
                  <Text style={{ fontSize: 11, color: Colors.textSecondary, fontWeight: '700' }}>[{entry.birth_year}]</Text>
                )}
              </View>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                {entry.ranking_points != null && (
                  <Text style={{ fontSize: 11, fontWeight: '900', color: Colors.brand }}>{entry.ranking_points.toLocaleString('fr-FR')} pts</Text>
                )}
                <View style={{
                  backgroundColor: entry.category === 'Masculin' ? '#4f46e520' : '#ec489920',
                  borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1,
                  borderWidth: 1, borderColor: entry.category === 'Masculin' ? '#4f46e540' : '#ec489940',
                }}>
                  <Text style={{ fontSize: 9, fontWeight: '900', color: entry.category === 'Masculin' ? '#818cf8' : '#f472b6' }}>
                    {entry.category === 'Masculin' ? '♂ H' : '♀ F'}
                  </Text>
                </View>
                {entry.player ? (
                  <Text style={{ fontSize: 11, color: Colors.success, fontWeight: '800' }}>✅ {entry.player.name}</Text>
                ) : (
                  <Text style={{ fontSize: 11, color: Colors.textSecondary, fontWeight: '600' }}>Non lié</Text>
                )}
              </View>
            </View>
            <View style={{ gap: 5, alignItems: 'flex-end' }}>
              <TouchableOpacity onPress={() => { setPickerEntry(entry); setPickerSearch(''); }}
                style={{ backgroundColor: 'rgba(255,193,26,0.18)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(255,193,26,0.45)' }}>
                <Text style={{ fontSize: 11, fontWeight: '900', color: Colors.brand, fontFamily: Fonts.uiBlack }}>
                  {entry.player ? '✏️ Changer' : '🔗 Lier'}
                </Text>
              </TouchableOpacity>
              {entry.player && (
                <TouchableOpacity onPress={() => onUnlink(entry.id, entry.player?.name ?? entry.frmt_name)}
                  style={{ backgroundColor: '#ef444415', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1, borderColor: '#ef444430' }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.danger }}>Délier</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}
      </View>

      {/* Pagination */}
      {totalPages > 1 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16 }}>
          <TouchableOpacity onPress={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
            style={{ opacity: safePage === 1 ? 0.3 : 1 }}>
            <Text style={{ fontSize: 13, fontWeight: '900', color: Colors.brand }}>← Préc.</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.textMuted }}>{safePage} / {totalPages}</Text>
          <TouchableOpacity onPress={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
            style={{ opacity: safePage === totalPages ? 0.3 : 1 }}>
            <Text style={{ fontSize: 13, fontWeight: '900', color: Colors.brand }}>Suiv. →</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Player picker modal */}
      <Modal visible={!!pickerEntry} animationType="slide" transparent statusBarTranslucent onRequestClose={() => setPickerEntry(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setPickerEntry(null)} />
          <View style={{ backgroundColor: Colors.bgCard, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '70%', borderWidth: 1, borderColor: Colors.border }}>
            <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
              <View style={{ width: 36, height: 4, backgroundColor: Colors.border, borderRadius: 2 }} />
            </View>
            <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
              <Text style={{ fontSize: 14, fontWeight: '900', color: Colors.textPrimary, marginBottom: 10, fontFamily: Fonts.uiBlack }}>
                Lier à {pickerEntry?.frmt_name}
              </Text>
              <View style={[sty.searchRow, { marginBottom: 8 }]}>
                <Icon name="search" size={13} color={Colors.textSecondary} stroke={2.2} />
                <TextInput
                  value={pickerSearch}
                  onChangeText={setPickerSearch}
                  placeholder="Nom du joueur…"
                  placeholderTextColor={Colors.textSecondary}
                  style={{ flex: 1, fontSize: 13, color: Colors.textPrimary }}
                  autoFocus
                />
              </View>
            </View>
            <FlatList
              data={pickerPlayers.slice(0, 50)}
              keyExtractor={p => p.id}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: Colors.border }} />}
              renderItem={({ item: p }) => (
                <TouchableOpacity onPress={() => handleLink(p.id)} disabled={linking}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 10 }}>
                  <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 14, fontWeight: '900', color: Colors.brand, fontFamily: Fonts.uiBlack }}>{(p.name || '?').charAt(0).toUpperCase()}</Text>
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textPrimary, flexShrink: 1, fontFamily: Fonts.uiBold }} numberOfLines={1}>{p.name}</Text>
                  <Text style={{ fontSize: 12, color: Colors.textSecondary, fontWeight: '700', flex: 1 }}>
                    {p.birth_year != null ? `[${p.birth_year}]` : ''}
                  </Text>
                  {linking && <ActivityIndicator size="small" color={Colors.brand} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

// ─── Games tab ────────────────────────────────────────────────
function GamesTab({ games, loading, deletingId, onDelete, onRefresh }: {
  games: any[];
  loading: boolean;
  deletingId: string | null;
  onDelete: (id: string) => void;
  onRefresh: () => void;
}) {
  if (loading) return <ActivityIndicator color={Colors.brand} style={{ marginTop: 40 }} />;

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Text style={{ fontSize: 12, color: Colors.textSecondary, fontWeight: '600' }}>
          {games.length} partie{games.length !== 1 ? 's' : ''} trouvée{games.length !== 1 ? 's' : ''}
        </Text>
        <TouchableOpacity onPress={onRefresh}>
          <Text style={{ fontSize: 12, fontWeight: '900', color: Colors.brand }}>🔄 Actualiser</Text>
        </TouchableOpacity>
      </View>

      {games.length === 0 ? (
        <View style={sty.emptyCard}>
          <Text style={{ fontSize: 15, fontWeight: '900', color: Colors.textMuted, textAlign: 'center', fontFamily: Fonts.uiBlack }}>Aucune partie en cours</Text>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {games.map(game => (
            <View key={game.id} style={sty.gameRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 13, fontWeight: '900', color: Colors.textPrimary, marginBottom: 3, fontFamily: Fonts.uiBlack }} numberOfLines={1}>
                  {game.location ?? '—'}
                </Text>
                <Text style={{ fontSize: 11, color: Colors.textSecondary, fontWeight: '600' }}>
                  {fmtDate(game.match_date)} · {game.creator?.name ?? '—'}
                </Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 5 }}>
                  <View style={{
                    backgroundColor: game.game_format === 'competitive' ? '#ef444420' : '#05966920',
                    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
                    borderWidth: 1, borderColor: game.game_format === 'competitive' ? '#ef444440' : '#05966940',
                  }}>
                    <Text style={{ fontSize: 9, fontWeight: '900', color: game.game_format === 'competitive' ? Colors.danger : Colors.success }}>
                      {game.game_format === 'competitive' ? 'Compétitif' : 'Amical'}
                    </Text>
                  </View>
                  <View style={{
                    backgroundColor: Colors.bgCard, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
                    borderWidth: 1, borderColor: Colors.border,
                  }}>
                    <Text style={{ fontSize: 9, fontWeight: '700', color: Colors.textMuted }}>{game.status}</Text>
                  </View>
                  <Text style={{ fontSize: 11, color: Colors.textSecondary, alignSelf: 'center' }}>{game.spots_available} place{game.spots_available !== 1 ? 's' : ''}</Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => onDelete(game.id)}
                disabled={deletingId === game.id}
                style={[sty.btnDelete, { opacity: deletingId === game.id ? 0.5 : 1 }]}
              >
                {deletingId === game.id
                  ? <ActivityIndicator size="small" color={Colors.danger} />
                  : <Text style={{ fontSize: 12, fontWeight: '900', color: Colors.danger }}>🗑️ Suppr.</Text>
                }
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────
export default function AdminScreen() {
  const { player } = usePlayer();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<AdminTab>('disputes');

  // Disputes
  const [disputes, setDisputes] = useState<any[]>([]);
  const [editedScores, setEditedScores] = useState<Record<string, string>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // FRMT
  const [frmtEntries, setFrmtEntries] = useState<any[]>([]);
  const [frmtEvents, setFrmtEvents] = useState<any[]>([]);
  const [allPlayers, setAllPlayers] = useState<any[]>([]);
  const [frmtLoading, setFrmtLoading] = useState(false);

  // Games
  const [games, setGames] = useState<any[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Gender change requests
  const [genderReqs, setGenderReqs] = useState<any[]>([]);
  const [genderLoading, setGenderLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const [reports, setReports] = useState<any[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);

  // Players dashboard
  const [playersList, setPlayersList] = useState<any[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [playerActingId, setPlayerActingId] = useState<string | null>(null);

  // Tournois — l'interrupteur (fn_tournaments_enabled) : éteint par défaut,
  // la section n'apparaît alors NULLE PART dans ce panel, pas même l'onglet.
  const [tournamentsEnabled, setTournamentsEnabled] = useState(false);
  useEffect(() => { getTournamentsEnabled().then(setTournamentsEnabled); }, []);

  // Auth guard
  useEffect(() => {
    if (player && !player.is_admin) {
      Alert.alert('⛔ Accès refusé', 'Zone réservée aux arbitres.');
      router.replace('/(tabs)');
    }
  }, [player]);

  // Load disputes on mount
  const loadDisputes = useCallback(async () => {
    const { data } = await supabase
      .from('matches')
      .select('*, winner:winner_id(id,name,elo_score,win_count,loss_count,last_match_at,fiability_pct), winner_2:winner_id_2(id,name,elo_score,win_count,loss_count,last_match_at,fiability_pct), loser:loser_id(id,name,elo_score,win_count,loss_count,last_match_at,fiability_pct), loser_2:loser_id_2(id,name,elo_score,win_count,loss_count,last_match_at,fiability_pct), creator:created_by(name)')
      .eq('status', 'disputed')
      .order('created_at', { ascending: false });
    const m = data ?? [];
    setDisputes(m);
    const init: Record<string, string> = {};
    m.forEach((match: any) => { init[match.id] = match.counter_score_text || match.score_text || ''; });
    setEditedScores(init);
  }, []);

  const loadFrmt = useCallback(async () => {
    setFrmtLoading(true);
    // Re-tente l'auto-matching des joueurs non liés (utile après un scrape).
    // Best-effort : on n'interrompt pas le chargement si ça échoue.
    try { await supabase.rpc('relink_unlinked_frmt'); } catch { /* ignore */ }
    // Pagination par pages de 1000 : PostgREST plafonne un select() simple à
    // 1000 lignes. Le classement FRMT dépasse 1000 (Messieurs ~2300), donc on
    // boucle sur .range() jusqu'à épuisement, sinon le panel tronque en silence.
    const PAGE = 1000;
    const allRankings: any[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('frmt_rankings')
        .select('*, player:player_id(id,name)')
        .order('ranking_position', { ascending: true, nullsFirst: false })
        .range(from, from + PAGE - 1);
      if (error || !data?.length) break;
      allRankings.push(...data);
      if (data.length < PAGE) break;
    }
    // birth_year : pour comparer l'année déclarée du joueur à celle de
    // l'entrée FRMT au moment d'une liaison manuelle (homonymes).
    const { data: players } = await supabase.from('players').select('id,name,birth_year').is('deleted_at', null).order('name');
    // Journal d'audit anti-usurpation (frmt_link_events, lecture admin RLS).
    const { data: events } = await supabase.from('frmt_link_events')
      .select('*').order('created_at', { ascending: false }).limit(12);
    setFrmtEntries(allRankings);
    setFrmtEvents(events ?? []);
    setAllPlayers(players ?? []);
    setFrmtLoading(false);
  }, []);

  const loadGames = useCallback(async () => {
    setGamesLoading(true);
    const { data } = await supabase
      .from('open_games')
      .select('*, creator:creator_id(name)')
      .order('match_date', { ascending: true });
    setGames(data ?? []);
    setGamesLoading(false);
  }, []);

  const loadGenderReqs = useCallback(async () => {
    setGenderLoading(true);
    const { data } = await supabase
      .from('gender_change_requests')
      .select('id, player_id, current_gender, requested_gender, reason, status, created_at, player:player_id(name, gender, elo_score)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    setGenderReqs(data ?? []);
    setGenderLoading(false);
  }, []);

  const loadReports = useCallback(async () => {
    setReportsLoading(true);
    const { data } = await supabase
      .from('content_reports')
      .select('id, target_type, target_id, reason, status, created_at, reporter:reporter_id(name), reported:reported_player_id(id, name)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    setReports(data ?? []);
    setReportsLoading(false);
  }, []);

  const loadPlayers = useCallback(async () => {
    setPlayersLoading(true);
    const PAGE = 1000;
    const all: any[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('players')
        .select('id, name, created_at, gender, declared_elo, elo_score, frmt_verified, frmt_position, frmt_points, frmt_blocked, frmt_elo_bonus, frmt_full_name, last_match_at, push_token')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range(from, from + PAGE - 1);
      if (error || !data?.length) break;
      all.push(...data);
      if (data.length < PAGE) break;
    }
    setPlayersList(all);
    setPlayersLoading(false);
  }, []);

  // Délier est devenu une action lourde (bonus retiré + revendication oubliée
  // + point effacé de la courbe) → confirmation, comme Fraudeur.
  const handlePlayerUnlink = (playerId: string, name: string) => {
    Alert.alert(
      'Délier du classement FRMT',
      `${name} : on retire la liaison ET le bonus de niveau, on oublie le nom déclaré et on efface le point FRMT de sa courbe. Il pourra se re-lier depuis son profil. Continuer ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Délier', style: 'destructive', onPress: async () => {
            setPlayerActingId(playerId);
            const { error } = await supabase.rpc('admin_unlink_frmt_player', { p_player_id: playerId });
            setPlayerActingId(null);
            if (error) { Alert.alert('Erreur', error.message); return; }
            await loadPlayers();
          },
        },
      ],
    );
  };

  const handlePlayerFraud = (playerId: string, name: string) => {
    Alert.alert(
      '🚫 Marquer comme fraudeur',
      `${name} : on retire sa liaison FRMT, on annule le bonus de niveau, et on bloque le re-matching automatique. Continuer ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Confirmer', style: 'destructive', onPress: async () => {
            setPlayerActingId(playerId);
            const { error } = await supabase.rpc('admin_flag_fraud_frmt', { p_player_id: playerId });
            setPlayerActingId(null);
            if (error) { Alert.alert('Erreur', error.message); return; }
            await loadPlayers();
          },
        },
      ],
    );
  };

  const handlePlayerUnblock = async (playerId: string) => {
    setPlayerActingId(playerId);
    const { error } = await supabase.rpc('admin_unblock_frmt', { p_player_id: playerId });
    setPlayerActingId(null);
    if (error) { Alert.alert('Erreur', error.message); return; }
    await loadPlayers();
  };

  useEffect(() => { if (player?.is_admin) { loadDisputes(); loadGenderReqs(); loadReports(); } }, [player, loadDisputes, loadGenderReqs, loadReports]);
  useEffect(() => { if (tab === 'frmt' && player?.is_admin) loadFrmt(); }, [tab, player, loadFrmt]);
  useEffect(() => { if (tab === 'players' && player?.is_admin) loadPlayers(); }, [tab, player, loadPlayers]);
  useEffect(() => { if (tab === 'games' && player?.is_admin) loadGames(); }, [tab, player, loadGames]);
  useEffect(() => { if (tab === 'gender' && player?.is_admin) loadGenderReqs(); }, [tab, player, loadGenderReqs]);
  useEffect(() => { if (tab === 'reports' && player?.is_admin) loadReports(); }, [tab, player, loadReports]);

  const handleResolveReport = async (report: any, status: 'actioned' | 'dismissed') => {
    if (!player) return;
    setResolvingId(report.id);
    const { error } = await supabase
      .from('content_reports')
      .update({ status, reviewed_by: player.id, reviewed_at: new Date().toISOString() })
      .eq('id', report.id);
    setResolvingId(null);
    if (error) { Alert.alert('Erreur', error.message); return; }
    await loadReports();
  };

  const handleGenderApprove = async (req: any) => {
    if (!player) return;
    setResolvingId(req.id);
    const { error: updErr } = await supabase
      .from('players')
      .update({ gender: req.requested_gender })
      .eq('id', req.player_id);
    if (updErr) { Alert.alert('Erreur', updErr.message); setResolvingId(null); return; }
    await supabase
      .from('gender_change_requests')
      .update({ status: 'approved', resolved_by: player.id, resolved_at: new Date().toISOString() })
      .eq('id', req.id);
    setResolvingId(null);
    await loadGenderReqs();
  };

  const handleGenderReject = async (req: any) => {
    if (!player) return;
    Alert.alert(
      'Refuser la demande ?',
      `${req.player?.name ?? '?'} restera en ${req.current_gender === 'male' ? 'Homme' : 'Femme'}.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Refuser',
          style: 'destructive',
          onPress: async () => {
            setResolvingId(req.id);
            await supabase
              .from('gender_change_requests')
              .update({ status: 'rejected', resolved_by: player.id, resolved_at: new Date().toISOString() })
              .eq('id', req.id);
            setResolvingId(null);
            await loadGenderReqs();
          },
        },
      ],
    );
  };

  const handleForceValidate = async (match: any) => {
    const finalScore = editedScores[match.id];
    if (!finalScore?.trim()) { Alert.alert('Erreur', 'Le score ne peut pas être vide !'); return; }
    Alert.alert('Confirmer', `Valider ce match avec le score : ${finalScore} ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Valider', style: 'default', onPress: async () => {
        setLoadingId(match.id);
        try {
          // L'ELO est distribué par le trigger DB `trg_distribute_elo_on_validate`
          // au passage du match à 'validated' (source unique de vérité —
          // cf. supabase/migrations/elo_on_validate.sql). On ne calcule plus rien
          // ici : on fixe le score corrigé puis on bascule le statut.
          const { error } = await supabase
            .from('matches')
            .update({ status: 'validated', score_text: finalScore.trim() })
            .eq('id', match.id);
          if (error) throw error;
          setDisputes(prev => prev.filter(m => m.id !== match.id));
          Alert.alert('✅ Litige réglé', 'Les points ont été distribués.');
        } catch {
          Alert.alert('Erreur', 'La validation forcée a échoué.');
        } finally {
          setLoadingId(null);
        }
      }},
    ]);
  };

  const handleCancel = (matchId: string) => {
    Alert.alert('Annuler le match', 'Aucun point ne sera distribué.', [
      { text: 'Retour', style: 'cancel' },
      { text: 'Confirmer', style: 'destructive', onPress: async () => {
        setLoadingId(matchId);
        await supabase.from('matches').update({ status: 'cancelled' }).eq('id', matchId);
        setDisputes(prev => prev.filter(m => m.id !== matchId));
        setLoadingId(null);
      }},
    ]);
  };

  const handleLink = async (entryId: string, _entry: any, playerId: string) => {
    // RPC : pose la liaison + frmt_verified/position/points + bonus de niveau (plancher).
    const { error } = await supabase.rpc('admin_link_frmt', { p_entry_id: entryId, p_player_id: playerId });
    if (error) { Alert.alert('Erreur', error.message); return; }
    await loadFrmt();
  };

  const handleUnlink = (entryId: string, playerName: string) => {
    // Action lourde depuis frmt_unlink_removes_bonus.sql : retire liaison +
    // bonus + revendication + point de courbe → confirmation obligatoire.
    Alert.alert(
      'Délier du classement FRMT',
      `${playerName} : on retire la liaison ET le bonus de niveau, on oublie le nom déclaré et on efface le point FRMT de sa courbe. Il pourra se re-lier depuis son profil. Continuer ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Délier', style: 'destructive', onPress: async () => {
            const { error } = await supabase.rpc('admin_unlink_frmt', { p_entry_id: entryId });
            if (error) { Alert.alert('Erreur', error.message); return; }
            await loadFrmt();
          },
        },
      ],
    );
  };

  const handleDeleteGame = (gameId: string) => {
    Alert.alert('Supprimer la partie', 'Participants et messages seront supprimés.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => {
        setDeletingId(gameId);
        const { error } = await supabase.from('open_games').delete().eq('id', gameId);
        if (error) Alert.alert('Erreur', error.message);
        else setGames(prev => prev.filter(g => g.id !== gameId));
        setDeletingId(null);
      }},
    ]);
  };

  if (!player?.is_admin) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.brand} size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {/* Header */}
      <View style={{ backgroundColor: Colors.bgCard, paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <TouchableOpacity onPress={() => router.back()}
            style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border }}>
            <Text style={{ color: Colors.textMuted, fontSize: 18 }}>‹</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontSize: 26, lineHeight: 34, color: Colors.textPrimary, letterSpacing: -0.5, fontFamily: Fonts.welcome, paddingRight: 5 }}>Panel <Text style={{ color: Colors.brand }}>Arbitre</Text></Text>
            <Text style={{ fontSize: 11, color: Colors.textSecondary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 }}>🛡️ Administration</Text>
          </View>
          {disputes.length > 0 && (
            <View style={{ backgroundColor: Colors.danger, borderRadius: 999, minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}>
              <Text style={{ color: Colors.textOnDark, fontSize: 11, fontWeight: '900', fontFamily: Fonts.uiBlack }}>{disputes.length}</Text>
            </View>
          )}
        </View>

        {/* Tab bar — blocs de groupes (titre + sous-onglets dessous), wrap si étroit */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
          {([
            { title: 'Modération', items: [
              { key: 'disputes' as AdminTab, label: '⚖️ Litiges',     badge: disputes.length },
              { key: 'reports'  as AdminTab, label: '🚩 Signalements', badge: reports.length },
              { key: 'gender'   as AdminTab, label: '⚧ Genre',         badge: genderReqs.length },
            ] },
            { title: 'Données', items: [
              { key: 'frmt'    as AdminTab, label: '🏆 FRMT',    badge: 0 },
              { key: 'players' as AdminTab, label: '👥 Joueurs', badge: 0 },
              { key: 'games'   as AdminTab, label: '🏟️ Parties', badge: 0 },
            ] },
            { title: 'Config', items: [
              { key: 'badges' as AdminTab, label: '🏅 Badges', badge: 0 },
              { key: 'settings' as AdminTab, label: '⚙️ Réglages', badge: 0 },
            ] },
            // L'interrupteur : ce groupe entier disparaît, onglet compris,
            // tant que fn_tournaments_enabled() est éteint côté serveur.
            ...(tournamentsEnabled ? [{ title: 'Tournois', items: [
              { key: 'tournaments' as AdminTab, label: '🏆 Tournois', badge: 0 },
            ] }] : []),
          ]).map(group => (
            <View key={group.title} style={{ gap: 6 }}>
              <Text style={{ fontSize: 9, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, fontFamily: Fonts.uiBlack }}>{group.title}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {group.items.map(t => {
                  const active = tab === t.key;
                  return (
                    <TouchableOpacity key={t.key} onPress={() => setTab(t.key)} activeOpacity={0.7}
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
                        backgroundColor: active ? Colors.primary : Colors.bgCard,
                        borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12,
                        borderWidth: 1, borderColor: active ? Colors.primary : Colors.border }}>
                      <Text style={{ fontSize: 11, fontWeight: '900', color: active ? Colors.textOnDark : Colors.textSecondary, fontFamily: Fonts.uiBlack }}>{t.label}</Text>
                      {t.badge > 0 && (
                        <View style={{ backgroundColor: active ? Colors.textOnDark : Colors.danger, borderRadius: 999, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                          <Text style={{ fontSize: 9, fontWeight: '900', color: active ? Colors.danger : Colors.textOnDark, fontFamily: Fonts.uiBlack }}>{t.badge}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* Content */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {tab === 'disputes' && (
          <DisputesTab
            matches={disputes}
            editedScores={editedScores}
            setEditedScores={setEditedScores}
            loadingId={loadingId}
            onForceValidate={handleForceValidate}
            onCancel={handleCancel}
          />
        )}
        {tab === 'frmt' && (
          <FrmtTab
            entries={frmtEntries}
            allPlayers={allPlayers}
            loading={frmtLoading}
            onLink={handleLink}
            events={frmtEvents}
            onUnlink={handleUnlink}
            onRefresh={loadFrmt}
          />
        )}
        {tab === 'players' && (
          <PlayersTab
            players={playersList}
            loading={playersLoading}
            actingId={playerActingId}
            onUnlink={handlePlayerUnlink}
            onFraud={handlePlayerFraud}
            onUnblock={handlePlayerUnblock}
            onRefresh={loadPlayers}
          />
        )}
        {tab === 'games' && (
          <GamesTab
            games={games}
            loading={gamesLoading}
            deletingId={deletingId}
            onDelete={handleDeleteGame}
            onRefresh={loadGames}
          />
        )}
        {tab === 'gender' && (
          <GenderTab
            requests={genderReqs}
            loading={genderLoading}
            resolvingId={resolvingId}
            onApprove={handleGenderApprove}
            onReject={handleGenderReject}
            onRefresh={loadGenderReqs}
          />
        )}
        {tab === 'reports' && (
          <ReportsTab
            reports={reports}
            loading={reportsLoading}
            resolvingId={resolvingId}
            onResolve={handleResolveReport}
            onOpenPlayer={(id) => router.push(`/player/${id}` as any)}
          />
        )}
        {tab === 'badges' && <BadgesTab />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'tournaments' && tournamentsEnabled && player && (
          <TournamentsTab myPlayerId={player.id} />
        )}
      </ScrollView>
    </View>
  );
}

// ─── Badges tab ───────────────────────────────────────────────
const BADGE_COLOR_PRESETS = ['#E6A21A', '#E5484D', '#F2750A', '#5B6B82', '#1FA8B0', '#7C5CD6', '#16A34A', '#D98A1A'];

// Normalisation d'une saisie hex : # auto, majuscules, caractères hex uniquement.
const normalizeHex = (v: string) => '#' + v.replace(/[^0-9a-fA-F]/g, '').toUpperCase().slice(0, 6);
const isValidHex = (v: string) => /^#[0-9A-F]{6}$/.test(v);

interface BadgeRow {
  key: string;
  label: string;
  icon_key: string;
  color: string;
  active: boolean;
  sort: number;
}

function BadgeIconPreview({ iconKey, color, size = 56 }: { iconKey: string; color: string; size?: number }) {
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BADGE_ICON_VIEWBOX}" fill="#ffffff">${BADGE_ICONS[iconKey] ?? BADGE_ICONS[FALLBACK_ICON_KEY]}</svg>`;
  const iconSize = Math.round(size * 0.6);
  return (
    <View style={{ width: size, height: size, borderRadius: 999, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <SvgXml xml={xml} width={iconSize} height={iconSize} />
    </View>
  );
}

// ── Réglages applicatifs (app_config) ──────────────────────────────
function SettingsTab() {
  const [win, setWin] = useState('');
  const [liveOn, setLiveOn] = useState(false);
  // Défaut `true` : clé absente = activé, même convention que fn_watch_enabled().
  const [watchOn, setWatchOn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('app_config').select('value').eq('key', 'defi_promotion_window_minutes').maybeSingle();
    setWin((data?.value ?? '30').replace(/[^0-9]/g, '') || '30');
    const { data: live } = await supabase.from('app_config').select('value').eq('key', 'live_scoring_enabled').maybeSingle();
    setLiveOn(live?.value === 'true');
    const { data: watch } = await supabase.from('app_config').select('value').eq('key', 'watch_pairing_enabled').maybeSingle();
    setWatchOn(watch?.value !== 'false');
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const n = parseInt(win, 10);
    if (!Number.isFinite(n) || n < 0 || n > 1440) { Alert.alert('Valeur invalide', 'Entre un nombre de minutes entre 0 et 1440.'); return; }
    setSaving(true);
    const { error } = await supabase.from('app_config')
      .upsert({ key: 'defi_promotion_window_minutes', value: String(n), updated_at: new Date().toISOString() }, { onConflict: 'key' });
    setSaving(false);
    if (error) { Alert.alert('Erreur', error.message); return; }
    Alert.alert('Enregistré', `Fenêtre de promotion réglée à ${n} min.`);
  };

  if (loading) return <ActivityIndicator color={Colors.primary} style={{ marginTop: 32 }} />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View style={{ backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 16, gap: 10 }}>
        <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>Défis — file d'attente</Text>
        <Text style={{ fontSize: 12, color: Colors.textMuted, lineHeight: 17 }}>
          Fenêtre de promotion (minutes avant le match) en-deçà de laquelle on ne promeut plus un binôme de la file. Un binôme qui se retire trop tard n'est donc pas remplacé.
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
          <TextInput
            value={win} onChangeText={(t) => setWin(t.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad" placeholder="30" placeholderTextColor={Colors.textMuted}
            style={{ flex: 1, backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, fontWeight: '700', color: Colors.textPrimary }}
          />
          <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.textSecondary }}>min</Text>
          <TouchableOpacity onPress={save} disabled={saving} style={{ backgroundColor: Colors.brand, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11, opacity: saving ? 0.6 : 1 }}>
            {saving ? <ActivityIndicator size="small" color={Colors.textOnBrand} /> : <Text style={{ color: Colors.textOnBrand, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 13 }}>Enregistrer</Text>}
          </TouchableOpacity>
        </View>
      </View>
      <View style={{ backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 16, gap: 10 }}>
        <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>Score en direct</Text>
        <Text style={{ fontSize: 12, color: Colors.textMuted, lineHeight: 17 }}>
          Active le suivi du score jeu par jeu pendant les matchs (scoreur désigné au lobby, lecture en temps réel). Éteint, la feature est totalement invisible.
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.textPrimary }}>{liveOn ? 'Activé' : 'Désactivé'}</Text>
          <Switch value={liveOn} onValueChange={async (v) => {
            setLiveOn(v);
            const { error } = await supabase.from('app_config')
              .upsert({ key: 'live_scoring_enabled', value: v ? 'true' : 'false', updated_at: new Date().toISOString() }, { onConflict: 'key' });
            if (error) { setLiveOn(!v); Alert.alert('Erreur', error.message); }
          }} />
        </View>
      </View>

      <View style={{ backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 16, gap: 10 }}>
        <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>Connexion des montres</Text>
        <Text style={{ fontSize: 12, color: Colors.textMuted, lineHeight: 17 }}>
          Autorise les joueurs à lier une montre Garmin et à marquer les points au poignet.
          Éteint, l'entrée « Connecter ma montre » disparaît de l'app ET les montres déjà
          liées cessent immédiatement de marquer — c'est un vrai coupe-circuit, il agit
          sans publier de mise à jour. Pour délier UNE seule montre (perte, vol), passe
          plutôt par « Délier » dans l'écran du joueur.
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.textPrimary }}>{watchOn ? 'Activé' : 'Désactivé'}</Text>
          <Switch value={watchOn} onValueChange={async (v) => {
            setWatchOn(v);
            const { error } = await supabase.from('app_config')
              .upsert({ key: 'watch_pairing_enabled', value: v ? 'true' : 'false', updated_at: new Date().toISOString() }, { onConflict: 'key' });
            if (error) { setWatchOn(!v); Alert.alert('Erreur', error.message); }
          }} />
        </View>
      </View>
    </ScrollView>
  );
}

function BadgesTab() {
  const [rows, setRows] = useState<BadgeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, BadgeRow>>({});
  // Cartes repliées par défaut ; une seule dépliée à la fois (accordéon).
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // Nuancier partagé : cible = 'NEW' (formulaire d'ajout) ou la clé d'un badge.
  const [pickerTarget, setPickerTarget] = useState<string | null>(null);
  const [pickerColor, setPickerColor] = useState('#5B6B82');

  // Add form state
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newIconKey, setNewIconKey] = useState('medal');
  const [newColor, setNewColor] = useState('#5B6B82');
  const [adding, setAdding] = useState(false);

  const allIconKeys = Object.keys(BADGE_ICONS);

  const loadRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('badge_defs').select('*').order('sort');
    if (error) { Alert.alert('Erreur', error.message); setLoading(false); return; }
    const fetched: BadgeRow[] = (data ?? []) as BadgeRow[];
    setRows(fetched);
    const initDrafts: Record<string, BadgeRow> = {};
    fetched.forEach(r => { initDrafts[r.key] = { ...r }; });
    setDrafts(initDrafts);
    setLoading(false);
  }, []);

  useEffect(() => { loadRows(); }, [loadRows]);

  const setDraftField = (key: string, field: keyof BadgeRow, value: any) => {
    setDrafts(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };

  const toggleExpanded = (key: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedKey(k => (k === key ? null : key));
  };

  const openPicker = (target: string, current: string) => {
    setPickerColor(isValidHex(current) ? current : '#5B6B82');
    setPickerTarget(target);
  };

  const applyPicker = () => {
    if (!pickerTarget) return;
    if (pickerTarget === 'NEW') setNewColor(pickerColor);
    else setDraftField(pickerTarget, 'color', pickerColor);
    setPickerTarget(null);
  };

  const handleSave = async (rowKey: string) => {
    const draft = drafts[rowKey];
    if (!draft) return;
    if (!isValidHex(draft.color)) { Alert.alert('Couleur invalide', 'Utilise un code hex complet, ex. #E6A21A.'); return; }
    setSavingKey(rowKey);
    const { error } = await supabase
      .from('badge_defs')
      .update({ label: draft.label, icon_key: draft.icon_key, color: draft.color, active: draft.active, sort: draft.sort })
      .eq('key', rowKey);
    setSavingKey(null);
    if (error) { Alert.alert('Erreur', error.message); return; }
    // MAJ locale (la base a accepté exactement ces valeurs) : pas de loadRows(),
    // dont le passage par `loading` démonte la liste et remet le scroll en haut.
    setRows(prev => prev.map(r => (r.key === rowKey ? { ...draft } : r)).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)));
    await loadBadgeDefs();
    Alert.alert('', 'Badge enregistré.');
  };

  const handleDelete = (rowKey: string) => {
    Alert.alert(
      'Supprimer ce badge ?',
      `La clé "${rowKey}" sera supprimée définitivement.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer', style: 'destructive', onPress: async () => {
            setSavingKey(rowKey);
            const { error } = await supabase.from('badge_defs').delete().eq('key', rowKey);
            setSavingKey(null);
            if (error) { Alert.alert('Erreur', error.message); return; }
            // MAJ locale sans loadRows() : conserve la position de scroll.
            setRows(prev => prev.filter(r => r.key !== rowKey));
            setDrafts(prev => { const next = { ...prev }; delete next[rowKey]; return next; });
            await loadBadgeDefs();
          },
        },
      ],
    );
  };

  const handleAdd = async () => {
    if (!newKey.trim() || !newLabel.trim()) { Alert.alert('Erreur', 'La clé et le label sont requis.'); return; }
    if (!isValidHex(newColor)) { Alert.alert('Couleur invalide', 'Utilise un code hex complet, ex. #E6A21A.'); return; }
    const maxSort = rows.reduce((m, r) => Math.max(m, r.sort ?? 0), 0);
    const newRow: BadgeRow = {
      key: newKey.trim(),
      label: newLabel.trim(),
      icon_key: newIconKey,
      color: newColor,
      active: true,
      sort: maxSort + 1,
    };
    setAdding(true);
    const { error } = await supabase.from('badge_defs').insert(newRow);
    setAdding(false);
    if (error) { Alert.alert('Erreur', error.message); return; }
    // MAJ locale sans loadRows() : conserve la position de scroll.
    setRows(prev => [...prev, newRow]);
    setDrafts(prev => ({ ...prev, [newRow.key]: { ...newRow } }));
    await loadBadgeDefs();
    setNewKey('');
    setNewLabel('');
    setNewIconKey('medal');
    setNewColor('#5B6B82');
  };

  if (loading) return <ActivityIndicator color={Colors.brand} style={{ marginTop: 40 }} />;

  return (
    <View style={{ gap: 16 }}>
      {/* ── Ajouter un badge ── */}
      <View style={{ backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1.5, borderColor: Colors.brand + '44', padding: 16, gap: 12 }}>
        <Text style={{ fontSize: 11, fontWeight: '900', color: Colors.brand, textTransform: 'uppercase', letterSpacing: 1, fontFamily: Fonts.uiBlack }}>
          + Nouveau badge
        </Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={sty.fieldLabel}>Clé (badge_type)</Text>
            <TextInput
              value={newKey}
              onChangeText={setNewKey}
              placeholder="ex: MVP"
              placeholderTextColor={Colors.textSecondary}
              style={sty.scoreInput}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={sty.fieldLabel}>Label affiché</Text>
            <TextInput
              value={newLabel}
              onChangeText={setNewLabel}
              placeholder="ex: MVP"
              placeholderTextColor={Colors.textSecondary}
              style={sty.scoreInput}
            />
          </View>
        </View>
        {/* Aperçu + icône + couleur */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <BadgeIconPreview iconKey={newIconKey} color={newColor} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {BADGE_COLOR_PRESETS.map(c => (
                <TouchableOpacity key={c} onPress={() => setNewColor(c)}
                  style={{ width: 24, height: 24, borderRadius: 999, backgroundColor: c, borderWidth: newColor === c ? 2.5 : 0, borderColor: Colors.textPrimary }} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                value={newColor}
                onChangeText={v => setNewColor(normalizeHex(v))}
                placeholder="#5B6B82"
                placeholderTextColor={Colors.textSecondary}
                style={[sty.scoreInput, { fontSize: 12, flex: 1 }, !isValidHex(newColor) && { borderColor: Colors.danger }]}
                autoCapitalize="characters"
                maxLength={7}
              />
              <TouchableOpacity onPress={() => openPicker('NEW', newColor)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.bg, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12 }}>
                <Text style={{ fontSize: 12 }}>🎨</Text>
                <Text style={{ fontSize: 12, fontWeight: '800', color: Colors.textPrimary, fontFamily: Fonts.uiBold }}>Nuancier</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        <Text style={sty.fieldLabel}>Icône</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {allIconKeys.map(ik => {
            const selected = newIconKey === ik;
            const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BADGE_ICON_VIEWBOX}" fill="${selected ? '#ffffff' : Colors.textPrimary}">${BADGE_ICONS[ik]}</svg>`;
            return (
              <TouchableOpacity key={ik} onPress={() => setNewIconKey(ik)}
                style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: selected ? Colors.primary : Colors.bg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: selected ? Colors.primary : Colors.border }}>
                <SvgXml xml={xml} width={22} height={22} />
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity onPress={handleAdd} disabled={adding} style={[sty.btnValidate, { opacity: adding ? 0.5 : 1 }]}>
          {adding
            ? <ActivityIndicator color={Colors.textOnDark} size="small" />
            : <Text style={{ color: Colors.textOnDark, fontWeight: '900', fontSize: 13, fontFamily: Fonts.uiBlack }}>Ajouter le badge</Text>
          }
        </TouchableOpacity>
      </View>

      {/* ── Badges existants ── */}
      {rows.map(row => {
        const draft = drafts[row.key] ?? row;
        const saving = savingKey === row.key;
        const expanded = expandedKey === row.key;
        const iconXml = (ik: string, fill: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BADGE_ICON_VIEWBOX}" fill="${fill}">${BADGE_ICONS[ik] ?? BADGE_ICONS[FALLBACK_ICON_KEY]}</svg>`;
        return (
          <View key={row.key} style={{ backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, padding: expanded ? 16 : 12, gap: expanded ? 12 : 0 }}>
            {/* En-tête compacte (aperçu live) : tap = déplier/replier l'éditeur */}
            <TouchableOpacity onPress={() => toggleExpanded(row.key)} activeOpacity={0.7}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <BadgeIconPreview iconKey={draft.icon_key} color={isValidHex(draft.color) ? draft.color : '#CBD5E1'} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '900', color: Colors.textPrimary, fontFamily: Fonts.uiBlack }}>{draft.label}</Text>
                <Text style={{ fontSize: 10, color: Colors.textMuted, fontFamily: Fonts.uiBold }}>{row.key}</Text>
              </View>
              <View style={{ backgroundColor: draft.active ? '#DCFCE7' : '#F1F5F9', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: draft.active ? '#166534' : '#64748B', fontFamily: Fonts.uiBlack }}>
                  {draft.active ? 'Actif' : 'Inactif'}
                </Text>
              </View>
              <Text style={{ fontSize: 11, color: Colors.textMuted }}>{expanded ? '▲' : '▼'}</Text>
            </TouchableOpacity>

            {expanded && (<>
            {/* Actif */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
              <Text style={{ fontSize: 11, color: Colors.textSecondary, fontWeight: '700' }}>Actif</Text>
              <Switch
                value={draft.active}
                onValueChange={v => setDraftField(row.key, 'active', v)}
                trackColor={{ false: Colors.border, true: Colors.primary + '88' }}
                thumbColor={draft.active ? Colors.primary : Colors.textMuted}
              />
            </View>

            {/* Label */}
            <View>
              <Text style={sty.fieldLabel}>Label</Text>
              <TextInput
                value={draft.label}
                onChangeText={v => setDraftField(row.key, 'label', v)}
                placeholderTextColor={Colors.textSecondary}
                style={sty.scoreInput}
              />
            </View>

            {/* Couleur */}
            <View>
              <Text style={sty.fieldLabel}>Couleur</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {BADGE_COLOR_PRESETS.map(c => (
                  <TouchableOpacity key={c} onPress={() => setDraftField(row.key, 'color', c)}
                    style={{ width: 28, height: 28, borderRadius: 999, backgroundColor: c, borderWidth: draft.color === c ? 2.5 : 0, borderColor: Colors.textPrimary }} />
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  value={draft.color}
                  onChangeText={v => setDraftField(row.key, 'color', normalizeHex(v))}
                  placeholder="#E6A21A"
                  placeholderTextColor={Colors.textSecondary}
                  style={[sty.scoreInput, { fontSize: 13, flex: 1 }, !isValidHex(draft.color) && { borderColor: Colors.danger }]}
                  autoCapitalize="characters"
                  maxLength={7}
                />
                <TouchableOpacity onPress={() => openPicker(row.key, draft.color)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.bg, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12 }}>
                  <Text style={{ fontSize: 12 }}>🎨</Text>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: Colors.textPrimary, fontFamily: Fonts.uiBold }}>Nuancier</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Icône */}
            <View>
              <Text style={sty.fieldLabel}>Icône</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {allIconKeys.map(ik => {
                  const selected = draft.icon_key === ik;
                  return (
                    <TouchableOpacity key={ik} onPress={() => setDraftField(row.key, 'icon_key', ik)}
                      style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: selected ? Colors.primary : Colors.bg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: selected ? Colors.primary : Colors.border }}>
                      <SvgXml xml={iconXml(ik, selected ? '#ffffff' : Colors.textPrimary)} width={22} height={22} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Sort */}
            <View>
              <Text style={sty.fieldLabel}>Ordre (sort)</Text>
              <TextInput
                value={String(draft.sort ?? 0)}
                onChangeText={v => setDraftField(row.key, 'sort', parseInt(v, 10) || 0)}
                keyboardType="number-pad"
                placeholderTextColor={Colors.textSecondary}
                style={sty.scoreInput}
              />
            </View>

            {/* Actions */}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={() => handleSave(row.key)} disabled={saving}
                style={[sty.btnValidate, { opacity: saving ? 0.5 : 1 }]}>
                {saving
                  ? <ActivityIndicator color={Colors.textOnDark} size="small" />
                  : <Text style={{ color: Colors.textOnDark, fontWeight: '900', fontSize: 13, fontFamily: Fonts.uiBlack }}>Enregistrer</Text>
                }
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleDelete(row.key)} disabled={saving}
                style={[sty.btnCancel, { opacity: saving ? 0.5 : 1 }]}>
                <Text style={{ color: Colors.danger, fontWeight: '700', fontSize: 13, fontFamily: Fonts.uiBold }}>🗑️ Suppr.</Text>
              </TouchableOpacity>
            </View>
            </>)}
          </View>
        );
      })}

      {/* ── Nuancier (modal partagé : formulaire d'ajout ou badge existant) ── */}
      <Modal visible={pickerTarget !== null} transparent animationType="fade" onRequestClose={() => setPickerTarget(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'center', padding: 28 }}>
          <View style={{ backgroundColor: Colors.bgCard, borderRadius: 20, padding: 18, gap: 14 }}>
            <Text style={{ fontSize: 13, fontWeight: '900', color: Colors.textPrimary, fontFamily: Fonts.uiBlack }}>Choisir une couleur</Text>
            <ColorPicker value={pickerColor} onCompleteJS={c => setPickerColor(c.hex.slice(0, 7).toUpperCase())} style={{ gap: 14 }}>
              <Preview hideInitialColor />
              <Panel1 style={{ height: 180, borderRadius: 14 }} />
              <HueSlider style={{ borderRadius: 999 }} />
            </ColorPicker>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={() => setPickerTarget(null)} style={[sty.btnCancel, { flex: 1 }]}>
                <Text style={{ color: Colors.textSecondary, fontWeight: '700', fontSize: 13, fontFamily: Fonts.uiBold, textAlign: 'center' }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={applyPicker} style={[sty.btnValidate, { flex: 1 }]}>
                <Text style={{ color: Colors.textOnDark, fontWeight: '900', fontSize: 13, fontFamily: Fonts.uiBlack, textAlign: 'center' }}>Valider</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Gender requests tab ──────────────────────────────────────
function GenderTab({ requests, loading, resolvingId, onApprove, onReject, onRefresh }: {
  requests: any[]; loading: boolean; resolvingId: string | null;
  onApprove: (req: any) => void; onReject: (req: any) => void; onRefresh: () => void;
}) {
  const genderLabel = (g: string | null | undefined) =>
    g === 'male' ? '♂ Homme' : g === 'female' ? '♀ Femme' : '—';

  if (loading) return <ActivityIndicator color={Colors.brand} style={{ marginTop: 40 }} />;
  if (requests.length === 0) {
    return (
      <View style={sty.emptyCard}>
        <Text style={{ fontSize: 32, marginBottom: 8 }}>⚧</Text>
        <Text style={{ fontFamily: Fonts.uiBlack, color: Colors.textPrimary, fontSize: 14, textAlign: 'center' }}>
          Aucune demande en attente
        </Text>
        <Text style={{ color: Colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 4 }}>
          Les demandes de changement de genre apparaîtront ici.
        </Text>
        <TouchableOpacity onPress={onRefresh} style={{ marginTop: 14, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border }}>
          <Text style={{ color: Colors.textPrimary, fontSize: 12, fontWeight: '800' }}>Rafraîchir</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <View style={{ gap: 12 }}>
      {requests.map(req => (
        <View key={req.id} style={{
          backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1.5, borderColor: '#fbbf2433',
          padding: 16,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <View style={{ width: 40, height: 40, borderRadius: 999, backgroundColor: Colors.brand, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 16, fontFamily: Fonts.uiBlack, color: Colors.textOnBrand }}>
                {(req.player?.name ?? '?').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>{req.player?.name ?? '?'}</Text>
              <Text style={{ fontSize: 10, color: Colors.textMuted, marginTop: 2 }}>
                Demandé le {new Date(req.created_at).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <View style={{ flex: 1, backgroundColor: Colors.bg, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: Colors.border }}>
              <Text style={{ fontSize: 9, fontWeight: '800', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Actuel</Text>
              <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, marginTop: 2 }}>{genderLabel(req.current_gender)}</Text>
            </View>
            <Text style={{ fontSize: 16, color: Colors.brand }}>→</Text>
            <View style={{ flex: 1, backgroundColor: 'rgba(255,193,26,0.14)', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: 'rgba(255,193,26,0.5)' }}>
              <Text style={{ fontSize: 9, fontWeight: '800', color: Colors.brandDeep, textTransform: 'uppercase', letterSpacing: 0.5 }}>Demandé</Text>
              <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.brand, marginTop: 2 }}>{genderLabel(req.requested_gender)}</Text>
            </View>
          </View>

          {req.reason ? (
            <View style={{ backgroundColor: Colors.bg, borderRadius: 10, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: Colors.border }}>
              <Text style={{ fontSize: 9, fontWeight: '800', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Raison</Text>
              <Text style={{ fontSize: 12, color: Colors.textSecondary, fontStyle: 'italic' }}>{req.reason}</Text>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              disabled={resolvingId === req.id}
              onPress={() => onReject(req)}
              style={{ flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center', backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border, opacity: resolvingId === req.id ? 0.5 : 1 }}
            >
              <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.danger }}>Refuser</Text>

            </TouchableOpacity>
            <TouchableOpacity
              disabled={resolvingId === req.id}
              onPress={() => onApprove(req)}
              style={{ flex: 1.4, paddingVertical: 11, borderRadius: 12, alignItems: 'center', backgroundColor: Colors.success, opacity: resolvingId === req.id ? 0.5 : 1 }}
            >
              {resolvingId === req.id ? (
                <ActivityIndicator color={Colors.textOnDark} />
              ) : (
                <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>✓ Approuver</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── Reports tab (modération UGC) ─────────────────────────────
function ReportsTab({ reports, loading, resolvingId, onResolve, onOpenPlayer }: {
  reports: any[]; loading: boolean; resolvingId: string | null;
  onResolve: (report: any, status: 'actioned' | 'dismissed') => void;
  onOpenPlayer: (id: string) => void;
}) {
  const typeLabel = (t: string) => ({
    message: '💬 Message', story: '📸 Story', activity: '📣 Activité',
    comment: '💭 Commentaire', player: '👤 Profil',
  }[t] ?? t);

  if (loading) return <ActivityIndicator color={Colors.brand} style={{ marginTop: 40 }} />;
  if (reports.length === 0) {
    return (
      <View style={sty.emptyCard}>
        <Text style={{ fontSize: 32, marginBottom: 8 }}>🚩</Text>
        <Text style={{ fontFamily: Fonts.uiBlack, color: Colors.textPrimary, fontSize: 14, textAlign: 'center' }}>
          Aucun signalement en attente
        </Text>
        <Text style={{ color: Colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 4 }}>
          Les contenus et profils signalés apparaîtront ici.
        </Text>
      </View>
    );
  }
  return (
    <View style={{ gap: 12 }}>
      {reports.map(r => (
        <View key={r.id} style={{ backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1.5, borderColor: '#ef444433', padding: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>{typeLabel(r.target_type)}</Text>
            <Text style={{ fontSize: 10, color: Colors.textMuted }}>
              {new Date(r.created_at).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>

          <Text style={{ fontSize: 12, color: Colors.textSecondary, marginBottom: 4 }}>
            Signalé par <Text style={{ fontFamily: Fonts.uiBold, color: Colors.textPrimary }}>{r.reporter?.name ?? '?'}</Text>
          </Text>
          {r.reported?.name ? (
            <TouchableOpacity onPress={() => r.reported?.id && onOpenPlayer(r.reported.id)} activeOpacity={0.7}>
              <Text style={{ fontSize: 12, color: Colors.textSecondary, marginBottom: 4 }}>
                Visé : <Text style={{ fontFamily: Fonts.uiBold, color: Colors.brand }}>{r.reported.name} ›</Text>
              </Text>
            </TouchableOpacity>
          ) : null}
          <Text style={{ fontSize: 10, color: Colors.textMuted, marginBottom: r.reason ? 8 : 12 }}>ref : {r.target_id}</Text>
          {r.reason ? (
            <View style={{ backgroundColor: Colors.bg, borderRadius: 10, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: Colors.border }}>
              <Text style={{ fontSize: 12, color: Colors.textSecondary, fontStyle: 'italic' }}>{r.reason}</Text>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity disabled={resolvingId === r.id} onPress={() => onResolve(r, 'actioned')} activeOpacity={0.7}
              style={{ flex: 1, alignItems: 'center', backgroundColor: '#ef444415', borderRadius: 10, paddingVertical: 10, borderWidth: 1, borderColor: '#ef444440' }}>
              <Text style={{ fontSize: 12, fontWeight: '900', color: Colors.danger, fontFamily: Fonts.uiBlack }}>
                {resolvingId === r.id ? '…' : 'Traité'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={resolvingId === r.id} onPress={() => onResolve(r, 'dismissed')} activeOpacity={0.7}
              style={{ flex: 1, alignItems: 'center', backgroundColor: Colors.bg, borderRadius: 10, paddingVertical: 10, borderWidth: 1, borderColor: Colors.border }}>
              <Text style={{ fontSize: 12, fontWeight: '900', color: Colors.textSecondary, fontFamily: Fonts.uiBlack }}>Rejeter</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────
// ─── Tournois (Task 10) — l'écran d'organisation ───────────────────────────
//
// Réservé au créateur du tournoi (`created_by`) : les neuf fonctions serveur
// de cette section le refusent toutes sinon (`not_the_organizer`). Ce panel
// affiche donc les tournois en lecture pour tout arbitre, mais grise/annote
// les actions quand `myPlayerId` n'est pas l'organisateur — plutôt que de
// laisser le serveur les refuser en silence.
//
// PAS DE BASE NI D'APPAREIL POUR VÉRIFIER CET ÉCRAN : tout ce qui suit est
// RAISONNÉ contre les en-têtes de `tournaments_rpcs.sql`, jamais observé en
// exécution.
//
// ⚠️ HISTORIQUE, POUR NE PAS LE REFAIRE : la relecture de branche (Task 12) a
// trouvé deux trous ici — TOUS DEUX CLIENT, jamais serveur. `tournament_create`
// est appelée depuis longtemps (l'INSERT direct qu'écartait le premier trou
// est de l'histoire ancienne) ; `tournament_open_check_in` et
// `tournament_mark_no_show` EXISTAIENT côté serveur depuis le début de cette
// tâche (Task 10) mais n'avaient AUCUN appelant ici — c'est ce qui rendait
// CHECK_IN/PRET inatteignables depuis l'app, jamais une policy RLS ni une
// fonction manquante. Les deux sont désormais branchées ci-dessous
// (« Ouvrir le pointage », « Marquer absent » par ligne d'inscrit).

function TournamentsTab({ myPlayerId }: { myPlayerId: string }) {
  const [list, setList] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setList(await fetchTournaments());
    } catch {
      Alert.alert('Erreur', 'Chargement des tournois impossible.');
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const selected = list.find(t => t.id === selectedId) ?? null;

  if (selectedId && selected) {
    return (
      <TournamentManage
        tournament={selected}
        myPlayerId={myPlayerId}
        onBack={() => setSelectedId(null)}
        onChanged={load}
      />
    );
  }

  if (creating) {
    return (
      <TournamentCreateForm
        myPlayerId={myPlayerId}
        onCancel={() => setCreating(false)}
        onCreated={(t) => {
          // Injecté directement dans la liste locale (pas seulement via
          // `load()`, async) : `selectedId` doit trouver son tournoi DÈS le
          // prochain rendu, sans dépendre d'une réponse réseau qui pourrait
          // arriver après — sans quoi cet écran retomberait un instant sur la
          // liste (le tournoi tout juste créé n'y figurant pas encore).
          setCreating(false);
          setList(prev => [t, ...prev]);
          setSelectedId(t.id);
          load();
        }}
      />
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <TouchableOpacity onPress={() => setCreating(true)} activeOpacity={0.85} style={sty.btnBrand}>
        <Text style={sty.btnBrandText}>+ Créer un tournoi</Text>
      </TouchableOpacity>

      {loading ? (
        <ActivityIndicator color={Colors.brand} style={{ marginTop: 30 }} />
      ) : list.length === 0 ? (
        <View style={sty.emptyCard}>
          <Text style={{ fontSize: 40, marginBottom: 10 }}>🏆</Text>
          <Text style={{ fontSize: 15, fontWeight: '900', color: Colors.textMuted, textAlign: 'center', fontFamily: Fonts.uiBlack }}>
            Aucun tournoi publié
          </Text>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {list.map(t => (
            <TouchableOpacity key={t.id} onPress={() => setSelectedId(t.id)} activeOpacity={0.85} style={sty.frmtRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontWeight: '900', color: Colors.textPrimary, fontFamily: Fonts.uiBlack }}>
                    {t.name}
                  </Text>
                  {t.created_by === myPlayerId && <Pill variant="brand">Toi</Pill>}
                </View>
                <Text style={{ fontSize: 11, color: Colors.textSecondary, fontWeight: '700' }}>
                  {formatTournamentDate(t.starts_at)} · {statusLabel(t.status)}
                </Text>
                <Text style={{ fontSize: 11, color: Colors.textMuted, fontWeight: '600', marginTop: 2 }}>
                  {formatLabel(t.court_count, t.round_count)}
                </Text>
              </View>
              <Text style={{ fontSize: 18, color: Colors.textMuted }}>›</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Créer ──────────────────────────────────────────────────────────────────
function TournamentCreateForm({ myPlayerId, onCancel, onCreated }: {
  myPlayerId: string;
  onCancel: () => void;
  onCreated: (t: Tournament) => void;
}) {
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const [name, setName] = useState('');
  const [clubs, setClubs] = useState<{ id: string; name: string; city: string | null }[]>([]);
  const [clubPickerOpen, setClubPickerOpen] = useState(false);
  const [club, setClub] = useState<{ id: string; name: string; city: string | null } | null>(null);
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState('19:00');
  const [levelMin, setLevelMin] = useState('');
  const [levelMax, setLevelMax] = useState('');
  const [courtCount, setCourtCount] = useState('4');
  const [roundCount, setRoundCount] = useState('6');
  const [priceMad, setPriceMad] = useState('0');
  const [scale, setScale] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(DEFAULT_POINTS_SCALE).map(([k, v]) => [k, String(v)])),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Sans `error` lu, un refus réseau laissait `clubs` vide EN SILENCE — le
    // sélecteur de club s'ouvrait sur une liste vide et l'organisateur créait
    // le tournoi sans club, sans jamais savoir que la liste avait échoué à
    // charger plutôt que d'être réellement vide.
    supabase.from('clubs').select('id,name,city').order('name').then(({ data, error }) => {
      if (error) {
        console.warn('[tournois] liste des clubs indisponible', error);
        Alert.alert(
          'Clubs indisponibles',
          'La liste des clubs n’a pas pu être chargée. Tu peux créer le tournoi sans club pour l’instant.',
        );
      }
      setClubs(data ?? []);
    });
  }, []);

  const handleCreate = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) { Alert.alert('Nom manquant', 'Donne un nom au tournoi.'); return; }

    const startsAt = new Date(`${date}T${time}`);
    if (isNaN(startsAt.getTime())) {
      Alert.alert('Date invalide', 'Utilise le format AAAA-MM-JJ pour la date et HH:MM pour l’heure.');
      return;
    }

    const cc = parseInt(courtCount, 10);
    if (!Number.isInteger(cc) || cc <= 0) { Alert.alert('Terrains invalides', 'Le nombre de terrains doit être un entier positif.'); return; }
    const rc = parseInt(roundCount, 10);
    if (!Number.isInteger(rc) || rc <= 0) { Alert.alert('Rotations invalides', 'Le nombre de rotations doit être un entier positif.'); return; }

    const lvlMin = levelMin.trim() === '' ? null : Number(levelMin);
    const lvlMax = levelMax.trim() === '' ? null : Number(levelMax);
    if (lvlMin != null && !Number.isFinite(lvlMin)) { Alert.alert('Niveau invalide', 'Le niveau minimum n’est pas un nombre.'); return; }
    if (lvlMax != null && !Number.isFinite(lvlMax)) { Alert.alert('Niveau invalide', 'Le niveau maximum n’est pas un nombre.'); return; }
    if (lvlMin != null && lvlMax != null && lvlMin > lvlMax) {
      Alert.alert('Plage de niveau invalide', 'Le niveau minimum ne peut pas dépasser le maximum.');
      return;
    }

    const price = parseInt(priceMad, 10);
    if (!Number.isInteger(price) || price < 0) { Alert.alert('Prix invalide', 'Le prix affiché doit être un entier positif ou nul.'); return; }

    const pointsScale: Record<string, number> = {};
    for (const [rank, v] of Object.entries(scale)) {
      const n = Number(v);
      if (!Number.isFinite(n)) { Alert.alert('Barème invalide', `La valeur du rang ${rank} n’est pas un nombre.`); return; }
      pointsScale[rank] = n;
    }
    if (!pointsScaleValid(pointsScale)) {
      Alert.alert('Barème invalide', 'Aucun rang ne peut recevoir un nombre négatif de points.');
      return;
    }

    setSaving(true);
    try {
      const t = await createTournament({
        name: trimmedName, clubId: club?.id ?? null, startsAt: startsAt.toISOString(),
        levelMin: lvlMin, levelMax: lvlMax, courtCount: cc, roundCount: rc, priceMad: price,
        pointsScale, createdBy: myPlayerId,
      });
      onCreated(t);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? 'Création impossible.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
      <TouchableOpacity onPress={onCancel}>
        <Text style={{ fontSize: 13, fontWeight: '900', color: Colors.brand }}>‹ Annuler</Text>
      </TouchableOpacity>

      <View style={sty.orgCard}>
        <Text style={sty.orgCardTitle}>Informations</Text>
        <View>
          <Text style={sty.fieldLabel}>Nom du tournoi</Text>
          <TextInput value={name} onChangeText={setName} placeholder="Montante / descente du jeudi"
            placeholderTextColor={Colors.textSecondary} style={sty.scoreInput} />
        </View>
        <View>
          <Text style={sty.fieldLabel}>Club</Text>
          <TouchableOpacity onPress={() => setClubPickerOpen(true)} style={sty.scoreInput}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: club ? Colors.textPrimary : Colors.textSecondary }}>
              {club ? `${club.name}${club.city ? ` · ${club.city}` : ''}` : 'Club à confirmer (optionnel)'}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={sty.fieldLabel}>Date</Text>
            <TextInput value={date} onChangeText={setDate} placeholder="AAAA-MM-JJ"
              placeholderTextColor={Colors.textSecondary} style={sty.scoreInput} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={sty.fieldLabel}>Heure</Text>
            <TextInput value={time} onChangeText={setTime} placeholder="HH:MM"
              placeholderTextColor={Colors.textSecondary} style={sty.scoreInput} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={sty.fieldLabel}>Niveau min (optionnel)</Text>
            <TextInput value={levelMin} onChangeText={setLevelMin} placeholder="ex. 3.0" keyboardType="decimal-pad"
              placeholderTextColor={Colors.textSecondary} style={sty.scoreInput} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={sty.fieldLabel}>Niveau max (optionnel)</Text>
            <TextInput value={levelMax} onChangeText={setLevelMax} placeholder="ex. 6.0" keyboardType="decimal-pad"
              placeholderTextColor={Colors.textSecondary} style={sty.scoreInput} />
          </View>
        </View>
      </View>

      <View style={sty.orgCard}>
        <Text style={sty.orgCardTitle}>Format</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={sty.fieldLabel}>Terrains</Text>
            <TextInput value={courtCount} onChangeText={t => setCourtCount(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad" style={sty.scoreInput} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={sty.fieldLabel}>Rotations</Text>
            <TextInput value={roundCount} onChangeText={t => setRoundCount(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad" style={sty.scoreInput} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={sty.fieldLabel}>Prix (DH)</Text>
            <TextInput value={priceMad} onChangeText={t => setPriceMad(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad" style={sty.scoreInput} />
          </View>
        </View>
        <Text style={sty.orgCardDesc}>
          Durée d’une rotation : {ROUND_MINUTES} min (fixe, même pour tous les tournois PagMatch — ce n’est pas un
          paramètre du serveur). Placement initial : automatique par niveau — les deux binômes les plus forts au
          Terrain 1. La dernière rotation se joue toujours pour le classement.
        </Text>
      </View>

      <View style={sty.orgCard}>
        <Text style={sty.orgCardTitle}>Barème (points par rang final)</Text>
        <Text style={sty.orgCardDesc}>
          Un rang sans seuil défini reprend les points du seuil le plus proche EN DESSOUS. Aucune valeur négative —
          un tournoi classe, il ne punit pas.
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {Object.keys(DEFAULT_POINTS_SCALE).map(rank => (
            <View key={rank} style={{ width: 70 }}>
              <Text style={sty.fieldLabel}>Rang {rank}</Text>
              <TextInput
                value={scale[rank] ?? ''}
                onChangeText={v => setScale(prev => ({ ...prev, [rank]: v.replace(/[^0-9-]/g, '') }))}
                keyboardType="number-pad" style={[sty.scoreInput, { paddingHorizontal: 8, textAlign: 'center' }]}
              />
            </View>
          ))}
        </View>
      </View>

      <TouchableOpacity onPress={handleCreate} disabled={saving} style={[sty.btnBrand, { opacity: saving ? 0.6 : 1 }]}>
        {saving ? <ActivityIndicator color={Colors.textOnBrand} /> : <Text style={sty.btnBrandText}>Créer et publier</Text>}
      </TouchableOpacity>
      <Text style={sty.orgCardDesc}>
        Le tournoi est publié immédiatement (inscriptions ouvertes) : ce chantier n’a reçu aucun geste serveur pour
        publier un brouillon plus tard, donc « créer » et « publier » sont le même geste ici.
      </Text>

      <Modal visible={clubPickerOpen} animationType="slide" transparent statusBarTranslucent onRequestClose={() => setClubPickerOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setClubPickerOpen(false)} />
          <View style={{ backgroundColor: Colors.bgCard, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '70%', borderWidth: 1, borderColor: Colors.border }}>
            <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
              <View style={{ width: 36, height: 4, backgroundColor: Colors.border, borderRadius: 2 }} />
            </View>
            <FlatList
              data={clubs}
              keyExtractor={c => c.id}
              contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: Colors.border }} />}
              ListEmptyComponent={<Text style={{ color: Colors.textSecondary, textAlign: 'center', padding: 20 }}>Aucun club.</Text>}
              renderItem={({ item }) => (
                <TouchableOpacity onPress={() => { setClub(item); setClubPickerOpen(false); }} style={{ paddingVertical: 12 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>{item.name}</Text>
                  {item.city && <Text style={{ fontSize: 11, color: Colors.textSecondary }}>{item.city}</Text>}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

// ─── Conduire ───────────────────────────────────────────────────────────────
const TOURNAMENT_PRE_START = ['INSCRIPTIONS_OUVERTES', 'COMPLET', 'CHECK_IN', 'PRET'];
// Asymétrie du serveur (en-tête de `tournament_autopair`) : elle exige
// COMPLET/CHECK_IN/PRET, contrairement à `tournament_start` qui accepte aussi
// INSCRIPTIONS_OUVERTES. L'écran ne doit jamais proposer un geste refusé.
const TOURNAMENT_AUTOPAIR_OK = ['COMPLET', 'CHECK_IN', 'PRET'];

function AdminMatchCard({
  match, teamA, teamB, status, entriesCount, isOrganizer, busy, laterCount, forfeitGames, stakeText,
  onResolve, onReopen,
}: {
  match: TournamentMatch;
  teamA: CourtTeamInfo;
  teamB: CourtTeamInfo | null;
  status: ReturnType<typeof matchLiveStatus>;
  entriesCount: number;
  isOrganizer: boolean;
  busy: boolean;
  laterCount: number;
  forfeitGames: number;
  /** L'enjeu de ce terrain à LA rotation de classement (Task 12), déjà
   *  traduit par `stakeLabel` — `undefined`/`null` hors de cette rotation. */
  stakeText?: string | null;
  onResolve: (matchId: string, gamesA: number, gamesB: number) => void;
  onReopen: (match: TournamentMatch, laterCount: number) => void;
}) {
  const [inputA, setInputA] = useState('');
  const [inputB, setInputB] = useState('');
  const parsedA = inputA.trim() === '' ? null : Number(inputA);
  const parsedB = inputB.trim() === '' ? null : Number(inputB);
  const error = validateTournamentScore(parsedA, parsedB);
  const canResolve = parsedA != null && parsedB != null && !error && !busy;

  return (
    <View style={sty.matchCard}>
      <CourtRow
        courtNo={match.court_no} isTopCourt={match.court_no === 1}
        teamA={teamA} teamB={teamB}
        gamesA={match.games_a} gamesB={match.games_b}
        forfeitedTeamId={match.forfeited_team} status={status}
        stakeText={stakeText}
      />

      {isOrganizer && teamB && status === 'disputed' && (
        <View style={{ gap: 8 }}>
          <Text style={sty.fieldLabel}>Trancher le litige (score de {teamA.names.join(' · ')} en premier)</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 11.5, fontWeight: '700', color: Colors.textPrimary }}>
              {teamA.names.join(' · ')}
            </Text>
            <TextInput value={inputA} onChangeText={t => setInputA(t.replace(/[^0-9]/g, '').slice(0, 2))}
              keyboardType="number-pad" style={sty.smallScoreInput} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 11.5, fontWeight: '700', color: Colors.textPrimary }}>
              {teamB.names.join(' · ')}
            </Text>
            <TextInput value={inputB} onChangeText={t => setInputB(t.replace(/[^0-9]/g, '').slice(0, 2))}
              keyboardType="number-pad" style={sty.smallScoreInput} />
          </View>
          {error && parsedA != null && parsedB != null && (
            <Text style={{ fontSize: 11, color: Colors.danger, fontWeight: '700' }}>{error}</Text>
          )}
          <TouchableOpacity
            disabled={!canResolve}
            onPress={() => { if (parsedA != null && parsedB != null) onResolve(match.id, parsedA, parsedB); }}
            style={[sty.btnValidate, { opacity: canResolve ? 1 : 0.4 }]}
          >
            <Text style={{ color: Colors.textOnDark, fontWeight: '900', fontSize: 12, fontFamily: Fonts.uiBlack }}>
              Trancher
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Forfait : PAS ici, par ligne de match — un binôme au repos (`!teamB`)
          ou avant même le premier tirage (aucun match encore affiché) doit
          pouvoir être forfaité tout autant qu'un binôme qui joue ce tour-ci.
          Le geste vit dans la liste des binômes, plus bas dans `TournamentManage`. */}
      {isOrganizer && teamB && status === 'confirmed' && (
        <TouchableOpacity onPress={() => onReopen(match, laterCount)} disabled={busy} style={[sty.btnOutline, { alignSelf: 'flex-start' }]}>
          <Text style={sty.btnOutlineText}>↺ Rouvrir</Text>
        </TouchableOpacity>
      )}
      {status === 'forfeited' && (
        <Text style={{ fontSize: 10.5, color: Colors.textMuted, fontStyle: 'italic' }}>
          Forfait — score {forfeitGames}-{forfeitGames}, non réouvrable.
        </Text>
      )}

      {/* Un tiret suivi de rien quand `entriesCount > 0` (bye qui ne
          devrait normalement porter aucune saisie) était un tiret cadratin
          pendant — l'un ou l'autre message, jamais un tiret suivi de vide. */}
      {!teamB && (
        <Text style={{ fontSize: 10.5, color: Colors.textMuted, fontStyle: 'italic' }}>
          {entriesCount === 0 ? 'Repos ce tour — aucune action possible.' : 'Repos ce tour.'}
        </Text>
      )}
    </View>
  );
}

function TournamentManage({ tournament, myPlayerId, onBack, onChanged }: {
  tournament: Tournament;
  myPlayerId: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [t, setT] = useState<Tournament>(tournament);
  const [regs, setRegs] = useState<TournamentRegistration[]>([]);
  const [teams, setTeams] = useState<TournamentTeam[]>([]);
  const [roundMatches, setRoundMatches] = useState<TournamentMatch[]>([]);
  const [allMatches, setAllMatches] = useState<TournamentMatch[]>([]);
  const [movements, setMovements] = useState<TournamentMovement[]>([]);
  const [entries, setEntries] = useState<TournamentMatchEntry[]>([]);
  const [standings, setStandings] = useState<TournamentStanding[]>([]);
  // Distinct d'un classement provisoire simplement VIDE — même motif que
  // `standingsError` d'app/tournaments/[id].tsx : avant cette correction,
  // `setStandings(stRes.ok ? ... : [])` avalait un refus en silence, CONTRE
  // l'en-tête explicite de `fetchStandings` qui l'interdit (défaut n°4 de la
  // relecture) — l'organisateur pouvait alors valider un classement vide,
  // à l'aveugle.
  const [standingsError, setStandingsError] = useState<string | null>(null);
  // Le classement FIGÉ (tournament_results) d'un tournoi TERMINE/CLASSEMENT_VALIDE
  // — jamais `standings` (tournament_standings, vivant) pour ces deux
  // statuts-là : les deux peuvent donner un rang différent (défaut n°3).
  const [finalResults, setFinalResults] = useState<TournamentResultTeamRow[]>([]);
  const [finalResultsError, setFinalResultsError] = useState<string | null>(null);
  // L'enjeu de LA rotation de classement (`stakes`), capturé UNIQUEMENT au
  // moment où `tournament_final_round` répond — aucune table ni RPC ne le
  // réexpose ensuite (cf. l'en-tête de `generateFinalTournamentRound`,
  // lib/tournaments.ts). Se perd donc si cet écran est quitté puis rouvert :
  // limite connue, pas un oubli.
  const [finalStakes, setFinalStakes] = useState<TournamentStake[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const isOrganizer = t.created_by === myPlayerId;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [freshT, r, tm] = await Promise.all([
        fetchTournament(tournament.id),
        fetchRegistrations(tournament.id),
        fetchTeams(tournament.id),
      ]);
      const current = freshT ?? tournament;
      setT(current);
      setRegs(r);
      setTeams(tm);

      if (current.current_round > 0) {
        // Isolé : un échec ici ne doit pas empêcher `finalResults` d'être
        // tenté juste après (même raisonnement que app/tournaments/[id].tsx).
        try {
          const [rm, mv, allM] = await Promise.all([
            fetchRoundMatches(tournament.id, current.current_round),
            fetchRoundMovements(tournament.id, current.current_round),
            fetchTournamentMatches(tournament.id),
          ]);
          setRoundMatches(rm);
          setMovements(mv);
          setAllMatches(allM);
          setEntries(await fetchMatchEntries(rm.map(m => m.id)));

          if (current.status === 'EN_COURS') {
            const stRes = await fetchStandings(tournament.id);
            if (stRes.ok) {
              setStandings((stRes.standings as TournamentStanding[] | undefined) ?? []);
              setStandingsError(null);
            } else {
              setStandings([]);
              setStandingsError(resultMessage(stRes));
            }
          } else {
            setStandings([]); setStandingsError(null);
          }
        } catch (e) {
          console.warn('[tournois] tableau/classement provisoire indisponibles', e);
          setStandingsError(GENERIC_REASON);
        }
      } else {
        setRoundMatches([]); setMovements([]); setAllMatches([]); setEntries([]); setStandings([]); setStandingsError(null);
      }

      // Le classement FIGÉ — dès TERMINE, avant même la validation (les rangs
      // existent déjà à la clôture, seuls les points ne comptent pas encore).
      if (current.status === 'TERMINE' || current.status === 'CLASSEMENT_VALIDE') {
        try {
          setFinalResults(await fetchTournamentResults(tournament.id));
          setFinalResultsError(null);
        } catch (e) {
          console.warn('[tournois] classement final indisponible', e);
          setFinalResultsError(GENERIC_REASON);
        }
      } else {
        setFinalResults([]); setFinalResultsError(null);
      }
    } catch {
      Alert.alert('Erreur', 'Chargement du tournoi impossible.');
    }
    setLoading(false);
    // Volontairement []: `tournament.id` est stable pour la durée de vie de cet écran.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);

  const runAction = useCallback(async (
    key: string, fn: () => Promise<TournamentResult>, successMessage?: (res: TournamentResult) => string,
    /** Effet de bord sur un succès, AVANT `load()` — pour capturer une donnée
     *  que la réponse porte mais qu'aucune relecture ne peut reconstituer
     *  (`stakes` de `tournament_final_round`, Task 12). */
    onOk?: (res: TournamentResult) => void,
  ) => {
    setBusy(key);
    try {
      const res = await fn();
      if (isFeatureDisabled(res)) { Alert.alert('Indisponible', resultMessage(res)); return; }
      if (!res.ok) {
        if (res.reason === 'round_incomplete') {
          const missing = (res.missing as TournamentMissingMatch[] | undefined) ?? [];
          const lines = missing.map(missingMatchLabel).join('\n');
          Alert.alert('Rotation incomplète', `${resultMessage(res)}\n\n${lines || 'Aucun détail disponible.'}`);
        } else {
          Alert.alert('Impossible', resultMessage(res));
        }
        return;
      }
      onOk?.(res);
      if (successMessage) Alert.alert('C’est fait', successMessage(res));
      await load();
      onChanged();
    } finally {
      setBusy(null);
    }
  }, [load, onChanged]);

  const handleAutopair = () => runAction('autopair', () => autopairTournament(t.id), (res) => {
    const alone = (res.left_alone as string[] | undefined) ?? [];
    const created = res.teams_created as number;
    return `Binôme(s) formé(s) : ${created}.` + (alone.length > 0 ? ' Un joueur reste seul — renvoyé en tête de liste d’attente.' : '');
  });

  const handleStart = () => Alert.alert(
    'Démarrer le tournoi ?',
    'Cela fige la composition des binômes et le nombre de terrains réellement en jeu. Le pointage n’est pas exigé : cela sert de « lancer quand même ». Le premier tour se tire ensuite séparément.',
    [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Démarrer', style: 'destructive', onPress: () => runAction('start', () => startTournament(t.id)) },
    ],
  );

  const handleGenerateRound = () => {
    const isFinal = nextRoundIsFinal(t.current_round, t.round_count);
    if (!isFinal) setFinalStakes(null); // une rotation ordinaire n'a pas d'enjeu à afficher
    runAction(
      'round',
      () => isFinal ? generateFinalTournamentRound(t.id) : generateTournamentRound(t.id),
      (res) => isFinal
        ? `Rotation de classement lancée (tour ${res.round}). L’enjeu de chaque terrain est affiché ci-dessous — dis-le aux joueurs, il ne sera plus visible si tu quittes cet écran.`
        : `Rotation ${res.round} lancée : ${res.matches} match(s), ${res.byes} repos.`,
      // `stakes` n'existe QUE dans CETTE réponse (cf. l'en-tête de
      // `generateFinalTournamentRound`) : rien à relire ensuite, donc capturé
      // ici, avant que `load()` ne rafraîchisse le reste (défaut n°2 de la
      // relecture — l'enjeu de la dernière rotation ne s'affichait NULLE PART).
      (res) => { if (isFinal) setFinalStakes((res.stakes as TournamentStake[] | undefined) ?? []); },
    );
  };

  const handleResolveDispute = (matchId: string, gamesA: number, gamesB: number) =>
    runAction(`resolve-${matchId}`, () => resolveTournamentDispute(matchId, gamesA, gamesB));

  const handleForfeit = (teamId: string, teamLabel: string) => Alert.alert(
    'Déclarer forfait — irréversible',
    `${teamLabel} sort du tournoi. Aucun moyen de revenir en arrière ensuite : ses matchs non encore acquis seront soldés ${t.forfeit_games}-${t.forfeit_games} en faveur de l’adversaire, qui monte automatiquement.`,
    [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Déclarer forfait', style: 'destructive', onPress: () => runAction('forfeit', () => forfeitTournamentTeam(t.id, teamId)) },
    ],
  );

  const handleReopen = (match: TournamentMatch, laterCount: number) => {
    // ⚠️ La borne haute annoncée est `t.current_round` (le DERNIER TOUR
    // RÉELLEMENT TIRÉ), jamais `t.round_count` (le nombre de rotations
    // PRÉVUES) : entre les deux, des tours n'existent tout simplement pas
    // encore, et les annoncer comme « supprimés » serait un mensonge par
    // exagération — `laterCount`, lui, reste le compte exact.
    const msg = laterCount > 0
      ? `Cela supprime ${laterCount} match${laterCount > 1 ? 's' : ''} des rotations déjà tirées après ce tour (tour ${match.round_no + 1} à ${t.current_round}) et leurs saisies, et ramène la soirée au tour ${match.round_no}. Action irréversible.`
      : 'Aucune rotation postérieure n’existe encore : seul ce match sera rouvert. Action irréversible.';
    Alert.alert('Rouvrir ce score ?', msg, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Rouvrir', style: 'destructive', onPress: () => runAction('reopen', () => reopenTournamentMatch(match.id)) },
    ]);
  };

  const handleClose = () => Alert.alert(
    'Clôturer le tournoi ?',
    'Fige le classement (rang, statistiques, points) au dernier tour complet et passe le tournoi en Terminé. Les points ne compteront qu’après validation.',
    [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Clôturer', style: 'destructive', onPress: () => runAction('close', () => closeTournament(t.id)) },
    ],
  );

  const handleValidate = () => Alert.alert(
    'Valider le classement ?',
    'Dernier geste : les points sont crédités et le tournoi entre dans « Mon parcours » de chaque joueur. Pour corriger un score après coup, il faudra rouvrir un match puis re-clôturer.',
    [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Valider', style: 'destructive', onPress: () => runAction('validate', () => validateTournament(t.id)) },
    ],
  );

  // `displayName` (lib/players.ts), pas `.player?.name` brut : même règle que
  // les écrans joueur (app/tournaments/[id].tsx) — un compte supprimé
  // s'affichait autrement ici (« ? ») que là-bas (« Joueur »), deux vérités
  // pour le même compte (relecture de branche, Task 12).
  const namesOf = (p1: string, p2: string): [string, string] => [
    displayName(regs.find(r => r.player_id === p1)?.player, 'player'),
    displayName(regs.find(r => r.player_id === p2)?.player, 'player'),
  ];
  const teamById = new Map(teams.map(tm => [tm.id, tm]));
  const movementByTeam = new Map(movements.map(m => [m.team_id, m.movement]));
  const entriesByMatch = new Map<string, TournamentMatchEntry[]>();
  for (const e of entries) {
    const arr = entriesByMatch.get(e.match_id) ?? [];
    arr.push(e);
    entriesByMatch.set(e.match_id, arr);
  }

  const standingRows: StandingRowData[] = standings.map(s => ({
    standing: s,
    names: namesOf(s.player1_id, s.player2_id),
    movement: movementByTeam.get(s.team_id) ?? null,
  }));

  // Le classement FIGÉ (tournament_results) — jamais `standingRows`
  // (tournament_standings, vivant) pour TERMINE/CLASSEMENT_VALIDE.
  const finalStandingRows: FinalStandingRowData[] = groupResultsByTeam(finalResults).map(r => ({
    ...r,
    names: namesOf(r.player_ids[0], r.player_ids[1]),
  }));

  // L'enjeu de chaque terrain à LA rotation de classement — traduit par
  // `stakeLabel`, jamais recalculé.
  const stakeByMatch = new Map((finalStakes ?? []).map(s => [s.match_id, stakeLabel(s)]));

  // `soloRegistrations` (lib/tournaments.ts) répond « cherche un partenaire »
  // pour un inscrit ASSIS comme pour un inscrit en LISTE D'ATTENTE — vrai en
  // soi, mais `tournament_autopair` (en-tête) N'APPARIE JAMAIS la liste
  // d'attente. Séparer les deux évite qu'un chiffre unique, affiché juste
  // au-dessus du bouton « Apparier », laisse croire qu'il les couvre tous.
  const solo = soloRegistrations(regs, teams);
  const soloSeatedCount = solo.filter(r => r.waitlist_position == null).length;
  const soloWaitlistedCount = solo.filter(r => r.waitlist_position != null).length;

  // Les binômes qu'un forfait peut encore toucher : assis (l'invariant de
  // lecture de `tournament_teams`, porté par `seatedTeams`) et pas déjà
  // partis. `tournament_forfeit` (en-tête) n'exige RIEN d'autre — ni un match
  // ce tour-ci, ni même qu'une rotation ait été tirée — donc cette liste ne
  // dépend d'AUCUN état de match, contrairement au tableau du tour courant.
  const activeTeams = seatedTeams(teams, regs).filter(tm => !tm.withdrawn);

  if (loading) return <ActivityIndicator color={Colors.brand} style={{ marginTop: 40 }} />;

  return (
    <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 20 }}>
      <TouchableOpacity onPress={onBack}>
        <Text style={{ fontSize: 13, fontWeight: '900', color: Colors.brand }}>‹ Tous les tournois</Text>
      </TouchableOpacity>

      <View style={sty.orgCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>
            {t.name}
          </Text>
          {/* Couleur SOURCE UNIQUE (`statusTone`) — même couleur ici, sur la
              carte de liste et sur la fiche joueur. */}
          <Pill variant={statusTone(t.status)}>
            {statusLabel(t.status)}
          </Pill>
        </View>
        <Text style={{ fontSize: 12, color: Colors.textSecondary, fontWeight: '700' }}>
          {formatTournamentDate(t.starts_at)} · {t.club?.name ?? 'Club à confirmer'}
        </Text>
        <Text style={{ fontSize: 12, color: Colors.textMuted, fontWeight: '600' }}>
          {formatLabel(t.court_count, t.round_count)} · {levelRangeLabel(t.level_min, t.level_max)} · {priceLabel(t.price_mad)}
        </Text>
        {!isOrganizer && (
          <View style={{ marginTop: 4, backgroundColor: 'rgba(239,68,68,0.10)', borderRadius: 10, padding: 8, borderWidth: 1, borderColor: 'rgba(239,68,68,0.30)' }}>
            <Text style={{ fontSize: 11, color: Colors.danger, fontWeight: '700' }}>
              Tu n’es pas l’organisateur de ce tournoi : chaque action ci-dessous te serait refusée par le serveur
              (« Seul l’organisateur peut faire ça »). Elles sont donc masquées.
            </Text>
          </View>
        )}
      </View>

      {/* ── Check-in & appariement ── */}
      {TOURNAMENT_PRE_START.includes(t.status) && (
        <View style={sty.orgCard}>
          <Text style={sty.orgCardTitle}>Check-in & appariement</Text>
          <Text style={sty.orgCardDesc}>
            {seatsTaken(regs)} joueur(s) sur {seatCount(t.court_count)} places · {waitlistCount(regs)} en liste d’attente.{'\n'}
            {soloSeatedCount} joueur(s) assis {soloSeatedCount > 1 ? 'cherchent' : 'cherche'} encore un partenaire — c’est ce que « Apparier les joueurs seuls » couvrira.
            {soloWaitlistedCount > 0 ? ` ${soloWaitlistedCount} de plus en liste d’attente : l’appariement automatique ne les concerne jamais.` : ''}
          </Text>

          <View style={{ gap: 6 }}>
            {regs.map(r => {
              const paired = teams.some(tm => tm.player1_id === r.player_id || tm.player2_id === r.player_id);
              // Geste organisateur (`tournament_mark_no_show`, signature
              // GELÉE) : n'a de sens que pendant la fenêtre de pointage, et
              // seulement s'il reste quelque chose à marquer (pas déjà
              // « Absent »). Sans lui, les pastilles restaient TOUTES « En
              // attente » à jamais, faute d'un chemin pour les faire bouger
              // (défaut n°1 de la relecture).
              const canMarkNoShow = isOrganizer && acceptsCheckIn(t.status) && r.check_in_status !== 'no_show';
              return (
                <View key={r.player_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Text numberOfLines={1} style={{ flex: 1, minWidth: 80, fontSize: 12, fontWeight: '700', color: Colors.textPrimary }}>
                    {displayName(r.player, 'player')}
                  </Text>
                  {r.waitlist_position != null && <Pill variant="warning">File #{r.waitlist_position}</Pill>}
                  {!paired && <Pill variant="neutral">Seul</Pill>}
                  <Pill variant={r.check_in_status === 'checked_in' ? 'success' : r.check_in_status === 'no_show' ? 'danger' : 'neutral'}>
                    {r.check_in_status === 'checked_in' ? 'Présent' : r.check_in_status === 'no_show' ? 'Absent' : 'En attente'}
                  </Pill>
                  {canMarkNoShow && (
                    <TouchableOpacity
                      disabled={!!busy}
                      onPress={() => runAction(`noshow-${r.player_id}`, () => markNoShow(t.id, r.player_id))}
                      style={sty.btnCancel}
                    >
                      {busy === `noshow-${r.player_id}`
                        ? <ActivityIndicator color={Colors.danger} size="small" />
                        : <Text style={{ fontSize: 10.5, fontWeight: '700', color: Colors.danger }}>Marquer absent</Text>}
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
            {regs.length === 0 && <Text style={sty.orgCardDesc}>Aucune inscription pour l’instant.</Text>}
          </View>

          {isOrganizer && (
            <View style={{ gap: 8, marginTop: 6 }}>
              {/* Ouvre CHECK_IN — facultatif (Démarrer accepte de lancer sans
                  passer par ici), mais SANS ce bouton, CHECK_IN et PRET
                  étaient inatteignables depuis l'app : le bouton « Je suis
                  là » du joueur (fiche) ne s'affichait donc jamais (défaut
                  n°1 de la relecture). */}
              {canOpenCheckIn(t.status) && (
                <TouchableOpacity
                  onPress={() => runAction('opencheckin', () => openCheckIn(t.id))}
                  disabled={busy === 'opencheckin'} style={sty.btnOutline}
                >
                  {busy === 'opencheckin'
                    ? <ActivityIndicator color={Colors.textPrimary} size="small" />
                    : <Text style={sty.btnOutlineText}>Ouvrir le pointage</Text>}
                </TouchableOpacity>
              )}
              {TOURNAMENT_AUTOPAIR_OK.includes(t.status) ? (
                <TouchableOpacity onPress={handleAutopair} disabled={busy === 'autopair'} style={sty.btnOutline}>
                  {busy === 'autopair'
                    ? <ActivityIndicator color={Colors.textPrimary} size="small" />
                    : <Text style={sty.btnOutlineText}>Apparier les joueurs seuls</Text>}
                </TouchableOpacity>
              ) : (
                <Text style={sty.orgCardDesc}>
                  L’appariement automatique demande un tournoi complet (ou déjà au pointage) — indisponible tant que
                  des inscriptions sont encore ouvertes.
                </Text>
              )}
              <TouchableOpacity onPress={handleStart} disabled={busy === 'start'} style={sty.btnValidate}>
                {busy === 'start'
                  ? <ActivityIndicator color={Colors.textOnDark} size="small" />
                  : <Text style={{ color: Colors.textOnDark, fontWeight: '900', fontSize: 13, fontFamily: Fonts.uiBlack }}>Démarrer le tournoi</Text>}
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* ── Conduire ── */}
      {t.status === 'EN_COURS' && (
        <View style={sty.orgCard}>
          <Text style={sty.orgCardTitle}>Conduire — tour {t.current_round || '–'} / {t.round_count}</Text>

          {t.current_round === 0 ? (
            <Text style={sty.orgCardDesc}>Aucune rotation tirée pour l’instant.</Text>
          ) : roundMatches.length === 0 ? (
            <Text style={sty.orgCardDesc}>Aucun match pour ce tour.</Text>
          ) : (
            <View style={{ gap: 10 }}>
              {roundMatches.map(m => {
                const teamAInfo = teamById.get(m.team_a);
                const teamBInfo = m.team_b ? teamById.get(m.team_b) : null;
                if (!teamAInfo) return null;
                const teamAData: CourtTeamInfo = { id: teamAInfo.id, names: namesOf(teamAInfo.player1_id, teamAInfo.player2_id), movement: movementByTeam.get(teamAInfo.id) ?? null };
                const teamBData: CourtTeamInfo | null = teamBInfo
                  ? { id: teamBInfo.id, names: namesOf(teamBInfo.player1_id, teamBInfo.player2_id), movement: movementByTeam.get(teamBInfo.id) ?? null }
                  : null;
                const entriesForMatch = entriesByMatch.get(m.id) ?? [];
                const teamAEntries = entriesForMatch.filter(e => teamAInfo.player1_id === e.player_id || teamAInfo.player2_id === e.player_id);
                const teamBEntries = entriesForMatch.filter(e => !!teamBInfo && (teamBInfo.player1_id === e.player_id || teamBInfo.player2_id === e.player_id));
                const status = matchLiveStatus(m.team_b != null, m.forfeited_team, m.confirmed_at, teamAEntries, teamBEntries);
                return (
                  <AdminMatchCard
                    key={m.id}
                    match={m} teamA={teamAData} teamB={teamBData} status={status}
                    entriesCount={entriesForMatch.length}
                    isOrganizer={isOrganizer} busy={!!busy}
                    laterCount={countLaterRoundMatches(allMatches, m.round_no)}
                    forfeitGames={t.forfeit_games}
                    stakeText={stakeByMatch.get(m.id)}
                    onResolve={handleResolveDispute} onReopen={handleReopen}
                  />
                );
              })}
            </View>
          )}

          {isOrganizer && (
            <View style={{ gap: 8, marginTop: 6 }}>
              {t.current_round < t.round_count ? (
                <TouchableOpacity onPress={handleGenerateRound} disabled={busy === 'round'} style={sty.btnValidate}>
                  {busy === 'round'
                    ? <ActivityIndicator color={Colors.textOnDark} size="small" />
                    : (
                      <Text style={{ color: Colors.textOnDark, fontWeight: '900', fontSize: 13, fontFamily: Fonts.uiBlack }}>
                        {nextRoundIsFinal(t.current_round, t.round_count) ? 'Lancer la rotation de classement' : 'Générer la rotation suivante'}
                      </Text>
                    )}
                </TouchableOpacity>
              ) : (
                <Text style={sty.orgCardDesc}>Toutes les rotations ont été tirées.</Text>
              )}
              <TouchableOpacity onPress={handleClose} disabled={busy === 'close' || t.current_round < 1} style={[sty.btnCancel, { opacity: t.current_round < 1 ? 0.4 : 1 }]}>
                <Text style={{ color: Colors.danger, fontWeight: '700', fontSize: 13 }}>Clôturer le tournoi</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Un refus (réseau, `feature_disabled`…) NE S'AVALE PLUS en liste
              vide — avant cette correction, un classement provisoire
              indisponible se lisait « aucun match acquis », silencieux,
              alors même que la carte de validation qui suit s'appuie
              maintenant sur `tournament_results` (jamais sur ceci). */}
          {standingRows.length > 0 ? (
            <View style={{ gap: 8, marginTop: 8 }}>
              <Text style={sty.orgCardTitle}>Classement provisoire</Text>
              <StandingsTable rows={standingRows} />
            </View>
          ) : standingsError ? (
            <Text style={[sty.orgCardDesc, { color: Colors.danger, marginTop: 8 }]}>{standingsError}</Text>
          ) : null}

          {/* Forfait — PAR BINÔME, pas par ligne de match : `tournament_forfeit`
              (en-tête) n'exige qu'un tournoi EN_COURS et un binôme assis, non
              retiré — ni un match ce tour-ci, ni même une rotation déjà
              tirée. Cette liste doit donc rester joignable même à
              `current_round === 0` et pour un binôme au repos (`!teamB`
              dans le tableau ci-dessus), qu'aucune ligne de match ne
              représente. */}
          {isOrganizer && activeTeams.length > 0 && (
            <View style={{ gap: 8, marginTop: 10 }}>
              <Text style={sty.orgCardTitle}>Forfait d’un binôme</Text>
              <Text style={sty.orgCardDesc}>
                Sort le binôme du tournoi immédiatement — qu’il ait un match ce tour-ci, qu’il soit au repos, ou
                qu’aucune rotation n’ait encore été tirée.
              </Text>
              <View style={{ gap: 6 }}>
                {activeTeams.map(tm => {
                  const label = namesOf(tm.player1_id, tm.player2_id).join(' · ');
                  return (
                    <View key={tm.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, fontWeight: '700', color: Colors.textPrimary }}>
                        {label}
                      </Text>
                      <TouchableOpacity onPress={() => handleForfeit(tm.id, label)} disabled={!!busy} style={sty.btnCancel}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.danger }}>Forfait</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            </View>
          )}
        </View>
      )}

      {/* ── Rouvrir après clôture ── Le serveur accepte `tournament_reopen_match`
          en TERMINE (en-tête : refuse seulement CLASSEMENT_VALIDE et les
          matchs non confirmés/forfait) ; le dialogue de validation, plus bas,
          PROMET en toutes lettres « il faudra rouvrir un match puis
          re-clôturer ». Avant cette correction, le client ne l'offrait qu'en
          EN_COURS : un score faux découvert après la clôture n'avait AUCUN
          chemin de réparation (défaut n°5 de la relecture). Les matchs du
          DERNIER tour joué (`roundMatches`, déjà chargés par `load()`) sont
          les seuls concernés : les tours antérieurs ne sont jamais montrés
          ici, comme en EN_COURS. */}
      {t.status === 'TERMINE' && roundMatches.length > 0 && (
        <View style={sty.orgCard}>
          <Text style={sty.orgCardTitle}>Corriger un score — tour {t.current_round}</Text>
          <Text style={sty.orgCardDesc}>
            Rouvrir un score détruit les rotations tirées après ce tour, s’il y en a. Aucune ici : c’est le dernier
            tour joué.
          </Text>
          <View style={{ gap: 10 }}>
            {roundMatches.map(m => {
              const teamAInfo = teamById.get(m.team_a);
              const teamBInfo = m.team_b ? teamById.get(m.team_b) : null;
              if (!teamAInfo) return null;
              const teamAData: CourtTeamInfo = { id: teamAInfo.id, names: namesOf(teamAInfo.player1_id, teamAInfo.player2_id), movement: null };
              const teamBData: CourtTeamInfo | null = teamBInfo
                ? { id: teamBInfo.id, names: namesOf(teamBInfo.player1_id, teamBInfo.player2_id), movement: null }
                : null;
              const entriesForMatch = entriesByMatch.get(m.id) ?? [];
              const teamAEntries = entriesForMatch.filter(e => teamAInfo.player1_id === e.player_id || teamAInfo.player2_id === e.player_id);
              const teamBEntries = entriesForMatch.filter(e => !!teamBInfo && (teamBInfo.player1_id === e.player_id || teamBInfo.player2_id === e.player_id));
              const status = matchLiveStatus(m.team_b != null, m.forfeited_team, m.confirmed_at, teamAEntries, teamBEntries);
              return (
                <AdminMatchCard
                  key={m.id}
                  match={m} teamA={teamAData} teamB={teamBData} status={status}
                  entriesCount={entriesForMatch.length}
                  isOrganizer={isOrganizer} busy={!!busy}
                  laterCount={countLaterRoundMatches(allMatches, m.round_no)}
                  forfeitGames={t.forfeit_games}
                  onResolve={handleResolveDispute} onReopen={handleReopen}
                />
              );
            })}
          </View>
        </View>
      )}

      {/* ── Validation ── */}
      {t.status === 'TERMINE' && (
        <View style={sty.orgCard}>
          <Text style={sty.orgCardTitle}>Validation du classement</Text>
          <Text style={sty.orgCardDesc}>
            Le tournoi est clos. Les points ne comptent pas encore : ils seront crédités, et le tournoi entrera dans
            « Mon parcours » de chaque joueur, seulement après validation.
          </Text>
          {/* Classement FIGÉ (tournament_results) — celui qui sera CRÉDITÉ,
              jamais le vivant. Un refus n'est plus avalé en liste vide : sans
              classement lisible, « Valider » se désactive plutôt que de
              laisser l'organisateur créditer les joueurs à l'aveugle
              (défaut n°4, dernier point de la relecture). */}
          {finalStandingRows.length > 0 ? (
            <FinalStandings rows={finalStandingRows} validated={false} />
          ) : finalResultsError ? (
            <Text style={[sty.orgCardDesc, { color: Colors.danger }]}>{finalResultsError}</Text>
          ) : null}
          {isOrganizer && (
            <TouchableOpacity
              onPress={handleValidate}
              disabled={busy === 'validate' || finalStandingRows.length === 0}
              style={[sty.btnValidate, { opacity: finalStandingRows.length === 0 ? 0.4 : 1 }]}
            >
              {busy === 'validate'
                ? <ActivityIndicator color={Colors.textOnDark} size="small" />
                : <Text style={{ color: Colors.textOnDark, fontWeight: '900', fontSize: 13, fontFamily: Fonts.uiBlack }}>Valider le classement</Text>}
            </TouchableOpacity>
          )}
          {finalStandingRows.length === 0 && (
            <Text style={sty.orgCardDesc}>
              Classement indisponible pour l’instant : valider maintenant créditerait des points à l’aveugle. Réessaie
              une fois le classement affiché.
            </Text>
          )}
        </View>
      )}

      {t.status === 'CLASSEMENT_VALIDE' && (
        <View style={sty.orgCard}>
          <Text style={sty.orgCardTitle}>Classement validé</Text>
          <Text style={sty.orgCardDesc}>
            Les points sont crédités et ce tournoi figure dans « Mon parcours » de chaque joueur.
          </Text>
          {finalStandingRows.length > 0 ? (
            <FinalStandings rows={finalStandingRows} validated={true} />
          ) : finalResultsError ? (
            <Text style={[sty.orgCardDesc, { color: Colors.danger }]}>{finalResultsError}</Text>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

const sty = StyleSheet.create({
  emptyCard: {
    backgroundColor: Colors.bgCard, borderRadius: 20, borderWidth: 1, borderColor: Colors.border,
    padding: 40, alignItems: 'center',
  },
  disputeCard: {
    backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1.5, borderColor: '#ef444430',
    padding: 16, overflow: 'hidden',
  },
  disputeTag: {
    position: 'absolute', top: 0, right: 0, backgroundColor: Colors.danger,
    paddingHorizontal: 10, paddingVertical: 4, borderBottomLeftRadius: 10,
  },
  disputeTagText: { fontSize: 9, fontWeight: '900', color: Colors.textOnDark, textTransform: 'uppercase', letterSpacing: 1 },
  counterBox: {
    backgroundColor: Colors.bg, borderRadius: 12, borderWidth: 1, borderColor: '#f59e0b30',
    padding: 10, marginBottom: 10,
  },
  matchTitle: { fontSize: 16, fontWeight: '900', fontFamily: Fonts.uiBlack },
  fieldLabel: { fontSize: 10, fontWeight: '900', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  scoreInput: {
    backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 11, color: Colors.textPrimary, fontSize: 15, fontWeight: '900',
    fontFamily: Fonts.uiBlack,
  },
  simCard: {
    backgroundColor: Colors.bg, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 12,
  },
  simLabel: { fontSize: 10, fontWeight: '900', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  simBadge: {
    backgroundColor: 'rgba(255,193,26,0.18)', borderWidth: 1, borderColor: 'rgba(255,193,26,0.40)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  simBadgeText: { fontSize: 11, fontWeight: '900', color: Colors.brand, fontFamily: Fonts.uiBlack },
  simRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.bgCard, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 6, gap: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  btnValidate: {
    flex: 1, backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center',
  },
  btnCancel: {
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1.5, borderColor: '#ef444450', alignItems: 'center', justifyContent: 'center',
  },
  statBox: {
    flex: 1, backgroundColor: Colors.bgCard, borderRadius: 14, padding: 12, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border, gap: 2,
  },
  scrapeBtn: {
    backgroundColor: Colors.brand, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11,
    alignItems: 'center', justifyContent: 'center', minWidth: 150,
  },
  scrapeBtnText: { fontSize: 13, fontWeight: '900', color: Colors.textOnBrand, fontFamily: Fonts.uiBlack },
  refreshBtn: {
    backgroundColor: Colors.bgCard, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
  },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.bgCard, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8,
  },
  chip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
  },
  chipActive: { backgroundColor: Colors.primary },
  chipText: { fontSize: 11, fontWeight: '900', color: Colors.textSecondary, fontFamily: Fonts.uiBlack },
  chipTextActive: { color: Colors.textOnDark },
  frmtRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.bgCard, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: Colors.border,
  },
  gameRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.bgCard, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border,
  },
  btnDelete: {
    backgroundColor: '#ef444415', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
    borderWidth: 1, borderColor: '#ef444440',
  },
  // ── Tournois (Task 10) ──
  orgCard: {
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 16, padding: 16, gap: 10,
  },
  orgCardTitle: { fontSize: 14, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary },
  orgCardDesc: { fontSize: 12, color: Colors.textMuted, lineHeight: 17 },
  btnBrand: {
    backgroundColor: Colors.brand, borderRadius: 14, paddingVertical: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  btnBrandText: { color: Colors.textOnBrand, fontSize: 14, fontWeight: '900', fontFamily: Fonts.uiBlack },
  btnOutline: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9, backgroundColor: Colors.bgCard,
    alignItems: 'center', justifyContent: 'center',
  },
  btnOutlineText: { fontSize: 11, fontWeight: '900', color: Colors.textPrimary, fontFamily: Fonts.uiBlack },
  smallScoreInput: {
    width: 52, textAlign: 'center', backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10, paddingVertical: 8, fontSize: 16, fontFamily: Fonts.uiBlack, color: Colors.textPrimary,
  },
  matchCard: {
    backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: Colors.border,
    padding: 12, gap: 8,
  },
});
