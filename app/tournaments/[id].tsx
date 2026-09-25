// app/tournaments/[id].tsx — la fiche d'un tournoi, et l'inscription.
//
// ⚠️ L'INTERRUPTEUR. Éteint, l'entrée n'apparaît NULLE PART : cet écran se
// referme en silence, sans écran vide ni message. Toutes les RPC répondent
// alors `{ok:false, reason:'feature_disabled'}` — ce refus-là ne s'affiche
// jamais, il fait disparaître l'entrée (cf. lib/tournaments.isFeatureDisabled).
//
// ⚠️ LE CÔTÉ appartient AU TOURNOI, pas au profil : `players.court_side` ne sert
// qu'à PRÉREMPLIR. On s'adapte à son partenaire d'un soir.
//
// ⚠️ `open_to_join` est un MODE DE CONSENTEMENT qui n'appartient qu'au joueur.
// Aucun geste de cet écran ne le change en passant : seul l'interrupteur dédié
// appelle `tournament_set_open_to_join`. Le partenaire qu'on inscrit sans lui
// demander est écrit FERMÉ par le serveur — on ne le « corrige » pas ici.
//
// ⚠️ Deux joueurs du MÊME CÔTÉ : autorisé, seulement SIGNALÉ. Jamais bloqué.
//
// Conventions : en-tête sombre du Lobby / profil, cartes blanches rayon 18,
// pastilles <Pill>, feuille en surimpression (motif ProfileMenuSheet, pas un
// <Modal> natif — cf. feedback_nav_depuis_modal_native).

import { Children, useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl,
  TextInput, Alert, Pressable, StyleSheet, KeyboardAvoidingView, Platform, Image, Share,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../hooks/usePlayer';
import { useOrigin } from '../../hooks/useOrigin';
import { Colors, Fonts, eloToLevel } from '../../lib/theme';
import { distanceSentence } from '../../lib/geo';
import { Pill } from '../../components/Pill';
import { Icon } from '../../components/community/icons';
import { FitTitle } from '../../components/DisplayTitle';
import { PlayerAvatar } from '../../components/PlayerAvatar';
import { displayName, isDeleted } from '../../lib/players';
import { openInMaps, hasMapTarget } from '../../lib/maps';
import {
  fetchTournament, fetchRegistrations, fetchTeams, fetchMyJoinRequests,
  getTournamentsEnabled, registerToTournament, joinTournamentPlayer, fetchPendingPairs,
  respondJoinRequest, leaveTournamentTeam, withdrawFromTournament,
  checkInToTournament, setOpenToJoin, setSide, isFeatureDisabled, resultMessage,
  myTournamentState, soloRegistrations, seatsLabel, seatsTaken, seatCount, pointsLadder,
  groupRegistrations, partnerPath, registerCtaLabel, PARTNER_PATH_LABEL, partnerIntentNotice,
  isExpiredUnstarted,
  waitlistCount, freePlaces, waitExplanation, registerNotice,
  levelRangeLabel, priceLabel, statusLabel, statusTone,
  sideLabel, sameSideWarning, formatTournamentDate, teamCount,
  acceptsRegistrations, acceptsPairing, acceptsCheckIn, roundMinutesOf,
  fetchRoundMatches, fetchRoundMovements, fetchMatchEntries, fetchStandings,
  fetchTournamentResults, groupResultsByTeam, fetchFinalStakes, stakeLabel,
  enterTournamentScore, matchLiveStatus,
  type Tournament, type TournamentRegistration, type TournamentTeam, type TournamentResult,
  type JoinRequest, type TournamentSide, type TournamentStatusTone,
  type TournamentMatch, type TournamentMovement, type TournamentMatchEntry, type TournamentStanding,
  type TournamentResultTeamRow, type TournamentStake,
} from '../../lib/tournaments';
import { GENERIC_REASON } from '../../lib/tournamentReasons';
import { CourtRow, type CourtTeamInfo } from '../../components/tournaments/CourtRow';
import { StandingsTable, type StandingRowData } from '../../components/tournaments/StandingsTable';
import { FinalStandings, type FinalStandingRowData } from '../../components/tournaments/FinalStandings';
import { TournamentShareCard } from '../../components/tournaments/TournamentShareCard';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import {
  tournamentShareText, tournamentIcs, icsFileName,
} from '../../lib/tournamentShare';
import { LiveHero, ResultHero, RoundBanner, RegistrationCard, StickyActionBar } from '../../components/tournaments/FicheHeros';
import { RegisteredStrip } from '../../components/tournaments/RegisteredStrip';
import { ScoreSheet, type ScoreSheetTeam } from '../../components/tournaments/ScoreSheet';

// ─── Briques d'affichage (conventions du dépôt) ──────────────────────────────

const cs = StyleSheet.create({
  card: {
    backgroundColor: Colors.bgCard, borderRadius: 20, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 }, elevation: 1,
  },
});

// « Ven. 11 sept. » / « 19:00 » — le bloc horaire de la carte d'ouverture veut
// le jour et l'heure separes, la ou `formatTournamentDate` les rend en phrase.
function dayLabel(iso: string): string {
  const s = new Date(iso)
    .toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function timeLabel(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Majuscules faites EN JS, en un seul segment : `textTransform` sur la police
 *  des titres rogne les dernières lettres sur Android (mesure avant la
 *  transformation), et plusieurs segments peuvent disparaître au re-rendu. */
function titreTexte(children: React.ReactNode): string {
  return Children.toArray(children)
    .map(p => (typeof p === 'string' || typeof p === 'number' ? String(p) : ''))
    .join('')
    .toUpperCase();
}

function SectionTitle({ children, icon }: {
  children: React.ReactNode;
  icon?: React.ComponentProps<typeof Icon>['name'];
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4, marginTop: 4 }}>
      {icon
        ? <Icon name={icon} size={20} color={Colors.textPrimary} stroke={2.2} />
        : <View style={{ width: 4, height: 16, backgroundColor: Colors.brand, borderRadius: 2 }} />}
      {/* Taille MESURÉE : sur Android, ce titre comprimé est coupé, jamais
          rétréci ni mis à la ligne (cf. components/DisplayTitle.FitTitle). */}
      <FitTitle max={20} min={13} color={Colors.textPrimary}>{titreTexte(children)}</FitTitle>
    </View>
  );
}

function InfoLine({ icon, label, value, tone }: {
  icon: React.ComponentProps<typeof Icon>['name'];
  label: string; value: string; tone?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 }}>
      <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={14} color={Colors.textSecondary} stroke={2.2} />
      </View>
      <Text style={{ flex: 1, fontSize: 12.5, fontFamily: Fonts.ui, color: Colors.textSecondary }}>{label}</Text>
      <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: tone ?? Colors.textPrimary }}>{value}</Text>
    </View>
  );
}

function PrimaryButton({ label, onPress, disabled, busy, tone = 'dark', icon }: {
  label: string; onPress: () => void; disabled?: boolean; busy?: boolean;
  tone?: 'dark' | 'brand' | 'ghost' | 'danger';
  icon?: React.ComponentProps<typeof Icon>['name'];
}) {
  const bg = tone === 'brand' ? Colors.brand : tone === 'ghost' ? '#F6F6F5' : tone === 'danger' ? '#FFE9EB' : Colors.primary;
  const fg = tone === 'brand' ? Colors.textOnBrand : tone === 'ghost' ? Colors.textPrimary : tone === 'danger' ? Colors.danger : Colors.textOnDark;
  return (
    <TouchableOpacity
      onPress={onPress} disabled={disabled || busy} activeOpacity={0.85}
      style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        backgroundColor: bg, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 14,
        borderWidth: tone === 'ghost' ? 1 : 0,
        borderColor: Colors.border,
        opacity: disabled ? 0.45 : 1,
      }}>
      {busy ? <ActivityIndicator size="small" color={fg} /> : icon ? <Icon name={icon} size={17} color={fg} stroke={2.2} /> : null}
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
        style={{ flexShrink: 1, color: fg, fontSize: 14, fontFamily: Fonts.uiBlack, letterSpacing: 0.2 }}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Choix du côté — trois segments joints, motif `SegmentControl` du Lobby. */
