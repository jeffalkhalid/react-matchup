import { useState } from 'react';
import { Modal, Text, TouchableOpacity, View } from 'react-native';
import { useSegments, useRouter } from 'expo-router';
import { Colors, Fonts } from '../lib/theme';
import HelpCenterSheet from './guide/HelpCenter';

// Centre d'aide — feuille (bottom sheet) rouverte au tap sur le bouton « ? ».
// Contextualisé par la route courante : le hub met en avant la rubrique
// correspondant à l'écran d'où l'aide est ouverte (« Tu es ici »).
export default function HelpCenter() {
  const segments = useSegments();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);
  // Dernier segment de route (ex. 'lobby', 'matchmaking', 'ranking', 'chats').
  const contextRoute = (segments[segments.length - 1] as string) ?? null;

  return (
    <>
      {/* ── Bouton « ? » — demi-pastille milieu droit ── */}
      <TouchableOpacity
        onPress={() => setOpen(true)}
        activeOpacity={0.82}
        style={{
          position: 'absolute',
          right: 0,
          top: '50%',
          marginTop: -22,
          width: 40,
          height: 44,
          borderTopLeftRadius: 12,
          borderBottomLeftRadius: 12,
          backgroundColor: Colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: Colors.primary,
          shadowOpacity: 0.4,
          shadowRadius: 10,
          shadowOffset: { width: -2, height: 0 },
          elevation: 8,
          zIndex: 90,
        }}
      >
        <Text style={{ color: Colors.textOnDark, fontSize: 19, fontWeight: '900', lineHeight: 24, fontFamily: Fonts.uiBlack }}>?</Text>
      </TouchableOpacity>

      {/* ── Feuille d'aide ── */}
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={close}
      >
        {/* Remonté à chaque ouverture → repart du hub, contextualisé sur la route courante. */}
        {open && (
          <HelpCenterSheet
            contextRoute={contextRoute}
            onClose={close}
            onRoute={(route) => { close(); router.push(route as any); }}
          />
        )}
      </Modal>
    </>
  );
}
