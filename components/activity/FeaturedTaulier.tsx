// components/activity/FeaturedTaulier.tsx — « À LA UNE » du lundi au mercredi.
//
// Qui a le plus joué dans ton club ce mois-ci (handoff « Hub Activite » §4a,
// capture 08). Le club fait la communauté : en début de semaine, on regarde
// qui la fait vivre. Le podium 2ᵉ/3ᵉ/4ᵉ donne à chacun une cible atteignable.
//
// Les données viennent de la vue `club_monthly_leaders`. Tant que la migration
// n'est pas appliquée, la liste revient vide et le bloc montre son état calme.
import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { Colors, Fonts } from '../../lib/theme';
import { PlayerAvatar } from '../PlayerAvatar';
import { AmbassadorRing, CROWN_PATH } from '../ambassador/primitives';
import { fetchClubLeaders, monthLabel, type ClubLeader } from '../../lib/hubFeatured';

const SOMBRE = '#0A0A0A';
const TUILE = '#1A1A1C';
const BLANC_60 = 'rgba(255,255,255,0.6)';
const BLANC_45 = 'rgba(255,255,255,0.45)';
const RANGS = ['', '', '2ᵉ', '3ᵉ', '4ᵉ'];

/** Le médaillon couronne posé en bas à droite de la photo du taulier. */
function CouronneMedaillon({ size = 26 }: { size?: number }) {
  return (
    <View style={{
      position: 'absolute', right: -2, bottom: -2,
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: Colors.brand, borderWidth: 2, borderColor: SOMBRE,
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24">
        <Path d={CROWN_PATH} fill={SOMBRE} />
      </Svg>
    </View>
  );
}

export function FeaturedTaulier({ club, myId, onOpenPlayer }: {
  /** Le club mis en avant — club favori du joueur. */
  club: string;
  myId: string;
  onOpenPlayer?: (playerId: string) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [leaders, setLeaders] = useState<ClubLeader[]>([]);
  // Le mois affiché : celui en cours, sinon le précédent s'il n'y a rien.
  const [mois, setMois] = useState(() => new Date());

  const load = useCallback(() => {
    let vivant = true;
    setLoading(true);
    (async () => {
      const maintenant = new Date();
      let rows = await fetchClubLeaders(club, maintenant);
      let affiche = maintenant;
      if (rows.length === 0) {
        const precedent = new Date(maintenant.getFullYear(), maintenant.getMonth() - 1, 1);
        rows = await fetchClubLeaders(club, precedent);
        if (rows.length > 0) affiche = precedent;
      }
      if (!vivant) return;
      setLeaders(rows); setMois(affiche); setLoading(false);
    })();
    return () => { vivant = false; };
  }, [club]);

  useFocusEffect(useCallback(() => { const stop = load(); return stop; }, [load]));

  const taulier = leaders[0];
  const podium = leaders.slice(1, 4);
  const maPlace = leaders.find(l => l.playerId === myId);
  const enRetard = maPlace && taulier ? taulier.matches - maPlace.matches : 0;

  const photo = taulier ? (
    <PlayerAvatar
      name={taulier.name} path={taulier.avatarPath} size={72}
      backgroundColor={Colors.brand} textColor={Colors.primary}
      fontFamily={Fonts.uiBlack} fontSize={26} initialsMax={2}
    />
  ) : null;

  // Sans club favori, on n'a pas de communauté à afficher : on dit lequel
  // manque plutôt que d'inventer un classement.
  if (!club) {
    return (
      <View style={{ backgroundColor: SOMBRE, borderRadius: 18, padding: 16, marginTop: 8 }}>
        <Text numberOfLines={1} style={{ fontFamily: Fonts.uiBlack, fontSize: 10, letterSpacing: 0.8, color: Colors.brand }}>
          {`TAULIER DU CLUB · ${monthLabel(mois).toUpperCase()}`}
        </Text>
        <Text numberOfLines={2} style={{ fontFamily: Fonts.welcome, fontSize: 22, lineHeight: 28, color: '#FFFFFF', marginTop: 12, paddingRight: 6 }}>
          Tu n'as pas encore de club
        </Text>
        <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 12, lineHeight: 17, color: BLANC_60, marginTop: 6 }}>
          Choisis tes clubs favoris au moment de créer une partie : on te montrera alors qui les fait vivre chaque mois.
        </Text>
        <TouchableOpacity onPress={() => router.push('/(tabs)/lobby?create=1' as any)} activeOpacity={0.85}
          style={{ backgroundColor: Colors.brand, borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginTop: 14 }}>
          <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 13.5, color: Colors.primary }}>Choisir mes clubs</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ backgroundColor: SOMBRE, borderRadius: 18, padding: 16, marginTop: 8 }}>
      <Text numberOfLines={1} style={{ fontFamily: Fonts.uiBlack, fontSize: 10, letterSpacing: 0.8, color: Colors.brand }}>
        {`TAULIER DE ${club.toUpperCase()} · ${monthLabel(mois).toUpperCase()}`}
      </Text>

      {loading ? (
        <ActivityIndicator color={Colors.brand} style={{ marginVertical: 24 }} />
      ) : !taulier ? (
        <>
          <Text numberOfLines={2} style={{ fontFamily: Fonts.welcome, fontSize: 22, lineHeight: 28, color: '#FFFFFF', marginTop: 12, paddingRight: 6 }}>
            Personne n'a encore joué ici ce mois-ci
          </Text>
          <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 12, lineHeight: 17, color: BLANC_60, marginTop: 6 }}>
            Le premier match du mois ouvre le classement du club. Ça peut être le tien.
          </Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/lobby' as any)} activeOpacity={0.85}
            style={{ backgroundColor: Colors.brand, borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginTop: 14 }}>
            <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 13.5, color: Colors.primary }}>Trouver une partie</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 12 }}>
            <TouchableOpacity
              activeOpacity={onOpenPlayer ? 0.85 : 1}
              onPress={() => onOpenPlayer?.(taulier.playerId)}
              style={{ position: 'relative' }}
            >
              {taulier.memberNumber != null
                ? <AmbassadorRing size={72} radius={36} showStar={false} surface={SOMBRE}>{photo}</AmbassadorRing>
                : photo}
              <CouronneMedaillon />
            </TouchableOpacity>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
                style={{ fontFamily: Fonts.welcome, fontSize: 24, lineHeight: 28, color: '#FFFFFF', paddingRight: 6 }}>
                {taulier.name}
              </Text>
              <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 12, lineHeight: 17, color: BLANC_60, marginTop: 2 }}>
                {`${taulier.matches} match${taulier.matches > 1 ? 's' : ''} en ${monthLabel(mois)} · ${taulier.wins} victoire${taulier.wins > 1 ? 's' : ''} · ${taulier.partners} partenaire${taulier.partners > 1 ? 's' : ''} différent${taulier.partners > 1 ? 's' : ''}`}
              </Text>
            </View>
          </View>

          {podium.length > 0 ? (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              {podium.map((l, i) => (
                <TouchableOpacity
                  key={l.playerId}
                  activeOpacity={onOpenPlayer ? 0.85 : 1}
                  onPress={() => onOpenPlayer?.(l.playerId)}
                  style={{ flex: 1, backgroundColor: TUILE, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 10 }}
                >
                  <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 9.5, color: BLANC_45 }}>{RANGS[i + 2]}</Text>
                  <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11.5, color: '#FFFFFF', marginTop: 2 }}>
                    {l.playerId === myId ? 'Toi' : l.name.split(' ')[0]}
                  </Text>
                  <Text style={{ fontFamily: Fonts.display, fontSize: 17, color: Colors.brand, marginTop: 2 }}>{l.matches}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 12, lineHeight: 18, color: BLANC_60, marginTop: 12 }}>
            {maPlace
              ? (maPlace.place === 1
                ? 'Tu tiens le club ce mois-ci. '
                : `Tu es ${maPlace.place}ᵉ à ${enRetard} match${enRetard > 1 ? 's' : ''} de la tête. `)
              : 'Un match dans ce club et tu entres au classement. '}
            <Text
              onPress={() => router.push('/ranking' as any)}
              style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: Colors.brand, textDecorationLine: 'underline' }}
            >
              Voir le classement du club →
            </Text>
          </Text>
        </>
      )}
    </View>
  );
}
