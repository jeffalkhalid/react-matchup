// Visite guidée « mode opératoire » — onboarding de premier lancement.
// Spotlight en surimpression sur les VRAIS écrans (Accueil + Lobby), 6 étapes
// ancrées, objectif unique : amener le joueur à rejoindre/créer sa 1ʳᵉ partie.
// Spéc : design_handoff_onboarding/Onboarding Spotlight.dc.html (Claude Design).
//
// Langage du spotlight :
// - scrim = 4 rectangles #0A0A0A α .78 autour de la zone (réalisable sans masque) ;
// - anneau 2 px #FFC11A, padding 8 autour de l'ancre, rayon = ancre + 4 (999 → cercle) ;
// - morphing position+rayon 420 ms cubic-bezier(.4,0,.2,1) — un seul spotlight, il
//   se déplace, il ne clignote pas ; pulse 2 s coupé si Reduce Motion ;
// - bulle 306 px #151518, flèche alignée sur le centre de l'ancre, sous l'ancre par
//   défaut, bascule au-dessus près du pouce, centrée si l'ancre est absente.
// Le tap sur la zone surlignée avance la visite, il ne déclenche JAMAIS l'action
// réelle : la visite reste maîtresse de la navigation jusqu'à la fin.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, Easing, Image, PanResponder, Pressable,
  StyleSheet, Text, useWindowDimensions, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import Svg, { Line, Path } from 'react-native-svg';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../hooks/usePlayer';
import { registerForPushAsync } from '../../hooks/usePushNotifications';
import { GUIDE_KEY } from '../../lib/guideTheme';
import { Colors, Fonts } from '../../lib/theme';
import { track } from '../../lib/analytics';
import { getTourAnchor, onTourAnchorChange, setTourInfo, type TourAnchorName } from '../../lib/tourAnchors';

const WORDMARK = require('../../assets/auth/splash-wordmark.png');

const SCRIM = 'rgba(10,10,10,0.88)';
const BUBBLE_BG = '#151518';
const BUBBLE_BORDER = '#28282E';
const BUBBLE_W_MAX = 306;
const BUBBLE_H_EST = 196;      // hauteur estimée pour décider dessous/dessus
const MORPH_MS = 420;
const EASE = Easing.bezier(0.4, 0, 0.2, 1);

type Step = {
  screen: 'home' | 'lobby';
  anchor: TourAnchorName;
  fallbackAnchor?: TourAnchorName; // ex. slot absent (partie complète) → carte
  pad: number;
  radius: number;                  // 999 = cercle (pastille / FAB)
  place: 'below' | 'above';
  kicker: string; title: string; body: string;
  primary?: string; secondary?: string; // dernière étape (push)
};

const STEPS: Step[] = [
  { screen: 'home', anchor: 'home-profile', pad: 8, radius: 26, place: 'below',
    kicker: 'Ton profil', title: 'Ton niveau, c’est ta carte de visite',
    body: 'Il bouge à chaque match validé. Les parties te sont proposées à ce niveau.' },
  { screen: 'home', anchor: 'home-ctas', pad: 8, radius: 22, place: 'above',
    kicker: 'Deux entrées', title: 'Deux façons de jouer',
    body: 'Trouver un match : tu rejoins une partie ouverte. Match Défi : tu provoques un joueur. Commence par le jaune.' },
  { screen: 'lobby', anchor: 'lobby-card', pad: 8, radius: 22, place: 'below',
    kicker: 'Le lobby', title: 'Une partie, une carte',
    body: 'Heure, club, niveau, places libres : tout est là. « ✓ Mon niveau » = tu es dans la fourchette.' },
  { screen: 'lobby', anchor: 'lobby-slot', fallbackAnchor: 'lobby-card', pad: 10, radius: 18, place: 'below',
    kicker: 'Rejoindre', title: 'Prends la place libre',
    body: 'Tape l’emplacement en pointillés pour demander à rejoindre. Le créateur valide, la partie est à toi.' },
  { screen: 'lobby', anchor: 'tab-create', pad: 12, radius: 999, place: 'above',
    kicker: 'Créer', title: 'Rien à ton niveau ? Crée la tienne',
    body: 'Club, créneau, niveau : tu publies, les joueurs viennent à toi.' },
  { screen: 'lobby', anchor: 'bell-lobby', pad: 10, radius: 999, place: 'below',
    kicker: 'Dernière étape', title: 'Ne rate pas un défi',
    body: 'Place libérée, score à valider, défi reçu : la cloche te prévient, même app fermée.',
    primary: 'Activer les notifications', secondary: 'Plus tard' },
];

