// components/activity/FeaturedMercato.tsx — « À LA UNE » du jeudi au samedi.
//
// Qui s'est déclaré libre pour le week-end (handoff « Hub Activite » §4b,
// capture 09). En fin de semaine la question n'est plus « qui a joué » mais
// « avec qui je joue samedi » : on montre les joueurs disponibles, et un
// bouton qui ouvre directement la création d'une partie avec eux.
//
// Rien de nouveau en base : ce sont les mêmes dispos que les pastilles du
// header. Tant que `availability` n'existe pas, la liste est vide et le bloc
// montre son état calme.
import { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Colors, Fonts, formatPadelLevel } from '../../lib/theme';
import { Icon } from '../community/icons';
import { PlayerAvatar } from '../PlayerAvatar';
import { AMB } from '../../lib/ambassador';
import { AmbassadorRing } from '../ambassador/primitives';
import {
  weekendWindow, fetchAvailabilityWindow, fetchWeekendPartners, pickMercato,
  mercatoSlotLabel, mercatoBandLabel, type MercatoRow,
} from '../../lib/hubFeatured';

const CARD = { backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, padding: 14, marginTop: 8 } as const;
const CARTE_LARGEUR = 154;

export function FeaturedMercato({ myId, myElo, myClubs, friendIds, iAmInWeekend, onDeclare }: {
  myId: string;
  myElo?: number | null;
  myClubs?: string[];
  friendIds: string[];
  /** Ai-je déjà déclaré une dispo sur ce week-end ? (pied de bloc) */
  iAmInWeekend: boolean;
  /** Même geste que les pastilles du header, pour l'état calme. */
  onDeclare: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<MercatoRow[]>([]);

  const load = useCallback(() => {
    let vivant = true;
    setLoading(true);
    (async () => {
      const { start, end } = weekendWindow();
      const [dispos, dejaAvecMoi] = await Promise.all([
        fetchAvailabilityWindow(start, end),
        fetchWeekendPartners(myId, start, end),
      ]);
      if (!vivant) return;
      setRows(pickMercato(dispos, { myId, myElo, friendIds, myClubs, excludeIds: dejaAvecMoi }));
      setLoading(false);
    })();
    return () => { vivant = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId, myElo, friendIds.join(','), (myClubs ?? []).join(',')]);

  useFocusEffect(useCallback(() => { const stop = load(); return stop; }, [load]));

  // Même lien que « Défier » depuis un profil : la création s'ouvre avec le
  // joueur déjà invité (cf. app/player/[id].tsx).
  const proposer = (r: MercatoRow) => {
    const elo = r.elo != null ? `&pelo=${r.elo}` : '';
    router.push(`/(tabs)/lobby?create=1&with=${r.playerId}&pname=${encodeURIComponent(r.name)}${elo}` as any);
  };

  const bande = mercatoBandLabel(myElo);
  const clubsPhrase = (myClubs ?? []).length > 0 ? ', dans tes clubs' : '';

  return (
    <View style={CARD}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icon name="users" size={15} color={Colors.textPrimary} stroke={2} />
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: Fonts.welcome, fontSize: 16, lineHeight: 21, color: Colors.textPrimary, paddingRight: 6 }}>
          Mercato du week-end
        </Text>
        {rows.length > 0 ? (
          <View style={{ backgroundColor: Colors.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10, color: Colors.textSecondary }}>
              {`${rows.length} DISPO${rows.length > 1 ? 'S' : ''}`}
            </Text>
          </View>
        ) : null}
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginVertical: 18 }} />
      ) : rows.length === 0 ? (
        <>
          <Text style={{ fontFamily: Fonts.uiBold, fontSize: 13.5, color: Colors.textPrimary, marginTop: 10 }}>
            Personne n'a encore déclaré le week-end
          </Text>
          <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 12, lineHeight: 17, color: Colors.textSecondary, marginTop: 4 }}>
            Déclare-toi le premier : tes amis le voient tout de suite, et c'est souvent ce qui lance le week-end.
          </Text>
          <TouchableOpacity onPress={onDeclare} activeOpacity={0.85}
            style={{ backgroundColor: '#0A0A0A', borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginTop: 12 }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13.5, color: '#FFFFFF' }}>Prévenir mon cercle</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11.5, lineHeight: 16, color: Colors.textSecondary, marginTop: 6 }}>
            {`Ils se sont déclarés libres samedi ou dimanche${bande ? `, à ton niveau (${bande})` : ''}${clubsPhrase}.`}
          </Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -14, marginTop: 12 }}
            contentContainerStyle={{ paddingHorizontal: 14, gap: 10 }}
          >
            {rows.map(r => {
              const photo = (
                <PlayerAvatar
                  name={r.name} path={r.avatarPath} size={62}
                  backgroundColor={Colors.brand} textColor={Colors.primary}
                  fontFamily={Fonts.uiBlack} fontSize={22} initialsMax={2}
                />
              );
              return (
                <View key={r.playerId} style={{
                  width: CARTE_LARGEUR, borderRadius: 16, borderWidth: 1, borderColor: Colors.border,
                  padding: 12, alignItems: 'center', gap: 6, backgroundColor: Colors.bgCard,
                }}>
                  <TouchableOpacity activeOpacity={0.85} onPress={() => router.push(`/player/${r.playerId}` as any)}>
                    {r.memberNumber != null
                      ? <AmbassadorRing size={62} radius={31} showStar={false} surface={Colors.bgCard}>{photo}</AmbassadorRing>
                      : photo}
                  </TouchableOpacity>
                  <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: Colors.textPrimary }}>
                    {r.name.split(' ')[0]}
                  </Text>
                  {r.elo != null ? (
                    <View style={{ borderWidth: 1.5, borderColor: Colors.brand, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 }}>
                      <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 10.5, color: AMB.chipText }}>Niv. {formatPadelLevel(r.elo)}</Text>
                    </View>
                  ) : null}
                  <Text numberOfLines={1} style={{ fontFamily: Fonts.uiSemi, fontSize: 10.5, color: Colors.textMuted }}>
                    {mercatoSlotLabel(r.slotStart, r.slotEnd)}
                  </Text>
                  <TouchableOpacity onPress={() => proposer(r)} activeOpacity={0.85}
                    style={{ alignSelf: 'stretch', backgroundColor: '#0A0A0A', borderRadius: 999, paddingVertical: 10, alignItems: 'center', marginTop: 2 }}>
                    <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: '#FFFFFF' }}>Proposer</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>

          {!iAmInWeekend ? (
            <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, lineHeight: 16, color: Colors.textMuted, marginTop: 12 }}>
              {friendIds.length > 0
                ? `Tu n'apparais pas encore : déclare ta dispo en haut et tu entres dans le mercato de tes ${friendIds.length} ami${friendIds.length > 1 ? 's' : ''}.`
                : "Tu n'apparais pas encore : déclare ta dispo en haut pour entrer dans le mercato."}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}
