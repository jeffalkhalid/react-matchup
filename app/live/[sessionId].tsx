// Écran du score en direct : scoreur (2 gros boutons) ou lecteur (realtime),
// selon session.scorer_id === moi (rôle DYNAMIQUE — un `scorer_changed` reçu
// par realtime fait basculer le rendu tout seul).
//
// Source de rendu :
//   • lecteur  → `session.current_state` (serveur, realtime) directement ;
//   • scoreur  → état optimiste local (`replayEvents(localEvents)`), car la file
//     offline de lib/liveSession peut avoir de l'avance sur le serveur.
// Le scoreur ré-adopte l'état serveur dès que sa file est vide ET que les deux
// représentations comptent le même nombre de jeux (cf. `adopt` plus bas).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator,
  Vibration, StyleSheet, Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import { supabase } from '../../lib/supabase';
import { usePlayer } from '../../hooks/usePlayer';
import { notifyPlayers } from '../../lib/notify';
import { Colors, Fonts, FontSize, Radius, Spacing } from '../../lib/theme';
import {
  replayEvents, isMatchDecided, gameScoreLabels, eventsFromState, progressKey,
  type LiveState, type LiveEvent, type ReplayOpts,
} from '../../lib/liveScore';
import {
  type LiveSession, sendLiveEvent, subscribeLiveSession, takeOverScoring,
  finalizeLiveSession, getPendingCount, ensureQueueLoaded, getQueuedEvents, flushQueue,
  claimPhoneInput,
} from '../../lib/liveSession';
import { PM, ACCENT, accentOf, PFonts } from '../../components/profile/theme';
import { Avatar } from '../../components/profile/components';

const EMPTY_STATE: LiveState = {
  sets: [{ t1: 0, t2: 0 }], setsWon: { t1: 0, t2: 0 },
  currentGame: null, tieBreak: false, finished: false, openContests: 0,
};

// NB : eventsFromState (journal synthétique — limites documentées dans
// lib/liveScore.ts) et progressKey vivent dans lib/liveScore, testés là-bas.

// Semis COMPLET de l'état local du scoreur = état serveur + événements encore
// en file, rejoués par-dessus. Indispensable après un remontage de l'écran (ou
// un redémarrage de l'app) alors que des taps n'ont pas encore été acquittés :
// `current_state` est alors forcément EN RETARD de ces événements, et semer
// depuis lui seul rendrait l'état local durablement incohérent avec la file.
function seedEvents(state: LiveState, sessionId: string): LiveEvent[] {
  const events = eventsFromState(state);
  let seq = (events[events.length - 1]?.seq ?? 0) + 1;
  for (const q of getQueuedEvents(sessionId)) {
    events.push({
      seq: seq++,
      event_type: q.type as LiveEvent['event_type'],
      payload: (q.payload ?? {}) as LiveEvent['payload'],
    });
  }
  return events;
}

const firstName = (n: string) => (n ?? '').trim().split(/\s+/)[0] || '?';

// ── Carte blanche façon MatchCard (profil) ─────────────────────────────────
// Équipes à gauche (avatars à initiales + prénoms, or/noir comme la carte de
// match), grille de sets à droite (colonnes bordées, chiffres Anton, ligne du
// leader surlignée or). `leadRow` null (égalité en cours) → aucune ligne
// surlignée. `children` : rangée additionnelle (jeu en cours, mode points).
const A = accentOf(ACCENT);

