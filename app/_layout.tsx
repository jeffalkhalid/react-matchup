import '../global.css';
import { Stack, useSegments, useNavigationContainerRef } from 'expo-router';
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
  const navigationRef = useNavigationContainerRef();
  usePushNotifications();

  useEffect(() => {
    if (loading) return;
    if (!player && segments[0] === '(tabs)') {
      // router.replace('/') is ambiguous between app/index.tsx and (tabs)/index.tsx
      // because (tabs) is a transparent group — both map to '/'.
      // Reset the root navigation state directly to bypass URL resolution.
      navigationRef.reset({
        index: 0,
        routes: [{ name: 'index' }],
      });
    }
  }, [player, loading, segments]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F8FAFC' } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="player/[id]" options={{ presentation: 'card' }} />
      <Stack.Screen name="chat/[gameId]" options={{ presentation: 'card' }} />
      <Stack.Screen name="score-entry" options={{ presentation: 'modal' }} />
      <Stack.Screen name="admin" options={{ presentation: 'card' }} />
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
