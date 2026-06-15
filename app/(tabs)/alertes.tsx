import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../lib/theme';
import { AlertsList } from '../../components/community/AlertsList';

export default function AlertesTab() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <View style={{
        paddingTop: insets.top + 8, paddingBottom: 10, paddingHorizontal: 16,
        backgroundColor: Colors.bgCard, borderBottomWidth: 1, borderBottomColor: Colors.border,
      }}>
        <Text style={{ fontFamily: Fonts.uiBold, fontSize: 18, color: Colors.textPrimary }}>Alertes</Text>
      </View>
      <AlertsList />
    </View>
  );
}
