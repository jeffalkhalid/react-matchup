// Carte « un tournoi vous attend » de l'accueil.
//
// Elle n'est PAS permanente : `homeTournamentPick` ne la propose que s'il y a
// une soirée à venir à laquelle je ne suis pas inscrit, et elle disparaît dès
// que je m'inscris. C'est ce qui lui donne le droit de prendre de la place —
// et ce qui remplace une animation clignotante, qui aurait clignoté pendant
// les trois semaines séparant l'annonce de la soirée.
//
// Conventions reprises de HomeShortcutCard : carte blanche rayon 18, bordure,
// ombre légère, icône sur pastille teintée. L'accent de marque (jaune) la
// distingue des raccourcis gris sans en faire un bandeau publicitaire.
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import { formatTournamentDate, type Tournament } from '../../lib/tournaments';

export function HomeTournamentCard({ tournament, free, onPress }: {
  tournament: Tournament;
  /** Places libres au sens du serveur : zéro dès qu'une file d'attente existe. */
  free: number;
  onPress: () => void;
}) {
  const complet = free === 0;

  // La COULEUR porte l'information, avant même qu'on lise le texte : plein
  // jaune quand il reste de la place — même famille que « Trouver un match »,
  // c'est-à-dire « ceci est une action » — et sombre quand c'est complet, où
  // l'on n'entre plus qu'en liste d'attente.
  //
  // Surtout, la carte ne peut PAS être blanche : l'accueil a un haut coloré
  // (grande carte sombre, deux boutons jaune et noir) et un bas blanc. Une
  // carte blanche tombe dans le groupe du bas et disparaît — c'est ce qui
  // s'est passé à la première version.
  const fond      = complet ? Colors.heroBg : Colors.brand;
  const texte     = complet ? Colors.textOnDark : Colors.textOnBrand;
  const secondaire = complet ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.62)';
  const pastille  = complet ? 'rgba(255,255,255,0.12)' : Colors.primary;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.88}
      style={{
        flex: 1,
        backgroundColor: fond, borderRadius: 20,
        paddingVertical: 11, paddingHorizontal: 12,
        flexDirection: 'row', alignItems: 'center', gap: 10,
        // Même relief que les CTA principaux, pour appartenir à leur famille.
        shadowColor: complet ? '#000' : Colors.brandDeep,
        shadowOpacity: 0.25, shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 }, elevation: 5,
      }}
    >
      <View style={{
        width: 34, height: 34, borderRadius: 12,
        backgroundColor: pastille,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="medal" size={19} color={complet ? Colors.textOnDark : Colors.brand} stroke={2.3} />
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: Fonts.uiBlack, fontSize: 13.5, color: texte }}>
          {tournament.name}
        </Text>
        {/* Une date et une rareté : de quoi décider sans ouvrir la fiche. */}
        <Text numberOfLines={1} style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: secondaire, marginTop: 1 }}>
          {formatTournamentDate(tournament.starts_at)}
          {' · '}
          {complet
            ? 'complet — liste d’attente'
            : `${free} place${free > 1 ? 's' : ''}`}
        </Text>
      </View>

      <View style={{
        backgroundColor: complet ? 'rgba(255,255,255,0.14)' : Colors.primary,
        borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7,
      }}>
        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 11.5, color: Colors.textOnDark }}>
          {complet ? 'Voir' : 'S’inscrire'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default HomeTournamentCard;
