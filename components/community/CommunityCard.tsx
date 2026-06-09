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

  const preview = friends.slice(0, 3);

  return (
    <TouchableOpacity onPress={() => router.push('/community')} activeOpacity={0.9} style={{
      backgroundColor: Colors.heroBg, borderRadius: 22, paddingVertical: 16, paddingHorizontal: 18,
      flexDirection: 'row', alignItems: 'center', gap: 14, overflow: 'hidden',
      shadowColor: '#0A0A0A', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 5,
    }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: -40, right: -30, width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,193,26,0.14)' }} />

      {/* Avatars empilés */}
      {preview.length > 0 ? (
        <View style={{ flexDirection: 'row' }}>
          {preview.map((f, i) => (
            <View key={f.id} style={{ marginLeft: i === 0 ? 0 : -14, zIndex: 3 - i, borderWidth: 2, borderColor: Colors.heroBg, borderRadius: 14 }}>
              <Avatar name={f.name} size={38} radius={12} league={f.league} />
            </View>
          ))}
        </View>
      ) : (
        <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: 'rgba(255,193,26,0.14)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="users" size={22} color={Colors.brand} />
        </View>
      )}

      <View style={{ flex: 1 }}>
        <Kicker color={Colors.brand} style={{ fontSize: 10 }}>Communauté</Kicker>
        <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 16, color: '#fff', marginTop: 3 }}>Tes amis sur PagMatch</Text>
      </View>

      <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: Colors.brand, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="chevronRight" size={19} color={Colors.primary} stroke={2.6} />
      </View>
    </TouchableOpacity>
  );
}
