import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePlayer } from './usePlayer';
import {
  DirectConversation, fetchConversations, unreadFor, isRequestFor, otherId,
} from '../lib/directChats';
import { getBlockedByMe } from '../lib/moderation';

export function useDirectChats() {
  const { player } = usePlayer();
  const [all, setAll] = useState<DirectConversation[]>([]);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!player) return;
    if (!loadedRef.current) setLoading(true);
    try {
      const [rows, blocked] = await Promise.all([
        fetchConversations(),
        getBlockedByMe(player.id),
      ]);
      setAll(rows);
      setBlockedIds(new Set(blocked));
    } catch (e) {
      console.log('[useDirectChats] load failed', String(e));
    } finally {
      loadedRef.current = true;
      setLoading(false);
    }
  }, [player]);

  useEffect(() => { load(); }, [load]);

  // Realtime : tout changement de conversation/message → recharge (léger).
  useEffect(() => {
    if (!player) return;
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ch = supabase
      .channel(`direct-chats:${player.id}:${suffix}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_conversations' }, () => load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [player, load]);

  const myId = player?.id ?? '';
  const requests = all.filter(c => isRequestFor(c, myId));
  const conversations = all.filter(c => c.status === 'accepted');
  const totalUnread = conversations.reduce((s, c) => s + unreadFor(c, myId), 0);

  // Une conversation est "bloquée" (de mon point de vue) si j'ai bloqué l'autre.
  const isConversationBlocked = (conv: DirectConversation) => blockedIds.has(otherId(conv, myId));

  return {
    conversations, requests, loading,
    totalUnread, requestsCount: requests.length, load,
    isConversationBlocked,
  };
}
