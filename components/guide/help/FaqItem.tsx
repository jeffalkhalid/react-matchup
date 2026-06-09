import React from 'react';
import { View, Text, Pressable, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Fonts } from '../../../lib/theme';
import { GuideTheme, RUBRIC } from '../../../lib/guideTheme';
import { Icon } from '../../community/icons';
import type { FaqEntry } from './data';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export function FaqItem({ item, T, open, onToggle }:
  { item: FaqEntry; T: GuideTheme; open: boolean; onToggle: () => void }) {
  const accent = RUBRIC.faq.accent;
  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.create(250, 'easeInEaseOut', 'opacity'));
    onToggle();
  };
  return (
    <View style={{ borderRadius: 14, borderWidth: 1, borderColor: open ? `${accent}55` : T.border,
      backgroundColor: open ? RUBRIC.faq.soft : T.card, overflow: 'hidden' }}>
      <Pressable onPress={toggle} style={{ flexDirection: 'row', alignItems: 'center', padding: 14 }}>
        <Text style={{ flex: 1, fontFamily: Fonts.uiExtraBold, fontSize: 13.5, color: T.text, lineHeight: 18 }}>{item.q}</Text>
        <View style={{ marginLeft: 11, transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <Icon name="chevronDown" size={18} color={open ? accent : T.muted} stroke={2.2} />
        </View>
      </Pressable>
      {open && (
        <Text style={{ paddingHorizontal: 14, paddingBottom: 15, fontFamily: Fonts.ui, fontSize: 13, lineHeight: 20, color: T.sub }}>
          {item.a}
        </Text>
      )}
    </View>
  );
}
