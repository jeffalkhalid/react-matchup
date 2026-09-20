// components/activity/FeaturedClash.tsx — « Qui va gagner ? »
//
// Les parties à venir qu'on peut pronostiquer, et l'avis du reste du club. Un
// pronostic n'engage rien : ni place, ni ELO, ni notification. C'est une
// conversation, pas un pari.
//
// Deux écarts assumés avec le handoff (§4c), tous deux vus sur téléphone :
//  • il réservait le bloc au week-end et au dimanche — on ne voyait jamais
//    rien. Il vaut pour toutes les parties à venir, tous les jours.
//  • il n'en montrait qu'UNE, « le choc ». Douze autres parties restaient
//    sans personne pour en parler. Elles défilent maintenant toutes, la plus
//    proche d'abord, et la plus serrée porte la pastille « LE CHOC ».
//
// Fond sombre : entre les cartes blanches du dessus et du dessous, le bloc se
// noyait.
//
// Données : table `predictions` (supabase/migrations/predictions.sql). Tant
// qu'elle n'existe pas, les cartes s'affichent mais le vote répond qu'il
// n'est pas encore ouvert.
import { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, useWindowDimensions } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Colors, Fonts, formatPadelLevel } from '../../lib/theme';
import { Icon } from '../community/icons';
import { PlayerAvatar } from '../PlayerAvatar';
import {
  predictionWindow, fetchClashCandidates, fetchPredictionsForGames, castPrediction,
  clashesToPredict, tightestClashId, countPredictions, predictionShare, agreementLabel,
  clashWhenLabel, type Clash, type ClashPlayer, type PredictionCounts, type Team,
} from '../../lib/weekendClash';

const SOMBRE = '#0A0A0A';
const TUILE = '#1A1A1C';
const BLANC_60 = 'rgba(255,255,255,0.6)';
const BLANC_45 = 'rgba(255,255,255,0.45)';
const JAUNE_DOUX = 'rgba(255,193,26,0.16)';

/** Une paire, présentée comme sur la carte de match : photo, prénom, niveau. */
function Cote({ players, choisi, onPress }: {
  players: ClashPlayer[];
  choisi: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={{
        flex: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 6,
        flexDirection: 'row', justifyContent: 'center', gap: 4,
        backgroundColor: choisi ? JAUNE_DOUX : TUILE,
        borderWidth: choisi ? 1.5 : 1,
        borderColor: choisi ? Colors.brand : 'rgba(255,255,255,0.08)',
      }}
    >
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
    </TouchableOpacity>
  );
}

