import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { track } from '../../lib/analytics';
import type { SuggestedGame } from '../../lib/activityFeed';

function whenLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tom = new Date(); tom.setDate(today.getDate() + 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const hh = String(d.getHours()).padStart(2, '0') + 'h' + (d.getMinutes() ? String(d.getMinutes()).padStart(2, '0') : '');
  if (sameDay(d, today)) return `CE SOIR · ${hh}`;
  if (sameDay(d, tom)) return `DEMAIN · ${hh}`;
  return `${['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'][d.getDay()]} · ${hh}`;
}

// Tap → ouvre la fiche détail de la partie (on ne rejoint pas à l'aveugle).
export function JoinHeroCard({ game, onOpen }: { game: SuggestedGame; onOpen: (gameId: string) => void }) {
  const open = () => { track('activity_hero_join_tapped', { match_id: game.gameId }); onOpen(game.gameId); };
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={open}
      style={{ borderRadius: 18, padding: 16, marginTop: 14, backgroundColor: Colors.bgDark }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <View style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 10, color: '#FFFFFF', letterSpacing: 0.5 }}>{whenLabel(game.matchDate)}</Text>
        </View>
        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 10, color: Colors.brand, letterSpacing: 0.5 }}>★ POUR TOI</Text>
      </View>

      <Text style={{ fontFamily: Fonts.welcome, fontSize: 22, color: Colors.textOnDark, lineHeight: 26 }}>
        Il manque 1 joueur
      </Text>
      <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>
        {[game.location, game.gameFormat].filter(Boolean).join(' · ') || 'Partie ouverte'}
        {game.friendsIn > 0 ? ` · ${game.friendsIn} ami${game.friendsIn > 1 ? 's' : ''} déjà inscrit${game.friendsIn > 1 ? 's' : ''}` : ''}
      </Text>

      <View style={{ marginTop: 14, borderRadius: 999, paddingVertical: 12, alignItems: 'center', backgroundColor: Colors.brand }}>
        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 14, color: Colors.primary }}>Voir la partie →</Text>
      </View>
    </TouchableOpacity>
  );
}
