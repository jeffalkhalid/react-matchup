import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  ActivityIndicator, ScrollView,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { usePlayer } from '../../hooks/usePlayer';
import { Colors, Spacing, FontSize, Radius } from '../../lib/theme';

type TypeFilter = 'all' | 'unread' | 'challenge' | 'standard';

// WhatsApp-like order: unread first, then most recent activity (last message
// or match_date as fallback for chats with no messages yet).
function sortGames<T extends { unread: number; last_message_at: string | null; match_date: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => {
    if (b.unread !== a.unread) return b.unread - a.unread;
    const aTs = new Date(a.last_message_at ?? a.match_date).getTime();
    const bTs = new Date(b.last_message_at ?? b.match_date).getTime();
    return bTs - aTs;
  });
}

interface GameChat {
  id: string;
  location: string;
  match_date: string;
  is_challenge: boolean;
  game_format: string | null;
  creator_id: string;
  creator: { name: string } | null;
  participants: Array<{ player_id: string; status: string; player: { name: string } | null }>;
  unread: number;
  last_message_at: string | null;
}

function gameTheme(isChallenge: boolean) {
  if (isChallenge) return { badge: '#92400E', badgeBg: '#FEF3C7', label: 'Défi', accent: '#F59E0B' };
  return { badge: '#1E40AF', badgeBg: '#DBEAFE', label: 'Partie', accent: '#3B82F6' };
}

