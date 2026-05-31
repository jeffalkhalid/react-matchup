import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, Animated, PanResponder,
  Dimensions, ScrollView, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Line, Rect, Polyline } from 'react-native-svg';
import { Colors, Fonts } from '../lib/theme';

const { width: W } = Dimensions.get('window');
const GUIDE_KEY = 'matchup_guide_rn_v1';

// ── Slide data ────────────────────────────────────────────────
const SLIDES = [
  {
    id:         'welcome',
    accent:     Colors.brandDeep,
    blush:      'rgba(255,193,26,0.14)',
    emoji:      '🎾',
    tag:        'Bienvenue',
    title:      'MatchupPadel',
    subtitle:   "Ton espace padel pour défier d'autres joueurs",
    tip:        "Swipe ou appuie sur Suivant pour découvrir les fonctionnalités. Appuie sur ? à tout moment pour revoir ce guide.",
    route:      null as string | null,
    routeLabel: null as string | null,
  },
  {
    id:         'lobby',
    accent:     '#2563eb',
    blush:      'rgba(37,99,235,0.12)',
    emoji:      '📋',
    tag:        'Lobby',
    title:      'Trouve ta partie',
    subtitle:   'Rejoins ou crée une partie en quelques secondes !',
    tip:        "Accède au Lobby et appuie sur une carte → Rejoindre. Pour créer ta propre partie, appuie sur le bouton + en bas de l'écran. Les parties 🆘 Urgent débutent dans moins de 6h avec 1 place restante.",
    route:      '/(tabs)/lobby',
    routeLabel: 'Voir le lobby',
  },
  {
    id:         'matchmaking',
    accent:     '#d97706',
    blush:      'rgba(217,119,6,0.12)',
    emoji:      '⚡',
    tag:        'Défis',
    title:      'Lance un défi',
    subtitle:   "Affronte directement n'importe quel joueur",
    tip:        "Pour défier quelqu'un : ouvre son profil depuis le Classement et appuie sur Défier. Retrouve aussi des suggestions dans l'onglet Défi → Suggestions.",
    route:      '/(tabs)/matchmaking',
    routeLabel: 'Voir les défis',
  },
  {
    id:         'elo',
    accent:     '#059669',
    blush:      'rgba(5,150,105,0.12)',
    emoji:      '🏆',
    tag:        'Classement & Ligues',
    title:      'Grimpe les ligues',
    subtitle:   'Découverte → Bronze → Argent → Or → Diamant',
    tip:        "Ton score ELO évolue à chaque match validé. Plus ton adversaire est fort, plus tu gagnes de points. Ouvre ton profil pour voir ton rang exact.",
    route:      '/(tabs)/ranking',
    routeLabel: 'Voir le classement',
  },
  {
    id:         'chats',
    accent:     '#0891b2',
    blush:      'rgba(8,145,178,0.12)',
    emoji:      '💬',
    tag:        'Chats',
    title:      'Coordonne ta partie',
    subtitle:   'Chat dédié par partie',
    tip:        "Chaque partie a son propre chat. Retrouve-le depuis le Lobby → ta partie. Les messages non lus s'affichent en premier ! Coordonne l'heure d'arrivée avant le match.",
    route:      '/(tabs)/chats',
    routeLabel: 'Voir mes chats',
  },
  {
    id:         'badges',
    accent:     '#b45309',
    blush:      'rgba(180,83,9,0.12)',
    emoji:      '🎖️',
    tag:        'Palmarès',
    title:      'Gagne des badges',
    subtitle:   'Votés par tes adversaires après chaque match',
    tip:        "Lors de la validation d'un score, chaque joueur choisit les trophées à attribuer. Pour voir les badges reçus, ouvre un profil dans le Classement.",
    route:      null,
    routeLabel: null,
  },
  {
    id:         'faq',
    accent:     '#7c3aed',
    blush:      'rgba(124,58,237,0.12)',
    emoji:      '🆘',
    tag:        'Aide',
    title:      'Un problème ?',
    subtitle:   'Les réponses aux questions fréquentes',
    tip:        "Mon ELO n'a pas bougé → Les 4 joueurs doivent valider le score.\n\nMa partie n'apparaît plus → Vérifie les filtres actifs.\n\nJe ne reçois pas de défis → Active les notifications dans les réglages.\n\nUn joueur ne valide pas → Contacte-le via le chat de la partie.\n\nAutre problème → Appuie sur ? pour rouvrir ce guide.",
    route:      null,
    routeLabel: null,
  },
];

