import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  ActivityIndicator, ScrollView, Image,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { usePlayer } from '../../hooks/usePlayer';
import { useGameChats } from '../../hooks/useGameChats';
import { useDirectChats } from '../../hooks/useDirectChats';
import { otherName, otherAvatarPath } from '../../lib/directChats';
import { previewLine, relativeTime, requestsLine } from '../../lib/chatList';
import { PlayerAvatar } from '../../components/PlayerAvatar';
import { Colors, Spacing, FontSize, Radius, Fonts } from '../../lib/theme';
import { ChatCard, POINTILLES, chatPlayers } from '../../components/ChatCard';
import { NewChatSheet } from '../../components/NewChatSheet';
import { startGameConversation } from '../../lib/gameConversations';
import type { StartableGame } from '../../hooks/useGameChats';
import { HeaderActions } from '../../components/HeaderActions';
import { Icon, type IconName } from '../../components/community/icons';

type TypeFilter = 'all' | 'unread' | 'challenge' | 'standard';

export default function ChatsScreen() {
  const { player } = usePlayer();
  const router = useRouter();
  const { games, startableGames, loading, loadGames } = useGameChats();
  const { conversations: dms, requests, requestsCount, load: loadDms, isConversationBlocked, unreadCount, lastMessage } = useDirectChats();
  const [section, setSection] = useState<'parties' | 'directs'>('parties');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [toast, setToast] = useState<{ mot: string; erreur?: boolean } | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);

  // Le bandeau et le surlignage s'effacent seuls : rien à refermer à la main.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!flashId) return;
    const t = setTimeout(() => setFlashId(null), 2600);
    return () => clearTimeout(t);
  }, [flashId]);

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

  // La recherche du bandeau vaut pour les DEUX listes : on cherche « Karim »
  // sans savoir si on lui a parlé en direct ou dans une partie.
  const dmsFiltres = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return dms;
    return dms.filter(conv => {
      if (otherName(conv, player?.id ?? '').toLowerCase().includes(q)) return true;
      return (lastMessage(conv)?.content ?? '').toLowerCase().includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dms, search, player?.id, lastMessage]);

  // Les matchs à venir qui ont DÉJÀ une conversation : la feuille les montre
  // à part, avec « Ouvrir ». C'est ce qui empêche les doublons.
  const dejaOuvertes = useMemo(
    () => active.filter(g => new Date(g.match_date).getTime() >= Date.now()),
    [active],
  );

  const lancerConversation = useCallback(async (game: StartableGame, message: string) => {
    if (!player) return;
    setEnvoi(true);
    const joueurs = chatPlayers(game, player.id).map(j => j.id);
    const r = await startGameConversation(
      { gameId: game.id, location: game.location, matchDate: game.match_date, playerIds: joueurs },
      message,
      { id: player.id, name: player.name },
    );
    setEnvoi(false);
    if (!r.ok) { setToast({ mot: r.erreur ?? "La conversation n'a pas pu être lancée.", erreur: true }); return; }
    setSheetOpen(false);
    await loadGames();
    setFlashId(game.id);
    const prevenus = Math.max(0, joueurs.length - 1);
    setToast({
      mot: r.dejaLancee
        ? 'Cette conversation existait déjà.'
        : `Conversation créée · ${prevenus} joueur${prevenus > 1 ? 's' : ''} notifié${prevenus > 1 ? 's' : ''}`,
    });
  }, [player, loadGames]);

  const totalUnread = active.reduce((s, g) => s + g.unread, 0);
  // Les non-lus des directs, demandes comprises : le sélecteur annonce ce
  // qu'on trouvera de l'autre côté sans avoir à y aller.
  const dmUnread = useMemo(
    () => dms.reduce((s, c) => s + (isConversationBlocked(c) ? 0 : unreadCount(c)), 0) + requestsCount,
    [dms, isConversationBlocked, unreadCount, requestsCount],
  );

  const FILTERS: Array<{ id: TypeFilter; label: string }> = [
    { id: 'all', label: 'Tous' },
    { id: 'unread', label: `Non lus${totalUnread > 0 ? ` (${totalUnread})` : ''}` },
    { id: 'challenge', label: 'Défis' },
    { id: 'standard', label: 'Parties' },
  ];

  // « Archivées » ferme la liste au lieu de l'ouvrir : épinglée en tête, elle
  // était la première chose lue alors qu'elle est la moins urgente. Les
  // pointillés disent que c'est un rangement, pas une conversation.
  const ArchivedRow = archived.length > 0 ? (
    <TouchableOpacity
      onPress={() => router.push('/archived-chats' as any)}
      activeOpacity={0.85}
      style={{
        marginTop: 16, marginHorizontal: 16, marginBottom: 8,
        paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14,
        borderWidth: 1, borderStyle: 'dashed', borderColor: POINTILLES,
        flexDirection: 'row', alignItems: 'center', gap: 10,
      }}
    >
      <Text style={{ fontSize: 18 }}>🗄️</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: Colors.textPrimary, fontSize: 13, fontFamily: Fonts.uiExtraBold }}>
          Archivées
        </Text>
        <Text style={{ color: Colors.textMuted, fontSize: 11, marginTop: 2, fontFamily: Fonts.ui }}>
          {archived.length} conversation{archived.length > 1 ? 's' : ''}
          {archivedUnread > 0 ? `  ·  ${archivedUnread} non lu${archivedUnread > 1 ? 's' : ''}` : ''}
        </Text>
      </View>
      <Text style={{ color: Colors.textMuted, fontSize: 16 }}>›</Text>
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
          <Text numberOfLines={2}
            style={{ color: Colors.textOnDark, fontSize: 28, lineHeight: 36, fontFamily: Fonts.welcome, letterSpacing: -0.5, flexShrink: 1, textAlign: 'center', paddingRight: 5 }}>Mes <Text style={{ color: Colors.brand }}>conversations</Text></Text>
        </View>
        <Text style={{ color: Colors.textMuted, fontSize: FontSize.xs, fontWeight: '600', textAlign: 'center', marginBottom: Spacing.md }}>
          {active.length} conversation{active.length !== 1 ? 's' : ''}
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
            placeholder="Club, joueur, message…"
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
            <Text style={{ color: section === s ? '#fff' : Colors.textPrimary, fontWeight: '800', fontSize: FontSize.sm, fontFamily: Fonts.uiExtraBold }}>
              {s === 'parties'
                ? `Parties${totalUnread > 0 ? ` · ${totalUnread}` : ''}`
                : `Directs${dmUnread > 0 ? ` · ${dmUnread}` : ''}`}
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
            contentContainerStyle={{ paddingTop: 8, paddingBottom: 88, flexGrow: 1 }}
            ListFooterComponent={typeFilter === 'all' && !search ? ArchivedRow : null}
            renderItem={({ item: game }) => (
              <ChatCard game={game} playerId={player?.id} flash={flashId === game.id} onPress={() => router.push(`/chat/${game.id}` as any)} />
            )}
            ListEmptyComponent={
              <EtatVide
                icon={typeFilter === 'unread' ? 'check' : search ? 'search' : 'message'}
                titre={typeFilter === 'unread' ? 'Tout est lu !' : search ? 'Aucun résultat' : 'Aucune conversation'}
                phrase={typeFilter === 'unread' ? 'Tu es à jour.'
                  : search ? `« ${search} » introuvable`
                  : 'Rejoins une partie dans le Lobby, la conversation arrive avec.'}
                action={search || typeFilter !== 'all'
                  ? { mot: 'Voir toutes les conversations', faire: () => { setSearch(''); setTypeFilter('all'); } }
                  : null}
              />
            }
          />
        )
      )}

      {/* Directs list */}
      {section === 'directs' && (
        <FlatList
          data={dmsFiltres}
          keyExtractor={c => c.id}
          contentContainerStyle={{ paddingBottom: 80, flexGrow: 1 }}
          ListHeaderComponent={requestsCount > 0 ? (
            <TouchableOpacity
              onPress={() => router.push('/dm-requests' as any)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
                paddingHorizontal: Spacing.lg, paddingVertical: 14,
                borderBottomWidth: 1, borderBottomColor: Colors.border,
                backgroundColor: Colors.bgCardAlt,
              }}>
              <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="mail" size={20} color={Colors.brand} stroke={2.2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: '900', fontFamily: Fonts.uiBlack }}>Demandes</Text>
                {/* Qui attend, plutôt qu'un compte : un prénom donne envie
                    d'ouvrir, « 2 en attente » ne dit rien de personne. */}
                <Text numberOfLines={1} style={{ color: Colors.textMuted, fontSize: FontSize.xs, marginTop: 2, fontFamily: Fonts.ui }}>
                  {requestsLine(requests.map(r => otherName(r, player?.id ?? '')))}
                </Text>
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
            const photoPath = otherAvatarPath(conv, player?.id ?? '');
            const blocked = isConversationBlocked(conv);
            const apercu = lastMessage(conv);
            const unread = blocked ? 0 : unreadCount(conv);
            return (
              <TouchableOpacity
                onPress={() => router.push(`/dm/${conv.id}` as any)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
                  paddingHorizontal: Spacing.lg, paddingVertical: 13,
                  borderBottomWidth: 1, borderBottomColor: Colors.border,
                  backgroundColor: unread > 0 ? `${Colors.primary}08` : Colors.bg,
                  opacity: blocked ? 0.55 : 1,
                }}>
                <PlayerAvatar name={name} path={photoPath} size={48} backgroundColor={Colors.bgCardAlt} textColor={Colors.textPrimary} fontFamily={Fonts.uiBlack} fontSize={18} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ flex: 1, color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: unread > 0 ? '900' : '800', fontFamily: unread > 0 ? Fonts.uiBlack : Fonts.uiExtraBold }} numberOfLines={1}>{name}</Text>
                    {blocked && (
                      <View style={{ backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
                        <Text style={{ color: Colors.danger, fontSize: 10, fontWeight: '900' }}>🚫 Bloqué</Text>
                      </View>
                    )}
                    <Text style={{ color: Colors.textMuted, fontSize: 11, fontFamily: Fonts.uiSemi }}>
                      {relativeTime(conv.last_message_at)}
                    </Text>
                  </View>
                  {/* Ce qui s'est dit, pas seulement quand : une date seule ne
                      distingue pas deux conversations du même jour. */}
                  <Text numberOfLines={1} style={{
                    marginTop: 2, fontSize: 12,
                    color: blocked ? Colors.textMuted : unread > 0 ? Colors.textPrimary : '#71717A',
                    fontFamily: unread > 0 ? Fonts.uiSemi : Fonts.ui,
                  }}>
                    {blocked
                      ? 'Conversation bloquée'
                      : previewLine(apercu?.content, name, apercu?.sender_id === player?.id) ?? 'Pas encore de message'}
                  </Text>
                </View>
                {unread > 0 ? (
                  <View style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: Colors.primary, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: Colors.textOnDark, fontSize: 11, fontWeight: '900' }}>{unread > 99 ? '99+' : unread}</Text>
                  </View>
                ) : (
                  <Text style={{ color: Colors.textMuted, fontSize: 16 }}>›</Text>
                )}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <EtatVide
              icon={search ? 'search' : 'message'}
              titre={search ? 'Aucun résultat' : 'Aucune conversation directe'}
              phrase={search ? `« ${search} » introuvable` : "Lance un message depuis le profil d'un joueur."}
              action={search ? { mot: 'Voir toutes les conversations', faire: () => setSearch('') } : null}
            />
          }
        />
      )}
      {/* Le bouton « Écrire » ne vaut que pour les parties : un direct se
          lance depuis le profil d'un joueur, pas d'ici. */}
      {section === 'parties' && !loading && !toast ? (
        <TouchableOpacity
          onPress={() => setSheetOpen(true)}
          activeOpacity={0.85}
          style={{
            // `bottom: 16` et non « hauteur de barre + 16 » : l'écran
            // s'arrête déjà au bord de la barre d'onglets.
            position: 'absolute', right: 16, bottom: 16,
            flexDirection: 'row', alignItems: 'center', gap: 8,
            height: 52, paddingLeft: 16, paddingRight: 18, borderRadius: 18,
            backgroundColor: Colors.primary,
            shadowColor: Colors.primary, shadowOpacity: 0.3, shadowRadius: 20,
            shadowOffset: { width: 0, height: 8 }, elevation: 8,
          }}
        >
          <Icon name="pencil" size={18} color={Colors.brand} stroke={2.2} />
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: Colors.textOnDark }}>Écrire</Text>
        </TouchableOpacity>
      ) : null}

      {toast ? (
        <View style={{
          position: 'absolute', left: 16, right: 16, bottom: 16,
          flexDirection: 'row', alignItems: 'center', gap: 10,
          backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14,
          shadowColor: Colors.primary, shadowOpacity: 0.3, shadowRadius: 20,
          shadowOffset: { width: 0, height: 8 }, elevation: 10,
        }}>
          <View style={{
            width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
            backgroundColor: toast.erreur ? Colors.danger : Colors.brand,
          }}>
            <Icon name={toast.erreur ? 'x' : 'check'} size={13} color={Colors.primary} stroke={3} />
          </View>
          <Text style={{ flex: 1, fontFamily: Fonts.uiBold, fontSize: 13, color: Colors.textOnDark }}>
            {toast.mot}
          </Text>
        </View>
      ) : null}

      <NewChatSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        startables={startableGames}
        dejaOuvertes={dejaOuvertes}
        myId={player?.id}
        envoi={envoi}
        onChoose={lancerConversation}
        onOpenExisting={id => router.push(`/chat/${id}` as any)}
      />

    </View>
  );
}

