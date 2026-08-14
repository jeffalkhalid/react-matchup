// Carte membre collector « Cercle des 100 » — noir & or, guillochée,
// filigrane raquette. Utilisée par la révélation (Task 8) et la story
// (Task 7). L'inclinaison (rotate) est appliquée par l'appelant.
import React from 'react';
import { Image, Text, View } from 'react-native';
import { Fonts } from '../../lib/theme';
import { AMB } from '../../lib/ambassador';
import { DarkGoldBackdrop, GoldGradientNumber, Guilloche } from './backdrops';
import { LaurelMedallion } from './primitives';

export function MemberCard({
  width, name, number, issued, compact = false,
}: { width: number; name: string; number: number; issued: string; compact?: boolean }) {
  const s = width / 352;
  const radius = (compact ? 20 : 24) * s;
  const pad = (compact ? 18 : 22) * s;
  return (
    <View style={{
      width,
      borderRadius: radius,
      // L'ombre vit sur ce wrapper NON clippé (overflow hidden sur la View
      // intérieure la couperait sur iOS).
      shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 27 * s,
      shadowOffset: { width: 0, height: 13 * s }, elevation: 12,
      backgroundColor: AMB.inkDeep,
    }}>
      <View style={{
        borderRadius: radius, overflow: 'hidden',
        borderWidth: 1, borderColor: AMB.line45,
      }}>
        <DarkGoldBackdrop radius={radius} glowAt="topRight" />
        <Guilloche />
        <Image
          source={require('../../assets/auth/splash-racket.png')}
          style={{
            position: 'absolute', right: -28 * s, bottom: -32 * s,
            width: 150 * s, height: 150 * s, opacity: 0.08,
            transform: [{ rotate: '-15deg' }],
          }}
          resizeMode="contain"
        />
        <View style={{ padding: pad, paddingBottom: (compact ? 14 : 18) * s }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            justifyContent: 'space-between', marginBottom: (compact ? 12 : 18) * s,
          }}>
            <Text style={{
              fontFamily: Fonts.display, fontSize: (compact ? 11 : 13) * s,
              letterSpacing: 2 * s, color: '#FFFFFF',
            }}>
              PAGMATCH
            </Text>
            <LaurelMedallion width={(compact ? 42 : 54) * s} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 * s }}>
            <GoldGradientNumber number={number} fontSize={(compact ? 42 : 58) * s} />
            <Text style={{
              fontFamily: Fonts.display, fontSize: (compact ? 15 : 20) * s,
              color: 'rgba(255,193,26,0.45)', marginBottom: 4 * s,
            }}>
              /100
            </Text>
          </View>
          <Text
            numberOfLines={1} adjustsFontSizeToFit
            style={{
              fontFamily: Fonts.welcome, fontSize: (compact ? 18 : 23) * s,
              color: '#FFFFFF', marginTop: (compact ? 6 : 8) * s,
              marginBottom: compact ? 0 : 16 * s, paddingRight: 6,
            }}>
            {name}
          </Text>
          {!compact && (
            <View style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              borderTopWidth: 1, borderTopColor: 'rgba(255,193,26,0.22)', paddingTop: 12 * s,
            }}>
              <Text style={{
                fontFamily: Fonts.uiBlack, fontSize: 9 * s, letterSpacing: 1.5 * s,
                color: 'rgba(255,255,255,0.55)',
              }}>
                MEMBRE FONDATEUR
              </Text>
              <Text style={{
                fontFamily: Fonts.uiBlack, fontSize: 9 * s, letterSpacing: 1.5 * s,
                color: AMB.goldDeep,
              }}>
                {issued}
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
