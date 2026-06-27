import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { usePlayer } from './usePlayer';
import { Colors } from '../lib/theme';
import { track } from '../lib/analytics';

// Push tokens don't work in Expo Go since SDK 53 — only in dev/prod builds
const IS_EXPO_GO = Constants.appOwnership === 'expo';

// Foreground: show banner + sound even when app is open
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  true,
    shouldShowBanner: true,
    shouldShowList:   true,
  }),
});

// Récupère le token Expo et l'enregistre en DB.
// - promptIfNeeded=true  (défaut) : demande la permission si besoin. À RÉSERVER à un
//   moment explicite choisi par l'utilisateur (écran final de l'onboarding « Activer »).
// - promptIfNeeded=false : ne prompte JAMAIS ; rafraîchit le token seulement si la
//   permission est déjà accordée. À utiliser au montage (hook) pour ne pas voler le
//   focus juste après un login — ce qui écraserait la feuille « Enregistrer le mdp ? ».
// Idempotent : un appel sur permission déjà accordée ne re-prompte pas.
export async function registerForPushAsync(
  playerId: string,
  opts: { promptIfNeeded?: boolean } = {},
): Promise<'granted' | 'denied' | 'skipped'> {
  const { promptIfNeeded = true } = opts;
  if (IS_EXPO_GO) { console.log('[push] Expo Go → enregistrement impossible (build natif requis)'); return 'skipped'; }
  try {
    // Android requires a notification channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: Colors.brand,
      });
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      if (!promptIfNeeded) { console.log('[push] permission non accordée + prompt désactivé → skip'); return 'skipped'; }
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    console.log('[push] permission =', finalStatus);
    if (finalStatus !== 'granted') { console.log('[push] permission refusée → stop'); return 'denied'; }

    console.log('[push] projectId =', process.env.EXPO_PUBLIC_PROJECT_ID);
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
    });
    const token = tokenData.data;
    console.log('[push] token obtenu =', token);

    const { error } = await supabase
      .from('players')
      .update({ push_token: token })
      .eq('id', playerId);
    console.log('[push] save DB', error ? `ERREUR: ${error.message}` : 'OK');
    return 'granted';
  } catch (e) {
    console.log('[push] EXCEPTION (FCM/Firebase pas dans le build ?):', String(e));
    return 'skipped';
  }
}

// État de permission, pour décider d'afficher la bannière « Activer les notifs ».
export async function getNotificationsEnabled(): Promise<boolean> {
  if (IS_EXPO_GO) return false;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

// (Ré)activation déclenchée par l'utilisateur (bannière de l'écran Notifications) :
//  - déjà accordée   → on s'assure juste que le token est en DB
//  - jamais demandée → prompt OS (requestPermissions via registerForPushAsync)
//  - refusée définit. → on ouvre les réglages système (seul moyen après un refus,
//    le prompt OS ne réapparaît plus)
export async function enableNotificationsFromApp(
  playerId: string,
): Promise<'granted' | 'asked' | 'opened-settings' | 'skipped'> {
  if (IS_EXPO_GO) return 'skipped';
  try {
    const perms = await Notifications.getPermissionsAsync();
    if (perms.status === 'granted') {
      await registerForPushAsync(playerId);
      return 'granted';
    }
    if (perms.canAskAgain) {
      await registerForPushAsync(playerId); // prompt=true par défaut
      return 'asked';
    }
    await Linking.openSettings();
    return 'opened-settings';
  } catch {
    return 'skipped';
  }
}

export function usePushNotifications() {
  const { player } = usePlayer();
  const router     = useRouter();

  // ── Register token ────────────────────────────────────────────
  // Au montage on ne PROMPTE jamais : on rafraîchit le token uniquement si la
  // permission est déjà accordée. La demande de permission est faite à un moment
  // explicite (fin de l'onboarding), pas à chaque login — sinon sa boîte système
  // volerait le focus juste après le login et écraserait la feuille
  // « Enregistrer le mot de passe ? » de l'autofill Android.
  useEffect(() => {
    if (!player) { console.log('[push] pas de player → skip'); return; }
    registerForPushAsync(player.id, { promptIfNeeded: false });
  }, [player?.id]);

  // ── Navigate on notification tap ─────────────────────────────
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as Record<string, string> | undefined;
      if (!data) return;

      switch (data.type) {
        case 'challenge':
          router.push('/(tabs)/matchmaking');
          break;
        case 'match':
          router.push('/(tabs)');
          break;
        case 'message':
          if (data.gameId) router.push(`/chat/${data.gameId}` as any);
          else router.push('/(tabs)/chats');
          break;
        case 'lobby':
          if (data.gameId) router.push(`/(tabs)/lobby?gameId=${data.gameId}` as any);
          else router.push('/(tabs)/lobby');
          break;
        case 'bilan':
          track('notif_bilan_tapped', { month: data.month });
          router.push((data.month ? `/bilan/${data.month}` : '/bilan/last') as any);
          break;
      }
    });
    return () => sub.remove();
  }, []);
}
