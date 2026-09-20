// components/activity/CircleBilansRail.tsx — « Les bilans de ton cercle ».
//
// Le fil s'arrête à 14 jours : les bilans publiés avant en disparaissent alors
// qu'ils restent intéressants tout le mois. Ce bloc les garde à portée, un par
// joueur, le plus récent d'abord.
//
// Des COUVERTURES, pas des lignes : la tuile reprend le dégradé et le format
// de la première page du bilan, comme le rail des Moments à côté. On voit ce
// qu'on va ouvrir, et les deux rails forment une famille.
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { GradientBg } from '../bilan/GradientBg';
import { PlayerAvatar } from '../PlayerAvatar';
import { AmbassadorRing } from '../ambassador/primitives';
import type { CircleBilan } from '../../lib/bilanCircle';

/** Même format que les tuiles de Moments — les deux rails se répondent. */
const TILE_W = 128;
const TILE_H = 184;
/** Le dégradé de la couverture du bilan (BilanStory, slide 0). */
const COUVERTURE = ['#FFC11A', '#E8A906', '#7C2D12'];

export function CircleBilansRail({ bilans, myId, onOpen }: {
  bilans: CircleBilan[];
  myId: string;
  onOpen: (b: CircleBilan) => void;
}) {
  if (bilans.length === 0) return null;

  return (
    <View style={{ marginTop: 18 }}>
      <Text numberOfLines={1} style={{ fontFamily: Fonts.welcome, fontSize: 16, lineHeight: 21, color: Colors.textPrimary, paddingRight: 6, marginBottom: 8 }}>
        Les bilans de ton cercle
      </Text>

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
              name={b.name} path={b.avatarPath} size={68}
              backgroundColor={Colors.primary} textColor="#FFFFFF"
              fontFamily={Fonts.uiBlack} fontSize={24}
              ring={2} ringColor="#FFFFFF" initialsMax={2}
            />
          );
          return (
            <TouchableOpacity
              key={b.eventId}
              onPress={() => onOpen(b)}
              activeOpacity={0.9}
              accessibilityLabel={`Ouvrir le bilan de ${prenom}`}
              style={{ width: TILE_W, height: TILE_H, borderRadius: 18, overflow: 'hidden' }}
            >
              <GradientBg colors={COUVERTURE} angle={160}>
                {/* Une couverture, pas une fiche : le visage dit qui c'est,
                    le mois dit quoi. Le reste se lit en ouvrant. */}
                <View style={{ flex: 1, padding: 12, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                  {b.memberNumber != null
                    ? <AmbassadorRing size={68} radius={34} showStar={false} surface="transparent">{photo}</AmbassadorRing>
                    : photo}
                  <Text
                    numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}
                    style={{ fontFamily: Fonts.welcome, fontSize: 30, lineHeight: 34, color: Colors.primary, paddingRight: 4, alignSelf: 'stretch', textAlign: 'center' }}>
                    {(b.label || 'Le mois').toLowerCase().replace(/^./, c => c.toUpperCase())}
                  </Text>
                </View>
              </GradientBg>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}
