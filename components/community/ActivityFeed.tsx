import { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Colors, Fonts, LeagueGradients } from '../../lib/theme';
import { getFriends, getActivityFeed, toggleReaction } from '../../lib/community';
import { getHiddenPlayerIds, reportContent } from '../../lib/moderation';
import { Avatar } from './Avatar';
import { Chips } from './ui';
import { Icon } from './icons';
import { ActivityCard } from './ActivityCard';
import type { SocialPlayer, ActivityEvent } from '../../types';

// ── Barre d'amis filtrante (export pour réutilisation dans l'onglet Activité) ──
export function FriendsBar({ friends, sel, onSelect, dimmed = false }: {
  friends: SocialPlayer[]; sel: string | null; onSelect: (id: string | null) => void; dimmed?: boolean;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ opacity: dimmed ? 0.4 : 1 }} contentContainerStyle={{ gap: 14, paddingBottom: 4 }}>
      {/* Tous */}
      <TouchableOpacity onPress={() => onSelect(null)} activeOpacity={0.85} style={{ alignItems: 'center', gap: 6, width: 56 }}>
        <View style={{
          width: 52, height: 52, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
          backgroundColor: sel === null ? Colors.primary : Chips,
          borderWidth: sel === null ? 0 : 1.5, borderColor: Colors.border,
        }}>
          <Icon name="users" size={22} color={sel === null ? Colors.brand : Colors.textMuted} />
        </View>
        <Text style={{ fontFamily: sel === null ? Fonts.uiExtraBold : Fonts.uiSemi, fontSize: 10.5, color: sel === null ? Colors.textPrimary : Colors.textSecondary }}>Tous</Text>
      </TouchableOpacity>

      {friends.map(f => {
        const on = sel === f.id;
        return (
          <TouchableOpacity key={f.id} onPress={() => onSelect(on ? null : f.id)} activeOpacity={0.85} style={{ alignItems: 'center', gap: 6, width: 56 }}>
            <View style={{ padding: on ? 3 : 2, borderRadius: 999, backgroundColor: on ? Colors.brand : (LeagueGradients[f.league] ?? LeagueGradients.gold)[1] }}>
              <View style={{ padding: on ? 2 : 0, borderRadius: 999, backgroundColor: on ? Colors.bg : 'transparent' }}>
                <Avatar name={f.name} size={on ? 44 : 48} radius={999} league={f.league} />
              </View>
            </View>
            <Text numberOfLines={1} style={{ fontFamily: on ? Fonts.uiExtraBold : Fonts.uiSemi, fontSize: 10.5, color: on ? Colors.textPrimary : Colors.textSecondary, maxWidth: 56 }}>
              {f.name.split(' ')[0]}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// ── Liste filtrée (export) ──
export function FeedList({ shown, myId, loading, selName, onReact, onReport, router, onOpen }: {
  shown: ActivityEvent[]; myId: string; loading: boolean; selName?: string;
  onReact: (id: string) => void; onReport: (e: ActivityEvent) => void; router: ReturnType<typeof useRouter>;
  onOpen?: (e: ActivityEvent) => void;
}) {
  return (
    <View style={{ gap: 14, marginTop: 14 }}>
      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : shown.length > 0 ? (
        shown.map(e => <ActivityCard key={e.id} e={e} myId={myId} onReact={() => onReact(e.id)} onPressActor={() => router.push(`/player/${e.player_id}` as any)} onPressPlayer={(id) => router.push(`/player/${id}` as any)} onPressComments={() => router.push(`/community/comments/${e.id}` as any)} onReport={e.player_id === myId ? undefined : () => onReport(e)} onOpen={onOpen ? () => onOpen(e) : undefined} />)
      ) : (
        <EmptyState name={selName?.split(' ')[0]} />
      )}
    </View>
  );
}

export function ActivityFeed({ myId }: { myId: string }) {
  const router = useRouter();
  const [friends, setFriends] = useState<SocialPlayer[]>([]);
  const [feed, setFeed] = useState<ActivityEvent[]>([]);
  const [sel, setSel] = useState<string | null>(null);   // player_id filtré
  const [loading, setLoading] = useState(true);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([getFriends(myId), getActivityFeed(myId), getHiddenPlayerIds(myId)]).then(([fr, fd, hidden]) => {
      setFriends(fr); setFeed(fd); setHiddenIds(hidden); setLoading(false);
    });
  }, [myId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const reportActivity = (e: ActivityEvent) => {
    if (e.player_id === myId) return;
    Alert.alert('Cette activité', undefined, [
      {
        text: 'Signaler', style: 'destructive',
        onPress: async () => {
          try {
            await reportContent({ reporterId: myId, targetType: 'activity', targetId: e.id, reportedPlayerId: e.player_id });
            Alert.alert('Merci', 'Activité signalée à la modération.');
          } catch {
            Alert.alert('Erreur', "Le signalement n'a pas pu être envoyé.");
          }
        },
      },
      { text: 'Annuler', style: 'cancel' },
    ]);
  };

  const react = async (eventId: string) => {
    // Optimiste
    setFeed(prev => prev.map(e => {
      if (e.id !== eventId) return e;
      const fire = e.reactions?.['🔥'] ?? [];
      const has = fire.includes(myId);
      const next = has ? fire.filter(id => id !== myId) : [...fire, myId];
      const reactions = { ...e.reactions };
      if (next.length) reactions['🔥'] = next; else delete reactions['🔥'];
      return { ...e, reactions };
    }));
    const updated = await toggleReaction(eventId);
    if (updated) setFeed(prev => prev.map(e => e.id === eventId ? { ...e, reactions: updated } : e));
  };

  const selName = friends.find(f => f.id === sel)?.name;
  const visibleFeed = feed.filter(e => !hiddenIds.has(e.player_id));
  const shown = sel ? visibleFeed.filter(e => e.player_id === sel) : visibleFeed;

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 110 }}>
      {/* Bandeau d'amis — tap = FILTRE le fil (pas de navigation profil) */}
      <FriendsBar friends={friends} sel={sel} onSelect={setSel} />

      {/* En-tête de filtre */}
      {sel && selName ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14, color: Colors.textPrimary }}>Activité de {selName.split(' ')[0]}</Text>
          <TouchableOpacity onPress={() => setSel(null)} activeOpacity={0.85} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Chips, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Icon name="x" size={12} color={Colors.textSecondary} stroke={2.6} />
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: Colors.textSecondary }}>Tout voir</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Fil (filtré par l'ami sélectionné) */}
      <FeedList shown={shown} myId={myId} loading={loading} selName={selName} onReact={react} onReport={reportActivity} router={router} />
    </ScrollView>
  );
}

function EmptyState({ name }: { name?: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 40, gap: 12 }}>
      <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: Chips, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="clock" size={24} color={Colors.textMuted} />
      </View>
      <Text style={{ fontFamily: Fonts.uiBold, fontSize: 14, color: Colors.textPrimary }}>Pas d'activité récente</Text>
      <Text style={{ fontFamily: Fonts.ui, fontSize: 13, color: Colors.textSecondary, maxWidth: 240, textAlign: 'center' }}>
        {name ? `${name} n'a rien publié pour l'instant.` : 'Suis des amis pour voir leurs résultats apparaître ici.'}
      </Text>
    </View>
  );
}
