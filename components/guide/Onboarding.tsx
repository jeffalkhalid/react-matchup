import React, { useRef, useState, useEffect } from 'react';
import { View, Text, Pressable, Animated, PanResponder, Dimensions, AccessibilityInfo } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Fonts } from '../../lib/theme';
import { guideThemeFor, RUBRIC, GuideTheme } from '../../lib/guideTheme';
import { ILLUST, IllustKey } from './illustrations';
import { Icon } from '../community/icons';
import { registerForPushAsync } from '../../hooks/usePushNotifications';
import { usePlayer } from '../../hooks/usePlayer';
import SplashLogo from '../SplashLogo';

const { width: W } = Dimensions.get('window');

type Slide =
  | { kind: 'hero' }
  | { kind: 'final' }
  | { kind: 'feature'; rubric: keyof typeof RUBRIC; illust: IllustKey; tag: string; title: string; body: string };

const SLIDES: Slide[] = [
  { kind: 'hero' },
  { kind: 'feature', rubric: 'lobby',     illust: 'lobby',     tag: 'Le Lobby',            title: 'Trouve ta partie\nen quelques secondes', body: 'Rejoins une partie ouverte à ton niveau ou crée la tienne. Les parties 🆘 urgentes cherchent un 4ᵉ joueur, vite.' },
  { kind: 'feature', rubric: 'recherche', illust: 'recherche', tag: 'Recherche',           title: 'Trouve les\nbons joueurs',              body: 'Cherche un partenaire à ton niveau, ou laisse les suggestions te proposer qui défier. Niveau, forme, fiabilité : tout est là.' },
  { kind: 'feature', rubric: 'defis',     illust: 'defis',     tag: 'Les Défis',           title: 'Lance un défi\nà n’importe qui',        body: 'Provoque un joueur depuis son profil ou via nos suggestions. Il accepte, vous jouez, l’ELO décide.' },
  { kind: 'feature', rubric: 'ranking',   illust: 'ranking',   tag: 'Classement & Ligues', title: 'Grimpe\nles ligues',                    body: 'Chaque match validé fait bouger ton niveau. Découverte → Bronze → Argent → Or → Diamant. Bats plus fort, gagne plus.' },
  { kind: 'feature', rubric: 'badges',    illust: 'badges',    tag: 'Chats & Palmarès',    title: 'Joue, échange,\ngagne des badges',     body: 'Un chat dédié par partie pour tout caler. Après le match, tes adversaires votent tes trophées 👑.' },
  { kind: 'feature', rubric: 'stories',   illust: 'stories',   tag: 'Stories & Partage',   title: 'Partage tes\nexploits',                 body: 'Transforme une victoire en story 9:16 prête à poster. Le QR « Rejoins-moi » intégré fait grandir ta communauté.' },
  { kind: 'final' },
];

function Reveal({ active, delay = 0, children, reduceMotion }:
  { active: boolean; delay?: number; children: React.ReactNode; reduceMotion: boolean }) {
  const v = useRef(new Animated.Value(active && !reduceMotion ? 0 : 1)).current;
  useEffect(() => {
    if (reduceMotion) { v.setValue(1); return; }
    if (active) {
      v.setValue(0);
      Animated.timing(v, { toValue: 1, duration: 500, delay, useNativeDriver: true }).start();
    } else {
      v.setValue(0);
    }
  }, [active, reduceMotion]);
  return (
    <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}

function HeroSlide({ T, active, reduceMotion }: { T: GuideTheme; active: boolean; reduceMotion: boolean }) {
  const dark = T.mode === 'dark';
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 }}>
      <Reveal active={active} delay={60} reduceMotion={reduceMotion}>
        {/* Lockup de marque identique à l'écran de chargement (SplashLogo). */}
        <View style={{ marginBottom: 22 }}>
          <SplashLogo width={230} onDark={dark} />
        </View>
      </Reveal>
      <Reveal active={active} delay={300} reduceMotion={reduceMotion}>
        <Text style={{ fontFamily: Fonts.welcome, fontSize: 30, lineHeight: 31, textTransform: 'uppercase',
          textAlign: 'center', color: T.text, marginBottom: 16 }}>
          Ton terrain de jeu pour <Text style={{ color: dark ? '#FFC11A' : '#E8A906' }}>devenir le meilleur</Text>
        </Text>
      </Reveal>
      <Reveal active={active} delay={420} reduceMotion={reduceMotion}>
        <Text style={{ fontFamily: Fonts.ui, fontSize: 15, lineHeight: 22, color: T.sub, textAlign: 'center', maxWidth: 300 }}>
          Trouve des partenaires, lance des défis, grimpe le classement ELO. Le padel, version compétition entre potes.
        </Text>
      </Reveal>
    </View>
  );
}

