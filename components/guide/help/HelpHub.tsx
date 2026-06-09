import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Fonts } from '../../../lib/theme';
import { GuideTheme, RUBRIC } from '../../../lib/guideTheme';
import { Icon } from '../../community/icons';
import { GradientRect } from '../illustrations/_shared';
import { HUB_RUBRICS, ROUTE_TO_RUBRIC } from './data';

function Kicker({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <Text style={{ fontFamily: Fonts.uiBold, fontSize: 11, letterSpacing: 1.8,
      textTransform: 'uppercase', color }}>{children}</Text>
  );
}

function RubricRow({ rkey, T, here, onPress }: { rkey: string; T: GuideTheme; here: boolean; onPress: () => void }) {
  const r = RUBRIC[rkey];
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', padding: 13, borderRadius: 14,
      backgroundColor: here ? r.soft : T.card, borderWidth: 1, borderColor: here ? `${r.accent}55` : T.border }}>
      <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: r.soft, alignItems: 'center',
        justifyContent: 'center', borderWidth: 1, borderColor: `${r.accent}30` }}>
        <Text style={{ fontSize: 20 }}>{r.emoji}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, marginLeft: 13 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14.5, color: T.text }}>{r.title}</Text>
          {here && (
            <View style={{ marginLeft: 7, backgroundColor: `${r.accent}1f`, borderWidth: 1, borderColor: `${r.accent}55`,
              borderRadius: 999, paddingVertical: 2, paddingHorizontal: 7 }}>
              <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 8.5, letterSpacing: 0.6, textTransform: 'uppercase', color: r.accent }}>Tu es ici</Text>
            </View>
          )}
        </View>
        <Text numberOfLines={1} style={{ fontFamily: Fonts.ui, fontSize: 12, color: T.sub, marginTop: 2 }}>{r.sub}</Text>
      </View>
      <Icon name="chevronRight" size={18} color={T.muted} stroke={2.2} />
    </Pressable>
  );
}

export function HelpHub({ T, contextRoute, onOpen, onClose }:
  { T: GuideTheme; contextRoute: string | null; onOpen: (k: string) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const faq = RUBRIC.faq;
  const hereKey = contextRoute ? ROUTE_TO_RUBRIC[contextRoute] ?? null : null;
  const ordered = [...HUB_RUBRICS].sort((a, b) => (a === hereKey ? -1 : b === hereKey ? 1 : 0));

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      {/* header */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
        paddingTop: insets.top + 14, paddingHorizontal: 20, paddingBottom: 12 }}>
        <View>
          <Kicker color={T.muted}>Centre d'aide</Kicker>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 26, letterSpacing: -0.5, color: T.text, marginTop: 4 }}>Comment ça marche</Text>
        </View>
        <Pressable onPress={onClose} style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: T.chip,
          borderWidth: 1, borderColor: T.border, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="x" size={18} color={T.sub} stroke={2.2} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 4, paddingBottom: insets.bottom + 30 }}
        showsVerticalScrollIndicator={false}>
        {/* Dépannage & FAQ — bloc proéminent */}
        <Pressable onPress={() => onOpen('faq')} style={{ flexDirection: 'row', alignItems: 'center', padding: 16,
          marginBottom: 18, borderRadius: 18, borderWidth: 1, borderColor: `${faq.accent}55`, backgroundColor: faq.soft }}>
          <View style={{ width: 48, height: 48, borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
              <GradientRect colors={['#7C3AED', '#DC2626']} width={48} height={48} radius={14} />
            </View>
            <Icon name="lifeBuoy" size={24} color="#fff" stroke={2.2} />
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 15.5, color: T.text }}>Un souci ? Dépannage & FAQ</Text>
            <Text style={{ fontFamily: Fonts.ui, fontSize: 12.5, color: T.sub, marginTop: 2 }}>ELO bloqué, partie disparue, validation…</Text>
          </View>
          <Icon name="chevronRight" size={20} color={faq.accent} stroke={2.4} />
        </Pressable>

        <View style={{ marginBottom: 10, paddingLeft: 2 }}>
          <Kicker color={T.muted}>Les rubriques</Kicker>
        </View>
        <View style={{ gap: 9 }}>
          {ordered.map((k) => (
            <RubricRow key={k} rkey={k} T={T} here={k === hereKey} onPress={() => onOpen(k)} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
