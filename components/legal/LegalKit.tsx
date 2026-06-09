// Kit d'UI pour les écrans légaux (politique de confidentialité, CGU).
// Thème clair (fond app) + hero sombre en tête, cartes numérotées à icône,
// tags, sous-traitants et encadrés colorés. Pas de bloc « En bref ».
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../lib/theme';

export function LegalLayout({ kicker, title, sub, updated, children }: {
  kicker: string; title: string; sub: string; updated: string; children: React.ReactNode;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {/* Hero sombre */}
      <View style={[s.hero, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} activeOpacity={0.7} style={s.back}>
          <Text style={s.backTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={s.kicker}>{kicker}</Text>
        <Text style={s.title}>{title}</Text>
        <Text style={s.sub}>{sub}</Text>
        <View style={s.badge}>
          <View style={s.badgeDot} />
          <Text style={s.badgeTxt}>À jour le {updated}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 44 }} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </View>
  );
}

export function Section({ n, icon, title, children }: {
  n: number; icon: string; title: string; children: React.ReactNode;
}) {
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <View style={s.chip}><Text style={{ fontSize: 15 }}>{icon}</Text></View>
        <Text style={s.h2}>{n}. {title}</Text>
      </View>
      {children}
    </View>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return <Text style={s.p}>{children}</Text>;
}

export function B({ children }: { children: React.ReactNode }) {
  return <Text style={s.b}>{children}</Text>;
}

export function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View style={s.liRow}>
      <View style={s.dot} />
      <Text style={s.liTxt}>{children}</Text>
    </View>
  );
}

export function Tags({ items }: { items: string[] }) {
  return (
    <View style={s.tags}>
      {items.map((t) => (
        <View key={t} style={s.tag}><Text style={s.tagTxt}>{t}</Text></View>
      ))}
    </View>
  );
}

export function SubRow({ letter, color, name, role }: { letter: string; color: string; name: string; role: string }) {
  return (
    <View style={s.subBox}>
      <View style={[s.subLogo, { backgroundColor: color + '22', borderColor: color + '55' }]}>
        <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color }}>{letter}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.subName}>{name}</Text>
        <Text style={s.subRole}>{role}</Text>
      </View>
    </View>
  );
}

export function Callout({ icon, tone = 'info', children }: {
  icon: string; tone?: 'info' | 'warn'; children: React.ReactNode;
}) {
  const accent = tone === 'warn' ? Colors.brand : Colors.info;
  return (
    <View style={[s.callout, { backgroundColor: accent + '12', borderColor: accent + '40', borderLeftColor: accent }]}>
      <Text style={{ fontSize: 18 }}>{icon}</Text>
      <Text style={[s.p, { marginTop: 0, flex: 1 }]}>{children}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  hero: { backgroundColor: Colors.heroBg, paddingHorizontal: 20, paddingBottom: 26 },
  back: { width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  backTxt: { fontSize: 22, color: '#FFFFFF', marginTop: -2 },
  kicker: { fontSize: 12, fontFamily: Fonts.uiBlack, color: Colors.brand, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  title: { fontSize: 28, color: '#FFFFFF', fontFamily: Fonts.uiBlack, letterSpacing: -0.5, lineHeight: 32 },
  sub: { fontSize: 14, color: '#A1A1AA', fontFamily: Fonts.ui, marginTop: 10, lineHeight: 20 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', marginTop: 16, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  badgeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.success },
  badgeTxt: { fontSize: 12, color: '#D4D4D8', fontFamily: Fonts.ui },

  card: { backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, padding: 18, marginBottom: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  chip: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.brand + '1A', borderWidth: 1, borderColor: Colors.brand + '4D' },
  h2: { flex: 1, fontSize: 16, color: Colors.textPrimary, fontFamily: Fonts.uiBold },

  p: { fontSize: 14, lineHeight: 21, color: Colors.textSecondary, fontFamily: Fonts.ui, marginTop: 8 },
  b: { color: Colors.textPrimary, fontFamily: Fonts.uiBold },

  liRow: { flexDirection: 'row', gap: 9, marginTop: 9, paddingRight: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.brand, marginTop: 8 },
  liTxt: { flex: 1, fontSize: 14, lineHeight: 21, color: Colors.textSecondary, fontFamily: Fonts.ui },

  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  tag: { backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  tagTxt: { fontSize: 12.5, color: Colors.textPrimary, fontFamily: Fonts.uiSemi },

  subBox: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 10, backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  subLogo: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  subName: { fontSize: 14, color: Colors.textPrimary, fontFamily: Fonts.uiBold },
  subRole: { fontSize: 12, color: Colors.textMuted, fontFamily: Fonts.ui, marginTop: 1 },

  callout: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: 14, borderWidth: 1, borderLeftWidth: 3, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13 },
});
