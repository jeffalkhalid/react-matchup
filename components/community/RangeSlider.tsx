// Slider à deux curseurs (min/max) — sans dépendance, via PanResponder.
import React, { useRef, useState } from 'react';
import { View, PanResponder } from 'react-native';
import { Colors } from '../../lib/theme';

export function RangeSlider({ lo, hi, min, max, step, onChange }: {
  lo: number; hi: number; min: number; max: number; step: number;
  onChange: (lo: number, hi: number) => void;
}) {
  const [w, setW] = useState(0);
  const wRef = useRef(0); wRef.current = w;
  const loRef = useRef(lo); loRef.current = lo;
  const hiRef = useRef(hi); hiRef.current = hi;
  const start = useRef({ lo, hi });
  const cb = useRef(onChange); cb.current = onChange;
  const range = max - min;

  const snap = (x: number) => Math.round(x / step) * step;
  const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

  // PanResponders créés une seule fois (stables pendant le geste) ; ils lisent
  // les dernières valeurs via les refs.
  const loPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { start.current = { lo: loRef.current, hi: hiRef.current }; },
    onPanResponderMove: (_, g) => {
      if (wRef.current <= 0) return;
      const v = clamp(snap(start.current.lo + (g.dx / wRef.current) * range), min, hiRef.current - step);
      cb.current(v, hiRef.current);
    },
  })).current;

  const hiPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { start.current = { lo: loRef.current, hi: hiRef.current }; },
    onPanResponderMove: (_, g) => {
      if (wRef.current <= 0) return;
      const v = clamp(snap(start.current.hi + (g.dx / wRef.current) * range), loRef.current + step, max);
      cb.current(loRef.current, v);
    },
  })).current;

  const T = 26; // taille du curseur
  const loPct = range > 0 ? (lo - min) / range : 0;
  const hiPct = range > 0 ? (hi - min) / range : 0;

  return (
    <View onLayout={e => setW(e.nativeEvent.layout.width)} style={{ height: 40, justifyContent: 'center' }}>
      {/* rail */}
      <View style={{ height: 6, borderRadius: 3, backgroundColor: Colors.border }} />
      {/* plage active */}
      {w > 0 && (
        <View style={{
          position: 'absolute', height: 6, borderRadius: 3, backgroundColor: Colors.brand,
          left: loPct * w, width: Math.max(0, (hiPct - loPct) * w),
        }} />
      )}
      {/* curseur min */}
      <View {...loPan.panHandlers} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
        style={[THUMB, { left: loPct * w - T / 2 }]} />
      {/* curseur max */}
      <View {...hiPan.panHandlers} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
        style={[THUMB, { left: hiPct * w - T / 2 }]} />
    </View>
  );
}

const THUMB = {
  position: 'absolute' as const, width: 26, height: 26, borderRadius: 13,
  backgroundColor: '#fff', borderWidth: 2, borderColor: Colors.brand,
  shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 3,
  shadowOffset: { width: 0, height: 1 }, elevation: 3,
};
