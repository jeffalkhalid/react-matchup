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
// `size` : diamètre des pastilles (défaut 40 ; l'Accueil passe 34 pour caser les
// TROIS pastilles à côté du logo centré 107 px sans le décentrer — cf. index.tsx).
export function HeaderActions({ top, right, tint = 'light', bellAnchor, help = true, size = 40 }: {
  top: number; right: number; tint?: 'light' | 'dark'; bellAnchor?: TourAnchorName;
  help?: boolean; size?: number;
}) {
  const router = useRouter();
  const { total } = useNotificationCount();
  const helpFg = tint === 'light' ? '#fff' : '#0A0A0A';
  const helpBg = tint === 'light' ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)';
  const compact = size < 40;
  return (
    <View style={{
      position: 'absolute', top, right, zIndex: 20,
      flexDirection: 'row', alignItems: 'center', gap: compact ? 6 : 10,
    }}>
      {help && (
        <TouchableOpacity
          onPress={requestHelpOpen}
          activeOpacity={0.75}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Aide"
          style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: helpBg,
            alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ color: helpFg, fontSize: compact ? 15 : 17, fontWeight: '900',
            lineHeight: compact ? 19 : 21 }}>?</Text>
        </TouchableOpacity>
      )}
      <View
        ref={bellAnchor ? (v) => registerTourAnchor(bellAnchor, v) : undefined}
        collapsable={false}
      >
        <NotificationBell count={total} tint={tint} size={size}
          onPress={() => router.push('/notifications' as any)} />
      </View>
      <ProfileAvatarButton size={compact ? size - 4 : 36} />
    </View>
  );
}