type Rect = { x: number; y: number; w: number; h: number; r: number };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

const ArrowRight = ({ size = 15, color = '#0A0A0A' }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
    <Line x1="5" y1="12" x2="19" y2="12" />
    <Path d="m13 6 6 6-6 6" />
  </Svg>
);

const IconX = ({ size = 14, color = '#8A8A92' }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
    <Line x1="18" y1="6" x2="6" y2="18" />
    <Line x1="6" y1="6" x2="18" y2="18" />
  </Svg>
);

// Rectangle de scrim animé : Animated.View positionnée + Pressable plein cadre
// (plus sûr que createAnimatedComponent(Pressable) pour des props de layout).
function ScrimRect({ style, onPress }: { style: Record<string, unknown>; onPress: (e: { nativeEvent: { pageX: number } }) => void }) {
  return (
    <Animated.View style={[{ position: 'absolute', backgroundColor: SCRIM }, style as any]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onPress} />
    </Animated.View>
  );
}

export default function GuidedTour({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { player } = usePlayer();
  const { width: W, height: H } = useWindowDimensions();

  const [step, setStep] = useState(0);
  const [fin, setFin] = useState(false);
  // null = pas répondu · true = accordées · false = refusées / plus tard
  const [push, setPush] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  // Rect (paddé + clampé) du spotlight courant — pilote la bulle et la zone tap.
  const [rect, setRect] = useState<Rect | null>(null);
  // Ancre introuvable après toutes les tentatives → bulle centrée, scrim plein.
  const [anchorMissing, setAnchorMissing] = useState(false);
  const [bubbleIn, setBubbleIn] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  const stepRef = useRef(step); stepRef.current = step;
  const finRef = useRef(fin); finRef.current = fin;
  const reduceMotionRef = useRef(false);
  const currentScreen = useRef<'home' | 'lobby'>('home');
  const overlayRef = useRef<View>(null);
  const overlayOrigin = useRef({ x: 0, y: 0 });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const measuredStepRef = useRef(-1);   // dernière étape mesurée avec succès
  const bubbleStepRef = useRef(-1);     // dernière étape dont la bulle est (re)entrée
  const lastTargetRef = useRef<Rect | null>(null);

  // Valeurs animées du spotlight (driver JS : on anime des props de layout).
  const ax = useRef(new Animated.Value(20)).current;
  const ay = useRef(new Animated.Value(H * 0.2)).current;
  const aw = useRef(new Animated.Value(W - 40)).current;
  const ah = useRef(new Animated.Value(200)).current;
  const ar = useRef(new Animated.Value(26)).current;
  const spotOpacity = useRef(new Animated.Value(0)).current;
  const bubbleA = useRef(new Animated.Value(0)).current;
  const pulseV = useRef(new Animated.Value(0)).current;
  // Bords dérivés (droite/bas du spotlight) — créés une fois, pas à chaque render.
  const aRight = useRef(Animated.add(ax, aw)).current;
  const aBottom = useRef(Animated.add(ay, ah)).current;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(v => {
      setReduceMotion(!!v); reduceMotionRef.current = !!v;
    });
  }, []);

  // Pulse — anneau secondaire, scale 1 → 1.09, opacité .55 → 0, 2 s, en boucle.
  useEffect(() => {
    if (reduceMotion || fin || anchorMissing) { pulseV.stopAnimation(); pulseV.setValue(0); return; }
    const loop = Animated.loop(
      Animated.timing(pulseV, { toValue: 1, duration: 2000, easing: Easing.out(Easing.ease), useNativeDriver: false }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, fin, anchorMissing, pulseV]);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const showBubble = useCallback(() => {
    if (bubbleStepRef.current === stepRef.current && !finRef.current) return;
    bubbleStepRef.current = stepRef.current;
    setBubbleIn(true);
    if (reduceMotionRef.current) { bubbleA.setValue(1); return; }
    // Entrée : translateY 8 → 0 + fade, 340 ms, après le début du morphing (délai 180 ms).
    Animated.timing(bubbleA, { toValue: 1, duration: 340, delay: 180, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: false }).start();
  }, [bubbleA]);

  const applyRect = useCallback((raw: { x: number; y: number; w: number; h: number }) => {
    const st = STEPS[stepRef.current];
    if (!st || finRef.current) return;
    const pad = st.pad;
    const x = clamp(raw.x - pad, 6, W - 30);
    const y = clamp(raw.y - pad, 6, H - 30);
    const w = clamp(raw.w + pad * 2, 24, W - x - 6);
    const h = clamp(raw.h + pad * 2, 24, H - y - 6);
    const r = st.radius >= 999 ? Math.round(Math.min(w, h) / 2) : st.radius + 4;
    const target: Rect = { x, y, w, h, r };
    const prev = lastTargetRef.current;
    const already = measuredStepRef.current === stepRef.current;
    if (already && prev
      && Math.abs(prev.x - x) < 0.6 && Math.abs(prev.y - y) < 0.6
      && Math.abs(prev.w - w) < 0.6 && Math.abs(prev.h - h) < 0.6) return;
    lastTargetRef.current = target;
    measuredStepRef.current = stepRef.current;
    setRect(target);
    setAnchorMissing(false);

    const firstEver = !prev;
    if (reduceMotionRef.current || firstEver) {
      // Reduce Motion : pas de morphing (saut direct). 1ʳᵉ mesure : pas d'origine d'où morpher.
      ax.setValue(x); ay.setValue(y); aw.setValue(w); ah.setValue(h); ar.setValue(r);
      Animated.timing(spotOpacity, { toValue: 1, duration: reduceMotionRef.current ? 0 : 220, useNativeDriver: false }).start();
    } else {
      Animated.parallel([
        Animated.timing(ax, { toValue: x, duration: MORPH_MS, easing: EASE, useNativeDriver: false }),
        Animated.timing(ay, { toValue: y, duration: MORPH_MS, easing: EASE, useNativeDriver: false }),
        Animated.timing(aw, { toValue: w, duration: MORPH_MS, easing: EASE, useNativeDriver: false }),
        Animated.timing(ah, { toValue: h, duration: MORPH_MS, easing: EASE, useNativeDriver: false }),
        Animated.timing(ar, { toValue: r, duration: MORPH_MS, easing: EASE, useNativeDriver: false }),
        Animated.timing(spotOpacity, { toValue: 1, duration: 220, useNativeDriver: false }),
      ]).start();
    }
    showBubble();
  }, [W, H, ax, ay, aw, ah, ar, spotOpacity, showBubble]);

  const measureNow = useCallback(() => {
    const st = STEPS[stepRef.current];
    if (!st || finRef.current) return;
    const view = getTourAnchor(st.anchor) ?? (st.fallbackAnchor ? getTourAnchor(st.fallbackAnchor) : null);
    const overlay = overlayRef.current;
    if (!view || !overlay) return;
    overlay.measureInWindow((ox, oy) => {
      overlayOrigin.current = { x: ox || 0, y: oy || 0 };
      (view as any).measureInWindow((x: number, y: number, w: number, h: number) => {
        if (!w || !h) return;
        applyRect({ x: x - (ox || 0), y: y - (oy || 0), w, h });
      });
    });
  }, [applyRect]);

  // Ancre qui (ré)apparaît (ex. cartes du lobby après fetch) → re-mesure.
  useEffect(() => onTourAnchorChange((name) => {
    const st = STEPS[stepRef.current];
    if (!finRef.current && st && (name === st.anchor || name === st.fallbackAnchor)) {
      requestAnimationFrame(measureNow);
    }
  }), [measureNow]);

  // Publie « visite active » : le lobby s'en sert pour afficher une carte
  // d'EXEMPLE quand il n'a aucune partie réelle — les étapes 3-4 (rejoindre)
  // s'enseignent toujours, lobby vide ou pas.
  useEffect(() => {
    setTourInfo('tour-active', true);
    track('tour_started');
    return () => setTourInfo('tour-active', false);
  }, []);

  // Entrée d'étape : cacher la bulle (120 ms), changer d'écran sous le scrim,
  // mesurer avec retries (le lobby peut charger ses cartes), sinon bulle centrée.
  useEffect(() => {
    if (fin) return;
    const st = STEPS[step];
    if (!st) return;
    clearTimers();
    setBubbleIn(false);
    setAnchorMissing(false);
    Animated.timing(bubbleA, { toValue: 0, duration: 120, useNativeDriver: false }).start();
    track('tour_step_viewed', { step: step + 1, anchor: st.anchor });

    if (currentScreen.current !== st.screen) {
      currentScreen.current = st.screen;
      router.navigate((st.screen === 'home' ? '/(tabs)' : '/(tabs)/lobby') as any);
    }

    [30, 180, 420, 800, 1400, 2200].forEach(d => {
      timers.current.push(setTimeout(measureNow, d));
    });
    // Abandon : ancre toujours absente (réseau lent) → scrim plein + bulle
    // centrée ; les listeners restent actifs, une ancre tardive corrige seule.
    timers.current.push(setTimeout(() => {
      if (measuredStepRef.current !== stepRef.current && !finRef.current) {
        setAnchorMissing(true);
        Animated.timing(spotOpacity, { toValue: 0, duration: 160, useNativeDriver: false }).start();
        showBubble();
      }
    }, 2600));
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, fin]);

  const goTo = useCallback((n: number) => {
    if (busy || finRef.current) return;
    if (n >= STEPS.length) return; // la sortie passe par finish()/primary
    setStep(clamp(n, 0, STEPS.length - 1));
  }, [busy]);

  const goBack = useCallback(() => { if (stepRef.current > 0) goTo(stepRef.current - 1); }, [goTo]);

  const finish = useCallback((reason: 'completed' | 'skipped', pushState: boolean | null) => {
    clearTimers();
    setPush(pushState);
    setFin(true);
    setBubbleIn(false);
    AsyncStorage.setItem(GUIDE_KEY, '1');
    if (reason === 'skipped') track('tour_skipped', { at_step: stepRef.current + 1 });
    else track('tour_completed', { push: pushState });
  }, []);

  // Étape 6 : le prompt OS n'est demandé qu'au tap sur « Activer les notifications ».
  const requestPush = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = player?.id ? await registerForPushAsync(player.id) : 'skipped';
      finish('completed', res === 'granted');
    } finally {
      setBusy(false);
    }
  }, [busy, player?.id, finish]);

  const isLast = step === STEPS.length - 1;
  const st = STEPS[step];

  const advance = useCallback(() => {
    if (stepRef.current === STEPS.length - 1) { requestPush(); return; }
    goTo(stepRef.current + 1);
  }, [goTo, requestPush]);

  // Reculer : swipe droite (dx > 52). Capture au MOUVEMENT (les scrims/zone tap
  // sont des Pressable enfants qui prennent le touch au départ — sans capture,
  // le parent ne verrait jamais le geste) ; un tap sans déplacement passe aux enfants.
  const goBackRef = useRef(goBack); goBackRef.current = goBack;
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
    onPanResponderRelease: (_e, g) => { if (g.dx > 52) goBackRef.current(); },
  })).current;

  // Tap hors zone, à gauche du spotlight → reculer.
  const onScrimPress = useCallback((e: { nativeEvent: { pageX: number } }) => {
    const r = lastTargetRef.current;
    if (!r || measuredStepRef.current !== stepRef.current) return;
    const px = e.nativeEvent.pageX - overlayOrigin.current.x;
    if (px < r.x) goBack();
  }, [goBack]);

  const restart = useCallback(() => {
    // L'effet d'étape dépend de [step, fin] → il se relance dès que fin repasse
    // à false, même si step est déjà 0 (re-navigation + re-mesure incluses).
    setFin(false); setPush(null);
    bubbleStepRef.current = -1;
    measuredStepRef.current = -1;
    setStep(0);
    track('tour_replayed');
  }, []);

  const exitToLobby = useCallback(() => {
    currentScreen.current = 'lobby';
    router.navigate('/(tabs)/lobby' as any);
    onDone();
  }, [router, onDone]);

  // ── Géométrie bulle ──────────────────────────────────────────────
  // Dernière étape : bulle élargie + actions empilées (le libellé « Activer
  // les notifications » ne tient pas sur la ligne dots/Plus tard en 306 px).
  const bw = Math.min(isLast ? 344 : BUBBLE_W_MAX, W - 28);
  let bubbleLeft = (W - bw) / 2;
  let bubbleTop: number | undefined;
  let bubbleBottom: number | undefined;
  let arrowLeft = bw / 2 - 7;
  let placeResolved: 'below' | 'above' | 'center' = 'center';
  const bubbleHEst = isLast ? 264 : BUBBLE_H_EST; // dernière étape : actions empilées, bulle plus haute
  if (!anchorMissing && rect && measuredStepRef.current === step) {
    const cx = rect.x + rect.w / 2;
    bubbleLeft = clamp(Math.round(cx - bw / 2), 14, W - 14 - bw);
    let place = st.place;
    if (place === 'below' && rect.y + rect.h + 14 + bubbleHEst > H - 44) place = 'above';
    if (place === 'above' && rect.y - 14 - bubbleHEst < insets.top + 7) place = 'below';
    placeResolved = place;
    if (place === 'below') bubbleTop = rect.y + rect.h + 14;
    else bubbleBottom = H - rect.y + 14;
    // Flèche collée au bord, alignée sur le centre de l'ancre, bornée à 18 px des coins.
    arrowLeft = clamp(Math.round(cx - bubbleLeft - 7), 18, bw - 32);
  } else {
    bubbleTop = H * 0.4;
  }

  const nextLabel = isLast ? (st.primary ?? 'Terminer') : (step === 0 ? 'C’est parti' : 'Suivant');

  const pulseScale = pulseV.interpolate({ inputRange: [0, 1], outputRange: [1, 1.09] });
  const pulseOpacity = pulseV.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.55, 0, 0] });

  // ── Écran de fin ─────────────────────────────────────────────────
  if (fin) {
    const chip = push === true
      ? { label: 'Notifications activées', bg: 'rgba(16,185,129,0.12)', bd: 'rgba(16,185,129,0.45)', fg: '#34D399' }
      : push === false
        ? { label: 'Notifications à activer plus tard', bg: 'rgba(255,193,26,0.12)', bd: 'rgba(255,193,26,0.45)', fg: Colors.brand }
        : { label: 'Visite terminée', bg: 'rgba(255,193,26,0.12)', bd: 'rgba(255,193,26,0.45)', fg: Colors.brand };
    return (
      <View style={[StyleSheet.absoluteFill, { zIndex: 1000, backgroundColor: Colors.bgDark, overflow: 'hidden' }]}>
        <StatusBar style="light" animated />
        <View style={{ position: 'absolute', top: -90, right: -70, width: 280, height: 280, borderRadius: 140, backgroundColor: 'rgba(255,193,26,0.13)' }} />
        <View style={{ position: 'absolute', bottom: -120, left: -90, width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(255,193,26,0.05)' }} />
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 30 }}>
          <Image source={WORDMARK} style={{ width: 186, height: 42, resizeMode: 'contain', marginBottom: 26, alignSelf: 'flex-start' }} />
          <View style={{ flexDirection: 'row', marginBottom: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: chip.bg, borderWidth: 1, borderColor: chip.bd, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11 }}>
              <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 9.5, letterSpacing: 1.2, textTransform: 'uppercase', color: chip.fg }}>
                {chip.label}
              </Text>
            </View>
          </View>
          <Text style={{ fontFamily: Fonts.welcome, fontSize: 34, lineHeight: 38, textTransform: 'uppercase', color: '#fff', letterSpacing: 0.5 }}>
            Ta première partie{'\n'}t’attend au <Text style={{ color: Colors.brand }}>lobby</Text>
          </Text>
          <Text style={{ marginTop: 14, fontFamily: Fonts.ui, fontSize: 14, lineHeight: 21, color: '#8A8A92', maxWidth: 290 }}>
            Tu sais rejoindre une partie et créer la tienne. Le reste s’explique dans le guide « ? », en haut de l’écran.
          </Text>
          <View style={{ marginTop: 26, gap: 10 }}>
            <Pressable onPress={exitToLobby} style={{ height: 54, borderRadius: 999, backgroundColor: Colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 15.5, color: Colors.textOnBrand }}>Voir les parties ouvertes</Text>
              <ArrowRight size={18} />
            </Pressable>
            <Pressable onPress={restart} style={{ height: 50, borderRadius: 999, borderWidth: 1, borderColor: BUBBLE_BORDER, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: Fonts.uiBold, fontSize: 13.5, color: '#8A8A92' }}>Revoir la visite</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // ── Overlay spotlight ────────────────────────────────────────────
  return (
    <View ref={overlayRef} collapsable={false} style={[StyleSheet.absoluteFill, { zIndex: 1000, overflow: 'hidden' }]}>
      <StatusBar style="light" animated />
      <View style={StyleSheet.absoluteFill} {...pan.panHandlers}>
        {anchorMissing ? (
          <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,10,0.93)' }]} onPress={onScrimPress} />
        ) : (
          <>
            {/* Scrim — 4 rectangles autour du spotlight (haut / bas / gauche / droite). */}
            <ScrimRect style={{ left: 0, right: 0, top: 0, height: ay }} onPress={onScrimPress} />
            <ScrimRect style={{ left: 0, right: 0, top: aBottom, height: H }} onPress={onScrimPress} />
            <ScrimRect style={{ left: 0, top: ay, width: ax, height: ah }} onPress={onScrimPress} />
            <ScrimRect style={{ left: aRight, top: ay, width: W, height: ah }} onPress={onScrimPress} />

            {/* Anneau spotlight (+ halo iOS via shadow). */}
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute', left: ax, top: ay, width: aw, height: ah,
                borderRadius: ar, borderWidth: 2, borderColor: Colors.brand,
                opacity: spotOpacity,
                shadowColor: Colors.brand, shadowOpacity: 0.42, shadowRadius: 15,
                shadowOffset: { width: 0, height: 0 },
              }}
            />
            {!reduceMotion && (
              <Animated.View
                pointerEvents="none"
                style={{
                  position: 'absolute', left: ax, top: ay, width: aw, height: ah,
                  borderRadius: ar, borderWidth: 2, borderColor: Colors.brand,
                  opacity: Animated.multiply(spotOpacity, pulseOpacity),
                  transform: [{ scale: pulseScale }],
                }}
              />
            )}

            {/* Zone tap = avancer (ne déclenche pas l'action réelle de l'écran). */}
            {rect && measuredStepRef.current === step && (
              <Pressable
                onPress={advance}
                style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, borderRadius: rect.r }}
              />
            )}
          </>
        )}
      </View>

      {/* Bulle */}
      <Animated.View
        pointerEvents={bubbleIn ? 'auto' : 'none'}
        style={{
          position: 'absolute', left: bubbleLeft, width: bw,
          ...(bubbleTop != null ? { top: bubbleTop } : {}),
          ...(bubbleBottom != null ? { bottom: bubbleBottom } : {}),
          backgroundColor: BUBBLE_BG, borderWidth: 1, borderColor: BUBBLE_BORDER,
          borderRadius: 20, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14,
          opacity: bubbleA,
          transform: [{ translateY: bubbleA.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
          shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 22, shadowOffset: { width: 0, height: 22 },
          elevation: 16,
        }}
      >
        {placeResolved === 'below' && (
          <View style={{ position: 'absolute', top: -7, left: arrowLeft, width: 14, height: 14, backgroundColor: BUBBLE_BG, borderLeftWidth: 1, borderTopWidth: 1, borderColor: BUBBLE_BORDER, transform: [{ rotate: '45deg' }], borderTopLeftRadius: 3 }} />
        )}
        {placeResolved === 'above' && (
          <View style={{ position: 'absolute', bottom: -7, left: arrowLeft, width: 14, height: 14, backgroundColor: BUBBLE_BG, borderRightWidth: 1, borderBottomWidth: 1, borderColor: BUBBLE_BORDER, transform: [{ rotate: '45deg' }], borderBottomRightRadius: 3 }} />
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 9 }}>
          <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 9.5, letterSpacing: 1.6, textTransform: 'uppercase', color: Colors.brand }}>
            {st.kicker}
          </Text>
          <View style={{ flex: 1 }} />
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10, letterSpacing: 0.6, color: '#5D5D66' }}>
            {step + 1}/{STEPS.length}
          </Text>
        </View>
        <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 17, lineHeight: 21, letterSpacing: -0.2, color: '#fff', marginBottom: 6 }}>
          {st.title}
        </Text>
        <Text style={{ fontFamily: Fonts.ui, fontSize: 13, lineHeight: 19, color: 'rgba(255,255,255,0.72)' }}>
          {st.body}
        </Text>

        {isLast ? (
          // Dernière étape : actions empilées — le bouton push pleine largeur
          // tient toujours dans la bulle, « Plus tard » discret en dessous.
          <View style={{ marginTop: 15 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              {STEPS.map((_s, k) => (
                <View key={k} style={{
                  height: 5, borderRadius: 999,
                  width: k === step ? 18 : 6,
                  backgroundColor: k === step ? Colors.brand : (k < step ? '#57575F' : '#3A3A42'),
                }} />
              ))}
            </View>
            <Pressable
              onPress={advance}
              disabled={busy}
              style={{ marginTop: 13, height: 46, borderRadius: 999, backgroundColor: Colors.brand,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, opacity: busy ? 0.6 : 1 }}
            >
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13.5, color: Colors.textOnBrand }}>{nextLabel}</Text>
              <ArrowRight />
            </Pressable>
            <Pressable onPress={() => finish('completed', false)} hitSlop={6} style={{ marginTop: 6, paddingVertical: 8, alignItems: 'center' }}>
              <Text style={{ fontFamily: Fonts.uiBold, fontSize: 12.5, color: '#5D5D66' }}>{st.secondary ?? 'Plus tard'}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 15 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              {STEPS.map((_s, k) => (
                <View key={k} style={{
                  height: 5, borderRadius: 999,
                  width: k === step ? 18 : 6,
                  backgroundColor: k === step ? Colors.brand : (k < step ? '#57575F' : '#3A3A42'),
                }} />
              ))}
            </View>
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={advance}
              disabled={busy}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.brand, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16, opacity: busy ? 0.6 : 1 }}
            >
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: Colors.textOnBrand }}>{nextLabel}</Text>
              <ArrowRight />
            </Pressable>
          </View>
        )}
      </Animated.View>

      {/* « ✕ Passer la visite » — ancrée bas-gauche, hors bulle, sortie toujours
          visible et côté pouce ; à gauche pour ne jamais couvrir le spotlight du ⊕.
          À la dernière étape, le « Plus tard » de la bulle prend le relais. */}
      {!isLast && (
        <Pressable
          onPress={() => finish('skipped', null)}
          style={{
            position: 'absolute', left: 14, bottom: insets.bottom + 24,
            flexDirection: 'row', alignItems: 'center', gap: 7,
            borderWidth: 1, borderColor: '#3A3A42', backgroundColor: 'rgba(21,21,24,0.94)',
            borderRadius: 999, paddingVertical: 12, paddingHorizontal: 18,
            shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 10, shadowOffset: { width: 0, height: 10 },
            elevation: 10,
          }}
        >
          <IconX />
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: '#fff' }}>Passer la visite</Text>
        </Pressable>
      )}
    </View>
  );
}
