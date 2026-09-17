import { TouchableOpacity, Text, ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { usePlayer } from '../hooks/usePlayer';
import { PlayerAvatar } from './PlayerAvatar';
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
      style={style}
    >
      <PlayerAvatar
        name={player.name}
        path={(player as any).avatar_path}
        size={size}
        backgroundColor={color}
        textColor={Colors.textOnDark}
        fontSize={Math.round(size * 0.4)}
        ring={2}
        ringColor="rgba(255,255,255,0.7)"
      />
    </TouchableOpacity>
  );
}
