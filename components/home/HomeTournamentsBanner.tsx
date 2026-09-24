// components/home/HomeTournamentsBanner.tsx — l'entrée « Tournois & événements ».
//
// Un bandeau noir pleine largeur, d'après la maquette du 2026-09-22. Il
// remplace la section qui listait les soirées ouvertes.
//
// CE QU'ON PERD, ET POURQUOI C'EST ACCEPTÉ : la liste disait l'échéance et les
// places restantes de chaque soirée ; le bandeau, non. Le choix est assumé —
// tournois et événements deviendront deux pages, et l'accueil n'a pas à en
// être le sommaire. Il indique seulement qu'il se passe quelque chose, et
// combien.
//
// Une précaution héritée de la version d'avant : ce bandeau est NOIR. Sa
// première version était un second aplat jaune sous « Trouver un match » ; les
// deux se disputaient le même accent et le tournoi criait plus fort que
// l'action principale.
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import { texteUI } from '../../lib/uiText';
// La géométrie qui compte pour le budget de l'accueil vient d'ICI, elle n'est
// pas réécrite plus bas : rembourrage vertical, pastille d'icône, interlignes,
// hauteur de « À venir ». Les mêmes chiffres vivaient aux deux endroits, et
// rien n'obligeait le budget à suivre quand le dessin changeait — c'est cette
// divergence-là qui avait coupé « Ça se joue bientôt ».
import { GEO } from '../../lib/homeLayout';

