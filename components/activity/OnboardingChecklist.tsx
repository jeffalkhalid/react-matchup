import { View, Text, TouchableOpacity } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { Colors, Fonts } from '../../lib/theme';

export type OnboardingStep = { label: string; hint?: string; done: boolean; onPress: () => void };

// Checklist interactive + auto-cochée (barre de progression X/N).
export function OnboardingChecklist({ steps }: { steps: OnboardingStep[] }) {
  const done = steps.filter(s => s.done).length;
  const pct = Math.round((done / Math.max(1, steps.length)) * 100);
  return (
    <View style={{ backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, padding: 16, marginTop: 14, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontFamily: Fonts.welcome, fontSize: 16, color: Colors.textPrimary }}>Tes premiers pas</Text>
        <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: Colors.textSecondary }}>{done}/{steps.length}</Text>
      </View>
      {/* progress bar */}
      <View style={{ height: 6, borderRadius: 999, backgroundColor: Colors.bg, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: 6, backgroundColor: Colors.success, borderRadius: 999 }} />
      </View>

      {steps.map((s, i) => (
        <TouchableOpacity key={i} onPress={s.onPress} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {/* check circle */}
          <View style={{
            width: 24, height: 24, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
            backgroundColor: s.done ? Colors.success : 'transparent',
            borderWidth: s.done ? 0 : 2, borderColor: Colors.border,
          }}>
            {s.done ? (
              <Svg width={13} height={13} viewBox="0 0 24 24"><Polyline points="20 6 9 17 4 12" fill="none" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" /></Svg>
            ) : null}
          </View>
          <Text style={{ flex: 1, fontFamily: Fonts.uiSemi, fontSize: 14, color: s.done ? Colors.textMuted : Colors.textPrimary, textDecorationLine: s.done ? 'line-through' : 'none' }}>{s.label}</Text>
          {s.hint && !s.done ? (
            <View style={{ backgroundColor: Colors.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
              <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 10, color: Colors.textSecondary }}>{s.hint}</Text>
            </View>
          ) : !s.done ? (
            <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 16, color: Colors.textMuted }}>›</Text>
          ) : null}
        </TouchableOpacity>
      ))}
    </View>
  );
}
