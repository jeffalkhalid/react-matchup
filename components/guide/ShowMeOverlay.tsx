// « Me montrer sur l'écran » — la passerelle du guide d'aide vers la visite.
// La feuille d'aide se referme, l'app navigue vers l'écran de la rubrique, et UN
// SEUL spotlight se pose sur l'ancre (même langage que components/tour/GuidedTour :
// scrim 4 rectangles, anneau jaune, pulse 2 s, bulle #151518 — toujours en sombre).
// Pas de 1/6 : on montre l'ancre demandée, puis « C'est compris » rend la main.
// Le flag matchup_guide_rn_v1 n'est JAMAIS touché ici.
//
// L'ancre est MESURÉE à l'exécution (jamais en dur) via lib/tourAnchors, avec
// retries — le lobby peut charger ses cartes. Introuvable après 2,6 s → bulle
// centrée sur scrim plein (même dégradé d'échec que la visite guidée).
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, useWindowDimensions, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Svg, { Line, Path } from 'react-native-svg';
import { Colors, Fonts } from '../../lib/theme';
import { getTourAnchor, onTourAnchorChange, setTourInfo } from '../../lib/tourAnchors';
import type { ShowMeSpec } from './help/data';

const SCRIM = 'rgba(10,10,10,0.88)';
const BUBBLE_BG = '#151518';
const BUBBLE_BORDER = '#28282E';
const BUBBLE_W = 306;
const BUBBLE_H_EST = 190;

type Rect = { x: number; y: number; w: number; h: number; r: number };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

const ArrowLeft = ({ size = 15, color = '#fff' }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
    <Path d="m12 19-7-7 7-7" />
    <Line x1="19" y1="12" x2="5" y2="12" />
  </Svg>
);

