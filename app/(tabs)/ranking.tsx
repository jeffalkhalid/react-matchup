import { useState, useMemo, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  ScrollView, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Line } from 'react-native-svg';
import { usePlayer } from '../../hooks/usePlayer';
import { supabase } from '../../lib/supabase';
import { Colors, getLeague, getLeagueLabel, formatPadelLevel } from '../../lib/theme';
import type { Player } from '../../types';

// ── Constants ────────────────────────────────────────────────────────
const AVATAR_PALETTE = ['#f59e0b','#ec4899','#3b82f6','#f43f5e','#10b981','#8b5cf6','#14b8a6','#f97316'];
function avatarColor(id: string): string {
  const n = id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_PALETTE[n % AVATAR_PALETTE.length];
}
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : (parts[0]?.[0] ?? '?').toUpperCase();
}

const LEAGUE_FILTERS = [
  { id: 'tous',      label: 'Toutes ligues', color: null },
  { id: 'diamond',   label: 'Diamant',       color: Colors.league.diamond },
  { id: 'gold',      label: 'Or',            color: Colors.league.gold },
  { id: 'silver',    label: 'Argent',        color: Colors.league.silver },
  { id: 'bronze',    label: 'Bronze',        color: Colors.league.bronze },
  { id: 'discovery', label: 'Découverte',    color: Colors.league.discovery },
];

const MEDAL_COLORS  = ['#f59e0b', '#94a3b8', '#b45309'];
const PODIUM_BG     = ['#fef9c3', '#f1f5f9', '#ffedd5'];
const PODIUM_BORDER = ['#fef08a', '#e2e8f0', '#fed7aa'];

// Slots: [playerIndex, blockHeight, avatarSize, rankNum]
const PODIUM_SLOTS = [
  { idx: 1, blockH: 78,  avatarSz: 52, rankNum: 2 },
  { idx: 0, blockH: 104, avatarSz: 62, rankNum: 1 },
  { idx: 2, blockH: 60,  avatarSz: 46, rankNum: 3 },
];

type RankedPlayer = Player & { rank: number };

// ── Icons ────────────────────────────────────────────────────────────
function IconStar({ size = 16, filled = false, color = '#94a3b8' }: { size?: number; filled?: boolean; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24"
      fill={filled ? color : 'none'} stroke={color} strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </Svg>
  );
}