function MatchStyleBoard({ t1Ids, t2Ids, names, sets, leadRow, children }: {
  t1Ids: string[]; t2Ids: string[]; names: Record<string, string>;
  sets: { t1: number; t2: number }[];
  leadRow: 0 | 1 | null;
  children?: React.ReactNode;
}) {
  const teamRow = (ids: string[], team: 0 | 1) => (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {ids.map(id => (
        <View key={id} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Avatar name={names[id] ?? '?'} size={28} team={team} />
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12.5, fontWeight: '700', color: PM.text }}>
            {firstName(names[id] ?? '')}
          </Text>
        </View>
      ))}
    </View>
  );
  const nSets = sets.length;
  const gridRow = (rowIdx: 0 | 1) => (
    <View style={{ flexDirection: 'row' }}>
      {sets.map((s, i) => {
        const win = leadRow === rowIdx;
        return (
          <View key={`${rowIdx}-${i}`} style={{
            width: 30, paddingVertical: 7, alignItems: 'center', justifyContent: 'center',
            borderRightWidth: i < nSets - 1 ? 1 : 0, borderRightColor: PM.divider,
            borderBottomWidth: rowIdx === 0 ? 1 : 0, borderBottomColor: PM.divider,
            backgroundColor: win ? A.soft : 'transparent',
          }}>
            <Text style={{ fontFamily: PFonts.anton, fontSize: 19, lineHeight: 25, color: win ? ACCENT : PM.muted }}>
              {rowIdx === 0 ? s.t1 : s.t2}
            </Text>
          </View>
        );
      })}
    </View>
  );
  return (
    <View style={{ backgroundColor: PM.card, borderRadius: 18, borderWidth: 1, borderColor: PM.border, padding: 14, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
          {teamRow(t1Ids, 0)}
          {teamRow(t2Ids, 1)}
        </View>
        <View style={{ borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: PM.border, backgroundColor: '#FBFBFA' }}>
          {gridRow(0)}
          {gridRow(1)}
        </View>
      </View>
      {children}
    </View>
  );
}

export default function LiveScoreScreen() {
  useKeepAwake();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { player } = usePlayer();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const sessionId = String(params.sessionId ?? '');

  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const [session, setSession] = useState<LiveSession | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [localEvents, setLocalEvents] = useState<LiveEvent[]>([]);
  const [pending, setPending] = useState(0);
  const [ackSets, setAckSets] = useState<number | null>(null); // « Continuer un set »
  const [forceEnd, setForceEnd] = useState(false);             // « Terminer maintenant »
  const [busy, setBusy] = useState(false);
  // La file offline doit être restaurée du disque AVANT tout semis : sans ça on
  // sèmerait depuis le seul état serveur en ignorant les événements en attente.
  const [queueReady, setQueueReady] = useState(false);
  const seeded = useRef(false);

  const refreshPending = useCallback(() => {
    if (!mounted.current || !sessionId) return;
    setPending(getPendingCount(sessionId));
  }, [sessionId]);

  // ── 1. Chargement (session + prénoms des 4 joueurs) ──────────────────────
  useEffect(() => {
    if (!sessionId) { setLoading(false); setNotFound(true); return; }
    let cancelled = false;
    (async () => {
      // Restaure la file offline AVANT de faire confiance à getPendingCount.
      await ensureQueueLoaded(sessionId);
      if (cancelled) return;
      setPending(getPendingCount(sessionId));
      setQueueReady(true);
      // Une file restaurée du disque n'est jamais vidée toute seule : sans ce
      // flush explicite, des taps faits hors ligne avant un kill de l'app
      // resteraient en attente jusqu'au prochain événement envoyé.
      flushQueue(sessionId).finally(refreshPending);

      const { data } = await supabase
        .from('live_match_sessions').select('*').eq('id', sessionId).single();
      if (cancelled) return;
      if (!data) { setNotFound(true); setLoading(false); return; }
      const s = data as LiveSession;
      setSession(s);
      setLoading(false);

      const ids = [...(s.team1_ids ?? []), ...(s.team2_ids ?? [])].filter(Boolean);
      if (ids.length === 0) return;
      const { data: rows } = await supabase.from('players').select('id,name').in('id', ids);
      if (cancelled) return;
      const map: Record<string, string> = {};
      (rows ?? []).forEach((p: any) => { map[p.id] = p.name ?? '?'; });
      setNames(map);
    })();
    return () => { cancelled = true; };
  }, [sessionId, refreshPending]);

  // ── 2. Realtime ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const unsubscribe = subscribeLiveSession(sessionId, s => {
      if (cancelled || !mounted.current) return;
      // Un payload realtime peut arriver SANS les colonnes scoring_mode /
      // golden_point (cache de schéma Realtime pas encore rafraîchi après la
      // migration, réplique en retard). Retomber alors sur 'games' en plein
      // match ferait envoyer des game_won → rejetés wrong_scoring_mode → taps
      // perdus en silence. On préserve donc les valeurs déjà connues.
      setSession(prev => prev ? {
        ...s,
        scoring_mode: s.scoring_mode ?? prev.scoring_mode,
        golden_point: s.golden_point ?? prev.golden_point,
      } : s);
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [sessionId]);

  // Tant qu'il reste des événements en file : on relance le flush (retry
  // automatique au retour du réseau — `flush` sort en silence sur erreur
  // réseau et garde les événements) et on rafraîchit le compteur affiché.
  useEffect(() => {
    if (pending <= 0 || !sessionId) return;
    const t = setInterval(() => { flushQueue(sessionId).finally(refreshPending); }, 2000);
    return () => clearInterval(t);
  }, [pending, refreshPending, sessionId]);

  const isScorer = !!session && !!player && session.scorer_id === player.id;
  // La montre a la main : le téléphone affiche mais ne marque plus (spec §8).
  const watchHasControl = session?.input_device === 'watch';
  const serverState: LiveState = session?.current_state ?? EMPTY_STATE;
  // Granularité figée au démarrage de la session (sessions pré-migration :
  // champs absents → jeu par jeu, point en or).
  const scoringMode: 'games' | 'points' = session?.scoring_mode ?? 'games';
  const goldenPoint = session?.golden_point ?? true;
  const replayOpts = useMemo<ReplayOpts>(
    () => ({ mode: scoringMode, goldenPoint }), [scoringMode, goldenPoint]);

  // ── 3. Réconciliation local ↔ serveur ────────────────────────────────────
  // Semis (premier état reçu, ou tant qu'on n'est pas scoreur) : état serveur +
  // file encore en attente, via `seedEvents` — jamais l'état serveur seul, qui
  // est en retard des événements non acquittés.
  // Adoption (scoreur) : file vide ET serveur au moins aussi avancé que le
  // local. Tant que le serveur a MOINS de jeux, il n'a pas encore encaissé nos
  // taps et l'adopter ferait reculer le score à l'écran.
  useEffect(() => {
    const st = session?.current_state;
    if (!st || !queueReady) return;
    if (!seeded.current || !isScorer) {
      seeded.current = true;
      setLocalEvents(seedEvents(st, sessionId));
      return;
    }
    if (pending > 0) return;
    setLocalEvents(prev =>
      progressKey(st) >= progressKey(replayEvents(prev, replayOpts)) ? eventsFromState(st) : prev);
  }, [session, isScorer, pending, queueReady, sessionId, replayOpts]);

  const state: LiveState = useMemo(
    () => (isScorer ? replayEvents(localEvents, replayOpts) : serverState),
    [isScorer, localEvents, serverState, replayOpts]);

  const label1 = (session?.team1_ids ?? []).map(id => firstName(names[id] ?? '')).join(' & ') || 'Équipe A';
  const label2 = (session?.team2_ids ?? []).map(id => firstName(names[id] ?? '')).join(' & ') || 'Équipe B';

  const doneSets = state.sets.slice(0, -1);
  const currentSet = state.sets[state.sets.length - 1] ?? { t1: 0, t2: 0 };
  const setsPlayed = state.setsWon.t1 + state.setsWon.t2;
  const decided = isMatchDecided(state);
  // Score STOCKÉ à la validation = sets terminés uniquement (doit être égal à
  // matches.score_text produit par finalize_live_session côté serveur).
  const finalScore = doneSets.map(s => `${s.t1}-${s.t2}`).join(', ');
  const winnerTeam: 1 | 2 | null = decided
    ?? (state.setsWon.t1 > state.setsWon.t2 ? 1 : state.setsWon.t2 > state.setsWon.t1 ? 2 : null);
  const winnerLabel = winnerTeam === 1 ? label1 : winnerTeam === 2 ? label2 : '—';

  // ── Actions scoreur ──────────────────────────────────────────────────────
  const appendLocal = (event_type: LiveEvent['event_type'], payload: LiveEvent['payload'] = {}) => {
    setLocalEvents(prev => [...prev, { seq: (prev[prev.length - 1]?.seq ?? 0) + 1, event_type, payload }]);
  };

  // Un tap = un jeu (mode games) ou un point (mode points) — même bouton.
  const onScoreTap = (team: 1 | 2) => {
    if (!isScorer || !sessionId) return;
    Vibration.vibrate(30);
    const evt = scoringMode === 'points' ? 'point_won' : 'game_won';
    appendLocal(evt, { team });
    // `ackSets` n'est PAS remis à null ici : « Continuer un set » doit masquer la
    // carte de fin jusqu'à ce qu'un set de PLUS soit terminé, pas jusqu'au
    // prochain jeu.
    // Fire and forget : la file offline gère le réseau et l'ordre.
    sendLiveEvent(sessionId, evt, { team }).catch(() => {}).finally(refreshPending);
    setTimeout(refreshPending, 0);
  };

  const onUndo = () => {
    if (!isScorer || !sessionId) return;
    Vibration.vibrate(30);
    appendLocal('undo');
    setForceEnd(false);
    setAckSets(null);
    sendLiveEvent(sessionId, 'undo').catch(() => {}).finally(refreshPending);
    setTimeout(refreshPending, 0);
  };

  const onResolveContest = () => {
    if (!sessionId) return;
    sendLiveEvent(sessionId, 'contest_resolved').catch(() => {}).finally(refreshPending);
    setTimeout(refreshPending, 0);
  };

  const onMenu = () => {
    Alert.alert('Suivi en direct', undefined, [
      { text: 'Terminer maintenant', onPress: () => { setForceEnd(true); setAckSets(null); } },
      {
        text: 'Annuler le suivi live', style: 'destructive',
        onPress: () => Alert.alert(
          'Annuler le suivi live ?',
          'Le score en direct sera abandonné. Vous pourrez toujours saisir le score à la main après le match.',
          [
            { text: 'Continuer le suivi', style: 'cancel' },
            {
              text: 'Abandonner', style: 'destructive',
              onPress: () => {
                sendLiveEvent(sessionId, 'abandoned').catch(() => {});
                router.back();
              },
            },
          ]),
      },
      { text: 'Fermer', style: 'cancel' },
    ]);
  };

  const onFinalize = async () => {
    if (!sessionId || !player || busy) return;
    setBusy(true);
    try {
      const matchId = await finalizeLiveSession(sessionId);
      const others = [...(session?.team1_ids ?? []), ...(session?.team2_ids ?? [])]
        .filter(id => !!id && id !== player.id);
      // Circuit classique : le match est créé `pending`, la push est la même
      // que celle d'une saisie post-match (score-entry) et ouvre le match.
      notifyPlayers({
        playerIds: others,
        title: '📋 Score à valider',
        body: `Victoire ${winnerLabel} — ${finalScore}. Valide ou conteste.`,
        data: { type: 'match', matchId },
      });
      // Bascule LOCALE immédiate vers la vue « Match terminé » : ne pas
      // dépendre de la latence realtime (le payload confirmera/écrasera).
      if (mounted.current) {
        setSession(prev => prev
          ? { ...prev, status: 'finished', match_id: matchId, updated_at: new Date().toISOString() }
          : prev);
      }
      Alert.alert('Score enregistré', `Victoire ${winnerLabel} — ${finalScore}\nEn attente de validation par l'adversaire.`);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      const friendly = msg.includes('no_winner')
        ? 'Pas de vainqueur — joue un set décisif ou annule le dernier set.'
        : msg.includes('not_enough_sets')
        ? 'Un match compte au moins 2 sets terminés.'
        : msg;
      Alert.alert('Impossible de valider', friendly);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  // ── Actions lecteur ──────────────────────────────────────────────────────
  // v1 : les deux choix envoient le MÊME événement (sans target_seq) ; le
  // libellé ne sert qu'à orienter la conversation sur le terrain.
  const onContest = () => {
    Alert.alert('Contester le score', 'Quel score te semble faux ?', [
      { text: scoringMode === 'points' ? 'Le score actuel' : 'Le dernier jeu', onPress: () => { sendLiveEvent(sessionId, 'contest').catch(() => {}); } },
      { text: scoringMode === 'points' ? 'Un score plus ancien' : 'Un autre jeu', onPress: () => { sendLiveEvent(sessionId, 'contest').catch(() => {}); } },
      { text: 'Annuler', style: 'cancel' },
    ]);
  };

  // Retrait d'une contestation (lecteur) : v1 « compteur simple », sans
  // ownership — n'importe quel participant peut décrémenter, comme le scoreur.
  const onWithdrawContest = () => {
    Alert.alert(
      'Retirer ma contestation',
      'Le compteur de contestations sera décrémenté.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Retirer',
          onPress: () => { sendLiveEvent(sessionId, 'contest_resolved').catch(() => {}); },
        },
      ]);
  };

  const onTakeOver = () => {
    Alert.alert(
      'Reprendre le score',
      'Tu deviendras responsable de la saisie du score en direct.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Reprendre',
          onPress: async () => {
            try { await takeOverScoring(sessionId); }
            catch (e: any) { Alert.alert('Erreur', String(e?.message ?? e)); }
          },
        },
      ]);
  };

  const onClaimInput = async () => {
    if (!sessionId) return;
    try {
      await claimPhoneInput(sessionId);
      if (mounted.current) {
        setSession(prev => prev ? { ...prev, input_device: 'phone' } : prev);
      }
    } catch (e: any) {
      Alert.alert('Impossible de reprendre la saisie', String(e?.message ?? e));
    }
  };

  // ── Rendu ────────────────────────────────────────────────────────────────
  const Header = (
    <View style={{ paddingTop: insets.top + 8, paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
        <TouchableOpacity onPress={() => router.back()} style={sty.backBtn} activeOpacity={0.75}>
          <Text style={{ color: Colors.textOnDark, fontSize: 18, fontWeight: '900', lineHeight: 20 }}>‹</Text>
        </TouchableOpacity>
        {/* Brand lockup — raquette + wordmark, comme le lobby (lisible sur fond
            sombre : mêmes assets que app/index.tsx sur son overlay noir). */}
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
          <Image source={require('../../assets/auth/splash-racket.png')} style={{ width: 22, height: 22 }} resizeMode="contain" />
          <Image source={require('../../assets/auth/splash-wordmark.png')} style={{ width: 100, height: 22, marginLeft: -7 }} resizeMode="contain" />
        </View>
        {!isScorer && session?.status === 'live' ? (
          <View style={sty.livePill}>
            <Text style={sty.livePillTxt}>● EN DIRECT</Text>
          </View>
        ) : isScorer && session?.status === 'live' ? (
          <TouchableOpacity onPress={onMenu} style={sty.backBtn} activeOpacity={0.75}>
            <Text style={{ color: Colors.textOnDark, fontSize: 18, fontWeight: '900', lineHeight: 20 }}>⋯</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 36 }} />
        )}
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={[sty.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={Colors.brand} />
      </View>
    );
  }

  if (notFound || !session) {
    return (
      <View style={sty.screen}>
        {Header}
        <View style={sty.centerBox}>
          <Text style={sty.bigTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            Session introuvable
          </Text>
          <TouchableOpacity onPress={() => router.back()} style={sty.ghostBtn} activeOpacity={0.8}>
            <Text style={sty.ghostBtnTxt}>Retour</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // 9. Session terminée / abandonnée (au chargement ou par realtime).
  if (session.status !== 'live') {
    // Sets TERMINÉS uniquement — doit refléter matches.score_text tel que
    // finalize_live_session l'a stocké. Le set courant (cas « Terminer
    // maintenant » en cours de set) afficherait un score différent de celui
    // enregistré.
    const closedSets = serverState.sets.slice(0, -1);
    return (
      <View style={sty.screen}>
        {Header}
        <View style={sty.centerBox}>
          <Text style={sty.bigTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
            {session.status === 'finished' ? 'Match terminé' : 'Suivi abandonné'}
          </Text>
          {session.status === 'finished' && closedSets.length > 0 && (
            <View style={{ alignSelf: 'stretch' }}>
              <MatchStyleBoard
                t1Ids={session.team1_ids ?? []} t2Ids={session.team2_ids ?? []} names={names}
                sets={closedSets}
                leadRow={serverState.setsWon.t1 === serverState.setsWon.t2 ? null
                  : serverState.setsWon.t1 > serverState.setsWon.t2 ? 0 : 1}
              />
            </View>
          )}
          <Text style={sty.muted}>
            {session.status === 'finished'
              ? 'Score envoyé pour validation — les adversaires peuvent le valider ou le contester (validation automatique sous 24 h).'
              : 'Le suivi en direct a été interrompu — le score peut être saisi à la main.'}
          </Text>
          <TouchableOpacity onPress={() => router.back()} style={sty.ghostBtn} activeOpacity={0.8}>
            <Text style={sty.ghostBtnTxt}>Retour</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const canUndo = progressKey(state) > 0;
  const showEndCard = isScorer && (decided !== null || forceEnd) && ackSets !== setsPlayed;

  // Ligne surlignée dans la grille : leader aux sets, sinon leader du set en
  // cours, sinon personne (égalité parfaite).
  const leadRow: 0 | 1 | null =
    state.setsWon.t1 !== state.setsWon.t2
      ? (state.setsWon.t1 > state.setsWon.t2 ? 0 : 1)
      : currentSet.t1 !== currentSet.t2
      ? (currentSet.t1 > currentSet.t2 ? 0 : 1)
      : null;

  return (
    <View style={sty.screen}>
      {Header}
      <ScrollView contentContainerStyle={{ padding: Spacing.md, paddingBottom: insets.bottom + Spacing.xl, gap: Spacing.md }}>

        {/* 4. Scoreboard — carte blanche façon MatchCard (set courant = dernière colonne) */}
        <MatchStyleBoard
          t1Ids={session.team1_ids ?? []} t2Ids={session.team2_ids ?? []} names={names}
          sets={state.sets} leadRow={leadRow}
        >
          {scoringMode === 'points' && (() => {
            const cg = state.currentGame ?? { t1: 0, t2: 0 };
            const labels = gameScoreLabels(cg, goldenPoint, state.tieBreak ?? false);
            const goldenNow = goldenPoint && !state.tieBreak && cg.t1 >= 3 && cg.t2 >= 3;
            return (
              <View style={sty.gameRow}>
                <Text style={sty.gameRowLabel}>{state.tieBreak ? 'TIE-BREAK' : 'JEU EN COURS'}</Text>
                <Text style={sty.gamePoints} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
                  {labels.t1} – {labels.t2}
                </Text>
                {goldenNow && <Text style={sty.goldenTxt}>🔥 Point en or</Text>}
              </View>
            );
          })()}
        </MatchStyleBoard>

        {pending > 0 && (
          <Text style={sty.pendingTxt}>⏳ {pending} en attente de réseau</Text>
        )}

        {/* 7. Bandeau de contestation (scoreur) */}
        {isScorer && (session.contest_count ?? 0) > 0 && (
          <View style={sty.contestBanner}>
            <Text style={sty.contestTxt}>
              ⚠️ {session.contest_count} contestation{session.contest_count > 1 ? 's' : ''} — corrige avec ↩︎ ou maintiens ton score.
            </Text>
            <TouchableOpacity onPress={onResolveContest} style={sty.contestBtn} activeOpacity={0.8}>
              <Text style={sty.contestBtnTxt}>Marquer comme résolu</Text>
            </TouchableOpacity>
          </View>
        )}

        {isScorer && watchHasControl && (
          <View style={sty.contestBanner}>
            <Text style={sty.contestTxt}>⌚ C'est ta montre qui marque.</Text>
            <TouchableOpacity onPress={onClaimInput} style={sty.contestBtn} activeOpacity={0.8}>
              <Text style={sty.contestBtnTxt}>Reprendre la saisie ici</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 5. Saisie (scoreur) */}
        {isScorer ? (
          <>
            <TouchableOpacity onPress={() => onScoreTap(1)} disabled={watchHasControl}
              style={[sty.gameBtn, watchHasControl && { opacity: 0.4 }]} activeOpacity={0.85}>
              <Text style={sty.gameBtnTxt} numberOfLines={1}>
                🎾 {scoringMode === 'points' ? 'Point' : 'Jeu'} {label1}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onScoreTap(2)} disabled={watchHasControl}
              style={[sty.gameBtn, sty.gameBtnAlt, watchHasControl && { opacity: 0.4 }]} activeOpacity={0.85}>
              <Text style={[sty.gameBtnTxt, sty.gameBtnTxtAlt]} numberOfLines={1}>
                🎾 {scoringMode === 'points' ? 'Point' : 'Jeu'} {label2}
              </Text>
            </TouchableOpacity>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
              <TouchableOpacity onPress={onUndo} disabled={!canUndo}
                style={[sty.smallBtn, !canUndo && { opacity: 0.4 }]} activeOpacity={0.75}>
                <Text style={sty.smallBtnTxt}>↩︎ Annuler</Text>
              </TouchableOpacity>
              {(session.contest_count ?? 0) > 0 && (
                <View style={sty.warnDot}>
                  <Text style={sty.warnDotTxt}>⚠️ {session.contest_count}</Text>
                </View>
              )}
            </View>
          </>
        ) : (
          /* 6. Lecteur */
          <>
            <TouchableOpacity onPress={onContest} style={sty.smallBtn} activeOpacity={0.8}>
              <Text style={sty.smallBtnTxt}>⚠️ Contester ce score</Text>
            </TouchableOpacity>
            {(session.contest_count ?? 0) > 0 && (
              <TouchableOpacity onPress={onWithdrawContest} activeOpacity={0.7} style={{ alignSelf: 'center' }}>
                <Text style={sty.withdrawTxt}>Retirer ma contestation</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onTakeOver} style={sty.smallBtn} activeOpacity={0.8}>
              <Text style={sty.smallBtnTxt}>✋ Reprendre le score</Text>
            </TouchableOpacity>
          </>
        )}

        {/* 8. Fin de match */}
        {showEndCard && (
          <View style={sty.endCard}>
            <Text style={sty.endTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
              Victoire {winnerLabel}
            </Text>
            <Text style={sty.endScore}>{finalScore || '—'}</Text>
            {/* File non vide : le serveur n'a pas encore encaissé les derniers
                jeux — valider maintenant enregistrerait un score en retard. */}
            {pending > 0 && (
              <Text style={sty.pendingTxt}>⏳ {pending} en attente de réseau — validation possible une fois synchronisé</Text>
            )}
            <TouchableOpacity onPress={onFinalize} disabled={busy || pending > 0}
              style={[sty.primaryBtn, (busy || pending > 0) && { opacity: 0.6 }]} activeOpacity={0.85}>
              {busy
                ? <ActivityIndicator color={Colors.textOnDark} size="small" />
                : <Text style={sty.primaryBtnTxt}>Valider le score</Text>}
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
              <TouchableOpacity onPress={() => { setForceEnd(false); setAckSets(setsPlayed); }}
                style={[sty.smallBtn, { flex: 1 }]} activeOpacity={0.75}>
                <Text style={sty.smallBtnTxt}>Continuer un set</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onUndo} style={[sty.smallBtn, { flex: 1 }]} activeOpacity={0.75}>
                <Text style={sty.smallBtnTxt}>↩︎ Annuler</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const sty = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bgDark },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg, gap: Spacing.md },
  backBtn: {
    width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: Colors.borderDark,
  },
  livePill: {
    backgroundColor: 'rgba(239,68,68,0.16)', borderRadius: Radius.full,
    paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: Colors.danger,
  },
  livePillTxt: { fontSize: 10, fontWeight: '900', color: Colors.danger, fontFamily: Fonts.uiBlack, letterSpacing: 0.6 },
  bigTitle: {
    fontSize: FontSize.xxl, lineHeight: FontSize.xxl + 8, color: Colors.textOnDark,
    fontFamily: Fonts.welcome, letterSpacing: -0.5, paddingRight: 6, textAlign: 'center',
  },
  muted: { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center' },
  ghostBtn: {
    backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.borderDark, paddingHorizontal: Spacing.lg, paddingVertical: 12,
  },
  ghostBtnTxt: { fontSize: FontSize.sm, fontWeight: '900', color: Colors.textOnDark, fontFamily: Fonts.uiBlack },

  pendingTxt: { fontSize: FontSize.xs, color: Colors.brand, fontWeight: '700', textAlign: 'center' },
  // Rangée « jeu en cours » (mode points) — rendue DANS la carte blanche.
  gameRow: { alignItems: 'center', gap: 2, borderTopWidth: 1, borderTopColor: PM.divider, paddingTop: 10 },
  gameRowLabel: { fontSize: 9, fontWeight: '900', color: PM.muted, letterSpacing: 1.2, fontFamily: Fonts.uiBlack },
  gamePoints: { fontSize: 40, lineHeight: 46, color: PM.ink, fontFamily: Fonts.welcome, paddingRight: 6 },
  goldenTxt: { fontSize: FontSize.xs, fontWeight: '900', color: '#A16207', fontFamily: Fonts.uiBlack },
  withdrawTxt: { fontSize: FontSize.xs, color: Colors.textMuted, fontWeight: '700', textDecorationLine: 'underline' },

  contestBanner: {
    backgroundColor: 'rgba(255,193,26,0.14)', borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.brand, padding: Spacing.md, gap: Spacing.sm,
  },
  contestTxt: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.brand },
  contestBtn: {
    backgroundColor: Colors.brand, borderRadius: Radius.sm, paddingVertical: 10, alignItems: 'center',
  },
  contestBtnTxt: { fontSize: FontSize.xs, fontWeight: '900', color: Colors.textOnBrand, fontFamily: Fonts.uiBlack },

  gameBtn: {
    height: 96, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.brand, paddingHorizontal: Spacing.md,
  },
  gameBtnAlt: { backgroundColor: Colors.bgCard },
  gameBtnTxt: { fontSize: FontSize.md, fontWeight: '900', color: Colors.textOnBrand, fontFamily: Fonts.uiBlack },
  gameBtnTxtAlt: { color: Colors.textPrimary },

  smallBtn: {
    backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.borderDark, paddingVertical: 12, paddingHorizontal: Spacing.md, alignItems: 'center',
  },
  smallBtnTxt: { fontSize: FontSize.sm, fontWeight: '800', color: Colors.textOnDark, fontFamily: Fonts.uiExtraBold },
  warnDot: {
    backgroundColor: 'rgba(255,193,26,0.14)', borderRadius: Radius.full, borderWidth: 1,
    borderColor: Colors.brand, paddingHorizontal: 10, paddingVertical: 6,
  },
  warnDotTxt: { fontSize: FontSize.xs, fontWeight: '900', color: Colors.brand, fontFamily: Fonts.uiBlack },

  endCard: {
    backgroundColor: Colors.bgCard, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.sm,
  },
  endTitle: {
    fontSize: FontSize.xl, lineHeight: FontSize.xl + 6, color: Colors.textPrimary,
    fontFamily: Fonts.welcome, letterSpacing: -0.5, paddingRight: 6,
  },
  endScore: { fontSize: FontSize.lg, fontWeight: '900', color: Colors.textSecondary, fontFamily: Fonts.uiBlack },
  primaryBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center',
  },
  primaryBtnTxt: { fontSize: FontSize.sm, fontWeight: '900', color: Colors.textOnDark, fontFamily: Fonts.uiBlack },
});
