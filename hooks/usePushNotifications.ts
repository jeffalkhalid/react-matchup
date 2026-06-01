import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { usePlayer } from './usePlayer';
import { Colors } from '../lib/theme';

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

export function usePushNotifications() {
  const { player } = usePlayer();
  const router     = useRouter();
  const savedToken = useRef<string | null>(null);

  // ── Register token ────────────────────────────────────────────
  useEffect(() => {
    if (!player) { console.log('[push] pas de player → skip'); return; }
    if (IS_EXPO_GO) { console.log('[push] Expo Go → enregistrement impossible (build natif requis)'); return; }

    (async () => {
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
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        console.log('[push] permission =', finalStatus);
        if (finalStatus !== 'granted') { console.log('[push] permission refusée → stop'); return; }

        console.log('[push] projectId =', process.env.EXPO_PUBLIC_PROJECT_ID);
        const tokenData = await Notifications.getExpoPushTokenAsync({
          projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
        });
        const token = tokenData.data;
        console.log('[push] token obtenu =', token);
        if (token === savedToken.current) return;
        savedToken.current = token;

        // Save to DB — only if changed
        const { error } = await supabase
          .from('players')
          .update({ push_token: token })
          .eq('id', player.id);
        console.log('[push] save DB', error ? `ERREUR: ${error.message}` : 'OK');
      } catch (e) {
        console.log('[push] EXCEPTION (FCM/Firebase pas dans le build ?):', String(e));
      }
    })();
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
      }
    });
    return () => sub.remove();
  }, []);
}
