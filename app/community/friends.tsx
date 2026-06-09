import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { usePlayer } from '../../hooks/usePlayer';
import { Colors, Fonts, LeagueGradients } from '../../lib/theme';
import {
  getFriends, getSuggestions, searchPlayers, getActivityFeed, toggleReaction, setFollow,
} from '../../lib/community';
import { getHiddenPlayerIds, reportContent } from '../../lib/moderation';
import { Avatar } from '../../components/community/Avatar';
import { Card, Kicker, NavBar, BrandBtn, Chips, Divider, Cream, CreamBorder } from '../../components/community/ui';
import { Icon } from '../../components/community/icons';
import { PlayerRow } from '../../components/community/PlayerRow';
import { ActivityCard } from '../../components/community/ActivityCard';
import type { SocialPlayer, ActivityEvent } from '../../types';

export default function FriendsScreen() {
  const router = useRouter();
  const { player } = usePlayer();
  const [tab, setTab] = useState<'activity' | 'search'>('activity');

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <NavBar title="Mes amis" onBack={() => router.back()} />

      {/* Segmented control */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', gap: 4, backgroundColor: Chips, borderWidth: 1, borderColor: Colors.border, borderRadius: 999, padding: 4 }}>
          {([['activity', 'Activité'], ['search', 'Recherche']] as const).map(([key, label]) => {
            const on = tab === key;
            return (
              <TouchableOpacity key={key} onPress={() => setTab(key)} activeOpacity={0.9} style={{
                flex: 1, height: 38, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
                backgroundColor: on ? Colors.brand : 'transparent',
                ...(on ? { shadowColor: Colors.brand, shadowOpacity: 0.4, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 } : {}),
              }}>
                <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: on ? Colors.primary : Colors.textSecondary }}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {!player ? null : tab === 'activity'
        ? <ActivityBody myId={player.id} />
        : <SearchBody myId={player.id} onInvite={() => router.push('/community/invite')} player={player} />}
    </View>
  );
}

// ─── Onglet Activité ─────────────────────────────────────────
function ActivityBody({ myId }: { myId: string }) {
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 4 }}>
        {/* Tous */}
        <TouchableOpacity onPress={() => setSel(null)} activeOpacity={0.85} style={{ alignItems: 'center', gap: 6, width: 56 }}>
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
            <TouchableOpacity key={f.id} onPress={() => setSel(on ? null : f.id)} activeOpacity={0.85} style={{ alignItems: 'center', gap: 6, width: 56 }}>
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
      <View style={{ gap: 14, marginTop: 14 }}>
        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
        ) : shown.length > 0 ? (
          shown.map(e => <ActivityCard key={e.id} e={e} myId={myId} onReact={() => react(e.id)} onPressActor={() => router.push(`/player/${e.player_id}` as any)} onPressComments={() => router.push(`/community/comments/${e.id}` as any)} onReport={e.player_id === myId ? undefined : () => reportActivity(e)} />)
        ) : (
          <EmptyState name={selName?.split(' ')[0]} />
        )}
      </View>
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

// ─── Champ de recherche ISOLÉ ────────────────────────────────
// Non-contrôlé (ref + defaultValue) + sans état de focus + memo :
//  • toucher le champ ne déclenche AUCUN re-render → le clavier ne se ferme pas ;
//  • les re-renders du parent (suggestions/résultats) ne le touchent jamais (memo) ;
//  • le « × » reste monté (opacité) pour ne pas blur en ajoutant/retirant un frère.
const SearchField = memo(function SearchField({ onChange }: { onChange: (t: string) => void }) {
  const ref = useRef<TextInput>(null);
  const [hasText, setHasText] = useState(false);
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 4 }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, borderRadius: 14, paddingHorizontal: 14,
        backgroundColor: Colors.bgCard, borderWidth: 1.6, borderColor: Colors.border,
      }}>
        <Icon name="search" size={18} color={Colors.textMuted} />
        <TextInput
          ref={ref}
          defaultValue=""
          onChangeText={(t) => { setHasText(t.length > 0); onChange(t); }}
          placeholder="Tape au moins 3 lettres…"
          placeholderTextColor={Colors.textMuted}
          autoCorrect={false}
          autoCapitalize="none"
          autoComplete="off"
          returnKeyType="search"
          underlineColorAndroid="transparent"
          style={{ flex: 1, fontFamily: Fonts.ui, fontSize: 15, color: Colors.textPrimary, paddingVertical: 0 }}
        />
        <TouchableOpacity onPress={() => { ref.current?.clear(); setHasText(false); onChange(''); }} disabled={!hasText} hitSlop={8} style={{ opacity: hasText ? 1 : 0, width: 18 }}>
          <Text style={{ color: Colors.textMuted, fontSize: 18 }}>×</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

