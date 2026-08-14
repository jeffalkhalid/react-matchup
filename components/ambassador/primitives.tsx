// Primitives visuelles du statut Ambassadeur « Cercle des 100 ».
// Les paths laurier/médaillon viennent du prototype (design_handoff_ambassadeur)
// et doivent rester identiques partout — c'est la signature de la marque.
import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { Fonts } from '../../lib/theme';
import { AMB, formatMemberNumber, formatMemberNumberShort } from '../../lib/ambassador';

export const CROWN_PATH = 'M3 8.5 6.5 12l3-5 2.5 4 2.5-4 3 5L21 8.5 19 19H5L3 8.5z';

const FLAT_LEAVES = [
  'M38 27 Q28 28 21 22 Q30 18 38 27z',
  'M32 20 Q22 19 17 11 Q27 10 32 20z',
  'M29 12 Q21 8 20 1 Q29 3 29 12z',
];
const MEDALLION_BRANCH =
  'M55 60 Q35 62 25 50 Q38 48 44 56 Q32 52 26 40 Q40 40 46 50 Q34 42 32 28 Q44 32 48 44z';

/** Couronne de laurier plate, drapée sous l'avatar. viewBox 0 0 96 30. */
export function LaurelWreath({ width = 72, color = AMB.gold }: { width?: number; color?: string }) {
  const height = Math.round(width * (30 / 96));
  const leaves = FLAT_LEAVES.map((d, i) => (
    <Path key={i} d={d} opacity={i === 2 ? 0.85 : 1} />
  ));
  return (
    <Svg width={width} height={height} viewBox="0 0 96 30" pointerEvents="none">
      <G fill={color}>
        {leaves}
        <G transform="translate(96,0) scale(-1,1)">{leaves}</G>
      </G>
    </Svg>
  );
}

/** Médaillon laurier (deux branches + cercle + couronne). viewBox 0 0 140 70. */
export function LaurelMedallion({
  width = 60,
  doubleRing = false,
  innerFill = AMB.medallionBg,
}: { width?: number; doubleRing?: boolean; innerFill?: string }) {
  const height = Math.round(width / 2);
  return (
    <Svg width={width} height={height} viewBox="0 0 140 70" pointerEvents="none">
      <G fill={AMB.gold}><Path d={MEDALLION_BRANCH} /></G>
      <G fill={AMB.gold} transform="translate(140,0) scale(-1,1)"><Path d={MEDALLION_BRANCH} /></G>
      {doubleRing ? (
        <>
          <Circle cx={70} cy={35} r={23} fill={innerFill} stroke="rgba(255,193,26,0.4)" strokeWidth={7} />
          <Circle cx={70} cy={35} r={22} fill={innerFill} stroke={AMB.gold} strokeWidth={3} />
        </>
      ) : (
        <Circle cx={70} cy={35} r={21} fill={innerFill} stroke={AMB.gold} strokeWidth={3} />
      )}
      <G transform="translate(58,23)" fill={AMB.gold}><Path d={CROWN_PATH} /></G>
    </Svg>
  );
}

/**
 * Anneau or fin autour d'un avatar de liste + badge couronne en bas-droite.
 * Ne remplace pas le traitement de ligue : l'avatar enfant reste intact
 * À L'INTÉRIEUR de l'anneau. `surface` = couleur du fond de la ligne,
 * pour détourer le badge (même principe que CreatorCrownBadge.ringColor).
 */
export function AmbassadorRing({
  size, radius, surface = '#FFFFFF', showStar = true, children,
}: {
  size: number; radius: number; surface?: string; showStar?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={{ position: 'relative', alignSelf: 'flex-start' }}>
      <View style={{
        borderWidth: 1.5, borderColor: 'rgba(232,169,6,0.9)',
        borderRadius: Math.min(radius + 3.5, (size + 7) / 2), padding: 2,
      }}>
        {children}
      </View>
      {showStar && (
        <View style={{
          position: 'absolute', bottom: -3, right: -3,
          width: 13, height: 13, borderRadius: 999,
          backgroundColor: AMB.gold, borderWidth: 1.5, borderColor: surface,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Svg width={7} height={7} viewBox="0 0 24 24">
            <Path d={CROWN_PATH} fill="#0A0A0A" />
          </Svg>
        </View>
      )}
    </View>
  );
}

/** Chip « N°042 » à côté du nom, pour fonds clairs (listes). */
export function AmbassadorChip({ number }: { number: number }) {
  return (
    <View style={{
      backgroundColor: 'rgba(255,193,26,0.14)', borderWidth: 1,
      borderColor: 'rgba(232,169,6,0.5)', borderRadius: 999,
      paddingHorizontal: 7, paddingVertical: 2.5,
    }}>
      <Text style={{
        fontFamily: Fonts.uiBlack, fontSize: 8.5, letterSpacing: 0.8, color: AMB.chipText,
      }}>
        {formatMemberNumber(number)}
      </Text>
    </View>
  );
}

/** Pill contour or « 👑 AMBASSADEUR N°042 » (header profil, à côté du nom). */
export function AmbassadorPill({ number }: { number: number }) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 5,
      borderWidth: 1.5, borderColor: AMB.gold, borderRadius: 999,
      paddingHorizontal: 9, paddingVertical: 3,
    }}>
      <Svg width={11} height={11} viewBox="0 0 24 24">
        <Path d={CROWN_PATH} fill={AMB.gold} />
      </Svg>
      <Text style={{
        fontFamily: Fonts.uiBlack, fontSize: 9.5, letterSpacing: 0.6, color: AMB.gold,
      }}>
        AMBASSADEUR {formatMemberNumber(number)}
      </Text>
    </View>
  );
}

/** Plaque « N°42 » (pilule noire bord or, sous le laurier de l'avatar profil). */
export function NumberPlate({ number }: { number: number }) {
  return (
    <View style={{
      backgroundColor: '#0A0A0A', borderWidth: 1.5, borderColor: AMB.gold,
      borderRadius: 999, paddingHorizontal: 9, paddingVertical: 1.5,
      alignSelf: 'center',
    }}>
      <Text style={{ fontFamily: Fonts.display, fontSize: 11, color: AMB.gold }}>
        {formatMemberNumberShort(number)}
      </Text>
    </View>
  );
}
