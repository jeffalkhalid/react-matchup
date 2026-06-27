import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Avatar } from '../community/Avatar';
import type { SocialPlayer } from '../../types';

// « Joueurs autour de toi » — suggestions (amis d'amis / même club / niveau proche).
// Si `onFollow` est fourni, un bouton « Suivre » apparaît (devient « Suivi ✓»).
export function DiscoveryRail({ players, title = 'Joueurs autour de toi', onPress, onFollow }: {
  players: SocialPlayer[];
  title?: string;
  onPress: (id: string) => void;
  onFollow?: (id: string) => void;
}) {
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  if (players.length === 0) return null;
  return (
    <View style={{ marginTop: 18 }}>
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 16, color: Colors.textPrimary, marginBottom: 10 }}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 16 }}>
        {players.map(p => {
          const isFollowed = followed.has(p.id);
          return (
            <View key={p.id} style={{ width: 150, borderRadius: 16, padding: 14, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', gap: 8 }}>
              <TouchableOpacity onPress={() => onPress(p.id)} activeOpacity={0.85} style={{ alignItems: 'center', gap: 8 }}>
                <Avatar name={p.name} size={56} radius={999} league={p.league} />
                <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: Colors.textPrimary, maxWidth: 122 }}>{p.name.split(' ')[0]}</Text>
                <Text numberOfLines={2} style={{ fontFamily: Fonts.uiSemi, fontSize: 10.5, color: Colors.textSecondary, textAlign: 'center', minHeight: 28 }}>{p.reason ?? 'Niveau proche'}</Text>
              </TouchableOpacity>
              {onFollow ? (
                <TouchableOpacity
                  onPress={() => { if (!isFollowed) { onFollow(p.id); setFollowed(prev => new Set(prev).add(p.id)); } }}
                  disabled={isFollowed} activeOpacity={0.85}
                  style={{ alignSelf: 'stretch', borderRadius: 999, paddingVertical: 8, alignItems: 'center', backgroundColor: isFollowed ? Colors.bg : Colors.primary, borderWidth: isFollowed ? 1 : 0, borderColor: Colors.border }}>
                  <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: isFollowed ? Colors.textSecondary : Colors.brand }}>{isFollowed ? 'Suivi ✓' : 'Suivre'}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
