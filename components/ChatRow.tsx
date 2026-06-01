import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Spacing, FontSize, Fonts } from '../lib/theme';
import { Pill } from './Pill';
import type { GameChat } from '../hooks/useGameChats';

function AvatarGrid({ players }: { players: Array<{ name: string; isMe: boolean }> }) {
  const slots = [players[0], players[1], players[2], players[3]];
  const COLORS = [Colors.primary, '#8B5CF6', '#EC4899', '#14B8A6'];
  return (
    <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: Colors.bgCardAlt, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 4, gap: 3 }}>
        {slots.slice(0, 4).map((p, i) => (
          <View key={i} style={{
            width: 18, height: 18, borderRadius: 9,
            backgroundColor: p ? (p.isMe ? Colors.primary : COLORS[i]) : Colors.border,
            alignItems: 'center', justifyContent: 'center',
          }}>
            {p ? <Text style={{ color: Colors.textOnDark, fontSize: 7, fontWeight: '900', fontFamily: Fonts.uiBlack }}>{p.name.charAt(0).toUpperCase()}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

export function ChatRow({ game, playerId, onPress }: {
  game: GameChat;
  playerId: string | undefined;
  onPress: () => void;
}) {
  const variant: 'brand' | 'ink' = game.is_challenge ? 'brand' : 'ink';
  const label = game.is_challenge ? 'Défi' : 'Partie';
  const accepted = (game.participants ?? []).filter((p: any) => p.status === 'accepted');
  const allPlayers = [
    { name: game.creator?.name ?? '?', isMe: playerId === game.creator_id },
    ...accepted.map((p: any) => ({ name: p.player?.name ?? '?', isMe: p.player_id === playerId })),
  ];
  const gameDate = new Date(game.match_date);
  const dateStr = gameDate.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const timeStr = gameDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
        paddingHorizontal: Spacing.lg, paddingVertical: 13,
        borderBottomWidth: 1, borderBottomColor: Colors.border,
        backgroundColor: game.unread > 0 ? `${Colors.primary}08` : Colors.bg,
      }}
    >
      <View>
        <AvatarGrid players={allPlayers} />
        {game.unread > 0 && (
          <View style={{
            position: 'absolute', top: -4, right: -4,
            width: 18, height: 18, borderRadius: 9,
            backgroundColor: Colors.primary, borderWidth: 2, borderColor: Colors.bg,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ color: Colors.textOnDark, fontSize: 9, fontWeight: '900', fontFamily: Fonts.uiBlack }}>{game.unread}</Text>
          </View>
        )}
      </View>

      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
          <Text style={{ color: game.unread > 0 ? Colors.textPrimary : Colors.textSecondary, fontSize: FontSize.sm, fontWeight: game.unread > 0 ? '900' : '600', fontFamily: game.unread > 0 ? Fonts.uiBlack : Fonts.uiSemi }} numberOfLines={1}>
            {dateStr} · {timeStr}
          </Text>
          <Text style={{ color: Colors.textMuted, fontSize: FontSize.xs }}>
            {gameDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
          </Text>
        </View>
        <Text style={{ color: Colors.textMuted, fontSize: FontSize.xs, marginBottom: 4 }} numberOfLines={1}>
          📍 {game.location}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Pill variant={variant}>{label}</Pill>
          <Text style={{ color: game.unread > 0 ? Colors.textPrimary : Colors.textMuted, fontSize: FontSize.xs, fontWeight: game.unread > 0 ? '700' : '400', fontFamily: game.unread > 0 ? Fonts.uiBold : Fonts.ui }} numberOfLines={1}>
            {allPlayers.filter(p => !p.isMe)[0]?.name ?? 'Démarrer la conversation'}
          </Text>
        </View>
      </View>

      {game.unread > 0 ? (
        <View style={{
          minWidth: 22, height: 22, borderRadius: 11,
          backgroundColor: Colors.primary, paddingHorizontal: 7,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ color: Colors.textOnDark, fontSize: 11, fontWeight: '900' }}>
            {game.unread > 99 ? '99+' : game.unread}
          </Text>
        </View>
      ) : (
        <Text style={{ color: Colors.textMuted, fontSize: 16 }}>›</Text>
      )}
    </TouchableOpacity>
  );
}