function FeatureSlide({ T, slide, active, reduceMotion }:
  { T: GuideTheme; slide: Extract<Slide, { kind: 'feature' }>; active: boolean; reduceMotion: boolean }) {
  const r = RUBRIC[slide.rubric];
  const Illust = ILLUST[slide.illust];
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', width: 280, height: 280, borderRadius: 999, backgroundColor: r.soft }} />
        <Reveal active={active} delay={120} reduceMotion={reduceMotion}><Illust /></Reveal>
      </View>
      <View style={{ paddingHorizontal: 32, paddingBottom: 4 }}>
        <Reveal active={active} delay={260} reduceMotion={reduceMotion}>
          <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
            backgroundColor: r.soft, borderWidth: 1, borderColor: `${r.accent}40`, borderRadius: 999,
            paddingHorizontal: 12, paddingVertical: 5, marginBottom: 14 }}>
            <Text style={{ fontSize: 13, marginRight: 6 }}>{r.emoji}</Text>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: r.accent }}>{slide.tag}</Text>
          </View>
        </Reveal>
        <Reveal active={active} delay={340} reduceMotion={reduceMotion}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 27, lineHeight: 29, letterSpacing: -0.6, color: T.text, marginBottom: 12 }}>{slide.title}</Text>
        </Reveal>
        <Reveal active={active} delay={420} reduceMotion={reduceMotion}>
          <Text style={{ fontFamily: Fonts.ui, fontSize: 14.5, lineHeight: 22, color: T.sub }}>{slide.body}</Text>
        </Reveal>
      </View>
    </View>
  );
}

