import { View } from 'react-native';

export function StoryProgress({ count, index }: { count: number; index: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4, paddingHorizontal: 4 }}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={{ flex: 1, height: 3, borderRadius: 999, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.25)' }}>
          <View style={{ height: 3, borderRadius: 999, backgroundColor: '#FFFFFF', width: i < index ? '100%' : i === index ? '50%' : '0%' }} />
        </View>
      ))}
    </View>
  );
}
