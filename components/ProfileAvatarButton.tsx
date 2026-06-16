import { TouchableOpacity, Text, ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { usePlayer } from '../hooks/usePlayer';
import { Colors, getLeague } from '../lib/theme';

// Avatar Profil affiché en haut à droite des écrans principaux.
// Tap → ouvre le profil complet de l'utilisateur (écran poussé, avec retour + burger).
export function ProfileAvatarButton({ size = 36, style }: { size?: number; style?: ViewStyle }) {
  const router = useRouter();
  const { player } = usePlayer();
  if (!player) return null;
  const league = getLeague(player.elo_score);
  const color = Colors.league[league];
  return (
    <TouchableOpacity
      onPress={() => router.push(`/player/${player.id}` as any)}
      activeOpacity={0.85}
      style={[{
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: color, alignItems: 'center', justifyContent: 'center',
        borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)',
      }, style]}
    >
      <Text style={{ color: Colors.textOnDark, fontWeight: '900', fontSize: Math.round(size * 0.4) }}>
        {player.name.charAt(0).toUpperCase()}
      </Text>
    </TouchableOpacity>
  );
}
