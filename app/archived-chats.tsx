import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../hooks/usePlayer';
import { useGameChats } from '../hooks/useGameChats';
import { Colors, Spacing, FontSize, Radius, Fonts } from '../lib/theme';
import { ChatRow } from '../components/ChatRow';

export default function ArchivedChatsScreen() {
  const { player } = usePlayer();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { games, loading, loadGames } = useGameChats();
  const [search, setSearch] = useState('');

  useFocusEffect(useCallback(() => {
    if (player) loadGames();
  }, [player, loadGames]));

  const archived = useMemo(() => games.filter(g => g.archived), [games]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return archived;
    return archived.filter(game => {
      if (game.location?.toLowerCase().includes(q)) return true;
      if (game.creator?.name?.toLowerCase().includes(q)) return true;
      return (game.participants ?? []).some((p: any) => p.player?.name?.toLowerCase().includes(q));
    });
  }, [archived, search]);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {/* Header */}
      <View style={{ backgroundColor: Colors.heroBg, paddingTop: insets.top + 8, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.sm }}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: Colors.textOnDark, fontSize: 20, fontWeight: '900' }}>‹</Text>
          </TouchableOpacity>
          <View>
            <Text style={{ color: Colors.textOnDark, fontSize: 24, fontFamily: Fonts.welcome, letterSpacing: -0.5 }}>
              <Text style={{ color: Colors.brand }}>Archivées</Text>
            </Text>
            <Text style={{ color: Colors.textMuted, fontSize: FontSize.xs, fontWeight: '600' }}>
              {archived.length} conversation{archived.length !== 1 ? 's' : ''}
            </Text>
          </View>
        </View>

        {/* Search */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
          backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: Radius.md,
          paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
          borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
        }}>
          <Text style={{ fontSize: 14, color: Colors.textMuted }}>🔍</Text>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Rechercher une conversation…"
            placeholderTextColor={Colors.textMuted}
            style={{ flex: 1, color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '500' }}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Text style={{ color: Colors.textMuted, fontSize: 16 }}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={g => g.id}
          contentContainerStyle={{ paddingBottom: 40, flexGrow: 1 }}
          renderItem={({ item: game }) => (
            <ChatRow game={game} playerId={player?.id} onPress={() => router.push(`/chat/${game.id}` as any)} />
          )}
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, paddingTop: 80 }}>
              <Text style={{ fontSize: 40, marginBottom: Spacing.md }}>🗄️</Text>
              <Text style={{ color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '900', textAlign: 'center', fontFamily: Fonts.uiBlack }}>
                {search ? 'Aucun résultat' : 'Aucune conversation archivée'}
              </Text>
              <Text style={{ color: Colors.textSecondary, fontSize: FontSize.sm, textAlign: 'center', marginTop: 4 }}>
                {search ? `"${search}" introuvable` : 'Les matchs joués ou passés arriveront ici.'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
