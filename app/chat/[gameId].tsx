import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import EmojiPicker, { type EmojiType } from 'rn-emoji-keyboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePlayer } from '../../hooks/usePlayer';
import { supabase } from '../../lib/supabase';
import { notifyPlayers } from '../../lib/notify';
import type { Message } from '../../types';
import { Colors, Fonts } from '../../lib/theme';

// ─── Constants ────────────────────────────────────────────────
const DEFAULT_QUICK_EMOJIS = ['👍', '🔥', '😄', '💪', '👌', '🎉', '😅'];
const RECENT_EMOJIS_KEY = '@matchup/recent-reactions';
const QUICK_SLOTS = 7;
const AVATAR_COLORS = ['#4f46e5', '#ec4899', '#8b5cf6', '#14b8a6', '#f59e0b', '#10b981'];
function playerColor(idx: number) { return AVATAR_COLORS[idx % AVATAR_COLORS.length]; }

type ThemeVariant = 'brand' | 'success' | 'ink';
function matchTheme(isChallenge: boolean, format: string): {
  accent: string; strip: string; badge: string; badgeText: string; label: string; variant: ThemeVariant;
} {
  if (isChallenge) return {
    accent: Colors.brandDeep, strip: Colors.brand,
    badge: 'rgba(255,193,26,0.14)', badgeText: Colors.brandDeep,
    label: 'Défi', variant: 'brand',
  };
  if (format === 'friendly') return {
    accent: '#047857', strip: '#10b981',
    badge: 'rgba(16,185,129,0.10)', badgeText: '#047857',
    label: 'Amical', variant: 'success',
  };
  return {
    accent: Colors.textPrimary, strip: Colors.primary,
    badge: Colors.bgCardAlt, badgeText: Colors.textPrimary,
    label: 'Compétitif', variant: 'ink',
  };
}

// ─── Types ────────────────────────────────────────────────────
interface GameInfo {
  id: string; location: string; match_date: string;
  is_challenge: boolean; game_format: string;
  creator_id: string;
  creator: { name: string } | null;
  participants: { player_id: string; status: string; player: { name: string } | null }[];
}
interface Participant { id: string; name: string }

// ─── Message item ─────────────────────────────────────────────
interface MsgItemProps {
  message: Message; prevMessage?: Message;
  isMe: boolean; allPlayers: { id: string; name: string }[];
  reactingId: string | null; setReactingId: (id: string | null) => void;
  myId: string;
  addReaction: (msgId: string, emoji: string) => void;
  onOpenFullPicker: (msgId: string) => void;
  quickEmojis: string[];
  readers: Participant[];
}

