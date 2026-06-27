import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform, Alert, Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { supabase } from '../../lib/supabase';
import { usePlayer } from '../../hooks/usePlayer';
import { Colors, Fonts } from '../../lib/theme';
import {
  DirectConversation, DirectMessage, fetchMessages, sendDirectMessage,
  respondDirectRequest, markConversationRead, otherId, otherName, otherPhoto, isRequestFor,
} from '../../lib/directChats';
import { blockUser, reportContent } from '../../lib/moderation';
import ReportReasonSheet from '../../components/ReportReasonSheet';

// ─── Helpers ──────────────────────────────────────────────────
function initialsOf(name: string): string {
  return name.split(' ').map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';
}

// Avatar (photo si dispo, sinon initiales colorées) — même esprit que le chat de match.
function Avatar({ name, photo, size = 30 }: { name: string; photo: string | null; size?: number }) {
  if (photo) {
    return <Image source={{ uri: photo }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: Colors.bgCardAlt }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: Colors.brand, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.36, fontWeight: '900', color: Colors.textOnDark }}>{initialsOf(name)}</Text>
    </View>
  );
}

// ─── Message bubble (calqué sur app/chat/[gameId].tsx) ────────
interface BubbleProps {
  message: DirectMessage;
  prev?: DirectMessage;
  isMe: boolean;
  otherNameStr: string;
  otherPhotoStr: string | null;
}
function MessageBubble({ message: m, prev, isMe, otherNameStr, otherPhotoStr }: BubbleProps) {
  const time = new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const senderChanged = !prev || prev.sender_id !== m.sender_id;

  return (
    <View style={{ paddingTop: senderChanged ? 12 : 3 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
        {/* Avatar (autrui, seulement au changement d'expéditeur) */}
        {!isMe && (
          <View style={{ width: 28, alignSelf: 'flex-end' }}>
            {senderChanged ? <Avatar name={otherNameStr} photo={otherPhotoStr} size={28} /> : null}
          </View>
        )}

        <View style={{ maxWidth: '74%', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
          <View style={{
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
            <Text style={{ fontSize: 14.5, fontWeight: '500', color: isMe ? Colors.textOnDark : Colors.textPrimary, lineHeight: 20 }}>
              {m.content}
            </Text>
          </View>
          <Text style={{ fontSize: 9.5, fontWeight: '600', color: Colors.textMuted, marginTop: 3, marginHorizontal: 4 }}>{time}</Text>
        </View>
      </View>
    </View>
  );
}

export default function DirectChatScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const { player } = usePlayer();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [conv, setConv] = useState<DirectConversation | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const listRef = useRef<FlatList>(null);

  const reload = useCallback(async () => {
    if (!conversationId || !player) return;
    const { data: c } = await supabase
      .from('direct_conversations')
      .select('*, requester:players!requester_id(name,avatar_url), addressee:players!addressee_id(name,avatar_url)')
      .eq('id', conversationId)
      .single();
    setConv((c as DirectConversation) ?? null);
    setMessages(await fetchMessages(conversationId));
    setLoading(false);
    if (c) markConversationRead(c as DirectConversation, player.id);
  }, [conversationId, player]);

  useEffect(() => { reload(); }, [reload]);

  // Realtime sur les messages de cette conversation.
  useEffect(() => {
    if (!conversationId || !player) return;
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ch = supabase
      .channel(`dm:${conversationId}:${suffix}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'direct_messages', filter: `conversation_id=eq.${conversationId}` },
        () => reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [conversationId, player, reload]);

  const myId = player?.id ?? '';
  const isIncomingRequest = conv ? isRequestFor(conv, myId) : false;
  // Le requester peut écrire 1 message en pending ; sinon il faut accepted.
  const canWrite = !!conv && (conv.status === 'accepted' ||
    (conv.status === 'pending' && conv.requester_id === myId && messages.length === 0));
  const otherNameStr = conv ? otherName(conv, myId) : '';
  const otherPhotoStr = conv ? otherPhoto(conv, myId) : null;

  // Sous-titre d'en-tête selon l'état de la conversation.
  const subtitle = !conv ? '' :
    conv.status === 'accepted' ? 'Message direct' :
    conv.requester_id === myId ? 'Demande envoyée · en attente' :
    'Souhaite discuter avec toi';

  const onSend = async () => {
    if (!text.trim() || !player || !conv || sending || !canWrite) return;
    setSending(true);
    const content = text.trim();
    setText('');
    try {
      await sendDirectMessage(conv, content, player.name);
      await reload();
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      console.log('[dm] send failed', String(e));
      Alert.alert('Message non envoyé', 'Réessaie dans un instant.');
    } finally {
      setSending(false);
    }
  };

  const onRespond = async (accept: boolean) => {
    if (!conv) return;
    await respondDirectRequest(conv.id, accept);
    if (accept) reload(); else router.back();
  };

  const onBlock = async () => {
    if (!player || !conv) return;
    const target = otherId(conv, player.id);
    try { await blockUser(player.id, target); } catch {}
    router.back();
  };

  const submitReport = async (reason: string) => {
    setReportSheetOpen(false);
    if (!player || !conv) return;
    const target = otherId(conv, player.id);
    try {
      await reportContent({ reporterId: player.id, targetType: 'player', targetId: target, reportedPlayerId: target, reason: reason || null });
      Alert.alert('Merci', 'Signalement envoyé à la modération.');
    } catch {
      Alert.alert('Erreur', "Le signalement n'a pas pu être envoyé.");
    }
  };

  const openOptions = () => {
    Alert.alert('Options', undefined, [
      { text: 'Voir le profil', onPress: () => conv && router.push(`/player/${otherId(conv, myId)}` as any) },
      { text: 'Bloquer', style: 'destructive', onPress: onBlock },
      { text: 'Signaler', onPress: () => setReportSheetOpen(true) },
      { text: 'Annuler', style: 'cancel' },
    ]);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: Colors.heroBg }}>

      {/* ── Dark header ── */}
      <View style={{ backgroundColor: Colors.heroBg, paddingTop: insets.top + 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 10 }}>
          <TouchableOpacity onPress={() => router.back()}
            style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M15 18l-6-6 6-6" />
            </Svg>
          </TouchableOpacity>

          <TouchableOpacity activeOpacity={0.7} disabled={!conv}
            onPress={() => conv && router.push(`/player/${otherId(conv, myId)}` as any)}>
            <Avatar name={otherNameStr} photo={otherPhotoStr} size={38} />
          </TouchableOpacity>

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 16, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textOnDark }} numberOfLines={1}>
              {otherNameStr || 'Conversation'}
            </Text>
            <Text style={{ fontSize: 11, fontFamily: Fonts.uiSemi, fontWeight: '600', color: Colors.textSecondary }} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>

          <TouchableOpacity onPress={openOptions}
            style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="rgba(255,255,255,0.7)">
              <Path d="M12 8a2 2 0 100-4 2 2 0 000 4zm0 2a2 2 0 100 4 2 2 0 000-4zm0 6a2 2 0 100 4 2 2 0 000-4z" />
            </Svg>
          </TouchableOpacity>
        </View>
        <View style={{ height: 3, backgroundColor: Colors.brand }} />
      </View>

      {/* ── Messages ── */}
      <View style={{ flex: 1, backgroundColor: Colors.bgCardAlt }}>
        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={m => m.id}
            contentContainerStyle={{ padding: 12, paddingBottom: 16 }}
            onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingVertical: 60 }}>
                <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.bgCard, alignItems: 'center', justifyContent: 'center', marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
                  <Text style={{ fontSize: 26 }}>💬</Text>
                </View>
                <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary, marginBottom: 4 }}>
                  {isIncomingRequest ? 'Nouvelle demande de message' : 'Lancez la conversation !'}
                </Text>
                <Text style={{ fontSize: 12, color: Colors.textMuted, fontWeight: '600', textAlign: 'center', paddingHorizontal: 24 }}>
                  {isIncomingRequest
                    ? `${otherNameStr} souhaite discuter avec toi.`
                    : 'Dis bonjour, propose un créneau…'}
                </Text>
              </View>
            }
            renderItem={({ item, index }) => (
              <MessageBubble
                message={item}
                prev={messages[index - 1]}
                isMe={item.sender_id === myId}
                otherNameStr={otherNameStr}
                otherPhotoStr={otherPhotoStr}
              />
            )}
          />
        )}
      </View>

      {/* ── Request banner (demande reçue) ── */}
      {isIncomingRequest && (
        <View style={{ backgroundColor: Colors.bgCard, borderTopWidth: 1, borderTopColor: Colors.border, paddingHorizontal: 14, paddingTop: 12, paddingBottom: insets.bottom + 12, gap: 10 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.textSecondary, textAlign: 'center' }}>
            Accepte pour répondre à {otherNameStr}.
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={() => onRespond(true)} style={{ flex: 1, backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 13, alignItems: 'center', shadowColor: Colors.primary, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 }}>
              <Text style={{ color: Colors.textOnDark, fontWeight: '900', fontSize: 14 }}>Accepter</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onRespond(false)} style={{ flex: 1, borderWidth: 1.5, borderColor: Colors.border, borderRadius: 14, paddingVertical: 13, alignItems: 'center' }}>
              <Text style={{ color: Colors.textPrimary, fontWeight: '900', fontSize: 14 }}>Refuser</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onBlock} style={{ borderWidth: 1.5, borderColor: Colors.danger, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center' }}>
              <Text style={{ color: Colors.danger, fontWeight: '900', fontSize: 14 }}>Bloquer</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Input bar ── */}
      {!isIncomingRequest && (
        <View style={{
          backgroundColor: Colors.bgCard, borderTopWidth: 1, borderTopColor: '#e2e8f0',
          flexDirection: 'row', alignItems: 'flex-end', gap: 8,
          paddingHorizontal: 12, paddingTop: 10, paddingBottom: insets.bottom + 10,
        }}>
          <View style={{ flex: 1, backgroundColor: Colors.bg, borderRadius: 22, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 10, opacity: canWrite ? 1 : 0.6 }}>
            <TextInput
              value={text}
              onChangeText={setText}
              editable={canWrite}
              placeholder={canWrite ? 'Message…' : "En attente d'acceptation…"}
              placeholderTextColor={Colors.textMuted}
              multiline
              maxLength={500}
              returnKeyType="send"
              blurOnSubmit={false}
              onSubmitEditing={onSend}
              style={{ fontSize: 14, fontWeight: '500', color: Colors.textPrimary, maxHeight: 100, padding: 0 }}
            />
          </View>
          <TouchableOpacity onPress={onSend} disabled={!canWrite || sending || !text.trim()}
            style={{
              width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.primary,
              alignItems: 'center', justifyContent: 'center',
              opacity: !canWrite || !text.trim() || sending ? 0.4 : 1,
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
      )}

      <ReportReasonSheet
        visible={reportSheetOpen}
        title="Signaler ce joueur"
        onCancel={() => setReportSheetOpen(false)}
        onSubmit={submitReport}
      />
    </KeyboardAvoidingView>
  );
}
