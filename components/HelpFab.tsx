import { Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../lib/theme';
import { requestHelpOpen } from '../lib/helpEvents';

// Demi-pastille « ? » du bord droit — UNIQUEMENT sur l'Accueil. L'en-tête y est
// calibré au pixel (2 pastilles gauche + logo 131 px centré + 2 pastilles
// droite sur 360 dp) : une 3e pastille dans le cluster atterrit SUR le logo.
// Les 4 autres onglets utilisent l'option B du handoff (« ? » dans
// HeaderActions) ; ici on garde l'option A, resserrée 30×33 (au lieu de
// l'ancienne 40×44) pour recouvrir le moins de contenu possible.
export default function HelpFab() {
  return (
    <TouchableOpacity
      onPress={requestHelpOpen}
      activeOpacity={0.82}
      accessibilityLabel="Aide"
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 0 }}
      style={{
        position: 'absolute',
        right: 0,
        top: '50%',
        marginTop: -17,
        width: 30,
        height: 33,
        borderTopLeftRadius: 10,
        borderBottomLeftRadius: 10,
        backgroundColor: Colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: Colors.primary,
        shadowOpacity: 0.4,
        shadowRadius: 8,
        shadowOffset: { width: -2, height: 0 },
        elevation: 8,
        zIndex: 90,
      }}
    >
      <Text style={{ color: Colors.textOnDark, fontSize: 15, fontWeight: '900', lineHeight: 19, fontFamily: Fonts.uiBlack }}>?</Text>
    </TouchableOpacity>
  );
}
