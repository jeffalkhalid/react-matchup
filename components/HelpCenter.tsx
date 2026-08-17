import { useEffect, useRef, useState } from 'react';
import { Modal } from 'react-native';
import { useSegments, useRouter } from 'expo-router';
import HelpCenterSheet from './guide/HelpCenter';
import ShowMeOverlay from './guide/ShowMeOverlay';
import { SHOW_ME, type ShowMeKey } from './guide/help/data';
import { onHelpOpen } from '../lib/helpEvents';
import { requestTourReplay } from '../lib/tourAnchors';
import { usePlayer } from '../hooks/usePlayer';
import { track } from '../lib/analytics';

// Centre d'aide — feuille (pageSheet) montée une fois dans app/(tabs)/_layout.
// S'ouvre via requestHelpOpen() (pastille « ? » de HeaderActions, cluster
// d'en-tête — l'ancienne demi-pastille flottante du bord droit a disparu).
// Toujours rouvert sur le HUB, jamais sur la dernière rubrique lue — le
// contexte a changé. Contextualisé par la route courante (« Tu es ici »).
//
// « Me montrer sur l'écran » : la feuille se referme, l'app navigue vers
// l'écran de la rubrique, et UN spotlight se pose sur l'ancre (ShowMeOverlay).
// « Revenir au guide » rouvre la feuille directement sur la rubrique d'origine.
export default function HelpCenter() {
  const segments = useSegments();
  const router = useRouter();
  const { player } = usePlayer();
  const [open, setOpen] = useState(false);
  // Rubrique sur laquelle rouvrir la feuille (retour de « Me montrer »), sinon hub.
  const [initialTopic, setInitialTopic] = useState<string | null>(null);
  const [showMe, setShowMe] = useState<{ key: ShowMeKey; from: string | null } | null>(null);

  // Dernier segment de route (ex. 'lobby', 'matchmaking', 'chats', '(tabs)').
  const contextRoute = (segments[segments.length - 1] as string) ?? null;
  const contextRouteRef = useRef(contextRoute); contextRouteRef.current = contextRoute;

  useEffect(() => onHelpOpen(() => {
    setInitialTopic(null);
    setShowMe(null);
    setOpen(true);
    track('help_opened', { route: contextRouteRef.current });
  }), []);

  const close = () => setOpen(false);

  // Pseudo-routes du guide : '@tour' rejoue la visite guidée complète,
  // '@profile' ouvre le profil du joueur connecté. Le reste = route expo-router.
  const handleRoute = (route: string) => {
    close();
    if (route === '@tour') {
      track('tour_replayed');
      // Laisse la feuille se refermer avant de monter l'overlay de la visite
      // (sinon il apparaît sous le pageSheet en cours de fermeture).
      setTimeout(requestTourReplay, 340);
      return;
    }
    if (route === '@profile') {
      if (player?.id) router.push(`/player/${player.id}` as any);
      return;
    }
    router.push(route as any);
  };

  const handleShowMe = (key: ShowMeKey, fromTopic: string | null) => {
    const spec = SHOW_ME[key];
    track('help_showme', { key, from: fromTopic });
    close();
    router.navigate(spec.screen as any);
    // L'overlay attend la fermeture de la feuille (pageSheet ~300 ms) pour se poser.
    setTimeout(() => setShowMe({ key, from: fromTopic }), 340);
  };

  return (
    <>
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={close}
      >
        {/* Remonté à chaque ouverture → repart du hub (ou de la rubrique de retour). */}
        {open && (
          <HelpCenterSheet
            contextRoute={contextRoute}
            initialTopic={initialTopic}
            onClose={close}
            onRoute={handleRoute}
            onShowMe={handleShowMe}
          />
        )}
      </Modal>

      {showMe && (
        <ShowMeOverlay
          spec={SHOW_ME[showMe.key]}
          onBack={() => {
            const from = showMe.from;
            setShowMe(null);
            setInitialTopic(from);
            setOpen(true);
          }}
          onDone={() => setShowMe(null)}
        />
      )}
    </>
  );
}
