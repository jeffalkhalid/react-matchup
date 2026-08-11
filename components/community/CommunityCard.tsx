// Carte d'entrée "Communauté" pour l'accueil → ouvre le hub social.
import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { usePlayer } from '../../hooks/usePlayer';
import { Colors, Fonts } from '../../lib/theme';
import { getFriends } from '../../lib/community';
import { Avatar } from './Avatar';
import { Kicker } from './ui';
import { Icon } from './icons';
import type { SocialPlayer } from '../../types';

export function CommunityCard() {
  const router = useRouter();
  const { player } = usePlayer();
  const [friends, setFriends] = useState<SocialPlayer[]>([]);

  useEffect(() => { if (player) getFriends(player.id).then(setFriends); }, [player]);

  const preview = friends.slice(0, 2);
  const extra = friends.length - preview.length;

  return (
    <TouchableOpacity onPress={() => router.push('/community')} activeOpacity={0.9} style={{
      backgroundColor: Colors.heroBg, borderRadius: 22, paddingVertical: 10, paddingHorizontal: 15,
      flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, overflow: 'hidden',
      shadowColor: '#0A0A0A', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 5,
    }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: -40, right: -30, width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,193,26,0.14)' }} />

      {/* Avatars empilés */}
      {preview.length > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {preview.map((f, i) => (
            <View key={f.id} style={{ marginLeft: i === 0 ? 0 : -12, zIndex: 5 - i, borderWidth: 2, borderColor: Colors.heroBg, borderRadius: 13 }}>
              <Avatar name={f.name} size={34} radius={11} league={f.league} />
            </View>
          ))}
          {extra > 0 && (
            <View style={{
              marginLeft: -12, width: 38, height: 38, borderRadius: 13,
              backgroundColor: 'rgba(255,193,26,0.16)', borderWidth: 2, borderColor: Colors.heroBg,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 10, color: Colors.brand }}>+{extra}</Text>
            </View>
          )}
        </View>
      ) : (
        <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: 'rgba(255,193,26,0.14)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="users" size={19} color={Colors.brand} />
        </View>
      )}

      <View style={{ flex: 1, minWidth: 0 }}>
        <Kicker color={Colors.brand} style={{ fontSize: 9 }}>Communauté</Kicker>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: Fonts.welcome, fontSize: 16, lineHeight: 20, color: '#fff', marginTop: 2, letterSpacing: 0.3, paddingRight: 5 }}>
          Tes amis sur PagMatch
        </Text>
      </View>

      <View style={{ backgroundColor: Colors.brand, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 }}>
        <Text style={{ fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 10, color: Colors.primary, letterSpacing: 0.5 }}>VOIR TOUS</Text>
      </View>
    </TouchableOpacity>
  );
}
