import React from 'react';
import { View, Text } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useBadge } from './BadgeDefsProvider';
import { BADGE_ICONS, BADGE_ICON_VIEWBOX, FALLBACK_ICON_KEY } from './badgeIcons';

// Pastille ronde de la couleur du badge + glyphe Phosphor bold BLANC.
// Le style des badges vit ICI : pour le changer partout, modifier ce composant.
export function BadgePill({ badge, size = 28, showLabel = false }:
  { badge: string; size?: number; showLabel?: boolean }) {
  const { label, iconKey, color } = useBadge(badge);
  const glyphSize = Math.round(size * 0.62);
  const body = BADGE_ICONS[iconKey] ?? BADGE_ICONS[FALLBACK_ICON_KEY];
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BADGE_ICON_VIEWBOX}" fill="#ffffff">${body}</svg>`;
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <View style={{
        width: size, height: size, borderRadius: 999, backgroundColor: color,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <SvgXml xml={xml} width={glyphSize} height={glyphSize} />
      </View>
      {showLabel && (
        <Text style={{ fontSize: 10, fontWeight: '700', color: '#374151' }} numberOfLines={1}>
          {label}
        </Text>
      )}
    </View>
  );
}
