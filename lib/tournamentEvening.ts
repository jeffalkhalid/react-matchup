// lib/tournamentEvening.ts — ce qu'on voit pendant qu'on joue.
//
// Une montante se joue en rotations de vingt minutes. Pour saisir un score il
// fallait ouvrir l'app, aller dans Tournois, ouvrir la fiche, faire défiler
// jusqu'à son match : quatre gestes, six fois dans la soirée, par trente-deux
// personnes. L'écran de soirée répond à trois questions et rien d'autre — où
// je joue, contre qui, et où en est le reste.
//
// CE N'EST PAS UN SCORE EN DIRECT. Le live point par point sert un match qu'on
// suit ; ici on joue vingt minutes et on reporte des jeux. Compter les points
// serait PLUS de travail, pas moins. Ce qu'on reprend du live, c'est
// l'emplacement — une surface où l'on atterrit déjà au bon endroit — pas le
// mécanisme.
//
// TOUT LE MONDE VOIT L'ÉTAT DE TOUS LES TERRAINS, et c'est le point. Le
// tournoi se gère entre participants : sans organisateur, « le terrain 5 n'a
// rien rentré » doit s'afficher chez les trente-deux, pour que quelqu'un aille
// leur dire un mot. Signaler un blocage à qui ne peut pas le lever, c'est de
// l'anxiété ; le signaler à tout le monde, c'est de l'autogestion.

import { matchLiveStatus, type MatchLiveStatus, type TournamentMatch,
  type TournamentMatchEntry, type TournamentTeam } from './tournaments';

/**
 * L'état d'un terrain pendant la rotation, du point de vue de la soirée.
 *
 * `matchLiveStatus` rend `'awaiting'` pour DEUX situations que cet écran doit
 * séparer, parce qu'elles n'appellent pas le même geste :
 *
 *   * personne n'a rien saisi — le tirage suivant est bloqué, il faut aller
 *     chercher les quatre joueurs ; ce manque se subdivise encore en trois,
 *     selon le chrono du terrain (`a_demarrer` / `en_cours` / `temps_ecoule`),
 *     parce que ces trois-là n'appellent pas non plus le même geste : lancer
 *     le chrono, patienter, ou aller chercher un score qui ne vient pas ;
 *   * un camp a saisi, l'autre n'a pas encore répondu — le score compte déjà,
 *     la soirée n'attend personne, il n'y a rien à faire.
 *
 * Les confondre ferait afficher « en attente » sur un terrain qui ne bloque
 * rien, et paniquer pour rien à chaque rotation.
 */
export type CourtState =
  /** Personne n'a lancé le chrono. BLOQUE le tirage suivant. */
  | 'a_demarrer'
  /** Le chrono tourne, personne n'a encore saisi. BLOQUE. */
  | 'en_cours'
  /** Le temps est écoulé, personne n'a saisi. BLOQUE. */
  | 'temps_ecoule'
  /** Un camp a saisi, l'autre n'a pas répondu. Le score compte, rien ne bloque. */
  | 'provisoire'
  /** Les deux camps se contredisent. BLOQUE — on ne sait pas qui monte. */
  | 'litige'
  /** Les deux camps sont d'accord. */
  | 'acquis'
  /** Soldé par un forfait. */
  | 'forfait'
  /** Binôme sans adversaire sur cette rotation. */
  | 'exempt';

export interface CourtView {
  matchId: string;
  courtNo: number;
  state: CourtState;
  /** Vrai quand c'est MON terrain — celui où je suis attendu. */
  mine: boolean;
  /** Le score effectif, `null` tant que personne n'a saisi. */
  gamesA: number | null;
  gamesB: number | null;
  /** Le temps restant sur CE terrain — voir `secondsLeft`. */
  secondsLeft: number | null;
}

/** Les états qui empêchent de tirer la rotation suivante : les trois sans
 *  score, plus le désaccord. `'provisoire'` n'en fait PAS partie — un score
 *  compte dès qu'un camp l'a saisi, même si l'autre n'a pas encore répondu. */
export function blocks(state: CourtState): boolean {
  return state === 'a_demarrer' || state === 'en_cours' || state === 'temps_ecoule'
    || state === 'litige';
}

/**
 * Cet état demande-t-il qu'un HUMAIN se lève ?
 *
 * `blocks` répond à une autre question : « le serveur peut-il tirer la
 * rotation suivante ? ». Les deux se ressemblent et ne sont pas la même
 * chose — et les confondre à l'écran a un coût précis. Un terrain qui vient
 * d'être tiré (`a_demarrer`) ou qui joue (`en_cours`) bloque bien
 * l'avancement, mais il n'appelle personne : c'est le déroulement NORMAL
 * d'une rotation. Peindre les quatre terrains en rouge de la seconde où la
 * rotation est tirée jusqu'au premier score — c'est-à-dire l'essentiel de
 * chaque quart d'heure, sur seize téléphones — fait ressembler l'alarme
 * « allez leur parler » à « ils jouent », et plus personne ne la lit.
 *
 * Deux états, et deux seulement, réclament quelqu'un :
 *   * `temps_ecoule` — le chrono est fini et aucun score n'est rentré ;
 *   * `litige` — les deux camps se contredisent, seul un accord (ou
 *     l'organisateur) débloque ce terrain.
 */
