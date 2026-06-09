import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Fonts } from '../../../lib/theme';
import { GuideTheme, RUBRIC } from '../../../lib/guideTheme';
import { Icon } from '../../community/icons';
import { ILLUST } from '../illustrations';
import { HELP, FAQ, HUB_RUBRICS } from './data';
import { FaqItem } from './FaqItem';

function HeaderBtn({ T, name, onPress }: { T: GuideTheme; name: 'arrowLeft' | 'x'; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: T.chip,
      borderWidth: 1, borderColor: T.border, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={18} color={name === 'x' ? T.sub : T.text} stroke={2.2} />
    </Pressable>
  );
}

export function HelpDetail({ rkey, T, onBack, onClose, onPrevNext, onRoute }:
  { rkey: string; T: GuideTheme; onBack: () => void; onClose: () => void;
    onPrevNext: (d: -1 | 1) => void; onRoute: (route: string) => void }) {
  const insets = useSafeAreaInsets();
  const isFaq = rkey === 'faq';
  const r = RUBRIC[rkey];
  const data = HELP[rkey];
  const Illust = data?.illust ? ILLUST[data.illust] : null;
  const [openFaq, setOpenFaq] = useState(0);
  const idx = HUB_RUBRICS.indexOf(rkey);

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      {/* header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: insets.top + 14, paddingHorizontal: 16, paddingBottom: 8 }}>
        <HeaderBtn T={T} name="arrowLeft" onPress={onBack} />
        <Text numberOfLines={1} style={{ flex: 1, marginHorizontal: 8, fontFamily: Fonts.uiExtraBold, fontSize: 15, color: T.text }}>
          {isFaq ? 'Dépannage & FAQ' : r.title}
        </Text>
        <HeaderBtn T={T} name="x" onPress={onClose} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 6, paddingBottom: insets.bottom + 28 }}
        showsVerticalScrollIndicator={false}>
        {/* tag */}
        <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: r.soft,
          borderWidth: 1, borderColor: `${r.accent}40`, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11, marginBottom: 12 }}>
          <Text style={{ fontSize: 13, marginRight: 6 }}>{r.emoji}</Text>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase', color: r.accent }}>
            {isFaq ? 'Questions fréquentes' : r.title}
          </Text>
        </View>
        <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 23, letterSpacing: -0.5, lineHeight: 26, color: T.text, marginBottom: 7 }}>
          {isFaq ? 'On te débloque' : r.sub}
        </Text>

        {isFaq ? (
          <View style={{ marginTop: 16, gap: 9 }}>
            {FAQ.map((item, k) => (
              <FaqItem key={k} item={item} T={T} open={openFaq === k} onToggle={() => setOpenFaq(openFaq === k ? -1 : k)} />
            ))}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, padding: 14, borderRadius: 14,
              backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderStyle: 'dashed' }}>
              <Icon name="settings" size={17} color={T.muted} />
              <Text style={{ flex: 1, marginLeft: 9, fontFamily: Fonts.ui, fontSize: 12.5, color: T.sub }}>
                Toujours bloqué ? <Text style={{ fontFamily: Fonts.uiExtraBold, color: T.text }}>Réglages › Aide</Text>
              </Text>
            </View>
          </View>
        ) : (
          <>
            {Illust && (
              <View style={{ alignItems: 'center', marginVertical: 20 }}>
                <View style={{ position: 'absolute', width: 260, height: 220, borderRadius: 999, backgroundColor: r.soft, top: -6 }} />
                <Illust />
              </View>
            )}
            {/* comment ça marche */}
            <View style={{ backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 16, padding: 16 }}>
              <Text style={{ fontFamily: Fonts.uiBold, fontSize: 11, letterSpacing: 1.8, textTransform: 'uppercase', color: r.accent, marginBottom: 13 }}>
                Comment ça marche
              </Text>
              {data.steps.map((s, k) => (
                <View key={k} style={{ flexDirection: 'row', paddingBottom: k === data.steps.length - 1 ? 0 : 14 }}>
                  <View style={{ width: 24, height: 24, borderRadius: 999, backgroundColor: r.soft, borderWidth: 1,
                    borderColor: `${r.accent}45`, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                    <Text style={{ fontFamily: Fonts.display, fontSize: 13, color: r.accent }}>{k + 1}</Text>
                  </View>
                  <Text style={{ flex: 1, marginLeft: 12, fontFamily: Fonts.ui, fontSize: 13.5, lineHeight: 19, color: T.text }}>{s}</Text>
                </View>
              ))}
            </View>

            {data.cta && (
              <Pressable onPress={() => onRoute(data.cta!.route)} style={{ marginTop: 16, height: 52, borderRadius: 999,
                backgroundColor: T.ctaBg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 15, color: T.ctaFg, marginRight: 8 }}>{data.cta.label}</Text>
                <Icon name="arrowRight" size={18} color={T.ctaFg} stroke={2.2} />
              </Pressable>
            )}

            {/* précédent / suivant */}
            <View style={{ flexDirection: 'row', marginTop: 18, gap: 10 }}>
              <Pressable disabled={idx <= 0} onPress={() => onPrevNext(-1)}
                style={{ flex: 1, height: 44, borderRadius: 12, backgroundColor: T.chip, borderWidth: 1, borderColor: T.border,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', opacity: idx <= 0 ? 0.4 : 1 }}>
                <Icon name="chevronLeft" size={16} color={T.sub} />
                <Text style={{ fontFamily: Fonts.uiBold, fontSize: 13, color: T.sub, marginLeft: 6 }}>Précédent</Text>
              </Pressable>
              <Pressable disabled={idx >= HUB_RUBRICS.length - 1} onPress={() => onPrevNext(1)}
                style={{ flex: 1, height: 44, borderRadius: 12, backgroundColor: T.chip, borderWidth: 1, borderColor: T.border,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', opacity: idx >= HUB_RUBRICS.length - 1 ? 0.4 : 1 }}>
                <Text style={{ fontFamily: Fonts.uiBold, fontSize: 13, color: T.sub, marginRight: 6 }}>Suivant</Text>
                <Icon name="chevronRight" size={16} color={T.sub} />
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
