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

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl,
  TextInput, Alert, Pressable, StyleSheet, KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../hooks/usePlayer';
import { Colors, Fonts, eloToLevel } from '../../lib/theme';
import { Pill } from '../../components/Pill';
import { Icon } from '../../components/community/icons';
import { displayName, isDeleted } from '../../lib/players';
import {
  fetchTournament, fetchRegistrations, fetchTeams, fetchMyJoinRequests,
  getTournamentsEnabled, registerToTournament, joinTournamentPlayer,
  respondJoinRequest, leaveTournamentTeam, withdrawFromTournament,
  checkInToTournament, setOpenToJoin, setSide, isFeatureDisabled, resultMessage,
  myTournamentState, soloRegistrations, seatsLabel, seatsTaken, seatCount,
  waitlistCount, freePlaces, levelRangeLabel, priceLabel, statusLabel, statusTone,
  sideLabel, sameSideWarning, formatTournamentDate, teamCount,
  acceptsRegistrations, acceptsPairing, acceptsCheckIn, ROUND_MINUTES,
  fetchRoundMatches, fetchRoundMovements, fetchMatchEntries, fetchStandings,
  fetchTournamentResults, groupResultsByTeam, fetchFinalStakes, stakeLabel,
  enterTournamentScore, matchLiveStatus,
  type Tournament, type TournamentRegistration, type TournamentTeam, type TournamentResult,
  type JoinRequest, type TournamentSide,
  type TournamentMatch, type TournamentMovement, type TournamentMatchEntry, type TournamentStanding,
  type TournamentResultTeamRow, type TournamentStake,
} from '../../lib/tournaments';
import { GENERIC_REASON } from '../../lib/tournamentReasons';
import { CourtRow, type CourtTeamInfo } from '../../components/tournaments/CourtRow';
import { StandingsTable, type StandingRowData } from '../../components/tournaments/StandingsTable';
import { FinalStandings, type FinalStandingRowData } from '../../components/tournaments/FinalStandings';
import { TournamentShareCard } from '../../components/tournaments/TournamentShareCard';
import { ScoreSheet, type ScoreSheetTeam } from '../../components/tournaments/ScoreSheet';

// ─── Briques d'affichage (conventions du dépôt) ──────────────────────────────

const cs = StyleSheet.create({
  card: {
    backgroundColor: Colors.bgCard, borderRadius: 18,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
    shadowColor: Colors.textPrimary, shadowOpacity: 0.04, shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
});

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, marginTop: 4 }}>
      <View style={{ width: 3, height: 14, backgroundColor: Colors.brand, borderRadius: 2 }} />
      <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, letterSpacing: 1.5, textTransform: 'uppercase' }}>
        {children}
      </Text>
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

function PrimaryButton({ label, onPress, disabled, busy, tone = 'dark' }: {
  label: string; onPress: () => void; disabled?: boolean; busy?: boolean;
  tone?: 'dark' | 'brand' | 'ghost' | 'danger';
}) {
  const bg = tone === 'brand' ? Colors.brand : tone === 'ghost' ? Colors.bgCard : tone === 'danger' ? Colors.bgCard : Colors.primary;
  const fg = tone === 'brand' ? Colors.textOnBrand : tone === 'ghost' ? Colors.textPrimary : tone === 'danger' ? Colors.danger : Colors.textOnDark;
  return (
    <TouchableOpacity
      onPress={onPress} disabled={disabled || busy} activeOpacity={0.85}
      style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        backgroundColor: bg, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 16,
        borderWidth: tone === 'ghost' || tone === 'danger' ? 1 : 0,
        borderColor: tone === 'danger' ? 'rgba(239,68,68,0.45)' : Colors.border,
        opacity: disabled ? 0.45 : 1,
      }}>
      {busy ? <ActivityIndicator size="small" color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 13.5, fontFamily: Fonts.uiBlack, letterSpacing: 0.2 }}>{label}</Text>
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

