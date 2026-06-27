import { View, TouchableOpacity, Text } from 'react-native';
import { Fonts } from '../../lib/theme';

// Rangée de pills (PAS un ScrollView : évite l'étirement vertical des pills
// quand le parent est centré). Wrap si l'historique dépasse une ligne.
export function MonthPicker({ months, current, onPick }: {
  months: { key: string; label: string }[]; current: string; onPick: (key: string) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
      {months.map(m => {
        const on = m.key === current;
        return (
          <TouchableOpacity key={m.key} onPress={() => onPick(m.key)} activeOpacity={0.85}
            style={{ borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5, borderWidth: 1.5, borderColor: '#0A0A0A', backgroundColor: on ? '#0A0A0A' : 'rgba(255,255,255,0.35)' }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: on ? '#FFC11A' : '#0A0A0A', letterSpacing: 0.5 }}>{m.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