export function needsHuman(state: CourtState): boolean {
  return state === 'temps_ecoule' || state === 'litige';
}

/** Le registre visuel d'un état — un NOM, pas une couleur.
 *
 *  Même convention que `statusTone` (lib/tournaments.ts) : la logique dit le
 *  ton, l'écran choisit la teinte. Ça garde ce fichier testable sans thème,
 *  et ça permet à la fiche et au poste organisateur de peindre un état de
 *  terrain comme le mode soirée le peint, sans recopier la règle.
 */
export type CourtTone = 'neutral' | 'live' | 'provisional' | 'alert' | 'done';

/**
 * Le ton d'un état de terrain.
 *
 * `'alert'` n'est pas décidé ici : il est DÉLÉGUÉ à `needsHuman`, qui porte
 * déjà la règle (« ce terrain réclame-t-il que quelqu'un se lève ? »). Deux
 * tables de correspondance séparées auraient divergé au premier état ajouté —
 * et c'est exactement cette divergence qui laissait `a_demarrer` et `en_cours`
 * en rouge alors que `needsHuman` les en excluait déjà.
 */
export function courtTone(state: CourtState): CourtTone {
  if (needsHuman(state)) return 'alert';
  switch (state) {
    case 'en_cours':   return 'live';
    case 'provisoire': return 'provisional';
    case 'acquis':     return 'done';
    // `a_demarrer` (rien à faire encore), `forfait` et `exempt` (soldés,
    // personne n'est attendu) : rien à signaler.
    default:           return 'neutral';
  }
}

/** Le plafond d'un compteur de jeux — celui du champ de saisie qu'il remplace
 *  (deux chiffres). Il n'a pas à coller au padel réel, seulement à exclure
 *  l'absurde. */
const JEUX_MAX = 99;

/**
 * Un pas de compteur, en chaîne : ce que devient la valeur affichée quand on
 * appuie sur « − » ou « + ».
 *
 * La saisie se faisait au clavier numérique. Debout entre deux points, les
 * mains moites, on rate une touche de clavier ; on ne rate pas un bouton de la
 * taille du pouce. La valeur reste une chaîne parce que c'est ce que l'écran
 * affiche — `''` étant « rien de saisi » (le « — » du champ), qu'un premier
 * « + » doit porter à 1 et non à 0.
 */
export function bumpGames(value: string, delta: number): string {
  const n = Number.parseInt(value, 10);
  const depart = Number.isNaN(n) ? 0 : n;
  return String(Math.min(JEUX_MAX, Math.max(0, depart + delta)));
}

/**
 * Ce push de tournoi annonce-t-il une soirée QUI TOURNE ?
 *
 * La spec (§6) dit où atterrir en ces termes : « le Mode soirée si la soirée
 * tourne, la fiche du tournoi sinon ». Le routage lisait `kind === 'round'`,
 * ce qui n'est pas la même chose — un abandon de binôme arrive lui aussi en
 * pleine soirée, et renvoyer son destinataire sur la fiche l'oblige à
 * retrouver le Mode soirée à la main pendant que sa rotation tourne.
 *
 * `validated` est le seul des quatre qui arrive APRÈS : le classement est
 * crédité, il n'y a plus de terrain à rejoindre. Un `kind` inconnu (un push
 * plus ancien que cette version de l'app) est traité comme « pas en soirée » :
 * la fiche du tournoi est toujours une destination sensée, le Mode soirée ne
 * l'est pas quand rien ne se joue.
 */
export function tournamentEveningIsLive(kind: string | null | undefined): boolean {
  return kind === 'round' || kind === 'forfeit';
}

/** Le temps restant sur un terrain, en secondes — négatif une fois dépassé.
 *  `null` tant que personne n'a lancé le chrono. Dérivé de l'heure SERVEUR :
 *  aucun compteur local, donc aucune dérive entre les quatre téléphones. */
export function secondsLeft(
  startedAt: string | null, roundMinutes: number, now: number,
): number | null {
  if (!startedAt) return null;
  const fin = new Date(startedAt).getTime() + roundMinutes * 60_000;
  return Math.round((fin - now) / 1000);
}

