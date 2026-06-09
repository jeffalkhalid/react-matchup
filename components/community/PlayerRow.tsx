// Ligne joueur : avatar + nom + pill niveau + sous-texte + bouton Suivre.
import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Colors, Fonts, formatPadelLevel } from '../../lib/theme';
import { Pill } from '../Pill';
import { Avatar } from './Avatar';
import { Chips } from './ui';
import type { SocialPlayer } from '../../types';

export function PlayerRow({ p, sub, onFollow, onPress, busy }: {
  p: SocialPlayer;
  sub?: string;
  onFollow: () => void;
  onPress?: () => void;   // ouvre le profil du joueur
  busy?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
      {/* Zone joueur cliquable → profil (le bouton Suivre reste indépendant) */}
      <TouchableOpacity onPress={onPress} disabled={!onPress} activeOpacity={0.7} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <Avatar name={p.name} size={46} radius={14} league={p.league} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14.5, color: Colors.textPrimary }}>
            {p.name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
            <Pill variant="brand">Niv. {formatPadelLevel(p.elo_score)}</Pill>
            {sub || p.mutual != null ? (
              <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: Fonts.uiSemi, fontSize: 11, color: Colors.textMuted }}>
                {sub ?? `${p.mutual} ami${(p.mutual ?? 0) > 1 ? 's' : ''} en commun`}
              </Text>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
      <TouchableOpacity onPress={onFollow} disabled={busy} activeOpacity={0.85} style={{
        backgroundColor: p.following ? Chips : Colors.primary,
        borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, minWidth: 86, alignItems: 'center',
      }}>
        {busy ? (
          <ActivityIndicator size="small" color={p.following ? Colors.textSecondary : '#fff'} />
        ) : (
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12.5, color: p.following ? Colors.textSecondary : '#fff' }}>
            {p.following ? 'Suivi ✓' : '+ Suivre'}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}
