import { useCallback, useState } from 'react';
import { View, Text, Image, ScrollView, Alert, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { usePlayer } from '../../hooks/usePlayer';
import { Colors, Fonts, eloToLevel } from '../../lib/theme';
import { HeaderActions } from '../../components/HeaderActions';
import { FriendsBar, FeedList } from '../../components/community/ActivityFeed';
import { getFriends, getActivityFeed, toggleReaction, getSuggestions, setFollow } from '../../lib/community';
import { getHiddenPlayerIds, reportContent } from '../../lib/moderation';
import { notifyPlayers } from '../../lib/notify';
import {
  getWeekStats, getSuggestedGame, getWeekendGames, getOpenGames, pickMoments, getMyMatchCount, getMyGameCount, deriveActivityState,
  shareMatchMoment, type WeekStats, type SuggestedGame, type WeekendGame, type ActivityState,
} from '../../lib/activityFeed';
import { getRecapMonths, getMonthlyRecap, type MonthlyRecap } from '../../lib/bilan';
import { WeekStatsCard } from '../../components/activity/WeekStatsCard';
import { JoinHeroCard } from '../../components/activity/JoinHeroCard';
import { WeekendRail } from '../../components/activity/WeekendRail';
import { MomentsRail } from '../../components/activity/MomentsRail';
import { MomentOverlay } from '../../components/activity/MomentOverlay';
import { EmptyHero } from '../../components/activity/EmptyHero';
import { OnboardingChecklist } from '../../components/activity/OnboardingChecklist';
import { DiscoveryRail } from '../../components/activity/DiscoveryRail';
import { QuietFeedCard } from '../../components/activity/QuietFeedCard';
import { FriendsRanking } from '../../components/activity/FriendsRanking';
import { BilanBanner } from '../../components/activity/BilanBanner';
import { MomentComposer } from '../../components/activity/MomentComposer';
import StoryMatchPicker from '../../components/StoryMatchPicker';
import type { StoryMatchData } from '../../components/story/storyTheme';
import { track } from '../../lib/analytics';
import type { SocialPlayer, ActivityEvent } from '../../types';

export default function ActiviteTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { player } = usePlayer();
  const myId = player?.id;

  const [friends, setFriends] = useState<SocialPlayer[]>([]);
  const [feed, setFeed] = useState<ActivityEvent[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false); // 1er chargement terminé (évite le flash onboarding)
  const [week, setWeek] = useState<WeekStats>({ matches: 0, results: [], eloDelta: 0 });
  const [hero, setHero] = useState<SuggestedGame | null>(null);
  const [weekend, setWeekend] = useState<WeekendGame[]>([]);
  const [openMomentId, setOpenMomentId] = useState<string | null>(null);
  const [totalMatches, setTotalMatches] = useState(0);
  const [totalGames, setTotalGames] = useState(0);
  const [suggestions, setSuggestions] = useState<SocialPlayer[]>([]);
  const [openGames, setOpenGames] = useState<WeekendGame[]>([]);
  const [bilanRecap, setBilanRecap] = useState<MonthlyRecap | null>(null);
  // Partage in-app d'un match (compositeur Moment).
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingMatch, setPendingMatch] = useState<StoryMatchData | null>(null);
  const [pendingMatchId, setPendingMatchId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [posting, setPosting] = useState(false);

  const load = useCallback(() => {
    if (!myId) return;
    setLoading(true);
    (async () => {
      const [fr, fd, hidden, w, h, we, mc, gc, sugg, og, months] = await Promise.all([
        getFriends(myId), getActivityFeed(myId, 50, true), getHiddenPlayerIds(myId),
        getWeekStats(myId), getSuggestedGame(myId), getWeekendGames(myId),
        getMyMatchCount(myId), getMyGameCount(myId),
        player ? getSuggestions(player, 8) : Promise.resolve([] as SocialPlayer[]),
        getOpenGames(myId, 8), getRecapMonths(myId),
      ]);
      setFriends(fr); setFeed(fd); setHiddenIds(hidden);
      setWeek(w); setHero(h); setWeekend(we);
      setTotalMatches(mc); setTotalGames(gc);
      setSuggestions(sugg); setOpenGames(og); setLoading(false); setReady(true);
      const latest = months[0];
      setBilanRecap(latest ? await getMonthlyRecap(myId, latest.key) : null);
    })();
  }, [myId]);

  useFocusEffect(useCallback(() => { track('activity_tab_opened', { source: 'tab' }); load(); }, [load]));

  const selectFriend = (id: string | null) => {
    setSel(id);
    if (id) track('activity_friend_filter', { friend_id: id });
  };

  const react = async (eventId: string) => {
    if (!myId) return;
    setFeed(prev => prev.map(e => {
      if (e.id !== eventId) return e;
      const fire = e.reactions?.['🔥'] ?? [];
      const has = fire.includes(myId);
      const next = has ? fire.filter(id => id !== myId) : [...fire, myId];
      const reactions = { ...e.reactions };
      if (next.length) reactions['🔥'] = next; else delete reactions['🔥'];
      track('activity_like_toggled', { activity_id: eventId, liked: !has });
      return { ...e, reactions };
    }));
    const updated = await toggleReaction(eventId);
    if (updated) setFeed(prev => prev.map(e => e.id === eventId ? { ...e, reactions: updated } : e));
  };

  const reportActivity = (e: ActivityEvent) => {
    if (!myId || e.player_id === myId) return;
    Alert.alert('Cette activité', undefined, [
      { text: 'Signaler', style: 'destructive', onPress: async () => {
        try { await reportContent({ reporterId: myId, targetType: 'activity', targetId: e.id, reportedPlayerId: e.player_id }); Alert.alert('Merci', 'Activité signalée à la modération.'); }
        catch { Alert.alert('Erreur', "Le signalement n'a pas pu être envoyé."); }
      } },
      { text: 'Annuler', style: 'cancel' },
    ]);
  };

  const pingFriend = (f: SocialPlayer) => {
    if (!player) return;
    notifyPlayers({ playerIds: [f.id], title: `${player.name} veut jouer 🎾`, body: 'Propose-lui une partie cette semaine !', data: { type: 'ping' } });
    Alert.alert('Envoyé', `${f.name.split(' ')[0]} a reçu ton ping.`);
  };

  const followPlayer = (id: string) => { if (myId) setFollow(myId, id, true); };

  const publishMoment = async (caption: string) => {
    if (!pendingMatchId) return;
    setPosting(true);
    const err = await shareMatchMoment(pendingMatchId, caption);
    setPosting(false); setComposerOpen(false);
    if (!err) { Alert.alert('Publié', 'Ton match est partagé dans le fil.'); load(); }
    else Alert.alert('Publication impossible', err);
  };

  const selName = friends.find(f => f.id === sel)?.name;
  const visibleFeed = feed.filter(e => !hiddenIds.has(e.player_id));
  // Le fil d'activité du bas est limité aux 2 dernières semaines.
  const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;
  const recentFeed = visibleFeed.filter(e => Date.now() - new Date(e.created_at).getTime() <= TWO_WEEKS);
  const shown = sel ? recentFeed.filter(e => e.player_id === sel) : recentFeed;
  const moments = pickMoments(visibleFeed, myId);
  const liveMoment = openMomentId ? visibleFeed.find(e => e.id === openMomentId) ?? null : null;

  const recentFriendActivity = feed.filter(
    e => e.player_id !== myId && Date.now() - new Date(e.created_at).getTime() <= 7 * 24 * 60 * 60 * 1000,
  ).length;
  const state: ActivityState = deriveActivityState({ totalMatches, totalGames, friendsCount: friends.length, recentFriendActivity });
  // Δ niveau de la semaine (depuis l'ELO interne ; jamais d'ELO affiché).
  const curElo = player?.elo_score ?? 0;
  const weekLevelDelta = player ? eloToLevel(curElo) - eloToLevel(curElo - week.eloDelta) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <HeaderActions top={insets.top + 6} right={14} tint="light" />
      <View style={{ backgroundColor: Colors.heroBg, paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 16, borderBottomLeftRadius: 32, borderBottomRightRadius: 32 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
          <Image source={require('../../assets/auth/splash-racket.png')} style={{ width: 22, height: 22 }} resizeMode="contain" />
          <Image source={require('../../assets/auth/splash-wordmark.png')} style={{ width: 100, height: 22, marginLeft: -7 }} resizeMode="contain" />
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 28, fontFamily: Fonts.welcome, color: Colors.textOnDark, letterSpacing: 0.2, textAlign: 'center' }}>
            L'<Text style={{ color: Colors.brand }}>Activité</Text>
          </Text>
          <Text style={{ fontSize: 12, fontFamily: Fonts.uiSemi, fontWeight: '600', color: Colors.textSecondary, marginTop: 2, textAlign: 'center' }}>Partage tes matchs, anime ta communauté</Text>
        </View>
      </View>

      {!myId ? null : !ready ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 110 }}>
          {state === 'onboarding' ? (
            <>
              {/* Accueil */}
              <View style={{ marginTop: 14 }}>
                <Text style={{ fontFamily: Fonts.welcome, fontSize: 24, color: Colors.textPrimary }}>Bienvenue {player.name.split(' ')[0]} 👋</Text>
                <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 13, color: Colors.textSecondary, marginTop: 4 }}>
                  L'Activité, c'est ton fil padel : tes matchs, ceux de tes amis, et les parties à rejoindre. Commence ici 👇
                </Text>
              </View>

              {/* Checklist interactive auto-cochée */}
              <OnboardingChecklist steps={[
                { label: 'Créer ou rejoindre un match', done: totalGames > 0, onPress: () => router.push('/(tabs)/lobby?create=1' as any) },
                { label: 'Suivre des joueurs', done: friends.length > 0, onPress: () => router.push('/community/friends' as any) },
                { label: 'Compléter ton profil', hint: 'niveau, club…', done: !!(player.clubs?.length || player.court_side || player.playing_days?.length), onPress: () => router.push(`/player/${myId}` as any) },
              ]} />

              {/* Parties ouvertes à rejoindre */}
              <WeekendRail games={openGames} title="Parties ouvertes près de toi" onOpen={(id) => router.push(`/(tabs)/lobby?gameId=${id}` as any)} />

              {/* Joueurs à suivre */}
              <DiscoveryRail players={suggestions} title="Joueurs à suivre" onPress={(id) => router.push(`/player/${id}` as any)} onFollow={followPlayer} />
            </>
          ) : state === 'friends_inactive' ? (
            <>
              <BilanBanner recap={bilanRecap} onPress={() => router.push("/bilan/last" as any)} />
              <WeekStatsCard stats={week} levelDelta={weekLevelDelta} />
              {/* Mes propres moments restent visibles même quand les amis sont
                  inactifs ; sinon on invite à en partager un. */}
              {moments.length > 0 ? (
                <MomentsRail moments={moments} onShareMatch={() => setPickerOpen(true)} onOpen={(e) => setOpenMomentId(e.id)} />
              ) : (
                <EmptyHero variant="expand"
                  subtitle="Anime le fil — partage un moment ou propose une partie."
                  ctaLabel="Partage un moment"
                  onPress={() => setPickerOpen(true)} />
              )}
              <FriendsBar friends={friends} sel={sel} onSelect={selectFriend} dimmed />
              <QuietFeedCard friends={friends} onPing={pingFriend} />
            </>
          ) : (
            <>
              <BilanBanner recap={bilanRecap} onPress={() => router.push("/bilan/last" as any)} />
              <WeekStatsCard stats={week} levelDelta={weekLevelDelta} />
              {hero ? <JoinHeroCard game={hero} onOpen={(id) => router.push(`/(tabs)/lobby?gameId=${id}` as any)} /> : null}
              <MomentsRail moments={moments} onShareMatch={() => setPickerOpen(true)} onOpen={(e) => setOpenMomentId(e.id)} />
              <WeekendRail games={weekend} onOpen={(id) => router.push(`/(tabs)/lobby?gameId=${id}` as any)} />

              {player ? <FriendsRanking me={player} friends={friends} monthLabel={bilanRecap?.label} /> : null}

              <View style={{ height: 1, backgroundColor: Colors.border, marginVertical: 18 }} />
              <FriendsBar friends={friends} sel={sel} onSelect={selectFriend} />
              {sel && selName ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
                  <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14, color: Colors.textPrimary }}>Activité de {selName.split(' ')[0]}</Text>
                  <TouchableOpacity onPress={() => setSel(null)} activeOpacity={0.85} style={{ backgroundColor: Colors.bgCardAlt, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: Colors.border }}>
                    <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: Colors.textSecondary }}>Tout voir</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              <FeedList shown={shown} myId={myId} loading={loading} selName={selName} onReact={react} onReport={reportActivity} router={router} onOpen={(e) => setOpenMomentId(e.id)} />
            </>
          )}
        </ScrollView>
      )}

      <MomentOverlay
        event={liveMoment}
        myId={myId ?? ''}
        onReact={() => { if (openMomentId) react(openMomentId); }}
        onComment={() => { const id = openMomentId; setOpenMomentId(null); if (id) router.push(`/community/comments/${id}` as any); }}
        onPressActor={(pid) => { setOpenMomentId(null); router.push(`/player/${pid}` as any); }}
        onClose={() => setOpenMomentId(null)}
      />

      {/* Partage in-app d'un match : choisir → composer → publier (Moment) */}
      {myId ? (
        <>
          <StoryMatchPicker
            visible={pickerOpen}
            playerId={myId}
            recentWithinDays={7}
            subtitle="pour un Moment de la semaine"
            onClose={() => setPickerOpen(false)}
            onPick={(m, id) => { setPickerOpen(false); setPendingMatch(m); setPendingMatchId(id); setComposerOpen(true); }}
          />
          <MomentComposer
            visible={composerOpen}
            match={pendingMatch}
            busy={posting}
            onClose={() => setComposerOpen(false)}
            onPublish={publishMoment}
          />
        </>
      ) : null}
    </View>
  );
}
