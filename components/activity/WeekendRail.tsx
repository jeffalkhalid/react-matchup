import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import type { WeekendGame } from '../../lib/activityFeed';

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const hh = String(d.getHours()).padStart(2, '0') + 'h' + (d.getMinutes() ? String(d.getMinutes()).padStart(2, '0') : '');
  return `${days[d.getDay()]} ${hh}`;
}

function WeekendCard({ g, dark, onOpen }: { g: WeekendGame; dark: boolean; onOpen: () => void }) {
  const bg = dark ? Colors.bgDark : Colors.bgCard;
  const fg = dark ? Colors.textOnDark : Colors.textPrimary;
  const sub = dark ? 'rgba(255,255,255,0.6)' : Colors.textSecondary;
  return (
    <TouchableOpacity onPress={onOpen} activeOpacity={0.9}
      style={{ width: 200, borderRadius: 16, padding: 14, backgroundColor: bg, borderWidth: dark ? 0 : 1, borderColor: Colors.border }}>
      <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 13, color: fg }}>{dayLabel(g.matchDate)}</Text>
      <Text numberOfLines={1} style={{ fontFamily: Fonts.uiSemi, fontSize: 12, color: sub, marginTop: 2 }}>{g.location ?? 'Lieu à confirmer'}</Text>
      <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: sub, marginTop: 8 }}>
        {g.freeSpots} place{g.freeSpots > 1 ? 's' : ''} libre{g.freeSpots > 1 ? 's' : ''}
      </Text>
      <View style={{ marginTop: 10, borderRadius: 999, paddingVertical: 9, alignItems: 'center', backgroundColor: Colors.brand }}>
        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 12, color: Colors.primary }}>Voir →</Text>
      </View>
    </TouchableOpacity>
  );
}

export function WeekendRail({ games, onOpen, title = 'Joue ce week-end' }: { games: WeekendGame[]; onOpen: (gameId: string) => void; title?: string }) {
  if (games.length === 0) return null;
  return (
    <View style={{ marginTop: 18 }}>
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 16, color: Colors.textPrimary, marginBottom: 10 }}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 16 }}>
        {games.map((g, i) => <WeekendCard key={g.id} g={g} dark={i % 2 === 0} onOpen={() => onOpen(g.id)} />)}
      </ScrollView>
    </View>
  );
}