function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  return (
    <View style={{
      width: size, height: size, borderRadius: Math.round(size * 0.3),
      backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ color: Colors.textOnDark, fontSize: Math.round(size * 0.42), fontWeight: '900' }}>
        {(name || '?').charAt(0).toUpperCase()}
      </Text>
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
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
  const [scoreSheetMatchId, setScoreSheetMatchId] = useState<string | null>(null);
  const [scoreBusy, setScoreBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const on = await getTournamentsEnabled();
    setEnabled(on);
    if (!on) { setLoading(false); return; }
    try {
      const [t, r, tm, jr] = await Promise.all([
        fetchTournament(id), fetchRegistrations(id), fetchTeams(id), fetchMyJoinRequests(id),
      ]);
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
  const canRegister = acceptsRegistrations(t.status) && !me.registration;
  const canPair = acceptsPairing(t.status);
  const mySide = me.registration?.side ?? null;
  const partnerReg = me.partnerId ? byId.get(me.partnerId) : null;
  const pairWarning = sameSideWarning(mySide, partnerReg?.side ?? null);
  // Le côté n'est plus modifiable une fois le premier tirage fait
  // (`matches_already_generated` côté serveur) — `current_round > 0` en est
  // le miroir exact côté lecture : c'est `tournament_generate_round` qui
  // écrit le premier tour, et rien d'autre n'insère dans `tournament_matches`.
  const canChangeSide = t.current_round === 0;

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

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {/* ── En-tête sombre ── */}
      <View style={{
        backgroundColor: Colors.heroBg,
        paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 18,
        borderBottomLeftRadius: 28, borderBottomRightRadius: 28,
      }}>
        <TouchableOpacity onPress={() => router.back()} style={{ alignSelf: 'flex-start' }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Icon name="chevronLeft" size={22} color={Colors.textOnDark} stroke={2.2} />
        </TouchableOpacity>
        {/* Titre Fonts.welcome à contenu DYNAMIQUE : segment unique (pas de
            <Text> imbriqué, qui rendrait adjustsFontSizeToFit inopérant sur
            Android), numberOfLines=1 + adjustsFontSizeToFit + paddingRight
            anti-débord italique, et alignSelf 'stretch' pour que la boîte ne
            dépende pas d'une largeur intrinsèque périmée.
            Cf. feedback_android_title_clipping. */}
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
          style={{
            alignSelf: 'stretch', fontSize: 25, lineHeight: 33, fontFamily: Fonts.welcome,
            color: Colors.textOnDark, includeFontPadding: false, marginTop: 10, paddingRight: 8,
          }}>
          {t.name}
        </Text>
        <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiSemi, color: Colors.textSecondary, marginTop: 3 }}>
          {formatTournamentDate(t.starts_at)} · {t.club?.name ?? 'Club à confirmer'}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          {/* Couleur SOURCE UNIQUE (`statusTone`, lib/tournaments.ts) — même
              couleur ici, sur la carte de liste et dans l'admin. */}
          <Pill variant={statusTone(t.status)}>
            {statusLabel(t.status)}
          </Pill>
          <Pill variant="neutral">{levelRangeLabel(t.level_min, t.level_max)}</Pill>
          <Pill variant="neutral">{priceLabel(t.price_mad)}</Pill>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 32, gap: 14 }}
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

        {/* ── Mon résultat — dès que le tournoi est clos, LE fait de la
            soirée : « tu finis Xe, +Y points ». Séparé de « La soirée »
            ci-dessous pour ne jamais se confondre avec le tableau du dernier
            tour ou le classement vivant (défaut n°3 de la relecture). */}
        {closed && me.team && (
          <View style={[cs.card, { padding: 14, gap: 4 }]}>
            <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, color: Colors.textMuted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
              Mon résultat
            </Text>
            {myFinalResult ? (
              <>
                <Text style={{ fontSize: 22, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
                  {myFinalResult.final_rank === 1 ? '🏆 1er' : `${myFinalResult.final_rank}e`} place
                  {t.status === 'CLASSEMENT_VALIDE' ? ` · +${myFinalResult.points} points` : ''}
                </Text>
                {t.status === 'TERMINE' && (
                  <Text style={{ fontSize: 12, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>
                    {myFinalResult.points} points en attente de validation par l’organisateur.
                  </Text>
                )}
              </>
            ) : finalResultsError ? (
              <Notice tone="warning">{finalResultsError}</Notice>
            ) : (
              <Text style={{ fontSize: 12, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>
                Résultat pas encore disponible.
              </Text>
            )}
          </View>
        )}

        {/* ── La soirée : tableau des terrains + classement ── */}
        {started && (
          <View style={{ gap: 10 }}>
            <SectionTitle>La soirée</SectionTitle>
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

        {/* ── Les places, en JOUEURS ── */}
        <View style={[cs.card, { padding: 14 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, color: Colors.textMuted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                Places
              </Text>
              <Text style={{ fontSize: 30, lineHeight: 36, fontFamily: Fonts.uiBlack, color: free > 0 ? Colors.textPrimary : Colors.danger }}>
                {seatsLabel(regs, t.court_count)}
              </Text>
            </View>
            <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: Colors.textSecondary, textAlign: 'right', flex: 1, marginLeft: 12 }}>
              joueurs · {teamCount(t.court_count)} binômes{'\n'}
              {waiting > 0 ? `${waiting} en liste d’attente` : free > 0 ? `${free} place${free > 1 ? 's' : ''} libre${free > 1 ? 's' : ''}` : 'complet'}
            </Text>
          </View>
          {/* Jauge */}
          <View style={{ height: 8, borderRadius: 999, backgroundColor: Colors.bg, marginTop: 12, overflow: 'hidden' }}>
            <View style={{
              width: `${Math.min(100, total > 0 ? (taken / total) * 100 : 0)}%`,
              height: '100%', borderRadius: 999,
              backgroundColor: free > 0 ? Colors.brand : Colors.danger,
            }} />
          </View>
        </View>

        {/* ── Le format ── */}
        <View style={[cs.card, { paddingHorizontal: 14, paddingVertical: 4 }]}>
          <InfoLine icon="calendar" label="Date" value={formatTournamentDate(t.starts_at)} />
          <InfoLine icon="mapPin"   label="Club" value={t.club?.name ?? 'À confirmer'} />
          <InfoLine icon="racket"   label="Format" value={`${t.court_count} terrains · ${t.round_count} rotations`} />
          <InfoLine icon="clock"    label="Rotation" value={`${ROUND_MINUTES} min`} />
          <InfoLine icon="trendingUp" label="Niveau" value={levelRangeLabel(t.level_min, t.level_max)} />
          <InfoLine icon="gem"      label="Prix" value={priceLabel(t.price_mad)} tone={t.price_mad > 0 ? Colors.brandDeep : undefined} />
        </View>

        {/* ── Comment ça marche ── */}
        <View style={[cs.card, { padding: 14, gap: 8 }]}>
          <SectionTitle>Comment ça marche</SectionTitle>
          {[
            `${teamCount(t.court_count)} binômes se répartissent sur ${t.court_count} terrains, les mieux classés au Terrain 1.`,
            `${t.round_count} rotations de ${ROUND_MINUTES} minutes s’enchaînent : un match court, un résultat, on bouge.`,
            'Le binôme qui gagne MONTE d’un terrain (vers le Terrain 1, le plus fort), celui qui perd descend d’un.',
            'La dernière rotation ne fait plus bouger personne : elle classe.',
            'Le classement départage au terrain atteint, puis aux victoires, puis à la différence de jeux.',
          ].map((line, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
              <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, color: Colors.brandDeep, width: 14 }}>{i + 1}</Text>
              <Text style={{ flex: 1, fontSize: 12.5, fontFamily: Fonts.ui, color: Colors.textSecondary, lineHeight: 18 }}>{line}</Text>
            </View>
          ))}
        </View>

        {/* ── Où j'en suis ── */}
        <View style={{ gap: 10 }}>
          <SectionTitle>Mon inscription</SectionTitle>

          {!me.registration ? (
            canRegister ? (
              <View style={{ gap: 8 }}>
                {free === 0 && (
                  <Notice tone="warning">
                    {waiting > 0
                      ? 'Une liste d’attente est en cours : ton inscription y entrera à son tour.'
                      : 'Le tournoi est complet : ton inscription entrera en liste d’attente.'}
                  </Notice>
                )}
                <PrimaryButton label="M’inscrire" onPress={() => setSheetOpen(true)} />
              </View>
            ) : (
              <Notice tone="info">Les inscriptions sont fermées pour ce tournoi.</Notice>
            )
          ) : (
            <View style={[cs.card, { padding: 14, gap: 12 }]}>
              {me.waitlisted && (
                <Notice tone="warning">
                  Tu es en liste d’attente{me.registration.waitlist_position ? ` (rang ${me.registration.waitlist_position})` : ''}.{' '}
                  {/* La file n'avance plus une fois les matchs tirés — un
                      texte qui promet encore une place après le lancement
                      serait un mensonge (défaut n°9 de la relecture). */}
                  {acceptsPairing(t.status)
                    ? 'Ta place se prendra dès qu’il s’en libère une.'
                    : 'Le tournoi a démarré sans que ta place ne se libère : la liste d’attente ne bouge plus pour cette soirée.'}
                </Notice>
              )}

              {/* Mon côté (déclaré POUR CE TOURNOI) — modifiable jusqu'au
                  premier tirage (`tournament_set_side`, `matches_already_generated`
                  au-delà). La feuille d'inscription PROMET ce changement
                  (« il pourra changer ») : avant cette correction, rien ne le
                  tenait (défaut n°1 de la relecture). */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ flex: 1, fontSize: 12.5, fontFamily: Fonts.ui, color: Colors.textSecondary }}>Mon côté ce soir-là</Text>
                <Pill variant="ink">{sideLabel(me.registration.side)}</Pill>
                {canChangeSide && (
                  <TouchableOpacity onPress={() => setSideSheetOpen(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBlack, color: Colors.brandDeep }}>Changer</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Mon binôme, ou mon mode de consentement */}
              {/* `me.team` seul décide : l'inscription du partenaire est
                  garantie par les clés étrangères, mais si elle manquait, on
                  afficherait quand même « tu as un binôme » plutôt que le
                  réglage de consentement, que le serveur refuserait
                  (`already_in_team`). */}
              {me.team?.withdrawn ? (
                // Le binôme a été déclaré FORFAIT (organisateur, admin.tsx) :
                // rien ne le disait ici avant cette correction — le joueur
                // lisait encore « Ton binôme · côté gauche » comme si de rien
                // n'était (défaut n°8 de la relecture). Même mot partout
                // pour cet événement : « Forfait », jamais « Abandon ».
                <Notice tone="danger">
                  {displayName(partnerReg?.player, 'partner')} et toi avez été déclarés forfait. Vous ne jouez plus ce tournoi.
                </Notice>
              ) : me.team ? (
                <View style={{ gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Avatar name={displayName(partnerReg?.player, 'partner')} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontSize: 13.5, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
                        {displayName(partnerReg?.player, 'partner')}
                      </Text>
                      <Text style={{ fontSize: 11.5, fontFamily: Fonts.ui, color: Colors.textSecondary }}>
                        Ton binôme{partnerReg ? ` · côté ${sideLabel(partnerReg.side).toLowerCase()}` : ''}
                      </Text>
                    </View>
                  </View>
                  {/* Autorisé, seulement signalé. */}
                  {pairWarning && <Notice tone="warning">{pairWarning}</Notice>}
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
              ) : (
                <View style={{ gap: 10 }}>
                  {/* Le message ne promet la liste plus bas que si elle porte
                      encore un bouton — après le tirage, `canAsk` y est
                      toujours faux et l'instruction devenait fausse (défaut
                      n°9 de la relecture). */}
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

              {/* Pointage du jour J — MASQUÉ en liste d'attente : le serveur
                  refuse `tournament_check_in` pour un joueur en attente
                  (`not_registered`, alors qu'il EST inscrit) parce qu'il n'a
                  aucune place à confirmer. Avant cette correction, le bouton
                  s'affichait juste sous le bandeau « Tu es en liste
                  d'attente » et niait l'encadré du dessus (défaut n°1 de la
                  relecture). */}
              {acceptsCheckIn(t.status) && !me.waitlisted && (
                me.registration.check_in_status === 'checked_in'
                  ? <Notice tone="success">Ta présence est enregistrée.</Notice>
                  : <PrimaryButton tone="brand" label="Je suis là" busy={busy === 'checkin'}
                      onPress={() => run('checkin', () => checkInToTournament(t.id), 'Ta présence est enregistrée.')} />
              )}

              {canPair && (
                <PrimaryButton
                  tone="danger" label="Me désinscrire" busy={busy === 'withdraw'}
                  onPress={() => Alert.alert(
                    'Te désinscrire ?',
                    'Ta place se libère et la liste d’attente avance. Ton partenaire, s’il y en a un, reste inscrit avec sa place.',
                    [
                      { text: 'Annuler', style: 'cancel' },
                      { text: 'Me désinscrire', style: 'destructive', onPress: () => run('withdraw', () => withdrawFromTournament(t.id)) },
                    ],
                  )}
                />
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
                      <Avatar name={displayName(from?.player, 'partner')} size={30} />
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

        {/* ── Les joueurs seuls ── */}
        <View style={{ gap: 10 }}>
          <SectionTitle>Joueurs sans binôme ({solos.length})</SectionTitle>
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
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Avatar name={displayName(r.player, 'player')} />
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
                  </View>

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

      {sheetOpen && player && (
        <RegisterSheet
          tournamentId={t.id}
          myId={player.id}
          defaultSide={(player.court_side as TournamentSide | undefined) ?? 'both'}
          registeredIds={new Set(regs.map(r => r.player_id))}
          onClose={() => setSheetOpen(false)}
          onDone={async (res) => {
            if (isFeatureDisabled(res)) { setSheetOpen(false); setEnabled(false); return; }
            if (!res.ok) { Alert.alert('Impossible', resultMessage(res)); return; }
            setSheetOpen(false);
            await load();
            if (res.waitlisted === true) {
              Alert.alert('Liste d’attente', 'Le tournoi est plein : tu entres en liste d’attente et tu avanceras dès qu’une place se libère.');
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
        const canEnter = t.status === 'EN_COURS' && iAmIn && status !== 'confirmed' && status !== 'forfeited';
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

function RegisterSheet({ tournamentId, myId, defaultSide, registeredIds, onClose, onDone }: {
  tournamentId: string;
  myId: string;
  /** Prérempli depuis le profil — le côté reste un choix PROPRE AU TOURNOI. */
  defaultSide: TournamentSide;
  registeredIds: Set<string>;
  onClose: () => void;
  onDone: (res: TournamentResult) => void;
}) {
  const insets = useSafeAreaInsets();
  const [side, setSide] = useState<TournamentSide>(defaultSide);
  const [mode, setMode] = useState<'solo' | 'duo'>('solo');
  const [openToJoin, setOpen] = useState(true);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; name: string; elo_score?: number | null }[]>([]);
  const [partner, setPartner] = useState<{ id: string; name: string } | null>(null);
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
          .from('players').select('id, name, elo_score')
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

  const submit = async () => {
    setBusy(true);
    try {
      // `open_to_join` est MON mode, avec ou sans partenaire : le serveur écrit
      // le partenaire FERMÉ de son côté, on ne décide rien pour lui.
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
          <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 16, color: Colors.textPrimary, paddingHorizontal: 18, paddingTop: 8 }}>
            M’inscrire
          </Text>

          <ScrollView contentContainerStyle={{ padding: 18, gap: 16 }} keyboardShouldPersistTaps="handled">
            {/* Seul ou à deux */}
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
              {mode === 'duo' && (
                <Text style={{ fontSize: 11, fontFamily: Fonts.ui, color: Colors.textMuted, marginTop: 6 }}>
                  Ce choix reste le tien : il s’appliquera si ton binôme se défait.
                </Text>
              )}
            </View>

            {/* Le partenaire */}
            {mode === 'duo' && (
              <View>
                <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
                  Mon partenaire
                </Text>
                {partner ? (
                  <View style={[cs.card, { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
                    <Avatar name={partner.name} size={30} />
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
                        const already = registeredIds.has(p.id);
                        return (
                          <TouchableOpacity
                            key={p.id} disabled={already} activeOpacity={0.8}
                            onPress={() => setPartner({ id: p.id, name: p.name })}
                            style={[cs.card, { padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: already ? 0.5 : 1 }]}>
                            <Avatar name={p.name} size={28} />
                            <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontFamily: Fonts.uiBold, color: Colors.textPrimary }}>
                              {p.name}
                            </Text>
                            {already
                              ? <Pill variant="neutral">Déjà inscrit</Pill>
                              : p.elo_score != null
                                ? <Pill variant="ink">{`Niv. ${eloToLevel(p.elo_score).toFixed(1)}`}</Pill>
                                : null}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}
                <Notice tone="info">
                  Ton partenaire est inscrit sans rien déclarer en son nom : côté « les deux », et
                  « sur accord » pour tout le reste. Il pourra changer, ou défaire le binôme.
                </Notice>
              </View>
            )}

            <PrimaryButton
              label={mode === 'duo' ? 'Nous inscrire' : 'M’inscrire'}
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
