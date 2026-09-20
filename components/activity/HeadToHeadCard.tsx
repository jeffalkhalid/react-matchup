// components/activity/HeadToHeadCard.tsx — « Face-à-face de la saison ».
//
// Le rival, pas une statistique (handoff « Hub Activite », bloc face-à-face,
// capture 03 vignette 3b). Trois duels minimum : en dessous, deux matchs
// contre la même personne ne racontent rien.
//
// Tout vient de `matches`, qui existe déjà — aucune migration.
//
// Écart assumé avec la maquette : elle montre le bouton qui bascule en « Défi
// envoyé à Omar ». Un défi 2v2 demande un binôme et un créneau, ça ne se fait
// pas en un tap : le bouton ouvre la création de défi, comme « Défier » depuis
// un profil.
import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Colors, Fonts } from '../../lib/theme';
import { PlayerAvatar } from '../PlayerAvatar';
import { AmbassadorRing } from '../ambassador/primitives';
import {
  fetchDuels, fetchRivalPlayer, pickRival, closestOpponent, duelSentence, duelSinceLabel,
  RIVAL_MIN_DUELS, type HeadToHead, type RivalPlayer,
} from '../../lib/headToHead';

const SOMBRE = '#0A0A0A';
const BLANC_60 = 'rgba(255,255,255,0.6)';
const BLANC_45 = 'rgba(255,255,255,0.45)';

export function HeadToHeadCard({ myId, myName, myAvatarPath, myIsAmbassador }: {
  myId: string;
  myName: string;
  myAvatarPath?: string | null;
  myIsAmbassador?: boolean;
}) {
  const router = useRouter();
  const [duel, setDuel] = useState<HeadToHead | null>(null);
  const [rival, setRival] = useState<RivalPlayer | null>(null);
  /** Vrai quand on n'a pas atteint les trois duels : on propose, on n'affiche pas. */
  const [sousLeSeuil, setSousLeSeuil] = useState(false);

  const load = useCallback(() => {
    let vivant = true;
    (async () => {
      const matchs = await fetchDuels(myId);
      const vrai = pickRival(matchs, myId);
      const approchant = vrai ?? closestOpponent(matchs, myId);
      const fiche = approchant ? await fetchRivalPlayer(approchant.opponentId) : null;
      if (!vivant) return;
      setDuel(approchant); setRival(fiche); setSousLeSeuil(!vrai);
    })();
    return () => { vivant = false; };
  }, [myId]);

  useFocusEffect(useCallback(() => { const stop = load(); return stop; }, [load]));

  // Rien encore chargé, ou personne d'assez récurrent : le bloc n'a rien à
  // raconter, il ne s'affiche pas du tout (et ne clignote pas au rechargement,
  // puisqu'il garde le duel précédent le temps de la requête).
  if (!duel) return null;

  const prenom = rival?.name?.trim().split(/\s+/)[0] ?? 'ton adversaire';

  const defier = () => {
    if (!rival) { router.push('/(tabs)/lobby' as any); return; }
    const side = rival.courtSide ? `&pside=${encodeURIComponent(rival.courtSide)}` : '';
    const elo = rival.eloScore != null ? `&pelo=${rival.eloScore}` : '';
    router.push(`/(tabs)/lobby?create=1&challenge=1&with=${rival.id}&pname=${encodeURIComponent(rival.name)}${elo}${side}` as any);
  };

  const photo = (nom: string, chemin: string | null | undefined, fondJaune: boolean) => (
    <PlayerAvatar
      name={nom} path={chemin} size={54}
      backgroundColor={fondJaune ? Colors.brand : '#1A1A1C'}
      textColor={fondJaune ? Colors.primary : '#FFFFFF'}
      fontFamily={Fonts.uiBlack} fontSize={19} initialsMax={2}
    />
  );

  return (
    <View style={{ backgroundColor: SOMBRE, borderRadius: 18, padding: 16, marginTop: 14 }}>
      <Text numberOfLines={1} style={{ fontFamily: Fonts.uiBlack, fontSize: 10, letterSpacing: 0.8, color: Colors.brand }}>
        FACE-À-FACE DE LA SAISON
      </Text>

      {sousLeSeuil ? (
        <>
          <Text numberOfLines={2} style={{ fontFamily: Fonts.welcome, fontSize: 22, lineHeight: 28, color: '#FFFFFF', marginTop: 12, paddingRight: 6 }}>
            Pas encore de rival
          </Text>
          <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 12, lineHeight: 17, color: BLANC_60, marginTop: 6 }}>
            {`${RIVAL_MIN_DUELS} matchs contre le même adversaire et le face-à-face s'ouvre. Tu en es à ${duel.total} avec ${prenom}.`}
          </Text>
          <TouchableOpacity onPress={defier} activeOpacity={0.85}
            style={{ backgroundColor: Colors.brand, borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginTop: 14 }}>
            <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 13.5, color: Colors.primary }}>{`Défier ${prenom}`}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginTop: 14 }}>
            <View style={{ alignItems: 'center', width: 72 }}>
              {myIsAmbassador
                ? <AmbassadorRing size={54} radius={27} showStar={false} surface={SOMBRE}>{photo(myName, myAvatarPath, false)}</AmbassadorRing>
                : photo(myName, myAvatarPath, false)}
              <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11.5, color: '#FFFFFF', marginTop: 7 }}>Toi</Text>
            </View>

            <View style={{ flex: 1, alignItems: 'center', paddingTop: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Text style={{ fontFamily: Fonts.display, fontSize: 40, color: '#FFFFFF' }}>{duel.wins}</Text>
                <Text style={{ fontFamily: Fonts.display, fontSize: 28, color: BLANC_45 }}>–</Text>
                <Text style={{ fontFamily: Fonts.display, fontSize: 40, color: Colors.brand }}>{duel.losses}</Text>
              </View>
              <Text numberOfLines={1} style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: BLANC_45, marginTop: 2 }}>
                {duelSinceLabel(duel)}
              </Text>
            </View>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => rival && router.push(`/player/${rival.id}` as any)}
              style={{ alignItems: 'center', width: 72 }}
            >
              {rival?.memberNumber != null
                ? <AmbassadorRing size={54} radius={27} showStar={false} surface={SOMBRE}>{photo(rival.name, rival.avatarPath, true)}</AmbassadorRing>
                : photo(rival?.name ?? prenom, rival?.avatarPath, true)}
              <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11.5, color: '#FFFFFF', marginTop: 7 }}>{prenom}</Text>
            </TouchableOpacity>
          </View>

          {/* Historique : vert/rouge, seul endroit où la charte l'autorise. */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 14 }}>
            {duel.history.map((gagne, i) => (
              <View key={i} style={{
                width: 26, height: 8, borderRadius: 999,
                backgroundColor: gagne ? Colors.success : Colors.danger,
              }} />
            ))}
          </View>

          <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 12, lineHeight: 17, color: BLANC_60, marginTop: 12, textAlign: 'center' }}>
            {duelSentence(duel, prenom)}
          </Text>

          <TouchableOpacity onPress={defier} activeOpacity={0.85}
            style={{ backgroundColor: Colors.brand, borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginTop: 14 }}>
            <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 13.5, color: Colors.primary }}>Demander la revanche</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}
