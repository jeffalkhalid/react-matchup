// app/tournaments/soiree/[id].tsx — l'écran pendant qu'on joue.
//
// Une rotation dure vingt minutes. Pour saisir un score il fallait ouvrir
// l'app, aller dans Tournois, ouvrir la fiche, faire défiler jusqu'à son
// match : quatre gestes, six fois dans la soirée, par trente-deux personnes.
// Ici on sort le téléphone et on est dessus.
//
// TROIS QUESTIONS, ET RIEN D'AUTRE : où je joue, contre qui, où en est le
// reste. Tout ce qui ne répond pas à l'une des trois appartient à la fiche du
// tournoi — le barème, le club, le prix, la liste des inscrits.
//
// CE N'EST PAS UN SCORE EN DIRECT. Le live point par point sert un match qu'on
// suit ; ici on joue vingt minutes et on reporte des jeux. On reprend du live
// l'EMPLACEMENT — une surface où l'on atterrit déjà au bon endroit — pas le
// mécanisme.
//
// L'ÉTAT DE TOUS LES TERRAINS EST VISIBLE PAR TOUS. Le tournoi se gère entre
// participants : sans organisateur, « le terrain 5 n'a rien rentré » doit
// s'afficher chez les trente-deux pour que quelqu'un aille leur dire un mot.
//
// La logique (qui bloque, quel est mon terrain, ce qu'on annonce) vit dans
// lib/tournamentEvening, avec ses tests. Ici, du rendu et des appels.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert,
  AppState,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../../hooks/usePlayer';
import { Colors, Fonts } from '../../../lib/theme';
import { Icon } from '../../../components/community/icons';
import {
  fetchTournament, fetchTournamentMatches, fetchTeams, fetchMatchEntries,
  fetchRegistrations, enterTournamentScore, validateTournamentScore,
  isFeatureDisabled, resultMessage, subscribeTournamentMatches, roundMinutesOf,
  startCourtMatch, resetCourtStart, forfeitTournamentTeam, sideLabel,
  type Tournament, type TournamentMatch, type TournamentTeam,
  type TournamentMatchEntry, type TournamentRegistration,
} from '../../../lib/tournaments';
import { displayName } from '../../../lib/players';
import { PlayerAvatar } from '../../../components/PlayerAvatar';
import {
  eveningCourts, myCourt, blockingLabel, needsHuman, courtsDone, roundLabel, inTeam,
  courtTone, bumpGames, courtRowLabel, courtProgress, endsAt,
  formatCountdown, shouldTickClock, shouldSyncAlarms,
  type CourtView, type CourtState, type CourtTone,
} from '../../../lib/tournamentEvening';
import { syncCourtAlarms, expoAlarmPort, type AlarmPort } from '../../../lib/courtAlarm';
import { loadAlarmMemory, persistAlarmMemory, purgeAlarmMemory } from '../../../lib/courtAlarmStorage';

/** La teinte d'un TON — la même partout sur l'écran.
 *
 *  `courtTone` (lib/tournamentEvening) dit le registre d'un état, cette table
 *  choisit la couleur : même convention que `statusTone` → `Pill`. La règle du
 *  rouge n'est donc pas écrite ici, elle vit dans `needsHuman` — les quatre
 *  états peints en rouge jusqu'ici (dont `en_cours`, soit l'essentiel de
 *  chaque quart d'heure) venaient précisément d'une table tenue à part. */
const TEINTE_TON: Record<CourtTone, string> = {
  neutral:     Colors.textMuted,
  live:        Colors.brand,
  provisional: Colors.brandDeep,
  alert:       Colors.danger,
  done:        Colors.success,
};

const teinte = (state: CourtState) => TEINTE_TON[courtTone(state)];


