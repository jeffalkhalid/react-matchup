// components/activity/CircleBilansRail.tsx — « Les bilans de ton cercle ».
//
// Le fil s'arrête à 14 jours : les bilans publiés avant en disparaissent alors
// qu'ils restent intéressants tout le mois. Ce bloc les garde à portée, un par
// joueur, le plus récent d'abord. Toucher une carte ouvre le bilan en pages,
// comme depuis le fil.
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import { PlayerAvatar } from '../PlayerAvatar';
import { AmbassadorRing } from '../ambassador/primitives';
import type { CircleBilan } from '../../lib/bilanCircle';

export function CircleBilansRail({ bilans, myId, onOpen }: {
  bilans: CircleBilan[];
  myId: string;
  onOpen: (b: CircleBilan) => void;
}) {
  if (bilans.length === 0) return null;

  return (
    <View style={{ marginTop: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <Icon name="trendingUp" size={15} color={Colors.brandDeep} stroke={2.2} />
        <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: Fonts.welcome, fontSize: 16, lineHeight: 21, color: Colors.textPrimary, paddingRight: 6 }}>
          Les bilans de ton cercle
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -16 }}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
      >
        {bilans.map(b => {
          const moi = b.playerId === myId;
          const prenom = moi ? 'Toi' : b.name.trim().split(/\s+/)[0];
          const photo = (
            <PlayerAvatar
              name={b.name} path={b.avatarPath} size={46}
              backgroundColor={Colors.brand} textColor={Colors.primary}
              fontFamily={Fonts.uiBlack} fontSize={16} initialsMax={2}
            />
          );
          return (
            <TouchableOpacity
              key={b.eventId}
              onPress={() => onOpen(b)}
              activeOpacity={0.85}
              accessibilityLabel={`Ouvrir le bilan de ${prenom}`}
              style={{
                width: 132, borderRadius: 16, padding: 12, alignItems: 'center', gap: 6,
                backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
              }}
            >
              {b.memberNumber != null
                ? <AmbassadorRing size={46} radius={23} showStar={false} surface={Colors.bgCard}>{photo}</AmbassadorRing>
                : photo}
              <Text numberOfLines={1} style={{ fontFamily: Fonts.uiBlack, fontSize: 13, color: Colors.textPrimary }}>{prenom}</Text>
              <View style={{ backgroundColor: 'rgba(255,193,26,0.16)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 }}>
                <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10, color: Colors.brandDeep, letterSpacing: 0.6 }}>
                  {(b.label || 'BILAN').toUpperCase()}
                </Text>
              </View>
              <Text style={{ fontFamily: Fonts.uiBold, fontSize: 10.5, color: Colors.textMuted }}>
                {b.recap?.matches != null ? `${b.recap.matches} match${b.recap.matches > 1 ? 's' : ''}` : 'Voir'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}
