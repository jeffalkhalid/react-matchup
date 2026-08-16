import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Fonts } from '../../../lib/theme';
import { GuideTheme, BRAND } from '../../../lib/guideTheme';
import { Icon, type IconName } from '../../community/icons';
import { TOPICS, FAMILIES, FAQ, CONTEXT, ROUTE_TO_RUBRIC, type ShowMeKey } from './data';

// HUB du centre d'aide — refonte « Guide d'aide » :
// 1. carte contextuelle « Tu es ici » (le guide répond d'abord à l'écran d'où on l'ouvre) ;
// 2. recherche sur une seule liste : rubriques ET questions de dépannage ;
// 3. 6 cartes familles, ordre fixe (c'est un parcours), jamais réordonnées ;
// 4. Dépannage épinglé en pied — c'est souvent la vraie raison d'ouvrir l'aide.

function Kicker({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <Text style={{ fontFamily: Fonts.uiBold, fontSize: 11, letterSpacing: 1.8,
      textTransform: 'uppercase', color }}>{children}</Text>
  );
}

function HerePill() {
  return (
    <View style={{ backgroundColor: BRAND, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 8 }}>
      <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 8.5, letterSpacing: 0.9,
        textTransform: 'uppercase', color: '#0A0A0A' }}>Tu es ici</Text>
    </View>
  );
}

function TopicRow({ tkey, T, here, last, onPress }:
  { tkey: string; T: GuideTheme; here: boolean; last: boolean; onPress: () => void }) {
  const t = TOPICS[tkey];
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingVertical: 12, paddingHorizontal: 14,
      backgroundColor: here ? T.accentSoft : 'transparent',
      borderBottomWidth: last ? 0 : 1, borderBottomColor: T.divider }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14, color: T.text }}>{t.title}</Text>
          {here && (
            <View style={{ backgroundColor: T.accentSoft, borderWidth: 1, borderColor: T.accentBorder,
              borderRadius: 999, paddingVertical: 2, paddingHorizontal: 7 }}>
              <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 8.5, letterSpacing: 0.6,
                textTransform: 'uppercase', color: T.accent }}>Tu es ici</Text>
            </View>
          )}
        </View>
        <Text numberOfLines={1} style={{ fontFamily: Fonts.ui, fontSize: 12, color: T.sub, marginTop: 2 }}>{t.sub}</Text>
      </View>
      <Icon name="chevronRight" size={17} color={T.muted} stroke={2.2} />
    </Pressable>
  );
}