function AvatarGrid({ players }: { players: Array<{ name: string; isMe: boolean }> }) {
  const slots = [players[0], players[1], players[2], players[3]];
  const COLORS = [Colors.primary, '#8B5CF6', '#EC4899', '#14B8A6'];
  return (
    <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: Colors.bgCardAlt, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 4, gap: 3 }}>
        {slots.slice(0, 4).map((p, i) => (
          <View key={i} style={{
            width: 18, height: 18, borderRadius: 9,
            backgroundColor: p ? (p.isMe ? Colors.primary : COLORS[i]) : Colors.border,
            alignItems: 'center', justifyContent: 'center',
          }}>
            {p ? <Text style={{ color: '#fff', fontSize: 7, fontWeight: '900' }}>{p.name.charAt(0).toUpperCase()}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

export default function ChatsScreen() {
  const { player } = usePlayer();
  const router = useRouter();
  const [games, setGames] = useState<GameChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  useFocusEffect(useCallback(() => {
    if (!player) return;
    loadGames();
  }, [player]));

  // Live updates: new messages bump unread + reorder, and read receipts zero out.
  useEffect(() => {
    if (!player) return;
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const msgCh = supabase
      .channel(`chats-list-msgs:${player.id}:${suffix}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        const m = payload.new as { game_id: string; player_id: string; created_at: string } | null;
        if (!m) return;
        setGames(prev => {
          if (!prev.some(g => g.id === m.game_id)) return prev; // not one of our games
          const updated = prev.map(g => {
            if (g.id !== m.game_id) return g;
            return {
              ...g,
              last_message_at: m.created_at,
              unread: m.player_id === player.id ? g.unread : g.unread + 1,
            };
          });
          return sortGames(updated);
        });
      })
      .subscribe();

    const readCh = supabase
      .channel(`chats-list-reads:${player.id}:${suffix}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_chat_reads', filter: `player_id=eq.${player.id}` }, payload => {
        const r = payload.new as { game_id: string } | null;
        if (!r?.game_id) return;
        setGames(prev => {
          if (!prev.some(g => g.id === r.game_id)) return prev;
          return sortGames(prev.map(g => g.id === r.game_id ? { ...g, unread: 0 } : g));
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(msgCh); supabase.removeChannel(readCh); };
  }, [player]);

  const loadGames = async () => {
    if (!player) return;
    setLoading(true);

    // Games created by the player
    const { data: created } = await supabase
      .from('open_games')
      .select('id, location, match_date, is_challenge, game_format, creator_id, creator:creator_id(name), participants:game_participants(player_id, status, player:player_id(name))')
      .eq('creator_id', player.id)
      .in('status', ['open', 'closed']);

    // Games where player is an accepted participant
    const { data: joinedParts } = await supabase
      .from('game_participants')
      .select('game_id')
      .eq('player_id', player.id)
      .eq('status', 'accepted');

    const joinedIds = (joinedParts ?? []).map((j: any) => j.game_id);
    let joined: any[] = [];
    if (joinedIds.length > 0) {
      const { data } = await supabase
        .from('open_games')
        .select('id, location, match_date, is_challenge, game_format, creator_id, creator:creator_id(name), participants:game_participants(player_id, status, player:player_id(name))')
        .in('id', joinedIds)
        .in('status', ['open', 'closed'])
        .neq('creator_id', player.id);
      joined = data ?? [];
    }

    // Deduplicate
    const seen = new Set<string>();
    const all = [...(created ?? []), ...joined].filter(g => {
      if (seen.has(g.id)) return false;
      seen.add(g.id);
      return true;
    });

    // Get unread counts from game_chat_reads
    const { data: reads } = await supabase
      .from('game_chat_reads')
      .select('game_id, last_read_at')
      .eq('player_id', player.id);

    const readMap = Object.fromEntries((reads ?? []).map((r: any) => [r.game_id, r.last_read_at]));

    // Count unread messages + fetch the latest message timestamp per game
    const gamesWithUnread: GameChat[] = await Promise.all(
      all.map(async (game) => {
        const lastRead = readMap[game.id] ?? '1970-01-01';
        const [{ count }, { data: latest }] = await Promise.all([
          supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('game_id', game.id)
            .gt('created_at', lastRead),
          supabase
            .from('messages')
            .select('created_at')
            .eq('game_id', game.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        return {
          ...game,
          unread: count ?? 0,
          last_message_at: (latest as { created_at: string } | null)?.created_at ?? null,
        };
      })
    );

    setGames(sortGames(gamesWithUnread));
    setLoading(false);
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return games.filter(game => {
      if (typeFilter === 'challenge' && !game.is_challenge) return false;
      if (typeFilter === 'standard' && game.is_challenge) return false;
      if (typeFilter === 'unread' && game.unread === 0) return false;
      if (!q) return true;
      if (game.location?.toLowerCase().includes(q)) return true;
      if (game.creator?.name?.toLowerCase().includes(q)) return true;
      return (game.participants ?? []).some((p: any) => p.player?.name?.toLowerCase().includes(q));
    });
  }, [games, search, typeFilter]);

  const totalUnread = games.reduce((s, g) => s + g.unread, 0);

  const FILTERS: Array<{ id: TypeFilter; label: string }> = [
    { id: 'all', label: 'Tous' },
    { id: 'unread', label: `Non lus${totalUnread > 0 ? ` (${totalUnread})` : ''}` },
    { id: 'challenge', label: 'Défis' },
    { id: 'standard', label: 'Parties' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {/* Header */}
      <View style={{ backgroundColor: '#102820', paddingTop: 56, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md }}>
        <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900', marginBottom: 2 }}>Chats</Text>
        <Text style={{ color: Colors.textMuted, fontSize: FontSize.xs, fontWeight: '600', marginBottom: Spacing.md }}>
          {games.length} match{games.length !== 1 ? 's' : ''} actif{games.length !== 1 ? 's' : ''}
          {totalUnread > 0 ? `  ·  ${totalUnread} non lu${totalUnread > 1 ? 's' : ''}` : ''}
        </Text>

        {/* Search */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
          backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: Radius.md,
          paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
          borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
        }}>
          <Text style={{ fontSize: 14, color: Colors.textMuted }}>🔍</Text>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Rechercher une conversation…"
            placeholderTextColor={Colors.textMuted}
            style={{ flex: 1, color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '500' }}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Text style={{ color: Colors.textMuted, fontSize: 16 }}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Filter pills */}
      <View style={{ paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.sm }}>
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f.id}
              onPress={() => setTypeFilter(f.id)}
              style={{
                paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full,
                backgroundColor: typeFilter === f.id
                  ? (f.id === 'unread' ? Colors.danger : Colors.bgCardAlt)
                  : Colors.bgCard,
                borderWidth: 1,
                borderColor: typeFilter === f.id
                  ? (f.id === 'unread' ? Colors.danger : Colors.border)
                  : Colors.border,
              }}
            >
              <Text style={{
                color: typeFilter === f.id ? (f.id === 'unread' ? '#fff' : Colors.textPrimary) : Colors.textSecondary,
                fontSize: FontSize.xs, fontWeight: '700',
              }}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* List */}
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl }}>
          <Text style={{ fontSize: 40, marginBottom: Spacing.md }}>
            {typeFilter === 'unread' ? '✅' : '💬'}
          </Text>
          <Text style={{ color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '900', textAlign: 'center' }}>
            {typeFilter === 'unread' ? 'Tout est lu !' : search ? 'Aucun résultat' : 'Aucune conversation'}
          </Text>
          <Text style={{ color: Colors.textSecondary, fontSize: FontSize.sm, textAlign: 'center', marginTop: 4 }}>
            {typeFilter === 'unread' ? 'Tu es à jour.' : search ? `"${search}" introuvable` : 'Rejoins une partie dans le Lobby.'}
          </Text>
          {(search || typeFilter !== 'all') && (
            <TouchableOpacity onPress={() => { setSearch(''); setTypeFilter('all'); }} style={{ marginTop: Spacing.md }}>
              <Text style={{ color: Colors.primary, fontSize: FontSize.sm, fontWeight: '900' }}>Voir toutes les conversations</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={g => g.id}
          contentContainerStyle={{ paddingBottom: 80 }}
          renderItem={({ item: game }) => {
            const theme = gameTheme(game.is_challenge);
            const accepted = (game.participants ?? []).filter((p: any) => p.status === 'accepted');
            const allPlayers = [
              { name: game.creator?.name ?? '?', isMe: player?.id === game.creator_id },
              ...accepted.map((p: any) => ({ name: p.player?.name ?? '?', isMe: p.player_id === player?.id })),
            ];
            const gameDate = new Date(game.match_date);
            const dateStr = gameDate.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
            const timeStr = gameDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

            return (
              <TouchableOpacity
                onPress={() => router.push(`/chat/${game.id}`)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
                  paddingHorizontal: Spacing.lg, paddingVertical: 13,
                  borderBottomWidth: 1, borderBottomColor: Colors.border,
                  backgroundColor: game.unread > 0 ? `${Colors.primary}08` : Colors.bg,
                }}
              >
                {/* Avatar grid with unread badge */}
                <View>
                  <AvatarGrid players={allPlayers} />
                  {game.unread > 0 && (
                    <View style={{
                      position: 'absolute', top: -4, right: -4,
                      width: 18, height: 18, borderRadius: 9,
                      backgroundColor: Colors.primary, borderWidth: 2, borderColor: Colors.bg,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Text style={{ color: '#fff', fontSize: 9, fontWeight: '900' }}>{game.unread}</Text>
                    </View>
                  )}
                </View>

                {/* Content */}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                    <Text style={{ color: game.unread > 0 ? Colors.textPrimary : Colors.textSecondary, fontSize: FontSize.sm, fontWeight: game.unread > 0 ? '900' : '600' }} numberOfLines={1}>
                      {dateStr} · {timeStr}
                    </Text>
                    <Text style={{ color: Colors.textMuted, fontSize: FontSize.xs }}>
                      {gameDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                    </Text>
                  </View>
                  <Text style={{ color: Colors.textMuted, fontSize: FontSize.xs, marginBottom: 4 }} numberOfLines={1}>
                    📍 {game.location}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{ backgroundColor: theme.badgeBg, borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 2 }}>
                      <Text style={{ color: theme.badge, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' }}>{theme.label}</Text>
                    </View>
                    <Text style={{ color: game.unread > 0 ? Colors.textPrimary : Colors.textMuted, fontSize: FontSize.xs, fontWeight: game.unread > 0 ? '700' : '400' }} numberOfLines={1}>
                      {allPlayers.filter(p => !p.isMe)[0]?.name ?? 'Démarrer la conversation'}
                    </Text>
                  </View>
                </View>

                {game.unread > 0 ? (
                  <View style={{
                    minWidth: 22, height: 22, borderRadius: 11,
                    backgroundColor: Colors.primary,
                    paddingHorizontal: 7,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ color: '#fff', fontSize: 11, fontWeight: '900' }}>
                      {game.unread > 99 ? '99+' : game.unread}
                    </Text>
                  </View>
                ) : (
                  <Text style={{ color: Colors.textMuted, fontSize: 16 }}>›</Text>
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}
