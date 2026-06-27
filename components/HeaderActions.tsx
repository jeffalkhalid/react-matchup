import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { NotificationBell } from './NotificationBell';
import { ProfileAvatarButton } from './ProfileAvatarButton';
import { useNotificationCount } from '../hooks/useNotificationCount';

// Cluster du coin haut-droit des écrans principaux : cloche de notifs + avatar profil.
// Source UNIQUE de ce coin → un seul endroit à modifier pour les 5 onglets.
// Le total de notifs vient du hook partagé (même nombre que l'écran /notifications).
export function HeaderActions({ top, right, tint = 'light' }: {
  top: number; right: number; tint?: 'light' | 'dark';
}) {
  const router = useRouter();
  const { total } = useNotificationCount();
  return (
    <View style={{
      position: 'absolute', top, right, zIndex: 20,
      flexDirection: 'row', alignItems: 'center', gap: 10,
    }}>
      <NotificationBell count={total} tint={tint} onPress={() => router.push('/notifications' as any)} />
      <ProfileAvatarButton />
    </View>
  );
}
