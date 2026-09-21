// components/activity/StakeMark.tsx — la marque d'un défi sur une carte de
// pronostic.
//
// Un défi ne se joue pas comme un compétitif : la mise multiplie ce qu'on
// gagne et ce qu'on perd. Sur un rail de cartes identiques, rien ne le disait.
//
// Deux signes, jamais sur un compétitif — c'est justement ce qui fait
// ressortir le défi :
//  • une griffe en haut de la carte, dans la couleur du niveau de mise ;
//  • une pastille « DÉFI ×3 » dans la même couleur.
//
// L'échelle de couleur est celle de toute l'app (lib/defis.stakeTone) : vert
// jusqu'à ×2, jaune jusqu'à ×3, rouge au-delà. Une troisième échelle rien que
// pour ce rail aurait dit autre chose que la fiche de la partie.
import { View, Text } from 'react-native';
import { Fonts } from '../../lib/theme';
import { stakeTone, formatStake } from '../../lib/defis';

/** Le bandeau coloré en haut de la carte. `null` hors défi. */
export function StakeGriffe({ stake }: { stake: number | null }) {
  if (stake == null || stake <= 1) return null;
  return <View style={{ height: 4, backgroundColor: stakeTone(stake).bg }} />;
}

/** « DÉFI ×3 ». `null` hors défi. */
export function StakePill({ stake }: { stake: number | null }) {
  const mise = formatStake(stake);
  if (mise == null) return null;
  const ton = stakeTone(stake as number);
  return (
    <View style={{ backgroundColor: ton.bg, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 }}>
      <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 8.5, letterSpacing: 0.6, color: ton.fg }}>
        {`DÉFI ${mise}`}
      </Text>
    </View>
  );
}
