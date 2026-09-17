import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Modal,
  ActivityIndicator, LayoutAnimation,
  Platform, UIManager, Image, useWindowDimensions,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../hooks/usePlayer';
import { useNotificationCount } from '../../hooks/useNotificationCount';
import { supabase } from '../../lib/supabase';
import { staysInUpcoming } from '../../lib/games';
import { useOrigin } from '../../hooks/useOrigin';
import { Colors, Fonts } from '../../lib/theme';
import { formatFrmtRanking } from '../../lib/frmt-match';
import { fetchPlayerTotals, EMPTY_TOTALS } from '../../lib/playerStats';
import { isAmbassador } from '../../lib/ambassador';
import { HeaderActions } from '../../components/HeaderActions';
import { Icon } from '../../components/community/icons';
import { BadgePill } from '../../components/profile/BadgePill';
import { useActiveVoteBadges } from '../../components/profile/BadgeDefsProvider';
import { isBadgeVisible } from '../../lib/badges';
import { HomeProfileCard } from '../../components/home/HomeProfileCard';
import { HomePrimaryActions } from '../../components/home/HomePrimaryActions';
import { UpcomingMatchCard } from '../../components/home/UpcomingMatchCard';
import { HomeRankButton } from '../../components/home/HomeRankButton';
import { HomeTournaments } from '../../components/home/HomeTournaments';
import { OpenGamesSlot } from '../../components/home/OpenGamesSlot';
import { homeSectionSizes, COMPACT_THRESHOLD_H, TOURNAMENTS_RESERVE } from '../../lib/homeLayout';
import { suggestibleGames, homeSlot } from '../../lib/homeSlot';
import { loadClubFavorites } from '../../lib/clubFavorites';
import {
  getTournamentsEnabled, fetchTournaments, fetchRegistrationsFor, homeTournamentList,
  myLiveTournament,
  type HomeTournamentEntry, type Tournament,
} from '../../lib/tournaments';
import { registerTourAnchor } from '../../lib/tourAnchors';
import type { OpenGame } from '../../types';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Main screen ──────────────────────────────────────────────
// Les briques UI de l'accueil vivent dans components/home/ ; cet écran garde
// la donnée (Supabase) et le flux badges.
export default function HomeScreen() {
  const { player, refresh } = usePlayer();
  const { reload: reloadNotifs } = useNotificationCount();
  const [badgeCount, setBadgeCount] = useState(0);
  // Matchs joués / victoires : tous les matchs validés (lib/playerStats).
  const [totals, setTotals] = useState(EMPTY_TOTALS);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [upcomingGames, setUpcomingGames] = useState<OpenGame[]>([]);
  const [openGames, setOpenGames] = useState<OpenGame[]>([]);
  // Mes clubs favoris, par nom : troisième critère du classement des
  // suggestions (après le niveau et l'urgence, cf. lib/homeSlot).
  const [favoris, setFavoris] = useState<string[]>([]);
  // Point de départ partagé (GPS récent, sinon ma zone) : sert au critère
  // « proche » des suggestions et à la distance de la carte « Prochain match ».
  const { distanceOf, radiusKm } = useOrigin();
  const [loading, setLoading] = useState(true);
  const [badgeMatches, setBadgeMatches] = useState<any[]>([]);
  // Badges votables = badge_defs actifs (source unique, pilotée par l'admin) ; MVP exclu du vote.
  const badgeDefs = useActiveVoteBadges().filter(b => b.key !== 'MVP');
  const [badgeModalMatch, setBadgeModalMatch] = useState<any>(null);
  const [badgeVotes, setBadgeVotes] = useState<Record<string, string[]>>({});
  const [submittingBadges, setSubmittingBadges] = useState(false);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: winH, fontScale } = useWindowDimensions();

  // Adaptatif TOUS appareils (aucune valeur par modèle) : hauteur réellement
  // disponible = fenêtre − inset haut − header logo (~48) − tab bar (64 +
  // inset bas, cf. (tabs)/_layout) − paddings (~18) − 4 gaps (~48). Les
  // planchers normaux (~560 px) sont comparés en tenant compte de la taille
  // de police SYSTÈME (fontScale) qui gonfle tous les textes. Trois étages :
  // grand écran = proportions pleines · écran/police serrés = mode compact ·
  // extrême (petit + grande police) = le ScrollView de secours prend le relais.
  // La section Tournois, quand elle est rendue, prend ~140 dp qu'il faut
  // RETIRER du budget avant de comparer : sinon on reste en proportions
  // pleines, la colonne deborde, et l'accueil se met a defiler -- ce qu'il ne
  // faisait pas avant. C'est ce que le handoff demandait et que j'avais omis.
  const [tournois, setTournois] = useState<HomeTournamentEntry[]>([]);
  // La soiree en cours ou j'ai une place — la banniere du haut.
  const [soiree, setSoiree] = useState<Tournament | null>(null);
  const availableH = winH - insets.top - 48 - (64 + insets.bottom) - 18 - 48
    - (tournois.length > 0 ? TOURNAMENTS_RESERVE : 0);
  const compact = availableH < COMPACT_THRESHOLD_H * Math.max(1, fontScale);

  const fetchData = useCallback(async () => {
    if (!player) return;
    const now = new Date().toISOString();

    // Fenêtre d'invite « Distribue des badges » : 48 h après la saisie du score.
    const badgeWindowAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const playerOr = `winner_id.eq.${player.id},loser_id.eq.${player.id},winner_id_2.eq.${player.id},loser_id_2.eq.${player.id}`;

    const [
      { data: badgesReceived },
      { data: participations },
      { data: recentMatches },
      { data: alreadyVoted },
      { data: badgeSkips },
      { count: playersAbove },
    ] = await Promise.all([
      // badge_type ramené (pas un count serveur) : seuls les badges encore
      // définis ET actifs dans badge_defs comptent (isBadgeVisible).
      supabase
        .from('reputation_votes')
        .select('badge_type')
        .eq('receiver_id', player.id),
      supabase
        .from('game_participants')
        .select('game_id')
        .eq('player_id', player.id)
        .eq('status', 'accepted'),
      supabase
        .from('matches')
        .select('id, score_text, created_at, winner_id, winner_id_2, loser_id, loser_id_2, game:game_id(location, match_date), winner:winner_id(id, name, avatar_path), winner_2:winner_id_2(id, name, avatar_path), loser:loser_id(id, name, avatar_path), loser_2:loser_id_2(id, name, avatar_path)')
        .or(playerOr)
        .in('status', ['pending', 'validated'])
        .gte('created_at', badgeWindowAgo)
        .order('created_at', { ascending: false }),
      supabase
        .from('reputation_votes')
        .select('match_id')
        .eq('giver_id', player.id),
      supabase
        .from('badge_prompt_skips')
        .select('match_id')
        .eq('player_id', player.id),
      // Rang réel = position par ELO décroissant, même définition que l'écran
      // classement (ranking.tsx trie tous les joueurs non supprimés par elo_score).
      supabase
        .from('players')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null)
        .gt('elo_score', player.elo_score),
    ]);

    setBadgeCount((badgesReceived ?? []).filter((b: any) => isBadgeVisible(b.badge_type)).length);
    setMyRank((playersAbove ?? 0) + 1);

    const votedIds = new Set((alreadyVoted ?? []).map((v: any) => v.match_id));
    const skippedIds = new Set((badgeSkips ?? []).map((s: any) => s.match_id));
    const pendingBadge = (recentMatches ?? [])
      .filter((m: any) => !votedIds.has(m.id) && !skippedIds.has(m.id));
    setBadgeMatches(pendingBadge);

    const ids = (participations ?? []).map((p: any) => p.game_id);
    const orFilter = ids.length > 0
      ? `creator_id.eq.${player.id},id.in.(${ids.join(',')})`
      : `creator_id.eq.${player.id}`;

    // « À Venir » = matchs où je suis CONFIRMÉ (créateur ou participation
    // 'accepted' via orFilter), même incomplets — même définition que le badge
    // du lobby (lib/games.isConfirmedInGame). Pas de limit : le compteur doit
    // refléter le total réel, comme au lobby.
    // Créateur + participants embarqués pour la carte « Prochain match »
    // (noms + niveaux des deux camps ; l'occupation dérive de occupiesSpot).
    const { data: upcoming } = await supabase
      .from('open_games')
      .select('id, location, match_date, status, creator_id, creator_side, spots_available, game_format, is_challenge, min_elo, max_elo, creator:creator_id(id, name, elo_score, avatar_path), participants:game_participants(player_id, status, team_side, invite_expires_at, player:player_id(id, name, elo_score, avatar_path))')
      .gt('match_date', now)
      .neq('status', 'cancelled')
      .or(orFilter)
      .order('match_date', { ascending: true });

    setUpcomingGames((upcoming as unknown as OpenGame[]) ?? []);

    // Les parties ouvertes proposées quand l'écran n'a rien d'autre à dire
    // (« Ça se joue bientôt », cf. lib/homeSlot). On en ramène une douzaine
    // pour en garder trois au plus, classées : le tri par mixité et par places réellement
    // libres se fait côté client, sur les mêmes fonctions que le lobby —
    // `freeSpots` fait foi, pas le compteur `spots_available` qui dérive.
    //
    // La requête part À CHAQUE FOIS, y compris quand un match est programmé et
    // qu'on n'affichera rien. C'est délibéré : la décision dépend AUSSI des
    // tournois, qui se chargent séparément, et attendre les deux ferait
    // apparaître les vignettes après coup, sous les yeux du joueur.
    const { data: ouvertes } = await supabase
      .from('open_games')
      .select('id, location, match_date, status, creator_id, spots_available, game_format, is_challenge, gender_pref, min_elo, max_elo, creator:creator_id(id, name, elo_score, avatar_path), participants:game_participants(player_id, status, invite_expires_at, player:player_id(id, name, elo_score, avatar_path))')
      .eq('status', 'open')
      .gt('match_date', now)
      .neq('creator_id', player.id)
      // Un défi se joue binôme contre binôme : « rejoindre » n'y veut pas dire
      // la même chose que sur une partie ouverte. Il a son propre onglet.
      .or('is_challenge.is.null,is_challenge.eq.false')
      .order('match_date', { ascending: true })
      // Une QUARANTAINE, plus douze : le classement (niveau, urgence, club
      // favori) peut préférer une partie plus lointaine. Ne lire que les douze
      // plus proches affichait « crée le tien » dès qu'elles étaient toutes
      // pleines ou réservées, alors qu'une partie plus loin convenait.
      .limit(40);

    setOpenGames((ouvertes as unknown as OpenGame[]) ?? []);
    // `loadClubFavorites` ne lève pas : en cas d'échec, liste vide — le
    // classement perd son troisième critère, rien d'autre.
    setFavoris(await loadClubFavorites(player.id));

    setLoading(false);
  }, [player]);

  const { openBadge } = useLocalSearchParams<{ openBadge?: string }>();
  const autoOpenedBadge = useRef(false);

  useFocusEffect(useCallback(() => {
    fetchData();
    reloadNotifs();
  }, [fetchData, reloadNotifs]));

  // Tournois — chargement séparé de fetchData : l'interrupteur peut être éteint,
  // auquel cas on ne lit rien du tout et la carte n'existe pas. Une panne ici ne
  // doit jamais abîmer le reste de l'accueil, d'où le catch qui se contente de
  // ne rien proposer.
  useFocusEffect(useCallback(() => {
    let annule = false;
    (async () => {
      if (!player) return;
      try {
        if (!(await getTournamentsEnabled())) {
          if (!annule) { setTournois([]); setSoiree(null); }
          return;
        }
        const liste = await fetchTournaments();
        const regs = await fetchRegistrationsFor(liste.map(t => t.id));
        if (!annule) {
          setTournois(homeTournamentList(liste, regs, player.id));
          // La soirée qui se joue MAINTENANT — dérivée des mêmes lectures, pas
          // d'une requête de plus. Pendant une rotation de vingt minutes, la
          // seule chose qui compte est d'atteindre son terrain.
          // `fetchRegistrationsFor` rend une Map tournoi -> inscriptions ;
          // `myLiveTournament` raisonne sur des lignes, pas sur un index.
          setSoiree(myLiveTournament(liste, [...regs.values()].flat(), player.id));
        }
      } catch {
        if (!annule) { setTournois([]); setSoiree(null); }
      }
    })();
    return () => { annule = true; };
  }, [player]));

  // Matchs joués / victoires (amicaux compris) — rechargé à chaque retour sur
  // l'accueil, comme le reste de la carte de profil.
  useFocusEffect(useCallback(() => {
    const id = player?.id;
    if (!id) return;
    let annule = false;
    fetchPlayerTotals(id).then(t => { if (!annule) setTotals(t); }).catch(() => {});
    return () => { annule = true; };
  }, [player?.id]));

  useEffect(() => {
    // Le param est remis à undefined dès l'ouverture ; on relâche alors le verrou
    // pour qu'un nouveau clic sur la notif (param repassé à '1') rouvre la modale.
    if (openBadge !== '1') { autoOpenedBadge.current = false; return; }
    if (loading || badgeMatches.length === 0 || autoOpenedBadge.current) return;
    autoOpenedBadge.current = true;
    openBadgeModal(badgeMatches[0]);
    router.setParams({ openBadge: undefined });
  }, [openBadge, loading, badgeMatches]);

  const openBadgeModal = (m: any) => {
    setBadgeModalMatch(m);
    setBadgeVotes({});
  };

  const toggleBadgeVote = (playerId: string, label: string) => {
    setBadgeVotes(prev => {
      const curr = prev[playerId] ?? [];
      return { ...prev, [playerId]: curr.includes(label) ? curr.filter(b => b !== label) : [...curr, label] };
    });
  };

  // Passer un match : trace persistante pour que la notif ne revienne pas.
  const skipBadgeMatch = async (matchId: string) => {
    if (!player) return;
    await supabase
      .from('badge_prompt_skips')
      .upsert({ player_id: player.id, match_id: matchId }, { onConflict: 'player_id,match_id' });
  };

  const handleSubmitBadges = async () => {
    if (!player || !badgeModalMatch) return;
    setSubmittingBadges(true);
    const inserts = Object.entries(badgeVotes).flatMap(([rid, labels]) =>
      labels.map(label => ({ match_id: badgeModalMatch.id, giver_id: player.id, receiver_id: rid, badge_type: label }))
    );
    if (inserts.length > 0) await supabase.from('reputation_votes').insert(inserts);
    else await skipBadgeMatch(badgeModalMatch.id);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const rest = badgeMatches.filter(m => m.id !== badgeModalMatch.id);
    setBadgeMatches(rest);
    setSubmittingBadges(false);
    // Enchaîne automatiquement sur le match suivant à noter, sinon ferme.
    if (rest.length > 0) openBadgeModal(rest[0]);
    else { setBadgeModalMatch(null); setBadgeVotes({}); }
  };

  if (!player) return null;

  // Matchs joués : TOUS les matchs validés, amicaux compris — même source que
  // le profil (lib/playerStats). Les compteurs `win_count`/`loss_count` du
  // serveur sont les compteurs CLASSÉS : ils affichaient 5 là où la liste des
  // matchs en montrait 6.
  const matchCount = totals.played;
  const now = new Date();
  // Même règle que le lobby, écrite UNE fois (lib/games.staysInUpcoming) : une
  // partie COMPLÈTE reste visible 1 h 30 après son heure de début (fenêtre du
  // score en direct, « Le score » prend le relais à +1 h 30) ; une partie
  // incomplète dont l'heure est passée part tout de suite, puisqu'elle ne peut
  // ni se jouer ni se noter.
  const visibleUpcoming = upcomingGames.filter(g => staysInUpcoming(g, now));

  // Le budget de hauteur de la colonne, calcule a UN SEUL endroit et teste
  // (lib/homeLayout). Il a deborde deux fois, et les deux fois le symptome ne
  // ressemblait pas a un probleme de hauteur : « du scroll en bas », puis
  // « le haut du hero est coupe ».
  // Qui occupe l'emplacement du milieu : le match programmé, les parties
  // ouvertes, ou l'invitation à en créer une. La règle vit dans lib/homeSlot,
  // le budget de hauteur dans lib/homeLayout, et un test vérifie que les deux
  // disent la même chose — sinon une section se dessine sans place réservée.
  const suggestions = suggestibleGames(
    openGames as any,
    {
      id: player.id, gender: player.gender, elo: player.elo_score, favoriteClubs: favoris,
      distanceOf, radiusKm,
    },
    now,
  ) as unknown as OpenGame[];
  const slot = homeSlot({
    hasNextMatch: visibleUpcoming.length > 0,
    hasTournaments: tournois.length > 0,
    suggestions,
  });

  const sizes = homeSectionSizes({
    compact,
    hasTournaments: tournois.length > 0,
    hasNextMatch: visibleUpcoming.length > 0,
    openGames: suggestions.length,
    hasLiveTournament: !!soiree,
  });

  return (
    <View style={{ flex: 1, backgroundColor: '#F7F7F7' }}>
      <View style={{
        flex: 1,
        paddingTop: insets.top + 8,
      }}>
        {/* En-tête compact (demande Jeff) : le « ? » rejoint cloche + avatar dans
            le cluster droit, TOUT rétréci (pastilles 34, avatar 30, logo 107 px)
            pour que le logo reste STRICTEMENT centré sur 360 dp :
            gauche 12..80 · logo 126,5..233,5 · droite 238..348. */}
        <HeaderActions top={insets.top + 6} right={12} tint="dark" size={34} />
        {/* Coin gauche — Classement + Communauté, miroir du cluster droit.
            Le trophée a PRIS LA PLACE de la loupe, il ne s'est pas ajouté : un
            troisième bouton pousserait le cluster jusqu'au logo (budget
            ci-dessus). La loupe menait à /community/friends, que l'écran
            /community du bouton voisin propose déjà en haut à droite ; le rang,
            lui, ne se lisait plus nulle part depuis le retrait de la rangée de
            raccourcis du bas. */}
        <View style={{
          position: 'absolute', top: insets.top + 6, left: 12, zIndex: 20,
          flexDirection: 'row', alignItems: 'center', gap: 6,
        }}>
          <HomeRankButton rank={myRank} onPress={() => router.push('/ranking' as any)} />
          <TouchableOpacity
            onPress={() => router.push('/community' as any)}
            activeOpacity={0.75}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{
              width: 34, height: 34, borderRadius: 17,
              backgroundColor: Colors.heroBg,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Icon name="users" size={17} color={Colors.brand} stroke={2} />
          </TouchableOpacity>
        </View>
        {/* Header — logo PAG MATCH centré pleine largeur (identique au splash).
            Pill compactée à ~107 px (racket 19 + wordmark 79) pour tenir entre
            les deux clusters SANS être décentrée — ne pas ré-agrandir sans
            recalculer le budget 360 dp ci-dessus. */}
        <View style={{ alignItems: 'center', marginBottom: 4 }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: Colors.heroBg,
            paddingHorizontal: 8, paddingVertical: 8,
            borderRadius: 999,
          }}>
            <Image
              source={require('../../assets/auth/splash-racket.png')}
              style={{ width: 19, height: 19 }}
              resizeMode="contain"
            />
            <Image
              source={require('../../assets/auth/splash-wordmark.png')}
              style={{ width: 79, height: 18, marginLeft: -6 }}
              resizeMode="contain"
            />
          </View>
        </View>

        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ flex: 1 }} />
        ) : (
          <>
            {/* Badge modal — déclenché depuis la cloche via ?openBadge=1 */}
            <Modal visible={!!badgeModalMatch} animationType="slide" presentationStyle="pageSheet">
              <View style={{ flex: 1, backgroundColor: Colors.bg }}>
                <View style={{ backgroundColor: Colors.heroBg, paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: 24 }}>
                  <TouchableOpacity onPress={() => setBadgeModalMatch(null)} style={{ marginBottom: 12, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 }}>
                    <Text style={{ color: Colors.textOnDark, fontFamily: Fonts.uiBold, fontWeight: '700', fontSize: 13 }}>✕ Fermer</Text>
                  </TouchableOpacity>
                  <Text style={{ fontSize: 22, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textOnDark }}>
                    <Text>🏅 Distribue tes </Text>
                    <Text style={{ color: Colors.brand }}>badges</Text>
                  </Text>
                  {badgeModalMatch && (() => {
                    const loc = badgeModalMatch.game?.location ?? '';
                    const rawDate = badgeModalMatch.game?.match_date ?? badgeModalMatch.created_at;
                    const dateStr = rawDate
                      ? new Date(rawDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
                      : '';
                    const ctx = [loc, dateStr].filter(Boolean).join(' · ');
                    const remaining = badgeMatches.length;
                    return (
                      <>
                        {!!ctx && (
                          <Text style={{ fontSize: 13, fontFamily: Fonts.uiBold, fontWeight: '700', color: 'rgba(255,255,255,0.85)', marginTop: 6 }} numberOfLines={2}>
                            📍 {ctx}
                          </Text>
                        )}
                        {!!badgeModalMatch.score_text && (
                          <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                            {badgeModalMatch.score_text}
                          </Text>
                        )}
                        {remaining > 1 && (
                          <Text style={{ fontSize: 12, fontFamily: Fonts.uiBold, fontWeight: '700', color: Colors.brand, marginTop: 6 }}>
                            Encore {remaining} match{remaining > 1 ? 's' : ''} à récompenser
                          </Text>
                        )}
                      </>
                    );
                  })()}
                </View>
                <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
                  {badgeModalMatch && (
                    [badgeModalMatch.winner, badgeModalMatch.winner_2, badgeModalMatch.loser, badgeModalMatch.loser_2]
                      .filter((p: any) => p && p.id !== player.id)
                      .map((p: any) => {
                        const myVotes = badgeVotes[p.id] ?? [];
                        // Binôme = même camp que moi ; sinon adversaire (dérivé du match, pas de requête).
                        const myTeamIsWinner =
                          badgeModalMatch.winner?.id === player.id || badgeModalMatch.winner_2?.id === player.id;
                        const pIsWinner =
                          badgeModalMatch.winner?.id === p.id || badgeModalMatch.winner_2?.id === p.id;
                        const isPartner = pIsWinner === myTeamIsWinner;
                        return (
                          <View key={p.id} style={{ backgroundColor: Colors.bgCard, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, padding: 14, marginBottom: 12 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
                                <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>Pour {p.name}</Text>
                                <View style={{ backgroundColor: isPartner ? '#DCFCE7' : '#F1F5F9', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                                  <Text style={{ fontSize: 10, fontFamily: Fonts.uiBold, fontWeight: '900', color: isPartner ? '#166534' : '#475569' }}>
                                    {isPartner ? 'Binôme' : 'Adversaire'}
                                  </Text>
                                </View>
                              </View>
                              {myVotes.length > 0 && (
                                <View style={{ backgroundColor: '#EDE9FE', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                                  <Text style={{ fontSize: 10, fontWeight: '900', color: '#5B21B6' }}>
                                    {myVotes.length} badge{myVotes.length > 1 ? 's' : ''}
                                  </Text>
                                </View>
                              )}
                            </View>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                              {badgeDefs.map(b => {
                                const sel = myVotes.includes(b.key);
                                return (
                                  <TouchableOpacity key={b.key} onPress={() => toggleBadgeVote(p.id, b.key)} activeOpacity={0.75}
                                    style={{ alignItems: 'center', gap: 4, padding: 10, borderRadius: 14, width: 72, borderWidth: 1.5, borderColor: sel ? '#6366f1' : '#e2e8f0', backgroundColor: sel ? '#eef2ff' : '#fff', position: 'relative' }}>
                                    <BadgePill badge={b.key} size={24} />
                                    <Text style={{ fontSize: 8, fontWeight: '900', color: sel ? '#4338ca' : '#94a3b8', textTransform: 'uppercase', textAlign: 'center', letterSpacing: 0.3 }}>{b.label}</Text>
                                    {sel && (
                                      <View style={{ position: 'absolute', top: -5, right: -5, width: 14, height: 14, backgroundColor: Colors.primary, borderRadius: 999, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' }}>
                                        <Text style={{ fontSize: 7, color: Colors.textOnDark, fontWeight: '900' }}>✓</Text>
                                      </View>
                                    )}
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          </View>
                        );
                      })
                  )}
                  <TouchableOpacity onPress={handleSubmitBadges} disabled={submittingBadges}
                    style={{ backgroundColor: Colors.primary, borderRadius: 16, padding: 16, alignItems: 'center', opacity: submittingBadges ? 0.6 : 1 }}>
                    {submittingBadges
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textOnDark }}>Envoyer les badges</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => {
                      const skippedId = badgeModalMatch?.id;
                      const rest = badgeMatches.filter(m => m.id !== skippedId);
                      setBadgeMatches(rest);
                      if (skippedId) skipBadgeMatch(skippedId);
                      if (rest.length > 0) openBadgeModal(rest[0]);
                      else { setBadgeModalMatch(null); setBadgeVotes({}); }
                    }}
                    style={{ marginTop: 10, alignItems: 'center', padding: 12 }}>
                    <Text style={{ fontSize: 13, color: Colors.textMuted, fontWeight: '600' }}>Passer sans badge</Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
            </Modal>

            {/* Adaptatif : sur un écran assez haut, tout tient exactement
                (flexGrow:1 → le contenu remplit le viewport, l'excédent est
                absorbé par le hero et Prochain match, AUCUN scroll possible).
                Sur un petit écran (Android compact), le contenu dépasse et le
                ScrollView prend le relais au lieu de rogner les cartes. */}
            <ScrollView
              bounces={false}
              overScrollMode="never"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ flexGrow: 1 }}
            >
            <View style={{
              flex: 1,
              paddingHorizontal: 20,
              paddingTop: compact ? 6 : 10,
              paddingBottom: 8,
              gap: sizes.gap,
            }}>
              {/* Hauteurs RELATIVES : chaque section reçoit une part
                  proportionnelle de l'écran (flex), avec un plancher
                  minHeight sous lequel le contenu ne s'écrase pas —
                  en-dessous, c'est le ScrollView qui prend le relais. */}

              {/* A. LA SOIRÉE EN COURS — au-dessus de tout, et seulement
                  pendant qu'elle dure. Une rotation dure vingt minutes : la
                  seule chose qui compte alors est d'atteindre son terrain, et
                  le chemin passait par l'onglet Tournois puis la fiche. Hors
                  soirée la bannière n'existe pas, donc elle ne coûte rien à
                  l'accueil ordinaire (cf. lib/homeLayout). */}
              {sizes.liveBanner && soiree && (
                <TouchableOpacity
                  onPress={() => router.push(`/tournaments/soiree/${soiree.id}` as any)}
                  activeOpacity={0.85}
                  style={{
                    minHeight: sizes.liveBanner.minHeight,
                    backgroundColor: Colors.primary, borderRadius: 16,
                    paddingHorizontal: 14,
                    flexDirection: 'row', alignItems: 'center', gap: 10,
                  }}
                >
                  <View style={{
                    width: 9, height: 9, borderRadius: 999, backgroundColor: Colors.brand,
                  }} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>
                      {soiree.name}
                    </Text>
                    <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: 'rgba(255,255,255,0.65)', marginTop: 1 }}>
                      {soiree.status === 'EN_COURS' && soiree.current_round > 0
                        ? `Rotation ${soiree.current_round} sur ${soiree.round_count} · ton terrain t’attend`
                        : 'C’est ce soir · pointe-toi en arrivant'}
                    </Text>
                  </View>
                  <Icon name="chevronRight" size={16} color={Colors.brand} stroke={2.4} />
                </TouchableOpacity>
              )}

              {/* B. Hero profil — ~3/7,6 de la hauteur — ancre visite guidée (étape 1) */}
              <View
                ref={(v) => registerTourAnchor('home-profile', v)}
                collapsable={false}
                style={{ flex: sizes.hero.flex, minHeight: sizes.hero.minHeight }}>
                <HomeProfileCard
                  name={player.name}
                  elo={player.elo_score}
                  wins={totals.wins}
                  losses={totals.losses}
                  badgeCount={badgeCount}
                  frmt={formatFrmtRanking(player)}
                  onPress={() => router.push(`/player/${player.id}` as any)}
                  compact={compact}
                  memberNumber={isAmbassador(player) ? player.member_number : null}
                />
              </View>

              {/* C. Actions principales — ~0,8/7,6 — ancre visite guidée (étape 2) */}
              <View
                ref={(v) => registerTourAnchor('home-ctas', v)}
                collapsable={false}
                style={{ flex: sizes.ctas.flex, minHeight: sizes.ctas.minHeight }}>
                <HomePrimaryActions
                  onMatchmaking={() => router.push('/(tabs)/lobby' as any)}
                  onChallenge={() => router.push('/(tabs)/matchmaking' as any)}
                  textScale={sizes.ctas.textScale}
                />
              </View>

              {/* C bis. Section « Tournois ouverts » (handoff design 1C) — une
                  carte pleine largeur s'il n'y en a qu'une, un carrousel au-delà.
                  Le conteneur lui-même n'est PAS rendu quand la liste est vide :
                  sinon sa part de hauteur réserverait de la place pour rien, et l'accueil
                  ne retrouverait pas ses proportions d'origine. */}
              {sizes.tournaments && tournois.length > 0 && (
                <View style={{ flex: sizes.tournaments!.flex, minHeight: sizes.tournaments!.minHeight }}>
                  <HomeTournaments
                    entries={tournois}
                    onOpen={(id) => router.push(`/tournaments/${id}` as any)}
                    onSeeAll={() => router.push('/tournaments' as any)}
                  />
                </View>
              )}

              {/* D. Prochain match — rendu SEULEMENT s'il y en a un. La carte
                  vide repetait le bouton « Trouver un match » ci-dessus : meme
                  phrase, meme destination. Sans match, `sizes.nextMatch` est
                  nul et c'est le vide (`sizes.filler`) qui prend sa part, pour
                  que les cartes restantes ne gonflent pas d'autant. Le budget
                  et son test vivent dans lib/homeLayout. */}
              {sizes.nextMatch && (
                <View style={{ flex: sizes.nextMatch.flex, minHeight: sizes.nextMatch.minHeight }}>
                  <UpcomingMatchCard
                    game={visibleUpcoming[0] ?? null}
                    count={visibleUpcoming.length}
                    onOpenDetails={() => {
                      const g = visibleUpcoming[0];
                      if (g) router.push(`/(tabs)/lobby?gameId=${g.id}` as any);
                    }}
                    onSeeAll={() => router.push('/(tabs)/lobby?tab=upcoming' as any)}
                    onFindGame={() => router.push('/(tabs)/lobby' as any)}
                    compact={compact}
                  />
                </View>
              )}

              {/* D bis. « Ça se joue bientôt » — ni match ni tournoi. Deux
                  vraies parties à rejoindre, ou l'invitation à en créer une
                  s'il n'y en a aucune. */}
              {sizes.openGames && (slot.kind === 'openGames' || slot.kind === 'createFirst') && (
                <View style={{ flex: sizes.openGames.flex, minHeight: sizes.openGames.minHeight }}>
                  <OpenGamesSlot
                    games={slot.kind === 'openGames' ? slot.games : []}
                    myId={player.id}
                    myElo={player.elo_score}
                    onOpenGame={(id) => router.push(`/(tabs)/lobby?gameId=${id}` as any)}
                    onSeeAll={() => router.push('/(tabs)/lobby' as any)}
                    onCreate={() => router.push('/(tabs)/lobby?create=1' as any)}
                  />
                </View>
              )}

              {sizes.filler && (
                <View pointerEvents="none" style={{ flex: sizes.filler.flex }} />
              )}

              {/* La rangée « Classement · Score » vivait ici. Le rang est monté
                  dans l'en-tête ; « Score » s'atteint depuis le lobby (avec le
                  match en contexte, ce que cette carte ne savait pas faire) et
                  depuis le guide. Les ~52 dp rendus repartent aux sections
                  ci-dessus via le budget de lib/homeLayout. */}

            </View>
            </ScrollView>
          </>
        )}
      </View>
    </View>
  );
}
