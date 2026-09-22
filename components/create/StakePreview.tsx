// components/create/StakePreview.tsx — « Si tu gagnes / Si tu perds ».
//
// D'après la maquette « Mise & plafond », mais avec les VRAIS chiffres :
// l'écran annonçait « Points ELO gagnés/perdus : ×2 » sans dire multiplié par
// quoi, et la maquette proposait une fourchette fixe qui sous-estimait la
// réalité d'un facteur trois.
//
// Le calcul vient de lib/stakePreview, qui rejoue la fonction serveur de
// distribution des points sur la configuration réelle : niveaux des quatre
// joueurs, fiabilité de chacun, mise choisie.
//
// Il reste une fourchette parce que la marge au score compte : un 6-0 6-0
// rapporte 50 % de plus qu'un tie-break serré. C'est la seule inconnue qui
// demeure une fois les joueurs connus, et la cacher serait mentir.
import { View, Text } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import { formatLevelRange, type StakeOutcome } from '../../lib/stakePreview';

const VERT_FOND = 'rgba(16,185,129,0.12)';
const VERT_TEXTE = '#047857';
const ROUGE_FOND = 'rgba(239,68,68,0.10)';
const ROUGE_TEXTE = '#B91C1C';

function Cote({ titre, valeur, fond, couleur }: {
  titre: string; valeur: string; fond: string; couleur: string;
}) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 6 }}>
      <Text style={{ fontFamily: Fonts.uiBold, fontSize: 12.5, color: Colors.textSecondary }}>
        {titre}
      </Text>
      <View style={{ backgroundColor: fond, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10, alignSelf: 'stretch' }}>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
          style={{ fontFamily: Fonts.uiBlack, fontSize: 17, color: couleur, textAlign: 'center' }}>
          {valeur}
        </Text>
      </View>
    </View>
  );
}

export function StakePreview({ outcome, cible, exact }: {
  /** `null` seulement si on ne connaît même pas les niveaux. */
  outcome: StakeOutcome | null;
  /** Défi ciblé : les adversaires sont connus, la fourchette est plus serrée. */
  cible: boolean;
  /**
   * Toutes les fiches sont chargées (donc les fiabilités, qui pèsent plus que
   * la mise). Sinon on calcule sur les seuls niveaux et on le dit.
   */
  exact: boolean;
}) {
  if (!outcome) return null;

  return (
    <View style={{ backgroundColor: Colors.bgCardAlt, borderRadius: 14, padding: 12, marginTop: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
        <Cote
          titre="Si tu gagnes"
          valeur={formatLevelRange(outcome.winMin, outcome.winMax)}
          fond={VERT_FOND}
          couleur={VERT_TEXTE}
        />
        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 13, color: Colors.textMuted, paddingBottom: 12 }}>·</Text>
        <Cote
          titre="Si tu perds"
          valeur={formatLevelRange(outcome.loseMin, outcome.loseMax)}
          fond={ROUGE_FOND}
          couleur={ROUGE_TEXTE}
        />
      </View>

      <Text style={{ fontFamily: Fonts.uiBold, fontSize: 11.5, color: Colors.textSecondary, textAlign: 'center', marginTop: 10 }}>
        {`Ton niveau : ${outcome.level.toFixed(2).replace('.', ',')}`}
      </Text>

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8 }}>
        <View style={{ marginTop: 1 }}>
          <Icon name="eye" size={12} color={Colors.textMuted} stroke={2} />
        </View>
        <Text style={{ flex: 1, fontFamily: Fonts.ui, fontSize: 11, lineHeight: 15, color: Colors.textMuted }}>
          {!exact
            // On n'a que les niveaux : on le dit plutôt que de laisser croire
            // à un calcul complet. La fiabilité pèse plus que la mise.
            ? 'Estimation sur les niveaux. Le chiffre s’affinera avec la fiabilité de chaque joueur.'
            : cible
              // Niveaux et fiabilités sont dans le calcul : la seule inconnue
              // restante est la manière de gagner.
              ? 'Calculé sur les niveaux et la fiabilité des quatre joueurs. Un score large rapporte davantage.'
              : 'Fourchette calculée sur la bande de niveau choisie. Elle se resserrera quand le binôme adverse sera connu.'}
        </Text>
      </View>
    </View>
  );
}