export default function SoireeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { player } = usePlayer();

  const [t, setT] = useState<Tournament | null>(null);
  const [matches, setMatches] = useState<TournamentMatch[]>([]);
  const [teams, setTeams] = useState<TournamentTeam[]>([]);
  const [entries, setEntries] = useState<TournamentMatchEntry[]>([]);
  const [regs, setRegs] = useState<TournamentRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyClock, setBusyClock] = useState(false);
  const [busyForfeit, setBusyForfeit] = useState(false);
  const [a, setA] = useState('');
  const [b, setB] = useState('');

  // L'heure affichée par le compte à rebours — rafraîchie chaque seconde,
  // mais seulement pendant qu'un terrain décompte réellement (cf. l'effet plus
  // bas, qui s'appuie sur `shouldTickClock`). Jamais un compteur qui avance
  // tout seul : `eveningCourts` en refait le calcul à chaque tic, à partir de
  // `started_at`, l'heure SERVEUR.
  const [maintenant, setMaintenant] = useState(() => Date.now());

  // La mémoire des sonneries posées sur CE téléphone, et la porte vers
  // expo-notifications — chargées UNE fois au montage. La mémoire est
  // PERSISTÉE (lib/courtAlarmStorage, une clé par match) : un `useRef` seul
  // survit à un changement d'écran mais pas à l'app tuée par l'OS entre le
  // départ du chrono et la sonnerie, alors que les notifications déjà posées
  // survivent, elles. Sans cette relecture au montage, revenir sur l'écran
  // après un tue-et-relance poserait une DEUXIÈME paire de sonneries par-dessus
  // la première déjà en attente.
  const memoireAlarmes = useRef<Map<string, string[]>>(new Map());
  const porteAlarmes = useRef<AlarmPort | null>(null);
  const [alarmesPretes, setAlarmesPretes] = useState(false);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const [memoire, porte] = await Promise.all([loadAlarmMemory(), expoAlarmPort()]);
        if (annule) return;
        memoireAlarmes.current = memoire;
        porteAlarmes.current = porte;
      } catch {
        // Porte indisponible (permissions refusées, environnement sans
        // notifications) : le compte à rebours affiché continue de marcher,
        // aucune sonnerie ne se pose — la même dégradation que dans
        // lib/courtAlarm.ts.
      } finally {
        if (!annule) setAlarmesPretes(true);
      }
    })();
    return () => { annule = true; };
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [tt, ms, tm, rs] = await Promise.all([
        fetchTournament(id), fetchTournamentMatches(id), fetchTeams(id), fetchRegistrations(id),
      ]);
      setT(tt); setMatches(ms); setTeams(tm); setRegs(rs);
      // Les saisies de la rotation EN COURS seulement : c'est tout ce dont
      // l'écran a besoin, et ça évite de rapatrier six tours de saisies à
      // chaque rafraîchissement.
      const duTour = ms.filter(m => m.round_no === (tt?.current_round ?? 0)).map(m => m.id);
      setEntries(await fetchMatchEntries(duTour));
    } catch {
      // Une panne de lecture ne doit pas laisser un écran à moitié peint : on
      // garde ce qu'on avait, l'utilisateur retire vers le bas.
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Recharge a l'arrivee, puis SUIT les matchs du tournoi tant que l'ecran
  // est affiche. Depuis tournament_auto_advance.sql la rotation suivante part
  // toute seule quand le dernier terrain saisit : sans cet abonnement, on
  // restait sur l'ancienne rotation — et on allait jouer sur le mauvais
  // terrain. Actif seulement quand l'ecran a le focus : pas d'ecoute en
  // arriere-plan pour un ecran que personne ne regarde.
  // DEUX RATTRAPAGES, parce que le temps réel ne rejoue PAS ce qu'on a manqué.
  //
  //  * `SUBSCRIBED` : le canal s'ouvre, et se ROUVRE après chaque coupure.
  //    Deux minutes de réseau mort au club et les changements survenus
  //    pendant la coupure sont perdus pour toujours — l'écran resterait sur
  //    la rotation précédente, et quatre joueurs iraient sur le mauvais
  //    terrain.
  //  * `AppState` qui revient à `'active'` : téléphone dans la poche pendant
  //    que l'adversaire saisit le score. Sans cette relecture, les sonneries
  //    de CE match ne sont jamais annulées (l'effet plus bas ne tourne que
  //    sur des données fraîches) et elles sonnent pendant la rotation
  //    suivante — la « sonnerie qui ne s'annule pas », que la conception
  //    nomme comme pire que pas de sonnerie du tout (§15).
  //
  // Ni l'un ni l'autre ne tourne à la seconde : `load()` part sur un
  // ÉVÉNEMENT (ouverture du canal, retour au premier plan), jamais sur un
  // minuteur.
  useFocusEffect(useCallback(() => {
    load();
    if (!id) return undefined;
    const stop = subscribeTournamentMatches(id, () => { load(); }, () => { load(); });
    const abonnement = AppState.addEventListener('change', etat => {
      if (etat === 'active') load();
    });
    return () => { stop(); abonnement.remove(); };
  }, [load, id]));

  // `courts` et `mien` doivent exister AVANT tout retour anticipé : les deux
  // effets qui suivent en dépendent, et les règles des Hooks interdisent de
  // les appeler après un `if (...) return`. `roundMinutes` à 0 tant que `t`
  // n'est pas chargé n'a pas d'effet observable : `eveningCourts` rend alors
  // un tableau vide (aucun match), faute de tournoi ou de joueur.
  const roundMinutes = t ? roundMinutesOf(t) : 0;
  const courts = (t && player)
    ? eveningCourts(matches, teams, entries, player.id, t.current_round, roundMinutes, maintenant)
    : [];
  const mien = myCourt(courts);

  // Le chrono à l'écran ne tourne QUE pendant qu'un terrain décompte
  // réellement (shouldTickClock) : un écran qui ne montre que des terrains à
  // démarrer, acquis, forfait ou exempt n'a aucune raison de se redessiner
  // chaque seconde.
  useEffect(() => {
    if (!shouldTickClock(courts)) return undefined;
    const minuteur = setInterval(() => setMaintenant(Date.now()), 1000);
    return () => clearInterval(minuteur);
    // shouldTickClock(courts) est un booléen primitif : l'effet ne se
    // redéclenche que lorsqu'il change de valeur, jamais à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldTickClock(courts)]);

  // Les sonneries de MON terrain, mises à l'heure du serveur — au changement
  // de match ou d'état, JAMAIS à chaque tic du chrono : la mémoire empêche déjà
  // les doublons, un appel par seconde ne ferait que noyer le journal et
  // multiplier les écritures de stockage pour rien.
  //
  // `shouldSyncAlarms` (et non un simple `alarmesPretes`) : au montage, la
  // mémoire/porte des alarmes se charge vite (stockage local) alors que les
  // données du tournoi arrivent par le réseau. Tant qu'elles ne sont pas là,
  // `mien` est `null` — la même forme que « je ne joue pas » — et agir
  // dessus annulerait puis effacerait du stockage la paire de sonneries
  // qu'on vient tout juste de restaurer. Voir le commentaire de
  // `shouldSyncAlarms` dans lib/tournamentEvening.ts.
  const alarmesActionnables = shouldSyncAlarms({
    alarmesPretes, loading, hasTournament: t != null, hasPlayer: player != null,
  });
  useEffect(() => {
    if (!alarmesActionnables || !porteAlarmes.current) return;
    const etat = {
      matchId: mien?.matchId ?? null,
      courtNo: mien?.courtNo ?? 0,
      secondsLeft: mien?.secondsLeft ?? null,
      hasScore: mien?.gamesA != null,
    };
    const avant = [...memoireAlarmes.current.keys()];
    (async () => {
      await syncCourtAlarms(etat, porteAlarmes.current!, memoireAlarmes.current);
      // Écrit les changements (pose ou annulation) avant de purger, sinon une
      // annulation qui vient d'avoir lieu en mémoire ne serait jamais reportée
      // dans le stockage.
      await persistAlarmMemory(avant, memoireAlarmes.current);
      await purgeAlarmMemory(etat.matchId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alarmesActionnables, mien?.matchId, mien?.secondsLeft === null, mien?.gamesA]);

  if (loading || !player) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.heroBg, justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.brand} />
      </View>
    );
  }
  if (!t) return null;

  // LA SOIRÉE EST FINIE (spec §9). La dernière saisie clôture le tournoi dans
  // sa propre transaction : sans cette branche, seize téléphones continuaient
  // d'afficher la dernière rotation comme si elle tournait, et « Nous
  // abandonnons » restait cliquable — le serveur répondait `tournament_not_live`
  // et le joueur lisait un message générique. Plus de chrono, plus de saisie,
  // plus d'abandon : le classement est figé, et il se lit sur la fiche.
  if (t.status === 'TERMINE' || t.status === 'CLASSEMENT_VALIDE') {
    const valide = t.status === 'CLASSEMENT_VALIDE';
    return (
      <View style={{ flex: 1, backgroundColor: Colors.heroBg }}>
        <ScrollView contentContainerStyle={{
          paddingTop: insets.top + 10, paddingHorizontal: 18,
          paddingBottom: insets.bottom + 24, gap: 16,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
              <Icon name="chevronLeft" size={22} color={Colors.textOnDark} />
            </TouchableOpacity>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>
                {t.name}
              </Text>
              <Text style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: Colors.brand }}>
                Soirée terminée
              </Text>
            </View>
          </View>

          <View style={{ backgroundColor: Colors.bgCard, borderRadius: 22, padding: 20, gap: 8 }}>
            <Text style={{ fontSize: 17, fontFamily: Fonts.uiExtraBold, color: Colors.textPrimary, textAlign: 'center' }}>
              C’est fini pour ce soir
            </Text>
            <Text style={{ fontSize: 12.5, fontFamily: Fonts.ui, color: Colors.textMuted, textAlign: 'center', lineHeight: 18 }}>
              {valide
                ? 'Le classement est validé : les points sont crédités.'
                : 'Le classement est figé, en attente de validation par l’organisateur.'}
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => router.push(`/tournaments/${t.id}` as any)}
            activeOpacity={0.85}
            style={{
              backgroundColor: Colors.primary, borderRadius: 14,
              paddingVertical: 14, alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>
              VOIR LE CLASSEMENT
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // CE QUI RÉCLAME QUELQU'UN, et ce qui se déroule normalement — deux phrases,
  // deux couleurs. `blocks()` reste le prédicat d'AVANCEMENT (le serveur ne
  // peut pas tirer la rotation suivante) ; il est vrai dès qu'une rotation est
  // tirée, donc peindre l'écran en rouge dessus revenait à crier pendant la
  // quasi-totalité de chaque quart d'heure, sur seize téléphones. `needsHuman`
  // ne retient que les deux états qui appellent réellement quelqu'un.
  const alarme = blockingLabel(courts.filter(c => needsHuman(c.state)));
  const enCours = blockingLabel(courts.filter(c => !needsHuman(c.state)));
  const avancement = courtsDone(courts);

  const nomDe = (pid: string) => {
    const r = regs.find(x => x.player_id === pid);
    return displayName(r?.player ?? null, 'player').split(' ')[0];
  };

  const nomsDe = (teamId: string | null): string => {
    const eq = teams.find(x => x.id === teamId);
    if (!eq) return '—';
    return `${nomDe(eq.player1_id)} & ${nomDe(eq.player2_id)}`;
  };

  /** Les deux joueurs d'un binôme, avec de quoi les dessiner. Un binôme se
   *  montre en VISAGES — deux ronds côte à côte — pas en ligne de texte :
   *  c'est le motif de `FeaturedClash`, et on reconnaît un partenaire de
   *  jeudi soir à sa tête avant de lire son prénom. */
  const membresDe = (teamId: string | null) => {
    const eq = teams.find(x => x.id === teamId);
    if (!eq) return [];
    return [eq.player1_id, eq.player2_id].map(pid => {
      const r = regs.find(x => x.player_id === pid);
      return {
        id: pid,
        nom: nomDe(pid),
        avatarPath: (r?.player as any)?.avatar_path ?? null,
        side: r?.side ?? null,
      };
    });
  };

  const matchMien = mien ? matches.find(m => m.id === mien.matchId) ?? null : null;
  // Le binôme auquel J'APPARTIENS sur ce match — pas « team_a » : côté A ou
  // côté B selon le tirage, `forfeitTournamentTeam` veut l'id du binôme, pas
  // un côté.
  const monEquipe = matchMien
    ? teams.find(tm => (tm.id === matchMien.team_a || tm.id === matchMien.team_b)
        && inTeam(tm, player.id)) ?? null
    : null;

  // L'autre camp de MON match — `null` sur un bye, où il n'y a personne en
  // face et où afficher « contre — » serait un mensonge poli.
  const equipeAdverse = matchMien && monEquipe
    ? (matchMien.team_a === monEquipe.id ? matchMien.team_b : matchMien.team_a)
    : null;
  const monBinome = monEquipe ? membresDe(monEquipe.id) : [];
  const finDuChrono = endsAt(matchMien?.started_at ?? null, roundMinutes);

  const envoyer = async () => {
    if (!matchMien) return;
    const gA = a.trim() === '' ? null : Number(a);
    const gB = b.trim() === '' ? null : Number(b);
    const refus = validateTournamentScore(gA, gB);
    if (refus) { Alert.alert('Score', refus); return; }
    setBusy(true);
    try {
      const res = await enterTournamentScore(matchMien.id, gA!, gB!);
      if (isFeatureDisabled(res)) { router.back(); return; }
      if (!res.ok) { Alert.alert('Impossible', resultMessage(res)); return; }
      setA(''); setB('');
      await load();
      // Les trois états ne disent PAS la même chose, et le plus important est
      // « recorded » : le score compte déjà. Sans ce mot, on croit qu'on
      // bloque les autres et on relance son adversaire pour rien.
      if (res.state === 'confirmed') {
        Alert.alert('Score acquis', 'Vous dites la même chose tous les deux.');
      } else if (res.state === 'disputed') {
        Alert.alert(
          'Vos scores diffèrent',
          'Mettez-vous d’accord avant la rotation suivante : c’est ce score qui décide qui monte et qui descend.',
        );
      } else {
        Alert.alert('Score envoyé', 'Il compte déjà. Vos adversaires peuvent le confirmer ou le corriger.');
      }
    } finally {
      setBusy(false);
    }
  };

  // « ON COMMENCE » — n'importe lequel des quatre joueurs. Deux appuis dans la
  // même seconde rendent tous les deux `ok:true` (le second reçoit l'heure du
  // premier, jamais un refus) : rien de spécial à gérer ici.
  const commencer = async () => {
    if (!matchMien) return;
    setBusyClock(true);
    try {
      const res = await startCourtMatch(matchMien.id);
      if (!res.ok) { Alert.alert('Impossible', resultMessage(res)); return; }
      await load();
    } finally {
      setBusyClock(false);
    }
  };

  // « Remettre le chrono à zéro » — le serveur refuse dès qu'un score existe
  // (`already_scored`) : on montre CE refus tel quel plutôt que de cacher le
  // lien, pour que le joueur comprenne pourquoi ça ne marche plus.
  const remettreAZero = async () => {
    if (!matchMien) return;
    setBusyClock(true);
    try {
      const res = await resetCourtStart(matchMien.id);
      if (!res.ok) { Alert.alert('Impossible', resultMessage(res)); return; }
      await load();
    } finally {
      setBusyClock(false);
    }
  };

  // « Nous abandonnons » — IRRÉVERSIBLE : la confirmation dit exactement ce
  // qui se passe, comme le forfait déclaré par l'organisateur (admin.tsx).
  // Un seul des deux membres du binôme suffit désormais.
  const abandonner = () => {
    if (!matchMien || !monEquipe) return;
    Alert.alert(
      'Nous abandonnons ?',
      'C’est définitif : votre adversaire remporte le match en cours, et la soirée continue sans vous.',
      [
        { text: 'Continuer à jouer', style: 'cancel' },
        {
          text: 'Nous abandonnons',
          style: 'destructive',
          onPress: async () => {
            setBusyForfeit(true);
            try {
              const res = await forfeitTournamentTeam(t.id, monEquipe.id);
              if (!res.ok) { Alert.alert('Impossible', resultMessage(res)); return; }
              await load();
            } finally {
              setBusyForfeit(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.heroBg }}>
      <ScrollView contentContainerStyle={{
        paddingTop: insets.top + 10, paddingHorizontal: 18,
        paddingBottom: insets.bottom + 24, gap: 16,
      }}>
        {/* En-tête : le strict nécessaire, et la sortie vers la fiche. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
            <Icon name="chevronLeft" size={22} color={Colors.textOnDark} />
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>
              {t.name}
            </Text>
            <Text style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: Colors.brand }}>
              {roundLabel(t.current_round, t.round_count)}
            </Text>
          </View>
        </View>

        {/* MON TERRAIN — le cœur de l'écran, en grand. */}
        {mien && matchMien ? (
          <View style={{
            backgroundColor: Colors.bgCard, borderRadius: 22, padding: 18, gap: 14,
          }}>
            <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, letterSpacing: 1.2, color: Colors.textMuted }}>
              TON TERRAIN
            </Text>

            {/* Le numéro, la rotation, et OÙ ce terrain se situe dans
                l'échelle — les trois d'un seul regard. Le numéro seul, centré,
                ne disait pas si on était en haut ou en bas de la montante. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Text style={{ fontSize: 64, fontFamily: Fonts.display, color: Colors.textPrimary, lineHeight: 66 }}>
                {mien.courtNo}
              </Text>
              <View style={{ flex: 1, minWidth: 0, gap: 4, alignItems: 'flex-start' }}>
                <View style={{
                  backgroundColor: Colors.brand, borderRadius: 999,
                  paddingHorizontal: 10, paddingVertical: 4,
                }}>
                  <Text style={{ fontSize: 10.5, fontFamily: Fonts.uiBlack, letterSpacing: 0.6, color: Colors.primary }}>
                    ROTATION {t.current_round}
                  </Text>
                </View>
                <Text style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>
                  sur {courts.length} terrain{courts.length > 1 ? 's' : ''}
                </Text>
              </View>
              <MiniEchelle courts={courts} />
            </View>

            {/* Contre qui — la deuxième des trois questions de cet écran, et
                celle qui n'était nulle part. */}
            {monEquipe && (
              <View style={{ gap: 8 }}>
                <BinomeLigne
                  membres={monBinome}
                  titre={`Toi & ${monBinome.find(m => m.id !== player.id)?.nom ?? '—'}`}
                  appoint={monBinome.map(m => sideLabel(m.side).toLowerCase()).join(' · ')}
                />
                {equipeAdverse && (
                  <BinomeLigne
                    membres={membresDe(equipeAdverse)}
                    titre={`contre ${nomsDe(equipeAdverse)}`}
                    sobre
                  />
                )}
              </View>
            )}

            {/* Le chrono de CE terrain — un geste différent pour chacun des
                trois temps sans score : lancer, patienter, ou aller chercher
                un score qui ne vient pas. */}
            {mien.state === 'a_demarrer' && (
              <View style={{ gap: 8, alignItems: 'center' }}>
                <TouchableOpacity
                  onPress={commencer}
                  disabled={busyClock}
                  activeOpacity={0.85}
                  style={{
                    backgroundColor: Colors.primary, borderRadius: 14,
                    paddingVertical: 14, paddingHorizontal: 32, opacity: busyClock ? 0.6 : 1,
                  }}
                >
                  {busyClock
                    ? <ActivityIndicator color={Colors.textOnDark} />
                    : (
                      <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>
                        ON COMMENCE
                      </Text>
                    )}
                </TouchableOpacity>
                <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: Colors.textMuted, textAlign: 'center', lineHeight: 17 }}>
                  Le chrono part pour {roundMinutes} minutes, pour les quatre joueurs.
                </Text>
              </View>
            )}

            {mien.state === 'en_cours' && mien.secondsLeft != null && (
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                  <Text style={{ flex: 1, fontSize: 10.5, fontFamily: Fonts.uiBlack, letterSpacing: 1.1, color: Colors.textMuted }}>
                    CHRONO DU TERRAIN
                  </Text>
                  {finDuChrono && (
                    <Text style={{ fontSize: 10.5, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>
                      fin vers {finDuChrono.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  )}
                </View>

                <Text style={{
                  fontSize: 58, fontFamily: Fonts.display, color: Colors.textPrimary,
                  textAlign: 'center', lineHeight: 62,
                }}>
                  {formatCountdown(mien.secondsLeft)}
                </Text>

                {/* La barre double le chiffre : le chiffre se lit, la barre se
                    voit de plus loin — et c'est de plus loin qu'on jette un
                    œil au téléphone posé sur le banc. */}
                <View style={{ height: 6, borderRadius: 999, backgroundColor: Colors.borderLight, overflow: 'hidden' }}>
                  <View style={{
                    height: 6, borderRadius: 999,
                    width: `${Math.round(courtProgress(mien.secondsLeft, roundMinutes) * 100)}%`,
                    backgroundColor: Colors.brand,
                  }} />
                </View>

                <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: Colors.textMuted, textAlign: 'center', lineHeight: 17 }}>
                  Ton téléphone sonne à zéro, même app fermée. Joue.
                </Text>

                <TouchableOpacity onPress={remettreAZero} disabled={busyClock} hitSlop={8} style={{ alignSelf: 'center' }}>
                  <Text style={{
                    fontSize: 11.5, fontFamily: Fonts.uiBold, color: Colors.textMuted,
                    textDecorationLine: 'underline', opacity: busyClock ? 0.5 : 1,
                  }}>
                    Remettre le chrono à zéro
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {mien.state === 'temps_ecoule' && (
              <View style={{
                backgroundColor: Colors.danger + '18', borderRadius: 14,
                paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center', gap: 2,
              }}>
                <Text style={{ fontSize: 16, fontFamily: Fonts.uiBlack, color: Colors.danger, textAlign: 'center' }}>
                  TEMPS ÉCOULÉ
                </Text>
                <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: Colors.textMuted, textAlign: 'center' }}>
                  Entrez le score ci-dessous — la rotation suivante attend.
                </Text>
              </View>
            )}

            <View style={{ gap: 6 }}>
              <Text numberOfLines={1} style={{ fontSize: 15, fontFamily: Fonts.uiExtraBold, color: Colors.textPrimary, textAlign: 'center' }}>
                {nomsDe(matchMien.team_a)}
              </Text>
              <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, color: Colors.textMuted, textAlign: 'center' }}>
                VS
              </Text>
              <Text numberOfLines={1} style={{ fontSize: 15, fontFamily: Fonts.uiExtraBold, color: Colors.textPrimary, textAlign: 'center' }}>
                {nomsDe(matchMien.team_b)}
              </Text>
            </View>

            {/* Le score effectif, quand il y en a un — avec son état en clair. */}
            {mien.gamesA != null && (
              <View style={{
                backgroundColor: teinte(mien.state) + '18', borderRadius: 14,
                paddingVertical: 10, paddingHorizontal: 12, gap: 3,
              }}>
                <Text style={{ fontSize: 18, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, textAlign: 'center' }}>
                  {mien.gamesA} – {mien.gamesB}
                </Text>
                <Text style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: teinte(mien.state), textAlign: 'center' }}>
                  {mien.state === 'acquis' ? 'Acquis : vous dites la même chose'
                    : mien.state === 'litige' ? 'Vos scores diffèrent — mettez-vous d’accord'
                    : 'Ce score compte déjà. L’autre camp peut le confirmer ou le corriger.'}
                </Text>
              </View>
            )}

            {/* La saisie — deux champs, un bouton. Rien d'autre. */}
            {mien.state !== 'acquis' && mien.state !== 'forfait' && (
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Case value={a} onChange={setA} />
                  <Text style={{ fontSize: 18, fontFamily: Fonts.uiBlack, color: Colors.textMuted }}>–</Text>
                  <Case value={b} onChange={setB} />
                </View>
                <TouchableOpacity
                  onPress={envoyer}
                  disabled={busy}
                  activeOpacity={0.85}
                  style={{
                    backgroundColor: Colors.primary, borderRadius: 14,
                    paddingVertical: 14, alignItems: 'center', opacity: busy ? 0.6 : 1,
                  }}
                >
                  {busy
                    ? <ActivityIndicator color={Colors.textOnDark} />
                    : (
                      <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>
                        {mien.gamesA == null ? 'RENTRER LE SCORE' : 'CORRIGER LE SCORE'}
                      </Text>
                    )}
                </TouchableOpacity>
              </View>
            )}

            {/* « Nous abandonnons » — irréversible, à ne montrer que si l'on n'a
                pas déjà quitté ce tournoi.
                Le garde portait sur `mien.state !== 'forfait'`, qui est l'état
                du TERRAIN : quand le binôme d'en face abandonnait, le match
                passait en `forfait` et c'est MOI qui perdais mon bouton
                d'abandon, alors que je joue toujours. Il porte désormais sur
                MON binôme (`tournament_teams.withdrawn`), la seule donnée qui
                dise si NOUS sommes partis. */}
            {monEquipe && !monEquipe.withdrawn && (
              <TouchableOpacity
                onPress={abandonner}
                disabled={busyForfeit}
                hitSlop={8}
                style={{ alignItems: 'center', paddingTop: 2, opacity: busyForfeit ? 0.5 : 1 }}
              >
                <Text style={{ fontSize: 12, fontFamily: Fonts.uiBold, color: Colors.danger }}>
                  Nous abandonnons
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={{ backgroundColor: Colors.bgCard, borderRadius: 22, padding: 20, gap: 6 }}>
            <Text style={{ fontSize: 15, fontFamily: Fonts.uiExtraBold, color: Colors.textPrimary, textAlign: 'center' }}>
              Tu ne joues pas cette rotation
            </Text>
            <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: Colors.textMuted, textAlign: 'center', lineHeight: 17 }}>
              Repose-toi. Tu reviens à la suivante.
            </Text>
          </View>
        )}

        {/* L'ÉCHELLE — une ligne par terrain, T1 en haut. C'est ce qu'on lit
            debout, entre deux points, pour une seule question : est-ce que la
            soirée attend quelqu'un ? Les pastilles T1..T4 qui tenaient cette
            place disaient le numéro et un symbole, jamais QUI joue ni OÙ on en
            est — il fallait ouvrir la fiche du tournoi pour le savoir. */}
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
            <Text style={{ flex: 1, fontSize: 11, fontFamily: Fonts.uiBlack, letterSpacing: 1.2, color: Colors.textOnDark }}>
              L’ÉCHELLE · ROTATION {t.current_round}
            </Text>
            <Text style={{ fontSize: 10.5, fontFamily: Fonts.uiBold, color: 'rgba(255,255,255,0.55)' }}>
              {avancement.done}/{avancement.total} terrains ont un score
            </Text>
          </View>

          <View style={{ gap: 8 }}>
            {courts.map(c => {
              const m = matches.find(x => x.id === c.matchId) ?? null;
              return (
                <LigneEchelle
                  key={c.matchId}
                  court={c}
                  titre={m
                    ? (m.team_b ? `${nomsDe(m.team_a)} · ${nomsDe(m.team_b)}` : nomsDe(m.team_a))
                    : '—'}
                  sousTitre={c.mine ? 'ton terrain' : c.courtNo === 1 ? 'le plus fort' : `Terrain ${c.courtNo}`}
                  avance={courtProgress(c.secondsLeft, roundMinutes)}
                />
              );
            })}
          </View>

          {/* Ce qui réclame quelqu'un, en rouge — pour qu'on aille leur parler. */}
          {alarme && (
            <View style={{ backgroundColor: 'rgba(239,68,68,0.16)', borderRadius: 12, padding: 10 }}>
              <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: '#FCA5A5', lineHeight: 16 }}>
                {alarme}
              </Text>
            </View>
          )}

          {/* Ce qui se déroule normalement : l'information, sans l'alarme. */}
          {enCours && (
            <Text style={{ fontSize: 11.5, fontFamily: Fonts.ui, color: 'rgba(255,255,255,0.5)', lineHeight: 16 }}>
              {enCours}
            </Text>
          )}
        </View>

        <TouchableOpacity onPress={() => router.push(`/tournaments/${t.id}` as any)} style={{ alignItems: 'center', padding: 8 }}>
          <Text style={{ fontSize: 12, fontFamily: Fonts.uiBold, color: 'rgba(255,255,255,0.5)' }}>
            Voir la fiche du tournoi
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

/** L'échelle en miniature, dans la carte : où mon terrain se situe entre le
 *  plus fort (en haut) et le plus faible. Quatre pastilles suffisent — on ne
 *  vient pas y lire un état, seulement une position. */
function MiniEchelle({ courts }: { courts: CourtView[] }) {
  return (
    <View style={{ gap: 3 }}>
      {courts.map(c => (
        <View key={c.matchId} style={{
          paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, alignItems: 'center',
          backgroundColor: c.mine ? Colors.brand : Colors.bgCardAlt,
        }}>
          <Text style={{
            fontSize: 9.5, fontFamily: Fonts.uiBlack,
            color: c.mine ? Colors.primary : Colors.textMuted,
          }}>
            T{c.courtNo}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Un binôme : deux visages côte à côte, le nom, et de quoi savoir qui joue
 *  de quel côté. Les ronds se chevauchent légèrement — ils forment une paire,
 *  pas deux joueurs alignés. */
function BinomeLigne({ membres, titre, appoint, sobre }: {
  membres: { id: string; nom: string; avatarPath: string | null }[];
  titre: string;
  appoint?: string | null;
  /** Le camp d'en face : présent, mais il ne doit pas voler le regard. */
  sobre?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ flexDirection: 'row' }}>
        {membres.map((m, i) => (
          <PlayerAvatar
            key={m.id}
            name={m.nom}
            path={m.avatarPath}
            size={26}
            backgroundColor={sobre ? Colors.bgCardAlt : Colors.brand}
            textColor={sobre ? Colors.textSecondary : Colors.primary}
            fontFamily={Fonts.uiBlack}
            fontSize={10}
            initialsMax={1}
            style={i > 0 ? { marginLeft: -8 } : undefined}
          />
        ))}
      </View>
      <Text numberOfLines={1} style={{
        flex: 1, minWidth: 0, fontSize: 13.5, fontFamily: Fonts.uiBlack,
        color: sobre ? Colors.textSecondary : Colors.textPrimary,
      }}>
        {titre}
      </Text>
      {appoint ? (
        <Text style={{ fontSize: 10.5, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>
          {appoint}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Une ligne de l'échelle : un terrain, qui s'y joue, et ce qu'on y attend.
 *
 * La mienne est jaune pleine — c'est le seul repère qu'on doit trouver en une
 * seconde, et le contraste inversé le donne sans avoir à lire.
 */
function LigneEchelle({ court, titre, sousTitre, avance }: {
  court: CourtView; titre: string; sousTitre: string; avance: number;
}) {
  const mien = court.mine;
  const ton = courtTone(court.state);
  // Sur une ligne sombre, la couleur est le signal « il y a un résultat » :
  // jaune un score saisi, vert un score acquis, rouge ce qui réclame
  // quelqu'un. Un terrain qui joue ou qui va démarrer n'a rien à signaler —
  // il reste blanc, et sa barre dit déjà qu'il tourne.
  const couleurEtat = mien
    ? Colors.primary
    : (ton === 'neutral' || ton === 'live' ? 'rgba(255,255,255,0.78)' : TEINTE_TON[ton]);

  return (
    <View style={{
      borderRadius: 14, overflow: 'hidden',
      backgroundColor: mien ? Colors.brand : 'rgba(255,255,255,0.06)',
    }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingVertical: 11, paddingHorizontal: 12,
      }}>
        <Text style={{
          width: 24, textAlign: 'center', fontSize: 20, fontFamily: Fonts.display,
          color: mien ? Colors.primary : Colors.textOnDark,
        }}>
          {court.courtNo}
        </Text>

        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Text numberOfLines={1} style={{
            fontSize: 12.5, fontFamily: Fonts.uiBlack,
            color: mien ? Colors.primary : Colors.textOnDark,
          }}>
            {titre}
          </Text>
          <Text numberOfLines={1} style={{
            fontSize: 10, fontFamily: Fonts.uiBold,
            color: mien ? 'rgba(10,10,10,0.55)' : 'rgba(255,255,255,0.45)',
          }}>
            {sousTitre}
          </Text>
        </View>

        <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, color: couleurEtat }}>
          {courtRowLabel(court)}
        </Text>
      </View>

      {/* La barre n'existe QUE pendant le jeu : ailleurs elle figerait un
          temps qui ne court plus, et on la lirait comme un chrono. */}
      {court.state === 'en_cours' && (
        <View style={{ height: 3, backgroundColor: mien ? 'rgba(10,10,10,0.15)' : 'rgba(255,255,255,0.10)' }}>
          <View style={{
            height: 3, width: `${Math.round(avance * 100)}%`,
            backgroundColor: mien ? Colors.primary : Colors.brand,
          }} />
        </View>
      )}
    </View>
  );
}

/** Un pas de compteur : large comme un pouce, et pas seulement au toucher —
 *  la cible dessinée fait 44 px, celle qui répond au doigt un peu plus. */
function Pas({ signe, onPress }: { signe: '−' | '+'; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
      accessibilityRole="button"
      accessibilityLabel={signe === '+' ? 'Un jeu de plus' : 'Un jeu de moins'}
      style={{ width: 44, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={{ fontSize: 22, fontFamily: Fonts.uiBlack, color: Colors.textSecondary }}>
        {signe}
      </Text>
    </TouchableOpacity>
  );
}

/**
 * Une case de score : deux boutons et un chiffre, faits pour un pouce mouillé.
 *
 * C'était un champ à clavier numérique. Debout entre deux points, on rate une
 * touche de clavier — et le clavier recouvre la moitié de l'écran au moment
 * précis où l'on veut relire l'adversaire et le terrain. Deux boutons ne se
 * ratent pas et ne cachent rien. Le pas lui-même est dans `bumpGames`, avec
 * ses bornes, parce que c'est une règle et que ça se teste.
 */
function Case({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const vide = value === '';
  return (
    <View style={{
      flex: 1, flexDirection: 'row', alignItems: 'center',
      backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border,
      borderRadius: 14, overflow: 'hidden',
    }}>
      <Pas signe="−" onPress={() => onChange(bumpGames(value, -1))} />
      <Text style={{
        flex: 1, textAlign: 'center',
        fontSize: 26, fontFamily: Fonts.uiBlack,
        color: vide ? Colors.textMuted : Colors.textPrimary,
      }}>
        {vide ? '—' : value}
      </Text>
      <Pas signe="+" onPress={() => onChange(bumpGames(value, 1))} />
    </View>
  );
}