/**
 * L'état d'un terrain, dérivé de `matchLiveStatus` puis affiné.
 *
 * On PART du prédicat existant plutôt que de recalculer : il porte un
 * invariant subtil sur la concordance des saisies, et une seconde lecture de
 * la même règle finirait par en diverger. `roundMinutes` et `now` ne servent
 * QUE pour départager les trois temps du terrain muet — ils ne changent rien
 * dès qu'un score existe.
 */
export function courtState(
  m: Pick<TournamentMatch, 'team_b' | 'forfeited_team' | 'confirmed_at' | 'games_a' | 'started_at'>,
  teamAEntries: Pick<TournamentMatchEntry, 'games_a' | 'games_b'>[],
  teamBEntries: Pick<TournamentMatchEntry, 'games_a' | 'games_b'>[],
  roundMinutes: number,
  now: number,
): CourtState {
  const base: MatchLiveStatus = matchLiveStatus(
    m.team_b != null, m.forfeited_team, m.confirmed_at, teamAEntries, teamBEntries,
  );
  if (base === 'bye') return 'exempt';
  if (base === 'forfeited') return 'forfait';
  if (base === 'confirmed') return 'acquis';
  if (base === 'disputed') return 'litige';
  // `awaiting` se dédouble : un score écrit dit qu'au moins un camp a saisi ;
  // sinon c'est le chrono qui tranche entre les trois temps du terrain muet.
  if (m.games_a != null) return 'provisoire';
  const reste = secondsLeft(m.started_at, roundMinutes, now);
  if (reste == null) return 'a_demarrer';
  return reste > 0 ? 'en_cours' : 'temps_ecoule';
}

/** Le compte à rebours affiché à l'écran, `mm:ss`. Jamais négatif : au-delà de
 *  zéro c'est l'état `temps_ecoule` qui prend le relais, pas un décompte qui
 *  continuerait sous zéro. */
