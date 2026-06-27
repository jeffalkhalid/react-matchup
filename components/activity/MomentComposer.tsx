import { useState, useEffect } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import type { StoryMatchData } from '../story/storyTheme';

const MAX = 140;

// Compositeur in-app : aperçu du match (bloc-score noir/jaune) + légende → Publier.
// AUCUN export externe. Publie via share_match_moment (lib/activityFeed).
export function MomentComposer({ visible, match, busy, onClose, onPublish }: {
  visible: boolean;
  match: StoryMatchData | null;
  busy: boolean;
  onClose: () => void;
  onPublish: (caption: string) => void;
}) {
  const [caption, setCaption] = useState('');
  useEffect(() => { if (visible) setCaption(''); }, [visible]);
  if (!match) return null;
  const win = match.result === 'win';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(10,10,10,0.6)' }}>
        <ScrollView keyboardShouldPersistTaps="handled" bounces={false}
          contentContainerStyle={{ backgroundColor: Colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 28, gap: 16 }}
          style={{ maxHeight: '88%' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: Fonts.welcome, fontSize: 20, color: Colors.textPrimary }}>Partager ce match</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}><Text style={{ fontFamily: Fonts.uiBlack, fontSize: 18, color: Colors.textSecondary }}>✕</Text></TouchableOpacity>
          </View>

          {/* Aperçu bloc-score (façon best moment) */}
          <View style={{ backgroundColor: Colors.bgDark, borderRadius: 18, padding: 18 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <View style={{ backgroundColor: win ? Colors.success : Colors.danger, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 9.5, color: '#FFFFFF', letterSpacing: 0.5 }}>{win ? 'VICTOIRE' : 'DÉFAITE'}</Text>
              </View>
              {match.location ? <Text style={{ fontFamily: Fonts.uiBold, fontSize: 10.5, color: 'rgba(255,255,255,0.5)' }} numberOfLines={1}>{match.location}</Text> : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                {match.winners.map((n, i) => <Text key={i} numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: '#FFFFFF' }}>{n}</Text>)}
              </View>
              <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 8 }}>
                {match.sets.map(([a, b], i) => (
                  <View key={i} style={{ alignItems: 'center' }}>
                    <Text style={{ fontFamily: Fonts.display, fontSize: 34, color: Colors.brand, lineHeight: 32 }}>{a}</Text>
                    <Text style={{ fontFamily: Fonts.display, fontSize: 34, color: 'rgba(255,255,255,0.35)', lineHeight: 32 }}>{b}</Text>
                  </View>
                ))}
              </View>
              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                {match.losers.map((n, i) => <Text key={i} numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{n}</Text>)}
              </View>
            </View>
          </View>

          <View style={{ backgroundColor: Colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 12 }}>
            <TextInput
              value={caption} onChangeText={t => t.length <= MAX && setCaption(t)}
              placeholder="Ajoute une légende… (optionnel)" placeholderTextColor={Colors.textMuted}
              multiline style={{ fontFamily: Fonts.ui, fontSize: 14, color: Colors.textPrimary, minHeight: 44 }}
            />
            <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 10, color: Colors.textMuted, textAlign: 'right' }}>{caption.length}/{MAX}</Text>
          </View>

          <TouchableOpacity onPress={() => onPublish(caption)} disabled={busy} activeOpacity={0.85}
            style={{ backgroundColor: Colors.primary, borderRadius: 999, paddingVertical: 14, alignItems: 'center' }}>
            <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 14, color: Colors.brand }}>{busy ? 'Publication…' : 'Publier'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