function MessageItem({ message: m, prevMessage, isMe, allPlayers, reactingId, setReactingId, myId, addReaction, onOpenFullPicker, quickEmojis, readers }: MsgItemProps) {
  const time = new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const senderChanged = !prevMessage || prevMessage.player_id !== m.player_id;
  const showAvatar = !isMe && senderChanged;
  const pIdx = allPlayers.findIndex(p => p.id === m.player_id);
  const color = pIdx >= 0 ? playerColor(pIdx) : Colors.textMuted;
  const reactions = m.reactions ?? {};
  const isReacting = reactingId === m.id;

  return (
    <View style={{ paddingTop: senderChanged ? 12 : 3 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, justifyContent: isMe ? 'flex-end' : 'flex-start' }}>

        {/* Avatar placeholder (others) */}
        {!isMe && (
          <View style={{ width: 28, alignSelf: 'flex-end' }}>
            {showAvatar ? (
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: Colors.textOnDark }}>{m.player_name.charAt(0).toUpperCase()}</Text>
              </View>
            ) : null}
          </View>
        )}

        {/* Bubble column */}
        <View style={{ maxWidth: '72%', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
          {/* Sender name */}
          {!isMe && senderChanged && (
            <Text style={{ fontSize: 10, fontWeight: '900', color, marginBottom: 2, marginLeft: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {m.player_name}
            </Text>
          )}

          {/* Bubble (tap = emoji picker) */}
          <TouchableOpacity onPress={() => setReactingId(isReacting ? null : m.id)} activeOpacity={0.85}
            style={{
              backgroundColor: isMe ? Colors.primary : Colors.bgCard,
              borderRadius: 18,
              borderBottomRightRadius: isMe ? 4 : 18,
              borderBottomLeftRadius: isMe ? 18 : 4,
              paddingHorizontal: 14, paddingVertical: 10,
              borderWidth: isMe ? 0 : 1, borderColor: Colors.border,
              shadowColor: isMe ? Colors.primary : '#000',
              shadowOpacity: isMe ? 0.22 : 0.05,
              shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: isMe ? 4 : 1,
            }}>
            <Text style={{ fontSize: 14, fontFamily: Fonts.ui, fontWeight: '500', lineHeight: 20, color: isMe ? Colors.textOnDark : Colors.textPrimary }}>
              {m.content}
            </Text>
          </TouchableOpacity>

          {/* Reactions */}
          {Object.keys(reactions).length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4, justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
              {Object.entries(reactions).map(([emoji, entry]) => {
                // Tolerate legacy numeric counts (old data shape) — no highlight possible there.
                const arr = Array.isArray(entry) ? entry : [];
                const count = Array.isArray(entry) ? arr.length : (typeof entry === 'number' ? entry : 0);
                const mine = arr.includes(myId);
                if (count <= 0) return null;
                return (
                  <TouchableOpacity key={emoji} onPress={() => addReaction(m.id, emoji)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 3,
                      backgroundColor: mine ? 'rgba(255,193,26,0.18)' : Colors.bgCard, borderRadius: 999,
                      paddingHorizontal: 8, paddingVertical: 3,
                      borderWidth: 1, borderColor: mine ? Colors.brand : Colors.border,
                    }}>
                    <Text style={{ fontSize: 13 }}>{emoji}</Text>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: mine ? Colors.brandDeep : Colors.textSecondary }}>
                      {count}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Timestamp */}
          <Text style={{ fontSize: 10, fontWeight: '500', color: Colors.textMuted, marginTop: 3, marginLeft: 2, marginRight: 2 }}>
            {time}
          </Text>

          {/* Read receipts (own messages only) */}
          {isMe && readers.length > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 }}>
              <Text style={{ fontSize: 9, color: Colors.textMuted, fontWeight: '600' }}>Lu</Text>
              {readers.slice(0, 3).map(r => {
                const idx = allPlayers.findIndex(p => p.id === r.id);
                return (
                  <View key={r.id} style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: idx >= 0 ? playerColor(idx) : Colors.textMuted, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#fff' }}>
                    <Text style={{ fontSize: 7, fontWeight: '900', color: Colors.textOnDark }}>{r.name.charAt(0).toUpperCase()}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </View>

      {/* Emoji picker bar */}
      {isReacting && (
        <View style={{ flexDirection: 'row', marginTop: 6, paddingLeft: isMe ? 0 : 36, justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: Colors.bgCard, borderRadius: 999,
            paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: Colors.border,
            shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
          }}>
            {quickEmojis.map(em => (
              <TouchableOpacity key={em} onPress={() => addReaction(m.id, em)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Text style={{ fontSize: 22 }}>{em}</Text>
              </TouchableOpacity>
            ))}
            <View style={{ width: 1, height: 18, backgroundColor: Colors.border, marginHorizontal: 4 }} />
            <TouchableOpacity
              onPress={() => onOpenFullPicker(m.id)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              style={{
                width: 28, height: 28, borderRadius: 999,
                backgroundColor: Colors.bgCardAlt, alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 16, color: Colors.textSecondary, fontWeight: '900', lineHeight: 18 }}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────
export default function ChatScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const { player } = usePlayer();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList>(null);

  const [game, setGame] = useState<GameInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [readMap, setReadMap] = useState<Map<string, string>>(new Map());
  const [headerOpen, setHeaderOpen] = useState(true);
  const [reactingId, setReactingId] = useState<string | null>(null);
  const [pickerForMsgId, setPickerForMsgId] = useState<string | null>(null);
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);

  // Load recent emojis from AsyncStorage on mount
  useEffect(() => {
    AsyncStorage.getItem(RECENT_EMOJIS_KEY).then(raw => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setRecentEmojis(parsed.filter(e => typeof e === 'string'));
      } catch { /* ignore */ }
    });
  }, []);

  // Quick bar: les "recent" en premier, complétés par les défauts (deduplication conservée)
  const quickEmojis = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    [...recentEmojis, ...DEFAULT_QUICK_EMOJIS].forEach(e => {
      if (!seen.has(e) && out.length < QUICK_SLOTS) {
        seen.add(e);
        out.push(e);
      }
    });
    return out;
  }, [recentEmojis]);

  const rememberEmoji = useCallback((emoji: string) => {
    setRecentEmojis(prev => {
      const filtered = prev.filter(e => e !== emoji);
      const next = [emoji, ...filtered].slice(0, QUICK_SLOTS);
      AsyncStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  // ── Derived ─────────────────────────────────────────────────
  const allPlayers = useMemo<{ id: string; name: string }[]>(() => {
    if (!game) return [];
    const accepted = (game.participants ?? []).filter(p => p.status === 'accepted');
    return [
      { id: game.creator_id, name: game.creator?.name ?? '?' },
      ...accepted.map(p => ({ id: p.player_id, name: p.player?.name ?? '?' })),
    ];
  }, [game]);

  const allParticipants = useMemo<Participant[]>(
    () => allPlayers.filter(p => p.id !== player?.id),
    [allPlayers, player?.id]
  );

  const theme = useMemo(() => game ? matchTheme(!!game.is_challenge, game.game_format ?? '') : matchTheme(false, ''), [game]);

  // Last message each participant has read
  const readByMsgId = useMemo(() => {
    const result = new Map<string, Participant[]>();
    allParticipants.forEach(p => {
      const lastRead = readMap.get(p.id);
      if (!lastRead) return;
      const lastReadDate = new Date(lastRead);
      for (let i = messages.length - 1; i >= 0; i--) {
        if (new Date(messages[i].created_at) <= lastReadDate) {
          const msgId = messages[i].id;
          result.set(msgId, [...(result.get(msgId) ?? []), p]);
          break;
        }
      }
    });
    return result;
  }, [messages, readMap, allParticipants]);

  // ── Mark read ────────────────────────────────────────────────
  const markRead = useCallback(async () => {
    if (!player) return;
    const now = new Date().toISOString();
    await supabase.from('game_chat_reads').upsert(
      [{ player_id: player.id, game_id: gameId, last_read_at: now }],
      { onConflict: 'player_id,game_id' }
    );
    setReadMap(prev => new Map(prev).set(player.id, now));
  }, [gameId, player]);

  // ── Load + subscribe ─────────────────────────────────────────
  useEffect(() => {
    if (!player) return;

    supabase.from('open_games')
      .select('id, location, match_date, is_challenge, game_format, creator_id, creator:creator_id(name), participants:game_participants(player_id, status, player:player_id(name))')
      .eq('id', gameId).single()
      .then(({ data }) => { if (data) setGame(data as unknown as GameInfo); });

    Promise.all([
      supabase.from('messages').select('*').eq('game_id', gameId).order('created_at', { ascending: true }),
      supabase.from('game_chat_reads').select('player_id, last_read_at').eq('game_id', gameId),
    ]).then(([msgRes, readRes]) => {
      if (msgRes.data) setMessages(msgRes.data as Message[]);
      if (readRes.data) setReadMap(new Map((readRes.data as any[]).map(r => [r.player_id, r.last_read_at])));
      setLoading(false);
    });

    markRead();

    // Unique per mount: avoids reusing a still-subscribed channel after Fast Refresh.
    // One channel per event type: multi-binding on the same channel is known to drop
    // events (only one of the .on() handlers keeps firing).
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const msgInsertCh = supabase.channel(`chat-msg-ins:${gameId}:${suffix}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `game_id=eq.${gameId}` },
        payload => {
          const inc = payload.new as Message;
          setMessages(prev => prev.some(m => m.id === inc.id) ? prev : [...prev, inc]);
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
          markRead();
        }).subscribe();

    const msgUpdateCh = supabase.channel(`chat-msg-upd:${gameId}:${suffix}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `game_id=eq.${gameId}` },
        payload => {
          const upd = payload.new as Message;
          setMessages(prev => prev.map(m => m.id === upd.id ? { ...m, reactions: upd.reactions ?? {} } : m));
        }).subscribe();

    const readCh = supabase.channel(`reads-native:${gameId}:${suffix}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_chat_reads', filter: `game_id=eq.${gameId}` },
        payload => {
          const row = payload.new as { player_id: string; last_read_at: string };
          if (row?.player_id) setReadMap(prev => new Map(prev).set(row.player_id, row.last_read_at));
        }).subscribe();

    return () => {
      supabase.removeChannel(msgInsertCh);
      supabase.removeChannel(msgUpdateCh);
      supabase.removeChannel(readCh);
    };
  }, [gameId, player, markRead]);

  // ── Actions ──────────────────────────────────────────────────
  // Toggle: si je suis déjà dans la liste pour cet emoji → je m'enlève, sinon je m'ajoute.
  // Persistance directe en DB (jsonb messages.reactions), UI optimiste, l'UPDATE realtime
  // récupère l'état final (idempotent).
  const addReaction = useCallback(async (msgId: string, emoji: string) => {
    if (!player) return;
    setReactingId(null);
    rememberEmoji(emoji);
    // Don't persist on optimistic (not-yet-saved) messages
    if (msgId.startsWith('tmp-')) return;

    const myId = player.id;
    const current = messages.find(m => m.id === msgId);
    if (!current) return;
    const prevReactions = current.reactions ?? {};
    const prevEntry = prevReactions[emoji];

    // Defensive: tolerate legacy numeric format (count) — on toggle we reset that
    // emoji to a fresh array containing only the current player, matching the RPC.
    const prevList = Array.isArray(prevEntry) ? prevEntry : [];
    const nextList = prevList.includes(myId)
      ? prevList.filter(id => id !== myId)
      : [...prevList, myId];
    const nextReactions: Record<string, string[] | number> = { ...prevReactions };
    if (nextList.length === 0) delete nextReactions[emoji];
    else nextReactions[emoji] = nextList;

    // Optimistic update
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, reactions: nextReactions } : m));

    // Persist via SECURITY DEFINER RPC (toggles per-player, only touches reactions,
    // verifies participation in the game). Realtime UPDATE will reconcile.
    const { data, error } = await supabase.rpc('toggle_message_reaction', { p_message_id: msgId, p_emoji: emoji });
    if (error) {
      console.warn('toggleReaction failed', error.message);
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, reactions: prevReactions } : m));
      return;
    }
    const row = data as Message | null;
    if (row) setMessages(prev => prev.map(m => m.id === msgId ? { ...m, reactions: row.reactions ?? {} } : m));
  }, [player, messages, rememberEmoji]);

  const sendMessage = async () => {
    if (!text.trim() || !player || sending) return;
    setSending(true);
    const content = text.trim().slice(0, 500);
    setText('');
    const tempId = `tmp-${Date.now()}`;
    setMessages(prev => [...prev, { id: tempId, game_id: gameId, player_id: player.id, player_name: player.name, content, created_at: new Date().toISOString() }]);
    const { data } = await supabase.from('messages').insert([{ game_id: gameId, player_id: player.id, player_name: player.name, content }]).select().single();
    if (data) setMessages(prev => prev.map(m => m.id === tempId ? (data as Message) : m));

    // Notify other accepted participants (fire-and-forget)
    if (game) {
      const otherIds = [
        ...(game.participants ?? [])
          .filter((p: any) => p.status === 'accepted' && p.player_id !== player.id)
          .map((p: any) => p.player_id as string),
        ...(game.creator_id !== player.id ? [game.creator_id] : []),
      ];
      if (otherIds.length > 0) {
        notifyPlayers({
          playerIds: otherIds,
          title: `💬 ${player.name}`,
          body: content.length > 60 ? content.slice(0, 57) + '…' : content,
          data: { type: 'message', gameId },
        });
      }
    }

    setSending(false);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const gameDate = game ? new Date(game.match_date) : null;
  const dateStr = gameDate
    ? gameDate.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
      + ' · ' + gameDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : '…';

  // ── Render ───────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: Colors.heroBg }}>

      {/* ── Dark header ── */}
      <View style={{ backgroundColor: Colors.heroBg, paddingTop: insets.top + 6 }}>
        {/* Top row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 10 }}>
          <TouchableOpacity onPress={() => router.back()}
            style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M15 18l-6-6 6-6" />
            </Svg>
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 22, fontFamily: Fonts.welcome, color: Colors.textOnDark, letterSpacing: 0.2 }} numberOfLines={1}>
              Le <Text style={{ color: Colors.brand }}>Chat</Text>
            </Text>
            <Text style={{ fontSize: 11, fontFamily: Fonts.uiSemi, fontWeight: '600', color: Colors.textSecondary }} numberOfLines={1}>{dateStr} · 📍 {game?.location ?? '…'}</Text>
          </View>
          <TouchableOpacity onPress={() => setHeaderOpen(o => !o)}
            style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ transform: [{ rotate: headerOpen ? '180deg' : '0deg' }] }}>
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M6 9l6 6 6-6" />
              </Svg>
            </View>
          </TouchableOpacity>
        </View>

        {/* Expanded player panel */}
        {headerOpen && game && (
          <View style={{ paddingHorizontal: 14, paddingBottom: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)' }}>
            {/* Type badge */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <View style={{ backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, fontWeight: '900', color: theme.variant === 'ink' ? Colors.textOnDark : theme.accent, textTransform: 'uppercase', letterSpacing: 1 }}>{theme.label}</Text>
              </View>
              <Text style={{ fontSize: 11, fontFamily: Fonts.uiSemi, fontWeight: '600', color: Colors.textSecondary }} numberOfLines={1}>{game.location}</Text>
            </View>
            {/* Player avatars */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 20 }}>
              {allPlayers.map((p, i) => {
                const isMe = p.id === player?.id;
                const initials = p.name.split(' ').map((w: string) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
                return (
                  <View key={p.id} style={{ alignItems: 'center', gap: 4 }}>
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: playerColor(i), alignItems: 'center', justifyContent: 'center', shadowColor: playerColor(i), shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 }}>
                      <Text style={{ fontSize: 13, fontWeight: '900', color: Colors.textOnDark }}>{initials}</Text>
                    </View>
                    <Text style={{ fontSize: 9.5, fontWeight: '700', color: Colors.textMuted, maxWidth: 48, textAlign: 'center' }} numberOfLines={1}>
                      {isMe ? 'Toi' : p.name.split(' ')[0]}
                    </Text>
                    {isMe && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.accent }} />}
                  </View>
                );
              })}
            </View>
            {/* Separator */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.07)' }} />
              <Text style={{ fontSize: 9, fontWeight: '900', color: Colors.textSecondary, letterSpacing: 1.5 }}>ÉQUIPE A · VS · ÉQUIPE B</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.07)' }} />
            </View>
          </View>
        )}

        {/* Accent strip */}
        <View style={{ height: 3, backgroundColor: theme.strip }} />
      </View>

      {/* ── Messages ── */}
      <View style={{ flex: 1, backgroundColor: Colors.bgCardAlt }}>
        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={item => item.id}
            contentContainerStyle={{ padding: 12, paddingBottom: 16 }}
            onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
            extraData={{ reactingId, readByMsgId }}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingVertical: 60 }}>
                <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.bgCard, alignItems: 'center', justifyContent: 'center', marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
                  <Text style={{ fontSize: 26 }}>💬</Text>
                </View>
                <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary, marginBottom: 4 }}>Lancez la conversation !</Text>
                <Text style={{ fontSize: 12, color: Colors.textMuted, fontWeight: '600', textAlign: 'center' }}>
                  Organisez votre match, discutez du terrain…
                </Text>
              </View>
            }
            renderItem={({ item, index }) => (
              <MessageItem
                message={item}
                prevMessage={messages[index - 1]}
                isMe={item.player_id === player?.id}
                allPlayers={allPlayers}
                reactingId={reactingId}
                setReactingId={setReactingId}
                myId={player?.id ?? ''}
                addReaction={addReaction}
                onOpenFullPicker={(id) => { setReactingId(null); setPickerForMsgId(id); }}
                quickEmojis={quickEmojis}
                readers={readByMsgId.get(item.id) ?? []}
              />
            )}
          />
        )}
      </View>

      {/* ── Input bar ── */}
      <View style={{
        backgroundColor: Colors.bgCard, borderTopWidth: 1, borderTopColor: '#e2e8f0',
        flexDirection: 'row', alignItems: 'flex-end', gap: 8,
        paddingHorizontal: 12, paddingTop: 10, paddingBottom: insets.bottom + 10,
      }}>
        <View style={{ flex: 1, backgroundColor: Colors.bg, borderRadius: 22, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 10 }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message…"
            placeholderTextColor={Colors.textMuted}
            multiline
            maxLength={500}
            returnKeyType="send"
            blurOnSubmit={false}
            onSubmitEditing={sendMessage}
            style={{ fontSize: 14, fontWeight: '500', color: Colors.textPrimary, maxHeight: 100, padding: 0 }}
          />
        </View>
        <TouchableOpacity onPress={sendMessage} disabled={!text.trim() || sending}
          style={{
            width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.primary,
            alignItems: 'center', justifyContent: 'center',
            opacity: !text.trim() || sending ? 0.4 : 1,
            shadowColor: Colors.primary, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4,
          }}>
          {sending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke={Colors.textOnDark} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          )}
        </TouchableOpacity>
      </View>

      {/* Full emoji picker (clavier natif via rn-emoji-keyboard) */}
      <EmojiPicker
        open={pickerForMsgId !== null}
        onClose={() => setPickerForMsgId(null)}
        onEmojiSelected={(e: EmojiType) => {
          if (pickerForMsgId) addReaction(pickerForMsgId, e.emoji);
          setPickerForMsgId(null);
        }}
        enableRecentlyUsed
        enableSearchBar
        categoryPosition="top"
      />
    </KeyboardAvoidingView>
  );
}