export function FeaturedClash({ myId, onContent }: {
  myId: string;
  /** Prévient l'écran quand le bloc a — ou n'a plus — quelque chose à dire. */
  onContent?: (has: boolean) => void;
}) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [clashes, setClashes] = useState<Clash[]>([]);
  const [choc, setChoc] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, PredictionCounts>>({});
  const [mine, setMine] = useState<Record<string, Team>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);

  const load = useCallback(() => {
    let vivant = true;
    (async () => {
      const { start, end } = predictionWindow();
      const parties = await fetchClashCandidates(start, end);
      const liste = clashesToPredict(parties);
      const avis = await fetchPredictionsForGames(liste.map(c => c.gameId));
      if (!vivant) return;
      const c: Record<string, PredictionCounts> = {};
      const m: Record<string, Team> = {};
      for (const clash of liste) {
        const rows = avis.get(clash.gameId) ?? [];
        c[clash.gameId] = countPredictions(rows);
        const mien = rows.find(r => r.playerId === myId)?.team;
        if (mien) m[clash.gameId] = mien;
      }
      setClashes(liste); setChoc(tightestClashId(liste));
      setCounts(c); setMine(m); setCharge(true);
      onContent?.(liste.length > 0);
    })();
    return () => { vivant = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId]);

  useFocusEffect(useCallback(() => { const stop = load(); return stop; }, [load]));

  if (!charge || clashes.length === 0) return null;

  const voter = async (clash: Clash, team: Team) => {
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
  const votes = clashes.filter(c => mine[c.gameId]).length;

  return (
    <View style={{ backgroundColor: SOMBRE, borderRadius: 18, paddingVertical: 16, marginTop: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 16 }}>
        <Icon name="swords" size={15} color={Colors.brand} stroke={2} />
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: Fonts.welcome, fontSize: 16, lineHeight: 21, color: '#FFFFFF', paddingRight: 6 }}>
          Qui va gagner ?
        </Text>
        <View style={{ backgroundColor: TUILE, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10, color: BLANC_60 }}>
            {`${votes}/${clashes.length} PRONOSTIQUÉ${votes > 1 ? 'S' : ''}`}
          </Text>
        </View>
      </View>

      <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11.5, lineHeight: 16, color: BLANC_60, marginTop: 6, paddingHorizontal: 16 }}>
        Tape la paire que tu vois gagner. Ça n'engage rien.
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={LARGEUR + 10}
        decelerationRate="fast"
        style={{ marginTop: 12 }}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
      >
        {clashes.map(clash => {
          const c = counts[clash.gameId] ?? { A: 0, B: 0, total: 0 };
          const mien = mine[clash.gameId] ?? null;
          const jeJoue = clash.players.some(p => p.id === myId);
          const estLeChoc = clash.gameId === choc;
          return (
            <View key={clash.gameId} style={{ width: LARGEUR, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.04)', padding: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                {estLeChoc ? (
                  <View style={{ backgroundColor: Colors.brand, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 }}>
                    <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 8.5, letterSpacing: 0.6, color: Colors.primary }}>LE CHOC</Text>
                  </View>
                ) : null}
                <Text numberOfLines={1} style={{ flex: 1, fontFamily: Fonts.uiBold, fontSize: 11, color: BLANC_60 }}>
                  {clashWhenLabel(clash)}
                </Text>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Cote players={clash.teamA} choisi={mien === 'A'} onPress={() => !jeJoue && voter(clash, 'A')} />
                <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: BLANC_45 }}>VS</Text>
                <Cote players={clash.teamB} choisi={mien === 'B'} onPress={() => !jeJoue && voter(clash, 'B')} />
              </View>

              {mien ? (
                <View style={{ marginTop: 10 }}>
                  <View style={{ flexDirection: 'row', height: 6, borderRadius: 999, overflow: 'hidden', backgroundColor: TUILE }}>
                    <View style={{ flex: Math.max(predictionShare(c, 'A'), 0.001), backgroundColor: Colors.brand }} />
                    <View style={{ flex: Math.max(predictionShare(c, 'B'), 0.001), backgroundColor: TUILE }} />
                  </View>
                  <Text numberOfLines={1} style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: BLANC_45, marginTop: 6, textAlign: 'center' }}>
                    {agreementLabel(c, mien) ?? 'Ton prono est enregistré'}
                  </Text>
                </View>
              ) : (
                <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: BLANC_45, marginTop: 10, textAlign: 'center' }}>
                  {jeJoue ? 'Tu joues ce match — à toi de leur donner tort.' : `${c.total} avis pour l'instant`}
                </Text>
              )}
            </View>
          );
        })}
      </ScrollView>

      {erreur ? (
        <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11.5, color: BLANC_60, marginTop: 10, paddingHorizontal: 16, textAlign: 'center' }}>
          {erreur}
        </Text>
      ) : null}

      <TouchableOpacity onPress={() => router.push('/(tabs)/lobby' as any)} hitSlop={8}
        style={{ alignSelf: 'center', marginTop: 12 }}>
        <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11.5, color: Colors.brand, textDecorationLine: 'underline' }}>
          Voir toutes les parties →
        </Text>
      </TouchableOpacity>
    </View>
  );
}
