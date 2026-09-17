// components/home/HomeRankButton.tsx — le classement dans l'en-tête de l'accueil.
//
// Il vivait en bas, dans une rangée de deux raccourcis. Cette rangée était la
// seule chose sur l'accueil qu'on pouvait retirer sans rien perdre : « Score »
// s'atteint depuis le lobby et depuis le guide, avec le match en contexte, ce
// que la carte de l'accueil ne savait pas faire. Le rang, lui, ne se lisait
// nulle part ailleurs — il fallait donc lui trouver une place, pas le
// supprimer avec la rangée.
//
// IL PREND LA PLACE DE LA LOUPE, il ne s'ajoute pas à côté. Le logo est
// STRICTEMENT centré sur 360 dp (gauche 12..80 · logo 126,5..233,5 · droite
// 238..348, cf. index.tsx) : un TROISIÈME bouton à gauche pousserait le
// cluster jusqu'au logo. La loupe menait à /community/friends, le bouton
// voisin à /community — qui porte déjà la même loupe, en haut à droite. On
// échangeait donc deux portes voisines vers le même endroit contre un
// raccourci qui n'existait plus.
//
// LE RANG EST UNE PASTILLE POSÉE PAR-DESSUS, pas un texte à côté de l'icône :
// « #128 » à côté d'un trophée élargirait le bouton et casserait le budget de
// largeur. En superposition, il ne coûte RIEN à la mise en page — il déborde
// d'environ 8 px vers la droite, et le logo ne commence qu'à 126,5.
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';

export function HomeRankButton({ rank, size = 34, onPress }: {
  /** Rang au classement général. `null` tant qu'on ne l'a pas encore lu. */
  rank: number | null;
  size?: number;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityLabel={rank != null ? `Classement, ${rank}e` : 'Classement'}
      style={{
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: Colors.heroBg,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Icon name="trophy" size={17} color={Colors.brand} stroke={2} />
      {/* Pas de pastille tant que le rang n'est pas chargé : afficher « #— »
          une demi-seconde attire l'œil sur une information vide. */}
      {rank != null && (
        <View style={{
          position: 'absolute', bottom: -3, right: -6,
          minWidth: 16, height: 15, borderRadius: 8,
          paddingHorizontal: 3.5,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: Colors.brand,
          // Le liseré couleur page détache la pastille du rond sombre —
          // sans lui, les deux formes se touchent et se lisent comme une seule.
          borderWidth: 1.5, borderColor: '#F7F7F7',
        }}>
          <Text
            numberOfLines={1}
            style={{
              fontSize: 9, lineHeight: 11,
              fontFamily: Fonts.uiBlack, color: Colors.primary,
            }}
          >
            {rank}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default HomeRankButton;