function IconSearch() {
  return (
    <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
      <Circle cx={6} cy={6} r={4.5} stroke="#94a3b8" strokeWidth={1.5} />
      <Line x1={9.5} y1={9.5} x2={12} y2={12} stroke="#94a3b8" strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

// ── Main screen ──────────────────────────────────────────────────────
export default function RankingScreen() {
  const { player: me } = usePlayer();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [tab,          setTab]          = useState<'global' | 'amis'>('global');
  const [allPlayers,   setAllPlayers]   = useState<Player[]>([]);
  const [search,       setSearch]       = useState('');
  const [leagueFilter, setLeagueFilter] = useState('tous');
  const [favorites,    setFavorites]    = useState<Set<string>>(new Set());
  const [favLoading,   setFavLoading]   = useState<Set<string>>(new Set());
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);

  const load = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    const { data } = await supabase.from('players').select('*').order('elo_score', { ascending: false });
    setAllPlayers(data ?? []);
    if (me) {
      const { data: favData } = await supabase
        .from('player_favorites').select('favorite_id').eq('player_id', me.id);
      if (favData) setFavorites(new Set(favData.map((r: any) => r.favorite_id)));
    }
    if (showLoading) setLoading(false);
  };

  useEffect(() => { load(true); }, [me?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load(false);
    setRefreshing(false);
  };

  const toggleFavorite = async (playerId: string) => {
    if (!me) return;
    const isFav = favorites.has(playerId);
    setFavorites(prev => {
      const next = new Set(prev);
      isFav ? next.delete(playerId) : next.add(playerId);
      return next;
    });
    setFavLoading(prev => new Set([...prev, playerId]));
    if (isFav) {
      await supabase.from('player_favorites').delete().match({ player_id: me.id, favorite_id: playerId });
    } else {
      await supabase.from('player_favorites').insert({ player_id: me.id, favorite_id: playerId });
    }
    setFavLoading(prev => { const next = new Set(prev); next.delete(playerId); return next; });
  };

  const ranked = useMemo(
    () => [...allPlayers].sort((a, b) => b.elo_score - a.elo_score).map((p, i) => ({ ...p, rank: i + 1 })),
    [allPlayers],
  );

  const myEntry = me ? ranked.find(p => p.id === me.id) ?? null : null;

  const displayed = useMemo(() => {
    let list = ranked;
    if (tab === 'amis')          list = list.filter(p => favorites.has(p.id));
    if (search)                  list = list.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
    if (leagueFilter !== 'tous') list = list.filter(p => getLeague(p.elo_score) === leagueFilter);
    return list;
  }, [ranked, search, leagueFilter, tab, favorites]);

  const showPodium = !search && leagueFilter === 'tous' && tab === 'global';
  const top3       = ranked.slice(0, 3);
  const listData   = displayed.filter(p => !showPodium || p.rank > 3);
  const favCount   = favorites.size;

  return (
    <View style={{ flex: 1, backgroundColor: '#f7f9f5' }}>

      {/* ── Dark header ──────────────────────────────────────────── */}
      <View style={{ backgroundColor: '#102820', paddingTop: insets.top + 14, paddingHorizontal: 16 }}>
        {/* Title row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <View>
            <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: -0.5, lineHeight: 24 }}>
              Classement
            </Text>
            <Text style={{ color: '#64748b', fontSize: 11, fontWeight: '600', marginTop: 4 }}>
              {ranked.length} joueur{ranked.length !== 1 ? 's' : ''} classés
            </Text>
          </View>
          {myEntry && (
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12,
              paddingHorizontal: 12, paddingVertical: 6,
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
            }}>
              <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '600' }}>Votre rang</Text>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '900' }}>#{myEntry.rank}</Text>
            </View>
          )}
        </View>

        {/* Tabs */}
        <View style={{
          flexDirection: 'row', gap: 3, padding: 4, borderRadius: 14,
          backgroundColor: 'rgba(255,255,255,0.08)',
        }}>
          {(['global', 'amis'] as const).map((id, i) => {
            const active = tab === id;
            const badge  = id === 'amis' && favCount > 0 ? favCount : null;
            return (
              <TouchableOpacity
                key={id}
                onPress={() => setTab(id)}
                activeOpacity={0.8}
                style={{
                  flex: 1, paddingVertical: 7, borderRadius: 11,
                  alignItems: 'center', justifyContent: 'center',
                  flexDirection: 'row', gap: 6,
                  backgroundColor: active ? '#fff' : 'transparent',
                }}
              >
                <Text style={{ color: active ? '#0f172a' : 'rgba(255,255,255,0.5)', fontSize: 11.5, fontWeight: '900' }}>
                  {['Global', 'Amis'][i]}
                </Text>
                {badge !== null && (
                  <View style={{
                    backgroundColor: active ? '#f59e0b' : 'rgba(245,158,11,0.7)',
                    borderRadius: 999, paddingHorizontal: 5, paddingVertical: 1,
                  }}>
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '900' }}>{badge}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ── Search + filters ─────────────────────────────────────── */}
      <View style={{ backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' }}>
        <View style={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8 }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            backgroundColor: '#f8fafc', borderRadius: 12,
            paddingHorizontal: 12, paddingVertical: 10,
            borderWidth: 1.5, borderColor: '#e2e8f0',
          }}>
            <IconSearch />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Chercher un joueur…"
              placeholderTextColor="#94a3b8"
              style={{ flex: 1, fontSize: 13.5, color: '#0f172a', fontWeight: '500' }}
            />
            {!!search && (
              <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ color: '#94a3b8', fontSize: 14 }}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 8, gap: 6 }}
        >
          {LEAGUE_FILTERS.map(f => {
            const active = leagueFilter === f.id;
            return (
              <TouchableOpacity
                key={f.id}
                onPress={() => setLeagueFilter(f.id)}
                activeOpacity={0.8}
                style={{
                  paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
                  backgroundColor: active ? (f.color ?? '#0f172a') : '#fff',
                  borderWidth: active ? 0 : 1.5, borderColor: '#e2e8f0',
                }}
              >
                <Text style={{ color: active ? '#fff' : '#0f172a', fontSize: 11.5, fontWeight: '700' }}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* ── List ─────────────────────────────────────────────────── */}
      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList<RankedPlayer>
          data={listData}
          keyExtractor={item => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          contentContainerStyle={{ paddingBottom: 32 }}
          ListHeaderComponent={
            <>
              {/* Podium */}
              {showPodium && top3.length >= 3 && (
                <PodiumSection
                  top3={top3}
                  favorites={favorites}
                  favLoading={favLoading}
                  me={me}
                  onToggleFav={toggleFavorite}
                  onPressPlayer={id => router.push(`/player/${id}` as any)}
                />
              )}

              {/* Votre position */}
              {showPodium && myEntry && myEntry.rank > 3 && (
                <View style={{
                  marginHorizontal: 14, marginTop: 4, marginBottom: 8,
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  backgroundColor: '#eef2ff', borderRadius: 14,
                  paddingHorizontal: 14, paddingVertical: 10,
                  borderWidth: 1.5, borderColor: '#c7d2fe',
                }}>
                  <View style={{
                    width: 36, height: 36, borderRadius: 11,
                    backgroundColor: '#4f46e5',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '900' }}>{getInitials(myEntry.name)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#4f46e5', fontSize: 12.5, fontWeight: '900' }}>Votre position</Text>
                    <Text style={{ color: '#818cf8', fontSize: 11, marginTop: 2 }}>
                      Niv. {formatPadelLevel(myEntry.elo_score)} · {(myEntry.win_count ?? 0) + (myEntry.loss_count ?? 0)} matchs
                    </Text>
                  </View>
                  <Text style={{ color: '#4f46e5', fontSize: 22, fontWeight: '900' }}>#{myEntry.rank}</Text>
                </View>
              )}

              {/* List header label */}
              <View style={{
                paddingHorizontal: 16, paddingVertical: 10,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <Text style={{ fontSize: 12, fontWeight: '900', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>
                  {tab === 'amis'
                    ? `${displayed.length} favori${displayed.length !== 1 ? 's' : ''}`
                    : search
                    ? `${displayed.length} résultat${displayed.length !== 1 ? 's' : ''}`
                    : showPodium
                    ? 'Suite du classement'
                    : `${displayed.length} joueur${displayed.length !== 1 ? 's' : ''}`}
                </Text>
                <Text style={{ fontSize: 11, fontWeight: '600', color: '#94a3b8' }}>ELO ↓</Text>
              </View>
            </>
          }
          renderItem={({ item }) => (
            <PlayerRow
              player={item}
              isMe={item.id === me?.id}
              isFav={favorites.has(item.id)}
              favLoading={favLoading.has(item.id)}
              showFavToggle={!!me && item.id !== me.id}
              onPress={() => router.push(`/player/${item.id}` as any)}
              onToggleFav={() => toggleFavorite(item.id)}
            />
          )}
          ListEmptyComponent={
            tab === 'amis' ? (
              <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 }}>
                <View style={{
                  width: 48, height: 48, borderRadius: 24,
                  backgroundColor: '#fef3c7',
                  alignItems: 'center', justifyContent: 'center', marginBottom: 12,
                }}>
                  <IconStar size={22} color="#f59e0b" />
                </View>
                <Text style={{ fontSize: 13, fontWeight: '900', color: '#0f172a', marginBottom: 6 }}>
                  Aucun favori pour l'instant
                </Text>
                <Text style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', lineHeight: 17 }}>
                  Va dans l'onglet{' '}
                  <Text style={{ fontWeight: '900', color: '#475569' }}>Global</Text>
                  {' '}et clique sur l'étoile à côté d'un joueur.
                </Text>
              </View>
            ) : (
              <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                <Text style={{ color: '#94a3b8', fontSize: 13 }}>Aucun joueur trouvé</Text>
              </View>
            )
          }
        />
      )}
    </View>
  );
}

// ── Podium ───────────────────────────────────────────────────────────
function PodiumSection({ top3, favorites, favLoading, me, onToggleFav, onPressPlayer }: {
  top3: RankedPlayer[];
  favorites: Set<string>;
  favLoading: Set<string>;
  me: Player | null;
  onToggleFav: (id: string) => void;
  onPressPlayer: (id: string) => void;
}) {
  return (
    <View style={{ backgroundColor: '#102820', paddingTop: 20 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', paddingHorizontal: 10 }}>
        {PODIUM_SLOTS.map(({ idx, blockH, avatarSz, rankNum }) => {
          const p = top3[idx];
          if (!p) return null;
          const col        = avatarColor(p.id);
          const leagueHex  = Colors.league[getLeague(p.elo_score)];
          const medal      = MEDAL_COLORS[rankNum - 1];
          const podiumBg   = PODIUM_BG[rankNum - 1];
          const borderCol  = PODIUM_BORDER[rankNum - 1];
          const isFav      = favorites.has(p.id);
          const isLoading  = favLoading.has(p.id);

          return (
            <TouchableOpacity
              key={p.id}
              onPress={() => onPressPlayer(p.id)}
              activeOpacity={0.8}
              style={{ flex: 1, alignItems: 'center' }}
            >
              {/* Avatar */}
              <View style={{ position: 'relative', marginBottom: 8 }}>
                <View style={{
                  width: avatarSz, height: avatarSz,
                  borderRadius: avatarSz * 0.28,
                  backgroundColor: col,
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: rankNum === 1 ? 3 : 2.5,
                  borderColor: borderCol,
                }}>
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: avatarSz * 0.32 }}>
                    {getInitials(p.name)}
                  </Text>
                </View>
                {/* Rank badge */}
                <View style={{
                  position: 'absolute', top: -8, right: -8,
                  width: 22, height: 22, borderRadius: 11,
                  backgroundColor: medal, alignItems: 'center', justifyContent: 'center',
                  borderWidth: 2, borderColor: '#102820',
                }}>
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '900' }}>{rankNum}</Text>
                </View>
                {/* Fav toggle */}
                {me && me.id !== p.id && (
                  <TouchableOpacity
                    onPress={() => onToggleFav(p.id)}
                    disabled={isLoading}
                    style={{
                      position: 'absolute', bottom: -8, left: -8,
                      width: 22, height: 22, borderRadius: 11,
                      backgroundColor: isFav ? '#fef3c7' : 'rgba(255,255,255,0.15)',
                      alignItems: 'center', justifyContent: 'center',
                      borderWidth: 2, borderColor: isFav ? '#f59e0b' : 'rgba(255,255,255,0.25)',
                      opacity: isLoading ? 0.4 : 1,
                    }}
                  >
                    <IconStar size={10} filled={isFav} color={isFav ? '#f59e0b' : 'rgba(255,255,255,0.7)'} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Name */}
              <Text
                style={{ color: '#fff', fontWeight: '900', fontSize: rankNum === 1 ? 13 : 11.5, marginBottom: 2 }}
                numberOfLines={1}
              >
                {p.name.split(' ')[0]}
              </Text>

              {/* Level */}
              <Text style={{ color: leagueHex, fontSize: 12, fontWeight: '900', marginBottom: 6 }}>
                {formatPadelLevel(p.elo_score)}
              </Text>

              {/* Podium block */}
              <View style={{
                width: '90%', height: blockH,
                backgroundColor: podiumBg,
                borderTopLeftRadius: 10, borderTopRightRadius: 10,
                borderWidth: 1.5, borderBottomWidth: 0,
                borderColor: medal + '55',
                alignItems: 'center', paddingTop: 10,
              }}>
                <Text style={{ fontSize: rankNum === 1 ? 18 : 15 }}>
                  {rankNum === 1 ? '🏆' : rankNum === 2 ? '🥈' : '🥉'}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={{ height: 8, backgroundColor: '#f7f9f5' }} />
    </View>
  );
}

// ── Player row ───────────────────────────────────────────────────────
function PlayerRow({ player, isMe, isFav, favLoading, showFavToggle, onPress, onToggleFav }: {
  player: RankedPlayer;
  isMe: boolean;
  isFav: boolean;
  favLoading: boolean;
  showFavToggle: boolean;
  onPress: () => void;
  onToggleFav: () => void;
}) {
  const league       = getLeague(player.elo_score);
  const leagueHex    = Colors.league[league];
  const leagueShort  = getLeagueLabel(league);
  const col          = avatarColor(player.id);
  const isTop3       = player.rank <= 3;
  const matchCount   = (player.win_count ?? 0) + (player.loss_count ?? 0);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 10,
        paddingHorizontal: 16, paddingVertical: 10,
        backgroundColor: isMe ? '#eef2ff' : '#fff',
        borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
      }}
    >
      {/* Rank */}
      <View style={{ width: 28, alignItems: 'center' }}>
        {isTop3 ? (
          <Text style={{ fontSize: 16 }}>{['🥇','🥈','🥉'][player.rank - 1]}</Text>
        ) : (
          <Text style={{ fontSize: 13, fontWeight: '900', color: isMe ? '#4f46e5' : '#94a3b8' }}>
            #{player.rank}
          </Text>
        )}
      </View>

      {/* Avatar */}
      <View style={{
        width: 38, height: 38, borderRadius: 11,
        backgroundColor: col,
        alignItems: 'center', justifyContent: 'center',
        borderWidth: isMe ? 2 : 0, borderColor: '#4f46e5',
      }}>
        <Text style={{ color: '#fff', fontSize: 12, fontWeight: '900' }}>{getInitials(player.name)}</Text>
      </View>

      {/* Name + badges + meta */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          <Text
            style={{ fontSize: 13, fontWeight: isMe ? '900' : '700', color: '#0f172a' }}
            numberOfLines={1}
          >
            {player.name}
          </Text>
          {isMe && (
            <View style={{ backgroundColor: '#eef2ff', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1, borderWidth: 1, borderColor: '#c7d2fe' }}>
              <Text style={{ color: '#4f46e5', fontSize: 9, fontWeight: '900' }}>Vous</Text>
            </View>
          )}
          {player.frmt_verified && player.frmt_rank && (
            <View style={{ backgroundColor: '#f0fdf4', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1, borderWidth: 1, borderColor: '#bbf7d0' }}>
              <Text style={{ color: '#16a34a', fontSize: 9, fontWeight: '900' }}>{player.frmt_rank} ✓</Text>
            </View>
          )}
          {!player.frmt_verified && player.frmt_rank && (
            <View style={{ backgroundColor: '#fffbeb', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1, borderWidth: 1, borderColor: '#fde68a' }}>
              <Text style={{ color: '#d97706', fontSize: 9, fontWeight: '900' }}>{player.frmt_rank}</Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <View style={{ backgroundColor: leagueHex + '18', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 }}>
            <Text style={{ color: leagueHex, fontSize: 9.5, fontWeight: '700' }}>{leagueShort}</Text>
          </View>
          <Text style={{ color: '#94a3b8', fontSize: 10.5 }}>{matchCount} matchs</Text>
        </View>
      </View>

      {/* ELO level */}
      <Text style={{ fontSize: 15, fontWeight: '900', color: isMe ? '#4f46e5' : '#0f172a' }}>
        {formatPadelLevel(player.elo_score)}
      </Text>

      {/* Fav toggle */}
      {showFavToggle && (
        <TouchableOpacity
          onPress={onToggleFav}
          disabled={favLoading}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          style={{
            width: 32, height: 32, alignItems: 'center', justifyContent: 'center',
            borderRadius: 12,
            backgroundColor: isFav ? '#fef3c7' : 'transparent',
            opacity: favLoading ? 0.4 : 1,
          }}
        >
          <IconStar size={16} filled={isFav} color={isFav ? '#f59e0b' : '#cbd5e1'} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}