export function formatCountdown(seconds: number): string {
  const reste = Math.max(0, Math.round(seconds));
  const mm = Math.floor(reste / 60);
  const ss = reste % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/**
 * Faut-il faire tourner l'horloge d'affichage (un `setInterval` d'une
 * seconde) ?
 *
 * Seulement si un terrain décompte réellement — un écran qui ne montre que
 * des terrains à démarrer, acquis, forfait ou exempt n'a aucune raison de se
 * redessiner chaque seconde : rien n'y change tant que quelqu'un n'a pas
 * appuyé sur un bouton.
 */
export function shouldTickClock(courts: CourtView[]): boolean {
  return courts.some(c => c.state === 'en_cours');
}

/**
 * Faut-il laisser l'effet des sonneries AGIR sur l'état courant du terrain ?
 *
 * Le piège : au montage, la mémoire persistée et la porte vers les
 * notifications se chargent vite (`AsyncStorage` + `expo-notifications`,
 * tout en local), alors que les données du tournoi arrivent par le réseau —
 * `load()` peut prendre un moment, ou échouer, ou traîner si le réseau du
 * club est mauvais. Pendant cette fenêtre, `courts` est vide et `mien` est
 * `null` : EXACTEMENT la même forme que « je ne joue pas cette rotation ».
 * Si l'effet agit là-dessus, `syncCourtAlarms` traite la paire de sonneries
 * qu'on vient de RESTAURER depuis le stockage comme obsolète (son match ne
 * correspond plus à `matchId: null`), l'annule, et la persistance efface la
 * ligne — alors que le match tourne toujours, sans personne pour le savoir.
 * C'est précisément le scénario (mauvais réseau du club) pour lequel les
 * sonneries locales existent : le coût d'une confusion ici est une soirée
 * sans aucune sonnerie, pire que la duplication que la mémoire persistée
 * était censée éviter.
 *
 * Ne rend vrai que lorsque TOUT est prêt : la mémoire/porte des alarmes,
 * ET les données du tournoi (chargement terminé, tournoi et joueur bien
 * présents) — jamais sur la seule foi d'un `courts` vide, qui peut aussi
 * bien dire « pas encore chargé » que « je ne joue pas ».
 */
export function shouldSyncAlarms(o: {
  alarmesPretes: boolean;
  loading: boolean;
  hasTournament: boolean;
  hasPlayer: boolean;
}): boolean {
  return o.alarmesPretes && !o.loading && o.hasTournament && o.hasPlayer;
}

/** Les joueurs d'un binôme, tels quels — jamais « toi / l'adversaire ». */
function teamOf(teams: TournamentTeam[], id: string | null): TournamentTeam | null {
  return id ? teams.find(t => t.id === id) ?? null : null;
}

/** Suis-je dans ce binôme ? */
export function inTeam(t: TournamentTeam | null, myId: string): boolean {
  return !!t && (t.player1_id === myId || t.player2_id === myId);
}

/**
 * Tous les terrains de la rotation en cours, le mien marqué.
 *
 * Trié par numéro de terrain : c'est l'ordre du gymnase, et le seul que tout
 * le monde partage. Trier par état ferait sauter les cartes d'une rotation à
 * l'autre, alors qu'on cherche « le terrain 5 » avec les yeux.
 */
export function eveningCourts(
  matches: TournamentMatch[],
  teams: TournamentTeam[],
  entries: TournamentMatchEntry[],
  myId: string,
  currentRound: number,
  roundMinutes: number,
  now: number,
): CourtView[] {
  const parMatch = new Map<string, TournamentMatchEntry[]>();
  for (const e of entries) {
    const l = parMatch.get(e.match_id);
    if (l) l.push(e); else parMatch.set(e.match_id, [e]);
  }

  return matches
    .filter(m => m.round_no === currentRound)
    .map(m => {
      const ta = teamOf(teams, m.team_a);
      const tb = teamOf(teams, m.team_b);
      const mes = parMatch.get(m.id) ?? [];
      const dansA = (e: TournamentMatchEntry) => inTeam(ta, e.player_id);
      // UN REPOS N'EST PAS « MON TERRAIN ». Le binôme exempté figure bien sur
      // la ligne du bye (côté A, sans adversaire), mais s'il était marqué
      // `mine` l'écran lui montrait « TON TERRAIN », un VS avec un côté vide
      // et une saisie de score que le serveur refuse (`bye_match`) — au lieu
      // de la carte « Tu ne joues pas cette rotation », qui est la vérité. Le
      // cas apparaît dès que le nombre de binômes est impair.
      const repos = m.team_b == null;
      return {
        matchId: m.id,
        courtNo: m.court_no,
        state: courtState(m, mes.filter(dansA), mes.filter(e => !dansA(e)), roundMinutes, now),
        mine: !repos && (inTeam(ta, myId) || inTeam(tb, myId)),
        gamesA: m.games_a,
        gamesB: m.games_b,
        secondsLeft: secondsLeft(m.started_at, roundMinutes, now),
      };
    })
    .sort((a, b) => a.courtNo - b.courtNo);
}

/** Mon terrain de cette rotation, s'il y en a un. */
export function myCourt(courts: CourtView[]): CourtView | null {
  return courts.find(c => c.mine) ?? null;
}

/**
 * Ce qui empêche la rotation suivante, dit à tout le monde.
 *
 * Quatre manques différents, quatre phrases différentes — parce qu'ils
 * appellent quatre gestes différents : lancer le chrono, patienter, aller
 * chercher un score qui ne vient pas, ou demander à deux camps de se mettre
 * d'accord. Jamais « en attente » : ce mot dirait qu'un score provisoire
 * bloque, alors qu'il compte déjà.
 */
export function blockingLabel(courts: CourtView[]): string | null {
  const aDemarrer = courts.filter(c => c.state === 'a_demarrer').map(c => c.courtNo);
  const enCours = courts.filter(c => c.state === 'en_cours').map(c => c.courtNo);
  const tempsEcoule = courts.filter(c => c.state === 'temps_ecoule').map(c => c.courtNo);
  const litiges = courts.filter(c => c.state === 'litige').map(c => c.courtNo);
  if (aDemarrer.length === 0 && enCours.length === 0 && tempsEcoule.length === 0
    && litiges.length === 0) return null;

  const liste = (n: number[]) => n.length === 1 ? `Terrain ${n[0]}` : `Terrains ${n.join(', ')}`;
  const bouts: string[] = [];
  if (aDemarrer.length > 0) {
    bouts.push(`${liste(aDemarrer)} : pas encore commencé`);
  }
  if (enCours.length > 0) {
    bouts.push(`${liste(enCours)} : en cours`);
  }
  if (tempsEcoule.length > 0) {
    bouts.push(`${liste(tempsEcoule)} : temps écoulé — score attendu`);
  }
  if (litiges.length > 0) {
    bouts.push(`${liste(litiges)} : les deux camps ne disent pas la même chose`);
  }
  return bouts.join(' · ');
}

/** « Rotation 2 sur 6 ». */
export function roundLabel(current: number, total: number): string {
  return `Rotation ${Math.max(1, current)} sur ${Math.max(1, total)}`;
}

/**
 * Combien de terrains ont fini, sur combien — la jauge de la soirée.
 *
 * Un terrain « provisoire » COMPTE comme fini : son score est effectif, il
 * n'empêche rien. Ne compter que les acquis afficherait un retard qui n'existe
 * pas et pousserait à relancer des gens qui ont déjà fait leur part.
 */
export function courtsDone(courts: CourtView[]): { done: number; total: number } {
  const jouables = courts.filter(c => c.state !== 'exempt');
  return {
    done: jouables.filter(c => !blocks(c.state)).length,
    total: jouables.length,
  };
}