export function HomeTournamentsBanner({ enabled, count, onPress }: {
  /**
   * Les tournois sont-ils ouverts (drapeau du panel arbitre) ?
   *
   * Fermés, le bandeau annonce « À venir » et ne mène nulle part : la
   * fonctionnalité existe, elle n'est pas encore ouverte. Le rendre tapable
   * déposerait sur un écran vide — pire qu'une promesse.
   */
  enabled: boolean;
  /** Combien d'événements ouverts, quand ils le sont. */
  count: number;
  onPress: () => void;
}) {
  const ouvrable = enabled && count > 0;
  const Wrap: any = ouvrable ? TouchableOpacity : View;
  return (
    <Wrap
      {...(ouvrable ? { onPress, activeOpacity: 0.88, accessibilityRole: 'button' } : {})}
      accessibilityLabel="Tournois et événements"
      style={{
        // `flex: 1` : le bandeau remplit la hauteur que l'accueil lui accorde
        // au lieu de l'imposer. Son rembourrage vertical devient un minimum,
        // pas une hauteur — sinon il sort de la repartition.
        flex: 1,
        backgroundColor: '#0A0A0A', borderRadius: 20,
        paddingVertical: GEO.tournois.padV, paddingHorizontal: 16,
        flexDirection: 'row', alignItems: 'center', gap: 14,
        overflow: 'hidden',
      }}
    >
      {/* Mêmes anneaux que les tuiles : une seule grammaire visuelle pour
          toutes les entrées de l'accueil. Ils partent du bord DROIT, là où le
          bandeau est large et vide. */}
      {[260, 200, 144].map((d, i) => (
        <View key={d} pointerEvents="none" style={{
          position: 'absolute', right: -d * 0.28, top: -d * 0.36,
          width: d, height: d, borderRadius: 999,
          borderWidth: i === 0 ? 2.5 : 2,
          borderColor: `rgba(255,193,26,${0.20 - i * 0.05})`,
        }} />
      ))}

      {/* Le semis de points de la maquette, en haut à droite. Quarante petits
          ronds posés en grille : c'est ce qui donne au bandeau sa texture, et
          c'est précisément ce que j'avais omis. */}
      <View pointerEvents="none" style={{
        position: 'absolute', right: 14, top: 12, flexDirection: 'row', gap: 7,
      }}>
        {Array.from({ length: 6 }).map((_, col) => (
          <View key={col} style={{ gap: 7 }}>
            {Array.from({ length: 4 }).map((__, ligne) => (
              <View key={ligne} style={{
                width: 3, height: 3, borderRadius: 999,
                backgroundColor: `rgba(255,193,26,${0.55 - (col + ligne) * 0.05})`,
              }} />
            ))}
          </View>
        ))}
      </View>

      <View style={{
        width: GEO.tournois.pastille, height: GEO.tournois.pastille,
        borderRadius: 14, backgroundColor: 'rgba(255,193,26,0.16)',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="calendar" size={22} color={Colors.brand} stroke={2.2} />
      </View>

      <View style={{ flex: 1, minWidth: 0, gap: GEO.tournois.gapTexte }}>
        <Text {...texteUI} numberOfLines={1} style={{ fontFamily: Fonts.welcome, fontSize: 21, lineHeight: GEO.tournois.titreLigne, color: Colors.textOnDark, paddingRight: 6 }}>
          Tournois <Text style={{ color: Colors.brand }}>&amp; événements</Text>
        </Text>

        {/* La phrase et la pastille PARTAGENT une ligne : la pastille en avait
            une à elle, et sur un accueil qui ne défile pas cette ligne coûtait
            une vingtaine de points aux blocs voisins.
            Elle reste lisible comme un statut et non comme la fin de la phrase
            — c'était l'objection quand elle avait été collée au texte — parce
            qu'elle est à l'autre bout de la ligne, pas à sa suite.
            Le titre n'est pas touché : en `Fonts.welcome` 21 pt sur une seule
            ligne, il n'a pas la place de partager la sienne. */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {/* UNE ligne tant que la pastille est là, et c'est ce que le budget
              compte. Deux lignes, c'est ce qui se produirait sur un écran
              étroit maintenant que la pastille prend sa place : le bandeau
              réclamerait huit points de plus que ceux qu'on lui accorde, et le
              bas de la phrase serait coupé. Ce n'est pas un seuil de largeur —
              c'est la même condition que la pastille elle-même. Sans elle
              (tournois ouverts), la phrase est plus longue et retrouve ses
              deux lignes. */}
          <Text {...texteUI} numberOfLines={ouvrable ? 2 : 1} style={{ flexShrink: 1, fontFamily: Fonts.uiSemi, fontSize: 12, lineHeight: GEO.tournois.phraseLigne, color: 'rgba(255,255,255,0.6)' }}>
            {ouvrable
              ? `${count} événement${count > 1 ? 's' : ''} disponible${count > 1 ? 's' : ''} · touche pour voir`
              : 'Ne manque rien dans ta région'}
          </Text>
          {/* La pastille dit « bientôt », pas « combien » : elle disparaît dès
              que les tournois sont ouverts, la phrase prend le relais.
              Sa hauteur est POSÉE, pas subie : c'est le chiffre que le budget
              compte pour cette rangée (la plus haute des deux l'emporte). */}
          {!ouvrable && (
            <View style={{
              marginLeft: 'auto', height: GEO.tournois.pastilleAvenir,
              flexDirection: 'row', alignItems: 'center', gap: 4,
              backgroundColor: Colors.brand, borderRadius: 999, paddingHorizontal: 8,
            }}>
              <Icon name="calendar" size={10} color={Colors.primary} stroke={2.4} />
              <Text {...texteUI} style={{ fontFamily: Fonts.uiBlack, fontSize: 10, color: Colors.primary }}>À venir</Text>
            </View>
          )}
        </View>
      </View>

      {/* Pas de flèche quand rien ne s'ouvre : elle promettrait une
          destination. */}
      {ouvrable && (
        <View pointerEvents="none" style={{
          width: 30, height: 30, borderRadius: 999,
          borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="chevronRight" size={14} color={Colors.textOnDark} stroke={2.6} />
        </View>
      )}
    </Wrap>
  );
}

export default HomeTournamentsBanner;
