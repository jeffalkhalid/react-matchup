// Carte « Recap du mois » — maquette « Partager mon bilan » (2026-09-19).
// UNE carte pour deux usages : la slide Partage de mon bilan (capturée en
// image pour Instagram / WhatsApp / galerie) et la dernière slide du bilan
// publié dans le fil d'activité (vue par les amis).
import { forwardRef } from 'react';
import { View, Text, Image } from 'react-native';
import { Fonts } from '../../lib/theme';
import { Icon, type IconName } from '../community/icons';
import { PlayerAvatar } from '../PlayerAvatar';
import type { MonthlyRecap } from '../../lib/bilan';

const JAUNE = '#FFC11A';
const GRIS = 'rgba(255,255,255,0.55)';
const TUILE = 'rgba(255,255,255,0.06)';

export const RecapCard = forwardRef<View, {
  recap: MonthlyRecap;
  playerName: string;
  avatarPath?: string | null;
  /** Niveau affiché sous le nom (niveau actuel du joueur). */
  level: number;
}>(function RecapCard({ recap, playerName, avatarPath, level }, ref) {
  const delta = recap.levelDelta;
  const baisse = delta < 0;
  const deltaTxt = `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`;
  const duo = recap.topPartner;
  const annee = recap.month.slice(0, 4);
  const nb = (v: number | undefined) => (typeof v === 'number' ? String(v) : '—');

  return (
    <View ref={ref} collapsable={false} style={{ backgroundColor: '#0A0A0A', borderRadius: 24, padding: 16 }}>
      {/* Joueur + mois */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <PlayerAvatar
          name={playerName} path={avatarPath} size={54}
          backgroundColor="#0A0A0A" textColor={JAUNE}
          fontFamily={Fonts.uiBlack} fontSize={18} ring={2} ringColor={JAUNE} initialsMax={2}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontFamily: Fonts.uiBlack, fontSize: 19, color: '#FFFFFF' }}>{playerName}</Text>
          <Text style={{ fontFamily: Fonts.uiBold, fontSize: 13, color: GRIS, marginTop: 1 }}>Niv. {level.toFixed(2)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 13, color: JAUNE, letterSpacing: 1.2 }}>{recap.label} {annee}</Text>
          <Text style={{ fontFamily: Fonts.uiBold, fontSize: 8.5, color: GRIS, letterSpacing: 1.4, marginTop: 3 }}>TON MOIS EN CHIFFRES</Text>
        </View>
      </View>

      {/* 6 chiffres */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Tuile icon="racket" n={String(recap.matches)} l="Matchs" />
        <Tuile icon="trophy" n={`${recap.winRate}%`} l="Winrate" couleur={JAUNE} />
        <Tuile icon="trendingUp" n={deltaTxt} l="Niveau" couleur={JAUNE}
          detail={`${recap.fromLvl.toFixed(2)} → ${recap.toLvl.toFixed(2)}`}
          fleche={delta === 0 ? undefined : baisse ? 'bas' : 'haut'} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <Tuile icon="star" n={`+${recap.badges.length}`} l="Badges" />
        <Tuile icon="flame" n={nb(recap.maxWinStreak)} l="Série max" iconColor={JAUNE} />
        <Tuile icon="radar" n={nb(recap.defisWon)} l="Défis gagnés" />
      </View>

      {/* Détails */}
      {(recap.favoriteClub || duo || recap.bestWinLevel != null) && (
        <View style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', gap: 6 }}>
          {recap.favoriteClub && (
            <Ligne icon="mapPin" titre="Club favori" valeur={recap.favoriteClub.name}
              suite={`${recap.favoriteClub.count} match${recap.favoriteClub.count > 1 ? 's' : ''}`} />
          )}
          {duo && (
            <Ligne icon="users" titre="Duo du mois" valeur={duo.name.split(' ')[0]}
              suite={`${duo.matchesTogether} match${duo.matchesTogether > 1 ? 's' : ''} · ${duo.winsTogether} victoire${duo.winsTogether > 1 ? 's' : ''}`} />
          )}
          {recap.bestWinLevel != null && (
            <Ligne icon="trophy" titre="Meilleure perf" valeur={`victoire vs Niv. ${recap.bestWinLevel.toFixed(2)}`} />
          )}
        </View>
      )}

      {/* Signature : le logo de l'app */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.15)' }} />
        <View style={{ alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Image source={require('../../assets/auth/splash-racket.png')} style={{ width: 20, height: 20 }} resizeMode="contain" />
            <Image source={require('../../assets/auth/splash-wordmark.png')} style={{ width: 92, height: 20, marginLeft: -6 }} resizeMode="contain" />
          </View>
          <Text style={{ fontFamily: Fonts.uiBold, fontSize: 7.5, color: GRIS, letterSpacing: 1.6, marginTop: 3 }}>DES JOUEURS QUI COMPTENT</Text>
        </View>
        <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.15)' }} />
      </View>
    </View>
  );
});

function Tuile({ icon, n, l, couleur = '#FFFFFF', iconColor, detail, fleche }: {
  icon: IconName; n: string; l: string; couleur?: string; iconColor?: string;
  detail?: string; fleche?: 'haut' | 'bas';
}) {
  return (
    <View style={{ flex: 1, backgroundColor: TUILE, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 10 }}>
      <Icon name={icon} size={17} color={iconColor ?? (couleur === '#FFFFFF' ? GRIS : couleur)} stroke={2} />
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
        style={{ fontFamily: Fonts.display, fontSize: 28, lineHeight: 36, color: couleur, marginTop: 4 }}>{n}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
        style={{ fontFamily: Fonts.uiBold, fontSize: 9.5, color: GRIS, letterSpacing: 0.6, textTransform: 'uppercase' }}>{l}</Text>
      {detail ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
            style={{ flexShrink: 1, fontFamily: Fonts.uiSemi, fontSize: 10, color: GRIS }}>{detail}</Text>
          {fleche && (
            <View style={{ transform: [{ rotate: fleche === 'bas' ? '90deg' : '-90deg' }] }}>
              <Icon name="chevronRight" size={11} color={fleche === 'bas' ? '#EF4444' : '#10B981'} stroke={3} />
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

function Ligne({ icon, titre, valeur, suite }: { icon: IconName; titre: string; valeur: string; suite?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: TUILE, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12 }}>
      <Icon name={icon} size={16} color={JAUNE} stroke={2.2} />
      <Text numberOfLines={1} style={{ flex: 1, fontFamily: Fonts.uiBold, fontSize: 12, color: GRIS }}>
        <Text style={{ fontFamily: Fonts.uiBlack, color: '#FFFFFF' }}>{titre} : </Text>
        <Text style={{ color: '#FFFFFF' }}>{valeur}</Text>
        {suite ? ` · ${suite}` : ''}
      </Text>
    </View>
  );
}
