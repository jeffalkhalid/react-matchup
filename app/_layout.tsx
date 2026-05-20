import '../global.css';
import { Stack, useSegments, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { PlayerProvider, usePlayer } from '../hooks/usePlayer';
import { usePushNotifications } from '../hooks/usePushNotifications';

export const unstable_settings = {
  initialRouteName: 'index',
};

function RootNavigator() {
  const { player, loading } = usePlayer();
  const segments = useSegments();
  const router = useRouter();
  usePushNotifications();

  useEffect(() => {
    if (loading) return;
    
    // Protected route groups
    const inProtectedRoute = segments[0] === '(tabs)' || 
                             segments[0] === 'chat' || 
                             segments[0] === 'player' || 
                             segments[0] === 'admin';

    if (!player && inProtectedRoute) {
      // Direct the user back to the landing page.
      if (router.canDismiss()) {
        router.dismissAll();
      }
      router.replace('/');
    }
  }, [player, loading, segments, router]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F8FAFC' } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="player/[id]" options={{ presentation: 'card' }} />
      <Stack.Screen name="chat/[gameId]" options={{ presentation: 'card' }} />
      <Stack.Screen name="score-entry" options={{ presentation: 'modal' }} />
      <Stack.Screen name="admin" options={{ presentation: 'card' }} />
      <Stack.Screen name="notifications" options={{ presentation: 'card' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <PlayerProvider>
      <StatusBar style="auto" backgroundColor="transparent" translucent />
      <RootNavigator />
    </PlayerProvider>
  );
}
