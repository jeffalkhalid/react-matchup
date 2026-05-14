import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, FlatList, Modal, StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../hooks/usePlayer';
import { supabase } from '../lib/supabase';
import {
  simulateElo, computeEloExchange, teamElo,
  getInactivityDecay, getMarginMultiplier, getNewFiabilityPct,
  type EloSimResult,
} from '../lib/elo';
import { rankFromPoints } from '../lib/frmt-match';

type AdminTab = 'disputes' | 'frmt' | 'games';

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
      <Text style={sty.simLabel}>🔬 Simulation moteur ELO</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        <View style={sty.simBadge}>
          <Text style={sty.simBadgeText}>K = {sim.kFactor}</Text>
        </View>
        {sim.antiFarmMultiplier < 1 && (
          <View style={[sty.simBadge, { borderColor: '#f59e0b55', backgroundColor: '#f59e0b15' }]}>
            <Text style={[sty.simBadgeText, { color: '#f59e0b' }]}>Anti-farming ×{sim.antiFarmMultiplier}</Text>
          </View>
        )}
        <View style={[sty.simBadge, { borderColor: '#64748b55', backgroundColor: '#64748b15' }]}>
          <Text style={[sty.simBadgeText, { color: '#cbd5e1' }]}>Δ = ±{sim.delta} pts</Text>
        </View>
      </View>
      {sim.players.map(p => (
        <View key={p.id} style={sty.simRow}>
          <Text style={{ fontSize: 13, flex: 1, fontWeight: '700', color: '#e2e8f0' }} numberOfLines={1}>
            {p.isWinner ? '🏆' : '💔'} {p.name}
            {p.decayFactor < 1 && (
              <Text style={{ fontSize: 10, color: '#f97316' }}> (-{Math.round((1 - p.decayFactor) * 100)}% inact.)</Text>
            )}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 12, color: '#64748b', fontWeight: '700' }}>{p.oldElo}</Text>
            <Text style={{ fontSize: 10, color: '#475569' }}>→</Text>
            <Text style={{ fontSize: 12, color: '#e2e8f0', fontWeight: '900' }}>{p.newElo}</Text>
            <View style={{
              backgroundColor: p.change >= 0 ? '#05966915' : '#dc262615',
              borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
              borderWidth: 1, borderColor: p.change >= 0 ? '#05966955' : '#dc262655',
            }}>
              <Text style={{ fontSize: 11, fontWeight: '900', color: p.change >= 0 ? '#34d399' : '#f87171' }}>
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
        <Text style={{ fontSize: 15, fontWeight: '900', color: '#94a3b8', textAlign: 'center' }}>Aucun litige en cours</Text>
        <Text style={{ fontSize: 12, color: '#475569', marginTop: 4, textAlign: 'center' }}>Tout le monde est d'accord sur les terrains !</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 14 }}>
      {matches.map(match => {
        const sim: EloSimResult | null = match.winner ? simulateElo([
          { id: match.winner.id, name: match.winner.name, elo_score: match.winner.elo_score ?? 1000, win_count: match.winner.win_count ?? 0, loss_count: match.winner.loss_count ?? 0, last_match_at: match.winner.last_match_at ?? null, isWinner: true },
          ...(match.winner_2 ? [{ id: match.winner_2.id, name: match.winner_2.name, elo_score: match.winner_2.elo_score ?? 1000, win_count: match.winner_2.win_count ?? 0, loss_count: match.winner_2.loss_count ?? 0, last_match_at: match.winner_2.last_match_at ?? null, isWinner: true }] : []),
          { id: match.loser.id, name: match.loser.name, elo_score: match.loser.elo_score ?? 1000, win_count: match.loser.win_count ?? 0, loss_count: match.loser.loss_count ?? 0, last_match_at: match.loser.last_match_at ?? null, isWinner: false },
          ...(match.loser_2 ? [{ id: match.loser_2.id, name: match.loser_2.name, elo_score: match.loser_2.elo_score ?? 1000, win_count: match.loser_2.win_count ?? 0, loss_count: match.loser_2.loss_count ?? 0, last_match_at: match.loser_2.last_match_at ?? null, isWinner: false }] : []),
        ]) : null;

        return (
          <View key={match.id} style={sty.disputeCard}>
            <View style={sty.disputeTag}><Text style={sty.disputeTagText}>⚠ LITIGE</Text></View>

            <Text style={{ fontSize: 11, color: '#64748b', marginBottom: 6, fontWeight: '600' }}>
              Saisi par <Text style={{ color: '#818cf8', fontWeight: '800' }}>{match.creator?.name ?? '—'}</Text>
            </Text>

            {match.counter_score_text && (
              <View style={sty.counterBox}>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 3 }}>
                  <Text style={{ fontSize: 10, color: '#94a3b8', fontWeight: '900', textTransform: 'uppercase' }}>Initial :</Text>
                  <Text style={{ fontSize: 12, color: '#64748b', textDecorationLine: 'line-through' }}>{match.score_text}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: match.counter_reason ? 3 : 0 }}>
                  <Text style={{ fontSize: 10, color: '#f59e0b', fontWeight: '900', textTransform: 'uppercase' }}>Contesté :</Text>
                  <Text style={{ fontSize: 12, color: '#fff', fontWeight: '900' }}>{match.counter_score_text}</Text>
                </View>
                {match.counter_reason && (
                  <Text style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>"{match.counter_reason}"</Text>
                )}
              </View>
            )}

            <Text style={sty.matchTitle}>
              <Text style={{ color: '#34d399' }}>
                {match.winner?.name}{match.winner_2 ? ` & ${match.winner_2.name}` : ''}
              </Text>
              <Text style={{ color: '#475569', fontSize: 14 }}> vs </Text>
              <Text style={{ color: '#f87171' }}>
                {match.loser?.name}{match.loser_2 ? ` & ${match.loser_2.name}` : ''}
              </Text>
            </Text>

            <View style={{ marginTop: 10, marginBottom: 12 }}>
              <Text style={sty.fieldLabel}>Score final</Text>
              <TextInput
                value={editedScores[match.id] ?? ''}
                onChangeText={v => setEditedScores({ ...editedScores, [match.id]: v })}
                placeholder="6-3, 7-5"
                placeholderTextColor="#475569"
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
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ color: '#fff', fontWeight: '900', fontSize: 13 }}>⚖️ Forcer la Validation</Text>
                }
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onCancel(match.id)}
                disabled={loadingId === match.id}
                style={[sty.btnCancel, { opacity: loadingId === match.id ? 0.5 : 1 }]}
                activeOpacity={0.8}
              >
                <Text style={{ color: '#f87171', fontWeight: '700', fontSize: 13 }}>🗑️ Annuler</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ─── FRMT tab ─────────────────────────────────────────────────
