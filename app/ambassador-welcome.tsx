// Révélation « Cercle des 100 » : joué une seule fois, au premier
// lancement connecté d'un joueur ambassadeur (après l'onboarding).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { MemberCard } from '../components/ambassador/MemberCard';
import { usePlayer } from '../hooks/usePlayer';
import {
  AMB, AMBASSADOR_LIMIT, AMB_REVEAL_SEEN_KEY, fetchAmbassadorsCount, isAmbassador, issuedLabel,
} from '../lib/ambassador';
import { Fonts } from '../lib/theme';

export default function AmbassadorWelcomeScreen() {
  const { player } = usePlayer();
  const insets = useSafeAreaInsets();
  const [taken, setTaken] = useState<number | null>(null);

  useEffect(() => {
    if (player?.id) AsyncStorage.setItem(AMB_REVEAL_SEEN_KEY(player.id), '1');
    fetchAmbassadorsCount().then(setTaken);
  }, [player?.id]);

  if (!player || !isAmbassador(player)) {
    // Garde-fou : ne devrait jamais s'afficher hors ambassadeur.
    return <View style={{ flex: 1, backgroundColor: '#0A0A0A' }} />;
  }

  const n = player.member_number!;
  const takenCount = taken ?? n;
  const firstName = player.name.trim().split(/\s+/)[0];

  const close = (toProfile: boolean) => {
    if (toProfile) router.replace(`/player/${player.id}`);
    else if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  return (
    <View style={{
      flex: 1, backgroundColor: '#0A0A0A', justifyContent: 'center',
      paddingHorizontal: 24, paddingTop: insets.top + 4, paddingBottom: insets.bottom + 16,
    }}>
      <Svg pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="ambWelcome" cx="50%" cy="42%" rx="80%" ry="55%">
            <Stop offset="0" stopColor={AMB.gold} stopOpacity={0.13} />
            <Stop offset="0.7" stopColor={AMB.gold} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#ambWelcome)" />
      </Svg>
      <View pointerEvents="none" style={{
        position: 'absolute', top: '17%', left: '11%', width: 4, height: 4,
        borderRadius: 999, backgroundColor: 'rgba(255,209,63,0.7)',
      }} />
      <View pointerEvents="none" style={{
        position: 'absolute', top: '12%', right: '18%', width: 3, height: 3,
        borderRadius: 999, backgroundColor: 'rgba(255,193,26,0.5)',
      }} />
      <View pointerEvents="none" style={{
        position: 'absolute', top: '31%', right: '7%', width: 5, height: 5,
        borderRadius: 999, backgroundColor: 'rgba(255,209,63,0.35)',
      }} />
      <View pointerEvents="none" style={{
        position: 'absolute', bottom: '25%', left: '7%', width: 3, height: 3,
        borderRadius: 999, backgroundColor: 'rgba(255,193,26,0.4)',
      }} />
      <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 11, letterSpacing: 2.4, color: AMB.gold, marginBottom: 10 }}>
        LES 100 PREMIERS
      </Text>
      <Text
        numberOfLines={2} adjustsFontSizeToFit
        style={{ fontFamily: Fonts.welcome, fontSize: 36, lineHeight: 38, color: '#FFFFFF', marginBottom: 12, paddingRight: 8 }}>
        Bienvenue au Cercle des 100, {firstName}.
      </Text>
      <Text style={{ fontFamily: Fonts.ui, fontSize: 13.5, lineHeight: 21, color: 'rgba(255,255,255,0.62)', marginBottom: 26 }}>
        Vous êtes le {n}ᵉ inscrit sur PagMatch. Ce numéro est à vous, à vie — personne d'autre ne le portera.
      </Text>
      <View style={{ transform: [{ rotate: '-2.5deg' }], marginTop: 4, marginHorizontal: 2 }}>
        <MemberCard
          width={Dimensions.get('window').width - 52}
          name={player.name} number={n} issued={issuedLabel(player.created_at)} />
      </View>
      <View style={{ marginTop: 24 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10, letterSpacing: 1, color: 'rgba(255,255,255,0.5)' }}>
            PLACES ATTRIBUÉES
          </Text>
          <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 11, color: AMB.gold }}>
            {takenCount} / {AMBASSADOR_LIMIT}
          </Text>
        </View>
        <View style={{ height: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
          <View style={{
            height: '100%', borderRadius: 999,
            width: `${Math.min(100, Math.round((takenCount / AMBASSADOR_LIMIT) * 100))}%`,
            backgroundColor: AMB.goldDeep,
          }} />
        </View>
      </View>
      <View style={{ gap: 10, marginTop: 16 }}>
        <TouchableOpacity onPress={() => close(true)} activeOpacity={0.85}
          style={{ backgroundColor: AMB.gold, borderRadius: 16, padding: 16, alignItems: 'center' }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14.5, color: '#0A0A0A' }}>
            Voir mes privilèges
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => close(false)} activeOpacity={0.7} style={{ alignItems: 'center', padding: 8 }}>
          <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>
            Plus tard
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