function FinalSlide({ T, active, reduceMotion }: { T: GuideTheme; active: boolean; reduceMotion: boolean }) {
  const dark = T.mode === 'dark';
  const IllustNotifCmp = ILLUST.notif;
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', width: 300, height: 300, borderRadius: 999, backgroundColor: 'rgba(255,193,26,0.18)' }} />
        <Reveal active={active} delay={120} reduceMotion={reduceMotion}><IllustNotifCmp /></Reveal>
      </View>
      <View style={{ paddingHorizontal: 30, paddingBottom: 4 }}>
        <Reveal active={active} delay={240} reduceMotion={reduceMotion}>
          <View style={{ alignItems: 'center', marginBottom: 14 }}>
            <View style={{ width: 58, height: 58, borderRadius: 18, backgroundColor: dark ? '#1A1A1E' : '#fff',
              borderWidth: 1, borderColor: T.border, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="bellRing" size={26} color={dark ? '#FFC11A' : '#E8A906'} />
            </View>
          </View>
        </Reveal>
        <Reveal active={active} delay={320} reduceMotion={reduceMotion}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 27, lineHeight: 29, letterSpacing: -0.6, color: T.text, textAlign: 'center', marginBottom: 10 }}>Prêt à jouer ?</Text>
        </Reveal>
        <Reveal active={active} delay={400} reduceMotion={reduceMotion}>
          <Text style={{ fontFamily: Fonts.ui, fontSize: 14.5, lineHeight: 22, color: T.sub, textAlign: 'center', maxWidth: 300, alignSelf: 'center' }}>
            Active les notifications pour ne rater aucun défi, message ou validation de score.
          </Text>
        </Reveal>
      </View>
    </View>
  );
}

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const T = guideThemeFor('dark'); // onboarding toujours sombre (identité splash)
  const insets = useSafeAreaInsets();
  const { player } = usePlayer();
  const [i, setI] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const tx = useRef(new Animated.Value(0)).current;
  const N = SLIDES.length;
  const last = i === N - 1;

  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion); }, []);

  const goTo = (n: number) => {
    const clamped = Math.max(0, Math.min(N - 1, n));
    setI(clamped);
    if (reduceMotion) { tx.setValue(-clamped * W); return; }
    Animated.timing(tx, { toValue: -clamped * W, duration: 450, useNativeDriver: true }).start();
  };

  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dy) < 60,
    onPanResponderRelease: (_, g) => {
      if (g.dx < -52) goTo(iRef.current + 1);
      else if (g.dx > 52) goTo(iRef.current - 1);
    },
  })).current;

  // PanResponder est créé une seule fois → référencer l'index courant via une ref.
  const iRef = useRef(i);
  iRef.current = i;

  const finishWithPush = async () => {
    if (player) await registerForPushAsync(player.id);
    onDone();
  };

  return (
    <View style={{ flex: 1, backgroundColor: T.mode === 'dark' ? T.bg : '#FFFFFF' }}>
      {/* top chrome */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: insets.top + 8, paddingHorizontal: 22, paddingBottom: 6 }}>
        <View style={{ width: 60 }}>
          {i > 0 && (
            <Pressable onPress={() => goTo(i - 1)} hitSlop={8}>
              <Icon name="chevronLeft" size={22} color={T.sub} stroke={2.4} />
            </Pressable>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {SLIDES.map((_, k) => (
            <View key={k} style={{ height: 6, borderRadius: 999, width: k === i ? 22 : 6,
              backgroundColor: k === i ? RUBRIC.welcome.accent : 'rgba(125,125,135,0.35)' }} />
          ))}
        </View>
        <View style={{ width: 60, alignItems: 'flex-end' }}>
          {!last && (
            <Pressable onPress={onDone} hitSlop={8}>
              <Text style={{ fontFamily: Fonts.uiBold, fontSize: 13.5, color: T.muted }}>Passer</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* pager */}
      <View style={{ flex: 1, overflow: 'hidden' }} {...pan.panHandlers}>
        <Animated.View style={{ flexDirection: 'row', width: W * N, flex: 1, transform: [{ translateX: tx }] }}>
          {SLIDES.map((s, k) => (
            <View key={k} style={{ width: W }}>
              {s.kind === 'hero' ? <HeroSlide T={T} active={k === i} reduceMotion={reduceMotion} />
                : s.kind === 'final' ? <FinalSlide T={T} active={k === i} reduceMotion={reduceMotion} />
                : <FeatureSlide T={T} slide={s} active={k === i} reduceMotion={reduceMotion} />}
            </View>
          ))}
        </Animated.View>
      </View>

      {/* bottom CTA */}
      <View style={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 24, paddingTop: 6 }}>
        {last ? (
          <>
            <Pressable onPress={finishWithPush} style={{ height: 54, borderRadius: 999, backgroundColor: T.ctaBg,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="bellRing" size={18} color={T.ctaFg} />
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 15.5, color: T.ctaFg, marginLeft: 8 }}>Activer & jouer</Text>
            </Pressable>
            <Pressable onPress={onDone} style={{ alignItems: 'center', paddingVertical: 10, marginTop: 4 }}>
              <Text style={{ fontFamily: Fonts.uiBold, fontSize: 13.5, color: T.muted }}>Plus tard</Text>
            </Pressable>
          </>
        ) : (
          <Pressable onPress={() => goTo(i + 1)} style={{ height: 54, borderRadius: 999, backgroundColor: T.ctaBg,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 15.5, color: T.ctaFg, marginRight: 8 }}>{i === 0 ? 'Découvrir' : 'Continuer'}</Text>
            <Icon name="arrowRight" size={18} color={T.ctaFg} stroke={2.2} />
          </Pressable>
        )}
      </View>
    </View>
  );
}