function FrmtTab({ entries, allPlayers, loading, onLink, onUnlink }: {
  entries: any[];
  allPlayers: any[];
  loading: boolean;
  onLink: (entryId: string, entry: any, playerId: string) => Promise<void>;
  onUnlink: (entryId: string) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
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

  if (loading) return <ActivityIndicator color="#818cf8" style={{ marginTop: 40 }} />;

  return (
    <>
      {/* Stats */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
        {[
          { label: 'Total', value: entries.length, color: '#e2e8f0' },
          { label: 'Liés', value: linkedCount, color: '#34d399' },
          { label: 'Non liés', value: entries.length - linkedCount, color: '#64748b' },
        ].map(s => (
          <View key={s.label} style={sty.statBox}>
            <Text style={{ fontSize: 20, fontWeight: '900', color: s.color }}>{s.value}</Text>
            <Text style={{ fontSize: 9, fontWeight: '900', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.8 }}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Search */}
      <View style={sty.searchRow}>
        <Text style={{ fontSize: 13, color: '#64748b' }}>🔍</Text>
        <TextInput
          value={search}
          onChangeText={v => { setSearch(v); setPage(1); }}
          placeholder="Rechercher un joueur FRMT…"
          placeholderTextColor="#475569"
          style={{ flex: 1, fontSize: 13, color: '#e2e8f0', fontWeight: '600' }}
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

      <Text style={{ fontSize: 11, color: '#475569', marginBottom: 10 }}>
        {filtered.length} résultat{filtered.length !== 1 ? 's' : ''} · page {safePage}/{totalPages}
      </Text>

      {/* List */}
      <View style={{ gap: 8 }}>
        {paged.map(entry => (
          <View key={entry.id} style={sty.frmtRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <Text style={{ fontSize: 11, color: '#475569', fontWeight: '700', minWidth: 26 }}>#{entry.ranking_position ?? '—'}</Text>
                <Text style={{ fontSize: 13, fontWeight: '900', color: '#e2e8f0', flex: 1 }} numberOfLines={1}>{entry.frmt_name}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                {entry.ranking_points != null && (
                  <Text style={{ fontSize: 11, fontWeight: '900', color: '#818cf8' }}>{entry.ranking_points.toLocaleString('fr-FR')} pts</Text>
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
                  <Text style={{ fontSize: 11, color: '#34d399', fontWeight: '800' }}>✅ {entry.player.name}</Text>
                ) : (
                  <Text style={{ fontSize: 11, color: '#475569', fontWeight: '600' }}>Non lié</Text>
                )}
              </View>
            </View>
            <View style={{ gap: 5, alignItems: 'flex-end' }}>
              <TouchableOpacity onPress={() => { setPickerEntry(entry); setPickerSearch(''); }}
                style={{ backgroundColor: '#4f46e530', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1, borderColor: '#4f46e550' }}>
                <Text style={{ fontSize: 11, fontWeight: '900', color: '#818cf8' }}>
                  {entry.player ? '✏️ Changer' : '🔗 Lier'}
                </Text>
              </TouchableOpacity>
              {entry.player && (
                <TouchableOpacity onPress={() => onUnlink(entry.id)}
                  style={{ backgroundColor: '#ef444415', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1, borderColor: '#ef444430' }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#f87171' }}>Délier</Text>
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
            <Text style={{ fontSize: 13, fontWeight: '900', color: '#818cf8' }}>← Préc.</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 13, fontWeight: '700', color: '#94a3b8' }}>{safePage} / {totalPages}</Text>
          <TouchableOpacity onPress={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
            style={{ opacity: safePage === totalPages ? 0.3 : 1 }}>
            <Text style={{ fontSize: 13, fontWeight: '900', color: '#818cf8' }}>Suiv. →</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Player picker modal */}
      <Modal visible={!!pickerEntry} animationType="slide" transparent statusBarTranslucent onRequestClose={() => setPickerEntry(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setPickerEntry(null)} />
          <View style={{ backgroundColor: '#0f172a', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '70%', borderWidth: 1, borderColor: '#1e293b' }}>
            <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
              <View style={{ width: 36, height: 4, backgroundColor: '#334155', borderRadius: 2 }} />
            </View>
            <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
              <Text style={{ fontSize: 14, fontWeight: '900', color: '#e2e8f0', marginBottom: 10 }}>
                Lier à {pickerEntry?.frmt_name}
              </Text>
              <View style={[sty.searchRow, { marginBottom: 8 }]}>
                <Text style={{ fontSize: 13, color: '#64748b' }}>🔍</Text>
                <TextInput
                  value={pickerSearch}
                  onChangeText={setPickerSearch}
                  placeholder="Nom du joueur…"
                  placeholderTextColor="#475569"
                  style={{ flex: 1, fontSize: 13, color: '#e2e8f0' }}
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
                    <Text style={{ fontSize: 14, fontWeight: '900', color: '#818cf8' }}>{(p.name || '?').charAt(0).toUpperCase()}</Text>
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#e2e8f0', flex: 1 }}>{p.name}</Text>
                  {linking && <ActivityIndicator size="small" color="#818cf8" />}
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
  if (loading) return <ActivityIndicator color="#818cf8" style={{ marginTop: 40 }} />;

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Text style={{ fontSize: 12, color: '#64748b', fontWeight: '600' }}>
          {games.length} partie{games.length !== 1 ? 's' : ''} trouvée{games.length !== 1 ? 's' : ''}
        </Text>
        <TouchableOpacity onPress={onRefresh}>
          <Text style={{ fontSize: 12, fontWeight: '900', color: '#818cf8' }}>🔄 Actualiser</Text>
        </TouchableOpacity>
      </View>

      {games.length === 0 ? (
        <View style={sty.emptyCard}>
          <Text style={{ fontSize: 40, marginBottom: 10 }}>🎾</Text>
          <Text style={{ fontSize: 15, fontWeight: '900', color: '#94a3b8', textAlign: 'center' }}>Aucune partie en cours</Text>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {games.map(game => (
            <View key={game.id} style={sty.gameRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 13, fontWeight: '900', color: '#e2e8f0', marginBottom: 3 }} numberOfLines={1}>
                  {game.location ?? '—'}
                </Text>
                <Text style={{ fontSize: 11, color: '#64748b', fontWeight: '600' }}>
                  {fmtDate(game.match_date)} · {game.creator?.name ?? '—'}
                </Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 5 }}>
                  <View style={{
                    backgroundColor: game.game_format === 'competitive' ? '#ef444420' : '#05966920',
                    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
                    borderWidth: 1, borderColor: game.game_format === 'competitive' ? '#ef444440' : '#05966940',
                  }}>
                    <Text style={{ fontSize: 9, fontWeight: '900', color: game.game_format === 'competitive' ? '#f87171' : '#34d399' }}>
                      {game.game_format === 'competitive' ? 'Compétitif' : 'Amical'}
                    </Text>
                  </View>
                  <View style={{
                    backgroundColor: '#1e293b', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
                    borderWidth: 1, borderColor: '#334155',
                  }}>
                    <Text style={{ fontSize: 9, fontWeight: '700', color: '#94a3b8' }}>{game.status}</Text>
                  </View>
                  <Text style={{ fontSize: 11, color: '#475569', alignSelf: 'center' }}>{game.spots_available} place{game.spots_available !== 1 ? 's' : ''}</Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => onDelete(game.id)}
                disabled={deletingId === game.id}
                style={[sty.btnDelete, { opacity: deletingId === game.id ? 0.5 : 1 }]}
              >
                {deletingId === game.id
                  ? <ActivityIndicator size="small" color="#f87171" />
                  : <Text style={{ fontSize: 12, fontWeight: '900', color: '#f87171' }}>🗑️ Suppr.</Text>
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
      .select('*, winner:winner_id(id,name,elo_score,win_count,loss_count,last_match_at), winner_2:winner_id_2(id,name,elo_score,win_count,loss_count,last_match_at), loser:loser_id(id,name,elo_score,win_count,loss_count,last_match_at), loser_2:loser_id_2(id,name,elo_score,win_count,loss_count,last_match_at), creator:created_by(name)')
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
    const [{ data: rankings }, { data: players }] = await Promise.all([
      supabase.from('frmt_rankings').select('*, player:player_id(id,name)').order('ranking_position', { ascending: true, nullsFirst: false }),
      supabase.from('players').select('id,name').order('name'),
    ]);
    setFrmtEntries(rankings ?? []);
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

  useEffect(() => { if (player?.is_admin) loadDisputes(); }, [player, loadDisputes]);
  useEffect(() => { if (tab === 'frmt' && player?.is_admin) loadFrmt(); }, [tab, player, loadFrmt]);
  useEffect(() => { if (tab === 'games' && player?.is_admin) loadGames(); }, [tab, player, loadGames]);

  const handleForceValidate = async (match: any) => {
    const finalScore = editedScores[match.id];
    if (!finalScore?.trim()) { Alert.alert('Erreur', 'Le score ne peut pas être vide !'); return; }
    Alert.alert('Confirmer', `Valider ce match avec le score : ${finalScore} ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Valider', style: 'default', onPress: async () => {
        setLoadingId(match.id);
        try {
          const isFriendly = match.game_format === 'friendly';
          const winnerIds = [match.winner?.id, match.winner_2?.id].filter(Boolean) as string[];
          const loserIds  = [match.loser?.id,  match.loser_2?.id ].filter(Boolean) as string[];
          const allIds    = [...winnerIds, ...loserIds];

          const { data: fresh } = await supabase
            .from('players').select('id,elo_score,win_count,loss_count,last_match_at,fiability_pct').in('id', allIds);
          if (!fresh) throw new Error('Impossible de récupérer les données des joueurs.');

          type FP = { id: string; elo_score: number; win_count: number; loss_count: number; last_match_at: string | null; fiability_pct: number | null };
          const pMap = new Map<string, FP>();
          (fresh as FP[]).forEach(p => pMap.set(p.id, p));
          const getP = (id: string): FP => pMap.get(id) ?? { id, elo_score: 1000, win_count: 0, loss_count: 0, last_match_at: null, fiability_pct: 50 };
          const now = new Date().toISOString();

          if (!isFriendly) {
            const decayedElo = (id: string) => {
              const p = getP(id);
              return Math.round(p.elo_score * getInactivityDecay(p.last_match_at));
            };
            const w1Elo = decayedElo(winnerIds[0]);
            const w2Elo = winnerIds[1] ? decayedElo(winnerIds[1]) : null;
            const l1Elo = decayedElo(loserIds[0]);
            const l2Elo = loserIds[1] ? decayedElo(loserIds[1]) : null;
            const w1Data = getP(winnerIds[0]);
            const baseDelta = computeEloExchange(teamElo(w1Elo, w2Elo), teamElo(l1Elo, l2Elo), (w1Data.win_count ?? 0) + (w1Data.loss_count ?? 0), w1Data.fiability_pct ?? 50);
            const delta = Math.round(baseDelta * getMarginMultiplier(finalScore));

            const updates = [
              { id: winnerIds[0], newElo: w1Elo + delta, isWin: true },
              ...(winnerIds[1] ? [{ id: winnerIds[1], newElo: (w2Elo ?? 0) + delta, isWin: true }] : []),
              { id: loserIds[0],  newElo: Math.max(100, l1Elo - delta), isWin: false },
              ...(loserIds[1]  ? [{ id: loserIds[1],  newElo: Math.max(100, (l2Elo ?? 0) - delta), isWin: false }] : []),
            ];

            for (const u of updates) {
              const prev    = getP(u.id);
              const newWin  = (prev.win_count  ?? 0) + (u.isWin ? 1 : 0);
              const newLoss = (prev.loss_count ?? 0) + (u.isWin ? 0 : 1);
              await supabase.from('players').update({ elo_score: u.newElo, win_count: newWin, loss_count: newLoss, last_match_at: now, matches_played: newWin + newLoss, fiability_pct: getNewFiabilityPct(prev.fiability_pct ?? 50) }).eq('id', u.id);
              await supabase.from('elo_history').insert([{ player_id: u.id, match_id: match.id, elo_score: u.newElo, elo_change: u.newElo - prev.elo_score }]);
            }
          } else {
            for (const id of allIds) {
              const prev = getP(id);
              await supabase.from('players').update({ last_match_at: now, matches_played: (prev.win_count ?? 0) + (prev.loss_count ?? 0) + 1 }).eq('id', id);
            }
          }

          await supabase.from('matches').update({ status: 'validated', score_text: finalScore.trim() }).eq('id', match.id);
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
        await supabase.from('matches').update({ status: 'canceled' }).eq('id', matchId);
        setDisputes(prev => prev.filter(m => m.id !== matchId));
        setLoadingId(null);
      }},
    ]);
  };

  const handleLink = async (entryId: string, entry: any, playerId: string) => {
    await supabase.from('frmt_rankings').update({ player_id: playerId }).eq('id', entryId);
    const rank = rankFromPoints(entry.ranking_points);
    const upd: Record<string, unknown> = { frmt_verified: true };
    if (rank) upd.federation_rank = rank;
    await supabase.from('players').update(upd).eq('id', playerId);
    await loadFrmt();
  };

  const handleUnlink = async (entryId: string) => {
    await supabase.from('frmt_rankings').update({ player_id: null }).eq('id', entryId);
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
      <View style={{ flex: 1, backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#818cf8" size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#0f172a' }}>
      {/* Header */}
      <View style={{ backgroundColor: '#0a0f1e', paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1e293b' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <TouchableOpacity onPress={() => router.back()}
            style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#1e293b', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#94a3b8', fontSize: 18 }}>‹</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 20, fontWeight: '900', color: '#fff', letterSpacing: -0.5 }}>PANEL ARBITRE</Text>
            <Text style={{ fontSize: 11, color: '#475569', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 }}>🛡️ Administration</Text>
          </View>
          {disputes.length > 0 && (
            <View style={{ backgroundColor: '#ef4444', borderRadius: 999, minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}>
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '900' }}>{disputes.length}</Text>
            </View>
          )}
        </View>

        {/* Tab bar */}
        <View style={{ flexDirection: 'row', backgroundColor: '#1e293b', borderRadius: 14, padding: 3, gap: 2 }}>
          {([
            { key: 'disputes' as AdminTab, label: '⚖️ Litiges', badge: disputes.length },
            { key: 'frmt'     as AdminTab, label: '🏆 FRMT',    badge: 0 },
            { key: 'games'    as AdminTab, label: '🎾 Parties',  badge: 0 },
          ]).map(t => {
            const active = tab === t.key;
            return (
              <TouchableOpacity key={t.key} onPress={() => setTab(t.key)} activeOpacity={0.7}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
                  backgroundColor: active ? '#fff' : 'transparent', borderRadius: 11, paddingVertical: 9 }}>
                <Text style={{ fontSize: 11, fontWeight: '900', color: active ? '#0f172a' : '#475569' }}>{t.label}</Text>
                {t.badge > 0 && (
                  <View style={{ backgroundColor: active ? '#ef4444' : '#ef444455', borderRadius: 999, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                    <Text style={{ fontSize: 9, fontWeight: '900', color: '#fff' }}>{t.badge}</Text>
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
      </ScrollView>
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
    position: 'absolute', top: 0, right: 0, backgroundColor: '#ef4444',
    paddingHorizontal: 10, paddingVertical: 4, borderBottomLeftRadius: 10,
  },
  disputeTagText: { fontSize: 9, fontWeight: '900', color: '#fff', textTransform: 'uppercase', letterSpacing: 1 },
  counterBox: {
    backgroundColor: '#0f172a', borderRadius: 12, borderWidth: 1, borderColor: '#f59e0b30',
    padding: 10, marginBottom: 10,
  },
  matchTitle: { fontSize: 16, fontWeight: '900' },
  fieldLabel: { fontSize: 10, fontWeight: '900', color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  scoreInput: {
    backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 11, color: '#fff', fontSize: 15, fontWeight: '900',
  },
  simCard: {
    backgroundColor: '#0f172a', borderRadius: 14, borderWidth: 1, borderColor: '#1e293b', padding: 12,
  },
  simLabel: { fontSize: 10, fontWeight: '900', color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  simBadge: {
    backgroundColor: '#4f46e520', borderWidth: 1, borderColor: '#4f46e540', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  simBadgeText: { fontSize: 11, fontWeight: '900', color: '#818cf8' },
  simRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1e293b', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 6, gap: 8,
  },
  btnValidate: {
    flex: 1, backgroundColor: '#059669', borderRadius: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center',
  },
  btnCancel: {
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1.5, borderColor: '#ef444450', alignItems: 'center', justifyContent: 'center',
  },
  statBox: {
    flex: 1, backgroundColor: '#1e293b', borderRadius: 14, padding: 12, alignItems: 'center',
    borderWidth: 1, borderColor: '#334155', gap: 2,
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
  chipActive: { backgroundColor: '#fff' },
  chipText: { fontSize: 11, fontWeight: '900', color: '#64748b' },
  chipTextActive: { color: '#0f172a' },
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
