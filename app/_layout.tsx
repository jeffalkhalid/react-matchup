import '../global.css';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
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
import { BadgeDefsProvider } from '../components/profile/BadgeDefsProvider';
import { usePushNotifications } from '../hooks/usePushNotifications';
import InAppBanner from '../components/InAppBanner';
import { Colors } from '../lib/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

export const unstable_settings = {
  initialRouteName: 'index',
};

// Expo Router appelle ce composant quand le rendu d'un écran lève une exception.
// Sans lui, l'app affiche un écran BLANC et devient inutilisable, sans dire
// pourquoi (constaté le 2026-09-16 en ouvrant une fiche). Le message est donc
// montré, et « Réessayer » relance l'écran sans redémarrer l'app.
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg, padding: 20, justifyContent: 'center' }}>
      <Text style={{ fontSize: 20, fontWeight: '900', color: Colors.textPrimary, marginBottom: 8 }}>
        Cet écran n’a pas pu s’afficher
      </Text>
      <ScrollView style={{ maxHeight: 260, backgroundColor: Colors.bgCardAlt, borderRadius: 12, padding: 12 }}>
        <Text selectable style={{ fontSize: 12, color: Colors.textPrimary }}>
          {String(error?.message ?? error)}
        </Text>
      </ScrollView>
      <TouchableOpacity
        onPress={() => { void retry(); }}
        activeOpacity={0.85}
        style={{ marginTop: 16, backgroundColor: Colors.brand, borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}>
        <Text style={{ fontWeight: '900', color: Colors.textOnBrand }}>Réessayer</Text>
      </TouchableOpacity>
    </View>
  );
}

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
        {/* Profil joueur : écran POUSSÉ sur la pile racine (au-dessus des onglets)
            → vrai historique de navigation (profil A → profil B → retour) +
            geste de retour iOS natif. Était un onglet caché (singleton, sans
            historique) avant 2026-08-08. */}
        <Stack.Screen name="player/[id]" options={{ presentation: 'card' }} />
        {/* Classement & Notifications : écrans POUSSÉS sur la pile racine (au-dessus
            des onglets) → historique de navigation + geste retour iOS natif.
            Étaient des onglets cachés (singletons, sans historique) avant 2026-08-08. */}
        <Stack.Screen name="ranking" options={{ presentation: 'card' }} />
        <Stack.Screen name="notifications" options={{ presentation: 'card' }} />
        {/* Localisation : zone de référence du joueur (point + rayon). */}
        <Stack.Screen name="zone" options={{ presentation: 'card' }} />
        {/* Tournois montante / descente. L'entrée du menu est masquée quand
            l'interrupteur serveur est éteint (défaut) ; ces écrans se referment
            alors d'eux-mêmes si on y arrive par un lien direct. */}
        <Stack.Screen name="tournaments/index" options={{ presentation: 'card' }} />
        <Stack.Screen name="tournaments/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="tournaments/parcours" options={{ presentation: 'card' }} />
        <Stack.Screen name="tournaments/create" options={{ presentation: 'card' }} />
        <Stack.Screen name="community" />
        <Stack.Screen name="chat/[gameId]" options={{ presentation: 'card' }} />
        <Stack.Screen name="dm/[conversationId]" options={{ presentation: 'card' }} />
        <Stack.Screen name="archived-chats" options={{ presentation: 'card' }} />
        <Stack.Screen name="live/[sessionId]" options={{ presentation: 'card' }} />
        <Stack.Screen name="score-entry" options={{ presentation: 'modal' }} />
        <Stack.Screen name="bilan/[month]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
        <Stack.Screen name="ambassador-welcome" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
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
        <BadgeDefsProvider>
          {/* Bord a bord depuis la SDK 55 : la barre est transparente et traversee
              par defaut, `backgroundColor` et `translucent` ont ete retires. */}
          <StatusBar style="auto" />
          <RootNavigator />
          {/* Bannière notif in-app — par-dessus la navigation, sous les providers. */}
          <InAppBanner />
        </BadgeDefsProvider>
      </NotificationProvider>
    </PlayerProvider>
  );
}
