import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  ActivityIndicator, ScrollView, Image,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { usePlayer } from '../../hooks/usePlayer';
import { useGameChats } from '../../hooks/useGameChats';
import { useDirectChats } from '../../hooks/useDirectChats';
import { otherName, otherPhoto } from '../../lib/directChats';
import { Colors, Spacing, FontSize, Radius, Fonts } from '../../lib/theme';
import { ChatRow } from '../../components/ChatRow';
import { HeaderActions } from '../../components/HeaderActions';
import { Icon } from '../../components/community/icons';

type TypeFilter = 'all' | 'unread' | 'challenge' | 'standard';

export default function ChatsScreen() {
  const { player } = usePlayer();
  const router = useRouter();
  const { games, loading, loadGames } = useGameChats();
  const { conversations: dms, requests, requestsCount, load: loadDms, isConversationBlocked } = useDirectChats();
  const [section, setSection] = useState<'parties' | 'directs'>('parties');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  useFocusEffect(useCallback(() => {
    if (player) { loadGames(); loadDms(); }
  }, [player, loadGames, loadDms]));

  const active   = useMemo(() => games.filter(g => !g.archived), [games]);
  const archived = useMemo(() => games.filter(g => g.archived), [games]);
  const archivedUnread = useMemo(() => archived.reduce((s, g) => s + g.unread, 0), [archived]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return active.filter(game => {
      if (typeFilter === 'challenge' && !game.is_challenge) return false;
      if (typeFilter === 'standard' && game.is_challenge) return false;
      if (typeFilter === 'unread' && game.unread === 0) return false;
      if (!q) return true;
      if (game.location?.toLowerCase().includes(q)) return true;
      if (game.creator?.name?.toLowerCase().includes(q)) return true;
      return (game.participants ?? []).some((p: any) => p.player?.name?.toLowerCase().includes(q));
    });
  }, [active, search, typeFilter]);

  const totalUnread = active.reduce((s, g) => s + g.unread, 0);

  const FILTERS: Array<{ id: TypeFilter; label: string }> = [
    { id: 'all', label: 'Tous' },
    { id: 'unread', label: `Non lus${totalUnread > 0 ? ` (${totalUnread})` : ''}` },
    { id: 'challenge', label: 'Défis' },
    { id: 'standard', label: 'Parties' },
  ];

  // "Archivées" entry pinned at the top of the list (WhatsApp-style).
  const ArchivedRow = archived.length > 0 ? (
    <TouchableOpacity
      onPress={() => router.push('/archived-chats' as any)}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
        paddingHorizontal: Spacing.lg, paddingVertical: 14,
        borderBottomWidth: 1, borderBottomColor: Colors.border,
        backgroundColor: Colors.bgCardAlt,
      }}
    >
      <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: Colors.bgCard, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 22 }}>🗄️</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: '900', fontFamily: Fonts.uiBlack }}>
          Archivées
        </Text>
        <Text style={{ color: Colors.textMuted, fontSize: FontSize.xs, marginTop: 2 }}>
          {archived.length} conversation{archived.length > 1 ? 's' : ''}
          {archivedUnread > 0 ? `  ·  ${archivedUnread} non lu${archivedUnread > 1 ? 's' : ''}` : ''}
        </Text>
      </View>
      {archivedUnread > 0 ? (
        <View style={{
          minWidth: 22, height: 22, borderRadius: 11,
          backgroundColor: Colors.primary, paddingHorizontal: 7,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ color: Colors.textOnDark, fontSize: 11, fontWeight: '900' }}>
            {archivedUnread > 99 ? '99+' : archivedUnread}
          </Text>
        </View>
      ) : (
        <Text style={{ color: Colors.textMuted, fontSize: 16 }}>›</Text>
      )}
    </TouchableOpacity>
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {/* Header */}
      <View style={{ backgroundColor: Colors.heroBg, paddingTop: 56, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md }}>
        <HeaderActions top={50} right={20} tint="light" />
        {/* Brand lockup — raquette + wordmark PAGMATCH */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
          <Image
            source={require('../../assets/auth/splash-racket.png')}
            style={{ width: 22, height: 22 }}
            resizeMode="contain"
          />
          <Image
            source={require('../../assets/auth/splash-wordmark.png')}
            style={{ width: 100, height: 22, marginLeft: -7 }}
            resizeMode="contain"
          />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 2 }}>
          <Text style={{ color: Colors.textOnDark, fontSize: 28, fontFamily: Fonts.welcome, letterSpacing: -0.5, flexShrink: 1, textAlign: 'center' }}>Mes <Text style={{ color: Colors.brand }}>conversations</Text></Text>
        </View>
        <Text style={{ color: Colors.textMuted, fontSize: FontSize.xs, fontWeight: '600', textAlign: 'center', marginBottom: Spacing.md }}>
          {active.length} match{active.length !== 1 ? 's' : ''} actif{active.length !== 1 ? 's' : ''}
          {totalUnread > 0 ? `  ·  ${totalUnread} non lu${totalUnread > 1 ? 's' : ''}` : ''}
        </Text>

        {/* Search */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
          backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: Radius.md,
          paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
          borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
        }}>
          <Icon name="search" size={14} color={Colors.textMuted} stroke={2.2} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Rechercher une conversation…"
            placeholderTextColor={Colors.textMuted}
            style={{ flex: 1, color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '500' }}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Icon name="x" size={16} color={Colors.textMuted} stroke={2.5} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Section selector: Parties / Directs */}
      <View style={{ flexDirection: 'row', paddingHorizontal: Spacing.lg, gap: 8, marginBottom: 8, marginTop: 4 }}>
        {(['parties', 'directs'] as const).map(s => (
          <TouchableOpacity key={s} onPress={() => setSection(s)} style={{
            paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999,
            backgroundColor: section === s ? Colors.primary : Colors.bgCard,
          }}>
            <Text style={{ color: section === s ? '#fff' : Colors.textPrimary, fontWeight: '800', fontSize: FontSize.sm }}>
              {s === 'parties' ? 'Parties' : `Directs${requestsCount > 0 ? ` · ${requestsCount}` : ''}`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Filter pills — only in Parties section */}
      {section === 'parties' && (
        <View style={{ paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.sm }}>
            {FILTERS.map(f => {
              const active = typeFilter === f.id;
              const isUnread = f.id === 'unread';
              return (
                <TouchableOpacity
                  key={f.id}
                  onPress={() => setTypeFilter(f.id)}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full,
                    backgroundColor: active
                      ? (isUnread ? Colors.danger : 'rgba(255,193,26,0.14)')
                      : Colors.bgCard,
                    borderWidth: 1,
                    borderColor: active
                      ? (isUnread ? Colors.danger : Colors.brand)
                      : Colors.border,
                  }}
                >
                  <Text style={{
                    color: active ? (isUnread ? Colors.textOnDark : Colors.brandDeep) : Colors.textSecondary,
                    fontSize: FontSize.xs, fontWeight: '700',
                    fontFamily: active ? Fonts.uiExtraBold : Fonts.uiBold,
                  }}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Parties list */}
      {section === 'parties' && (
        loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={g => g.id}
            contentContainerStyle={{ paddingBottom: 80, flexGrow: 1 }}
            ListHeaderComponent={typeFilter === 'all' && !search ? ArchivedRow : null}
            renderItem={({ item: game }) => (
              <ChatRow game={game} playerId={player?.id} onPress={() => router.push(`/chat/${game.id}` as any)} />
            )}
            ListEmptyComponent={
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, paddingTop: 80 }}>
                <Text style={{ fontSize: 40, marginBottom: Spacing.md }}>
                  {typeFilter === 'unread' ? '✅' : '💬'}
                </Text>
                <Text style={{ color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '900', textAlign: 'center', fontFamily: Fonts.uiBlack }}>
                  {typeFilter === 'unread' ? 'Tout est lu !' : search ? 'Aucun résultat' : 'Aucune conversation active'}
                </Text>
                <Text style={{ color: Colors.textSecondary, fontSize: FontSize.sm, textAlign: 'center', marginTop: 4 }}>
                  {typeFilter === 'unread' ? 'Tu es à jour.' : search ? `"${search}" introuvable` : 'Rejoins une partie dans le Lobby.'}
                </Text>
                {(search || typeFilter !== 'all') && (
                  <TouchableOpacity onPress={() => { setSearch(''); setTypeFilter('all'); }} style={{ marginTop: Spacing.md }}>
                    <Text style={{ color: Colors.primary, fontSize: FontSize.sm, fontWeight: '900', fontFamily: Fonts.uiBlack }}>Voir toutes les conversations</Text>
                  </TouchableOpacity>
                )}
              </View>
            }
          />
        )
      )}

      {/* Directs list */}
      {section === 'directs' && (
        <FlatList
          data={dms}
          keyExtractor={c => c.id}
          contentContainerStyle={{ paddingBottom: 80, flexGrow: 1 }}
          ListHeaderComponent={requestsCount > 0 ? (
            <TouchableOpacity
              onPress={() => router.push(`/dm/${requests[0].id}` as any)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
                paddingHorizontal: Spacing.lg, paddingVertical: 14,
                borderBottomWidth: 1, borderBottomColor: Colors.border,
                backgroundColor: Colors.bgCardAlt,
              }}>
              <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: Colors.bgCard, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 22 }}>✉️</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: '900', fontFamily: Fonts.uiBlack }}>Demandes</Text>
                <Text style={{ color: Colors.textMuted, fontSize: FontSize.xs, marginTop: 2 }}>{requestsCount} en attente</Text>
              </View>
              <View style={{
                minWidth: 22, height: 22, borderRadius: 11,
                backgroundColor: Colors.primary, paddingHorizontal: 7,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ color: Colors.textOnDark, fontSize: 11, fontWeight: '900' }}>
                  {requestsCount > 99 ? '99+' : requestsCount}
                </Text>
              </View>
            </TouchableOpacity>
          ) : null}
          renderItem={({ item: conv }) => {
            const name = otherName(conv, player?.id ?? '');
            const photo = otherPhoto(conv, player?.id ?? '');
            const blocked = isConversationBlocked(conv);
            return (
              <TouchableOpacity
                onPress={() => router.push(`/dm/${conv.id}` as any)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
                  paddingHorizontal: Spacing.lg, paddingVertical: 13,
                  borderBottomWidth: 1, borderBottomColor: Colors.border,
                  backgroundColor: Colors.bg,
                  opacity: blocked ? 0.55 : 1,
                }}>
                <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.bgCardAlt, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {photo
                    ? <Image source={{ uri: photo }} style={{ width: 48, height: 48, borderRadius: 24 }} />
                    : <Text style={{ color: Colors.textPrimary, fontSize: 18, fontWeight: '900', fontFamily: Fonts.uiBlack }}>{name.charAt(0).toUpperCase()}</Text>
                  }
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: '800', fontFamily: Fonts.uiExtraBold }} numberOfLines={1}>{name}</Text>
                    {blocked && (
                      <View style={{ backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
                        <Text style={{ color: Colors.danger, fontSize: 10, fontWeight: '900' }}>🚫 Bloqué</Text>
                      </View>
                    )}
                  </View>
                  {conv.last_message_at && (
                    <Text style={{ color: Colors.textMuted, fontSize: FontSize.xs, marginTop: 2 }}>
                      {new Date(conv.last_message_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                    </Text>
                  )}
                </View>
                <Text style={{ color: Colors.textMuted, fontSize: 16 }}>›</Text>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, paddingTop: 80 }}>
              <Text style={{ fontSize: 40, marginBottom: Spacing.md }}>💬</Text>
              <Text style={{ color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '900', textAlign: 'center', fontFamily: Fonts.uiBlack }}>Aucune conversation directe</Text>
              <Text style={{ color: Colors.textSecondary, fontSize: FontSize.sm, textAlign: 'center', marginTop: 4 }}>Lance un message depuis le profil d'un joueur.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}
