import React, { useRef, useState } from 'react';
import { View, Animated, Dimensions } from 'react-native';
import { useGuideTheme } from '../../lib/guideTheme';
import { HelpHub } from './help/HelpHub';
import { HelpDetail } from './help/HelpDetail';
import { HUB_RUBRICS } from './help/data';

const { width: W } = Dimensions.get('window');

// Centre d'aide : hub ↔ détail avec transition slide horizontale.
// `contextRoute` = segment de l'écran d'origine (pilote « Tu es ici »).
export default function HelpCenterSheet({ contextRoute, onClose, onRoute }:
  { contextRoute: string | null; onClose: () => void; onRoute: (route: string) => void }) {
  const T = useGuideTheme();
  const [active, setActive] = useState<string | null>(null); // null = hub
  const x = useRef(new Animated.Value(0)).current;

  const slideTo = (toDetail: boolean) => {
    Animated.timing(x, { toValue: toDetail ? -W : 0, duration: 360, useNativeDriver: true }).start();
  };
  const open = (k: string) => { setActive(k); slideTo(true); };
  const back = () => { slideTo(false); };
  const prevNext = (d: -1 | 1) => {
    if (!active) return;
    const i = HUB_RUBRICS.indexOf(active);
    const ni = Math.max(0, Math.min(HUB_RUBRICS.length - 1, i + d));
    setActive(HUB_RUBRICS[ni]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: T.bg, overflow: 'hidden' }}>
      <Animated.View style={{ flexDirection: 'row', width: W * 2, flex: 1, transform: [{ translateX: x }] }}>
        <View style={{ width: W }}>
          <HelpHub T={T} contextRoute={contextRoute} onOpen={open} onClose={onClose} />
        </View>
        <View style={{ width: W }}>
          {active && (
            <HelpDetail rkey={active} T={T} onBack={back} onClose={onClose} onPrevNext={prevNext} onRoute={onRoute} />
          )}
        </View>
      </Animated.View>
    </View>
  );
}
