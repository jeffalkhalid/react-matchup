// components/activity/FeaturedPantheon.tsx — « À LA UNE » du dimanche.
//
// Les badges les plus donnés de la semaine dans ta ville (handoff « Hub
// Activite » §4c, capture 10). Le dimanche on referme la semaine : ce que les
// joueurs ont reconnu chez les autres, agrégé depuis les votes de fin de match.
//
// Données : vue `city_weekly_badges`. Tant que la migration n'est pas
// appliquée, la liste est vide et le bloc montre son état calme.
//
// Le « Choc du week-end » (pronostics) n'est pas ici : il demande une table
// `predictions` qui viendra plus tard.
import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import { PlayerAvatar } from '../PlayerAvatar';
import { BadgePill } from '../profile/BadgePill';
import { AmbassadorChip } from '../ambassador/primitives';
import { getBadge } from '../../lib/badges';
import {
  fetchCityPantheon, fetchMyPantheonPlace, isoWeekNumber, type PantheonRow,
} from '../../lib/hubFeatured';

const CARD = { backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, padding: 14, marginTop: 8 } as const;
const SEPARATEUR = '#EDEBE9';

export function FeaturedPantheon({ city, myId, onContent }: {
  /** Ville mise en avant — celle du club favori du joueur. */
  city: string;
  myId: string;
  /** Prévient l'écran quand le bloc a — ou n'a plus — quelque chose à dire. */
  onContent?: (has: boolean) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PantheonRow[]>([]);
  const [maPlace, setMaPlace] = useState<{ badgeKey: string; place: number; votes: number } | null>(null);

  const load = useCallback(() => {
    let vivant = true;
    setLoading(true);
    (async () => {
      const semaine = new Date();
      const [top, mienne] = await Promise.all([
        fetchCityPantheon(city, semaine),
        fetchMyPantheonPlace(city, semaine, myId),
      ]);
      if (!vivant) return;
      setRows(top); setMaPlace(mienne); setLoading(false);
      onContent?.(top.length > 0);
    })();
    return () => { vivant = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, myId]);

  useFocusEffect(useCallback(() => { const stop = load(); return stop; }, [load]));

  // Aucun vote cette semaine : le bloc ne s'affiche pas. Un encart « les votes
  // arrivent » en tête d'écran repoussait vers le bas ce qui sert vraiment.
  if (loading || rows.length === 0) return null;

  const semaineNum = isoWeekNumber(new Date());

  return (
    <View style={CARD}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icon name="trophy" size={15} color={Colors.brandDeep} stroke={2} />
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: Fonts.welcome, fontSize: 16, lineHeight: 21, color: Colors.textPrimary, paddingRight: 6 }}>
          {city ? `Panthéon de ${city}` : 'Panthéon de la semaine'}
        </Text>
        <View style={{ backgroundColor: Colors.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10, color: Colors.textSecondary }}>{`SEMAINE ${semaineNum}`}</Text>
        </View>
      </View>

          <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11.5, lineHeight: 16, color: Colors.textSecondary, marginTop: 6 }}>
            Agrégé depuis les votes de fin de match de la semaine.
          </Text>

          <View style={{ marginTop: 6 }}>
            {rows.map(r => (
              <TouchableOpacity
                key={`${r.badgeKey}-${r.playerId}`}
                activeOpacity={0.85}
                onPress={() => router.push(`/player/${r.playerId}` as any)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, borderTopWidth: 1, borderTopColor: SEPARATEUR }}
              >
                <BadgePill badge={r.badgeKey} size={34} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12.5, color: Colors.textPrimary }}>
                    {getBadge(r.badgeKey).label}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <PlayerAvatar
                      name={r.name} path={r.avatarPath} size={20}
                      backgroundColor={Colors.brand} textColor={Colors.primary}
                      fontFamily={Fonts.uiBlack} fontSize={8} initialsMax={2}
                    />
                    <Text numberOfLines={1} style={{ fontFamily: Fonts.uiSemi, fontSize: 12, color: Colors.textSecondary, flexShrink: 1 }}>
                      {r.playerId === myId ? 'Toi' : r.name}
                    </Text>
                    {r.memberNumber != null ? <AmbassadorChip number={r.memberNumber} /> : null}
                  </View>
                </View>
                <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: Colors.textMuted }}>
                  {`${r.votes} vote${r.votes > 1 ? 's' : ''}`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11.5, lineHeight: 17, color: Colors.textMuted, marginTop: 10 }}>
            {maPlace
              ? `Tu es ${maPlace.place}ᵉ sur « ${getBadge(maPlace.badgeKey).label} » avec ${maPlace.votes} vote${maPlace.votes > 1 ? 's' : ''}. `
              : 'Tu n\'as pas encore de badge cette semaine. '}
            <Text
              onPress={() => router.push(`/player/${myId}` as any)}
              style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11.5, color: Colors.textPrimary, textDecorationLine: 'underline' }}
            >
              Ta réputation →
            </Text>
          </Text>
    </View>
  );
}
