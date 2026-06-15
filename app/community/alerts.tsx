import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors } from '../../lib/theme';
import { NavBar } from '../../components/community/ui';
import { AlertsList } from '../../components/community/AlertsList';

// Ré-export pour compat : d'autres écrans peuvent importer ces helpers depuis ici.
export { alertTitle, alertDetail } from '../../components/community/AlertsList';

export default function AlertsListScreen() {
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <NavBar title="Mes alertes" onBack={() => router.back()} />
      <AlertsList />
    </View>
  );
}
