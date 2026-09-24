// components/activity/MyOddsCard.tsx — « Prono des PAGUISTES ».
//
// Les pronostics posés sur MES matchs. On ne vote pas ici : l'issue dépend de
// nous. Mais savoir que 80 % nous voient perdre est justement ce qui donne
// envie d'aller leur donner tort — c'est l'enjeu, pas un jugement.
//
// Et une fois le match joué, on leur répond. « Tu leur as donné tort. »,
// « Ils avaient vu juste. » C'est la même carte qui pose la question avant et
// donne la réponse après ; elle parle d'EUX des deux côtés du match, jamais
// « du club », sans quoi elle changerait de bouche en route.
//
// Bloc séparé de « Qui va gagner ? » : là-bas on donne son avis, ici on reçoit
// celui des autres. Mélanger les deux mettait dans la même liste des cartes
// qu'on peut taper et d'autres non.
//
// Données : tables `predictions` (supabase/migrations/predictions.sql) et
// `matches`. Sans avis posé, il n'y a rien à confirmer ni à démentir, et la
// carte ne s'affiche pas — avant comme après le match.
import { useCallback, useState } from 'react';
import { View, Text, ScrollView, useWindowDimensions } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Colors, Fonts, formatPadelLevel } from '../../lib/theme';
import { Icon } from '../community/icons';
import { PlayerAvatar } from '../PlayerAvatar';
import {
  fetchClashCandidates, fetchPredictionsForGames,
  clashesToPredict, clashesPlayed, myClashes, myTeamIn,
  countPredictions, predictionShare, oddsLine, clashWhenLabel, clashStake,
  type Clash, type ClashPlayer, type PredictionCounts, type Team,
} from '../../lib/weekendClash';
import {
  clashWindow, clashPhase, fetchResultsForGames, winnerTeam, crowdShare,
  oddsOutcomeLine, orderRail, scoreLabel, pairLabel,
  type ClashPhase, type ClashResult,
} from '../../lib/clashResult';
import { StakeGriffe, StakePill } from './StakeMark';
import { ClashOutcome, PhasePill, CrowdBar } from './ClashOutcome';

const SOMBRE = '#0A0A0A';
const TUILE = '#1A1A1C';
const BLANC_45 = 'rgba(255,255,255,0.45)';
const JAUNE_DOUX = 'rgba(255,193,26,0.16)';
const VERT_DOUX = 'rgba(16,185,129,0.14)';

/** Une de mes parties, son âge, et ce qu'on sait de son issue. */
interface Carte extends Clash {
  phase: ClashPhase;
  result: ClashResult | null;
  winner: Team | null;
}

