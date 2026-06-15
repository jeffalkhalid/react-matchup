import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, FlatList, Modal, StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../hooks/usePlayer';
import { supabase } from '../../lib/supabase';
import {
  simulateElo,
  type EloSimResult,
} from '../../lib/elo';
import { Colors, Fonts, eloToLevel } from '../../lib/theme';
import { formatFrmtRanking } from '../../lib/frmt-match';

type AdminTab = 'disputes' | 'frmt' | 'games' | 'gender' | 'reports' | 'players';

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
          <Text style={{ fontSize: 13, flex: 1, fontWeight: '700', color: Colors.textOnDark }} numberOfLines={1}>
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
            <Text style={{ fontSize: 12, color: Colors.textOnDark, fontWeight: '900' }}>{p.newElo}</Text>
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
                  <Text style={{ fontSize: 12, color: Colors.textOnDark, fontWeight: '900' }}>{match.counter_score_text}</Text>
                </View>
                {match.counter_reason && (
                  <Text style={{ fontSize: 11, color: Colors.textMuted, fontStyle: 'italic' }}>"{match.counter_reason}"</Text>
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
  onUnlink: (playerId: string) => void | Promise<void>;
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
          { label: 'Inscrits', value: players.length, color: Colors.textOnDark },
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
          <Text style={{ fontSize: 13, color: Colors.textSecondary }}>🔍</Text>
          <TextInput
            value={search}
            onChangeText={v => { setSearch(v); setPage(1); }}
            placeholder="Rechercher un joueur…"
            placeholderTextColor={Colors.textSecondary}
            style={{ flex: 1, fontSize: 13, color: Colors.textOnDark, fontWeight: '600' }}
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
                  <Text style={{ fontSize: 14, fontWeight: '900', color: Colors.textOnDark, fontFamily: Fonts.uiBlack, flexShrink: 1 }} numberOfLines={1}>{p.name}</Text>
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
                  Dernier match : <Text style={{ color: p.last_match_at ? Colors.textOnDark : Colors.textSecondary, fontWeight: '900' }}>{lastMatchStr}</Text>
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
                      <TouchableOpacity onPress={() => onUnlink(p.id)} style={sty.chip}>
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
function FrmtTab({ entries, allPlayers, loading, onLink, onUnlink, onRefresh }: {
  entries: any[];
  allPlayers: any[];
  loading: boolean;
  onLink: (entryId: string, entry: any, playerId: string) => Promise<void>;
  onUnlink: (entryId: string) => Promise<void>;
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
          <Text style={{ fontSize: 12, fontWeight: '900', color: Colors.textOnDark, fontFamily: Fonts.uiBlack }}>{lastScrapeLabel}</Text>
        </View>
        <TouchableOpacity onPress={() => onRefresh()} style={sty.refreshBtn}>
          <Text style={{ fontSize: 16 }}>⟳</Text>
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
        {[
          { label: 'Total', value: entries.length, color: Colors.textOnDark },
          { label: 'Liés', value: linkedCount, color: Colors.success },
          { label: 'Non liés', value: entries.length - linkedCount, color: Colors.textSecondary },
        ].map(s => (
          <View key={s.label} style={sty.statBox}>
            <Text style={{ fontSize: 20, fontWeight: '900', color: s.color, fontFamily: Fonts.uiBlack }}>{s.value}</Text>
            <Text style={{ fontSize: 9, fontWeight: '900', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8, fontFamily: Fonts.uiBlack }}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Search */}
      <View style={sty.searchRow}>
        <Text style={{ fontSize: 13, color: Colors.textSecondary }}>🔍</Text>
        <TextInput
          value={search}
          onChangeText={v => { setSearch(v); setPage(1); }}
          placeholder="Rechercher un joueur FRMT…"
          placeholderTextColor={Colors.textSecondary}
          style={{ flex: 1, fontSize: 13, color: Colors.textOnDark, fontWeight: '600' }}
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
                <Text style={{ fontSize: 13, fontWeight: '900', color: Colors.textOnDark, flex: 1 }} numberOfLines={1}>{entry.frmt_name}</Text>
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
                <TouchableOpacity onPress={() => onUnlink(entry.id)}
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
          <View style={{ backgroundColor: Colors.bgDark, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '70%', borderWidth: 1, borderColor: '#1e293b' }}>
            <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
              <View style={{ width: 36, height: 4, backgroundColor: '#334155', borderRadius: 2 }} />
            </View>
            <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
              <Text style={{ fontSize: 14, fontWeight: '900', color: Colors.textOnDark, marginBottom: 10, fontFamily: Fonts.uiBlack }}>
                Lier à {pickerEntry?.frmt_name}
              </Text>
              <View style={[sty.searchRow, { marginBottom: 8 }]}>
                <Text style={{ fontSize: 13, color: Colors.textSecondary }}>🔍</Text>
                <TextInput
                  value={pickerSearch}
                  onChangeText={setPickerSearch}
                  placeholder="Nom du joueur…"
                  placeholderTextColor={Colors.textSecondary}
                  style={{ flex: 1, fontSize: 13, color: Colors.textOnDark }}
                  autoFocus
                />
              </View>
            </View>
            <FlatList
              data={pickerPlayers.slice(0, 50)}
              keyExtractor={p => p.id}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: '#1e293b' }} />}
              renderItem={({ item: p }) => (
                <TouchableOpacity onPress={() => handleLink(p.id)} disabled={linking}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 10 }}>
                  <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: '#1e293b', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 14, fontWeight: '900', color: Colors.brand, fontFamily: Fonts.uiBlack }}>{(p.name || '?').charAt(0).toUpperCase()}</Text>
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textOnDark, flex: 1, fontFamily: Fonts.uiBold }}>{p.name}</Text>
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
                <Text style={{ fontSize: 13, fontWeight: '900', color: Colors.textOnDark, marginBottom: 3, fontFamily: Fonts.uiBlack }} numberOfLines={1}>
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
                    backgroundColor: '#1e293b', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
                    borderWidth: 1, borderColor: '#334155',
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
    const { data: players } = await supabase.from('players').select('id,name').is('deleted_at', null).order('name');
    setFrmtEntries(allRankings);
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

  const handlePlayerUnlink = async (playerId: string) => {
    setPlayerActingId(playerId);
    const { error } = await supabase.rpc('admin_unlink_frmt_player', { p_player_id: playerId });
    setPlayerActingId(null);
    if (error) { Alert.alert('Erreur', error.message); return; }
    await loadPlayers();
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

  const handleUnlink = async (entryId: string) => {
    // RPC : délie + remet les flags FRMT du joueur (sans baisser l'ELO acquis).
    const { error } = await supabase.rpc('admin_unlink_frmt', { p_entry_id: entryId });
    if (error) { Alert.alert('Erreur', error.message); return; }
    await loadFrmt();
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
      <View style={{ flex: 1, backgroundColor: Colors.bgDark, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.brand} size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bgDark }}>
      {/* Header */}
      <View style={{ backgroundColor: Colors.bgDarkTo, paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1e293b' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <TouchableOpacity onPress={() => router.back()}
            style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#1e293b', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: Colors.textMuted, fontSize: 18 }}>‹</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 26, color: Colors.textOnDark, letterSpacing: -0.5, fontFamily: Fonts.welcome }}>Panel <Text style={{ color: Colors.brand }}>Arbitre</Text></Text>
            <Text style={{ fontSize: 11, color: Colors.textSecondary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 }}>🛡️ Administration</Text>
          </View>
          {disputes.length > 0 && (
            <View style={{ backgroundColor: Colors.danger, borderRadius: 999, minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}>
              <Text style={{ color: Colors.textOnDark, fontSize: 11, fontWeight: '900', fontFamily: Fonts.uiBlack }}>{disputes.length}</Text>
            </View>
          )}
        </View>

        {/* Tab bar */}
        <View style={{ flexDirection: 'row', backgroundColor: '#1e293b', borderRadius: 14, padding: 3, gap: 2 }}>
          {([
            { key: 'disputes' as AdminTab, label: '⚖️ Litiges',  badge: disputes.length },
            { key: 'reports'  as AdminTab, label: '🚩 Signalements', badge: reports.length },
            { key: 'gender'   as AdminTab, label: '⚧ Genre',     badge: genderReqs.length },
            { key: 'frmt'     as AdminTab, label: '🏆 FRMT',     badge: 0 },
            { key: 'players'  as AdminTab, label: '👥 Joueurs',  badge: 0 },
            { key: 'games'    as AdminTab, label: 'Parties',  badge: 0 },
          ]).map(t => {
            const active = tab === t.key;
            return (
              <TouchableOpacity key={t.key} onPress={() => setTab(t.key)} activeOpacity={0.7}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
                  backgroundColor: active ? Colors.bgCard : 'transparent', borderRadius: 11, paddingVertical: 9 }}>
                <Text style={{ fontSize: 11, fontWeight: '900', color: active ? Colors.textPrimary : Colors.textSecondary, fontFamily: Fonts.uiBlack }}>{t.label}</Text>
                {t.badge > 0 && (
                  <View style={{ backgroundColor: active ? Colors.danger : '#ef444455', borderRadius: 999, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                    <Text style={{ fontSize: 9, fontWeight: '900', color: Colors.textOnDark, fontFamily: Fonts.uiBlack }}>{t.badge}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
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
      </ScrollView>
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
        <Text style={{ fontFamily: Fonts.uiBlack, color: Colors.textOnDark, fontSize: 14, textAlign: 'center' }}>
          Aucune demande en attente
        </Text>
        <Text style={{ color: Colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 4 }}>
          Les demandes de changement de genre apparaîtront ici.
        </Text>
        <TouchableOpacity onPress={onRefresh} style={{ marginTop: 14, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: '#334155' }}>
          <Text style={{ color: Colors.textOnDark, fontSize: 12, fontWeight: '800' }}>Rafraîchir</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <View style={{ gap: 12 }}>
      {requests.map(req => (
        <View key={req.id} style={{
          backgroundColor: '#1e293b', borderRadius: 18, borderWidth: 1.5, borderColor: '#fbbf2433',
          padding: 16,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <View style={{ width: 40, height: 40, borderRadius: 999, backgroundColor: Colors.brand, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 16, fontFamily: Fonts.uiBlack, color: Colors.textOnBrand }}>
                {(req.player?.name ?? '?').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>{req.player?.name ?? '?'}</Text>
              <Text style={{ fontSize: 10, color: Colors.textMuted, marginTop: 2 }}>
                Demandé le {new Date(req.created_at).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <View style={{ flex: 1, backgroundColor: '#0f172a', borderRadius: 10, padding: 10 }}>
              <Text style={{ fontSize: 9, fontWeight: '800', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Actuel</Text>
              <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textOnDark, marginTop: 2 }}>{genderLabel(req.current_gender)}</Text>
            </View>
            <Text style={{ fontSize: 16, color: Colors.brand }}>→</Text>
            <View style={{ flex: 1, backgroundColor: 'rgba(255,193,26,0.14)', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: 'rgba(255,193,26,0.5)' }}>
              <Text style={{ fontSize: 9, fontWeight: '800', color: Colors.brandDeep, textTransform: 'uppercase', letterSpacing: 0.5 }}>Demandé</Text>
              <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.brand, marginTop: 2 }}>{genderLabel(req.requested_gender)}</Text>
            </View>
          </View>

          {req.reason ? (
            <View style={{ backgroundColor: '#0f172a', borderRadius: 10, padding: 10, marginBottom: 10 }}>
              <Text style={{ fontSize: 9, fontWeight: '800', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Raison</Text>
              <Text style={{ fontSize: 12, color: Colors.textSecondary, fontStyle: 'italic' }}>{req.reason}</Text>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              disabled={resolvingId === req.id}
              onPress={() => onReject(req)}
              style={{ flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center', backgroundColor: '#334155', opacity: resolvingId === req.id ? 0.5 : 1 }}
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
        <Text style={{ fontFamily: Fonts.uiBlack, color: Colors.textOnDark, fontSize: 14, textAlign: 'center' }}>
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
        <View key={r.id} style={{ backgroundColor: '#1e293b', borderRadius: 18, borderWidth: 1.5, borderColor: '#ef444433', padding: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>{typeLabel(r.target_type)}</Text>
            <Text style={{ fontSize: 10, color: Colors.textMuted }}>
              {new Date(r.created_at).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>

          <Text style={{ fontSize: 12, color: Colors.textSecondary, marginBottom: 4 }}>
            Signalé par <Text style={{ fontFamily: Fonts.uiBold, color: Colors.textOnDark }}>{r.reporter?.name ?? '?'}</Text>
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
            <View style={{ backgroundColor: '#0f172a', borderRadius: 10, padding: 10, marginBottom: 12 }}>
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
              style={{ flex: 1, alignItems: 'center', backgroundColor: '#334155', borderRadius: 10, paddingVertical: 10 }}>
              <Text style={{ fontSize: 12, fontWeight: '900', color: Colors.textOnDark, fontFamily: Fonts.uiBlack }}>Rejeter</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const sty = StyleSheet.create({
  emptyCard: {
    backgroundColor: '#1e293b', borderRadius: 20, borderWidth: 1, borderColor: '#334155',
    padding: 40, alignItems: 'center',
  },
  disputeCard: {
    backgroundColor: '#1e293b', borderRadius: 18, borderWidth: 1.5, borderColor: '#ef444430',
    padding: 16, overflow: 'hidden',
  },
  disputeTag: {
    position: 'absolute', top: 0, right: 0, backgroundColor: Colors.danger,
    paddingHorizontal: 10, paddingVertical: 4, borderBottomLeftRadius: 10,
  },
  disputeTagText: { fontSize: 9, fontWeight: '900', color: Colors.textOnDark, textTransform: 'uppercase', letterSpacing: 1 },
  counterBox: {
    backgroundColor: Colors.bgDark, borderRadius: 12, borderWidth: 1, borderColor: '#f59e0b30',
    padding: 10, marginBottom: 10,
  },
  matchTitle: { fontSize: 16, fontWeight: '900', fontFamily: Fonts.uiBlack },
  fieldLabel: { fontSize: 10, fontWeight: '900', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  scoreInput: {
    backgroundColor: Colors.bgDark, borderWidth: 1, borderColor: '#334155', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 11, color: Colors.textOnDark, fontSize: 15, fontWeight: '900',
    fontFamily: Fonts.uiBlack,
  },
  simCard: {
    backgroundColor: Colors.bgDark, borderRadius: 14, borderWidth: 1, borderColor: '#1e293b', padding: 12,
  },
  simLabel: { fontSize: 10, fontWeight: '900', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  simBadge: {
    backgroundColor: 'rgba(255,193,26,0.18)', borderWidth: 1, borderColor: 'rgba(255,193,26,0.40)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  simBadgeText: { fontSize: 11, fontWeight: '900', color: Colors.brand, fontFamily: Fonts.uiBlack },
  simRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1e293b', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 6, gap: 8,
  },
  btnValidate: {
    flex: 1, backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center',
  },
  btnCancel: {
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1.5, borderColor: '#ef444450', alignItems: 'center', justifyContent: 'center',
  },
  statBox: {
    flex: 1, backgroundColor: '#1e293b', borderRadius: 14, padding: 12, alignItems: 'center',
    borderWidth: 1, borderColor: '#334155', gap: 2,
  },
  scrapeBtn: {
    backgroundColor: Colors.brand, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11,
    alignItems: 'center', justifyContent: 'center', minWidth: 150,
  },
  scrapeBtnText: { fontSize: 13, fontWeight: '900', color: Colors.textOnBrand, fontFamily: Fonts.uiBlack },
  refreshBtn: {
    backgroundColor: '#1e293b', borderRadius: 12, borderWidth: 1, borderColor: '#334155',
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
  },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#1e293b', borderRadius: 12, borderWidth: 1, borderColor: '#334155',
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8,
  },
  chip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155',
  },
  chipActive: { backgroundColor: Colors.bgCard },
  chipText: { fontSize: 11, fontWeight: '900', color: Colors.textSecondary, fontFamily: Fonts.uiBlack },
  chipTextActive: { color: Colors.textPrimary },
  frmtRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#1e293b', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#334155',
  },
  gameRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#1e293b', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#334155',
  },
  btnDelete: {
    backgroundColor: '#ef444415', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
    borderWidth: 1, borderColor: '#ef444440',
  },
});
