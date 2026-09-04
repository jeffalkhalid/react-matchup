// Carte de la prochaine soirée, sur l'accueil.
//
// Elle apparaît dès qu'un tournoi est annoncé et dit OÙ J'EN SUIS : à
// s'inscrire, inscrit, ou en liste d'attente. Elle ne disparaît pas une fois
// qu'on est dedans — c'était la première version, et on perdait de vue qu'on
// joue jeudi.
//
// Ce qui varie, c'est l'INSISTANCE, pas la présence : plein jaune quand il
// reste quelque chose à faire, sombre le reste du temps. C'est ce qui remplace
// une animation clignotante, qui aurait clignoté pendant les trois semaines
// séparant l'annonce de la soirée.
//
// Relief et rayon repris des CTA principaux (HomePrimaryActions) : la carte
// appartient à la famille des actions, pas à celle des cartes d'information.
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import { formatTournamentDate, type Tournament, type HomeTournamentState } from '../../lib/tournaments';

export function HomeTournamentCard({ tournament, free, state, onPress }: {
  tournament: Tournament;
  /** Places libres au sens du serveur : zéro dès qu'une file d'attente existe. */
  free: number;
  /** Où j'en suis : pas inscrit, inscrit, ou en liste d'attente. */
  state: HomeTournamentState;
  onPress: () => void;
}) {
  const complet = free === 0;
  // Seul l'état « pas encore inscrit ET il reste de la place » réclame quelque
  // chose. Les deux autres informent : je suis dedans, ou j'attends mon tour.
  const aAgir = state === 'open' && !complet;

  // La COULEUR porte l'information avant même qu'on lise : plein jaune quand
  // il faut s'inscrire — même famille que « Trouver un match », c'est-à-dire
  // « ceci est une action » — et sombre dès qu'on n'a plus rien à faire.
  //
  // Ce n'est PAS la présence de la carte qui doit être rare, c'est son
  // insistance. La première version la faisait disparaître à l'inscription :
  // on perdait de vue qu'on joue jeudi.
  //
  // Et elle ne peut pas être blanche : l'accueil a un haut coloré (grande
  // carte sombre, deux boutons jaune et noir) et un bas blanc — une carte
  // blanche tombe dans le groupe du bas et disparaît.
  const fond       = aAgir ? Colors.brand : Colors.heroBg;
  const texte      = aAgir ? Colors.textOnBrand : Colors.textOnDark;
  const secondaire = aAgir ? 'rgba(0,0,0,0.62)' : 'rgba(255,255,255,0.65)';
  const pastille   = aAgir ? Colors.primary : 'rgba(255,255,255,0.12)';

  const etat =
    state === 'registered' ? 'Tu es inscrit'
    : state === 'waitlisted' ? 'Tu es en liste d’attente'
    : complet ? 'complet — liste d’attente'
    : `${free} place${free > 1 ? 's' : ''}`;

  const bouton =
    state === 'registered' ? 'Voir'
    : state === 'waitlisted' ? 'Voir'
    : complet ? 'Voir'
    : 'S’inscrire';

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
        shadowColor: aAgir ? Colors.brandDeep : '#000',
        shadowOpacity: 0.25, shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 }, elevation: 5,
      }}
    >
      <View style={{
        width: 34, height: 34, borderRadius: 12,
        backgroundColor: pastille,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="medal" size={19} color={aAgir ? Colors.brand : Colors.textOnDark} stroke={2.3} />
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: Fonts.uiBlack, fontSize: 13.5, color: texte }}>
          {tournament.name}
        </Text>
        {/* Une date et une rareté : de quoi décider sans ouvrir la fiche. */}
        <Text numberOfLines={1} style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: secondaire, marginTop: 1 }}>
          {formatTournamentDate(tournament.starts_at)}
          {' · '}
          {etat}
        </Text>
      </View>

      <View style={{
        backgroundColor: aAgir ? Colors.primary : 'rgba(255,255,255,0.14)',
        borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7,
      }}>
        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 11.5, color: Colors.textOnDark }}>
          {bouton}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default HomeTournamentCard;
