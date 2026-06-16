import { View, Text, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../hooks/usePlayer';
import { Colors, Fonts } from '../../lib/theme';
import { ActivityFeed } from '../../components/community/ActivityFeed';
import { ProfileAvatarButton } from '../../components/ProfileAvatarButton';

export default function ActiviteTab() {
  const insets = useSafeAreaInsets();
  const { player } = usePlayer();
  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {/* Pastille Profil — alignée avec le logo (cohérent avec accueil/lobby/défis). */}
      <ProfileAvatarButton style={{ position: 'absolute', top: insets.top + 6, right: 14, zIndex: 20 }} />

      {/* Dark header — même structure que le lobby / les défis */}
      <View style={{
        backgroundColor: Colors.heroBg,
        paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 16,
        borderBottomLeftRadius: 32, borderBottomRightRadius: 32,
      }}>
        {/* Brand lockup — raquette + wordmark PAGMATCH */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
          <Image
            source={require('../../assets/auth/splash-racket.png')}
            style={{ width: 22, height: 22 }}
            resizeMode="contain"
          />
          <Image
            source={require('../../assets/auth/splash-wordmark.png')}
            style={{ width: 100, height: 22, marginLeft: -7 }}
            resizeMode="contain"
          />
        </View>
        {/* Titre */}
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 28, fontFamily: Fonts.welcome, color: Colors.textOnDark, letterSpacing: 0.2, textAlign: 'center' }}>
            L'<Text style={{ color: Colors.brand }}>Activité</Text>
          </Text>
          <Text style={{ fontSize: 12, fontFamily: Fonts.uiSemi, fontWeight: '600', color: Colors.textSecondary, marginTop: 2, textAlign: 'center' }}>
            Le fil de tes amis
          </Text>
        </View>
      </View>

      {player ? <ActivityFeed myId={player.id} /> : null}
    </View>
  );
}