function SideChooser({ value, onChange }: { value: TournamentSide; onChange: (v: TournamentSide) => void }) {
  const options: { v: TournamentSide; label: string }[] = [
    { v: 'left',  label: 'Gauche' },
    { v: 'right', label: 'Droit' },
    { v: 'both',  label: 'Les deux' },
  ];
  return (
    <View style={{
      flexDirection: 'row', borderRadius: 14, backgroundColor: Colors.bgCard,
      borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
    }}>
      {options.map((o, i) => {
        const active = value === o.v;
        return (
          <TouchableOpacity key={o.v} onPress={() => onChange(o.v)} activeOpacity={0.8}
            style={{
              flex: 1, alignItems: 'center', justifyContent: 'center',
              paddingVertical: 12, paddingHorizontal: 4,
              backgroundColor: active ? Colors.primary : 'transparent',
              borderLeftWidth: i > 0 ? 1 : 0, borderLeftColor: Colors.border,
            }}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{
              color: active ? Colors.textOnDark : Colors.textPrimary,
              fontFamily: Fonts.uiExtraBold, fontSize: 12,
            }}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** Tableau / Classement — deux segments joints, même motif que SideChooser. */
function LiveTabs({ value, onChange }: { value: 'tableau' | 'classement'; onChange: (v: 'tableau' | 'classement') => void }) {
  const options: { v: 'tableau' | 'classement'; label: string }[] = [
    { v: 'tableau', label: 'Tableau' },
    { v: 'classement', label: 'Classement' },
  ];
  return (
    <View style={{
      flexDirection: 'row', borderRadius: 14, backgroundColor: Colors.bgCard,
      borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
    }}>
      {options.map((o, i) => {
        const active = value === o.v;
        return (
          <TouchableOpacity key={o.v} onPress={() => onChange(o.v)} activeOpacity={0.8}
            style={{
              flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12,
              backgroundColor: active ? Colors.primary : 'transparent',
              borderLeftWidth: i > 0 ? 1 : 0, borderLeftColor: Colors.border,
            }}>
            <Text style={{ color: active ? Colors.textOnDark : Colors.textPrimary, fontFamily: Fonts.uiExtraBold, fontSize: 12.5 }}>
              {o.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Notice({ tone, children }: { tone: 'warning' | 'info' | 'success' | 'danger'; children: React.ReactNode }) {
  const map = {
    warning: { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.50)', fg: '#B45309' },
    info:    { bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.45)', fg: '#1D4ED8' },
    success: { bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.45)', fg: '#047857' },
    danger:  { bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.45)',  fg: '#B91C1C' },
  }[tone];
  return (
    <View style={{
      backgroundColor: map.bg, borderWidth: 1, borderColor: map.border,
      borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    }}>
      <Text style={{ color: map.fg, fontSize: 12.5, fontFamily: Fonts.uiBold, lineHeight: 17 }}>{children}</Text>
    </View>
  );
}

function Avatar({ name, size = 42, path }: { name: string; size?: number; path?: string | null }) {
  return (
    <PlayerAvatar
      name={name} path={path} size={size}
      backgroundColor={Colors.primary} textColor={Colors.textOnDark}
      fontSize={Math.round(size * 0.42)}
    />
  );
}

// Pastille de l'en-tête sombre : contour coloré, texte de la même couleur.
// La couleur du statut vient toujours de `statusTone` (source unique).
const HERO_TONE: Record<TournamentStatusTone, string> = {
  success: '#22C55E',
  warning: Colors.warning,
  brand:   Colors.brand,
  neutral: 'rgba(255,255,255,0.45)',
  ink:     'rgba(255,255,255,0.85)',
  danger:  Colors.danger,
};

function HeroChip({ tone, icon, children }: {
  tone: TournamentStatusTone;
  icon?: React.ComponentProps<typeof Icon>['name'];
  children: React.ReactNode;
}) {
  const border = HERO_TONE[tone];
  const fg = tone === 'neutral' || tone === 'ink' ? '#FFFFFF' : border;
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1, minWidth: 0,
      borderWidth: 1.5, borderColor: border, borderRadius: 999,
      paddingHorizontal: 10, paddingVertical: 5,
    }}>
      {icon ? <Icon name={icon} size={12} color={fg} stroke={2.6} /> : null}
      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12, fontFamily: Fonts.uiBold, color: fg }}>{children}</Text>
    </View>
  );
}

// ─── Écran ───────────────────────────────────────────────────────────────────

export default function TournamentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // `playerLoading` : sans lui, un inscrit voyait un instant « M'inscrire »
  // (canRegister se lit sur `me.registration`, qui dépend de `player?.id` —
  // tant que `usePlayer` n'a pas résolu, `player` est `null` et `me` ne peut
  // trouver aucune inscription, même la sienne).
  const { player, loading: playerLoading } = usePlayer();

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [regs, setRegs] = useState<TournamentRegistration[]>([]);
  const [teams, setTeams] = useState<TournamentTeam[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  // Les demandes EN COURS de tout le monde (RPC dediee) : la policy ne rend
  // que les miennes, donc sans ca un tiers voit deux joueurs deja lies comme
  // deux joueurs seuls. Vide tant que la RPC n'a pas repondu — les cartes
  // retombent alors sur mes seules demandes.
  const [publicPairs, setPublicPairs] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Le partenaire visé quand on ouvre l'inscription depuis la carte d'un
  // inscrit resté seul. Remis à null à la fermeture, sinon la prochaine
  // inscription partirait avec un partenaire qu'on n'a pas choisi cette fois.
  const [pendingPartner, setPendingPartner] = useState<{ id: string; name: string } | null>(null);
  const [sideSheetOpen, setSideSheetOpen] = useState(false);
  // Distinct de « ce tournoi n'existe pas » : un aléa réseau ne doit jamais
  // se lire comme « Ce tournoi est introuvable » — cf. le `if (!tournament)`
  // plus bas, qui distingue les deux messages.
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── La soirée (Task 8) : tableau du tour EN COURS, ses mouvements, ses
  // saisies, et le classement courant. Chargés seulement une fois le premier
  // tour tiré (current_round > 0) — avant ça, rien de tout ceci n'existe.
  const [matches, setMatches] = useState<TournamentMatch[]>([]);
  const [movements, setMovements] = useState<TournamentMovement[]>([]);
  const [matchEntries, setMatchEntries] = useState<TournamentMatchEntry[]>([]);
  const [standings, setStandings] = useState<TournamentStanding[]>([]);
  // Distinct d'un classement simplement VIDE (rien acquis pour l'instant) :
  // un refus serveur (feature_disabled, tournament_not_found) ou un aléa
  // réseau ne doit jamais se lire comme « rien n'a encore été joué ».
  const [standingsError, setStandingsError] = useState<string | null>(null);
  // Le classement FIGÉ (tournament_results), pour un tournoi CLOS — jamais
  // le même que `standings` (tournament_standings, vivant). Cf. le
  // commentaire de `fetchTournamentResults`, lib/tournaments.ts.
  const [finalResults, setFinalResults] = useState<TournamentResultTeamRow[]>([]);
  const [finalResultsError, setFinalResultsError] = useState<string | null>(null);
  // L'enjeu de LA rotation de classement — LECTURE DURABLE (Task 13,
  // `fetchFinalStakes` → `tournament_final_stakes`), lisible par n'importe
  // quel joueur à tout moment, pas seulement par l'organisateur au moment où
  // il la tire. `[]` tant qu'elle n'a pas été tirée (`drawn:false`, un état
  // normal, pas un refus) — `stakeByMatch` plus bas ne montre alors
  // simplement rien, comme pour n'importe quel autre tour.
  const [finalStakes, setFinalStakes] = useState<TournamentStake[]>([]);
  const [liveTab, setLiveTab] = useState<'tableau' | 'classement'>('tableau');
  const [howToOpen, setHowToOpen] = useState(false);
  const [scoreSheetMatchId, setScoreSheetMatchId] = useState<string | null>(null);
  const [scoreBusy, setScoreBusy] = useState(false);

  // Distance jusqu'au club du tournoi, même source que le reste de l'app.
  const { distanceOf, origin } = useOrigin();

  const load = useCallback(async () => {
    if (!id) return;
    const on = await getTournamentsEnabled();
    setEnabled(on);
    if (!on) { setLoading(false); return; }
    try {
      // Les demandes EN COURS de tout le monde sont lues à part, et
      // volontairement pas dans ce `Promise.all` : c'est un confort
      // d'affichage, pas une donnée dont dépend l'écran. Les mêler ici ferait
      // basculer toute la fiche dans le `catch` — donc « tournoi introuvable »
      // — pour une RPC absente ou pas encore rechargée par PostgREST.
      const [t, r, tm, jr] = await Promise.all([
        fetchTournament(id), fetchRegistrations(id), fetchTeams(id), fetchMyJoinRequests(id),
      ]);
      fetchPendingPairs(id).then(setPublicPairs).catch(() => setPublicPairs([]));
      // Ces quatre lectures ont RÉUSSI (sans quoi on serait dans le `catch`
      // ci-dessous) : `t === null` ici veut dire « ce tournoi n'existe
      // vraiment pas », jamais « le réseau a lâché » — `loadError` reste donc
      // `null`, et l'écran « introuvable » plus bas peut s'y fier.
      setTournament(t); setRegs(r); setTeams(tm); setRequests(jr);
      setLoadError(null);
      if (!t) { setLoading(false); return; }

      if (t.current_round > 0) {
        // Isolé dans son PROPRE try/catch : un échec ICI ne doit ni faire
        // croire que le tournoi est introuvable (il vient d'être affiché
        // deux lignes plus haut), ni faire sauter par-dessus la branche
        // `standingsError` qui suit — les deux arrivaient avant cette
        // correction, dès qu'une lecture voisine (les mouvements, les
        // saisies) levait entre `setTournament(t)` et le calcul du
        // classement.
        try {
          const [m, mv] = await Promise.all([
            fetchRoundMatches(id, t.current_round),
            fetchRoundMovements(id, t.current_round),
          ]);
          const [en, stRes] = await Promise.all([
            fetchMatchEntries(m.map(x => x.id)),
            fetchStandings(id),
          ]);
          setMatches(m); setMovements(mv); setMatchEntries(en);
          // Le classement est un refus serveur comme un autre : jamais avalé
          // en `[]` silencieux (cf. l'en-tête de `fetchStandings`).
          if (isFeatureDisabled(stRes)) { setEnabled(false); return; }
          if (stRes.ok) {
            setStandings((stRes.standings as TournamentStanding[] | undefined) ?? []);
            setStandingsError(null);
          } else {
            setStandings([]);
            setStandingsError(resultMessage(stRes));
          }
        } catch (e) {
          console.warn('[tournois] tableau/classement indisponibles', e);
          setStandingsError(GENERIC_REASON);
        }
      } else {
        setMatches([]); setMovements([]); setMatchEntries([]); setStandings([]); setStandingsError(null);
      }

      // L'enjeu de la rotation de classement — isolé dans son propre
      // try/catch : un échec ici ne doit ni faire passer le tournoi pour
      // introuvable, ni empêcher le reste de l'écran de s'afficher.
      try {
        const stkRes = await fetchFinalStakes(id);
        setFinalStakes(stkRes.ok ? ((stkRes.stakes as TournamentStake[] | undefined) ?? []) : []);
      } catch (e) {
        console.warn('[tournois] enjeu de la rotation de classement indisponible', e);
        setFinalStakes([]);
      }

      // Le classement FINAL, FIGÉ — dès TERMINE, avant même la validation
      // (cf. l'en-tête de `fetchTournamentResults`) : la fiche d'un tournoi
      // clos ne doit plus jamais lire `tournament_standings` (le vivant).
      if (t.status === 'TERMINE' || t.status === 'CLASSEMENT_VALIDE') {
        try {
          setFinalResults(await fetchTournamentResults(id));
          setFinalResultsError(null);
        } catch (e) {
          console.warn('[tournois] classement final indisponible', e);
          setFinalResultsError(GENERIC_REASON);
        }
      } else {
        setFinalResults([]); setFinalResultsError(null);
      }
    } catch (e) {
      console.warn('[tournois] fiche indisponible', e);
      setLoadError(GENERIC_REASON);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Éteint : on s'efface, sans un mot.
  useEffect(() => { if (enabled === false) router.back(); }, [enabled, router]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false);
  }, [load]);

  /** Un geste serveur : on exécute, on rafraîchit, et on formule le refus en
   *  français. `feature_disabled` fait exception — il ne s'affiche pas, il
   *  ferme l'écran (l'entrée disparaît, elle ne se plaint pas). */
  const run = useCallback(async (key: string, action: () => Promise<{ ok: boolean; reason?: string }>, okMessage?: string) => {
    setBusy(key);
    try {
      const res = await action();
      if (isFeatureDisabled(res)) { setEnabled(false); return; }
      if (!res.ok) { Alert.alert('Impossible', resultMessage(res)); return; }
      await load();
      if (okMessage) Alert.alert('C’est fait', okMessage);
    } finally {
      setBusy(null);
    }
  }, [load]);

  const me = useMemo(
    () => myTournamentState(player?.id ?? '', regs, teams, requests),
    [player?.id, regs, teams, requests],
  );

  const solos = useMemo(() => soloRegistrations(regs, teams), [regs, teams]);
  // Les inscrits par binome : c'est « qui joue avec qui » qu'on cherche dans
  // cette liste, pas « qui est la ». Regroupement et pieges : lib/tournaments.
  // Les demandes en cours passent AUSSI dans le regroupement : sans elles, un
  // joueur qui vient d'en envoyer une se voit seul dans une carte « Cherche un
  // binôme », comme s'il ne s'était rien passé. La RLS ne rend que les
  // demandes OU JE SUIS partie prenante (« qui a demandé à qui » n'est pas
  // public) — les cartes des autres restent donc muettes, et c'est voulu.
  const pairs = useMemo(
    () => groupRegistrations(regs, teams, player?.id, publicPairs.length > 0 ? publicPairs : requests),
    [regs, teams, player?.id, requests, publicPairs],
  );

  // PARTAGE : du texte, pas un lien. La passerelle web sert /u/, /g/ et /p/ —
  // il n'y a pas de route pour un tournoi, et partager une adresse qui repond
  // 404 serait pire que ne rien partager.
  const partagerTournoi = async (tournoi: typeof t, libres: number) => {
    if (!tournoi) return;
    try {
      await Share.share({ message: tournamentShareText(tournoi as any, libres) });
    } catch { /* l'utilisateur a ferme la feuille de partage */ }
  };

  // AGENDA : un fichier .ics partage, pas expo-calendar. Ce module n'est pas
  // installe et l'ajouter demanderait une permission plus une recompilation
  // native — donc un nouvel APK, et rien dans Expo Go d'ici la. Un .ics
  // s'ouvre dans l'agenda de n'importe quel telephone, sans permission.
  const ajouterAgenda = async (tournoi: typeof t) => {
    if (!tournoi) return;
    try {
      const f = new File(Paths.cache, icsFileName(tournoi as any));
      if (f.exists) f.delete();
      f.create();
      f.write(tournamentIcs(tournoi as any));
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Indisponible', 'Le partage de fichiers n’est pas disponible sur cet appareil.');
        return;
      }
      await Sharing.shareAsync(f.uri, {
        mimeType: 'text/calendar',
        UTI: 'com.apple.ical.ics',
        dialogTitle: 'Ajouter à mon agenda',
      });
    } catch (e: any) {
      Alert.alert('Erreur', String(e?.message ?? e));
    }
  };

  const byId = useMemo(() => {
    const m = new Map<string, TournamentRegistration>();
    for (const r of regs) m.set(r.player_id, r);
    return m;
  }, [regs]);

  // ── La soirée : lookups dérivés des lectures ci-dessus, aucun accès réseau. ──
  const teamById = useMemo(() => {
    const m = new Map<string, TournamentTeam>();
    for (const tm of teams) m.set(tm.id, tm);
    return m;
  }, [teams]);

  const namesOf = useCallback((player1Id: string, player2Id: string): [string, string] => [
    displayName(byId.get(player1Id)?.player, 'player'),
    displayName(byId.get(player2Id)?.player, 'player'),
  ], [byId]);

  // « Depuis la rotation précédente » — tournament_movements du tour EN
  // COURS, jamais une comparaison de rangs recalculée ici.
  const movementByTeam = useMemo(() => {
    const m = new Map<string, 'UP' | 'DOWN' | 'STAY'>();
    for (const mv of movements) m.set(mv.team_id, mv.movement);
    return m;
  }, [movements]);

  const entriesByMatch = useMemo(() => {
    const m = new Map<string, TournamentMatchEntry[]>();
    for (const e of matchEntries) {
      const list = m.get(e.match_id);
      if (list) list.push(e); else m.set(e.match_id, [e]);
    }
    return m;
  }, [matchEntries]);

  // L'état de CHAQUE match du tour affiché — calculé une seule fois ici et
  // réutilisé pour le rendu du tableau ET pour savoir si la rotation est
  // ENTIÈREMENT jouée (cf. `roundAwaitingNextDraw` plus bas, Task 12).
  const matchStatuses = useMemo(() => {
    const m = new Map<string, ReturnType<typeof matchLiveStatus>>();
    for (const match of matches) {
      const teamAInfo = teamById.get(match.team_a);
      const teamBInfo = match.team_b ? teamById.get(match.team_b) : null;
      if (!teamAInfo) continue;
      const entriesForMatch = entriesByMatch.get(match.id) ?? [];
      m.set(match.id, matchLiveStatus(
        match.team_b != null, match.forfeited_team, match.confirmed_at,
        entriesForMatch.filter(e => teamAInfo.player1_id === e.player_id || teamAInfo.player2_id === e.player_id),
        entriesForMatch.filter(e => !!teamBInfo && (teamBInfo.player1_id === e.player_id || teamBInfo.player2_id === e.player_id)),
      ));
    }
    return m;
  }, [matches, teamById, entriesByMatch]);

  const started = !!tournament && (tournament.current_round > 0 || tournament.status === 'EN_COURS');

  /** Saisir un score de tournoi. Distinct du `run()` générique ci-dessus :
   *  le message de retour dépend de `state` (recorded/confirmed/disputed),
   *  ce que `run()` ne porte pas. */
  const submitScore = useCallback(async (matchId: string, gA: number, gB: number) => {
    setScoreBusy(true);
    try {
      const res = await enterTournamentScore(matchId, gA, gB);
      if (isFeatureDisabled(res)) { setEnabled(false); return; }
      if (!res.ok) { Alert.alert('Impossible', resultMessage(res)); return; }
      await load();
      if (res.state === 'confirmed') {
        setScoreSheetMatchId(null);
        Alert.alert('Score acquis', 'Les deux camps concordent : le match est terminé.');
      } else if (res.state === 'disputed') {
        setScoreSheetMatchId(null);
        Alert.alert('Litige', 'Vos scores ne concordent pas. L’organisateur tranchera.');
      }
      // 'recorded' : la feuille reste ouverte, elle affiche déjà « ce qui manque ».
    } finally {
      setScoreBusy(false);
    }
  }, [load]);

  if (enabled !== true || loading || playerLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        {enabled !== false && <ActivityIndicator color={Colors.primary} size="large" />}
      </View>
    );
  }

  if (!tournament) {
    // `loadError` distingue « le réseau a lâché » de « ce tournoi n'existe
    // pas » — avant cette correction, les deux rendaient EXACTEMENT le même
    // message alors que le tournoi existe très bien dans le second cas.
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
        <Icon name="trophy" size={40} color={Colors.textMuted} stroke={1.8} />
        <Text style={{ fontSize: 16, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, textAlign: 'center', marginTop: 10 }}>
          {loadError ? 'Fiche indisponible' : 'Ce tournoi est introuvable'}
        </Text>
        {loadError && (
          <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBold, color: Colors.textSecondary, textAlign: 'center', marginTop: 6 }}>
            {loadError}
          </Text>
        )}
        <TouchableOpacity onPress={loadError ? load : () => router.back()}
          style={{ marginTop: 20, paddingHorizontal: 22, paddingVertical: 11, borderRadius: 12, backgroundColor: Colors.primary }}>
          <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>{loadError ? 'Réessayer' : 'Retour'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const t = tournament;
  const taken = seatsTaken(regs);
  const total = seatCount(t.court_count);
  const waiting = waitlistCount(regs);
  const free = freePlaces(regs, t.court_count);
  // Un vieux lien de partage peut encore ouvrir la fiche d'un tournoi jamais
  // lancé et passé : on n'y propose plus l'inscription (isExpiredUnstarted).
  const canRegister = acceptsRegistrations(t.status) && !me.registration && !isExpiredUnstarted(t);
  const canPair = acceptsPairing(t.status);
  const mySide = me.registration?.side ?? null;
  const partnerReg = me.partnerId ? byId.get(me.partnerId) : null;
  const pairWarning = sameSideWarning(mySide, partnerReg?.side ?? null);
  // Le côté n'est plus modifiable une fois le premier tirage fait
  // (`matches_already_generated` côté serveur) — `current_round > 0` en est
  // le miroir exact côté lecture : c'est `tournament_generate_round` qui
  // écrit le premier tour, et rien d'autre n'insère dans `tournament_matches`.
  const canChangeSide = t.current_round === 0;
  // Un binôme actif (pas déclaré forfait) : la carte « Mon inscription »
  // passe alors en deux colonnes, mon côté | mon binôme.
  const hasTeam = !!me.team && !me.team.withdrawn;

  // Le classement CLOS (tournament_results), jamais le vivant, une fois le
  // tournoi TERMINE/CLASSEMENT_VALIDE. `validated` distingue « en attente »
  // (TERMINE) de « crédités » (CLASSEMENT_VALIDE) — jamais le même mot pour
  // les deux (défaut n°3 de la relecture).
  const closed = t.status === 'TERMINE' || t.status === 'CLASSEMENT_VALIDE';
  const finalStandingRows: FinalStandingRowData[] = groupResultsByTeam(finalResults).map(r => ({
    ...r,
    names: namesOf(...(teamById.get(r.team_id)
      ? [teamById.get(r.team_id)!.player1_id, teamById.get(r.team_id)!.player2_id] as [string, string]
      : [r.player_ids[0], r.player_ids[1]] as [string, string])),
    mine: me.team?.id === r.team_id,
  }));
  const myFinalResult = me.team ? finalStandingRows.find(r => r.team_id === me.team!.id) ?? null : null;

  // La rotation affichée est ENTIÈREMENT jouée (tous les matchs
  // confirmés/bye/forfait) mais le tournoi n'a pas encore avancé : il n'y a
  // pas de temps réel ici, seul le tirer-pour-rafraîchir dit la suite — le
  // joueur doit au moins savoir que la balle est dans le camp de
  // l'organisateur, plutôt que de voir quatre pastilles vertes et rien
  // d'autre (défaut n°10 de la relecture).
  const roundAwaitingNextDraw = t.status === 'EN_COURS' && matches.length > 0
    && [...matchStatuses.values()].every(s => s === 'confirmed' || s === 'bye' || s === 'forfeited');

  // L'enjeu de chaque terrain à LA rotation de classement — traduit par
  // `stakeLabel`, jamais recalculé ici. Vide (donc aucun badge) tant qu'elle
  // n'a pas été tirée, ou pour n'importe quel autre tour : `CourtRow` ne
  // montre le badge que si `stakeText` est fourni pour CE match.
  const stakeByMatch = new Map(finalStakes.map(s => [s.match_id, stakeLabel(s)]));

  // ── Mon match de la rotation en cours (handoff design, chantier 1) ─────────
  // Pendant une soiree, la premiere question est « sur quel terrain je joue ».
  // Elle se cherchait sous quatre cartes de brochure ; elle passe en tete.
  const myMatch = me.team
    ? matches.find(m => m.team_a === me.team!.id || m.team_b === me.team!.id) ?? null
    : null;
  const myOpponentTeam = myMatch && me.team
    ? (myMatch.team_a === me.team.id
        ? (myMatch.team_b ? teamById.get(myMatch.team_b) ?? null : null)
        : teamById.get(myMatch.team_a) ?? null)
    : null;
  const myMovement = me.team ? movementByTeam.get(me.team.id) ?? null : null;
  // D'ou je viens : le mouvement porte le terrain d'origine quand il y en a un.
  const myMovedFrom = me.team
    ? (movements.find(mv => mv.team_id === me.team!.id)?.court_before ?? null)
    : null;
  const myMatchStatus = myMatch ? matchStatuses.get(myMatch.id) ?? 'awaiting' : null;
  // « Toi · Jean-Marc » : dans SON bloc, le joueur se lit « Toi » et non son
  // propre nom -- c'est ce qui fait qu'on repere sa ligne d'un coup d'oeil.
  const pairLabel = (a: string, b: string, meFirst: boolean): string => {
    const [na, nb] = namesOf(a, b);
    return meFirst ? `Toi · ${a === player?.id ? nb : na}` : `${na} · ${nb}`;
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {/* ── En-tête sombre ── */}
      <View style={{
        backgroundColor: Colors.heroBg, overflow: 'hidden',
        paddingTop: insets.top + 10, paddingHorizontal: 18, paddingBottom: 20,
      }}>
        {/* Halos jaunes (décor) */}
        <View pointerEvents="none" style={{ position: 'absolute', top: -130, right: -100, width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(255,193,26,0.13)' }} />
        <View pointerEvents="none" style={{ position: 'absolute', bottom: -170, left: -130, width: 280, height: 280, borderRadius: 140, backgroundColor: 'rgba(255,193,26,0.07)' }} />

        {/* Meme en-tete que la liste : retour a gauche, logo centre. La fiche
            ne le portait pas, on ne savait plus dans quelle app on etait. */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{
              width: 40, height: 40, borderRadius: 20,
              borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)',
              alignItems: 'center', justifyContent: 'center',
            }}>
            <Icon name="arrowLeft" size={20} color={Colors.textOnDark} stroke={2.2} />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center', marginRight: 40 }}>
            <View style={{
              flexDirection: 'row', alignItems: 'center',
              borderWidth: 1.5, borderColor: Colors.brand, borderRadius: 999,
              paddingHorizontal: 12, paddingVertical: 5,
            }}>
              <Image source={require('../../assets/auth/splash-racket.png')} style={{ width: 20, height: 20 }} resizeMode="contain" />
              <Image source={require('../../assets/auth/splash-wordmark.png')} style={{ width: 96, height: 20, marginLeft: -6 }} resizeMode="contain" />
            </View>
          </View>
        </View>
        {/* Titre Fonts.welcome à contenu DYNAMIQUE : segment unique (pas de
            <Text> imbriqué, qui rendrait adjustsFontSizeToFit inopérant sur
            Android), numberOfLines=1 + adjustsFontSizeToFit + paddingRight
            anti-débord italique, et alignSelf 'stretch' pour que la boîte ne
            dépende pas d'une largeur intrinsèque périmée.
            Cf. feedback_android_title_clipping. */}
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
          style={{
            alignSelf: 'stretch', fontSize: 32, lineHeight: 41, fontFamily: Fonts.welcome,
            color: Colors.textOnDark, includeFontPadding: false, marginTop: 10, paddingRight: 11,
          }}>
          {t.name}
        </Text>
        {/* Date · heure · club : seulement une fois le tournoi lancé. Avant,
            la carte « Date et heure » juste en dessous le dit déjà. */}
        {started && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
            <Icon name="calendar" size={15} color="rgba(255,255,255,0.85)" stroke={2.2} />
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: Fonts.uiSemi, color: 'rgba(255,255,255,0.92)' }}>
              {formatTournamentDate(t.starts_at)} · {t.club?.name ?? 'Club à confirmer'}
            </Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 12 }}>
          {/* Une seule ligne : chaque pastille rétrécit (« … ») plutôt que de
              passer à la ligne. Couleur SOURCE UNIQUE (`statusTone`, lib/tournaments.ts) — même
              couleur ici, sur la carte de liste et dans l'admin. */}
          <HeroChip tone={statusTone(t.status)} icon={statusTone(t.status) === 'success' ? 'check' : undefined}>
            {statusLabel(t.status)}
          </HeroChip>
          <HeroChip tone="neutral" icon="signal">{levelRangeLabel(t.level_min, t.level_max)}</HeroChip>
          <HeroChip tone="brand" icon="gem">{priceLabel(t.price_mad)}</HeroChip>
        </View>

        {/* Pendant la soiree, l'en-tete porte l'avancement (handoff design) :
            ou on en est des rotations, d'un coup d'oeil, sans defiler. */}
        {t.status === 'EN_COURS' && t.current_round > 0 && (
          <View style={{ marginTop: 14 }}>
            <RoundBanner current={t.current_round} total={t.round_count} minutes={roundMinutesOf(t)} />
          </View>
        )}
      </View>

      {/* La barre fixe flotte AU-DESSUS du defilement : d'ou la reserve en bas
          du contenu, sans laquelle la derniere section passe dessous. */}
      <ScrollView
        contentContainerStyle={{
          padding: 14,
          paddingBottom: insets.bottom + (canRegister && !playerLoading ? 108 : 32),
          gap: 14,
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {/* ── Un tournoi ANNULÉ est un tournoi MORT : le dire clairement,
            plutôt que de laisser le reste de la fiche (places, format,
            inscription) le montrer comme un tournoi vivant. Les actions
            (M'inscrire, Je suis là, etc.) sont déjà fermées automatiquement :
            ANNULE n'entre dans AUCUNE fenêtre `accepts*` (lib/tournaments.ts,
            des listes d'autorisation, pas d'exclusion — rien à y ajouter). */}
        {t.status === 'ANNULE' && (
          <Notice tone="danger">Ce tournoi a été annulé par l’organisateur. Il ne se jouera pas.</Notice>
        )}

        {/* ── Mon résultat, en tête et en grand (handoff design, chantier 1) ──
            Une fois la soirée close, c'est LE fait que le joueur vient
            chercher : son rang, ses chiffres, de quoi partager. Il passe
            avant le tableau et le classement, qui deviennent le détail.
            Séparé de « La soirée » pour ne jamais se confondre avec le
            classement vivant, qui donne un autre rang. */}
        {closed && me.team && myFinalResult && (
          <ResultHero
            rank={myFinalResult.final_rank}
            total={finalStandingRows.length}
            partner={me.partnerId ? (byId.get(me.partnerId)?.player?.name ?? null) : null}
            climbs={null}
            wins={myFinalResult.wins}
            losses={myFinalResult.played - myFinalResult.wins}
            gamesWon={myFinalResult.games_won}
            diff={myFinalResult.games_won - myFinalResult.games_lost}
            onShare={() => setLiveTab('classement')}
          />
        )}
        {closed && me.team && !myFinalResult && (
          <View style={[cs.card, { padding: 14, gap: 4 }]}>
            <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, color: Colors.textMuted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
              Mon résultat
            </Text>
            {finalResultsError ? (
              <Notice tone="warning">{finalResultsError}</Notice>
            ) : (
              <Text style={{ fontSize: 12, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>
                Résultat pas encore disponible.
              </Text>
            )}
          </View>
        )}

        {/* ── Mon match de la rotation en cours (handoff design, chantier 1) ──
            Pendant la soirée, la première question est « sur quel terrain je
            joue » : terrain, mouvement, adversaires, saisie. Elle passe donc
            AVANT le tableau, qui devient le détail des autres terrains. */}
        {/* L'ÉCRAN DE SOIRÉE. La carte ci-dessous répond déjà à « sur quel
            terrain je joue », mais il faut l'atteindre : ouvrir l'app, aller
            dans Tournois, ouvrir la fiche, faire défiler. Six fois dans la
            soirée, par trente-deux personnes. Le plein écran arrive direct, et
            il montre en plus l'état de TOUS les terrains — c'est ce qui
            remplace l'organisateur quand la soirée se gère entre joueurs. */}
        {t.status === 'EN_COURS' && (
          <TouchableOpacity
            onPress={() => router.push(`/tournaments/soiree/${t.id}` as any)}
            activeOpacity={0.85}
            style={{
              backgroundColor: Colors.primary, borderRadius: 18,
              paddingVertical: 15, paddingHorizontal: 16,
              flexDirection: 'row', alignItems: 'center', gap: 10,
            }}
          >
            <Icon name="zap" size={18} color={Colors.brand} stroke={2.4} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>
                MODE SOIRÉE
              </Text>
              <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>
                Ton terrain, ta saisie, et où en sont les autres
              </Text>
            </View>
            <Icon name="chevronRight" size={16} color={Colors.brand} stroke={2.4} />
          </TouchableOpacity>
        )}

        {t.status === 'EN_COURS' && t.current_round > 0 && myMatch && me.team && (
          <LiveHero
            courtNo={myMatch.court_no}
            movement={myMovement}
            movedFrom={myMovedFrom}
            mine={pairLabel(me.team.player1_id, me.team.player2_id, true)}
            theirs={myOpponentTeam ? pairLabel(myOpponentTeam.player1_id, myOpponentTeam.player2_id, false) : null}
            canScore={!!myMatch.team_b && myMatchStatus !== 'confirmed' && myMatchStatus !== 'forfeited'}
            onScore={() => setScoreSheetMatchId(myMatch.id)}
          />
        )}

        {/* ── La soirée : tableau des terrains + classement ── */}
        {started && (
          <View style={{ gap: 10 }}>
            <SectionTitle icon="trophy">La soirée</SectionTitle>
            <LiveTabs value={liveTab} onChange={setLiveTab} />
            {!t.current_round ? (
              <Notice tone="info">Le premier tour n’a pas encore été tiré.</Notice>
            ) : liveTab === 'tableau' ? (
              matches.length === 0 ? (
                <Notice tone="info">Aucun match pour ce tour.</Notice>
              ) : (
                <View style={{ gap: 8 }}>
                  {roundAwaitingNextDraw && (
                    <Notice tone="info">
                      Tous les matchs de cette rotation sont joués. La suite s’affichera ici dès que
                      l’organisateur tire la prochaine rotation — tire vers le bas pour actualiser.
                    </Notice>
                  )}
                  {matches.map(m => {
                    const teamAInfo = teamById.get(m.team_a);
                    const teamBInfo = m.team_b ? teamById.get(m.team_b) : null;
                    if (!teamAInfo) return null;
                    const teamAData: CourtTeamInfo = {
                      id: teamAInfo.id,
                      names: namesOf(teamAInfo.player1_id, teamAInfo.player2_id),
                      movement: movementByTeam.get(teamAInfo.id) ?? null,
                      mine: me.team?.id === teamAInfo.id,
                    };
                    const teamBData: CourtTeamInfo | null = teamBInfo ? {
                      id: teamBInfo.id,
                      names: namesOf(teamBInfo.player1_id, teamBInfo.player2_id),
                      movement: movementByTeam.get(teamBInfo.id) ?? null,
                      mine: me.team?.id === teamBInfo.id,
                    } : null;
                    const status = matchStatuses.get(m.id) ?? 'awaiting';
                    return (
                      <CourtRow
                        key={m.id}
                        courtNo={m.court_no}
                        isTopCourt={m.court_no === 1}
                        teamA={teamAData}
                        teamB={teamBData}
                        gamesA={m.games_a} gamesB={m.games_b}
                        forfeitedTeamId={m.forfeited_team}
                        status={status}
                        stakeText={stakeByMatch.get(m.id)}
                        // La saisie n'existe qu'en EN_COURS : `tournament_enter_score`
                        // refuse tout autre statut (`tournament_not_live`). Sur un
                        // tournoi annulé ou terminé, le tableau reste lisible mais
                        // n'est plus tapable — sinon on ouvre une feuille de saisie
                        // pour se faire répondre « Impossible » après coup.
                        onPress={
                          t.status === 'EN_COURS' && m.team_b
                            ? () => setScoreSheetMatchId(m.id)
                            : undefined
                        }
                      />
                    );
                  })}
                </View>
              )
            ) : closed ? (
              // Un tournoi CLOS montre le classement FIGÉ (tournament_results),
              // jamais `standings` (tournament_standings, vivant) : les deux
              // peuvent donner un rang différent pour la même soirée.
              finalStandingRows.length > 0 ? (
                <View style={{ gap: 16 }}>
                  {/* L'affiche partageable AVANT le tableau détaillé : c'est le
                      moment de la soirée qu'on envoie dans le groupe, et le
                      seul écran de tournoi qui sort de l'app — donc le seul qui
                      porte le filigrane de marque. */}
                  <TournamentShareCard
                    name={t.name}
                    startsAt={t.starts_at}
                    clubName={t.club?.name ?? null}
                    rows={finalStandingRows}
                    validated={t.status === 'CLASSEMENT_VALIDE'}
                  />
                  <FinalStandings rows={finalStandingRows} validated={t.status === 'CLASSEMENT_VALIDE'} />
                </View>
              ) : finalResultsError ? (
                <Notice tone="warning">{finalResultsError}</Notice>
              ) : (
                <Notice tone="info">Classement final pas encore disponible.</Notice>
              )
            ) : standings.length === 0 ? (
              standingsError ? (
                <Notice tone="warning">{standingsError}</Notice>
              ) : (
                <Notice tone="info">Le classement apparaîtra dès le premier match acquis.</Notice>
              )
            ) : (
              <StandingsTable rows={standings.map((s): StandingRowData => ({
                standing: s,
                names: namesOf(s.player1_id, s.player2_id),
                movement: movementByTeam.get(s.team_id) ?? null,
                mine: me.team?.id === s.team_id,
              }))} />
            )}
          </View>
        )}

        {/* ── Quand, où, combien de places (handoff design, chantier 1) ──
            Remplace deux cartes empilees (« Les places » et « Le format »)
            qui repetaient la date et le club deja presents dans l'en-tete.
            Ne reste ici que ce qui decide d'y aller ou non. Le bloc n'a de
            sens que tant qu'on peut encore s'inscrire : une fois la soiree
            lancee, c'est le tableau des terrains qui compte. */}
        {!started && (
          <RegistrationCard
            dayLabel={dayLabel(t.starts_at)}
            timeLabel={timeLabel(t.starts_at)}
            clubLine={t.club?.name ? `${t.club.name}${t.club.city ? ` · ${t.club.city}` : ''}` : 'Club à confirmer'}
            distanceLine={distanceSentence(distanceOf(t.club?.name), origin)}
            taken={taken}
            total={total}
            free={free}
            waiting={waiting}
            courts={t.court_count}
            priceLabel={priceLabel(t.price_mad)}
            onDirections={hasMapTarget(t.club?.name) ? () => openInMaps(t.club?.name) : undefined}
            onShare={() => partagerTournoi(t, seatCount(t.court_count) - seatsTaken(regs))}
            onCalendar={() => ajouterAgenda(t)}
          />
        )}

        {/* ── Où j'en suis ──
            EN TETE, mais SEULEMENT quand je suis inscrit : « suis-je dedans,
            avec qui, de quel cote » est ce que je viens verifier, et c'est ce
            qui doit ouvrir la fiche. Quand je ne le suis pas, le bloc ne dit
            rien que la carte de date ne dise deja, et c'est la barre fixe en
            pied d'ecran qui porte le geste -- il n'a alors pas lieu d'etre. */}
        {(me.registration || (!canRegister && acceptsRegistrations(t.status) === false && !closed)) && (
        <View style={{ gap: 10 }}>
          {!me.registration ? (
            <>
              <SectionTitle icon="users">Mon inscription</SectionTitle>
              {canRegister ? (
                <View style={{ gap: 8 }}>
                  {/* Ce texte disait « Le tournoi est complet » et ne
                      s'affichait qu'a zero place. Depuis la regle du
                      siege-aux-binomes, TOUTE inscription entre d'abord en
                      file : ne le dire QUE quand c'est plein faisait passer la
                      file pour une punition, et le dire a trente places libres
                      etait faux. Le libelle vit dans lib/tournaments. */}
                  <Notice tone={free === 0 ? 'warning' : 'info'}>
                    {registerNotice(free)}
                  </Notice>
                  {/* Le geste principal vit dans la barre fixe en pied
                      d'ecran (handoff design). */}
                </View>
              ) : (
                <Notice tone="info">Les inscriptions sont fermées pour ce tournoi.</Notice>
              )}
            </>
          ) : (
            <View style={[cs.card, { padding: 16, gap: 14 }]}>
              {/* En-tête de la carte : titre + où j'en suis */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.brand, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="users" size={16} color={Colors.textOnBrand} stroke={2.4} />
                </View>
                <FitTitle max={20} min={13} color={Colors.textPrimary}>MON INSCRIPTION</FitTitle>
                {(() => {
                  const st = me.team?.withdrawn
                    ? { label: 'Forfait', icon: 'x' as const, bg: 'rgba(239,68,68,0.12)', fg: '#B91C1C' }
                    : me.waitlisted
                      ? { label: 'En attente', icon: 'hourglass' as const, bg: 'rgba(245,158,11,0.14)', fg: '#B45309' }
                      : { label: 'Inscrit', icon: 'check' as const, bg: Colors.success, fg: '#FFFFFF' };
                  return (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: st.bg, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
                      <Icon name={st.icon} size={14} color={st.fg} stroke={2.8} />
                      <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: st.fg }}>{st.label}</Text>
                    </View>
                  );
                })()}
              </View>

              {me.waitlisted && (
                <Notice tone="warning">
                  Tu es en liste d’attente{me.registration.waitlist_position ? ` (rang ${me.registration.waitlist_position})` : ''}.{' '}
                  {/* La file n'avance plus une fois les matchs tirés, et pour
                      un joueur seul ce n'est pas une place qui manque mais un
                      partenaire : le texte dépend de la RAISON de l'attente
                      (lib/tournaments.waitExplanation). */}
                  {waitExplanation({
                    hasPartner: !!me.partnerId,
                    pairingOpen: acceptsPairing(t.status),
                  })}
                </Notice>
              )}

              {/* Mon côté | mon binôme — deux colonnes quand j'ai un binôme
                  actif, sinon empilés (le réglage de consentement est long). */}
              <View style={{ flexDirection: hasTeam ? 'row' : 'column', gap: hasTeam ? 12 : 14 }}>
                {/* Mon côté (déclaré POUR CE TOURNOI) — modifiable jusqu'au
                    premier tirage (`tournament_set_side`, `matches_already_generated`
                    au-delà). */}
                <View style={hasTeam ? { flex: 1, minWidth: 0, gap: 10 } : { gap: 10 }}>
                  <Text style={{ fontSize: 13, fontFamily: Fonts.uiSemi, color: Colors.textPrimary }}>Mon côté ce soir-là</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Icon name="racket" size={22} color={Colors.textPrimary} stroke={2} />
                    <View style={{ backgroundColor: Colors.brand, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 }}>
                      <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textOnBrand }}>{sideLabel(me.registration.side)}</Text>
                    </View>
                    {canChangeSide && (
                      <TouchableOpacity onPress={() => setSideSheetOpen(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={{ backgroundColor: '#F6F6F5', borderWidth: 1, borderColor: Colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
                        <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Changer</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                {/* Mon binôme, ou mon mode de consentement */}
                {/* `me.team` seul décide : l'inscription du partenaire est
                    garantie par les clés étrangères, mais si elle manquait, on
                    afficherait quand même « tu as un binôme » plutôt que le
                    réglage de consentement, que le serveur refuserait
                    (`already_in_team`). */}
                {me.team?.withdrawn ? (
                  // Le binôme a été déclaré FORFAIT (organisateur, admin.tsx).
                  // Même mot partout pour cet événement : « Forfait », jamais « Abandon ».
                  <Notice tone="danger">
                    {displayName(partnerReg?.player, 'partner')} et toi avez été déclarés forfait. Vous ne jouez plus ce tournoi.
                  </Notice>
                ) : me.team ? (
                  <>
                    <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: Colors.border }} />
                    <View style={{ flex: 1, minWidth: 0, gap: 10 }}>
                      <Text style={{ fontSize: 13, fontFamily: Fonts.uiSemi, color: Colors.textPrimary }}>Mon binôme</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Avatar name={displayName(partnerReg?.player, 'partner')} path={(partnerReg?.player as any)?.avatar_path} size={50} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text numberOfLines={1} style={{ fontSize: 14.5, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
                            {displayName(partnerReg?.player, 'partner')}
                          </Text>
                          <Text numberOfLines={2} style={{ fontSize: 11.5, fontFamily: Fonts.ui, color: Colors.textSecondary }}>
                            Ton binôme{partnerReg ? ` : côté ${sideLabel(partnerReg.side).toLowerCase()}` : ''}
                          </Text>
                        </View>
                      </View>
                      {canPair && (
                        <PrimaryButton
                          tone="ghost" label="Défaire le binôme" busy={busy === 'leave'}
                          onPress={() => Alert.alert(
                            'Défaire le binôme ?',
                            'Vous gardez chacun votre place et votre rang. Personne n’est désinscrit.',
                            [
                              { text: 'Annuler', style: 'cancel' },
                              { text: 'Défaire', style: 'destructive', onPress: () => run('leave', () => leaveTournamentTeam(t.id)) },
                            ],
                          )}
                        />
                      )}
                    </View>
                  </>
                ) : (
                  <View style={{ gap: 10 }}>
                    {/* Le message ne promet la liste plus bas que si elle porte
                        encore un bouton — après le tirage, `canAsk` y est
                        toujours faux et l'instruction devenait fausse. */}
                    <Notice tone="info">
                      {canPair
                        ? 'Tu n’as pas encore de binôme. Choisis quelqu’un dans la liste plus bas.'
                        : 'Tu n’as pas de binôme, et l’appariement est fermé pour cette soirée.'}
                    </Notice>
                    {/* MODE DE CONSENTEMENT — n'appartient qu'à moi, et ne change
                        que par ce geste-ci. */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBold, color: Colors.textPrimary }}>
                          {me.registration.open_to_join ? 'On peut me prendre d’un geste' : 'Il faut mon accord'}
                        </Text>
                        <Text style={{ fontSize: 11, fontFamily: Fonts.ui, color: Colors.textMuted, marginTop: 2 }}>
                          {canPair
                            ? (me.registration.open_to_join
                                ? 'N’importe quel inscrit peut former le binôme sans te demander.'
                                : 'Une demande t’est envoyée, tu réponds.')
                            : 'Ce réglage ne compte plus : l’appariement est fermé pour cette soirée.'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        disabled={busy === 'open' || !canPair}
                        onPress={() => run('open', () => setOpenToJoin(t.id, !me.registration!.open_to_join))}
                        activeOpacity={0.8}
                        style={{
                          paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
                          backgroundColor: me.registration.open_to_join ? Colors.brand : Colors.bgCard,
                          borderWidth: 1, borderColor: me.registration.open_to_join ? Colors.brand : Colors.border,
                          opacity: canPair ? 1 : 0.45,
                        }}>
                        <Text style={{
                          fontSize: 11, fontFamily: Fonts.uiBlack, textTransform: 'uppercase', letterSpacing: 0.4,
                          color: me.registration.open_to_join ? Colors.textOnBrand : Colors.textSecondary,
                        }}>
                          {me.registration.open_to_join ? 'Ouvert' : 'Sur accord'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>

              {/* Autorisé, seulement signalé. */}
              {hasTeam && pairWarning && <Notice tone="warning">{pairWarning}</Notice>}

              {/* Pointage du jour J — MASQUÉ en liste d'attente : le serveur
                  refuse `tournament_check_in` pour un joueur en attente
                  (`not_registered`) parce qu'il n'a aucune place à confirmer. */}
              {acceptsCheckIn(t.status) && !me.waitlisted && (
                me.registration.check_in_status === 'checked_in'
                  ? <Notice tone="success">Ta présence est enregistrée.</Notice>
                  : <PrimaryButton tone="brand" label="Je suis là" busy={busy === 'checkin'}
                      onPress={() => run('checkin', () => checkInToTournament(t.id), 'Ta présence est enregistrée.')} />
              )}

              {canPair && (
                <>
                  <View style={{ height: 1, backgroundColor: Colors.border }} />
                  <PrimaryButton
                    tone="danger" icon="trash" label="Me désinscrire" busy={busy === 'withdraw'}
                    onPress={() => Alert.alert(
                      'Te désinscrire ?',
                      'Ta place se libère et la liste d’attente avance. Ton partenaire, s’il y en a un, reste inscrit avec sa place.',
                      [
                        { text: 'Annuler', style: 'cancel' },
                        { text: 'Me désinscrire', style: 'destructive', onPress: () => run('withdraw', () => withdrawFromTournament(t.id)) },
                      ],
                    )}
                  />
                </>
              )}
            </View>
          )}

          {/* Demandes reçues */}
          {me.incoming.length > 0 && (
            <View style={[cs.card, { padding: 14, gap: 10 }]}>
              <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
                {me.incoming.length} demande{me.incoming.length > 1 ? 's' : ''} de binôme
              </Text>
              {me.incoming.map(req => {
                const from = byId.get(req.from_player);
                const warn = sameSideWarning(mySide, from?.side ?? null);
                return (
                  <View key={req.id} style={{ gap: 8, borderTopWidth: 1, borderTopColor: Colors.borderLight, paddingTop: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Avatar name={displayName(from?.player, 'partner')} path={(from?.player as any)?.avatar_path} size={38} />
                      <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontFamily: Fonts.uiBold, color: Colors.textPrimary }}>
                        {displayName(from?.player, 'partner')} · côté {sideLabel(from?.side).toLowerCase()}
                      </Text>
                    </View>
                    {warn && <Notice tone="warning">{warn}</Notice>}
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <PrimaryButton label="Accepter" busy={busy === `acc-${req.id}`}
                          onPress={() => run(`acc-${req.id}`, () => respondJoinRequest(req.id, true))} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <PrimaryButton tone="ghost" label="Refuser" busy={busy === `dec-${req.id}`}
                          onPress={() => run(`dec-${req.id}`, () => respondJoinRequest(req.id, false))} />
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        )}

        {/* ── Comment ça marche (handoff design : REPLIE par defaut) ──
            Cinq lignes de regles ouvertes en permanence poussaient tout le
            reste vers le bas. Celui qui connait le format n'a pas a les
            relire a chaque visite ; celui qui les decouvre les deplie. */}
        <View style={[cs.card, { padding: 16, gap: howToOpen ? 12 : 0 }]}>
          <TouchableOpacity
            onPress={() => setHowToOpen(o => !o)}
            activeOpacity={0.7}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
          >
            <Icon name="fileText" size={22} color={Colors.textPrimary} stroke={2} />
            <Text numberOfLines={2} style={{ flex: 1, fontSize: 19, lineHeight: 24, fontFamily: Fonts.welcome, color: Colors.textPrimary, paddingRight: 4 }}>
              Comment ça marche ?
            </Text>
            <Icon name="chevronRight" size={20} rotate={howToOpen ? 90 : 0} color={Colors.textPrimary} stroke={2.4} />
          </TouchableOpacity>
          {howToOpen && [
            `Tu viens en binôme, ou seul — l’organisateur t’apparie avant le départ.`,
            `${t.round_count} rotations de ${roundMinutesOf(t)} min. Tu gagnes, tu montes d’un terrain. Tu perds, tu descends.`,
            `Terrain 1 = le plus fort. Le classement de la soirée sort à la dernière rotation.`,
          ].map((line, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 9 }}>
              <View style={{
                width: 18, height: 18, borderRadius: 6, backgroundColor: Colors.primary,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, color: Colors.brand }}>{i + 1}</Text>
              </View>
              <Text style={{ flex: 1, fontSize: 12.5, fontFamily: Fonts.ui, color: Colors.textSecondary, lineHeight: 18 }}>
                {line}
              </Text>
            </View>
          ))}
        </View>

        {/* ── Qui est deja la (handoff design) ──
            « Qui vient » est la question qu'on se pose avant de s'inscrire, et
            elle n'avait aucune reponse : seuls les joueurs SANS binome etaient
            listes, tout en bas. Le bandeau ne s'affiche que tant qu'on peut
            encore s'inscrire -- une fois la soiree lancee, c'est le tableau
            des terrains qui dit qui est la. */}
        {!started && (
          <RegisteredStrip
            pairs={pairs}
            free={Math.max(0, total - seatsTaken(regs))}
            onPlayerPress={(id) => router.push(`/player/${id}` as any)}
            joinLabel={me.registration ? 'Me proposer' : 'M’inscrire avec lui'}
            onJoin={(id) => {
              // DEUX GESTES DIFFERENTS derriere le meme bouton, parce que la
              // situation n'est pas la meme.
              //
              // Inscrit : `tournament_join` forme le binome (ou envoie la
              // demande si sa fiche n'est pas ouverte).
              //
              // PAS inscrit : cette RPC refuse, et a raison — on ne s'apparie
              // pas depuis l'exterieur. Le bouton s'affichait quand meme, et
              // repondait « Impossible · Tu n'es pas inscrit a ce tournoi » :
              // un refus pour une condition jamais annoncee, sur le seul
              // geste que l'ecran proposait. Le meme garde-fou existait
              // pourtant DIX LIGNES PLUS BAS, dans la liste « joueurs sans
              // binome » (`!me.registration ? null`) : la liste de cartes,
              // ajoutee apres, ne l'avait pas recu.
              //
              // On ouvre donc l'inscription avec ce joueur deja choisi comme
              // partenaire ; la feuille sait deja m'inscrire puis le rejoindre.
              if (me.registration) { run(`join-${id}`, () => joinTournamentPlayer(t.id, id)); return; }
              const cible = regs.find(r => r.player_id === id);
              setPendingPartner({ id, name: (cible?.player as any)?.name ?? 'ce joueur' });
              setSheetOpen(true);
            }}
          />
        )}

        {/* ── Comment ça tourne ──
            La montante/descente n'est evidente que pour qui l'a deja jouee.
            Avant cette carte, la fiche disait le prix, l'heure et le niveau,
            mais jamais la REGLE — et surtout jamais ce qu'on gagne a finir
            premier plutot que quatrieme. Un bareme qui ne s'affiche nulle
            part ne motive personne. */}
        {!started && (
          <View style={[cs.card, { padding: 16, gap: 10 }]}>
            <Text style={{ fontSize: 19, fontFamily: Fonts.welcome, color: Colors.textPrimary, paddingRight: 6 }}>
              Comment ça tourne
            </Text>
            <Text style={{ fontSize: 12.5, fontFamily: Fonts.ui, color: Colors.textSecondary, lineHeight: 19 }}>
              Tu gagnes, tu montes d’un terrain. Tu perds, tu descends. Le{' '}
              <Text style={{ fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Terrain 1</Text>
              {' '}est le plus fort. La {t.round_count}e rotation fixe le classement.
            </Text>

            {/* Le bareme, du premier au dernier. La premiere pastille est
                pleine : c'est le seul chiffre qu'on vient chercher. */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {pointsLadder(t).map((r, i) => (
                <View key={r.rank} style={{
                  paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999,
                  backgroundColor: i === 0 ? Colors.brand : Colors.bgCardAlt,
                }}>
                  <Text style={{
                    fontSize: 11.5, fontFamily: Fonts.uiBlack,
                    color: i === 0 ? Colors.primary : Colors.textSecondary,
                  }}>
                    {r.points}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── Les joueurs seuls ── */}
        <View style={{ gap: 10 }}>
          <SectionTitle icon="users">Joueurs sans binôme ({solos.length})</SectionTitle>
          {solos.length === 0 ? (
            <Notice tone="info">Tout le monde a trouvé son binôme.</Notice>
          ) : (
            solos.map(r => {
              const isMe = r.player_id === player?.id;
              const asked = me.outgoing.some(o => o.to_player === r.player_id);
              const warn = sameSideWarning(mySide, r.side);
              // Un binôme ne peut pas enjamber la file : un joueur assis et un
              // joueur en attente formeraient une équipe dont une moitié
              // seulement a sa place (`waitlist_mismatch`). On le dit AVANT
              // l'appel plutôt que de laisser le serveur refuser.
              const sameQueue = !!me.registration
                && (r.waitlist_position == null) === (me.registration.waitlist_position == null);
              const canAsk = !!me.registration && !me.team && !isMe && canPair && sameQueue;
              return (
                <View key={r.player_id} style={[cs.card, { padding: 12, gap: 8 }]}>
                  {/* Le joueur mene a son profil : avant de proposer un
                      binome a quelqu'un, on veut voir son niveau et son
                      historique. */}
                  <TouchableOpacity
                    onPress={() => router.push(`/player/${r.player_id}` as any)}
                    activeOpacity={0.7}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
                  >
                    <Avatar name={displayName(r.player, 'player')} path={(r.player as any)?.avatar_path} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontSize: 13.5, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
                        {displayName(r.player, 'player')}{isMe ? ' (toi)' : ''}
                      </Text>
                      <Text style={{ fontSize: 11.5, fontFamily: Fonts.ui, color: Colors.textSecondary }}>
                        {r.player?.elo_score != null && !isDeleted(r.player)
                          ? `Niv. ${eloToLevel(r.player.elo_score).toFixed(1)} · ` : ''}
                        {r.waitlist_position != null ? 'en liste d’attente' : 'a sa place'}
                      </Text>
                    </View>
                    {/* Le côté, pour qu'on cherche un complément. */}
                    <Pill variant={r.side === 'both' ? 'neutral' : 'ink'}>{sideLabel(r.side)}</Pill>
                  </TouchableOpacity>

                  {!isMe && canAsk && warn && <Notice tone="warning">{warn}</Notice>}

                  {isMe ? null : !me.registration ? null : me.team ? null : asked ? (
                    <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>
                      Demande envoyée · en attente de sa réponse
                    </Text>
                  ) : canAsk ? (
                    <PrimaryButton
                      tone="ghost" busy={busy === `join-${r.player_id}`}
                      label={r.open_to_join ? 'Faire binôme' : 'Demander à faire binôme'}
                      onPress={() => run(`join-${r.player_id}`, () => joinTournamentPlayer(t.id, r.player_id))}
                    />
                  ) : canPair && !sameQueue ? (
                    <Text style={{ fontSize: 11.5, fontFamily: Fonts.ui, color: Colors.textMuted }}>
                      L’un de vous a sa place, l’autre est en liste d’attente : le binôme n’est pas possible.
                    </Text>
                  ) : null}
                </View>
              );
            })
          )}
        </View>

        {/* Signature de marque, en pied de fiche — même sobriété que le pied
            des Stories : la raquette, le nom, rien qui prenne la place du
            contenu. Les maquettes du format la portaient. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 18, opacity: 0.4 }}>
          <Image source={require('../../assets/auth/splash-racket.png')} style={{ width: 13, height: 13 }} resizeMode="contain" />
          <Text style={{ fontSize: 10, fontFamily: Fonts.uiBold, color: Colors.textMuted, letterSpacing: 2.2 }}>
            PAGMATCH
          </Text>
        </View>
      </ScrollView>

      {/* Barre d'action fixe (handoff design, chantier 1) : le geste principal
          etait enterre APRES cinq sections. Elle n'apparait que s'il y a
          vraiment quelque chose a faire -- pas de barre morte en pied d'ecran
          sur un tournoi ou l'on n'a rien a decider. */}
      {canRegister && !playerLoading && (
        <StickyActionBar
          priceLine={t.price_mad > 0 ? priceLabel(t.price_mad) : null}
          priceNote={t.price_mad > 0 ? 'Payé sur place' : null}
          label={free === 0 ? 'REJOINDRE LA LISTE' : 'M’INSCRIRE'}
          onPress={() => setSheetOpen(true)}
          insetBottom={insets.bottom}
        />
      )}

      {sheetOpen && player && (
        <RegisterSheet
          tournamentId={t.id}
          myId={player.id}
          defaultSide={(player.court_side as TournamentSide | undefined) ?? 'both'}
          registeredIds={new Set(regs.map(r => r.player_id))}
          soloOpen={new Map(solos.map(r => [r.player_id, r.open_to_join]))}
          initialPartner={pendingPartner}
          onClose={() => { setSheetOpen(false); setPendingPartner(null); }}
          onDone={async (res) => {
            if (isFeatureDisabled(res)) { setSheetOpen(false); setPendingPartner(null); setEnabled(false); return; }
            if (!res.ok) { Alert.alert('Impossible', resultMessage(res)); return; }
            setSheetOpen(false);
            setPendingPartner(null);
            await load();
            if (res.waitlisted === true) {
              // Cette alerte disait « Le tournoi est plein ». Elle était vraie
              // quand la file ne se remplissait qu'à capacité atteinte ; depuis
              // la règle du siège-aux-binômes, TOUTE inscription y passe — vue
              // à l'écran sur un tournoi à 2 joueurs sur 32. Le titre change
              // aussi : entrer en file n'est plus une exception, c'est le
              // chemin normal, et l'annoncer comme un refus fait renoncer.
              //
              // `hasPartner: false` sans condition : à cet instant, un
              // partenaire éventuel n'a fait que RECEVOIR une invitation. Le
              // binôme se forme à son acceptation, pas ici.
              Alert.alert(
                'Inscription enregistrée',
                waitExplanation({ hasPartner: false, pairingOpen: true }),
              );
            }
          }}
        />
      )}

      {sideSheetOpen && me.registration && (
        <ChangeSideSheet
          current={me.registration.side}
          busy={busy === 'side'}
          onClose={() => setSideSheetOpen(false)}
          onChoose={(v) => {
            setSideSheetOpen(false);
            if (v !== me.registration!.side) run('side', () => setSide(t.id, v));
          }}
        />
      )}

      {scoreSheetMatchId && (() => {
        const m = matches.find(x => x.id === scoreSheetMatchId);
        if (!m || !m.team_b) return null;
        const teamAInfo = teamById.get(m.team_a);
        const teamBInfo = teamById.get(m.team_b);
        if (!teamAInfo || !teamBInfo) return null;
        const teamAData: ScoreSheetTeam = {
          id: teamAInfo.id, names: namesOf(teamAInfo.player1_id, teamAInfo.player2_id),
          playerIds: [teamAInfo.player1_id, teamAInfo.player2_id],
        };
        const teamBData: ScoreSheetTeam = {
          id: teamBInfo.id, names: namesOf(teamBInfo.player1_id, teamBInfo.player2_id),
          playerIds: [teamBInfo.player1_id, teamBInfo.player2_id],
        };
        const entriesForMatch = entriesByMatch.get(m.id) ?? [];
        const teamAEntries = entriesForMatch.filter(e => teamAData.playerIds.includes(e.player_id));
        const teamBEntries = entriesForMatch.filter(e => teamBData.playerIds.includes(e.player_id));
        const status = matchLiveStatus(true, m.forfeited_team, m.confirmed_at, teamAEntries, teamBEntries);
        const iAmIn = !!player && (teamAData.playerIds.includes(player.id) || teamBData.playerIds.includes(player.id));
        // 'disputed' N'EST PAS EXCLU ICI, volontairement : c'est ainsi qu'un
        // litige se referme SANS déranger l'organisateur. Exemple réel : a1
        // saisit 6-3, b1 saisit 4-6 → litige ; b1 se ravise et resaisit 6-3
        // → les jeux concordent avec l'entrée de a1, `tournament_enter_score`
        // confirme le match dans la foulée. Retirer la saisie dès qu'un
        // litige est détecté forcerait CHAQUE désaccord — même une simple
        // faute de frappe — à attendre l'organisateur (Task 10). Ne pas
        // « corriger » ce comportement.
        // `m.round_no === t.current_round` : UNE ROTATION PASSÉE EST DÉFINITIVE
        // (tournament_auto_advance.sql refuse `round_closed`). Sans ce garde, la
        // feuille d'un match d'une rotation déjà jouée proposait encore la
        // saisie — pour répondre « Impossible » après coup, ou, avant le verrou
        // serveur, pour créer un désaccord après que les binômes avaient changé
        // de terrain.
        const canEnter = t.status === 'EN_COURS' && iAmIn
          && m.round_no === t.current_round
          && status !== 'confirmed' && status !== 'forfeited';
        return (
          <ScoreSheet
            courtNo={m.court_no}
            teamA={teamAData} teamB={teamBData}
            status={status}
            gamesA={m.games_a} gamesB={m.games_b}
            forfeitedTeamId={m.forfeited_team}
            entries={entriesForMatch}
            myPlayerId={player?.id ?? ''}
            canEnter={canEnter}
            busy={scoreBusy}
            onSubmit={(gA, gB) => submitScore(m.id, gA, gB)}
            onClose={() => setScoreSheetMatchId(null)}
          />
        );
      })()}
    </View>
  );
}

// ─── La feuille d'inscription ────────────────────────────────────────────────
// Surimpression absolue, pas un <Modal> natif : le dépôt a déjà payé le piège
// « router.push depuis une <Modal> RN ouvre l'écran DERRIÈRE la modale »
// (feedback_nav_depuis_modal_native). Ici, aucune navigation ne part de la
// feuille — et la forme reste celle de ProfileMenuSheet.

function RegisterSheet({ tournamentId, myId, defaultSide, registeredIds, soloOpen, initialPartner, onClose, onDone }: {
  tournamentId: string;
  myId: string;
  /** Prérempli depuis le profil — le côté reste un choix PROPRE AU TOURNOI. */
  defaultSide: TournamentSide;
  registeredIds: Set<string>;
  /** Les inscrits restes SEULS, et leur open_to_join. */
  soloOpen: Map<string, boolean>;
  /**
   * Le partenaire visé, quand on arrive ici depuis « M'inscrire avec lui »
   * sur la carte d'un inscrit resté seul.
   *
   * Pourquoi passer par la feuille plutôt que d'appeler `tournament_join`
   * directement : cette RPC refuse un appelant non inscrit, et à raison. La
   * feuille sait déjà quoi faire d'un partenaire DÉJÀ INSCRIT — elle
   * m'inscrit, puis le rejoint (`partnerPath`), ce qui respecte son
   * « on peut me prendre d'un geste » au lieu de lui envoyer une demande
   * dont il n'a pas besoin.
   *
   * Ces deux appels ne sont PAS atomiques, et ils ne peuvent pas l'être :
   * `tournament_register` refuse un partenaire déjà inscrit
   * (`partner_already_registered`). Si le second échoue, on reste inscrit
   * sans binôme — état récupérable, la demande se refait depuis la liste des
   * joueurs sans binôme.
   */
  initialPartner?: { id: string; name: string } | null;
  onClose: () => void;
  onDone: (res: TournamentResult) => void;
}) {
  const insets = useSafeAreaInsets();
  const [side, setSide] = useState<TournamentSide>(defaultSide);
  const [mode, setMode] = useState<'solo' | 'duo'>(initialPartner ? 'duo' : 'solo');
  const [openToJoin, setOpen] = useState(true);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; name: string; elo_score?: number | null }[]>([]);
  const [partner, setPartner] = useState<{ id: string; name: string; avatar_path?: string | null } | null>(initialPartner ?? null);
  const [searching, setSearching] = useState(false);
  // Distinct de « aucun joueur trouvé » : avant cette correction, `data`
  // était destructuré SANS jamais lire `error` — un refus réseau rendait une
  // liste vide, indiscernable de « Karim n'est pas dans l'app ».
  const [searchError, setSearchError] = useState(false);
  const [busy, setBusy] = useState(false);

  // Recherche du partenaire — même forme que lib/community.searchPlayers.
  useEffect(() => {
    if (mode !== 'duo') return;
    const term = query.trim();
    if (term.length < 2) { setResults([]); setSearchError(false); return; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const { supabase } = await import('../../lib/supabase');
        const { data, error } = await supabase
          .from('players').select('id, name, elo_score, avatar_path')
          .is('deleted_at', null).ilike('name', `%${term}%`).neq('id', myId).limit(20);
        if (cancelled) return;
        if (error) {
          console.warn('[tournois] recherche de partenaire indisponible', error);
          setResults([]); setSearchError(true);
        } else {
          setResults((data ?? []) as any); setSearchError(false);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, mode, myId]);

  // Le chemin du partenaire choisi : instantané, sur demande, pas encore
  // inscrit, ou déjà pris. Calculé UNE fois — le bandeau, la ligne sous le nom
  // et le libellé du bouton doivent dire la même chose, et trois lectures
  // séparées de la même règle finissent toujours par diverger.
  const cheminPartenaire = partner
    ? partnerPath(partner.id, { registered: registeredIds, soloOpen })
    : null;
  // Arrivée CIBLÉE : on vient de la carte de quelqu'un, et on l'a toujours
  // pour partenaire. Relâcher la croix rend la feuille complète.
  const cible = !!initialPartner && partner?.id === initialPartner.id;

  const submit = async () => {
    setBusy(true);
    try {
      // `open_to_join` est MON mode, avec ou sans partenaire : le serveur écrit
      // le partenaire FERMÉ de son côté, on ne décide rien pour lui.
      // Un partenaire DEJA INSCRIT ne peut pas etre passe a
      // tournament_register (elle refuse partner_already_registered) : on
      // s'inscrit seul, puis on le rejoint — le binome se forme aussitot s'il
      // est ouvert, sinon une demande part et il decide.
      const chemin = mode === 'duo' && partner
        ? partnerPath(partner.id, { registered: registeredIds, soloOpen })
        : null;

      if (chemin === 'instant' || chemin === 'request') {
        const inscription = await registerToTournament(tournamentId, side, true, null);
        if (!inscription.ok) { onDone(inscription); return; }
        onDone(await joinTournamentPlayer(tournamentId, partner!.id));
        return;
      }

      const res = await registerToTournament(
        tournamentId, side, openToJoin, mode === 'duo' ? partner?.id : null,
      );
      onDone(res);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={onClose} />
      {/* La feuille est portée par le KeyboardAvoidingView, et non l'inverse :
          un enfant en position absolue ne donne aucune hauteur à son parent,
          et le KAV se replierait à zéro. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '88%' }}
      >
        <View style={{
          backgroundColor: Colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22,
          paddingBottom: insets.bottom + 12,
        }}>
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 2 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border }} />
          </View>
          {/* Quand on arrive depuis la carte d'un inscrit, le titre le NOMME :
              sans ça, la feuille générique donne l'impression d'avoir perdu
              le geste qu'on venait de faire. */}
          <Text numberOfLines={1} style={{ fontFamily: Fonts.uiBlack, fontSize: 16, color: Colors.textPrimary, paddingHorizontal: 18, paddingTop: 8 }}>
            {initialPartner ? `M’inscrire avec ${initialPartner.name}` : 'M’inscrire'}
          </Text>

          <ScrollView contentContainerStyle={{ padding: 18, gap: 16 }} keyboardShouldPersistTaps="handled">
            {/* ARRIVÉE CIBLÉE — on vient de la carte d'un inscrit précis.
                La feuille générique reposait alors deux questions déjà
                répondues (« je viens seul ou à deux ? », « avec qui ? ») et
                reléguait la seule information qui compte — QUI — en
                quatrième position. Ici on met la personne en tête, on dit ce
                qui va se passer, et on ne garde que les deux choix qui
                restent vraiment à faire : mon côté, et mon réglage si le
                binôme se défait.

                La croix reste : elle relâche la cible et rend la feuille
                complète, pour qui change d'avis en cours de route. */}
            {cible && partner && (
              <View style={{ gap: 10 }}>
                <View style={[cs.card, { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
                  <Avatar name={partner.name} path={partner.avatar_path} size={42} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
                      {partner.name}
                    </Text>
                    {cheminPartenaire && (
                      <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: Colors.textMuted, marginTop: 2 }}>
                        {PARTNER_PATH_LABEL[cheminPartenaire]}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity
                    onPress={() => { setPartner(null); setQuery(''); }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel="Choisir quelqu’un d’autre"
                  >
                    <Icon name="x" size={16} color={Colors.textMuted} stroke={2.2} />
                  </TouchableOpacity>
                </View>
                {cheminPartenaire && (
                  <Notice tone="info">{partnerIntentNotice(cheminPartenaire, partner.name)}</Notice>
                )}
              </View>
            )}

            {/* Seul ou à deux — la question ne se pose plus quand on est
                arrivé par quelqu'un. */}
            {!cible && (
            <View>
              <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
                Je viens
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['solo', 'duo'] as const).map(m => {
                  const active = mode === m;
                  return (
                    <TouchableOpacity key={m} onPress={() => setMode(m)} activeOpacity={0.8}
                      style={{
                        flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 14,
                        backgroundColor: active ? Colors.primary : Colors.bgCard,
                        borderWidth: 1, borderColor: active ? Colors.primary : Colors.border,
                      }}>
                      <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiExtraBold, color: active ? Colors.textOnDark : Colors.textPrimary }}>
                        {m === 'solo' ? 'Seul' : 'Avec un partenaire'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            )}

            {/* Côté — propre au tournoi, prérempli depuis le profil */}
            <View>
              <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
                Mon côté ce soir-là
              </Text>
              <SideChooser value={side} onChange={setSide} />
              <Text style={{ fontSize: 11, fontFamily: Fonts.ui, color: Colors.textMuted, marginTop: 6 }}>
                Prérempli depuis ton profil. Il vaut pour CE tournoi : on s’adapte à son partenaire d’un soir.
              </Text>
            </View>

            {/* Mode de consentement — MON choix, et rien que le mien */}
            <View>
              <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
                Si quelqu’un veut faire binôme avec moi
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {([true, false] as const).map(v => {
                  const active = openToJoin === v;
                  return (
                    <TouchableOpacity key={String(v)} onPress={() => setOpen(v)} activeOpacity={0.8}
                      style={{
                        flex: 1, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 14,
                        backgroundColor: active ? 'rgba(255,193,26,0.14)' : Colors.bgCard,
                        borderWidth: 1, borderColor: active ? Colors.brand : Colors.border,
                      }}>
                      <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiExtraBold, color: active ? Colors.brandDeep : Colors.textPrimary }}>
                        {v ? 'Ouvert' : 'Sur accord'}
                      </Text>
                      <Text style={{ fontSize: 10.5, fontFamily: Fonts.ui, color: Colors.textMuted, marginTop: 3, lineHeight: 14 }}>
                        {v ? 'On me prend d’un geste' : 'On me demande d’abord'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {mode === 'duo' && partner && (
                <Text style={{ fontSize: 11, fontFamily: Fonts.ui, color: Colors.textMuted, marginTop: 6 }}>
                  Ce choix reste le tien : il s’appliquera si ton binôme se défait.
                </Text>
              )}
            </View>

            {/* Le partenaire — déjà montré en tête sur une arrivée ciblée. */}
            {mode === 'duo' && !cible && (
              <View>
                <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
                  Mon partenaire
                </Text>
                {partner ? (
                  <View style={[cs.card, { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
                    <Avatar name={partner.name} path={partner.avatar_path} size={38} />
                    <Text style={{ flex: 1, fontSize: 13, fontFamily: Fonts.uiBold, color: Colors.textPrimary }}>{partner.name}</Text>
                    <TouchableOpacity onPress={() => { setPartner(null); setQuery(''); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Icon name="x" size={16} color={Colors.textMuted} stroke={2.2} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    <TextInput
                      value={query} onChangeText={setQuery}
                      placeholder="Chercher un joueur…" placeholderTextColor={Colors.textMuted}
                      autoCorrect={false}
                      style={{
                        backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
                        borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11,
                        fontSize: 13.5, fontFamily: Fonts.ui, color: Colors.textPrimary,
                      }}
                    />
                    {searching && <ActivityIndicator style={{ marginTop: 10 }} color={Colors.primary} />}
                    {!searching && searchError && (
                      <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: Colors.danger, marginTop: 8 }}>
                        Recherche indisponible pour l’instant. Réessaie dans un instant.
                      </Text>
                    )}
                    {!searching && !searchError && query.trim().length >= 2 && results.length === 0 && (
                      <Text style={{ fontSize: 11.5, fontFamily: Fonts.ui, color: Colors.textMuted, marginTop: 8 }}>
                        Aucun joueur trouvé.
                      </Text>
                    )}
                    <View style={{ gap: 6, marginTop: 8 }}>
                      {results.map(p => {
                        // Griser TOUT inscrit etait un cul-de-sac : celui qui
                        // est inscrit et resté SEUL est precisement la personne
                        // avec qui on veut jouer. Seul un joueur deja en binome
                        // est hors de portee. Cf. lib/tournaments.partnerPath.
                        const path = partnerPath(p.id, { registered: registeredIds, soloOpen });
                        const bloque = path === 'blocked';
                        return (
                          <TouchableOpacity
                            key={p.id} disabled={bloque} activeOpacity={0.8}
                            onPress={() => setPartner({ id: p.id, name: p.name, avatar_path: (p as any).avatar_path ?? null })}
                            style={[cs.card, {
                              padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10,
                              opacity: bloque ? 0.45 : 1,
                            }]}>
                            <Avatar name={p.name} path={(p as any).avatar_path} size={34} />
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: Fonts.uiBold, color: Colors.textPrimary }}>
                                {p.name}
                              </Text>
                              {path !== 'direct' && (
                                <Text numberOfLines={1} style={{ fontSize: 10.5, fontFamily: Fonts.uiBold, color: bloque ? Colors.textMuted : Colors.brandDeep, marginTop: 1 }}>
                                  {PARTNER_PATH_LABEL[path]}
                                </Text>
                              )}
                            </View>
                            {p.elo_score != null && (
                              <Pill variant="ink">{`Niv. ${eloToLevel(p.elo_score).toFixed(1)}`}</Pill>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}
                {/* Ce bandeau annonçait « ton partenaire est inscrit sans rien
                    déclarer en son nom » — quel que soit le partenaire. Il
                    décrivait l'inscription d'office, supprimée par
                    tournament_partner_invite.sql : il était faux pour un
                    joueur pas encore inscrit (il reçoit une demande, on
                    n'inscrit rien à sa place) ET pour un joueur déjà inscrit
                    (qui a déclaré son côté et son mode lui-même). Le texte
                    dépend maintenant du chemin réel (lib/tournaments). */}
                {partner && cheminPartenaire && (
                  <Notice tone="info">
                    {partnerIntentNotice(cheminPartenaire, partner.name)}
                  </Notice>
                )}
              </View>
            )}

            <PrimaryButton
              // Le bouton DIT ce qu'il va faire : avec un partenaire deja
              // inscrit, il ne nous inscrit pas tous les deux — il m'inscrit et
              // forme le binome, ou envoie une demande.
              label={mode !== 'duo' || !cheminPartenaire
                ? 'M’inscrire'
                : registerCtaLabel(cheminPartenaire)}
              busy={busy}
              disabled={mode === 'duo' && !partner}
              onPress={submit}
            />
            <PrimaryButton tone="ghost" label="Annuler" onPress={onClose} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Changer de côté (Task 12) ───────────────────────────────────────────────
// La feuille d'inscription promet « il pourra changer, ou défaire le
// binôme » pour le partenaire inscrit sans avoir rien déclaré — cette feuille
// tient cette promesse : `tournament_set_side`, signature GELÉE, appelable
// jusqu'au premier tirage (`canChangeSide` dans l'écran appelant). Même motif
// de surimpression absolue que `RegisterSheet` / `ScoreSheet`.

function ChangeSideSheet({ current, busy, onClose, onChoose }: {
  current: TournamentSide;
  busy: boolean;
  onClose: () => void;
  onChoose: (side: TournamentSide) => void;
}) {
  const insets = useSafeAreaInsets();
  const [side, setSideLocal] = useState<TournamentSide>(current);
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={onClose} />
      <View style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        backgroundColor: Colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22,
        paddingBottom: insets.bottom + 16, paddingHorizontal: 18,
      }}>
        <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 2 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border }} />
        </View>
        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 16, color: Colors.textPrimary, paddingTop: 8, paddingBottom: 4 }}>
          Mon côté ce soir-là
        </Text>
        <Text style={{ fontSize: 11.5, fontFamily: Fonts.ui, color: Colors.textMuted, paddingBottom: 14, lineHeight: 16 }}>
          Vaut pour CE tournoi. Modifiable jusqu’au premier tirage — une fois les matchs affichés, le tableau est
          publié sur la base des côtés déclarés à cet instant-là.
        </Text>
        <SideChooser value={side} onChange={setSideLocal} />
        <View style={{ marginTop: 16 }}>
          <PrimaryButton label="Valider" busy={busy} onPress={() => onChoose(side)} />
        </View>
      </View>
    </View>
  );
}
