// Raccourci compact de l'accueil (rangée Classement / Score).
// Carte blanche horizontale : icône sur pastille, valeur forte optionnelle
// (ex. « #12 » = rang réel au classement), titre, sous-titre.
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon, type IconName } from '../community/icons';

export function HomeShortcutCard({ icon, iconColor, iconBg, title, sub, value, onPress }: {
  icon: IconName; iconColor: string; iconBg: string;
  title: string;
  sub?: string;     // sous-titre optionnel (non utilisé sur l'accueil)
  value?: string;   // valeur mise en avant (ex. rang « #12 »)
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.88}
      style={{
        flex: 1,
        backgroundColor: Colors.bgCard, borderRadius: 18,
        borderWidth: 1, borderColor: Colors.border,
        paddingVertical: 11, paddingHorizontal: 10,
        flexDirection: 'row', alignItems: 'center', gap: 8,
        shadowColor: '#0F172A', shadowOpacity: 0.05, shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 }, elevation: 2,
      }}
    >
      <View style={{ width: 30, height: 30, borderRadius: 11, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={17} color={iconColor} stroke={2.2} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {/* Auto-rétrécissement sur écran étroit plutôt que troncature « Classe… » */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
          {value ? (
            <Text numberOfLines={1} style={{ fontFamily: Fonts.display, fontSize: 16, color: Colors.textPrimary, letterSpacing: -0.3 }}>
              {value}
            </Text>
          ) : null}
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}
            style={{ flexShrink: 1, fontFamily: Fonts.uiExtraBold, fontSize: value ? 11.5 : 13, color: Colors.textPrimary }}>
            {title}
          </Text>
        </View>
        {sub ? (
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
            style={{ fontFamily: Fonts.uiSemi, fontSize: 9.5, color: Colors.textMuted, marginTop: 2 }}>
            {sub}
          </Text>
        ) : null}
      </View>
      <Icon name="chevronRight" size={13} color={Colors.textMuted} stroke={2.4} />
    </TouchableOpacity>
  );
}
