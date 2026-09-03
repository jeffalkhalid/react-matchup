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

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.88}
      style={{
        flex: 1,
        backgroundColor: Colors.bgCard, borderRadius: 18,
        borderWidth: 1, borderColor: 'rgba(255,193,26,0.45)',
        paddingVertical: 11, paddingHorizontal: 12,
        flexDirection: 'row', alignItems: 'center', gap: 10,
        shadowColor: '#0F172A', shadowOpacity: 0.05, shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 }, elevation: 2,
      }}
    >
      <View style={{
        width: 34, height: 34, borderRadius: 12,
        backgroundColor: 'rgba(255,193,26,0.16)',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="medal" size={19} color={Colors.brandDeep} stroke={2.2} />
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: Colors.textPrimary }}>
          {tournament.name}
        </Text>
        {/* Une date et une rareté : de quoi decider sans ouvrir la fiche. */}
        <Text numberOfLines={1} style={{ fontSize: 11.5, fontFamily: Fonts.ui, color: Colors.textSecondary, marginTop: 1 }}>
          {formatTournamentDate(tournament.starts_at)}
          {' · '}
          {complet
            ? 'complet — liste d’attente'
            : `${free} place${free > 1 ? 's' : ''}`}
        </Text>
      </View>

      <View style={{
        backgroundColor: complet ? Colors.bg : Colors.brand,
        borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7,
        borderWidth: complet ? 1 : 0, borderColor: Colors.border,
      }}>
        <Text style={{
          fontFamily: Fonts.uiBlack, fontSize: 11.5,
          color: complet ? Colors.textSecondary : Colors.textOnBrand,
        }}>
          {complet ? 'Voir' : 'S’inscrire'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default HomeTournamentCard;
