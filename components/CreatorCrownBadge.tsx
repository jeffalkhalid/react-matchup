// Badge couronne du créateur, superposé en haut-droite d'un avatar.
// Source unique pour signaler l'organisateur d'un match partout dans l'app
// (lobby, fiche détails, chat…). À placer dans une View parente (l'avatar),
// les Views React Native servant de référentiel pour le positionnement absolu.
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Colors } from '../lib/theme';

export function CreatorCrownBadge({ avatarSize, ringColor = Colors.bgCard }: {
  avatarSize: number;
  ringColor?: string;   // couleur de l'anneau (fond de la surface) pour détacher le badge
}) {
  const bs = Math.max(13, Math.round(avatarSize * 0.5));
  return (
    <View style={{
      position: 'absolute', top: -4, right: -4,
      width: bs, height: bs, borderRadius: bs,
      backgroundColor: Colors.brand, borderWidth: 1.5, borderColor: ringColor,
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Svg width={Math.round(bs * 0.62)} height={Math.round(bs * 0.62)} viewBox="0 0 24 24" fill="none"
        stroke={Colors.primary} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <Path stroke={Colors.primary} fill={Colors.primary} d="M3 8.5 6.5 12l3-5 2.5 4 2.5-4 3 5L21 8.5 19 19H5L3 8.5z" />
      </Svg>
    </View>
  );
}
