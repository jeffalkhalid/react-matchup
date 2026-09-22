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
        backgroundColor: '#0A0A0A', borderRadius: 20,
        paddingVertical: 16, paddingHorizontal: 16,
        flexDirection: 'row', alignItems: 'center', gap: 14,
        overflow: 'hidden',
      }}
    >
      {/* Mêmes anneaux que les tuiles : une seule grammaire visuelle pour
          toutes les entrées de l'accueil. */}
      {[170, 126, 82].map((d, i) => (
        <View key={d} pointerEvents="none" style={{
          position: 'absolute', right: -d / 3, top: -d / 2.4,
          width: d, height: d, borderRadius: 999,
          borderWidth: 1.5, borderColor: `rgba(255,193,26,${0.13 - i * 0.03})`,
        }} />
      ))}

      <View style={{
        width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,193,26,0.16)',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="calendar" size={22} color={Colors.brand} stroke={2.2} />
      </View>

      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text numberOfLines={1} style={{ fontFamily: Fonts.welcome, fontSize: 21, lineHeight: 25, color: Colors.textOnDark, paddingRight: 6 }}>
          Tournois <Text style={{ color: Colors.brand }}>&amp; événements</Text>
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: Fonts.uiSemi, fontSize: 11.5, lineHeight: 15, color: 'rgba(255,255,255,0.6)' }}>
            {ouvrable
              ? `${count} événement${count > 1 ? 's' : ''} disponible${count > 1 ? 's' : ''} · touche pour voir`
              : 'Ne manque rien dans ta région'}
          </Text>
          {/* La pastille dit « bientôt », pas « combien » : elle disparaît dès
              que les tournois sont ouverts, la phrase prend le relais. */}
          {!ouvrable && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.brand, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Icon name="calendar" size={10} color={Colors.primary} stroke={2.4} />
              <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 10, color: Colors.primary }}>À venir</Text>
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
