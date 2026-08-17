import { Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { NotificationBell } from './NotificationBell';
import { ProfileAvatarButton } from './ProfileAvatarButton';
import { useNotificationCount } from '../hooks/useNotificationCount';
import { registerTourAnchor, type TourAnchorName } from '../lib/tourAnchors';
import { requestHelpOpen } from '../lib/helpEvents';

// Cluster du coin haut-droit des écrans principaux : « ? » (aide) + cloche de
// notifs + avatar profil. Source UNIQUE de ce coin → un seul endroit à modifier
// pour les 5 onglets. Le « ? » a quitté la demi-pastille flottante du bord droit
// (elle recouvrait le contenu, sur le bord où le pouce fait défiler) pour la
// troisième pastille du cluster — option B du handoff design_handoff_guide_aide.
// Le total de notifs vient du hook partagé (même nombre que l'écran /notifications).
// `bellAnchor` : nom d'ancre de la visite guidée à poser sur la cloche (ex. 'bell-lobby').
// `help` : pastille « ? » incluse (défaut). L'Accueil la désactive — son en-tête
// est plein (logo centré 131 px + 4 pastilles) — et monte HelpFab à la place.
export function HeaderActions({ top, right, tint = 'light', bellAnchor, help = true }: {
  top: number; right: number; tint?: 'light' | 'dark'; bellAnchor?: TourAnchorName; help?: boolean;
}) {
  const router = useRouter();
  const { total } = useNotificationCount();
  const helpFg = tint === 'light' ? '#fff' : '#0A0A0A';
  const helpBg = tint === 'light' ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)';
  return (
    <View style={{
      position: 'absolute', top, right, zIndex: 20,
      flexDirection: 'row', alignItems: 'center', gap: 10,
    }}>
      {help && (
        <TouchableOpacity
          onPress={requestHelpOpen}
          activeOpacity={0.75}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Aide"
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: helpBg,
            alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ color: helpFg, fontSize: 17, fontWeight: '900', lineHeight: 21 }}>?</Text>
        </TouchableOpacity>
      )}
      <View
        ref={bellAnchor ? (v) => registerTourAnchor(bellAnchor, v) : undefined}
        collapsable={false}
      >
        <NotificationBell count={total} tint={tint} onPress={() => router.push('/notifications' as any)} />
      </View>
      <ProfileAvatarButton />
    </View>
  );
}