// ── Path → slide index ────────────────────────────────────────
function slideForSegment(segments: string[]): number {
  const path = segments.join('/');
  if (path.includes('lobby'))       return 1;
  if (path.includes('matchmaking')) return 2;
  if (path.includes('ranking'))     return 3;
  if (path.includes('chats'))       return 4;
  return 0;
}

// ── Slide illustrations ───────────────────────────────────────
function IllustrationWelcome({ accent }: { accent: string }) {
  const items = [
    { icon: '🔍', label: 'Matchmaking', bg: '#eef2ff' },
    { icon: '✍️', label: 'Score',       bg: '#ecfdf5' },
    { icon: '🏆', label: 'Classement',  bg: '#fff7ed' },
    { icon: '👤', label: 'Profil',      bg: '#eff6ff' },
  ];
  return (
    <View style={{ flex: 1, padding: 14, justifyContent: 'center', gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {items.slice(0, 2).map((it, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: Colors.bgCard, borderRadius: 14, padding: 12, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: Colors.border }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: it.bg, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 18 }}>{it.icon}</Text>
            </View>
            <Text style={{ fontSize: 10, fontWeight: '900', color: Colors.textPrimary }}>{it.label}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {items.slice(2, 4).map((it, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: Colors.bgCard, borderRadius: 14, padding: 12, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: Colors.border }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: it.bg, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 18 }}>{it.icon}</Text>
            </View>
            <Text style={{ fontSize: 10, fontWeight: '900', color: Colors.textPrimary }}>{it.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function IllustrationLobby() {
  const cards = [
    { loc: 'Padel Arena · Dim 18h00', badge: '🆘 Urgent', badgeBg: '#fef2f2', badgeColor: '#dc2626', border: '#fecaca' },
    { loc: 'Club du Lac · Lun 19h30', badge: '✅ Mon niveau', badgeBg: '#ecfdf5', badgeColor: '#059669', border: '#6ee7b7' },
  ];
  return (
    <View style={{ flex: 1, padding: 12, justifyContent: 'center', gap: 8 }}>
      {cards.map((c, i) => (
        <View key={i} style={{ backgroundColor: Colors.bgCard, borderRadius: 14, borderWidth: 1.5, borderColor: c.border, padding: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <View style={{ backgroundColor: c.badgeBg, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ fontSize: 9, fontWeight: '900', color: c.badgeColor }}>{c.badge}</Text>
            </View>
            <View style={{ backgroundColor: '#eef2ff', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ fontSize: 9, fontWeight: '900', color: Colors.primary }}>1 place</Text>
            </View>
          </View>
          <Text style={{ fontSize: 13, fontWeight: '900', color: Colors.textPrimary }}>{c.loc}</Text>
        </View>
      ))}
      <View style={{ backgroundColor: Colors.primary, borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ fontSize: 18 }}>＋</Text>
        <View>
          <Text style={{ fontSize: 11, fontWeight: '900', color: Colors.textOnDark }}>Créer une partie</Text>
          <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)' }}>Annonce en 30 secondes</Text>
        </View>
      </View>
    </View>
  );
}

function IllustrationMatchmaking() {
  const players = [
    { name: 'Antoine M.', level: 'Niv. 4.5', compat: 87, color: '#059669', bg: '#ecfdf5', label: '🔥 Match parfait' },
    { name: 'Sara B.',    level: 'Niv. 4.0', compat: 64, color: '#4f46e5', bg: '#eef2ff', label: '⚡ Très compatible' },
  ];
  return (
    <View style={{ flex: 1, padding: 12, justifyContent: 'center', gap: 8 }}>
      {players.map((p, i) => (
        <View key={i} style={{ backgroundColor: Colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: `${p.color}33`, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: p.bg, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: '900', color: p.color }}>{p.compat}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: '900', color: Colors.textPrimary }}>{p.name}</Text>
            <Text style={{ fontSize: 9, color: Colors.textSecondary, marginTop: 1 }}>{p.level} · {p.label}</Text>
          </View>
          <View style={{ backgroundColor: p.color, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Text style={{ fontSize: 10, fontWeight: '900', color: Colors.textOnDark }}>Défier</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function IllustrationElo() {
  const leagues = [
    { icon: '🌱', label: 'Découverte', color: '#059669', active: false, done: true },
    { icon: '🥉', label: 'Bronze',     color: '#ea580c', active: false, done: true },
    { icon: '🥈', label: 'Argent',     color: Colors.textSecondary, active: false, done: true },
    { icon: '🥇', label: 'Or',         color: '#d97706', active: true,  done: false },
    { icon: '💎', label: 'Diamant',    color: '#06b6d4', active: false, done: false },
  ];
  return (
    <View style={{ flex: 1, padding: 12, justifyContent: 'center', gap: 5 }}>
      <View style={{ backgroundColor: Colors.heroBg, borderRadius: 14, padding: 12, marginBottom: 6 }}>
        <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, fontWeight: '700', textTransform: 'uppercase' }}>Ton score ELO</Text>
        <Text style={{ color: Colors.textOnDark, fontSize: 22, fontWeight: '900', marginTop: 2 }}>6.23</Text>
        <View style={{ height: 4, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 99, marginTop: 8 }}>
          <View style={{ height: 4, borderRadius: 99, backgroundColor: '#d97706', width: '63%' }} />
        </View>
      </View>
      {leagues.map((l, i) => (
        <View key={i} style={{
          flexDirection: 'row', alignItems: 'center', gap: 8,
          padding: 8, borderRadius: 10,
          backgroundColor: l.active ? `${l.color}15` : '#fff',
          borderWidth: 1, borderColor: l.active ? `${l.color}40` : '#f1f5f9',
        }}>
          <Text style={{ fontSize: 14 }}>{l.icon}</Text>
          <Text style={{ flex: 1, fontSize: 11, fontWeight: '900', color: l.active ? l.color : l.done ? '#0f172a' : '#94a3b8' }}>{l.label}</Text>
          {l.active && <View style={{ backgroundColor: l.color, borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2 }}><Text style={{ fontSize: 8, fontWeight: '900', color: Colors.textOnDark }}>Actuel</Text></View>}
          {l.done && <Text style={{ fontSize: 12 }}>✅</Text>}
          {!l.done && !l.active && <Text style={{ fontSize: 11, color: Colors.textMuted }}>🔒</Text>}
        </View>
      ))}
    </View>
  );
}

function IllustrationChats() {
  const msgs = [
    { from: 'Antoine', text: 'On se retrouve à 17h45 ?', mine: false },
    { from: 'Moi',     text: 'Parfait pour moi 👍',      mine: true  },
    { from: 'Sara',    text: 'Je réserve le court B',    mine: false },
  ];
  return (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      <View style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: Colors.bgCardAlt, backgroundColor: Colors.bgCard, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ fontSize: 18 }}>🎾</Text>
        <View>
          <Text style={{ fontSize: 11, fontWeight: '900', color: Colors.textPrimary }}>Padel Arena · Dim 18h00</Text>
          <Text style={{ fontSize: 9, color: Colors.textMuted }}>Antoine, Sara, Marc + toi</Text>
        </View>
        <View style={{ marginLeft: 'auto', backgroundColor: '#ecfdf5', borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: '#6ee7b7' }}>
          <Text style={{ fontSize: 8, fontWeight: '900', color: '#059669' }}>✅ Confirmé</Text>
        </View>
      </View>
      <View style={{ flex: 1, padding: 10, gap: 8, backgroundColor: Colors.bg }}>
        {msgs.map((m, i) => (
          <View key={i} style={{ flexDirection: 'row', justifyContent: m.mine ? 'flex-end' : 'flex-start' }}>
            <View style={{
              backgroundColor: m.mine ? '#4f46e5' : '#fff',
              paddingHorizontal: 12, paddingVertical: 8,
              borderRadius: 14, maxWidth: '70%',
              borderWidth: m.mine ? 0 : 1, borderColor: Colors.border,
            }}>
              {!m.mine && <Text style={{ fontSize: 8, fontWeight: '700', color: Colors.textMuted, marginBottom: 2 }}>{m.from}</Text>}
              <Text style={{ fontSize: 12, color: m.mine ? '#fff' : '#0f172a', fontWeight: '500' }}>{m.text}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function IllustrationBadges() {
  const badges = [
    { icon: '👑', label: 'MVP',        count: 8,  color: '#d97706', bg: '#fffbeb' },
    { icon: '💥', label: 'La Bombe',   count: 5,  color: '#ea580c', bg: '#fff7ed' },
    { icon: '🧠', label: 'Le Cerveau', count: 12, color: '#7c3aed', bg: '#f5f3ff' },
    { icon: '🤝', label: 'Fair-Play',  count: 19, color: '#059669', bg: '#ecfdf5' },
    { icon: '🧱', label: 'Le Mur',     count: 7,  color: Colors.textSecondary, bg: '#f1f5f9' },
    { icon: '😄', label: 'Ambiance',   count: 21, color: '#0891b2', bg: '#ecfeff' },
  ];
  return (
    <View style={{ flex: 1, padding: 12, justifyContent: 'center' }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {badges.map((b, i) => (
          <View key={i} style={{ width: (W - 24 - 6 * 3) / 3 - 1, backgroundColor: b.bg, borderRadius: 12, padding: 10, alignItems: 'center', gap: 4 }}>
            <Text style={{ fontSize: 22 }}>{b.icon}</Text>
            <Text style={{ fontSize: 9, fontWeight: '900', color: b.color }}>{b.label}</Text>
            <Text style={{ fontSize: 9, color: Colors.textSecondary }}>×{b.count}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function IllustrationFaq() {
  const items = [
    { icon: '📊', q: "Mon ELO n'a pas bougé",   a: 'Les 4 joueurs doivent valider',    color: '#7c3aed', bg: '#f5f3ff' },
    { icon: '🔍', q: "Ma partie n'apparaît plus", a: 'Vérifie les filtres du lobby',      color: '#2563eb', bg: '#eff6ff' },
    { icon: '🔔', q: 'Pas de défi reçu',          a: 'Active les notifications',          color: '#d97706', bg: '#fffbeb' },
    { icon: '💬', q: 'Joueur ne valide pas',      a: 'Contacte-le via le chat',          color: '#0891b2', bg: '#ecfeff' },
    { icon: '🆘', q: 'Autre problème',             a: 'Appuie sur ? pour ce guide',       color: '#dc2626', bg: '#fef2f2' },
  ];
  return (
    <View style={{ flex: 1, padding: 12, justifyContent: 'center', gap: 6 }}>
      {items.map((it, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: it.bg, borderRadius: 10, padding: 9 }}>
          <Text style={{ fontSize: 16 }}>{it.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 10, fontWeight: '900', color: it.color }}>{it.q}</Text>
            <Text style={{ fontSize: 9, color: Colors.textSecondary, marginTop: 1 }}>{it.a}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const ILLUSTRATIONS: Record<string, React.ComponentType<any>> = {
  welcome:     IllustrationWelcome,
  lobby:       IllustrationLobby,
  matchmaking: IllustrationMatchmaking,
  elo:         IllustrationElo,
  chats:       IllustrationChats,
  badges:      IllustrationBadges,
  faq:         IllustrationFaq,
};

// ── Icons ─────────────────────────────────────────────────────
const IconClose = () => (
  <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
    <Path d="M1 1l12 12M13 1L1 13" stroke={Colors.textSecondary} strokeWidth={2} strokeLinecap="round" />
  </Svg>
);

const IconArrow = () => (
  <Svg width={13} height={13} viewBox="0 0 12 12" fill="none">
    <Path d="M1 6h10M7 2l4 4-4 4" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

// ── Main component ────────────────────────────────────────────
export default function FeatureGuide() {
  const insets   = useSafeAreaInsets();
  const segments = useSegments();
  const router   = useRouter();

  const [open,    setOpen]    = useState(false);
  const [index,   setIndex]   = useState(0);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const opacAnim  = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    AsyncStorage.getItem(GUIDE_KEY).then(v => {
      if (!v) setTimeout(() => { setIndex(0); setOpen(true); }, 1200);
    });
  }, []);

  const close = () => {
    AsyncStorage.setItem(GUIDE_KEY, '1');
    setOpen(false);
  };

  const openAtSegment = () => {
    setIndex(slideForSegment(segments as string[]));
    setOpen(true);
  };

  const animateTo = (next: number, dir: 1 | -1) => {
    Animated.parallel([
      Animated.timing(opacAnim,  { toValue: 0, duration: 140, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: dir * 20, duration: 140, useNativeDriver: true }),
    ]).start(() => {
      setIndex(next);
      slideAnim.setValue(-dir * 20);
      Animated.parallel([
        Animated.timing(opacAnim,  { toValue: 1, duration: 160, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 160, useNativeDriver: true }),
      ]).start();
    });
  };

  const next = () => index < SLIDES.length - 1 ? animateTo(index + 1, 1) : close();
  const prev = () => index > 0 ? animateTo(index - 1, -1) : undefined;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dy) < 60,
      onPanResponderRelease: (_, g) => {
        if (g.dx < -40) next();
        else if (g.dx > 40) prev();
      },
    })
  ).current;

  const slide  = SLIDES[index];
  const isLast = index === SLIDES.length - 1;
  const isFaq  = slide.id === 'faq';
  const Illus  = ILLUSTRATIONS[slide.id];

  return (
    <>
      {/* ── FAB button — middle right ── */}
      <TouchableOpacity
        onPress={openAtSegment}
        activeOpacity={0.82}
        style={{
          position: 'absolute',
          right: 0,
          top: '50%',
          marginTop: -22,
          width: 40,
          height: 44,
          borderTopLeftRadius: 12,
          borderBottomLeftRadius: 12,
          backgroundColor: Colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: Colors.primary,
          shadowOpacity: 0.4,
          shadowRadius: 10,
          shadowOffset: { width: -2, height: 0 },
          elevation: 8,
          zIndex: 90,
        }}
      >
        <Text style={{ color: Colors.textOnDark, fontSize: 19, fontWeight: '900', lineHeight: 24, fontFamily: Fonts.uiBlack }}>?</Text>
      </TouchableOpacity>

      {/* ── Full-screen guide modal ── */}
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={close}
      >
        <View style={{ flex: 1, backgroundColor: Colors.bgCard }} {...panResponder.panHandlers}>
          {/* Blush gradient bg */}
          <View style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: '50%',
            backgroundColor: slide.blush,
            opacity: 0.6,
          }} />

          {/* Close button */}
          <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 20, flexDirection: 'row', justifyContent: 'flex-end' }}>
            <TouchableOpacity
              onPress={close}
              style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.bgCardAlt, alignItems: 'center', justifyContent: 'center' }}
            >
              <IconClose />
            </TouchableOpacity>
          </View>

          {/* Animated content */}
          <Animated.View style={{ flex: 1, opacity: opacAnim, transform: [{ translateX: slideAnim }] }}>

            {/* Tag chip */}
            <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
              <View style={{ alignSelf: 'flex-start', backgroundColor: `${slide.accent}18`, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 5 }}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: slide.accent, textTransform: 'uppercase', letterSpacing: 1.5 }}>
                  {slide.tag}
                </Text>
              </View>
            </View>

            {/* Illustration card */}
            <View style={{
              marginHorizontal: 20, marginTop: 12, height: 200,
              borderRadius: 20, overflow: 'hidden', backgroundColor: Colors.bgCard,
              borderWidth: 1, borderColor: 'rgba(15,23,42,0.07)',
              shadowColor: slide.accent, shadowOpacity: 0.12, shadowRadius: 16,
              shadowOffset: { width: 0, height: 4 }, elevation: 4,
            }}>
              <View style={{ height: 3, backgroundColor: slide.accent }} />
              <Illus accent={slide.accent} />
            </View>

            {/* Title + subtitle */}
            <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
              <Text style={{ fontSize: 28, color: Colors.textPrimary, letterSpacing: -0.5, fontFamily: Fonts.welcome }}>
                {slide.title}
              </Text>
              <Text style={{ fontSize: 14, fontWeight: '800', color: slide.accent, marginTop: 2, fontFamily: Fonts.uiExtraBold }}>
                {slide.subtitle}
              </Text>
            </View>

            {/* Tip card */}
            <ScrollView
              style={{ marginHorizontal: 20, marginTop: 12, borderRadius: 16, backgroundColor: `${slide.accent}0d`, maxHeight: 130 }}
              contentContainerStyle={{ padding: 14 }}
              showsVerticalScrollIndicator={false}
            >
              <Text style={{ fontSize: 9, fontWeight: '900', color: slide.accent, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>
                Comment ça marche
              </Text>
              <Text style={{ fontSize: 13.5, color: Colors.textSecondary, lineHeight: 20, fontWeight: '500' }}>
                {slide.tip}
              </Text>
            </ScrollView>

          </Animated.View>

          {/* Bottom nav — static */}
          <View style={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 16, paddingTop: 10 }}>
            {/* Progress dots */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 5, marginBottom: 14 }}>
              {SLIDES.map((_, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => i !== index && animateTo(i, i > index ? 1 : -1)}
                  style={{
                    width: i === index ? 22 : 7, height: 7, borderRadius: 99,
                    backgroundColor: i === index ? slide.accent : '#e2e8f0',
                  }}
                />
              ))}
            </View>

            {/* Prev + Next */}
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
              {index > 0 && (
                <TouchableOpacity
                  onPress={prev}
                  style={{ flex: 1, height: 52, borderRadius: 16, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '900', color: Colors.textSecondary, fontFamily: Fonts.uiBlack }}>← Retour</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={next}
                style={{ flex: 1, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: slide.accent,
                  shadowColor: slide.accent, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 }}
              >
                <Text style={{ fontSize: 14, fontWeight: '900', color: Colors.textOnDark, fontFamily: Fonts.uiBlack }}>
                  {isLast ? "C'est parti !" : 'Suivant →'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Try feature shortcut */}
            {slide.route && !isLast && (
              <TouchableOpacity
                onPress={() => { close(); router.push(slide.route as any); }}
                style={{ height: 46, borderRadius: 14, borderWidth: 2, borderColor: slide.accent, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, backgroundColor: `${slide.accent}08`, marginBottom: 6 }}
              >
                <Text style={{ fontSize: 13, fontWeight: '900', color: slide.accent }}>{slide.routeLabel}</Text>
                <IconArrow />
              </TouchableOpacity>
            )}

            {/* Jump to FAQ */}
            {!isFaq && (
              <TouchableOpacity
                onPress={() => animateTo(SLIDES.length - 1, 1)}
                style={{ alignItems: 'center', paddingVertical: 6 }}
              >
                <Text style={{ fontSize: 12, color: Colors.textMuted, fontWeight: '600' }}>🆘 Un problème ? → Voir l'aide</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}
