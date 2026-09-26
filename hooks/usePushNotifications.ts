import { useEffect, useState } from 'react';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { enregistrerMonJeton } from '../lib/pushToken';
import Constants from 'expo-constants';
import { Platform, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { usePlayer } from './usePlayer';
import { Colors } from '../lib/theme';
import { track } from '../lib/analytics';
import { tournamentEveningIsLive } from '../lib/tournamentEvening';

// Push tokens don't work in Expo Go since SDK 53 — only in dev/prod builds
const IS_EXPO_GO = Constants.appOwnership === 'expo';

// Identifiant du dernier tap de notification déjà suivi. Retenu sur le
// téléphone pour qu'une ouverture ordinaire ne rejoue pas l'ancien tap.
const CLE_DERNIER_TAP = 'notif:dernier-tap';

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
    // Le jeton est l'adresse du téléphone : on n'en écrit JAMAIS la valeur
    // entière, même en développement. Les six derniers caractères suffisent à
    // reconnaître « c'est bien le même appareil » sans rien livrer d'utile.
    console.log('[push] jeton obtenu …' + String(token).slice(-6));

    // Le jeton ne vit plus dans la fiche joueur (lisible sans compte) mais
    // dans `player_push_tokens` — voir lib/pushToken.ts pour le pourquoi.
    const erreur = await enregistrerMonJeton(playerId, token);
    console.log('[push] save DB', erreur ? `ERREUR: ${erreur}` : 'OK');
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

  // Le tap reçu, en attente que la session soit chargée (voir plus bas).
  const [tapEnAttente, setTapEnAttente] = useState<Notifications.NotificationResponse | null>(null);

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
  //
  // APP FERMÉE, LE TAP N'OUVRAIT RIEN. Deux causes, et il a fallu les deux
  // corrections (la première seule ne suffisait pas — constaté le 2026-09-26) :
  //
  //  1. L'app n'écoutait que les taps reçus PENDANT qu'elle tourne. Fermée, le
  //     tap la démarre et l'écouteur n'est posé qu'après : la demande partait
  //     dans le vide. `getLastNotificationResponseAsync` relit le tap qui a
  //     lancé l'app.
  //
  //  2. ⚠️ Même relu, l'écran visé N'EXISTAIT PAS ENCORE. Les écrans (chat,
  //     lobby, profil…) sont derrière `<Stack.Protected guard={!!player}>` :
  //     tant que la session n'est pas revenue du téléphone, ils ne sont pas
  //     montés, et naviguer vers eux ne fait rien. D'où la file d'attente
  //     ci-dessous : on retient le tap et on l'ouvre quand la session est là.
  //
  // Le tap qui a lancé l'app reste lisible tant que le système le garde : sans
  // garde-fou, chaque ouverture ordinaire rejouerait la DERNIÈRE notification
  // tapée et vous enverrait sur un écran que vous n'avez pas demandé. D'où
  // l'identifiant retenu sur le téléphone : un tap n'est suivi qu'une fois.
  const traite = async (response: Notifications.NotificationResponse, froid: boolean) => {
    const id = response.notification.request.identifier;
    if (froid) {
      try {
        if (id && (await AsyncStorage.getItem(CLE_DERNIER_TAP)) === id) return;
        if (id) await AsyncStorage.setItem(CLE_DERNIER_TAP, id);
      } catch { /* stockage indisponible : on ouvre, quitte à ouvrir deux fois */ }
    } else if (id) {
      try { await AsyncStorage.setItem(CLE_DERNIER_TAP, id); } catch { /* sans gravité */ }
    }
    setTapEnAttente(response);
  };

  const ouvrir = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as Record<string, string> | undefined;
      if (!data) return;

      switch (data.type) {
        case 'challenge':
          router.push((data.tab ? `/(tabs)/matchmaking?tab=${data.tab}` : '/(tabs)/matchmaking') as any);
          break;
        case 'match':
          // « Score à valider », « Score contesté », « Score accepté » : le
          // geste attendu est dans l'historique du lobby, pas sur l'accueil —
          // où ce tap atterrissait, laissant le joueur chercher tout seul.
          //
          // MÊME DESTINATION QUE LA CLOCHE (lib/notifications.ts) : les deux
          // annoncent la même chose, elles doivent mener au même endroit.
          // `openValidation=1` ouvre la feuille de validation une fois les
          // matchs chargés — le mécanisme existait déjà côté lobby, il n'était
          // simplement jamais appelé depuis une notification.
          router.push('/(tabs)/lobby?tab=history&openValidation=1' as any);
          break;
        case 'follow':
          if (data.pid) router.push(`/player/${data.pid}` as any);
          break;
        case 'availability':
          // « Untel cherche a jouer » n'ouvrait RIEN : le switch n'avait pas
          // de cas, donc on restait ou on etait. On ouvre le bloc des dispos
          // de l'onglet Activite — l'endroit ou l'on voit qui est libre et ou
          // l'on repond en se declarant a son tour.
          router.push('/(tabs)/activite?focus=dispo' as any);
          break;
        case 'message':
          if (data.gameId) router.push(`/chat/${data.gameId}` as any);
          else router.push('/(tabs)/chats');
          break;
        case 'lobby':
          if (data.gameId) router.push(`/(tabs)/lobby?gameId=${data.gameId}` as any);
          else router.push('/(tabs)/lobby');
          break;
        case 'live':
          if (data.sessionId) router.push(`/live/${data.sessionId}` as any);
          break;
        case 'bilan':
          track('notif_bilan_tapped', { month: data.month });
          router.push((data.month ? `/bilan/${data.month}` : '/bilan/last') as any);
          break;
        case 'showcase':
          // Nomination de binôme ouvert → ouvrir MON profil (id dans le payload)
          // sur le gestionnaire de vitrine (section « À confirmer »).
          if (data.pid) router.push(`/player/${data.pid}?showcase=1` as any);
          else router.push('/(tabs)/matchmaking');
          break;
        case 'tournament':
          // Aujourd'hui un push de tournoi n'ouvrait RIEN : on restait où on
          // était, et « tu vas au Terrain 2 » ne menait nulle part.
          //
          // TROIS DESTINATIONS, ET CHACUNE EST L'ENDROIT DU GESTE :
          //
          //  * « terrain muet / désaccord » (`silent`) est le SEUL push qui
          //    exige une action, et cette action — trancher, ou saisir le
          //    score à leur place — vit dans l'onglet Admin. Il ouvrait la
          //    fiche du tournoi, où ce geste n'existe pas : l'organisateur
          //    était prévenu, puis abandonné devant un écran sans bouton.
          //  * la soirée qui TOURNE (rotation tirée, abandon d'un binôme)
          //    ouvre le Mode soirée — c'est là qu'on lit son terrain et qu'on
          //    rentre son score (spec §6).
          //  * le reste (classement validé) ouvre la fiche : la soirée est
          //    finie, le Mode soirée n'a plus rien à dire.
          if (!data.tournamentId) break;
          if (data.kind === 'silent') {
            router.push('/(tabs)/admin' as any);
          } else if (tournamentEveningIsLive(data.kind)) {
            router.push(`/tournaments/soiree/${data.tournamentId}` as any);
          } else {
            router.push(`/tournaments/${data.tournamentId}` as any);
          }
          break;
      }
  };

  useEffect(() => {
    let vivant = true;

    // App fermée : relire le tap qui vient de la démarrer.
    Notifications.getLastNotificationResponseAsync()
      .then(r => { if (vivant && r) traite(r, true); })
      .catch(() => { /* rien à relire */ });

    // App ouverte ou en arrière-plan.
    const sub = Notifications.addNotificationResponseReceivedListener(r => { traite(r, false); });

    return () => { vivant = false; sub.remove(); };
  }, []);

  // Le tap attend la session. Sans elle, les écrans visés ne sont pas montés
  // et `router.push` ne fait rien — c'était la seconde cause.
  useEffect(() => {
    if (!tapEnAttente || !player) return;
    ouvrir(tapEnAttente);
    setTapEnAttente(null);
  }, [tapEnAttente, player?.id]);
}