/** Une paire. Mon camp est mis en avant avant le match, le vainqueur après. */
function Camp({ players, moi, gagnant, terne }: {
  players: ClashPlayer[];
  moi: boolean;
  gagnant?: boolean;
  terne?: boolean;
}) {
  const bordure = gagnant ? Colors.success : moi ? Colors.brand : 'rgba(255,255,255,0.08)';
  const fond = gagnant ? VERT_DOUX : moi ? JAUNE_DOUX : TUILE;
  return (
    <View style={{
      flex: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 6,
      backgroundColor: fond, borderWidth: gagnant || moi ? 1.5 : 1, borderColor: bordure,
    }}>
      {gagnant ? (
        <View style={{
          position: 'absolute', top: -6, right: -2, zIndex: 2,
          width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.brand,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="crown" size={11} color={Colors.primary} stroke={2.4} />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 4, opacity: terne ? 0.45 : 1 }}>
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
    </View>
  );
}

export function MyOddsCard({ myId }: { myId: string }) {
  const { width } = useWindowDimensions();
  const [clashes, setClashes] = useState<Carte[]>([]);
  const [counts, setCounts] = useState<Record<string, PredictionCounts>>({});

  const load = useCallback(() => {
    let vivant = true;
    (async () => {
      const { start, end } = clashWindow();
      const parties = await fetchClashCandidates(start, end);
      const aVenir = myClashes(clashesToPredict(parties), myId);
      const jouees = myClashes(clashesPlayed(parties), myId);
      const toutes = [...aVenir, ...jouees];

      const [avis, resultats] = await Promise.all([
        fetchPredictionsForGames(toutes.map(c => c.gameId)),
        fetchResultsForGames(jouees.map(c => c.gameId)),
      ]);
      if (!vivant) return;

      const c: Record<string, PredictionCounts> = {};
      const cartes: Carte[] = [];
      for (const clash of toutes) {
        const compte = countPredictions(avis.get(clash.gameId) ?? []);
        // Sans aucun avis, il n'y a rien à confirmer ni à démentir.
        if (compte.total === 0) continue;

        const result = resultats.get(clash.gameId) ?? null;
        const phase = clashPhase(clash.matchDate, result);
        if (!phase) continue;

        c[clash.gameId] = compte;
        cartes.push({ ...clash, phase, result, winner: result ? winnerTeam(clash, result.winnerIds) : null });
      }

      // Le verdict d'abord : c'est la réponse qu'on vient chercher.
      setClashes(orderRail(cartes.map(x => ({ ...x, mien: myTeamIn(x, myId) }))));
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
        Ce qu'ils voient de tes matchs — et ce que ça a donné.
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
          const mise = clashStake(clash);
          const termine = clash.phase === 'termine';
          const gagnant = termine ? clash.winner : null;
          const jaiGagne = !!gagnant && gagnant === monCamp;
          const phrase = termine
            ? (oddsOutcomeLine(c, monCamp, clash.winner)
               ?? (clash.winner ? null : 'La composition a changé : pas de verdict sur ce match.'))
            : oddsLine(c, monCamp);

          return (
            <View key={clash.gameId} style={{ width: LARGEUR, borderRadius: 18, backgroundColor: SOMBRE, overflow: 'hidden' }}>
              {/* Sur MON match, la mise est l'enjeu : elle se voit d'abord. */}
              <StakeGriffe stake={mise} />
              <View style={{ padding: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <StakePill stake={mise} />
                <Text numberOfLines={1} style={{ flex: 1, fontFamily: Fonts.uiBold, fontSize: 11, color: BLANC_45 }}>
                  {clashWhenLabel(clash)}
                </Text>
                <PhasePill phase={clash.phase} />
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Camp
                  players={clash.teamA}
                  moi={!termine && monCamp === 'A'}
                  gagnant={gagnant === 'A'}
                  terne={!!gagnant && gagnant !== 'A'}
                />
                <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: BLANC_45 }}>VS</Text>
                <Camp
                  players={clash.teamB}
                  moi={!termine && monCamp === 'B'}
                  gagnant={gagnant === 'B'}
                  terne={!!gagnant && gagnant !== 'B'}
                />
              </View>

              {termine ? (
                <ClashOutcome
                  winnerLabel={gagnant ? pairLabel(gagnant === 'A' ? clash.teamA : clash.teamB) : null}
                  scoreText={scoreLabel(clash.result?.scoreText)}
                  message={phrase}
                  tone={!clash.winner ? 'neutre' : jaiGagne ? 'juste' : 'rate'}
                  crowd={crowdShare(c, clash.winner)}
                />
              ) : null}

              {clash.phase === 'en_cours' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 }}>
                  <Icon name="signal" size={12} color={Colors.danger} stroke={2.2} />
                  <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: Colors.danger }}>
                    Le match se joue maintenant
                  </Text>
                </View>
              ) : null}

              {!termine && phrase ? (
                <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: Colors.brand, marginTop: 12, textAlign: 'center' }}>
                  {phrase}
                </Text>
              ) : null}

              <CrowdBar
                labelA={pairLabel(clash.teamA)}
                labelB={pairLabel(clash.teamB)}
                shareA={predictionShare(c, 'A')}
                highlight={termine ? clash.winner : monCamp}
              />

              <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: BLANC_45, marginTop: 10, textAlign: 'center' }}>
                {`${c.total} pronostic${c.total > 1 ? 's' : ''}`}
              </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
