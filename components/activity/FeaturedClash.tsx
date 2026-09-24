// components/activity/FeaturedClash.tsx — « Qui va gagner ? »
//
// Les parties qu'on peut pronostiquer, l'avis du reste du club, et — depuis
// qu'on ferme la boucle — ce que ce pronostic est devenu une fois le match
// joué. Un pronostic n'engage rien : ni place, ni ELO, ni notification. C'est
// une conversation, pas un pari.
//
// Une carte a trois âges (lib/clashResult) :
//   • à venir  — on vote, comme avant ;
//   • en cours — les votes sont clos, la répartition se découvre ;
//   • terminé  — le vainqueur, le score, et le verdict de MON pronostic.
//
// Avant, la carte disparaissait au coup d'envoi : on votait sans jamais
// apprendre si on avait vu juste. Les lignes de `predictions` étaient écrites
// puis plus jamais relues.
//
// L'ORDRE du rail suit ce que chaque carte me doit : ma récompense d'abord,
// puis ce que je peux encore voter, puis l'attente, puis les nouvelles. Un
// plafond sur le nombre de résultats ferait la même chose en pire — il
// jetterait des cartes pour résoudre un problème d'ordre.
//
// Deux écarts assumés avec le handoff (§4c), tous deux vus sur téléphone :
//  • il réservait le bloc au week-end et au dimanche — on ne voyait jamais
//    rien. Il vaut pour toutes les parties, tous les jours.
//  • il n'en montrait qu'UNE, « le choc ». Douze autres parties restaient
//    sans personne pour en parler. Elles défilent maintenant toutes, et la
//    plus serrée porte la pastille « LE CHOC ».
//
// On ne pronostique pas son propre match : l'issue dépend de nous, et
// « 58 % pensent que tu vas perdre » n'est pas une conversation. Ces
// parties-là vivent dans <MyOddsCard>.
//
// Données : tables `predictions` (supabase/migrations/predictions.sql) et
// `matches`. Tant que `predictions` n'existe pas, les cartes s'affichent mais
// le vote répond qu'il n'est pas encore ouvert.
import { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, useWindowDimensions } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Colors, Fonts, formatPadelLevel } from '../../lib/theme';
import { Icon } from '../community/icons';
import { PlayerAvatar } from '../PlayerAvatar';
import {
  fetchClashCandidates, fetchPredictionsForGames, castPrediction,
  clashesToPredict, clashesPlayed, tightestClashId, withoutMyGames,
  countPredictions, predictionShare, clashWhenLabel, clashStake,
  type Clash, type ClashPlayer, type PredictionCounts, type Team,
} from '../../lib/weekendClash';
import {
  clashWindow, clashPhase, fetchResultsForGames, winnerTeam, myVerdict, crowdShare,
  orderRail, scoreLabel, pairLabel,
  type ClashPhase, type ClashResult,
} from '../../lib/clashResult';
import { StakeGriffe, StakePill } from './StakeMark';
import { ClashOutcome, PhasePill, CrowdBar } from './ClashOutcome';

const SOMBRE = '#0A0A0A';
const TUILE = '#1A1A1C';
const BLANC_60 = 'rgba(255,255,255,0.6)';
const BLANC_45 = 'rgba(255,255,255,0.45)';
const JAUNE_DOUX = 'rgba(255,193,26,0.16)';
const VERT_DOUX = 'rgba(16,185,129,0.14)';

/** Une carte du rail : une partie, son âge, et ce qu'on sait de son issue. */
interface Carte extends Clash {
  phase: ClashPhase;
  result: ClashResult | null;
  winner: Team | null;
}

/**
 * Une paire, présentée comme sur la carte de match : photo, prénom, niveau.
 *
 * Tapable seulement tant qu'on peut voter. Passé le coup d'envoi, `onPress`
 * est absent et la tuile devient un simple affichage — un bouton qui ne fait
 * rien est pire qu'un bouton absent.
 */
function Cote({ players, choisi, gagnant, terne, onPress }: {
  players: ClashPlayer[];
  /** Mon pronostic. */
  choisi: boolean;
  /** La paire qui a gagné : liseré vert et couronne. */
  gagnant?: boolean;
  /** La paire qui a perdu : on l'efface sans la cacher. */
  terne?: boolean;
  onPress?: () => void;
}) {
  const bordure = gagnant ? Colors.success : choisi ? Colors.brand : 'rgba(255,255,255,0.08)';
  const fond = gagnant ? VERT_DOUX : choisi ? JAUNE_DOUX : TUILE;
  const contenu = (
    <>
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
    </>
  );

  const style = {
    flex: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 6,
    backgroundColor: fond, borderWidth: gagnant || choisi ? 1.5 : 1, borderColor: bordure,
  } as const;

  if (!onPress) return <View style={style}>{contenu}</View>;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={style}>
      {contenu}
    </TouchableOpacity>
  );
}

