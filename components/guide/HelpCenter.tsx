import React, { useRef, useState } from 'react';
import { View, Animated, Dimensions } from 'react-native';
import { useGuideTheme } from '../../lib/guideTheme';
import { track } from '../../lib/analytics';
import { HelpHub } from './help/HelpHub';
import { HelpDetail } from './help/HelpDetail';
import { ORDER, type ShowMeKey } from './help/data';

const { width: W } = Dimensions.get('window');

// Centre d'aide : hub ↔ détail avec transition slide horizontale (360 ms).
// `contextRoute` = segment de l'écran d'origine (pilote « Tu es ici »).
// `initialTopic` = rouvrir directement sur une rubrique (retour de « Me montrer »).
export default function HelpCenterSheet({ contextRoute, initialTopic, onClose, onRoute, onShowMe }: {
  contextRoute: string | null;
  initialTopic?: string | null;
  onClose: () => void;
  onRoute: (route: string) => void;
  onShowMe: (k: ShowMeKey, fromTopic: string | null) => void;
}) {
  const T = useGuideTheme();
  const [active, setActive] = useState<string | null>(initialTopic ?? null); // null = hub
  const x = useRef(new Animated.Value(initialTopic ? -W : 0)).current;

  const slideTo = (toDetail: boolean) => {
    Animated.timing(x, { toValue: toDetail ? -W : 0, duration: 360, useNativeDriver: true }).start();
  };
  const open = (k: string) => {
    track('help_topic_opened', { topic: k });
    setActive(k);
    slideTo(true);
  };
  const back = () => { slideTo(false); };
  const prevNext = (d: -1 | 1) => {
    if (!active) return;
    const i = ORDER.indexOf(active);
    const ni = Math.max(0, Math.min(ORDER.length - 1, i + d));
    setActive(ORDER[ni]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: T.bg, overflow: 'hidden' }}>
      <Animated.View style={{ flexDirection: 'row', width: W * 2, flex: 1, transform: [{ translateX: x }] }}>
        <View style={{ width: W }}>
          <HelpHub T={T} contextRoute={contextRoute} onOpen={open} onShowMe={onShowMe} onClose={onClose} />
        </View>
        <View style={{ width: W }}>
          {active && (
            <HelpDetail rkey={active} T={T} onBack={back} onClose={onClose}
              onPrevNext={prevNext} onRoute={onRoute} onShowMe={onShowMe} />
          )}
        </View>
      </Animated.View>
    </View>
  );
}
