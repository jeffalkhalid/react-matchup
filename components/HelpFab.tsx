import { Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../lib/theme';
import { requestHelpOpen } from '../lib/helpEvents';

// Demi-pastille « ? » du bord droit — UNIQUEMENT sur l'Accueil. L'en-tête y est
// calibré au pixel (2 pastilles gauche + logo 131 px centré + 2 pastilles
// droite sur 360 dp) : une 3e pastille dans le cluster atterrit SUR le logo.
// Les 4 autres onglets utilisent l'option B du handoff (« ? » dans
// HeaderActions) ; ici on garde l'option A en 36×40 (demande Jeff — le 30×33
// initial était trop discret), centrée verticalement sur la zone de contenu.
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
        marginTop: -20,
        width: 36,
        height: 40,
        borderTopLeftRadius: 12,
        borderBottomLeftRadius: 12,
        // Jaune brand : le bord droit de l'Accueil croise la carte héro NOIRE —
        // une pastille sombre y disparaissait (noir sur noir).
        backgroundColor: Colors.brand,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#0A0A0A',
        shadowOpacity: 0.35,
        shadowRadius: 8,
        shadowOffset: { width: -2, height: 2 },
        elevation: 8,
        zIndex: 90,
      }}
    >
      <Text style={{ color: '#0A0A0A', fontSize: 17, fontWeight: '900', lineHeight: 22, fontFamily: Fonts.uiBlack }}>?</Text>
    </TouchableOpacity>
  );
}
