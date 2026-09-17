// Avatar Communauté : la PHOTO du joueur si elle existe, sinon ses initiales
// (Anton) sur dégradé de ligue. Carré arrondi (radius) ou rond (radius=9999).
//
// La photo se demande par son chemin (`players.avatar_path`) : l'adresse est
// signée et regroupée par écran (hooks/useAvatarUrl). Tant qu'elle n'est pas
// prête — ou si elle échoue — on garde les initiales, jamais un rond vide.
import React, { useEffect, useState } from 'react';
import { View, Text, Image } from 'react-native';
import { useAvatarUrl, relancerAvatar } from '../../hooks/useAvatarUrl';
import Svg, { Rect, Defs, LinearGradient, Stop } from 'react-native-svg';
import { LeagueGradients, Colors, Fonts } from '../../lib/theme';
import type { League } from '../../types';

function initials(name?: string): string {
  return (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

export function Avatar({ name, size = 46, radius = 9999, league = 'gold', mono, path }: {
  name?: string;
  size?: number;
  radius?: number;
  league?: League;
  mono?: 'black' | 'yellow';   // surfaces Activité : avatars noir OU jaune uniquement
  /** `players.avatar_path` — absent = initiales, comme avant. */
  path?: string | null;
}) {
  const r = Math.min(radius, size / 2);
  const gid = `av-${league}-${size}`;
  const url = useAvatarUrl(path);
  const [echec, setEchec] = useState(false);
  useEffect(() => { setEchec(false); }, [url]);
  const photo = url && !echec ? (
    <Image
      source={{ uri: url }}
      resizeMode="cover"
      onError={() => { setEchec(true); if (path) relancerAvatar(path); }}
      style={{ position: 'absolute', width: size, height: size, borderRadius: r }}
    />
  ) : null;

  // Mode mono (règle visuelle du handoff) : aplat noir ou jaune, pas de dégradé ligue.
  if (mono) {
    const bg = mono === 'black' ? Colors.primary : Colors.brand;
    const fg = mono === 'black' ? Colors.brand : Colors.primary;
    return (
      <View style={{ width: size, height: size, borderRadius: r, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {photo ?? (
          <Text style={{ fontFamily: Fonts.display, fontSize: size * 0.42, lineHeight: size * 0.42 * 1.3, color: fg, letterSpacing: -0.5, includeFontPadding: false }}>
            {initials(name)}
          </Text>
        )}
      </View>
    );
  }

  const grad = LeagueGradients[league] ?? LeagueGradients.gold;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={grad[0]} />
            <Stop offset="1" stopColor={grad[1]} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={size} height={size} rx={r} ry={r} fill={`url(#${gid})`} />
      </Svg>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', borderRadius: r, overflow: 'hidden' }}>
        {photo ?? (
          <Text style={{
            fontFamily: Fonts.display, fontSize: size * 0.42, lineHeight: size * 0.42 * 1.3, color: Colors.primary,
            letterSpacing: -0.5, includeFontPadding: false,
          }}>
            {initials(name)}
          </Text>
        )}
      </View>
    </View>
  );
}
