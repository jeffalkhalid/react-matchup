import { StyleSheet, View } from 'react-native';
import Onboarding from './guide/Onboarding';

// Coquille de compatibilité — signature inchangée pour app/(tabs)/_layout.tsx.
// Recouvrement plein écran (absoluteFill + zIndex) car l'onboarding est monté comme
// frère des <Tabs> dans le layout : sans ça il s'insère dans le flux et ne couvre
// que la moitié de l'écran. Le montage / la persistance (clé `matchup_guide_rn_v1`)
// restent gérés par le layout via l'état `hasSeenOnboarding`.
export default function OnboardingCarousel({ onDone }: { onDone: () => void }) {
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
      <Onboarding onDone={onDone} />
    </View>
  );
}