/**
 * L'état vide, partagé par les deux listes et leurs trois raisons d'être
 * vides : rien du tout, une recherche sans résultat, un filtre trop serré.
 *
 * Les trois disaient « 💬 Aucune conversation » avec un emoji et la même
 * mise en page approximative. Un écran vide est le seul contenu à ce
 * moment-là : il mérite d'être dessiné.
 */
function EtatVide({ icon, titre, phrase, action }: {
  icon: IconName;
  titre: string;
  phrase: string;
  action?: { mot: string; faire: () => void } | null;
}) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: 60 }}>
      <View style={{
        width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.bgCard,
        borderWidth: 1, borderColor: Colors.border,
        alignItems: 'center', justifyContent: 'center', marginBottom: 14,
      }}>
        <Icon name={icon} size={26} color={Colors.textSecondary} stroke={2} />
      </View>
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 24, lineHeight: 30, color: Colors.textPrimary, textAlign: 'center' }}>
        {titre}
      </Text>
      <Text style={{ fontFamily: Fonts.ui, fontSize: 13, lineHeight: 18, color: Colors.textSecondary, textAlign: 'center', marginTop: 4 }}>
        {phrase}
      </Text>
      {action ? (
        <TouchableOpacity
          onPress={action.faire}
          activeOpacity={0.85}
          style={{ marginTop: 16, backgroundColor: Colors.primary, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 20 }}
        >
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: Colors.textOnDark }}>{action.mot}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
