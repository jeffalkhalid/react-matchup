// Carte hero « profil » de l'accueil : identité, niveau + progression, stats fortes.
// UI pure — toutes les données viennent de l'écran (usePlayer + compte de badges).
import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated } from 'react-native';
import Svg, { Rect, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import {
  Colors, Fonts, eloToLevel, formatPadelLevel, getLeague, getLeagueLabel,
} from '../../lib/theme';
import { Icon, type IconName } from '../community/icons';

function GradientAvatar({ letter, size = 62 }: { letter: string; size?: number }) {
  const r = Math.round(size * 0.28);
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Defs>
          <SvgLinearGradient id="homeAvGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#6366f1" />
            <Stop offset="1" stopColor="#34d399" />
          </SvgLinearGradient>
        </Defs>
        <Rect x="0" y="0" width={size} height={size} rx={r} fill="url(#homeAvGrad)" />
      </Svg>
      <View style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={{ color: Colors.textOnDark, fontSize: size * 0.42, fontWeight: '900' }}>
          {letter.toUpperCase()}
        </Text>
      </View>
    </View>
  );
}

export function HomeProfileCard({ name, elo, wins, losses, badgeCount, frmt, onPress, compact }: {
  name: string; elo: number; wins: number; losses: number; badgeCount: number;
  frmt?: { text: string; verified: boolean } | null;
  onPress: () => void;
  compact?: boolean;   // petits écrans : typo/paddings réduits pour tenir sans scroll
}) {
  const leagueType = getLeague(elo);
  const leagueLabel = 'Ligue ' + getLeagueLabel(leagueType);
  const leagueHex = Colors.league[leagueType];
  const level = eloToLevel(elo);
  const total = wins + losses;
  const winPct = total > 0 ? Math.round((wins / total) * 100) : 0;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Progression vers le prochain palier de 0,25 (6.70 → « Vers 6.75 »), saturée à 8.
  const maxed = level >= 8;
  const target = maxed ? 8 : Math.min(8, (Math.floor(level / 0.25 + 1e-9) + 1) * 0.25);
  const progress = maxed ? 1 : Math.min(1, Math.max(0.05, (level - (target - 0.25)) / 0.25));

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.35, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const stats: { icon: IconName; iconColor: string; value: number | string; label: string }[] = [
    { icon: 'racket',     iconColor: Colors.brand, value: total,        label: 'MATCHS' },
    { icon: 'trophy',     iconColor: '#34D399',    value: wins,         label: 'VICTOIRES' },
    { icon: 'trendingUp', iconColor: Colors.brand, value: `${winPct}%`, label: 'WIN RATE' },
    { icon: 'medal',      iconColor: '#F59E0B',    value: badgeCount,   label: 'BADGES' },
  ];

  return (
    <View style={{
      backgroundColor: Colors.heroBg, borderRadius: 24, overflow: 'hidden',
      paddingHorizontal: 17, paddingVertical: compact ? 11 : 14,
      // Remplit le wrapper proportionnel de l'écran (voir index) ; l'air se
      // répartit ENTRE identité / niveau / stats.
      flex: 1, justifyContent: 'space-between',
      shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 }, elevation: 7,
    }}>
      {/* Accents jaunes très subtils */}
      <View pointerEvents="none" style={{ position: 'absolute', top: -50, right: -30, width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(255,193,26,0.14)' }} />
      <View pointerEvents="none" style={{ position: 'absolute', bottom: -60, left: -40, width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(255,193,26,0.05)' }} />

      {/* Identité — tap → profil complet */}
      <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <GradientAvatar letter={name.charAt(0)} size={compact ? 46 : 54} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3 }}>
            <Animated.View style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: leagueHex, opacity: pulseAnim }} />
            <Text numberOfLines={1} style={{ fontSize: 9.5, fontFamily: Fonts.uiBlack, fontWeight: '900', color: leagueHex, textTransform: 'uppercase', letterSpacing: 1.4 }}>
              {leagueLabel}
            </Text>
            {frmt ? (
              <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 9.5, fontFamily: Fonts.uiBlack, fontWeight: '900', color: frmt.verified ? '#34D399' : Colors.brandBright, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                {`· FRMT ${frmt.text}${frmt.verified ? ' ✓' : ''}`}
              </Text>
            ) : null}
          </View>
          <Text numberOfLines={1} style={{ fontFamily: Fonts.welcome, fontSize: compact ? 21 : 24, lineHeight: compact ? 25 : 29, color: Colors.textOnDark, letterSpacing: 0.3 }}>
            {name}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Niveau + progression vers le palier suivant */}
      <View style={{ marginTop: compact ? 8 : 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <Text style={{ fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: compact ? 13.5 : 15, color: Colors.brand }}>
            Niveau {formatPadelLevel(elo)}
          </Text>
          <Text style={{ fontFamily: Fonts.uiSemi, fontSize: compact ? 10 : 11, color: 'rgba(255,255,255,0.55)' }}>
            {maxed ? 'Niveau max' : `Vers ${target.toFixed(2)}`}
          </Text>
        </View>
        <View style={{ marginTop: compact ? 6 : 7, height: compact ? 5 : 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
          <View style={{ width: `${Math.round(progress * 100)}%`, height: '100%', borderRadius: 999, backgroundColor: Colors.brand }} />
        </View>
      </View>

      {/* Bande de stats */}
      <View style={{ flexDirection: 'row', marginTop: compact ? 9 : 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: compact ? 8 : 11 }}>
        {stats.map((s, i) => (
          <View key={s.label} style={{ flex: 1, alignItems: 'center', gap: compact ? 3 : 4, borderLeftWidth: i ? 1 : 0, borderLeftColor: 'rgba(255,255,255,0.08)' }}>
            <Icon name={s.icon} size={compact ? 14 : 16} color={s.iconColor} stroke={2.2} />
            <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: Fonts.display, fontSize: compact ? 19 : 22, lineHeight: compact ? 23 : 27, letterSpacing: -0.5, color: Colors.textOnDark }}>
              {s.value}
            </Text>
            <Text style={{ fontFamily: Fonts.uiBold, fontSize: 8, fontWeight: '700', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1.1 }}>
              {s.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