export function HelpHub({ T, contextRoute, onOpen, onShowMe, onClose }: {
  T: GuideTheme; contextRoute: string | null;
  onOpen: (k: string) => void;            // rubrique ou 'faq'
  onShowMe: (k: ShowMeKey, fromTopic: string | null) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const ctx = contextRoute ? CONTEXT[contextRoute] ?? null : null;
  const hereKey = contextRoute ? ROUTE_TO_RUBRIC[contextRoute] ?? null : null;

  // Recherche : titres + sous-titres des rubriques, ET questions du dépannage.
  // Recherche insensible aux accents (« defi » trouve « Défis »).
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const q = norm(query.trim());
  const results = useMemo(() => {
    if (!q) return null;
    const topics = Object.keys(TOPICS).filter(k => {
      const t = TOPICS[k];
      return norm(`${t.title} ${t.sub} ${t.kicker} ${t.head}`).includes(q);
    });
    const faq = FAQ.map((f, i) => ({ ...f, i })).filter(f => norm(`${f.q} ${f.a}`).includes(q));
    return { topics, faq };
  }, [q]);

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      {/* ── header ── */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
        paddingTop: insets.top + 14, paddingHorizontal: 20, paddingBottom: 12 }}>
        <View>
          <Kicker color={T.muted}>Centre d'aide</Kicker>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 26, letterSpacing: -0.5, color: T.text, marginTop: 4 }}>
            Comment ça marche
          </Text>
        </View>
        <Pressable onPress={onClose} style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: T.chip,
          borderWidth: 1, borderColor: T.border, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="x" size={18} color={T.sub} stroke={2.2} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16, gap: 14 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── carte contextuelle « Tu es ici » ── */}
        {ctx && !q && (
          <View style={{ padding: 14, borderRadius: 18, backgroundColor: T.accentSoft,
            borderWidth: 1, borderColor: T.accentBorder, gap: 11 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <HerePill />
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12.5, color: T.text }}>
                Tu es sur {ctx.label}
              </Text>
            </View>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 15.5, lineHeight: 20, color: T.text }}>
              {ctx.question}
            </Text>
            <View>
              {ctx.links.map((l, i) => (
                <Pressable key={l.topic + i} onPress={() => onOpen(l.topic)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8,
                    borderBottomWidth: i === ctx.links.length - 1 ? 0 : 1, borderBottomColor: T.divider }}>
                  <Icon name="arrowRight" size={14} color={T.accent} stroke={2.4} />
                  <Text style={{ flex: 1, fontFamily: Fonts.uiBold, fontSize: 13, color: T.text }}>{l.label}</Text>
                </Pressable>
              ))}
            </View>
            {ctx.showMe && (
              <Pressable onPress={() => onShowMe(ctx.showMe!, hereKey)}
                style={{ height: 42, borderRadius: 999, backgroundColor: T.ctaBg,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                <Icon name="eye" size={15} color={T.ctaFg} stroke={2.4} />
                <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13.5, color: T.ctaFg }}>
                  Me montrer sur l'écran
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {/* ── recherche ── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, height: 44,
          paddingHorizontal: 13, borderRadius: 12, backgroundColor: T.card, borderWidth: 1, borderColor: T.border }}>
          <Icon name="search" size={16} color={T.muted} stroke={2.2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Chercher une réponse…"
            placeholderTextColor={T.muted}
            style={{ flex: 1, fontFamily: Fonts.ui, fontSize: 13, color: T.text, paddingVertical: 0 }}
            returnKeyType="search"
          />
          {q.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Icon name="x" size={15} color={T.muted} stroke={2.2} />
            </Pressable>
          )}
        </View>

        {results ? (
          /* ── résultats de recherche (rubriques + dépannage, une seule liste) ── */
          <View style={{ gap: 14 }}>
            {results.topics.length > 0 && (
              <View style={{ borderRadius: 16, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, overflow: 'hidden' }}>
                {results.topics.map((k, i) => (
                  <TopicRow key={k} tkey={k} T={T} here={k === hereKey}
                    last={i === results.topics.length - 1} onPress={() => onOpen(k)} />
                ))}
              </View>
            )}
            {results.faq.length > 0 && (
              <View style={{ borderRadius: 16, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, overflow: 'hidden' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14,
                  paddingTop: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: T.divider }}>
                  <Icon name="lifeBuoy" size={15} color={T.accent} stroke={2.2} />
                  <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10.5, letterSpacing: 1.6,
                    textTransform: 'uppercase', color: T.accent }}>Dépannage</Text>
                </View>
                {results.faq.map((f, i) => (
                  <Pressable key={f.i} onPress={() => onOpen('faq')}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14,
                      borderBottomWidth: i === results.faq.length - 1 ? 0 : 1, borderBottomColor: T.divider }}>
                    <Text style={{ flex: 1, fontFamily: Fonts.uiBold, fontSize: 13, lineHeight: 17, color: T.text }}>{f.q}</Text>
                    <Icon name="chevronRight" size={16} color={T.muted} stroke={2.2} />
                  </Pressable>
                ))}
              </View>
            )}
            {results.topics.length === 0 && results.faq.length === 0 && (
              <View style={{ padding: 16, borderRadius: 16, backgroundColor: T.card, borderWidth: 1,
                borderColor: T.border, borderStyle: 'dashed', gap: 4 }}>
                <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13.5, color: T.text }}>Aucun résultat</Text>
                <Text style={{ fontFamily: Fonts.ui, fontSize: 12.5, lineHeight: 18, color: T.sub }}>
                  Essaie un autre mot, ou écris-nous : support@pagmatch.com
                </Text>
              </View>
            )}
          </View>
        ) : (
          /* ── 6 familles ── */
          FAMILIES.map((fam) => (
            <View key={fam.key} style={{ borderRadius: 16, backgroundColor: T.card,
              borderWidth: 1, borderColor: T.border, overflow: 'hidden' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14,
                paddingTop: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: T.divider }}>
                <Icon name={fam.icon as IconName} size={15} color={T.accent} stroke={2.2} />
                <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10.5, letterSpacing: 1.6,
                  textTransform: 'uppercase', color: T.accent }}>{fam.label}</Text>
              </View>
              {fam.topics.map((k, i) => (
                <TopicRow key={k} tkey={k} T={T} here={k === hereKey}
                  last={i === fam.topics.length - 1} onPress={() => onOpen(k)} />
              ))}
            </View>
          ))
        )}
      </ScrollView>

      {/* ── Dépannage — épinglé en pied ── */}
      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: insets.bottom + 16,
        backgroundColor: T.bg, borderTopWidth: 1, borderTopColor: T.divider }}>
        <Pressable onPress={() => onOpen('faq')} style={{ flexDirection: 'row', alignItems: 'center', gap: 13,
          padding: 13, borderRadius: 16, backgroundColor: T.card, borderWidth: 1, borderColor: T.border }}>
          <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: T.accentSoft,
            borderWidth: 1, borderColor: T.accentBorder, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="lifeBuoy" size={20} color={T.accent} stroke={2.2} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 15, color: T.text }}>Un souci ? Dépannage</Text>
            <Text numberOfLines={1} style={{ fontFamily: Fonts.ui, fontSize: 12, color: T.sub, marginTop: 2 }}>
              Niveau bloqué, partie disparue, score
            </Text>
          </View>
          <Icon name="chevronRight" size={19} color={T.accent} stroke={2.4} />
        </Pressable>
      </View>
    </View>
  );
}
