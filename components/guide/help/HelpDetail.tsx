import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Fonts } from '../../../lib/theme';
import { GuideTheme } from '../../../lib/guideTheme';
import { Icon } from '../../community/icons';
import { TOPICS, FAQ, ORDER, type ShowMeKey } from './data';
import { TabLocator } from './TabLocator';
import { FaqItem } from './FaqItem';

// DÉTAIL d'une rubrique — refonte « Guide d'aide » : on ne décrit plus la
// fonction, on dit OÙ TAPER. Bande « Où ça se trouve » (tab bar miniature,
// entrée surlignée), étapes numérotées, pied fixe : « Me montrer sur l'écran »
// (spotlight rejoué sur le vrai écran), ‹ CTA d'écran ›, compteur « n / 21 ».

function HeaderBtn({ T, name, onPress }: { T: GuideTheme; name: 'arrowLeft' | 'x'; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: T.chip,
      borderWidth: 1, borderColor: T.border, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={18} color={name === 'x' ? T.sub : T.text} stroke={2.2} />
    </Pressable>
  );
}

export function HelpDetail({ rkey, T, onBack, onClose, onPrevNext, onRoute, onShowMe }: {
  rkey: string; T: GuideTheme;
  onBack: () => void; onClose: () => void;
  onPrevNext: (d: -1 | 1) => void;
  onRoute: (route: string) => void;
  onShowMe: (k: ShowMeKey, fromTopic: string | null) => void;
}) {
  const insets = useSafeAreaInsets();
  const isFaq = rkey === 'faq';
  const t = TOPICS[rkey];
  // Dépannage : accordéon, première question ouverte à l'arrivée, une seule à la fois.
  const [openFaq, setOpenFaq] = useState(0);
  const idx = ORDER.indexOf(rkey);

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      {/* ── header ── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: insets.top + 14, paddingHorizontal: 16, paddingBottom: 8 }}>
        <HeaderBtn T={T} name="arrowLeft" onPress={onBack} />
        <Text numberOfLines={1} style={{ flex: 1, marginHorizontal: 8, fontFamily: Fonts.uiExtraBold, fontSize: 15, color: T.text }}>
          {isFaq ? 'Dépannage' : t.title}
        </Text>
        <HeaderBtn T={T} name="x" onPress={onClose} />
      </View>

      {isFaq ? (
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: insets.bottom + 28 }}
          showsVerticalScrollIndicator={false}>
          <Text style={{ fontFamily: Fonts.uiBold, fontSize: 10.5, letterSpacing: 1.8, textTransform: 'uppercase', color: T.accent }}>
            Questions fréquentes
          </Text>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 23, letterSpacing: -0.5, lineHeight: 27, color: T.text, marginTop: 7 }}>
            On te débloque
          </Text>
          <View style={{ marginTop: 16, gap: 9 }}>
            {FAQ.map((item, k) => (
              <FaqItem key={k} item={item} T={T} open={openFaq === k} onToggle={() => setOpenFaq(openFaq === k ? -1 : k)} />
            ))}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, padding: 14, borderRadius: 14,
              backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderStyle: 'dashed' }}>
              <Icon name="mail" size={17} color={T.muted} />
              <Text style={{ flex: 1, marginLeft: 9, fontFamily: Fonts.ui, fontSize: 12.5, color: T.sub }}>
                Toujours bloqué ? <Text style={{ fontFamily: Fonts.uiExtraBold, color: T.text }}>support@pagmatch.com</Text>
              </Text>
            </View>
          </View>
        </ScrollView>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 }}
            showsVerticalScrollIndicator={false}>
            <Text style={{ fontFamily: Fonts.uiBold, fontSize: 10.5, letterSpacing: 1.8, textTransform: 'uppercase', color: T.accent }}>
              {t.kicker}
            </Text>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 23, letterSpacing: -0.5, lineHeight: 27, color: T.text, marginTop: 7 }}>
              {t.head}
            </Text>
            <Text style={{ fontFamily: Fonts.ui, fontSize: 13.5, lineHeight: 20, color: T.sub, marginTop: 8 }}>
              {t.lede}
            </Text>

            {/* ── Où ça se trouve ── */}
            <View style={{ marginTop: 16, padding: 14, borderRadius: 16, backgroundColor: T.card,
              borderWidth: 1, borderColor: T.border }}>
              <Text style={{ fontFamily: Fonts.uiBold, fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: T.muted }}>
                Où ça se trouve
              </Text>
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: T.text, marginTop: 9 }}>
                {t.path}
              </Text>
              {t.tab >= 0 ? (
                <TabLocator T={T} active={t.tab} />
              ) : (
                <Text style={{ fontFamily: Fonts.ui, fontSize: 11.5, lineHeight: 16, color: T.muted, marginTop: 9 }}>
                  Hors tab bar : on passe par l'en-tête ou par une autre rubrique.
                </Text>
              )}
            </View>

            {/* ── étapes : où taper ── */}
            <View style={{ marginTop: 14, gap: 13 }}>
              {t.steps.map((s, k) => (
                <View key={k} style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ width: 24, height: 24, borderRadius: 999, backgroundColor: T.accentSoft,
                    borderWidth: 1, borderColor: T.accentBorder, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                    <Text style={{ fontFamily: Fonts.display, fontSize: 13, lineHeight: 17, color: T.accent }}>{k + 1}</Text>
                  </View>
                  <Text style={{ flex: 1, fontFamily: Fonts.ui, fontSize: 13.5, lineHeight: 19, color: T.text }}>{s}</Text>
                </View>
              ))}
            </View>
          </ScrollView>

          {/* ── pied fixe : Me montrer · ‹ CTA › · n / 21 ── */}
          <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: insets.bottom + 14,
            backgroundColor: T.bg, borderTopWidth: 1, borderTopColor: T.divider, gap: 9 }}>
            {t.showMe && (
              <Pressable onPress={() => onShowMe(t.showMe!, rkey)}
                style={{ height: 50, borderRadius: 999, backgroundColor: T.ctaBg,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Icon name="eye" size={16} color={T.ctaFg} stroke={2.4} />
                <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 15, color: T.ctaFg }}>
                  Me montrer sur l'écran
                </Text>
              </Pressable>
            )}
            <View style={{ flexDirection: 'row', gap: 9 }}>
              <Pressable disabled={idx <= 0} onPress={() => onPrevNext(-1)}
                style={{ width: 50, height: 46, borderRadius: 14, backgroundColor: T.chip, borderWidth: 1,
                  borderColor: T.border, alignItems: 'center', justifyContent: 'center', opacity: idx <= 0 ? 0.4 : 1 }}>
                <Icon name="chevronLeft" size={17} color={T.sub} stroke={2.2} />
              </Pressable>
              {t.cta ? (
                <Pressable onPress={() => onRoute(t.cta!.route)}
                  style={{ flex: 1, minWidth: 0, height: 46, borderRadius: 14, backgroundColor: T.chip,
                    borderWidth: 1, borderColor: T.border, flexDirection: 'row', alignItems: 'center',
                    justifyContent: 'center', gap: 7 }}>
                  <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: T.text }}>
                    {t.cta.label}
                  </Text>
                  <Icon name="arrowRight" size={15} color={T.sub} stroke={2.2} />
                </Pressable>
              ) : (
                <View style={{ flex: 1 }} />
              )}
              <Pressable disabled={idx >= ORDER.length - 1} onPress={() => onPrevNext(1)}
                style={{ width: 50, height: 46, borderRadius: 14, backgroundColor: T.chip, borderWidth: 1,
                  borderColor: T.border, alignItems: 'center', justifyContent: 'center',
                  opacity: idx >= ORDER.length - 1 ? 0.4 : 1 }}>
                <Icon name="chevronRight" size={17} color={T.sub} stroke={2.2} />
              </Pressable>
            </View>
            <Text style={{ textAlign: 'center', fontFamily: Fonts.uiBold, fontSize: 10.5, letterSpacing: 0.4, color: T.muted }}>
              {idx + 1} / {ORDER.length} · {t.kicker}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}
