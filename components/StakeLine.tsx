// Ce qu'un match met en jeu, en une ligne — pour une carte.
//
// Le panneau complet (components/create/StakePreview) ne tient pas sur une
// carte de partie : deux nombres suffisent, le meilleur gain et la pire perte.
// « Jusqu'à » est le mot qui fait la différence entre une promesse et une
// borne — sans lui, on lirait ces chiffres comme le résultat attendu.
//
// Les couleurs vivent ICI et le panneau les importe : deux verts différents
// pour la même idée se remarquent tout de suite quand les deux affichages se
// suivent à l'écran.
import { View, Text } from 'react-native';
import { Colors, Fonts } from '../lib/theme';
import { formatLevelDelta, bestGain, worstLoss, type StakeOutcome } from '../lib/stakePreview';

export const VERT_FOND = 'rgba(16,185,129,0.12)';
export const VERT_TEXTE = '#047857';
export const ROUGE_FOND = 'rgba(239,68,68,0.10)';
export const ROUGE_TEXTE = '#B91C1C';

export function StakeLine({ outcome, exact, s = 1 }: {
  outcome: StakeOutcome | null;
  /** `false` : il manque un joueur, le chiffre vient d'une bande de niveau. */
  exact: boolean;
  /** Échelle de la carte, comme les pastilles (lib : largeur d'écran). */
  s?: number;
}) {
  if (!outcome) return null;
  const gain = formatLevelDelta(bestGain(outcome));
  const perte = formatLevelDelta(worstLoss(outcome));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{
        width: 17, height: 17, borderRadius: 9, backgroundColor: Colors.primary,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 9, color: Colors.textOnDark }}>±</Text>
      </View>
      <Text numberOfLines={1} style={{ fontFamily: Fonts.uiBold, fontSize: 11 * s, color: Colors.textSecondary }}>
        {exact ? 'En jeu' : 'Environ'}
      </Text>
      {/* La perte D'ABORD : c'est elle qu'on pese avant de s'engager. Le gain
          ensuite, comme la raison d'y aller quand meme. */}
      <Text numberOfLines={1} style={{ fontFamily: Fonts.uiBlack, fontSize: 12 * s, color: ROUGE_TEXTE }}>
        {perte}
      </Text>
      <Text style={{ fontFamily: Fonts.uiBold, fontSize: 11 * s, color: Colors.textMuted }}>/</Text>
      <Text numberOfLines={1} style={{ fontFamily: Fonts.uiBlack, fontSize: 12 * s, color: VERT_TEXTE }}>
        {gain}
      </Text>
      <Text numberOfLines={1} style={{ flex: 1, fontFamily: Fonts.ui, fontSize: 10 * s, color: Colors.textMuted }}>
        de niveau
      </Text>
    </View>
  );
}

export default StakeLine;
