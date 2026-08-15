// Carte hero « profil » de l'accueil : identité, niveau + progression, stats fortes.
// UI pure — toutes les données viennent de l'écran (usePlayer + compte de badges).
// Maquette 2026-08 : nom + pill Ambassadeur, ligne ligue/FRMT, gros niveau jaune
// avec cible « → 6.50 », barre de progression épaisse, 3 stats (matchs/victoires/badges).
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts, formatPadelLevel, eloToLevel, getLeague, getLeagueLabel } from '../../lib/theme';
import { Icon, type IconName } from '../community/icons';
import { AMB } from '../../lib/ambassador';

export function HomeProfileCard({ name, elo, wins, losses, badgeCount, frmt, onPress, compact, memberNumber }: {
  name: string; elo: number; wins: number; losses: number; badgeCount: number;
  frmt?: { text: string; verified: boolean } | null;
  onPress: () => void;
  compact?: boolean;   // petits écrans : typo/paddings réduits pour tenir sans scroll
  memberNumber?: number | null;   // Ambassadeur « Cercle des 100 » : pill or à côté du nom
}) {
  const leagueType = getLeague(elo);
  const leagueHex = Colors.league[leagueType];
  const level = eloToLevel(elo);
  const total = wins + losses;
  const winPct = total > 0 ? Math.round((wins / total) * 100) : 0;

  // Progression vers le prochain palier de 0,25 (6.42 → « 6.50 »), saturée à 8.
  const maxed = level >= 8;
  const target = maxed ? 8 : Math.min(8, (Math.floor(level / 0.25 + 1e-9) + 1) * 0.25);
  const progress = maxed ? 1 : Math.min(1, Math.max(0.05, (level - (target - 0.25)) / 0.25));

  const stats: { icon: IconName; iconColor: string; value: number | string; label: string }[] = [
    { icon: 'racket', iconColor: Colors.brand, value: total,        label: 'MATCHS' },
    { icon: 'trophy', iconColor: '#34D399',    value: `${winPct}%`, label: 'VICTOIRES' },
    { icon: 'medal',  iconColor: Colors.brand, value: badgeCount,   label: 'BADGES' },
  ];

  const amb = memberNumber != null;

  return (
    <View style={{
      backgroundColor: Colors.heroBg, borderRadius: 24, overflow: 'hidden',
      paddingHorizontal: 18, paddingVertical: compact ? 12 : 15,
      // Remplit le wrapper proportionnel de l'écran (voir index) ; l'air se
      // répartit ENTRE identité / niveau / stats.
      flex: 1, justifyContent: 'space-between',
      shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 }, elevation: 7,
    }}>
      {/* Fond identique pour tous (l'effet doré ambassadeur a été retiré) :
          disques jaunes translucides très subtils. */}
      <View pointerEvents="none" style={{ position: 'absolute', top: -50, right: -30, width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(255,193,26,0.14)' }} />
      <View pointerEvents="none" style={{ position: 'absolute', bottom: -60, left: -40, width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(255,193,26,0.05)' }} />

      {/* Identité — tap → profil complet */}
      <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={{ gap: compact ? 6 : 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text
            numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
            style={{ fontFamily: Fonts.welcome, fontSize: compact ? 23 : 26, lineHeight: compact ? 28 : 32, color: Colors.textOnDark, letterSpacing: 0.3, paddingRight: 5, flexShrink: 1 }}
          >
            {name}
          </Text>
          {amb && (
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 5,
              borderWidth: 1, borderColor: AMB.gold, borderRadius: 999,
              paddingHorizontal: 10, paddingVertical: 4,
            }}>
              <Icon name="crown" size={11} color={AMB.gold} fill={AMB.gold} stroke={2} />
              <Text style={{ fontFamily: Fonts.uiBold, fontSize: 10.5, color: AMB.gold, letterSpacing: 0.4 }}>
                Ambassadeur
              </Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Icon name="gem" size={13} color={leagueHex} stroke={2.2} />
          <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textOnDark, textTransform: 'uppercase', letterSpacing: 1.1 }}>
            Ligue {getLeagueLabel(leagueType)}
          </Text>
          {frmt ? (
            <>
              <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>•</Text>
              <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 11, fontFamily: Fonts.uiBlack, fontWeight: '900', color: frmt.verified ? '#34D399' : 'rgba(255,255,255,0.85)', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                {`FRMT ${frmt.text}${frmt.verified ? ' ✓' : ''}`}
              </Text>
            </>
          ) : null}
        </View>
      </TouchableOpacity>

      {/* Niveau : gros chiffre jaune → cible, barre de progression épaisse */}
      <View style={{ marginTop: compact ? 8 : 10 }}>
        <Text style={{ fontFamily: Fonts.uiBold, fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1.4 }}>
          Niveau
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 2 }}>
          {/* Pas de lineHeight serré ici : Anton a des ascendantes hautes et
              iOS rogne le haut des chiffres si la ligne est plus courte que
              la police — on laisse la hauteur de ligne par défaut. */}
          <Text style={{ fontFamily: Fonts.display, fontSize: compact ? 30 : 34, letterSpacing: -0.5, color: Colors.brand, includeFontPadding: false }}>
            {formatPadelLevel(elo)}
          </Text>
          {maxed ? (
            <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>
              Niveau max
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 4 }}>
              <Icon name="arrowRight" size={16} color={Colors.brand} stroke={2.4} />
              <Text style={{ fontFamily: Fonts.display, fontSize: compact ? 18 : 20, color: 'rgba(255,255,255,0.85)' }}>
                {target.toFixed(2)}
              </Text>
            </View>
          )}
        </View>
        <View style={{ marginTop: compact ? 7 : 9, height: compact ? 7 : 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' }}>
          <View style={{ width: `${Math.round(progress * 100)}%`, height: '100%', borderRadius: 999, backgroundColor: Colors.brand }} />
        </View>
      </View>

      {/* Bande de stats — 3 colonnes : matchs, % victoires, badges */}
      <View style={{ flexDirection: 'row', marginTop: compact ? 9 : 12, paddingTop: compact ? 4 : 6 }}>
        {stats.map(s => (
          <View key={s.label} style={{ flex: 1, alignItems: 'center', gap: compact ? 3 : 4 }}>
            <Icon name={s.icon} size={compact ? 15 : 17} color={s.iconColor} stroke={2.2} />
            <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: Fonts.display, fontSize: compact ? 20 : 23, lineHeight: compact ? 24 : 28, letterSpacing: -0.5, color: Colors.textOnDark }}>
              {s.value}
            </Text>
            <Text style={{ fontFamily: Fonts.uiBold, fontSize: 8.5, fontWeight: '700', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1.1 }}>
              {s.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