export function FeaturedClash({ myId, onContent, focusGameId }: {
  myId: string;
  /** Prévient l'écran quand le bloc a — ou n'a plus — quelque chose à dire. */
  onContent?: (has: boolean) => void;
  /**
   * Arrivée depuis l'accueil sur UN match précis : sa carte passe en tête du
   * rail. On pourrait faire défiler jusqu'à elle, mais la remonter est
   * déterministe — pas de mesure, pas d'animation qui rate.
   */
  focusGameId?: string | null;
}) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [clashes, setClashes] = useState<Carte[]>([]);
  const [choc, setChoc] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, PredictionCounts>>({});
  const [mine, setMine] = useState<Record<string, Team>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);

  const load = useCallback(() => {
    let vivant = true;
    (async () => {
      const { start, end } = clashWindow();
      const parties = await fetchClashCandidates(start, end);
      // On ne pronostique pas son propre match : l'issue dépend de nous.
      const aVenir = withoutMyGames(clashesToPredict(parties), myId);
      const jouees = withoutMyGames(clashesPlayed(parties), myId);
      const toutes = [...aVenir, ...jouees];

      const [avis, resultats] = await Promise.all([
        fetchPredictionsForGames(toutes.map(c => c.gameId)),
        fetchResultsForGames(jouees.map(c => c.gameId)),
      ]);
      if (!vivant) return;

      const c: Record<string, PredictionCounts> = {};
      const m: Record<string, Team> = {};
      const cartes: Carte[] = [];
      for (const clash of toutes) {
        const result = resultats.get(clash.gameId) ?? null;
        const phase = clashPhase(clash.matchDate, result);
        // `null` : joué il y a longtemps, aucun score jamais saisi. La carte
        // n'a plus rien à dire, elle sort du rail.
        if (!phase) continue;

        const rows = avis.get(clash.gameId) ?? [];
        c[clash.gameId] = countPredictions(rows);
        const mien = rows.find(r => r.playerId === myId)?.team;
        if (mien) m[clash.gameId] = mien;

        cartes.push({ ...clash, phase, result, winner: result ? winnerTeam(clash, result.winnerIds) : null });
      }

      const ordonnees = orderRail(cartes.map(x => ({ ...x, mien: m[x.gameId] ?? null })));
      // Le match demandé depuis l'accueil passe devant tout le reste.
      const finales = focusGameId
        ? [...ordonnees].sort((a, b) => (a.gameId === focusGameId ? -1 : b.gameId === focusGameId ? 1 : 0))
        : ordonnees;

      setClashes(finales);
      setChoc(tightestClashId(aVenir));
      setCounts(c); setMine(m); setCharge(true);
      onContent?.(finales.length > 0);
    })();
    return () => { vivant = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId, focusGameId]);

  useFocusEffect(useCallback(() => { const stop = load(); return stop; }, [load]));

  if (!charge || clashes.length === 0) return null;

  const voter = async (clash: Carte, team: Team) => {
    const avant = mine[clash.gameId] ?? null;
    setErreur(null);
    setMine(m => ({ ...m, [clash.gameId]: team }));
    // Compte optimiste : on retire l'ancien avis avant d'ajouter le nouveau.
    setCounts(c => {
      const actuel = c[clash.gameId] ?? { A: 0, B: 0, total: 0 };
      const next = { ...actuel };
      if (avant) next[avant] = Math.max(0, next[avant] - 1); else next.total += 1;
      next[team] += 1;
      return { ...c, [clash.gameId]: next };
    });
    const souci = await castPrediction(clash.gameId, myId, team);
    if (souci) {
      setErreur(souci);
      setMine(m => { const next = { ...m }; if (avant) next[clash.gameId] = avant; else delete next[clash.gameId]; return next; });
      load();
    }
  };

  // Une carte par partie, presque pleine largeur : on en voit une, on devine
  // la suivante, et on fait défiler.
  const LARGEUR = Math.min(width - 56, 320);
  const votables = clashes.filter(c => c.phase === 'a_venir');
  const votes = votables.filter(c => mine[c.gameId]).length;
  // Plus rien à voter : le rail ne parle que du passé, le titre le dit.
  const titre = votables.length > 0 ? 'Qui va gagner ?' : 'Résultat du match';

  return (
    <View style={{ marginTop: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icon name={votables.length > 0 ? 'swords' : 'trophy'} size={15} color={Colors.textPrimary} stroke={2} />
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: Fonts.welcome, fontSize: 16, lineHeight: 21, color: Colors.textPrimary, paddingRight: 6 }}>
          {titre}
        </Text>
        {votables.length > 0 ? (
          <TouchableOpacity onPress={() => router.push('/(tabs)/lobby' as any)} hitSlop={8}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11.5, color: Colors.textSecondary }}>
              {`${votes}/${votables.length} pronostiqué${votes > 1 ? 's' : ''}`}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11.5, lineHeight: 16, color: Colors.textSecondary, marginTop: 2, marginBottom: 10 }}>
        {votables.length > 0
          ? "Tape la paire que tu vois gagner. Ça n'engage rien."
          : 'Ce que tu avais vu, et ce qui s’est passé.'}
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
          const mien = mine[clash.gameId] ?? null;
          const estLeChoc = clash.gameId === choc;
          const mise = clashStake(clash);
          const aVenir = clash.phase === 'a_venir';
          const termine = clash.phase === 'termine';
          const gagnant = termine ? clash.winner : null;
          const verdict = termine ? myVerdict(mien, clash.winner) : null;
          // Avant le vote on ne montre pas la répartition : elle influencerait
          // le choix. Une fois voté — ou les votes clos — plus rien à protéger.
          const montrerBarre = c.total > 0 && (!aVenir || !!mien);

          const phrase =
            verdict === 'juste' ? 'Ton prono était correct.'
            : verdict === 'rate' && mien ? `Pas cette fois. Tu avais pronostiqué : ${pairLabel(mien === 'A' ? clash.teamA : clash.teamB)}.`
            : verdict === 'sans_prono' ? "Tu n'avais pas pronostiqué ce match."
            : verdict === 'indecidable' ? 'La composition a changé : pas de verdict sur ce match.'
            : null;

          return (
            <View key={clash.gameId} style={{ width: LARGEUR, borderRadius: 18, backgroundColor: SOMBRE, overflow: 'hidden' }}>
              {/* La griffe d'un défi : sa couleur dit le niveau de mise. */}
              <StakeGriffe stake={mise} />
              <View style={{ padding: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <StakePill stake={mise} />
                {estLeChoc ? (
                  <View style={{ backgroundColor: Colors.brand, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 }}>
                    <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 8.5, letterSpacing: 0.6, color: Colors.primary }}>LE CHOC</Text>
                  </View>
                ) : null}
                <Text numberOfLines={1} style={{ flex: 1, fontFamily: Fonts.uiBold, fontSize: 11, color: BLANC_60 }}>
                  {clashWhenLabel(clash)}
                </Text>
                <PhasePill phase={clash.phase} />
              </View>

              {/* Les tuiles ne sont plus tapables : le prono se rappelle en
                  toutes lettres, le liseré seul deviendrait une énigme. */}
              {clash.phase === 'en_cours' && mien ? (
                <View style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                  backgroundColor: JAUNE_DOUX, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10, marginBottom: 10,
                }}>
                  <Icon name="check" size={11} color={Colors.brand} stroke={2.6} />
                  <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: Colors.brand }}>
                    {`Ton prono : ${pairLabel(mien === 'A' ? clash.teamA : clash.teamB)}`}
                  </Text>
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Cote
                  players={clash.teamA}
                  choisi={!termine && mien === 'A'}
                  gagnant={gagnant === 'A'}
                  terne={!!gagnant && gagnant !== 'A'}
                  onPress={aVenir ? () => voter(clash, 'A') : undefined}
                />
                <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: BLANC_45 }}>VS</Text>
                <Cote
                  players={clash.teamB}
                  choisi={!termine && mien === 'B'}
                  gagnant={gagnant === 'B'}
                  terne={!!gagnant && gagnant !== 'B'}
                  onPress={aVenir ? () => voter(clash, 'B') : undefined}
                />
              </View>

              {termine ? (
                <ClashOutcome
                  winnerLabel={gagnant ? pairLabel(gagnant === 'A' ? clash.teamA : clash.teamB) : null}
                  scoreText={scoreLabel(clash.result?.scoreText)}
                  message={phrase}
                  tone={verdict === 'juste' ? 'juste' : verdict === 'rate' ? 'rate' : 'neutre'}
                  crowd={crowdShare(c, clash.winner)}
                />
              ) : null}

              {clash.phase === 'en_cours' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 }}>
                  <Icon name="lock" size={12} color={BLANC_45} stroke={2.2} />
                  <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: BLANC_45 }}>
                    Les votes sont clos
                  </Text>
                </View>
              ) : null}

              {montrerBarre ? (
                <CrowdBar
                  labelA={pairLabel(clash.teamA)}
                  labelB={pairLabel(clash.teamB)}
                  shareA={predictionShare(c, 'A')}
                  highlight={termine ? clash.winner : mien}
                />
              ) : null}

              <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: BLANC_45, marginTop: 10, textAlign: 'center' }}>
                {c.total > 0
                  ? `${c.total} pronostic${c.total > 1 ? 's' : ''}${aVenir && !mien ? " pour l'instant" : ''}`
                  : "Personne ne s'est prononcé"}
              </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {erreur ? (
        <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11.5, color: Colors.textSecondary, marginTop: 10, textAlign: 'center' }}>
          {erreur}
        </Text>
      ) : null}
    </View>
  );
}
