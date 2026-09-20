import { useCallback, useState } from 'react';
import { View, Text, Image, ScrollView, Alert, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { usePlayer } from '../../hooks/usePlayer';
import { Colors, Fonts } from '../../lib/theme';
import { HeaderActions } from '../../components/HeaderActions';
import { FriendsBar, FeedList } from '../../components/community/ActivityFeed';
import { getFriends, getActivityFeed, toggleReaction, getSuggestions, setFollow } from '../../lib/community';
import { getHiddenPlayerIds, reportContent } from '../../lib/moderation';
import { isAmbassador } from '../../lib/ambassador';
import {
  availabilitySlots, isSlotActive, declareAvailability, clearAvailability, fetchMyAvailability,
  circleVisibilityLabel, type AvailabilityRow, type Slot,
} from '../../lib/availability';
import {
  getWeekStats, getOpenGames, getMyMatchCount, getMyGameCount, deriveActivityState,
  shareMatchMoment, type WeekStats, type WeekendGame, type ActivityState,
} from '../../lib/activityFeed';
import { getRecapMonths, getMonthlyRecap, type MonthlyRecap } from '../../lib/bilan';
import { fetchCircleBilans, type CircleBilan } from '../../lib/bilanCircle';
import { featuredBlock, featuredDayLabel, fetchClubCity, weekendWindow } from '../../lib/hubFeatured';
import { WeekStatsCard } from '../../components/activity/WeekStatsCard';
import { WeekendRail } from '../../components/activity/WeekendRail';
import { MomentOverlay } from '../../components/activity/MomentOverlay';
import { BilanStory } from '../../components/activity/BilanStory';
import { OnboardingChecklist } from '../../components/activity/OnboardingChecklist';
import { DiscoveryRail } from '../../components/activity/DiscoveryRail';
import { FriendsRanking } from '../../components/activity/FriendsRanking';
import { BilanBanner } from '../../components/activity/BilanBanner';
import { CircleBilansRail } from '../../components/activity/CircleBilansRail';
import { FeaturedTaulier } from '../../components/activity/FeaturedTaulier';
import { FeaturedMercato } from '../../components/activity/FeaturedMercato';
import { FeaturedPantheon } from '../../components/activity/FeaturedPantheon';
import { MomentComposer } from '../../components/activity/MomentComposer';
import { DispoCard } from '../../components/activity/DispoCard';
import { InvitationCard } from '../../components/activity/InvitationCard';
import { PostMatchVoteCard } from '../../components/activity/PostMatchVoteCard';
import StoryMatchPicker from '../../components/StoryMatchPicker';
import type { StoryMatchData } from '../../components/story/storyTheme';
import { track } from '../../lib/analytics';
import type { SocialPlayer, ActivityEvent } from '../../types';

// Bannière Bilan : limitée aux 7 premiers jours du mois (README « Ce qui est
// retiré ») — un bilan du mois précédent n'a plus rien à dire passé cette
// fenêtre.
function isBilanWindow(now = new Date()): boolean {
  return now.getDate() <= 7;
}

// En-tête commun des trois blocs « À la une » (handoff §4).
function FeaturedHeader({ day }: { day: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 16 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.brand }} />
      <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 9.5, letterSpacing: 1.4, color: Colors.textMuted }}>
        {`À LA UNE · ${day}`}
      </Text>
    </View>
  );
}

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
  const [myAvailability, setMyAvailability] = useState<AvailabilityRow[]>([]);
  const [openMomentId, setOpenMomentId] = useState<string | null>(null);
  const [totalMatches, setTotalMatches] = useState(0);
  const [totalGames, setTotalGames] = useState(0);
  const [suggestions, setSuggestions] = useState<SocialPlayer[]>([]);
  const [openGames, setOpenGames] = useState<WeekendGame[]>([]);
  const [bilanRecap, setBilanRecap] = useState<MonthlyRecap | null>(null);
  // Les bilans des joueurs suivis, hors fil (le fil s'arrête à 14 jours).
  const [circleBilans, setCircleBilans] = useState<CircleBilan[]>([]);
  const [openBilanId, setOpenBilanId] = useState<string | null>(null);
  // Ville du club favori — sous-titre du header et Panthéon du dimanche.
  const [city, setCity] = useState<string | null>(null);
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
      const monClub = player?.clubs?.[0] ?? '';
      const [fr, fd, hidden, w, av, mc, gc, sugg, og, months, cb, ct] = await Promise.all([
        getFriends(myId), getActivityFeed(myId, 50, true), getHiddenPlayerIds(myId),
        getWeekStats(myId), fetchMyAvailability(myId),
        getMyMatchCount(myId), getMyGameCount(myId),
        player ? getSuggestions(player, 8) : Promise.resolve([] as SocialPlayer[]),
        getOpenGames(myId, 8), getRecapMonths(myId), fetchCircleBilans(myId, 12),
        monClub ? fetchClubCity(monClub) : Promise.resolve(null),
      ]);
      setFriends(fr); setFeed(fd); setHiddenIds(hidden);
      setWeek(w); setMyAvailability(av);
      setTotalMatches(mc); setTotalGames(gc);
      setSuggestions(sugg); setOpenGames(og); setCircleBilans(cb); setCity(ct);
      setLoading(false); setReady(true);
      const latest = months[0];
      setBilanRecap(latest ? await getMonthlyRecap(myId, latest.key) : null);
    })();
  }, [myId]);

  // Coche/décoche un créneau de dispo — chips du header ET, en état calme,
  // celles (identiques) de DispoCard.
  const toggleSlot = async (slot: Slot) => {
    if (!myId) return;
    const active = isSlotActive(slot, myAvailability);
    if (active) await clearAvailability(myId, slot); else await declareAvailability(myId, slot);
    setMyAvailability(await fetchMyAvailability(myId));
  };

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

  // Réaction 🔥 sur un bilan du cercle. Le post n'est pas forcément dans le fil
  // (il peut dater de plus de 14 jours) : on met à jour la liste du bloc dédié,
  // pas `feed`.
  const reactCircleBilan = async (eventId: string) => {
    if (!myId) return;
    setCircleBilans(prev => prev.map(b => {
      if (b.eventId !== eventId) return b;
      const fire = b.reactions['🔥'] ?? [];
      const has = fire.includes(myId);
      const next = has ? fire.filter(id => id !== myId) : [...fire, myId];
      const reactions = { ...b.reactions };
      if (next.length) reactions['🔥'] = next; else delete reactions['🔥'];
      track('activity_like_toggled', { activity_id: eventId, liked: !has });
      return { ...b, reactions };
    }));
    const updated = await toggleReaction(eventId);
    if (updated) setCircleBilans(prev => prev.map(b => b.eventId === eventId ? { ...b, reactions: updated } : b));
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
  const liveMoment = openMomentId ? visibleFeed.find(e => e.id === openMomentId) ?? null : null;
  const circleBilansShown = circleBilans.filter(b => !hiddenIds.has(b.playerId));
  const openBilan = openBilanId ? circleBilans.find(b => b.eventId === openBilanId) ?? null : null;

  const recentFriendActivity = feed.filter(
    e => e.player_id !== myId && Date.now() - new Date(e.created_at).getTime() <= 7 * 24 * 60 * 60 * 1000,
  ).length;
  const state: ActivityState = deriveActivityState({ totalMatches, totalGames, friendsCount: friends.length, recentFriendActivity });
  // Ville du club favori (le club lui-même tant qu'on ne la connaît pas) +
  // date du jour, en toutes lettres.
  const today = new Date();
  const monClub = player?.clubs?.[0] ?? '';
  const dateEnLettres = today.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
  const headerSubtitle = [city ?? monClub, dateEnLettres].filter(Boolean).join(' · ');
  // « À la une » : un bloc par jour. Le mercato a besoin de savoir si je me
  // suis déjà déclaré sur le week-end visé.
  const featured = featuredBlock(today);
  const weekend = weekendWindow(today);
  const iAmInWeekend = myAvailability.some(r =>
    Date.parse(r.slot_start) < weekend.end.getTime() && Date.parse(r.slot_end) > weekend.start.getTime());

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <HeaderActions top={insets.top + 6} right={14} tint="light" />
      <View style={{ backgroundColor: Colors.heroBg, paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 16, borderBottomLeftRadius: 32, borderBottomRightRadius: 32 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
          <Image source={require('../../assets/auth/splash-racket.png')} style={{ width: 22, height: 22 }} resizeMode="contain" />
          <Image source={require('../../assets/auth/splash-wordmark.png')} style={{ width: 100, height: 22, marginLeft: -7 }} resizeMode="contain" />
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text numberOfLines={2}
            style={{ fontSize: 28, lineHeight: 36, fontFamily: Fonts.welcome, color: Colors.textOnDark, letterSpacing: 0.2, textAlign: 'center', paddingRight: 5 }}>
            Qui <Text style={{ color: Colors.brand }}>joue</Text> ?
          </Text>
          {headerSubtitle ? (
            <Text style={{ fontSize: 12, fontFamily: Fonts.uiSemi, fontWeight: '600', color: Colors.textSecondary, marginTop: 2, textAlign: 'center' }}>{headerSubtitle}</Text>
          ) : null}
        </View>

        {/* Bloc dispo : « Tu es dispo quand ? » + trois chips multi-sélection. */}
        {myId ? (
          <View style={{ marginTop: 16 }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 9.5, letterSpacing: 0.8, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' }}>
              TU ES DISPO QUAND ?
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              {availabilitySlots().map(s => {
                const on = isSlotActive(s, myAvailability);
                return (
                  <TouchableOpacity key={s.key} onPress={() => toggleSlot(s)} activeOpacity={0.85} style={{
                    flex: 1, borderRadius: 999, paddingVertical: 11, alignItems: 'center',
                    backgroundColor: on ? Colors.brand : 'transparent',
                    borderWidth: 1.5, borderColor: on ? Colors.brand : 'rgba(255,255,255,0.28)',
                  }}>
                    <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12.5, color: on ? Colors.primary : '#FFFFFF' }}>{s.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 12, color: Colors.textSecondary, marginTop: 10, textAlign: 'center' }}>
              {circleVisibilityLabel(friends.length)}
            </Text>
          </View>
        ) : null}
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
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: Fonts.welcome, fontSize: 24, lineHeight: 31, color: Colors.textPrimary, paddingRight: 5 }}>Bienvenue {player.name.split(' ')[0]}</Text>
                <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 13, color: Colors.textSecondary, marginTop: 4 }}>
                  L'Activité, c'est ton fil padel : tes matchs, ceux de tes amis, et les parties à rejoindre. Commence ici :
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
          ) : (
            <>
              {/* À la une : un seul sujet par jour — le club en début de
                  semaine, le week-end au milieu, le bilan de la semaine le
                  dimanche (handoff §4). */}
              <FeaturedHeader day={featuredDayLabel(today)} />
              {featured === 'taulier' ? (
                <FeaturedTaulier club={monClub} myId={myId} onOpenPlayer={(id) => router.push(`/player/${id}` as any)} />
              ) : featured === 'mercato' ? (
                <FeaturedMercato
                  myId={myId}
                  myElo={player?.elo_score}
                  myClubs={player?.clubs}
                  friendIds={friends.map(f => f.id)}
                  iAmInWeekend={iAmInWeekend}
                  onDeclare={() => {
                    const samedi = availabilitySlots(today).find(s => s.key === 'saturday');
                    if (samedi) toggleSlot(samedi);
                  }}
                />
              ) : (
                <FeaturedPantheon city={city ?? ''} myId={myId} />
              )}

              {/* Bilan : seulement en tout début de mois, sinon il n'a plus
                  grand-chose à dire (README « Ce qui est retiré »). */}
              {isBilanWindow() ? <BilanBanner recap={bilanRecap} onPress={() => router.push("/bilan/last" as any)} /> : null}

              {/* Qui joue quand : dispo ce soir, puis l'invitation reçue. */}
              <DispoCard
                playerId={myId}
                playerName={player.name}
                playerAvatarPath={player.avatar_path}
                playerIsAmbassador={isAmbassador(player)}
                friendIds={friends.map(f => f.id)}
                mine={myAvailability}
                onToggleSlot={toggleSlot}
              />
              <InvitationCard playerId={myId} />

              {/* Qu'est-ce qui s'est passé : le vote d'après-match remonté. */}
              <PostMatchVoteCard playerId={myId} />

              <WeekStatsCard stats={week} />
              {player ? <FriendsRanking me={player} friends={friends} /> : null}

              {/* Place dédiée aux bilans des autres : le fil les perd au bout
                  de 14 jours, ici ils restent consultables. */}
              <CircleBilansRail bilans={circleBilansShown} myId={myId} onOpen={(b) => setOpenBilanId(b.eventId)} />

              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 4 }}>
                <Text numberOfLines={1} style={{ fontFamily: Fonts.welcome, fontSize: 16, lineHeight: 21, color: Colors.textPrimary, paddingRight: 6, flexShrink: 1 }}>
                  Ce que ton cercle a fait
                </Text>
                <TouchableOpacity onPress={() => selectFriend(null)} hitSlop={8}>
                  <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: Colors.textSecondary }}>Tout le fil →</Text>
                </TouchableOpacity>
              </View>
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

      {/* Lecteur d'un bilan ouvert depuis le bloc du cercle. */}
      {openBilan ? (
        <BilanStory
          recap={openBilan.recap}
          authorName={openBilan.name}
          authorAvatarPath={openBilan.avatarPath}
          myId={myId ?? ''}
          reactions={openBilan.reactions}
          onReact={() => reactCircleBilan(openBilan.eventId)}
          onComment={() => { const id = openBilan.eventId; setOpenBilanId(null); router.push(`/community/comments/${id}` as any); }}
          onClose={() => setOpenBilanId(null)}
        />
      ) : null}

      {liveMoment?.type === 'bilan' && liveMoment.payload.recap ? (
        <BilanStory
          recap={liveMoment.payload.recap as MonthlyRecap}
          authorName={liveMoment.actor?.name}
          authorAvatarPath={(liveMoment.actor as any)?.avatar_path}
          myId={myId ?? ''}
          reactions={liveMoment.reactions}
          onReact={() => { if (openMomentId) react(openMomentId); }}
          onComment={() => { const id = openMomentId; setOpenMomentId(null); if (id) router.push(`/community/comments/${id}` as any); }}
          onClose={() => setOpenMomentId(null)}
        />
      ) : (
        <MomentOverlay
          event={liveMoment}
          myId={myId ?? ''}
          onReact={() => { if (openMomentId) react(openMomentId); }}
          onComment={() => { const id = openMomentId; setOpenMomentId(null); if (id) router.push(`/community/comments/${id}` as any); }}
          onPressActor={(pid) => { setOpenMomentId(null); router.push(`/player/${pid}` as any); }}
          onClose={() => setOpenMomentId(null)}
        />
      )}

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
