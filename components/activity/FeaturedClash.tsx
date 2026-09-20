// components/activity/FeaturedClash.tsx — « Le choc à venir ».
//
// La partie la plus serrée parmi celles à venir, et l'avis du reste du club
// (handoff « Hub Activite » §4c, capture 10). Un pronostic n'engage rien : ni
// place, ni ELO, ni notification. C'est une conversation, pas un pari.
//
// Écart assumé avec le handoff : il réservait ce bloc au week-end et au
// dimanche. Essayé sur téléphone, on ne voyait jamais rien — la mécanique la
// moins chère du lot était étouffée par sa fenêtre. Elle vaut pour toutes les
// parties à venir, tous les jours.
//
// Données : table `predictions` (supabase/migrations/predictions.sql). Tant
// qu'elle n'existe pas, la carte s'affiche mais le vote répond qu'il n'est
// pas encore ouvert.
import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import { PlayerAvatar } from '../PlayerAvatar';
import {
  predictionWindow,
  fetchClashCandidates, fetchPredictions, castPrediction, pickClash,
  countPredictions, predictionShare, agreementLabel, clashWhenLabel, clashReasonLabel,
  type Clash, type ClashPlayer, type PredictionCounts, type Team,
} from '../../lib/weekendClash';

const CARD = { backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, padding: 14, marginTop: 8 } as const;
const JAUNE_DOUX = 'rgba(255,193,26,0.14)';

/** Les deux visages d'une paire, superposés, puis leurs prénoms. */
function Cote({ players, choisi, onPress }: {
  players: ClashPlayer[];
  choisi: boolean;
  onPress: () => void;
}) {
  const prenoms = players.map(p => p.name.trim().split(/\s+/)[0]).join(' & ');
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={{
        flex: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center', gap: 8,
        backgroundColor: choisi ? JAUNE_DOUX : Colors.bgCard,
        borderWidth: choisi ? 1.5 : 1, borderColor: choisi ? Colors.brand : Colors.border,
      }}
    >
      <View style={{ flexDirection: 'row' }}>
        {players.map((p, i) => (
          <View key={p.id} style={{ marginLeft: i > 0 ? -7 : 0, borderRadius: 999, borderWidth: 2, borderColor: '#FFFFFF' }}>
            <PlayerAvatar
              name={p.name} path={p.avatarPath} size={30}
              backgroundColor={i === 0 ? Colors.primary : Colors.brand}
              textColor={i === 0 ? '#FFFFFF' : Colors.primary}
              fontFamily={Fonts.uiBlack} fontSize={11} initialsMax={2}
            />
          </View>
        ))}
      </View>
      <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12.5, color: Colors.textPrimary }}>
        {prenoms}
      </Text>
    </TouchableOpacity>
  );
}

export function FeaturedClash({ myId, city, onContent }: {
  myId: string; city?: string | null;
  /** Prévient l'écran quand le bloc a — ou n'a plus — quelque chose à dire. */
  onContent?: (has: boolean) => void;
}) {
  const router = useRouter();
  const [clash, setClash] = useState<Clash | null>(null);
  const [counts, setCounts] = useState<PredictionCounts>({ A: 0, B: 0, total: 0 });
  const [mine, setMine] = useState<Team | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);

  const load = useCallback(() => {
    let vivant = true;
    (async () => {
      const { start, end } = predictionWindow();
      const parties = await fetchClashCandidates(start, end);
      const choc = pickClash(parties);
      const avis = choc ? await fetchPredictions(choc.gameId) : [];
      if (!vivant) return;
      setClash(choc ? { ...choc, city: city ?? null } : null);
      setCounts(countPredictions(avis));
      setMine(avis.find(a => a.playerId === myId)?.team ?? null);
      setCharge(true);
      onContent?.(!!choc);
    })();
    return () => { vivant = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId, city]);

  useFocusEffect(useCallback(() => { const stop = load(); return stop; }, [load]));

  // Rien à raconter : le bloc ne s'affiche pas du tout. Un état calme posé
  // en tête d'écran repoussait vers le bas ce qui sert vraiment (les dispos).
  if (!charge || !clash) return null;

  const voter = async (team: Team) => {
    if (!clash) return;
    const avant = mine;
    setMine(team); setErreur(null);
    // Compte optimiste : on retire l'ancien avis avant d'ajouter le nouveau.
    setCounts(c => {
      const next = { ...c };
      if (avant) next[avant] = Math.max(0, next[avant] - 1); else next.total += 1;
      next[team] += 1;
      return next;
    });
    const souci = await castPrediction(clash.gameId, myId, team);
    if (souci) { setMine(avant); setErreur(souci); load(); }
  };

  const joueJeMeme = clash.players.some(p => p.id === myId);

  return (
    <View style={CARD}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icon name="swords" size={15} color={Colors.textPrimary} stroke={2} />
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: Fonts.welcome, fontSize: 16, lineHeight: 21, color: Colors.textPrimary, paddingRight: 6 }}>
          Le choc à venir
        </Text>
        {counts.total > 0 ? (
          <View style={{ backgroundColor: Colors.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10, color: Colors.textSecondary }}>
              {`${counts.total} PRONO${counts.total > 1 ? 'S' : ''}`}
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11.5, lineHeight: 16, color: Colors.textSecondary, marginTop: 6 }}>
            {`${clashWhenLabel(clash)} · ${clashReasonLabel(clash).charAt(0).toLowerCase()}${clashReasonLabel(clash).slice(1)}`}
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <Cote players={clash.teamA} choisi={mine === 'A'} onPress={() => !joueJeMeme && voter('A')} />
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: Colors.textMuted }}>VS</Text>
            <Cote players={clash.teamB} choisi={mine === 'B'} onPress={() => !joueJeMeme && voter('B')} />
          </View>

          {mine ? (
            <View style={{ marginTop: 12 }}>
              <View style={{ flexDirection: 'row', height: 6, borderRadius: 999, overflow: 'hidden', backgroundColor: Colors.border }}>
                <View style={{ flex: Math.max(predictionShare(counts, 'A'), 0.001), backgroundColor: Colors.brand }} />
                <View style={{ flex: Math.max(predictionShare(counts, 'B'), 0.001), backgroundColor: Colors.border }} />
              </View>
              <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11.5, color: Colors.textMuted, marginTop: 7, textAlign: 'center' }}>
                {`Ton prono : ${(mine === 'A' ? clash.teamA : clash.teamB).map(p => p.name.trim().split(/\s+/)[0]).join(' & ')}`}
                {agreementLabel(counts, mine) ? ` · ${agreementLabel(counts, mine)}` : ''}
              </Text>
            </View>
          ) : (
            <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11.5, color: Colors.textMuted, marginTop: 10, textAlign: 'center' }}>
              {joueJeMeme ? 'Tu joues ce match — à toi de leur donner tort.' : 'Tape une paire : qui gagne ?'}
            </Text>
          )}

          {erreur ? (
            <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11.5, color: Colors.textSecondary, marginTop: 8, textAlign: 'center' }}>
              {erreur}
            </Text>
          ) : null}
    </View>
  );
}