// ─── Onglet Recherche ────────────────────────────────────────
function SearchBody({ myId, onInvite, player }: {
  myId: string; onInvite: () => void; player: any;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SocialPlayer[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<SocialPlayer[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Référence stable → SearchField (memo) ne se re-rend jamais à cause du parent.
  const handleChange = useCallback((t: string) => setQ(t), []);

  useEffect(() => { getSuggestions(player).then(setSuggestions); }, [player]);

  // Recherche déclenchée à ≥ 3 lettres, anti-rebond 250 ms (la dernière frappe gagne).
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) { setResults(null); setSearching(false); return; }
    let active = true;
    setSearching(true);
    const t = setTimeout(() => {
      searchPlayers(myId, term).then(r => { if (active) { setResults(r); setSearching(false); } });
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [q, myId]);

  const onFollow = async (list: SocialPlayer[], setList: (l: SocialPlayer[]) => void, p: SocialPlayer) => {
    setBusyId(p.id);
    await setFollow(myId, p.id, !p.following);
    setList(list.map(x => x.id === p.id ? { ...x, following: !x.following } : x));
    setBusyId(null);
  };

  return (
    <View style={{ flex: 1 }}>
      <SearchField onChange={handleChange} />

      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="none" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 110 }}>
        {/* Recherche en cours */}
        {searching && results === null && (
          <ActivityIndicator color={Colors.brand} style={{ marginTop: 24 }} />
        )}

        {/* < 3 lettres → suggestions */}
        {results === null && !searching && (
          <View style={{ marginTop: 18 }}>
            <Kicker style={{ marginBottom: 10 }}>Suggestions pour toi</Kicker>
            {suggestions.length > 0 ? (
              <Card pad={16}>
                {suggestions.map((p, i) => (
                  <View key={p.id}>
                    <PlayerRow p={p} sub={p.reason} busy={busyId === p.id} onFollow={() => onFollow(suggestions, setSuggestions, p)} onPress={() => router.push(`/player/${p.id}` as any)} />
                    {i < suggestions.length - 1 ? <View style={{ height: 1, backgroundColor: Divider }} /> : null}
                  </View>
                ))}
              </Card>
            ) : null}
            <InviteBlock title="Tu ne trouves pas le joueur ?" sub="Invite-le sur PagMatch — il rejoint, tu gagnes un trophée parrainage." onInvite={onInvite} />
          </View>
        )}

        {/* ≥ 3 lettres → résultats */}
        {results !== null && results.length > 0 && (
          <View style={{ marginTop: 14 }}>
            <Kicker style={{ marginBottom: 10 }}>{results.length} joueur{results.length > 1 ? 's' : ''}</Kicker>
            <Card pad={16}>
              {results.map((p, i) => (
                <View key={p.id}>
                  <PlayerRow p={p} busy={busyId === p.id} onFollow={() => onFollow(results, setResults as any, p)} onPress={() => router.push(`/player/${p.id}` as any)} />
                  {i < results.length - 1 ? <View style={{ height: 1, backgroundColor: Divider }} /> : null}
                </View>
              ))}
            </Card>
          </View>
        )}

        {results !== null && results.length === 0 && !searching && (
          <View style={{ marginTop: 14 }}>
            <InviteBlock title={`Aucun joueur « ${q.trim()} »`} sub="Invite-le sur PagMatch pour jouer ensemble." onInvite={onInvite} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function InviteBlock({ title, sub, onInvite }: { title: string; sub: string; onInvite: () => void }) {
  return (
    <View style={{ marginTop: 18, backgroundColor: Cream, borderWidth: 1, borderColor: CreamBorder, borderRadius: 18, padding: 20, alignItems: 'center' }}>
      <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 16, color: Colors.textPrimary, marginBottom: 4, textAlign: 'center' }}>{title}</Text>
      <Text style={{ fontFamily: Fonts.ui, fontSize: 13, color: Colors.textSecondary, marginBottom: 16, textAlign: 'center' }}>{sub}</Text>
      <BrandBtn
        label="Invite-le sur PagMatch"
        icon={<Icon name="arrowRight" size={17} color={Colors.primary} stroke={2.4} rotate={-45} />}
        onPress={onInvite}
        style={{ alignSelf: 'stretch' }}
      />
    </View>
  );
}
