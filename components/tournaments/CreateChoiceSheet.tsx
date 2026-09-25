// components/tournaments/CreateChoiceSheet.tsx — « Tu organises quoi ? »
//
// Les deux natures ne se distinguent pas par un mot mais par ce qu'on y fait,
// et c'est ce que disent les deux sur-titres : ON JOUE ET ON SE CLASSE contre
// ON SE RETROUVE. Un organisateur qui hésite entre « tournoi » et
// « événement » n'hésite plus devant ces deux phrases-là.
//
// Le code couleur est le même que partout : noir = tournoi (compétition),
// jaune = événement (le club invite).
//
// Surimpression absolue, pas un <Modal> natif : une navigation part d'ici, et
// depuis une <Modal> RN l'écran s'ouvrirait DERRIÈRE elle
// (feedback_nav_depuis_modal_native).
import React from 'react';
import { View, Text, TouchableOpacity, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';

export function CreateChoiceSheet({
  visible, onClose, onTournoi, onEvenement, repeatLabel, onRepeat,
}: {
  visible: boolean;
  onClose: () => void;
  onTournoi: () => void;
  onEvenement: () => void;
  /** « Refaire la montante de jeudi » — absent s'il n'y a rien à refaire. */
  repeatLabel?: string | null;
  onRepeat?: () => void;
}) {
  const insets = useSafeAreaInsets();
  if (!visible) return null;

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' }}>
      <Pressable
        onPress={onClose}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10,10,10,0.45)' }}
      />

      <View style={{
        backgroundColor: Colors.bgCard, borderTopLeftRadius: 24, borderTopRightRadius: 24,
        paddingHorizontal: 18, paddingTop: 10, paddingBottom: insets.bottom + 18, gap: 12,
      }}>
        <View style={{ alignItems: 'center', paddingBottom: 4 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border }} />
        </View>

        <Text style={{ fontSize: 22, fontFamily: Fonts.welcome, color: Colors.textPrimary, paddingRight: 6 }}>
          Tu organises quoi ?
        </Text>

        <TouchableOpacity
          onPress={onTournoi}
          activeOpacity={0.9}
          style={{ backgroundColor: Colors.primary, borderRadius: 18, padding: 16, gap: 4 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, fontSize: 9.5, fontFamily: Fonts.uiBlack, letterSpacing: 1.1, color: Colors.brand }}>
              ON JOUE ET ON SE CLASSE
            </Text>
            <Icon name="chevronRight" size={16} color="rgba(255,255,255,0.5)" stroke={2.2} />
          </View>
          <Text style={{ fontSize: 20, fontFamily: Fonts.welcome, color: Colors.brand, paddingRight: 6 }}>
            Un tournoi
          </Text>
          <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: 'rgba(255,255,255,0.7)', lineHeight: 17 }}>
            Montante / descente. On s’inscrit à deux, on gagne des points.
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onEvenement}
          activeOpacity={0.9}
          style={{ backgroundColor: Colors.brand, borderRadius: 18, padding: 16, gap: 4 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, fontSize: 9.5, fontFamily: Fonts.uiBlack, letterSpacing: 1.1, color: 'rgba(10,10,10,0.6)' }}>
              ON SE RETROUVE
            </Text>
            <Icon name="chevronRight" size={16} color="rgba(10,10,10,0.45)" stroke={2.2} />
          </View>
          <Text style={{ fontSize: 20, fontFamily: Fonts.welcome, color: Colors.primary, paddingRight: 6 }}>
            Un événement
          </Text>
          <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: 'rgba(10,10,10,0.7)', lineHeight: 17 }}>
            Découverte, stage, afterwork… Chacun répond « J’y serai ».
          </Text>
        </TouchableOpacity>

        {/* Le raccourci de l'habitude : un rendez-vous hebdomadaire ne se
            renégocie pas, il se reconduit. */}
        {repeatLabel && onRepeat && (
          <TouchableOpacity
            onPress={onRepeat}
            activeOpacity={0.8}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 12,
              backgroundColor: Colors.bgCardAlt, borderRadius: 16, padding: 14,
            }}
          >
            <Icon name="zap" size={18} color={Colors.textSecondary} stroke={2.2} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
                {repeatLabel}
              </Text>
              <Text style={{ fontSize: 11, fontFamily: Fonts.ui, color: Colors.textSecondary }}>
                Mêmes réglages, semaine prochaine — tu n’as qu’à relire.
              </Text>
            </View>
          </TouchableOpacity>
        )}

        <TouchableOpacity onPress={onClose} style={{ alignItems: 'center', padding: 8 }}>
          <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>
            Laisse tomber
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
