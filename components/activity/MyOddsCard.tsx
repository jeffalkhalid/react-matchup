// components/activity/MyOddsCard.tsx — « Prono des PAGUISTES ».
//
// Les pronostics posés sur MES matchs à venir. On ne vote pas ici : l'issue
// dépend de nous. Mais savoir que 80 % nous voient perdre est justement ce qui
// donne envie d'aller leur donner tort — c'est l'enjeu, pas un jugement.
//
// Bloc séparé de « Qui va gagner ? » : là-bas on donne son avis, ici on reçoit
// celui des autres. Mélanger les deux mettait dans la même liste des cartes
// qu'on peut taper et d'autres non.
//
// Données : table `predictions` (supabase/migrations/predictions.sql). Sans
// elle, aucun avis n'existe et le bloc ne s'affiche pas.
import { useCallback, useState } from 'react';
import { View, Text, ScrollView, useWindowDimensions } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Colors, Fonts, formatPadelLevel } from '../../lib/theme';
import { Icon } from '../community/icons';
import { PlayerAvatar } from '../PlayerAvatar';
import {
  predictionWindow, fetchClashCandidates, fetchPredictionsForGames,
  clashesToPredict, myClashes, myTeamIn, countPredictions, predictionShare, oddsLine,
  clashWhenLabel, type Clash, type ClashPlayer, type PredictionCounts, type Team,
} from '../../lib/weekendClash';

const SOMBRE = '#0A0A0A';
const TUILE = '#1A1A1C';
const BLANC_45 = 'rgba(255,255,255,0.45)';
const JAUNE_DOUX = 'rgba(255,193,26,0.16)';

/** Une paire avec sa part des avis. Mon camp est mis en avant. */
function Camp({ players, moi, part }: { players: ClashPlayer[]; moi: boolean; part: number }) {
  return (
    <View style={{
      flex: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 6,
      backgroundColor: moi ? JAUNE_DOUX : TUILE,
      borderWidth: moi ? 1.5 : 1,
      borderColor: moi ? Colors.brand : 'rgba(255,255,255,0.08)',
    }}>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 4 }}>
        {players.map(p => (
          <View key={p.id} style={{ alignItems: 'center', gap: 5, flex: 1, minWidth: 0 }}>
            <PlayerAvatar
              name={p.name} path={p.avatarPath} size={50}
              backgroundColor={Colors.brand} textColor={Colors.primary}
              fontFamily={Fonts.uiBlack} fontSize={17} initialsMax={2}
            />
            <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11.5, color: '#FFFFFF' }}>
              {p.name.trim().split(/\s+/)[0]}
            </Text>
            {p.elo != null ? (
              <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10, color: Colors.brand }}>
                Niv {formatPadelLevel(p.elo)}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
      <Text style={{
        fontFamily: Fonts.uiBlack, fontSize: 15, marginTop: 8, textAlign: 'center',
        color: moi ? Colors.brand : BLANC_45,
      }}>
        {`${part} %`}
      </Text>
    </View>
  );
}

export function MyOddsCard({ myId }: { myId: string }) {
  const { width } = useWindowDimensions();
  const [clashes, setClashes] = useState<Clash[]>([]);
  const [counts, setCounts] = useState<Record<string, PredictionCounts>>({});

  const load = useCallback(() => {
    let vivant = true;
    (async () => {
      const { start, end } = predictionWindow();
      const parties = await fetchClashCandidates(start, end);
      const miens = myClashes(clashesToPredict(parties), myId);
      const avis = await fetchPredictionsForGames(miens.map(c => c.gameId));
      if (!vivant) return;
      const c: Record<string, PredictionCounts> = {};
      for (const clash of miens) c[clash.gameId] = countPredictions(avis.get(clash.gameId) ?? []);
      // Sans aucun avis, il n'y a rien à confirmer ni à démentir.
      setClashes(miens.filter(x => (c[x.gameId]?.total ?? 0) > 0));
      setCounts(c);
    })();
    return () => { vivant = false; };
  }, [myId]);

  useFocusEffect(useCallback(() => { const stop = load(); return stop; }, [load]));

  if (clashes.length === 0) return null;

  const LARGEUR = Math.min(width - 56, 320);

  return (
    <View style={{ marginTop: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 2 }}>
        <Icon name="megaphone" size={15} color={Colors.textPrimary} stroke={2} />
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: Fonts.welcome, fontSize: 16, lineHeight: 21, color: Colors.textPrimary, paddingRight: 6 }}>
          Prono des PAGUISTES
        </Text>
      </View>
      <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11.5, lineHeight: 16, color: Colors.textSecondary, marginBottom: 10 }}>
        Les pronostics posés sur tes matchs à venir.
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={LARGEUR + 10}
        decelerationRate="fast"
        style={{ marginHorizontal: -16 }}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
      >
        {clashes.map(clash => {
          const c = counts[clash.gameId] ?? { A: 0, B: 0, total: 0 };
          const monCamp = myTeamIn(clash, myId);
          const phrase = oddsLine(c, monCamp);
          return (
            <View key={clash.gameId} style={{ width: LARGEUR, borderRadius: 18, backgroundColor: SOMBRE, padding: 14 }}>
              <Text numberOfLines={1} style={{ fontFamily: Fonts.uiBold, fontSize: 11, color: BLANC_45, marginBottom: 10 }}>
                {clashWhenLabel(clash)}
              </Text>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Camp players={clash.teamA} moi={monCamp === 'A'} part={predictionShare(c, 'A')} />
                <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: BLANC_45 }}>VS</Text>
                <Camp players={clash.teamB} moi={monCamp === 'B'} part={predictionShare(c, 'B')} />
              </View>

              {phrase ? (
                <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: Colors.brand, marginTop: 12, textAlign: 'center' }}>
                  {phrase}
                </Text>
              ) : null}
              <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: BLANC_45, marginTop: 4, textAlign: 'center' }}>
                {`${c.total} avis`}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
