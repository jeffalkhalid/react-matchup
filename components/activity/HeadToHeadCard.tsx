// components/activity/HeadToHeadCard.tsx — « Face-à-face ».
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
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Colors, Fonts } from '../../lib/theme';
import { PlayerAvatar } from '../PlayerAvatar';
import { AmbassadorRing } from '../ambassador/primitives';
import {
  fetchDuels, fetchRivalPlayer, pickRival, closestOpponent, rivals as listeRivaux,
  duelSentence, duelSinceLabel, rematchLabel,
  RIVAL_MIN_DUELS, type HeadToHead, type RivalPlayer,
} from '../../lib/headToHead';

const SOMBRE = '#0A0A0A';
const TUILE = '#1A1A1C';
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
  /** Les autres rivaux, en ligne sous le face-à-face mis en avant. */
  const [autres, setAutres] = useState<{ duel: HeadToHead; joueur: RivalPlayer }[]>([]);
  /** Celui qu'on regarde : par défaut le premier, changé au tap. */
  const [choisi, setChoisi] = useState<string | null>(null);
  /** Vrai quand on n'a pas atteint les trois duels : on propose, on n'affiche pas. */
  const [sousLeSeuil, setSousLeSeuil] = useState(false);

  const load = useCallback(() => {
    let vivant = true;
    (async () => {
      const matchs = await fetchDuels(myId);
      const vrai = pickRival(matchs, myId);
      const approchant = vrai ?? closestOpponent(matchs, myId);
      const fiche = approchant ? await fetchRivalPlayer(approchant.opponentId) : null;
      // Les autres rivaux : un club, ce n'est pas un seul adversaire.
      const tous = vrai ? listeRivaux(matchs, myId, 5) : [];
      const fiches = await Promise.all(tous.map(h => fetchRivalPlayer(h.opponentId)));
      if (!vivant) return;
      setDuel(approchant); setRival(fiche); setSousLeSeuil(!vrai);
      setAutres(tous.map((d, i) => ({ duel: d, joueur: fiches[i]! })).filter(x => !!x.joueur));
      setChoisi(null);
    })();
    return () => { vivant = false; };
  }, [myId]);

  useFocusEffect(useCallback(() => { const stop = load(); return stop; }, [load]));

  // Rien encore chargé, ou personne d'assez récurrent : le bloc n'a rien à
  // raconter, il ne s'affiche pas du tout (et ne clignote pas au rechargement,
  // puisqu'il garde le duel précédent le temps de la requête).
  if (!duel) return null;

  // Le face-à-face affiché : celui qu'on a tapé, sinon le premier.
  const vu = (choisi ? autres.find(a => a.duel.opponentId === choisi) : null) ?? null;
  const duelVu = vu?.duel ?? duel;
  const rivalVu = vu?.joueur ?? rival;
  const prenom = rivalVu?.name?.trim().split(/\s+/)[0] ?? 'ton adversaire';

  const defier = () => {
    if (!rivalVu) { router.push('/(tabs)/lobby' as any); return; }
    const side = rivalVu.courtSide ? `&pside=${encodeURIComponent(rivalVu.courtSide)}` : '';
    const elo = rivalVu.eloScore != null ? `&pelo=${rivalVu.eloScore}` : '';
    router.push(`/(tabs)/lobby?create=1&challenge=1&with=${rivalVu.id}&pname=${encodeURIComponent(rivalVu.name)}${elo}${side}` as any);
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
    <View style={{ marginTop: 18 }}>
      {/* Titre de section, hors de la carte — comme « Les bilans de ton
          cercle » et « Qui va gagner ? ». Le kicker jaune à l'intérieur
          enfermait le titre dans le pavé noir. */}
      <Text numberOfLines={1} style={{ fontFamily: Fonts.welcome, fontSize: 16, lineHeight: 21, color: Colors.textPrimary, paddingRight: 6, marginBottom: 8 }}>
        Face-à-face
      </Text>

      <View style={{ backgroundColor: SOMBRE, borderRadius: 18, padding: 16 }}>
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
                ? <AmbassadorRing size={54} radius={27} showStar={false} surface={SOMBRE} align="center">{photo(myName, myAvatarPath, false)}</AmbassadorRing>
                : photo(myName, myAvatarPath, false)}
              <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11.5, color: '#FFFFFF', marginTop: 7 }}>Toi</Text>
            </View>

            <View style={{ flex: 1, alignItems: 'center', paddingTop: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Text style={{ fontFamily: Fonts.display, fontSize: 40, color: '#FFFFFF' }}>{duelVu.wins}</Text>
                <Text style={{ fontFamily: Fonts.display, fontSize: 28, color: BLANC_45 }}>–</Text>
                <Text style={{ fontFamily: Fonts.display, fontSize: 40, color: Colors.brand }}>{duelVu.losses}</Text>
              </View>
              <Text numberOfLines={1} style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: BLANC_45, marginTop: 2 }}>
                {duelSinceLabel(duelVu)}
              </Text>
            </View>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => rivalVu && router.push(`/player/${rivalVu.id}` as any)}
              style={{ alignItems: 'center', width: 72 }}
            >
              {rivalVu?.memberNumber != null
                ? <AmbassadorRing size={54} radius={27} showStar={false} surface={SOMBRE} align="center">{photo(rivalVu.name, rivalVu.avatarPath, true)}</AmbassadorRing>
                : photo(rivalVu?.name ?? prenom, rivalVu?.avatarPath, true)}
              <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11.5, color: '#FFFFFF', marginTop: 7 }}>{prenom}</Text>
            </TouchableOpacity>
          </View>

          {/* Historique : vert/rouge, seul endroit où la charte l'autorise. */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 14 }}>
            {duelVu.history.map((gagne, i) => (
              <View key={i} style={{
                width: 26, height: 8, borderRadius: 999,
                backgroundColor: gagne ? Colors.success : Colors.danger,
              }} />
            ))}
          </View>

          <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 12, lineHeight: 17, color: BLANC_60, marginTop: 12, textAlign: 'center' }}>
            {duelSentence(duelVu, prenom)}
          </Text>

          <TouchableOpacity onPress={defier} activeOpacity={0.85}
            style={{ backgroundColor: Colors.brand, borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginTop: 14 }}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
              style={{ fontFamily: Fonts.uiBlack, fontSize: 13.5, color: Colors.primary }}>
              {rematchLabel(duelVu, prenom)}
            </Text>
          </TouchableOpacity>

          {/* Les autres rivaux : un club, ce n'est pas un seul adversaire.
              Un tap change le face-à-face montré au-dessus. */}
          {autres.length > 1 ? (
            <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 12 }}>
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 9.5, letterSpacing: 1.2, color: BLANC_45, marginBottom: 10 }}>
                TES AUTRES FACE-À-FACE
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                style={{ marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
                {autres.map(({ duel: d, joueur }) => {
                  const actif = d.opponentId === (duelVu?.opponentId ?? '');
                  const p = joueur.name.trim().split(/\s+/)[0];
                  return (
                    <TouchableOpacity key={d.opponentId} activeOpacity={0.85}
                      onPress={() => setChoisi(d.opponentId)}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999,
                        paddingVertical: 7, paddingHorizontal: 10,
                        backgroundColor: actif ? 'rgba(255,193,26,0.16)' : TUILE,
                        borderWidth: 1, borderColor: actif ? Colors.brand : 'rgba(255,255,255,0.08)',
                      }}>
                      <PlayerAvatar
                        name={joueur.name} path={joueur.avatarPath} size={24}
                        backgroundColor={Colors.brand} textColor={Colors.primary}
                        fontFamily={Fonts.uiBlack} fontSize={9} initialsMax={2}
                      />
                      <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11.5, color: actif ? Colors.brand : '#FFFFFF' }}>{p}</Text>
                      <Text style={{ fontFamily: Fonts.uiBold, fontSize: 11, color: BLANC_45 }}>{`${d.wins}–${d.losses}`}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
        </>
      )}
      </View>
    </View>
  );
}
