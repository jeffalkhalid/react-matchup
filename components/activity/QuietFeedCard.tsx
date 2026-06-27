import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import type { SocialPlayer } from '../../types';

// Fil calme : aucun ami n'a joué cette semaine → propose de pinger 1-2 amis.
export function QuietFeedCard({ friends, onPing }: {
  friends: SocialPlayer[];
  onPing: (f: SocialPlayer) => void;
}) {
  const targets = friends.slice(0, 2);
  return (
    <View style={{ backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, padding: 16, marginTop: 14, gap: 12, alignItems: 'center' }}>
      <Text style={{ fontFamily: Fonts.uiBold, fontSize: 14, color: Colors.textPrimary }}>Personne n'a joué cette semaine</Text>
      <Text style={{ fontFamily: Fonts.ui, fontSize: 13, color: Colors.textSecondary, textAlign: 'center', maxWidth: 260 }}>
        Donne le coup d'envoi — propose une partie à un ami.
      </Text>
      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        {targets.map(f => (
          <TouchableOpacity key={f.id} onPress={() => onPing(f)} activeOpacity={0.85}
            style={{ borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: Colors.primary }}>
            <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 12, color: Colors.brand }}>Pinger {f.name.split(' ')[0]}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
