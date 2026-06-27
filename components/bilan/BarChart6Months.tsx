import { View, Text } from 'react-native';
import { Fonts } from '../../lib/theme';

// Bar chart 6 mois — barres translucides, dernière (mois courant) en jaune
// avec sa valeur en pop (fidèle au design). Rendu en Views (pas de SVG requis).
export function BarChart6Months({ data, height = 120 }: {
  data: { label: string; matches: number }[]; height?: number;
}) {
  if (data.length === 0) return null;
  const max = Math.max(1, ...data.map(d => d.matches));
  const last = data.length - 1;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, height: height + 22 }}>
      {data.map((d, i) => {
        const isLast = i === last;
        const h = Math.max(4, Math.round((d.matches / max) * height));
        return (
          <View key={i} style={{ flex: 1, alignItems: 'center' }}>
            <View style={{ height: 18, justifyContent: 'flex-end' }}>
              {isLast && d.matches > 0 ? (
                <View style={{ backgroundColor: '#FFC11A', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, marginBottom: 4 }}>
                  <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 10, color: '#0A0A0A' }}>{d.matches}</Text>
                </View>
              ) : null}
            </View>
            <View style={{ width: '100%', height: h, borderTopLeftRadius: 6, borderTopRightRadius: 6, backgroundColor: isLast ? '#FFC11A' : 'rgba(255,255,255,0.18)' }} />
            <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 9.5, color: isLast ? '#FFFFFF' : 'rgba(255,255,255,0.55)', fontWeight: isLast ? '800' : '400', marginTop: 6 }}>{d.label}</Text>
          </View>
        );
      })}
    </View>
  );
}
