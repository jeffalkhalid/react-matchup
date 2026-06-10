import '../global.css';
import { Stack } from 'expo-router';
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
import { NotificationProvider } from '../hooks/useNotificationCount';
import { usePushNotifications } from '../hooks/usePushNotifications';
import InAppBanner from '../components/InAppBanner';
import { Colors } from '../lib/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

export const unstable_settings = {
  initialRouteName: 'index',
};

function RootNavigator() {
  const { player } = usePlayer();
  usePushNotifications();

  // Auth gating DÉCLARATIF via <Stack.Protected>. Quand `player` passe à null
  // (déconnexion), expo-router démonte les écrans protégés et retombe tout seul
  // sur `index` (initialRouteName). On évite ainsi l'ancien `router.replace('/')`
  // impératif dans un useEffect qui, sur Android (New Arch + native-stack
  // react-native-screens), réduisait transitoirement la pile native à zéro écran
  // → l'activité se terminait et l'app se fermait « comme un crash ».
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      {/* Écrans légaux : publics (accessibles depuis l'inscription, hors guard). */}
      <Stack.Screen name="legal/confidentialite" options={{ presentation: 'card' }} />
      <Stack.Screen name="legal/cgu" options={{ presentation: 'card' }} />
      <Stack.Protected guard={!!player}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="community" />
        <Stack.Screen name="chat/[gameId]" options={{ presentation: 'card' }} />
        <Stack.Screen name="archived-chats" options={{ presentation: 'card' }} />
        <Stack.Screen name="score-entry" options={{ presentation: 'modal' }} />
      </Stack.Protected>
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
      <NotificationProvider>
        <StatusBar style="auto" backgroundColor="transparent" translucent />
        <RootNavigator />
        {/* Bannière notif in-app — par-dessus la navigation, sous les providers. */}
        <InAppBanner />
      </NotificationProvider>
    </PlayerProvider>
  );
}
