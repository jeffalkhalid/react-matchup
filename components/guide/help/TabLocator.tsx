import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Path, Polyline } from 'react-native-svg';
import { Fonts } from '../../../lib/theme';
import { GuideTheme, BRAND } from '../../../lib/guideTheme';
import { Icon } from '../../community/icons';

// « Où ça se trouve » — la tab bar réelle en miniature, l'entrée de la rubrique
// surlignée d'un anneau jaune. Miroir des 5 onglets d'app/(tabs)/_layout.tsx.
// Accueil/Activité n'existent pas dans le registre Icon → mêmes tracés SVG que
// la vraie barre (IconHome / IconActivity du layout).
const IconHomeMini = ({ color, size = 17 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <Polyline points="9 22 9 12 15 12 15 22" />
  </Svg>
);

const IconActivityMini = ({ color, size = 17 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </Svg>
);

export function TabLocator({ T, active }: { T: GuideTheme; active: number }) {
  const cells: { key: string; label: string; render: (c: string) => React.ReactNode; isCreate?: boolean }[] = [
    { key: 'home', label: 'Accueil', render: (c) => <IconHomeMini color={c} /> },
    { key: 'activite', label: 'Activité', render: (c) => <IconActivityMini color={c} /> },
    { key: 'create', label: 'Créer', isCreate: true, render: () => null },
    { key: 'defi', label: 'Défi', render: (c) => <Icon name="swords" size={17} color={c} stroke={2} /> },
    { key: 'chats', label: 'Chats', render: (c) => <Icon name="message" size={17} color={c} stroke={2} /> },
  ];

  return (
    <View style={{ flexDirection: 'row', alignItems: 'stretch', marginTop: 11, height: 56,
      borderRadius: 12, backgroundColor: T.mode === 'dark' ? T.bg : T.chip,
      borderWidth: 1, borderColor: T.border, paddingHorizontal: 4, paddingVertical: 6 }}>
      {cells.map((t, i) => {
        const on = i === active;
        return (
          <View
            key={t.key}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3,
              borderRadius: 10,
              borderWidth: on ? 1.5 : 0, borderColor: on ? BRAND : 'transparent',
              // Halo léger de l'anneau (iOS) — discret, absent sur Android (pas d'elevation).
              shadowColor: on ? BRAND : 'transparent', shadowOpacity: on ? 0.35 : 0,
              shadowRadius: 9, shadowOffset: { width: 0, height: 0 } }}
          >
            {t.isCreate ? (
              <View style={{ width: 24, height: 24, borderRadius: 999, backgroundColor: T.chip,
                alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="plus" size={13} color={T.accent} stroke={2.5} />
              </View>
            ) : (
              t.render(T.sub)
            )}
            <Text style={{ fontFamily: Fonts.uiBold, fontSize: 8, letterSpacing: 0.3,
              textTransform: 'uppercase', color: T.sub }}>{t.label}</Text>
          </View>
        );
      })}
    </View>
  );
}
