import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../hooks/usePlayer';
import { Colors, Fonts } from '../../lib/theme';
import { ActivityFeed } from '../../components/community/ActivityFeed';

export default function ActiviteTab() {
  const insets = useSafeAreaInsets();
  const { player } = usePlayer();
  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <View style={{
        paddingTop: insets.top + 8, paddingBottom: 10, paddingHorizontal: 16,
        backgroundColor: Colors.bgCard, borderBottomWidth: 1, borderBottomColor: Colors.border,
      }}>
        <Text style={{ fontFamily: Fonts.uiBold, fontSize: 18, color: Colors.textPrimary }}>Activité</Text>
      </View>
      {player ? <ActivityFeed myId={player.id} /> : null}
    </View>
  );
}