export default function ShowMeOverlay({ spec, onBack, onDone }: {
  spec: ShowMeSpec;
  onBack: () => void;   // « Revenir au guide » — rouvre la feuille sur la rubrique
  onDone: () => void;   // « C'est compris » — rend la main à l'écran
}) {
  const { width: W, height: H } = useWindowDimensions();
  const [rect, setRect] = useState<Rect | null>(null);
  const [missing, setMissing] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const measured = useRef(false);
  const overlayRef = useRef<View>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const fade = useRef(new Animated.Value(0)).current;
  const pulseV = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(v => setReduceMotion(!!v));
  }, []);

  // Comme la visite : publie « tour-active » pour que le lobby affiche sa carte
  // d'EXEMPLE quand il n'a aucune partie réelle — l'ancre existe toujours.
  useEffect(() => {
    setTourInfo('tour-active', true);
    return () => setTourInfo('tour-active', false);
  }, []);

  const measureNow = useCallback(() => {
    const view = getTourAnchor(spec.anchor)
      ?? (spec.fallbackAnchor ? getTourAnchor(spec.fallbackAnchor) : null);
    const overlay = overlayRef.current;
    if (!view || !overlay) return;
    // Coordonnées relatives à l'overlay (comme GuidedTour) — l'overlay remplit
    // normalement la fenêtre, mais on ne parie pas dessus.
    overlay.measureInWindow((ox, oy) => {
      (view as any).measureInWindow((x: number, y: number, w: number, h: number) => {
        if (!w || !h) return;
        const pad = spec.pad;
        const rx = clamp(x - (ox || 0) - pad, 6, W - 30);
        const ry = clamp(y - (oy || 0) - pad, 6, H - 30);
        const rw = clamp(w + pad * 2, 24, W - rx - 6);
        const rh = clamp(h + pad * 2, 24, H - ry - 6);
        const rr = spec.radius >= 999 ? Math.round(Math.min(rw, rh) / 2) : spec.radius + 4;
        measured.current = true;
        setMissing(false);
        setRect({ x: rx, y: ry, w: rw, h: rh, r: rr });
      });
    });
  }, [spec, W, H]);

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: false }).start();
    [30, 180, 420, 800, 1400, 2200].forEach(d => {
      timers.current.push(setTimeout(measureNow, d));
    });
    timers.current.push(setTimeout(() => {
      if (!measured.current) setMissing(true);
    }, 2600));
    return () => { timers.current.forEach(clearTimeout); timers.current = []; };
  }, [measureNow, fade]);

  // Ancre qui (ré)apparaît (cartes du lobby après fetch) → re-mesure.
  useEffect(() => onTourAnchorChange((name) => {
    if (name === spec.anchor || name === spec.fallbackAnchor) {
      requestAnimationFrame(measureNow);
    }
  }), [spec, measureNow]);

  // Pulse — anneau secondaire 2 s, coupé si Reduce Motion.
  useEffect(() => {
    if (reduceMotion || !rect) { pulseV.stopAnimation(); pulseV.setValue(0); return; }
    const loop = Animated.loop(
      Animated.timing(pulseV, { toValue: 1, duration: 2000, easing: Easing.out(Easing.ease), useNativeDriver: false }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, rect, pulseV]);

  const pulseScale = pulseV.interpolate({ inputRange: [0, 1], outputRange: [1, 1.09] });
  const pulseOpacity = pulseV.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.55, 0, 0] });

  // ── Géométrie de la bulle (dessous par défaut, bascule si ça déborde) ──
  const bw = Math.min(BUBBLE_W, W - 28);
  let bubbleLeft = (W - bw) / 2;
  let bubbleTop: number | undefined;
  let bubbleBottom: number | undefined;
  let arrowLeft = bw / 2 - 7;
  let placeResolved: 'below' | 'above' | 'center' = 'center';
  if (rect && !missing) {
    const cx = rect.x + rect.w / 2;
    bubbleLeft = clamp(Math.round(cx - bw / 2), 14, W - 14 - bw);
    let place = spec.place;
    if (place === 'below' && rect.y + rect.h + 14 + BUBBLE_H_EST > H - 44) place = 'above';
    if (place === 'above' && rect.y - 14 - BUBBLE_H_EST < 40) place = 'below';
    placeResolved = place;
    if (place === 'below') bubbleTop = rect.y + rect.h + 14;
    else bubbleBottom = H - rect.y + 14;
    arrowLeft = clamp(Math.round(cx - bubbleLeft - 7), 18, bw - 32);
  } else {
    bubbleTop = H * 0.38;
  }

  return (
    <Animated.View ref={overlayRef as any} collapsable={false}
      style={[StyleSheet.absoluteFill, { zIndex: 1000, opacity: fade, overflow: 'hidden' }]}>
      <StatusBar style="light" animated />
      {rect && !missing ? (
        <>
          {/* Scrim — 4 rectangles autour du spotlight. Tap dehors = C'est compris. */}
          <Pressable onPress={onDone} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: rect.y, backgroundColor: SCRIM }} />
          <Pressable onPress={onDone} style={{ position: 'absolute', left: 0, right: 0, top: rect.y + rect.h, bottom: 0, backgroundColor: SCRIM }} />
          <Pressable onPress={onDone} style={{ position: 'absolute', left: 0, top: rect.y, width: rect.x, height: rect.h, backgroundColor: SCRIM }} />
          <Pressable onPress={onDone} style={{ position: 'absolute', left: rect.x + rect.w, right: 0, top: rect.y, height: rect.h, backgroundColor: SCRIM }} />

          {/* Anneau + pulse */}
          <View pointerEvents="none" style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h,
            borderRadius: rect.r, borderWidth: 2, borderColor: Colors.brand,
            shadowColor: Colors.brand, shadowOpacity: 0.42, shadowRadius: 15, shadowOffset: { width: 0, height: 0 } }} />
          {!reduceMotion && (
            <Animated.View pointerEvents="none" style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h,
              borderRadius: rect.r, borderWidth: 2, borderColor: Colors.brand,
              opacity: pulseOpacity, transform: [{ scale: pulseScale }] }} />
          )}

          {/* Tap sur la zone = compris (jamais l'action réelle). */}
          <Pressable onPress={onDone}
            style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, borderRadius: rect.r }} />
        </>
      ) : (
        <Pressable onPress={onDone} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,10,0.93)' }]} />
      )}

      {/* Bulle — n'apparaît qu'une fois la cible connue (mesurée ou déclarée absente). */}
      {(rect || missing) && (
        <View style={{ position: 'absolute', left: bubbleLeft, width: bw,
          ...(bubbleTop != null ? { top: bubbleTop } : {}),
          ...(bubbleBottom != null ? { bottom: bubbleBottom } : {}),
          backgroundColor: BUBBLE_BG, borderWidth: 1, borderColor: BUBBLE_BORDER,
          borderRadius: 20, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14,
          shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 22, shadowOffset: { width: 0, height: 22 },
          elevation: 16 }}>
          {placeResolved === 'below' && (
            <View style={{ position: 'absolute', top: -7, left: arrowLeft, width: 14, height: 14, backgroundColor: BUBBLE_BG,
              borderLeftWidth: 1, borderTopWidth: 1, borderColor: BUBBLE_BORDER, transform: [{ rotate: '45deg' }], borderTopLeftRadius: 3 }} />
          )}
          {placeResolved === 'above' && (
            <View style={{ position: 'absolute', bottom: -7, left: arrowLeft, width: 14, height: 14, backgroundColor: BUBBLE_BG,
              borderRightWidth: 1, borderBottomWidth: 1, borderColor: BUBBLE_BORDER, transform: [{ rotate: '45deg' }], borderBottomRightRadius: 3 }} />
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 9 }}>
            <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 9.5, letterSpacing: 1.6, textTransform: 'uppercase', color: Colors.brand }}>
              {spec.kicker}
            </Text>
            <View style={{ flex: 1 }} />
            <View style={{ borderWidth: 1, borderColor: 'rgba(255,193,26,0.45)', backgroundColor: 'rgba(255,193,26,0.10)',
              borderRadius: 999, paddingVertical: 2, paddingHorizontal: 7 }}>
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 8, letterSpacing: 0.6, textTransform: 'uppercase', color: Colors.brand }}>
                Rejoué depuis le guide
              </Text>
            </View>
          </View>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 17, lineHeight: 21, letterSpacing: -0.2, color: '#fff', marginBottom: 6 }}>
            {spec.title}
          </Text>
          <Text style={{ fontFamily: Fonts.ui, fontSize: 13, lineHeight: 19, color: 'rgba(255,255,255,0.72)' }}>
            {spec.body}
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 15 }}>
            <Pressable onPress={onBack}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#3A3A42',
                backgroundColor: '#202026', borderRadius: 999, paddingVertical: 10, paddingHorizontal: 14 }}>
              <ArrowLeft size={14} color="#8A8A92" />
              <Text style={{ fontFamily: Fonts.uiBold, fontSize: 12.5, color: '#fff' }}>Revenir au guide</Text>
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onDone}
              style={{ backgroundColor: Colors.brand, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16 }}>
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: Colors.textOnBrand }}>C'est compris</Text>
            </Pressable>
          </View>
        </View>
      )}
    </Animated.View>
  );
}
