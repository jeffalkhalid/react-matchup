import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../../hooks/usePlayer';
import { Colors, Fonts } from '../../../lib/theme';
import { getComments, addComment, deleteComment, toggleCommentReaction } from '../../../lib/community';
import { getHiddenPlayerIds, reportContent } from '../../../lib/moderation';
import { containsProfanity } from '../../../lib/profanity';
import { Avatar } from '../../../components/community/Avatar';
import { Icon } from '../../../components/community/icons';
import type { ActivityComment } from '../../../types';

const ERR: Record<string, string> = {
  policy: "L'auteur n'autorise pas ce commentaire.",
  blocked: 'Action impossible (blocage).',
  rate: 'Tu commentes trop vite, réessaie dans un instant.',
  length: 'Commentaire vide ou trop long (500 max).',
  unknown: "Le commentaire n'a pas pu être envoyé.",
};

export default function CommentsScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { player } = usePlayer();
  const myId = player?.id ?? '';

  const [comments, setComments] = useState<ActivityComment[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    if (!eventId || !myId) return;
    setLoading(true);
    Promise.all([getComments(String(eventId)), getHiddenPlayerIds(myId)]).then(([cs, hidden]) => {
      setComments(cs); setHiddenIds(hidden); setLoading(false);
    });
  }, [eventId, myId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const send = async () => {
    const content = text.trim();
    if (!content || !player) return;
    if (containsProfanity(content)) {
      Alert.alert('Commentaire refusé', 'Ton commentaire enfreint les règles de la communauté.');
      return;
    }
    setSending(true);
    const res = await addComment(String(eventId), content, player);
    setSending(false);
    if (!res.ok) { Alert.alert('Oups', ERR[res.reason]); return; }
    setText('');
    setComments(prev => [...prev, res.comment]);
  };

  const removeMine = (c: ActivityComment) => {
    Alert.alert('Supprimer', 'Supprimer ton commentaire ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive',
        onPress: async () => { await deleteComment(c.id); setComments(prev => prev.filter(x => x.id !== c.id)); },
      },
    ]);
  };

  const report = (c: ActivityComment) => {
    Alert.alert('Ce commentaire', undefined, [
      {
        text: 'Signaler', style: 'destructive',
        onPress: async () => {
          try {
            await reportContent({ reporterId: myId, targetType: 'comment', targetId: c.id, reportedPlayerId: c.player_id });
            Alert.alert('Merci', 'Commentaire signalé à la modération.');
          } catch { Alert.alert('Erreur', "Le signalement n'a pas pu être envoyé."); }
        },
      },
      { text: 'Annuler', style: 'cancel' },
    ]);
  };

  const reactToComment = async (commentId: string) => {
    if (!myId) return;
    setComments(prev => prev.map(c => {
      if (c.id !== commentId) return c;
      const fire = c.reactions?.['🔥'] ?? [];
      const has = fire.includes(myId);
      const next = has ? fire.filter(idx => idx !== myId) : [...fire, myId];
      const reactions = { ...c.reactions };
      if (next.length) reactions['🔥'] = next; else delete reactions['🔥'];
      return { ...c, reactions };
    }));
    const updated = await toggleCommentReaction(commentId);
    if (updated) setComments(prev => prev.map(c => c.id === commentId ? { ...c, reactions: updated } : c));
  };

  const visible = comments.filter(c => !hiddenIds.has(c.player_id));

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: Colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
      <View style={{ flex: 1, paddingTop: insets.top + 8 }}>
        {/* En-tête */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 10 }}>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.85}
            style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chevronLeft" size={20} color={Colors.textPrimary} />
          </TouchableOpacity>
          <Text style={{ fontFamily: Fonts.welcome, fontSize: 20, color: Colors.textPrimary, textTransform: 'uppercase', letterSpacing: 0.3 }}>
            Commentaires
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 12 }}>
            {visible.length === 0 ? (
              <Text style={{ fontFamily: Fonts.ui, fontSize: 14, color: Colors.textSecondary, textAlign: 'center', marginTop: 30 }}>
                Sois le premier à commenter 🔥
              </Text>
            ) : visible.map(c => (
              <View key={c.id} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                <TouchableOpacity onPress={() => c.player_id && router.push(`/player/${c.player_id}` as any)} activeOpacity={0.7} disabled={!c.player_id}>
                  <Avatar name={c.actor?.name} size={36} radius={11} league={c.league ?? 'discovery'} />
                </TouchableOpacity>
                <View style={{ flex: 1, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 12 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: Colors.textPrimary }}>
                      {c.actor?.name ?? 'Joueur'}
                    </Text>
                    <TouchableOpacity onPress={() => (c.player_id === myId ? removeMine(c) : report(c))} hitSlop={8}>
                      <Text style={{ fontSize: 16, color: Colors.textMuted, marginTop: -4 }}>⋯</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={{ fontFamily: Fonts.ui, fontSize: 14, color: Colors.textPrimary, marginTop: 3 }}>
                    {c.content}
                  </Text>
                  <TouchableOpacity onPress={() => reactToComment(c.id)} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, alignSelf: 'flex-start' }}>
                    <Text style={{ fontSize: 15, opacity: (c.reactions?.['🔥'] ?? []).includes(myId) ? 1 : 0.5 }}>🔥</Text>
                    {(c.reactions?.['🔥'] ?? []).length > 0 && (
                      <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: (c.reactions?.['🔥'] ?? []).includes(myId) ? Colors.brandDeep : Colors.textMuted }}>
                        {(c.reactions?.['🔥'] ?? []).length}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
        )}

        {/* Saisie */}
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 10, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.bg }}>
          <TextInput
            value={text} onChangeText={setText} placeholder="Écris un commentaire…"
            placeholderTextColor={Colors.textMuted} maxLength={500} multiline
            style={{ flex: 1, fontFamily: Fonts.ui, fontSize: 14, color: Colors.textPrimary, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, maxHeight: 110 }}
          />
          <TouchableOpacity onPress={send} disabled={sending || !text.trim()} activeOpacity={0.85}
            style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: text.trim() ? Colors.primary : Colors.bgCard, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}>
            {sending
              ? <ActivityIndicator color={Colors.brand} />
              : <Icon name="arrowRight" size={18} color={text.trim() ? Colors.brand : Colors.textMuted} stroke={2.4} rotate={-45} />}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
