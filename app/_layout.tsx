import '../global.css';
import { Stack, useSegments, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useFonts, Anton_400Regular } from '@expo-google-fonts/anton';
import { Manrope_600SemiBold, Manrope_700Bold } from '@expo-google-fonts/manrope';
import {
  Inter_400Regular, Inter_500Medium, Inter_600SemiBold,
  Inter_700Bold, Inter_800ExtraBold, Inter_900Black,
} from '@expo-google-fonts/inter';
import { BarlowCondensed_900Black_Italic } from '@expo-google-fonts/barlow-condensed';
import * as SplashScreen from 'expo-splash-screen';
import { PlayerProvider, usePlayer } from '../hooks/usePlayer';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { Colors } from '../lib/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

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
    const inProtectedRoute = segments[0] === '(tabs)' || segments[0] === 'chat';

    if (!player && inProtectedRoute) {
      // Direct the user back to the landing page.
      if (router.canDismiss()) {
        router.dismissAll();
      }
      router.replace('/');
    }
  }, [player, loading, segments, router]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="chat/[gameId]" options={{ presentation: 'card' }} />
      <Stack.Screen name="archived-chats" options={{ presentation: 'card' }} />
      <Stack.Screen name="score-entry" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Anton_400Regular,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Inter_900Black,
    BarlowCondensed_900Black_Italic,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <PlayerProvider>
      <StatusBar style="auto" backgroundColor="transparent" translucent />
      <RootNavigator />
    </PlayerProvider>
  );
}
