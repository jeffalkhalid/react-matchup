// lib/tournaments.ts — l'accès aux tournois montante / descente, côté app.
//
// LE SQL FAIT AUTORITÉ (supabase/migrations/tournaments.sql + tournaments_rpcs.sql).
// Ce module ne recalcule aucune règle métier : il lit ce que le serveur expose et
// appelle les RPC. Les seuls calculs ici sont des DÉRIVATIONS que le schéma
// demande explicitement à l'app de faire (« binômes = court_count x 2, places =
// court_count x 4 se dérivent à la lecture (app / requêtes), jamais stockés »).
//
// ⚠️ LES PLACES SE COMPTENT EN JOUEURS, pas en binômes : `court_count x 4`.
// Un binôme se forme parfois tard (inscription solo puis appariement), donc la
// capacité ne peut pas se compter en équipes. « 13/16 » est un nombre de joueurs.
//
// ⚠️ INVARIANT DE LECTURE DE `tournament_teams` (en-tête de tournaments_rpcs.sql) :
// un binôme peut exister SANS AVOIR DE PLACE (deux joueurs en liste d'attente ont
// le droit de s'apparier). Aucun lecteur de cette table ne peut se passer de la
// jointure vers `tournament_registrations` avec `waitlist_position IS NULL` sur
// LES DEUX joueurs. `seatedTeams()` ci-dessous est le seul chemin autorisé.
//
// ⚠️ `open_to_join` est un MODE DE CONSENTEMENT qui n'appartient qu'au joueur.
// Aucun écran ne le change implicitement : seule `tournament_set_open_to_join`,
// déclenchée par un geste explicite de son propriétaire, y touche.
//
// Import supabase paresseux (motif de lib/clubFavorites.ts, lib/watchLink.ts) :
// les fonctions pures restent testables sans environnement Expo.

import { reasonLabel } from './tournamentReasons';

// ─── Types (miroir du schéma) ────────────────────────────────────────────────

import { displayName } from './players';

export type TournamentStatus =
  | 'BROUILLON' | 'INSCRIPTIONS_OUVERTES' | 'COMPLET' | 'CHECK_IN'
  | 'PRET' | 'EN_COURS' | 'TERMINE' | 'CLASSEMENT_VALIDE' | 'ANNULE';

/** Le côté déclaré POUR CE TOURNOI. Même domaine que `players.court_side`,
 *  qui ne sert qu'à PRÉREMPLIR : le côté se déclare le soir même, on s'adapte
 *  à son partenaire d'un soir. */
export type TournamentSide = 'left' | 'right' | 'both';

export type CheckInStatus = 'pending' | 'checked_in' | 'no_show';

export interface TournamentClub { id?: string; name: string | null; city?: string | null }

export interface Tournament {
  id: string;
  name: string;
  club_id: string | null;
  starts_at: string;
  ends_at: string | null;
  level_min: number | null;
  level_max: number | null;
  court_count: number;
  round_count: number;
  /** Durée d'une rotation, en minutes. Absent tant que
   *  `tournament_round_minutes.sql` n'est pas appliqué — cf. roundMinutesOf. */
  round_minutes?: number | null;
  /** Le barème des points, rang par rang (clés = rangs, en chaînes).
   *  Optionnel côté client : `pointsLadder` retombe sur le défaut du schéma. */
  points_scale?: Record<string, number> | null;
  price_mad: number;
  /** Score crédité À CHAQUE camp sur un match soldé par un forfait (0 par
   *  défaut) — c'est `forfeited_team`, jamais ce nombre, qui dit qui a gagné.
   *  Lu pour l'AVERTIR à l'écran avant de déclarer un forfait, jamais pour en
   *  déduire un résultat. */
  forfeit_games: number;
  status: TournamentStatus;
  current_round: number;
  /** Quand le classement sera validé tout seul faute de décision. Posé au
   *  passage en TERMINE ; absent tant que `tournament_auto_validate.sql`
   *  n'est pas appliquée. */
  auto_validate_at?: string | null;
  created_by: string;
  created_at: string;
  club?: TournamentClub | null;
}

export interface TournamentRegistration {
  tournament_id: string;
  player_id: string;
  side: TournamentSide;
  open_to_join: boolean;
  waitlist_position: number | null;
  check_in_status: CheckInStatus;
  registered_at: string;
  player?: { id: string; name: string | null; elo_score?: number | null; deleted_at?: string | null } | null;
}

export interface TournamentTeam {
  id: string;
  tournament_id: string;
  player1_id: string;
  player2_id: string;
  withdrawn: boolean;
}

export interface JoinRequest {
  id: string;
  tournament_id: string;
  from_player: string;
  to_player: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
}

/** Ce que rend une RPC de tournoi : `{ok:true, ...}` ou `{ok:false, reason}`.
 *  Aucune ne lève pour un refus métier — un appelant qui lit `error.message`
 *  pour certains refus et `data.reason` pour d'autres en oublie toujours un. */
export interface TournamentResult {
  ok: boolean;
  reason?: string;
  [key: string]: unknown;
}

// ─── Dérivations de capacité (pures) ─────────────────────────────────────────

/** Un terrain accueille 4 joueurs : deux binômes. */
export const SEATS_PER_COURT = 4;

/** Les places d'un tournoi, EN JOUEURS. Jamais stocké, toujours dérivé. */
export function seatCount(courtCount: number): number {
  return Math.max(0, courtCount) * SEATS_PER_COURT;
}

/** Les binômes qu'accueille le tournoi quand il est plein. */
export function teamCount(courtCount: number): number {
  return Math.max(0, courtCount) * 2;
}

/** Les places PRISES : une inscription hors liste d'attente occupe un siège.
 *  Ni une demande, ni un binôme — un binôme n'est qu'une relation entre deux
 *  places déjà prises (port de `fn_tournament_open_seats`). */
export function seatsTaken(regs: Pick<TournamentRegistration, 'waitlist_position'>[]): number {
  return regs.filter(r => r.waitlist_position == null).length;
}

/** Le nombre de joueurs en liste d'attente. */
export function waitlistCount(regs: Pick<TournamentRegistration, 'waitlist_position'>[]): number {
  return regs.filter(r => r.waitlist_position != null).length;
}

/** Les sièges réellement vides — port de `fn_tournament_free_places`.
 *
 *  CETTE FONCTION RENDAIT ZÉRO dès que quelqu'un attendait, quel que soit le
 *  nombre de sièges vides : les sièges appartenaient à la file, pas au
 *  prochain arrivant. C'était juste tant qu'un joueur en attente POUVAIT
 *  prendre un siège.
 *
 *  Depuis la règle du siège-aux-binômes, il ne le peut plus : un joueur seul
 *  n'a pas de place à tenir, et TOUTE inscription passe désormais par la file
 *  (le partenaire est invité, plus inscrit d'office). Un tournoi de 32 places
 *  affichait donc « COMPLET » dès son premier inscrit — vu à l'écran : « 2
 *  joueurs sur 32 », pastille COMPLET, et « Le tournoi est plein » à
 *  l'inscription.
 *
 *  La file n'est pas doublée pour autant : `fn_tournament_promote_waitlist`
 *  tourne après chaque inscription, retrait et appariement, et la sert dans
 *  l'ordre. Les sièges encore vides après son passage n'appartiennent à
 *  personne. */
export function freePlaces(
  regs: Pick<TournamentRegistration, 'waitlist_position'>[],
  courtCount: number,
): number {
  return Math.max(0, seatCount(courtCount) - seatsTaken(regs));
}

/**
 * Pourquoi je n'ai pas de siège — et donc quoi faire.
 *
 * Tous les textes de l'écran expliquaient l'attente par « le tournoi est
 * plein ». Ils datent d'avant la règle du siège-aux-binômes, où c'était la
 * SEULE raison d'attendre. Il y en a deux maintenant, et elles n'appellent
 * pas le même geste : sans binôme, on cherche un partenaire ; sans place, on
 * patiente. Dire « c'est plein » à quelqu'un qui voit trente sièges vides ne
 * l'induit pas seulement en erreur — ça lui fait croire l'app cassée.
 *
 * Attendre AVEC un binôme veut forcément dire qu'il n'y a plus de place :
 * `fn_tournament_promote_waitlist` assied tout binôme qui tient, à chaque
 * geste. D'où deux cas, et pas trois.
 */
export function waitExplanation(i: {
  hasPartner: boolean;
  /** Les inscriptions et l'appariement sont-ils encore ouverts ? */
  pairingOpen: boolean;
}): string {
  if (!i.hasPartner) {
    return i.pairingOpen
      ? 'Les places vont aux binômes : dès que tu as un partenaire, vous prenez une place à deux.'
      : 'Le tournoi a démarré sans que tu trouves de binôme : les places vont aux paires.';
  }
  return i.pairingOpen
    ? 'Toutes les places sont prises. Vous avancerez dès qu’un binôme se retire.'
    : 'Le tournoi a démarré sans que votre place ne se libère : la liste d’attente ne bouge plus pour cette soirée.';
}

/**
 * Ce qu'on annonce à quelqu'un qui n'est PAS encore inscrit.
 *
 * Il ne peut pas savoir qu'il entrera en file : c'est vrai de toute
 * inscription depuis que le partenaire est invité au lieu d'être inscrit
 * d'office. Le taire fait passer la file pour une punition.
 */
export function registerNotice(freeSeats: number): string {
  return freeSeats === 0
    ? 'Toutes les places sont prises : ton inscription entrera en liste d’attente.'
    : 'Les places vont aux binômes : tu t’inscris d’abord seul, et vous prenez une place à deux dès que ton binôme est formé.';
}

/** « 13/16 » — un nombre de JOUEURS des deux côtés de la barre. */
export function seatsLabel(
  regs: Pick<TournamentRegistration, 'waitlist_position'>[],
  courtCount: number,
): string {
  return `${seatsTaken(regs)}/${seatCount(courtCount)}`;
}

/** Les binômes qui ont RÉELLEMENT une place — l'invariant de lecture de
 *  `tournament_teams`, porté ici pour que l'oubli soit impossible plutôt que
 *  déconseillé (port de `fn_tournament_seated_teams`, sans le filtre
 *  `withdrawn` : un écran d'inscription veut voir tout le monde). */
export function seatedTeams(
  teams: TournamentTeam[],
  regs: Pick<TournamentRegistration, 'player_id' | 'waitlist_position'>[],
): TournamentTeam[] {
  const seated = new Set(regs.filter(r => r.waitlist_position == null).map(r => r.player_id));
  return teams.filter(t => seated.has(t.player1_id) && seated.has(t.player2_id));
}

// ─── Phases et libellés (purs) ───────────────────────────────────────────────

export type TournamentPhase = 'draft' | 'upcoming' | 'live' | 'past';

/** Les trois onglets de la liste, plus le brouillon qui n'y figure pas.
 *  BROUILLON n'est pas encore publié : il n'apparaît nulle part. ANNULE va
 *  dans « Passés » — un tournoi mort n'est ni à venir ni en cours, et
 *  `statusLabel` + `statusTone` disent déjà clairement qu'il est annulé plutôt
 *  que joué. */
export function tournamentPhase(status: TournamentStatus): TournamentPhase {
  switch (status) {
    case 'BROUILLON':               return 'draft';
    case 'EN_COURS':                return 'live';
    case 'TERMINE':
    case 'CLASSEMENT_VALIDE':
    case 'ANNULE':                  return 'past';
    default:                        return 'upcoming';   // ouvertes, complet, check-in, prêt
  }
}

const STATUS_LABEL: Record<TournamentStatus, string> = {
  BROUILLON:             'Brouillon',
  INSCRIPTIONS_OUVERTES: 'Inscriptions ouvertes',
  COMPLET:               'Complet',
  CHECK_IN:              'Pointage',
  PRET:                  'Prêt à démarrer',
  EN_COURS:              'En cours',
  TERMINE:               'Terminé',
  CLASSEMENT_VALIDE:     'Classement validé',
  ANNULE:                'Annulé',
};

export function statusLabel(status: TournamentStatus): string {
  return STATUS_LABEL[status] ?? 'Tournoi';
}

/** La couleur d'un statut — SOURCE UNIQUE, comme `statusLabel` pour le texte.
 *  Avant cette fonction, la carte de liste, la fiche et l'admin choisissaient
 *  chacune leur propre couleur pour le même statut (COMPLET : orange sur la
 *  carte, gris sur la fiche — confondu avec TERMINE —, vert dans l'admin) :
 *  trois vérités sur trois écrans qu'on enchaîne en deux taps.
 *
 *  Le type de retour est un SOUS-ENSEMBLE, recopié en littéral, de
 *  `PillVariant` (components/Pill.tsx) plutôt qu'importé : ce module reste
 *  testable sans environnement Expo (cf. l'en-tête du fichier) — importer
 *  components/Pill.tsx y introduirait react-native. */
export type TournamentStatusTone = 'success' | 'warning' | 'brand' | 'neutral' | 'ink' | 'danger';

const STATUS_TONE: Record<TournamentStatus, TournamentStatusTone> = {
  BROUILLON:             'neutral',
  INSCRIPTIONS_OUVERTES: 'success',
  COMPLET:               'warning',
  CHECK_IN:              'ink',
  PRET:                  'ink',
  EN_COURS:              'brand',
  TERMINE:               'neutral',
  CLASSEMENT_VALIDE:     'neutral',
  ANNULE:                'danger',
};

export function statusTone(status: TournamentStatus): TournamentStatusTone {
  return STATUS_TONE[status] ?? 'neutral';
}

const SIDE_LABEL: Record<TournamentSide, string> = {
  left:  'Gauche',
  right: 'Droit',
  both:  'Les deux',
};

export function sideLabel(side: TournamentSide | null | undefined): string {
  return side ? (SIDE_LABEL[side] ?? 'Les deux') : 'Les deux';
}

/** Deux joueurs du MÊME côté : c'est AUTORISÉ, et seulement SIGNALÉ. On ne
 *  bloque jamais — le binôme s'arrangera sur le terrain, et « les deux » veut
 *  précisément dire « pas de contrainte ». Rend null quand il n'y a rien à
 *  dire. */
export function sameSideWarning(
  a: TournamentSide | null | undefined,
  b: TournamentSide | null | undefined,
): string | null {
  if (!a || !b) return null;
  if (a !== b) return null;
  if (a === 'both') return null;
  return a === 'left'
    ? 'Vous jouez tous les deux à gauche. C’est possible, mais l’un devra passer à droite.'
    : 'Vous jouez tous les deux à droite. C’est possible, mais l’un devra passer à gauche.';
}

export interface PartnerCandidate {
  player_id: string;
  side: TournamentSide | null | undefined;
  elo: number | null | undefined;
}

/**
 * À quel point deux côtés vont ensemble — 0 = idéal, 2 = à négocier.
 *
 * Un binôme gauche + droite se met en place tel quel. Deux gauchers jouent
 * quand même, mais l'un devra passer à droite : c'est ce que dit déjà
 * `sameSideWarning`, et c'est pour ça que le côté passe AVANT le niveau dans
 * la suggestion.
 */
function ecartDeCote(a: TournamentSide | null | undefined, b: TournamentSide | null | undefined): number {
  if (!a || !b || a === 'both' || b === 'both') return 1;
  return a === b ? 2 : 0;
}

/**
 * Le partenaire que l'app propose à un joueur seul.
 *
 * Un joueur seul entre en liste d'attente et n'en sort qu'apparié. Il pouvait
 * déjà inviter quelqu'un lui-même ; encore fallait-il qu'il sache QUI, dans
 * une liste de prénoms où rien ne dit lequel lui convient. Cette fonction
 * choisit à sa place : côté opposé d'abord, niveau le plus proche ensuite.
 *
 * ⚠️ DÉTERMINISTE, y compris à égalité parfaite (départage par `player_id`).
 * Une suggestion qui change à chaque rafraîchissement de la liste passe pour
 * un bug, et on cesse de lui faire confiance.
 *
 * Ne propose RIEN quand il n'y a personne : pas de repli sur « n'importe qui ».
 */
export function suggestPartner(
  me: PartnerCandidate, solos: PartnerCandidate[],
): PartnerCandidate | null {
  const autres = solos.filter(s => s.player_id !== me.player_id);
  if (autres.length === 0) return null;

  const score = (c: PartnerCandidate): [number, number, string] => [
    ecartDeCote(me.side, c.side),
    me.elo != null && c.elo != null ? Math.abs(me.elo - c.elo) : Number.MAX_SAFE_INTEGER,
    c.player_id,
  ];

  return [...autres].sort((x, y) => {
    const [sx, ex, ix] = score(x);
    const [sy, ey, iy] = score(y);
    return sx - sy || ex - ey || ix.localeCompare(iy);
  })[0];
}

/** « Niveau 3 à 5 », « Niveau 4 et plus », « Tous niveaux ». */
export function levelRangeLabel(min: number | null, max: number | null): string {
  const f = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  if (min != null && max != null) return `Niveau ${f(min)} à ${f(max)}`;
  if (min != null) return `Niveau ${f(min)} et plus`;
  if (max != null) return `Niveau ${f(max)} et moins`;
  return 'Tous niveaux';
}

/** Le prix est AFFICHÉ, jamais encaissé par l'app (cf. le schéma). */
export function priceLabel(priceMad: number): string {
  return priceMad > 0 ? `${priceMad} DH` : 'Gratuit';
}

/** « today » / « tomorrow » / « other » — SOURCE UNIQUE de la comparaison de
 *  jour calendaire. Avant cette fonction, `formatTournamentDate` ci-dessous
 *  ET `splitDate` (components/tournaments/TournamentCard.tsx) portaient
 *  chacune leur PROPRE calcul du même « aujourd'hui / demain », ni l'un ni
 *  l'autre testé — deux implémentations qui pouvaient diverger au passage de
 *  minuit (deux appels à `new Date()` à quelques millisecondes d'écart, un
 *  qui tombe avant minuit et l'autre après). `now` est un paramètre PUREMENT
 *  pour la testabilité (jamais appelé avec autre chose que l'heure réelle en
 *  dehors des tests) — cf. `lib/__tests__/tournaments.test.ts`. */
export function dateBucket(iso: string, now: Date = new Date()): 'today' | 'tomorrow' | 'other' {
  const d = new Date(iso);
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === now.toDateString()) return 'today';
  if (d.toDateString() === tomorrow.toDateString()) return 'tomorrow';
  return 'other';
}

/** « Aujourd'hui · 19h00 » / « Demain · 19h00 » / « sam. 6 sept. · 19h00 »,
 *  même forme que le Lobby. */
export function formatTournamentDate(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const bucket = dateBucket(iso);
  if (bucket === 'today') return `Aujourd'hui · ${hh}h${mm}`;
  if (bucket === 'tomorrow') return `Demain · ${hh}h${mm}`;
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) + ` · ${hh}h${mm}`;
}

/**
 * La durée d'une rotation, par défaut.
 *
 * Elle a longtemps été LA constante du format : la durée d'une soirée n'était
 * pas un réglage, mais une conséquence du nombre de rotations. Or c'est une
 * contrainte du monde réel — on réserve un terrain pour un créneau, et selon
 * le club une rotation dure 12, 15 ou 20 minutes. Elle vit désormais sur le
 * tournoi (`round_minutes`), et cette constante n'est plus que le défaut.
 */
export const ROUND_MINUTES = 15;

/** Les durées proposées à la création. Le serveur accepte 5 à 60. */
export const ROUND_MINUTES_CHOICES = [10, 12, 15, 20] as const;

/**
 * La durée d'une rotation d'un tournoi donné.
 *
 * `round_minutes` est OPTIONNEL côté client : tant que
 * `tournament_round_minutes.sql` n'est pas appliqué, la colonne n'existe pas
 * et l'ancien défaut prend le relais — les écrans affichent la même chose
 * qu'avant au lieu de montrer un blanc.
 */
export function roundMinutesOf(t: { round_minutes?: number | null } | null | undefined): number {
  const m = t?.round_minutes;
  return typeof m === 'number' && m > 0 ? m : ROUND_MINUTES;
}

/** La durée totale d'une soirée, en minutes. */
export function totalDurationMinutes(roundCount: number, roundMinutes: number): number {
  return Math.max(0, roundCount) * Math.max(0, roundMinutes);
}

export function formatLabel(courtCount: number, roundCount: number, minutes: number = ROUND_MINUTES): string {
  return `${courtCount} terrain${courtCount > 1 ? 's' : ''} · ${roundCount} rotation${roundCount > 1 ? 's' : ''} de ${minutes} min`;
}

// ─── L'interrupteur ──────────────────────────────────────────────────────────

/** Interrupteur global des tournois (app_config.tournaments_enabled).
 *
 *  ⚠️ DÉFAUT INVERSE de `getWatchPairingEnabled` : clé absente = ÉTEINT, comme
 *  côté serveur (`fn_tournaments_enabled`, tournaments_flag.sql). La
 *  fonctionnalité est neuve, le déploiement doit être sûr par défaut. Un aléa
 *  réseau masque donc l'entrée — c'est le comportement voulu : mieux vaut une
 *  entrée absente qu'un écran qui n'aboutira sur rien, toutes les RPC
 *  répondant `feature_disabled`.
 *
 *  Ce n'est qu'un MASQUE d'affichage : le vrai verrou est côté serveur. */
export async function getTournamentsEnabled(): Promise<boolean> {
  try {
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase
      .from('app_config').select('value').eq('key', 'tournaments_enabled').maybeSingle();
    if (error) return false;
    return data?.value === 'true';
  } catch {
    return false;
  }
}

/** Vrai quand le serveur refuse parce que la fonctionnalité est éteinte.
 *  Ce refus-là ne s'AFFICHE PAS : il fait disparaître l'entrée. */
export function isFeatureDisabled(res: TournamentResult | null | undefined): boolean {
  return !!res && res.ok === false && res.reason === 'feature_disabled';
}

/** Le message à montrer pour un refus. Jamais le code brut. */
export function resultMessage(res: TournamentResult): string {
  return reasonLabel(res.reason);
}

// ─── Lectures ────────────────────────────────────────────────────────────────

const TOURNAMENT_COLS =
  'id, name, club_id, starts_at, ends_at, level_min, level_max, court_count, round_count, round_minutes, points_scale, ' +
  'price_mad, forfeit_games, status, current_round, auto_validate_at, created_by, created_at, club:club_id(id, name, city)';

/** Les tournois PUBLIÉS, du plus proche au plus lointain. Les brouillons sont
 *  écartés côté requête : ils n'appartiennent qu'à leur organisateur. */
export async function fetchTournaments(): Promise<Tournament[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .from('tournaments')
    .select(TOURNAMENT_COLS)
    .neq('status', 'BROUILLON')
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as Tournament[];
}

export async function fetchTournament(id: string): Promise<Tournament | null> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .from('tournaments').select(TOURNAMENT_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as unknown as Tournament) ?? null;
}

/** Les inscriptions d'un tournoi, avec le joueur. Ordre : les assis d'abord
 *  (par date), puis la file dans son ordre. */
export async function fetchRegistrations(tournamentId: string): Promise<TournamentRegistration[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .from('tournament_registrations')
    .select('tournament_id, player_id, side, open_to_join, waitlist_position, check_in_status, registered_at, player:player_id(id, name, elo_score, avatar_path, deleted_at)')
    .eq('tournament_id', tournamentId)
    .order('waitlist_position', { ascending: true, nullsFirst: true })
    .order('registered_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as TournamentRegistration[];
}

/** Les inscriptions de PLUSIEURS tournois, en une requête, réduites à ce dont
 *  la liste a besoin : compter les places et savoir si j'en suis. Une requête
 *  par carte ferait N appels pour un écran qui en veut un. */
export async function fetchRegistrationsFor(
  tournamentIds: string[],
): Promise<Map<string, TournamentRegistration[]>> {
  const out = new Map<string, TournamentRegistration[]>();
  if (tournamentIds.length === 0) return out;
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .from('tournament_registrations')
    .select('tournament_id, player_id, side, open_to_join, waitlist_position, check_in_status, registered_at')
    .in('tournament_id', tournamentIds);
  if (error) throw error;
  for (const row of (data ?? []) as unknown as TournamentRegistration[]) {
    const list = out.get(row.tournament_id);
    if (list) list.push(row); else out.set(row.tournament_id, [row]);
  }
  return out;
}

export async function fetchTeams(tournamentId: string): Promise<TournamentTeam[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .from('tournament_teams')
    .select('id, tournament_id, player1_id, player2_id, withdrawn')
    .eq('tournament_id', tournamentId);
  if (error) throw error;
  return (data ?? []) as unknown as TournamentTeam[];
}

/** Les demandes d'appariement VIVANTES qui me concernent. La policy ne rend
 *  déjà que celles où je suis d'un côté ou de l'autre — « qui a demandé à qui »
 *  n'est pas public, contrairement au tournoi lui-même. */
export async function fetchMyJoinRequests(tournamentId: string): Promise<JoinRequest[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .from('tournament_join_requests')
    .select('id, tournament_id, from_player, to_player, status, created_at')
    .eq('tournament_id', tournamentId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as JoinRequest[];
}

/**
 * Qui a demandé à faire binôme avec qui — les demandes EN COURS, pour tous.
 *
 * La policy de `tournament_join_requests` réserve la lecture des lignes aux
 * deux intéressés. Un tiers voyait donc deux joueurs déjà liés comme deux
 * joueurs seuls, et leur proposait par-dessus.
 *
 * ESSAYÉ AVANT, PUIS RETIRÉ : un COMPTE anonyme (« devQ a 1 demande »). Sur
 * une soirée où deux joueurs seuls se sont demandés, les DEUX cartes
 * affichaient « 1 demande » et le lien se déduisait aussitôt. Un nombre n'est
 * anonyme que noyé dans le nombre, et il ne l'est jamais au début des
 * inscriptions — c'est-à-dire quand il servirait.
 *
 * CE QUI SORT, ET CE QUI NE SORT PAS : les demandes `pending`, et rien
 * d'autre. Une demande refusée disparaît de cette lecture au moment du refus,
 * sans que personne d'autre n'ait su qu'elle avait existé — l'appariement
 * devient lisible sans que les râteaux le deviennent.
 *
 * Une panne ici ne casse rien : sans ces couples, les cartes retombent sur les
 * seules demandes que la policy laisse voir, c'est-à-dire les miennes.
 */
export async function fetchPendingPairs(tournamentId: string): Promise<JoinRequest[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .rpc('tournament_pending_pairs', { p_tournament: tournamentId });
  if (error) {
    console.warn('[tournois] demandes en cours indisponibles', error);
    return [];
  }
  // La RPC ne rend que le couple : ni identifiant, ni date — on ne peut pas
  // répondre à la place de quelqu'un avec ça. `groupRegistrations` n'a besoin
  // que de `from_player`, `to_player` et `status`.
  return ((data ?? []) as { from_player: string; to_player: string }[]).map(r => ({
    id: `${r.from_player}:${r.to_player}`,
    tournament_id: tournamentId,
    from_player: r.from_player,
    to_player: r.to_player,
    status: 'pending' as const,
    created_at: '',
  }));
}

// ─── Appels serveur ──────────────────────────────────────────────────────────

/** Enveloppe commune : une RPC de tournoi ne lève jamais pour un refus métier,
 *  mais le transport peut échouer. Un échec réseau devient un refus SANS
 *  raison, donc un message générique — jamais une trace technique à l'écran. */
async function callTournamentRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<TournamentResult> {
  try {
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      console.warn(`[tournois] ${fn} a échoué`, error.message);
      return { ok: false };
    }
    if (!data || typeof data !== 'object') return { ok: false };
    return data as TournamentResult;
  } catch (e) {
    console.warn(`[tournois] ${fn} a échoué`, e);
    return { ok: false };
  }
}

/** S'inscrire, seul ou à deux.
 *  - `side` est OBLIGATOIRE et vaut pour CE tournoi.
 *  - `openToJoin` est MON mode de consentement, avec ou sans partenaire.
 *  - `partnerId` inscrit le partenaire SANS déclaration faite en son nom :
 *    côté « les deux », consentement FERMÉ. Le serveur s'en charge — n'essaie
 *    jamais de le corriger depuis un écran. */
export function registerToTournament(
  tournamentId: string,
  side: TournamentSide,
  openToJoin: boolean,
  partnerId?: string | null,
): Promise<TournamentResult> {
  return callTournamentRpc('tournament_register', {
    p_tournament: tournamentId,
    p_side: side,
    p_open_to_join: openToJoin,
    p_partner: partnerId ?? null,
  });
}

/** Rejoindre un inscrit seul. Fiche « ouverte » : le binôme se forme d'un
 *  geste (`mode:'team'`). Fiche « sur accord » : une demande part
 *  (`mode:'request'`), et elle ne retient AUCUNE place. */
export function joinTournamentPlayer(tournamentId: string, playerId: string): Promise<TournamentResult> {
  return callTournamentRpc('tournament_join', { p_tournament: tournamentId, p_player: playerId });
}

/** Répondre à une demande reçue. Accepter forme le binôme ET refuse
 *  automatiquement les autres demandes vivantes. */
export function respondJoinRequest(requestId: string, accept: boolean): Promise<TournamentResult> {
  return callTournamentRpc('tournament_respond_join', { p_request: requestId, p_accept: accept });
}

/** Défaire son binôme. Les DEUX gardent leur place, leur rang de file et leur
 *  mode de consentement : personne n'est éjecté parce que l'autre s'est ravisé. */
export function leaveTournamentTeam(tournamentId: string): Promise<TournamentResult> {
  return callTournamentRpc('tournament_leave_team', { p_tournament: tournamentId });
}

/** Se désinscrire avant le lancement. La place se libère et la file avance. */
export function withdrawFromTournament(tournamentId: string): Promise<TournamentResult> {
  return callTournamentRpc('tournament_withdraw', { p_tournament: tournamentId });
}

/** Confirmer sa présence le jour J. */
export function checkInToTournament(tournamentId: string): Promise<TournamentResult> {
  return callTournamentRpc('tournament_check_in', { p_tournament: tournamentId });
}

/** Changer SON mode de consentement — et rien d'autre. Le serveur n'a aucun
 *  paramètre « joueur » ici : le sujet est toujours l'appelant. */
export function setOpenToJoin(tournamentId: string, open: boolean): Promise<TournamentResult> {
  return callTournamentRpc('tournament_set_open_to_join', { p_tournament: tournamentId, p_open: open });
}

/** Changer SON côté — et rien d'autre (même moule que `setOpenToJoin`, aucun
 *  paramètre « joueur » : le sujet est toujours l'appelant). Signature GELÉE
 *  côté serveur (`tournament_set_side(uuid, text)`) : refuse une fois les
 *  matchs tirés (`matches_already_generated`), jamais avant — un binôme déjà
 *  formé n'empêche pas de changer de côté, seul le tirage le fige. */
export function setSide(tournamentId: string, side: TournamentSide): Promise<TournamentResult> {
  return callTournamentRpc('tournament_set_side', { p_tournament: tournamentId, p_side: side });
}

// ─── Vue « moi sur ce tournoi » (pure) ───────────────────────────────────────

export interface MyTournamentState {
  registration: TournamentRegistration | null;
  waitlisted: boolean;
  team: TournamentTeam | null;
  partnerId: string | null;
  /** Demandes reçues, en attente de MA réponse. */
  incoming: JoinRequest[];
  /** Demandes que J'AI envoyées, sans réponse. */
  outgoing: JoinRequest[];
}

/** Assemble en un seul objet ce que les écrans ont besoin de savoir sur moi.
 *  Aucun accès réseau : tout est déduit des lectures déjà faites, pour qu'il
 *  n'existe qu'UNE façon de répondre à « où j'en suis ». */
export function myTournamentState(
  myId: string,
  regs: TournamentRegistration[],
  teams: TournamentTeam[],
  requests: JoinRequest[],
): MyTournamentState {
  const registration = regs.find(r => r.player_id === myId) ?? null;
  const team = teams.find(t => t.player1_id === myId || t.player2_id === myId) ?? null;
  return {
    registration,
    waitlisted: !!registration && registration.waitlist_position != null,
    team,
    partnerId: team ? (team.player1_id === myId ? team.player2_id : team.player1_id) : null,
    incoming: requests.filter(r => r.to_player === myId && r.status === 'pending'),
    outgoing: requests.filter(r => r.from_player === myId && r.status === 'pending'),
  };
}

/** Les inscrits qui cherchent encore un partenaire : ceux qui n'ont AUCUN
 *  binôme. « open_to_join » ne dit pas « je cherche » — ça, c'est justement
 *  l'absence d'équipe ; il ne dit que « peut-on me prendre d'un geste ». */
export function soloRegistrations(
  regs: TournamentRegistration[],
  teams: TournamentTeam[],
): TournamentRegistration[] {
  const paired = new Set<string>();
  for (const t of teams) { paired.add(t.player1_id); paired.add(t.player2_id); }
  return regs.filter(r => !paired.has(r.player_id));
}

/** Les inscriptions peuvent-elles encore bouger ? Miroir des statuts acceptés
 *  par `tournament_register` (ouvertes/complet — au-delà des places on entre
 *  en file, ce n'est pas un refus). */
export function acceptsRegistrations(status: TournamentStatus): boolean {
  return status === 'INSCRIPTIONS_OUVERTES' || status === 'COMPLET';
}

/** Un binôme se fait et se défait jusqu'au lancement — miroir de
 *  `tournament_join` / `tournament_leave_team`. */
export function acceptsPairing(status: TournamentStatus): boolean {
  return status === 'INSCRIPTIONS_OUVERTES' || status === 'COMPLET'
      || status === 'CHECK_IN' || status === 'PRET';
}

/** Le pointage est ouvert. */
export function acceptsCheckIn(status: TournamentStatus): boolean {
  return status === 'CHECK_IN' || status === 'PRET';
}

/** Le pointage peut s'OUVRIR — miroir de `tournament_open_check_in`
 *  (`INSCRIPTIONS_OUVERTES` ou `COMPLET` -> `CHECK_IN`). Facultatif :
 *  `tournament_start` accepte encore de lancer directement sans passer par
 *  ici (« lancer quand même »), donc ce n'est jamais un préalable obligatoire. */
export function canOpenCheckIn(status: TournamentStatus): boolean {
  return status === 'INSCRIPTIONS_OUVERTES' || status === 'COMPLET';
}

// ─── La soirée : tableau, classement, saisie (Task 8) ────────────────────────
//
// LE TERRAIN 1 EST LE PALIER LE PLUS FORT, on monte vers lui (numéro qui
// DIMINUE). `tournaments.current_round` est le tour EN COURS (celui que
// `tournament_generate_round` vient d'écrire) : c'est lui qu'on lit pour le
// tableau de la soirée, pas un calcul de « round suivant ».

/** Une ligne de `tournament_matches` — un terrain, un tour. `team_b` est
 *  `null` pour un bye. Le score et le forfait sont EXACTEMENT ce que le
 *  serveur a écrit ; rien ici ne les redérive. */
export interface TournamentMatch {
  id: string;
  tournament_id: string;
  round_no: number;
  court_no: number;
  team_a: string;
  team_b: string | null;
  games_a: number | null;
  games_b: number | null;
  forfeited_team: string | null;
  confirmed_at: string | null;
  started_at: string | null;
  /** Quand la rotation a été tirée. Le seul repère temporel d'un terrain dont
   *  personne n'a lancé le chrono — voir `blockedCourts`. */
  created_at: string | null;
}

const TOURNAMENT_MATCH_COLS =
  'id, tournament_id, round_no, court_no, team_a, team_b, games_a, games_b, forfeited_team, confirmed_at, started_at, created_at';

/** Les matchs d'UN TOUR, terrain par terrain — le tableau de la soirée.
 *  Triés Terrain 1 en premier : « du Terrain 1 en haut » se lit directement
 *  dans l'ordre du tableau, aucun tri à refaire à l'écran. */
export async function fetchRoundMatches(tournamentId: string, roundNo: number): Promise<TournamentMatch[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .from('tournament_matches')
    .select(TOURNAMENT_MATCH_COLS)
    .eq('tournament_id', tournamentId)
    .eq('round_no', roundNo)
    .order('court_no', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as TournamentMatch[];
}

/** Une ligne de `tournament_movements` : comment un binôme est arrivé sur SON
 *  terrain à CE tour (`court_before` → `court_after`, `movement`). Écrite par
 *  `tournament_generate_round` (Task 10) — c'est elle qui porte « les flèches
 *  de montée et de descente », jamais un calcul local sur le résultat du tour
 *  précédent. Au tour 1, tout le monde est 'STAY' (personne n'a encore
 *  bougé) : aucune flèche ne s'affiche, ce qui est la vérité. */
export interface TournamentMovement {
  team_id: string;
  round_no: number;
  court_before: number;
  court_after: number;
  movement: 'UP' | 'DOWN' | 'STAY';
}

export async function fetchRoundMovements(tournamentId: string, roundNo: number): Promise<TournamentMovement[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .from('tournament_movements')
    .select('team_id, round_no, court_before, court_after, movement')
    .eq('tournament_id', tournamentId)
    .eq('round_no', roundNo);
  if (error) throw error;
  return (data ?? []) as unknown as TournamentMovement[];
}

/** Une SAISIE INDIVIDUELLE (`tournament_match_entries`) : un joueur, un match,
 *  son score. `games_a`/`games_b` sont déjà orientés `team_a`/`team_b` DU
 *  MATCH — quel que soit le joueur qui a saisi (contrat d'orientation de
 *  `tournament_enter_score`) — donc directement affichables sans savoir qui
 *  les a écrites. */
export interface TournamentMatchEntry {
  id: string;
  match_id: string;
  player_id: string;
  games_a: number;
  games_b: number;
  entered_at: string;
}

/** Les saisies des matchs donnés — de quoi dire « ce qui manque pour que le
 *  match soit acquis » avant même d'appeler le serveur. */
export async function fetchMatchEntries(matchIds: string[]): Promise<TournamentMatchEntry[]> {
  if (matchIds.length === 0) return [];
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .from('tournament_match_entries')
    .select('id, match_id, player_id, games_a, games_b, entered_at')
    .in('match_id', matchIds);
  if (error) throw error;
  return (data ?? []) as unknown as TournamentMatchEntry[];
}

/** Saisir MON score pour un match — n'importe lequel des quatre joueurs peut
 *  appeler cette fonction. `gamesA` est TOUJOURS le score de `team_a` DU
 *  MATCH, `gamesB` celui de `team_b` — JAMAIS « mon score » : l'écran doit
 *  nommer les deux camps et ne jamais réordonner les colonnes selon qui
 *  saisit (en-tête de `tournament_enter_score`, tournaments_rpcs.sql). Le
 *  retour porte `state`: 'recorded' | 'confirmed' | 'disputed'. */
export function enterTournamentScore(
  matchId: string, gamesA: number, gamesB: number,
): Promise<TournamentResult> {
  return callTournamentRpc('tournament_enter_score', {
    p_match: matchId, p_games_a: gamesA, p_games_b: gamesB,
  });
}

/** L'état d'un match, tel qu'un écran peut le lire SANS JAMAIS redériver de
 *  vainqueur : bye et forfait se lisent aux champs dédiés (`hasTeamB`,
 *  `forfeitedTeam`), confirmé se lit à `confirmedAt`. Seul le cas ni bye ni
 *  forfait ni confirmé regarde les saisies individuelles — et seulement pour
 *  distinguer « personne n'a encore rien dit » de « les deux camps se
 *  contredisent », jamais pour décider qui gagne (ça, c'est `forfeited_team`
 *  ou la concordance des jeux, et c'est le SERVEUR qui tranche).
 *
 *  ⚠️ INVARIANT QUI REND CETTE FONCTION CORRECTE (relu dans
 *  `tournament_enter_score`, tournaments_rpcs.sql) : la confirmation s'y
 *  déclenche de façon SYNCHRONE, dans la même transaction que l'INSERT de la
 *  saisie — dès qu'une saisie concorde avec une saisie déjà enregistrée d'un
 *  binôme OPPOSÉ, `confirmed_at` est posé avant que la fonction ne rende la
 *  main. Il ne peut donc JAMAIS exister, lu depuis le client, un couple de
 *  saisies concordantes de deux camps opposés pendant que `confirmedAt` est
 *  encore nul — l'écran qui les lirait serait en train de lire un état déjà
 *  périmé, pas un état réel. Sous cet invariant, le calcul ci-dessous
 *  (`bothEntered && !anyAgree` ⇒ litige) est l'exact équivalent logique de ce
 *  que lit `fn_tournament_match_dispute` côté serveur — ce n'est pas une
 *  coïncidence, ni une approximation à corriger : NE PAS EN DÉDUIRE qu'il
 *  faudrait retirer le garde `anyAgree`, qui protège seulement contre un
 *  état CLIENT en retard (un rechargement pas encore arrivé), jamais contre
 *  un état serveur réel. */
export type MatchLiveStatus = 'bye' | 'forfeited' | 'confirmed' | 'disputed' | 'awaiting';

export function matchLiveStatus(
  hasTeamB: boolean,
  forfeitedTeam: string | null | undefined,
  confirmedAt: string | null | undefined,
  teamAEntries: Pick<TournamentMatchEntry, 'games_a' | 'games_b'>[],
  teamBEntries: Pick<TournamentMatchEntry, 'games_a' | 'games_b'>[],
): MatchLiveStatus {
  if (!hasTeamB) return 'bye';
  if (forfeitedTeam != null) return 'forfeited';
  if (confirmedAt != null) return 'confirmed';
  const bothEntered = teamAEntries.length > 0 && teamBEntries.length > 0;
  const anyAgree = teamAEntries.some(a =>
    teamBEntries.some(b => a.games_a === b.games_a && a.games_b === b.games_b));
  if (bothEntered && !anyAgree) return 'disputed';
  return 'awaiting';
}

/* ────────────────────────────────────────────────────────────────────────────
 * CE QUI BLOQUE LA ROTATION, DU POINT DE VUE DE L'ORGANISATEUR.
 *
 * Trois motifs, trois gestes différents — c'est pour ça qu'ils ne se
 * confondent pas en un seul « pas de score ».
 * ──────────────────────────────────────────────────────────────────────────── */

export type BlockedReason =
  /** Personne n'a lancé le chrono, et la rotation traîne depuis une durée de
   *  tour. Ces quatre-là n'ont eu AUCUNE sonnerie non plus. */
  | 'sans_chrono'
  /** Le chrono a tourné, le temps est passé, aucun score n'est rentré. */
  | 'muet'
  /** Les deux camps se contredisent. Seul un accord — ou l'organisateur —
   *  débloque ce terrain, et ça n'a pas de raison de s'arranger tout seul. */
  | 'litige';

export interface BlockedCourtInput {
  id: string;
  courtNo: number;
  /** `false` pour un bye : un repos n'attend aucun score. */
  hasOpponent: boolean;
  forfeitedTeam: string | null;
  confirmedAt: string | null;
  gamesA: number | null;
  startedAt: string | null;
  /** L'heure du tirage de la rotation — voir `sans_chrono`. */
  createdAt: string | null;
  teamAEntries: Pick<TournamentMatchEntry, 'games_a' | 'games_b'>[];
  teamBEntries: Pick<TournamentMatchEntry, 'games_a' | 'games_b'>[];
}

export interface BlockedCourt {
  id: string;
  courtNo: number;
  reason: BlockedReason;
}

/**
 * Ce terrain bloque-t-il la rotation, et pourquoi ? `null` s'il n'y a rien à
 * faire.
 *
 * MÊME RÈGLE QUE LE SERVEUR, pas une seconde lecture : un terrain bloque
 * quand son score n'est pas ACQUIS — aucune saisie, ou deux saisies
 * contraires — ce que `fn_tournament_score_acquis` dit côté SQL et ce que
 * `matchLiveStatus` dit ici. Un score PROVISOIRE (un seul camp a saisi) ne
 * bloque rien : il compte déjà, et le lister ferait relancer des gens qui ont
 * fait leur part. La condition précédente — « zéro saisie » — ratait tous les
 * désaccords, c'est-à-dire le seul état qui réclame vraiment l'organisateur.
 *
 * LE TEMPS SE COMPTE DEPUIS `startedAt ?? createdAt`, comme
 * `send_tournament_silent_courts`. Avec `startedAt` seul, un terrain dont
 * personne n'a appuyé sur « On commence » n'apparaissait JAMAIS — alors que
 * c'est le blocage le plus probable, et le seul que rien d'autre ne rattrape
 * (aucune sonnerie locale n'a pu être programmée non plus).
 *
 * Le DÉSACCORD, lui, se signale tout de suite : il n'y a pas de délai après
 * lequel deux scores contraires s'accorderaient d'eux-mêmes.
 */
export function blockedCourtReason(
  c: BlockedCourtInput, roundMinutes: number, now: number,
): BlockedReason | null {
  if (!c.hasOpponent) return null;
  const st = matchLiveStatus(true, c.forfeitedTeam, c.confirmedAt, c.teamAEntries, c.teamBEntries);
  if (st === 'forfeited' || st === 'confirmed') return null;
  if (st === 'disputed') return 'litige';
  if (c.gamesA != null) return null;             // provisoire : ne bloque rien
  const depart = c.startedAt ?? c.createdAt;
  if (!depart) return null;
  const fin = new Date(depart).getTime() + Math.max(0, roundMinutes) * 60_000;
  if (now < fin) return null;
  return c.startedAt ? 'muet' : 'sans_chrono';
}

/** Les terrains qui bloquent, triés par numéro — l'ordre du gymnase. */
export function blockedCourts(
  courts: BlockedCourtInput[], roundMinutes: number, now: number,
): BlockedCourt[] {
  return courts
    .map(c => {
      const reason = blockedCourtReason(c, roundMinutes, now);
      return reason ? { id: c.id, courtNo: c.courtNo, reason } : null;
    })
    .filter((c): c is BlockedCourt => c != null)
    .sort((a, b) => a.courtNo - b.courtNo);
}

/** La phrase d'un blocage — trois motifs, trois gestes. */
export function blockedCourtLabel(reason: BlockedReason): string {
  switch (reason) {
    case 'litige':      return 'les deux camps ne disent pas la même chose';
    case 'sans_chrono': return 'chrono jamais lancé, pas de score';
    case 'muet':        return 'pas de score';
  }
}

/** Refuse un score À ÉGALITÉ (et les valeurs hors bornes) CÔTÉ ÉCRAN, avant
 *  même d'appeler le serveur — miroir exact des trois premiers refus de
 *  `tournament_enter_score` (`invalid_score`, `score_out_of_range`,
 *  `draw_not_allowed`), dans le même ordre. Rend `null` tant qu'un des deux
 *  champs n'est pas encore rempli : ce n'est pas encore une erreur, juste une
 *  saisie incomplète. Le message vient TOUJOURS de `reasonLabel` — jamais une
 *  chaîne locale — pour rester le miroir exact du refus serveur. */
export function validateTournamentScore(gamesA: number | null, gamesB: number | null): string | null {
  if (gamesA == null || gamesB == null) return null;
  if (!Number.isInteger(gamesA) || !Number.isInteger(gamesB) || gamesA < 0 || gamesB < 0) {
    return reasonLabel('invalid_score');
  }
  if (gamesA > 20 || gamesB > 20) return reasonLabel('score_out_of_range');
  if (gamesA === gamesB) return reasonLabel('draw_not_allowed');
  return null;
}

/** Le classement — LA SEULE SOURCE, jamais un calcul local. `lib/tournament.ts`
 *  n'existe que pour la parité testée contre ce SQL (Task 6) ; il n'est appelé
 *  par AUCUN écran, et ne doit pas le devenir ici. `maxRound` omis = tous les
 *  matchs confirmés comptent (le classement courant de la soirée). */
export interface TournamentStanding {
  team_id: string;
  player1_id: string;
  player2_id: string;
  withdrawn: boolean;
  played: number;
  wins: number;
  losses: number;
  games_won: number;
  games_lost: number;
  games_avg: number;
  diff: number;
  best_court: number | null;
  h2h: number;
  rank: number;
}

/** Rend le `TournamentResult` BRUT — comme toute RPC, PAS un tableau tout
 *  fait. `ok:true` porte `standings` ; `ok:false` porte `reason`
 *  (`feature_disabled`, `tournament_not_found`, ou aucune raison sur un aléa
 *  réseau). Cette fonction n'avale JAMAIS un refus en `[]` : un échec — flag
 *  coupé en pleine soirée, réseau perdu — n'est PAS la même information
 *  qu'« aucun match acquis pour l'instant », et les confondre ferait lire à
 *  un joueur « rien n'a encore été joué » pendant une panne. L'appelant
 *  traite ce refus comme n'importe quel autre : `isFeatureDisabled(res)`,
 *  puis `resultMessage(res)` (donc `lib/tournamentReasons.ts`) si `!res.ok`. */
export function fetchStandings(
  tournamentId: string, maxRound?: number | null,
): Promise<TournamentResult> {
  return callTournamentRpc('tournament_standings', {
    p_tournament: tournamentId, p_max_round: maxRound ?? null,
  });
}

// ─── « Mon parcours » (Task 9) : l'historique et les cumuls d'UN joueur ──────
//
// ⚠️ `tournament_results` — une ligne PAR JOUEUR (PK `(tournament_id,
// player_id)`), les deux joueurs d'un binôme reçoivent LES MÊMES chiffres
// (en-tête de la table, tournaments.sql). Aucune déduplication par binôme à
// faire ici, contrairement au classement de la soirée (`seatedTeams`).
//
// ⚠️ IL N'Y A PAS DE COLONNE POUR LES DÉFAITES — le schéma le dit
// explicitement : elles se déduisent, `played - wins`, jamais stockées ni
// redemandées au serveur.
//
// ⚠️ QUAND UNE LIGNE COMPTE. `tournament_close` écrit `tournament_results` dès
// la clôture (statut TERMINE), mais les points ne sont crédités — et le
// tournoi n'entre dans « Mon parcours » — qu'au passage à CLASSEMENT_VALIDE
// par `tournament_validate` (en-têtes des deux fonctions, tournaments_rpcs.sql ;
// spec §14 : « Les points ne sont crédités et le tournoi n'apparaît dans Mon
// parcours qu'au passage à CLASSEMENT_VALIDE »). Un tournoi TERMINE mais pas
// encore validé ne compte donc PAS : le filtre se fait sur `tournament.status`,
// jamais en supposant qu'une ligne présente veut dire un tournoi validé.

/** Une ligne de `tournament_results`, avec le tournoi qui l'explique. Le
 *  filtre `tournament.status = CLASSEMENT_VALIDE` est un `!inner` join
 *  PostgREST (motif de `lib/notifications.ts`), pas un filtre appliqué après
 *  coup : une ligne dont le tournoi n'est pas validé n'est jamais rendue. */
export interface TournamentResultRow {
  tournament_id: string;
  team_id: string;
  final_rank: number;
  played: number;
  wins: number;
  games_won: number;
  games_lost: number;
  points: number;
  tournament: {
    id: string;
    name: string;
    starts_at: string;
    status: TournamentStatus;
    club: TournamentClub | null;
  };
}

/** L'historique COMPLET d'un joueur pour « Mon parcours » — RLS ouverte à
 *  tout authentifié (`tournament_results_read`, tournaments.sql), lue en
 *  direct : aucune RPC n'est dédiée à cet écran. Trié du plus récent au plus
 *  ancien, CÔTÉ CLIENT — l'ordre PostgREST sur une colonne de table jointe
 *  n'est pas un contrat assez sûr pour s'y fier sans pouvoir l'exécuter ici. */
export async function fetchMyTournamentResults(playerId: string): Promise<TournamentResultRow[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .from('tournament_results')
    .select(
      'tournament_id, team_id, final_rank, played, wins, games_won, games_lost, points, ' +
      'tournament:tournament_id!inner(id, name, starts_at, status, club:club_id(id, name, city))',
    )
    .eq('player_id', playerId)
    .eq('tournament.status', 'CLASSEMENT_VALIDE');
  if (error) throw error;
  const rows = (data ?? []) as unknown as TournamentResultRow[];
  return [...rows].sort((a, b) => b.tournament.starts_at.localeCompare(a.tournament.starts_at));
}

/** Les cumuls affichés en tête de « Mon parcours ». Pure : une simple somme
 *  des lignes déjà filtrées CLASSEMENT_VALIDE par `fetchMyTournamentResults` —
 *  rien ici ne revérifie le statut. */
export interface TournamentCareerTotals {
  tournamentsPlayed: number;
  matchesPlayed: number;
  wins: number;
  /** Déduites, jamais lues : `tournament_results` n'a pas de colonne pour ça. */
  losses: number;
  /** Arrondi à l'entier le plus proche ; 0 si aucun match joué (pas de division par zéro). */
  winPct: number;
  gamesWon: number;
  gamesLost: number;
  gamesDiff: number;
  /** `final_rank === 1`. */
  tournamentWins: number;
  /** `final_rank <= 3`. */
  podiums: number;
  /** La somme des points montante/descente crédités. */
  points: number;
}

export function computeCareerTotals(
  rows: Pick<TournamentResultRow, 'played' | 'wins' | 'games_won' | 'games_lost' | 'final_rank' | 'points'>[],
): TournamentCareerTotals {
  const matchesPlayed = rows.reduce((s, r) => s + r.played, 0);
  const wins = rows.reduce((s, r) => s + r.wins, 0);
  const gamesWon = rows.reduce((s, r) => s + r.games_won, 0);
  const gamesLost = rows.reduce((s, r) => s + r.games_lost, 0);
  const points = rows.reduce((s, r) => s + r.points, 0);
  return {
    tournamentsPlayed: rows.length,
    matchesPlayed,
    wins,
    losses: matchesPlayed - wins,
    winPct: matchesPlayed > 0 ? Math.round((wins / matchesPlayed) * 100) : 0,
    gamesWon,
    gamesLost,
    gamesDiff: gamesWon - gamesLost,
    tournamentWins: rows.filter(r => r.final_rank === 1).length,
    podiums: rows.filter(r => r.final_rank <= 3).length,
    points,
  };
}

// ─── Le classement FIGÉ d'un tournoi clos, pour SES PROPRES écrans ───────────
//
// ⚠️ NE PAS CONFONDRE avec `tournament_standings` (le classement VIVANT, trié
// abandon → palier → victoires → différence → jeux → confrontation) : sur un
// tournoi TERMINE ou CLASSEMENT_VALIDE, `tournament_close` a déjà FIGÉ les
// rangs et les points dans `tournament_results` aux CRÉNEAUX de la rotation de
// classement — une valeur DIFFÉRENTE du classement vivant, qui continue de
// trier sur les cumuls de la soirée. Les deux ne s'affichent jamais sous le
// même mot : un écran qui montre le rang d'un tournoi clos DOIT lire cette
// section, jamais `fetchStandings`.
//
// `fetchMyTournamentResults` (ci-dessus, Task 9) filtre déjà sur MON
// `player_id` ET `tournament.status = CLASSEMENT_VALIDE` — bon pour « Mon
// parcours », inutilisable pour afficher le classement ENTIER d'UN tournoi
// (la fiche, l'admin) : il faut TOUS les joueurs, et le lire dès TERMINE
// (avant validation, les rangs existent déjà — seuls les points n'ont pas
// encore compté, cf. `closeTournament`).

/** Une ligne de `tournament_results` pour UN tournoi entier — une ligne PAR
 *  JOUEUR (comme `TournamentResultRow`), sans filtre de statut : l'appelant
 *  connaît déjà le tournoi auquel il s'adresse. */
export interface TournamentResultTeamRow {
  tournament_id: string;
  team_id: string;
  player_id: string;
  final_rank: number;
  played: number;
  wins: number;
  games_won: number;
  games_lost: number;
  points: number;
}

/** Tout `tournament_results` d'UN tournoi — RLS ouverte à tout authentifié
 *  (même policy que `fetchMyTournamentResults`), lu en direct. */
export async function fetchTournamentResults(tournamentId: string): Promise<TournamentResultTeamRow[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .from('tournament_results')
    .select('tournament_id, team_id, player_id, final_rank, played, wins, games_won, games_lost, points')
    .eq('tournament_id', tournamentId);
  if (error) throw error;
  return (data ?? []) as unknown as TournamentResultTeamRow[];
}

/** Une ligne de `tournament_results` REGROUPÉE par binôme — pour l'affichage,
 *  qui montre un binôme, pas deux fois le même joueur. */
export interface TeamFinalResult {
  team_id: string;
  player_ids: [string, string];
  final_rank: number;
  played: number;
  wins: number;
  games_won: number;
  games_lost: number;
  points: number;
}

/** Regroupe les lignes PAR JOUEUR en une ligne PAR BINÔME, triée par rang. Les
 *  deux joueurs d'une équipe portent EXACTEMENT les mêmes chiffres (en-tête de
 *  la table, tournaments.sql) : regrouper ne fait que rassembler les deux
 *  `player_id`, ça ne recalcule jamais un rang ni un total. */
export function groupResultsByTeam(
  rows: Pick<TournamentResultTeamRow,
    'team_id' | 'player_id' | 'final_rank' | 'played' | 'wins' | 'games_won' | 'games_lost' | 'points'>[],
): TeamFinalResult[] {
  const byTeam = new Map<string, TeamFinalResult>();
  for (const r of rows) {
    const existing = byTeam.get(r.team_id);
    if (existing) {
      existing.player_ids = [existing.player_ids[0], r.player_id];
    } else {
      byTeam.set(r.team_id, {
        team_id: r.team_id, player_ids: [r.player_id, r.player_id], final_rank: r.final_rank,
        played: r.played, wins: r.wins, games_won: r.games_won, games_lost: r.games_lost, points: r.points,
      });
    }
  }
  return [...byTeam.values()].sort((a, b) => a.final_rank - b.final_rank);
}

// ─── L'organisation : créer, conduire, clôturer (Task 10) ────────────────────
//
// LES NEUF FONCTIONS SERVEUR DE CETTE SECTION SONT TOUTES RÉSERVÉES À
// L'ORGANISATEUR (`tournaments.created_by`, comparé à `current_player_id()`
// côté serveur — refus `not_the_organizer`). Aucune ne prend l'organisateur en
// paramètre : le sujet est toujours l'appelant, exactement comme
// `tournament_set_open_to_join`. Même enveloppe que le reste du fichier
// (`callTournamentRpc`) : un refus rend `{ok:false, reason}`, jamais une levée.

/** Le barème par défaut de la colonne `tournaments.points_scale` — recopié
 *  MOT POUR MOT du `DEFAULT` du schéma (tournaments.sql), pour préremplir le
 *  formulaire de création avec exactement ce que la base écrirait d'elle-même
 *  si la colonne n'était pas fournie. */
export const DEFAULT_POINTS_SCALE: Record<string, number> = {
  '1': 100, '2': 80, '3': 65, '4': 55, '5': 45, '6': 35, '7': 25, '8': 15,
};

/**
 * Le barème tel qu'il se lit sur la fiche : rang par rang, du premier au
 * dernier.
 *
 * ⚠️ Les clés de `points_scale` sont des CHAÎNES (c'est du jsonb). Un tri
 * naïf rangerait « 10 » entre « 1 » et « 2 » et la fiche annoncerait un
 * barème faux — d'où le tri numérique explicite.
 *
 * Retombe sur le défaut du schéma quand la colonne n'est pas lue : mieux
 * vaut le barème que la base écrirait d'elle-même qu'un bloc vide. Et ce qui
 * n'est pas un nombre est écarté plutôt qu'affiché — même raisonnement que la
 * CHECK côté serveur, qui refuse une valeur non numérique.
 */
export function pointsLadder(
  t: { points_scale?: Record<string, unknown> | null } | null | undefined,
): { rank: number; points: number }[] {
  const brut = t?.points_scale ?? DEFAULT_POINTS_SCALE;
  return Object.entries(brut)
    .map(([rang, pts]) => ({ rank: Number(rang), points: Number(pts) }))
    .filter(r => Number.isFinite(r.rank) && Number.isFinite(r.points))
    .sort((a, b) => a.rank - b.rank);
}

/**
 * « Validé automatiquement demain à 12:00 » — l'échéance, dite comme on la
 * compte.
 *
 * « Demain » plutôt qu'une date : entre la fin de la soirée et le lendemain
 * midi, c'est le seul repère qu'un joueur utilise vraiment. Au-delà, la date
 * redevient plus claire que « dans trois jours ».
 *
 * `null` quand il n'y a pas d'échéance : le tournoi n'est pas encore clos, ou
 * il est déjà validé. Ne rien dire vaut mieux qu'annoncer une heure inventée.
 */
export function autoValidateLabel(
  autoValidateAt: string | null | undefined, now: Date = new Date(),
): string | null {
  if (!autoValidateAt) return null;
  const d = new Date(autoValidateAt);
  if (Number.isNaN(d.getTime())) return null;

  const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  // Comparaison sur le JOUR CIVIL local, pas sur un écart de 24 h : une
  // échéance à midi est « demain » qu'on la lise à 20h ou à 23h59.
  const jour = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ecart = Math.round((jour(d) - jour(now)) / 86_400_000);

  if (ecart <= 0) return `Validé automatiquement aujourd’hui à ${heure}`;
  if (ecart === 1) return `Validé automatiquement demain à ${heure}`;
  return `Validé automatiquement le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à ${heure}`;
}

/**
 * La hauteur relative (0 à 1) de chaque barre de « Mon parcours ».
 *
 * ⚠️ Le sens, encore : un rang qui BAISSE est un meilleur résultat. Tracer
 * la hauteur sur le rang tel quel dessinerait la courbe à l'envers — la
 * soirée où l'on a fini dernier deviendrait le sommet du graphique.
 *
 * L'échelle est relative aux soirées affichées, pas à un nombre de binômes
 * fixe : on ne sait pas combien d'équipes comptait chaque tournoi passé, et
 * comparer un 4e sur 8 à un 4e sur 4 demanderait une donnée qu'on n'a pas.
 * Une seule soirée, ou plusieurs au même rang, occupent donc la hauteur
 * pleine — il n'y a rien à quoi les comparer, et les écraser au huitième
 * raconterait un échec qui n'a pas eu lieu.
 */
export function rankBarHeights(ranks: number[]): number[] {
  if (ranks.length === 0) return [];
  const pire = Math.max(...ranks);
  const meilleur = Math.min(...ranks);
  if (pire === meilleur) return ranks.map(() => 1);
  // Le pire rang garde un quart de hauteur : une barre nulle se lirait comme
  // une soirée non jouée.
  return ranks.map(r => 0.25 + 0.75 * ((pire - r) / (pire - meilleur)));
}

/** Miroir de la CHECK de `tournaments.points_scale` : aucune valeur négative
 *  (« un tournoi ne punit pas, il classe »). Pure, pour valider CÔTÉ ÉCRAN
 *  avant l'appel, comme `validateTournamentScore`. */
export function pointsScaleValid(scale: Record<string, number>): boolean {
  const entries = Object.values(scale);
  return entries.length > 0 && entries.every(n => Number.isFinite(n) && n >= 0);
}

export interface TournamentCreateInput {
  name: string;
  clubId: string | null;
  /** ISO — date ET heure, le tournoi se joue un soir donné. */
  startsAt: string;
  levelMin: number | null;
  levelMax: number | null;
  courtCount: number;
  roundCount: number;
  /** Durée d'une rotation, en minutes (5 à 60). */
  roundMinutes: number;
  priceMad: number;
  pointsScale: Record<string, number>;
  createdBy: string;
}

/** Crée un tournoi et le PUBLIE dans le même geste : statut
 *  `INSCRIPTIONS_OUVERTES` écrit directement, JAMAIS `BROUILLON` — c'est la
 *  RPC `tournament_create` (Task 11) qui l'écrit ainsi, pour la raison
 *  documentée dans son en-tête SQL : aucune fonction de `tournaments_rpcs.sql`
 *  ne fait jamais passer un tournoi de `BROUILLON` à `INSCRIPTIONS_OUVERTES`,
 *  un tournoi créé en `BROUILLON` resterait donc bloqué pour toujours —
 *  `fetchTournaments` l'exclut explicitement, et personne ne pourrait plus
 *  jamais s'y inscrire.
 *
 *  ⚠️ `ends_at` n'est écrit NI ICI NI PAR LA RPC, et ce n'est pas un oubli :
 *  `tournament_close` pose `ends_at = COALESCE(ends_at, now())`, une date
 *  posée à la création y SURVIVRAIT et afficherait une heure de fin ESTIMÉE
 *  plutôt que l'heure réelle du geste de clôture.
 *
 *  ⚠️ `input.createdBy` N'EST PAS envoyé à la RPC. Même moule que tout
 *  `tournaments_rpcs.sql` : le sujet d'une écriture n'est jamais un
 *  paramètre — `tournament_create` pose `created_by = current_player_id()`
 *  elle-même, à partir de la session authentifiée, jamais d'un argument
 *  fourni par l'appelant. Le champ reste dans `TournamentCreateInput` pour ne
 *  pas casser l'appelant (`admin.tsx` le remplit avec `myPlayerId`), mais il
 *  est ignoré ici comme côté serveur.
 *
 *  ⚠️ CE MODULE FAISAIT AUPARAVANT UN `INSERT` DIRECT sur `public.tournaments`.
 *  `tournaments` ne porte qu'une policy `SELECT` (`tournaments_read`) et
 *  AUCUNE policy `INSERT` : cet insert ÉCHOUAIT toujours (violation RLS)
 *  contre une vraie base. Appelle désormais `tournament_create` (Task 11),
 *  seule voie d'écriture sur cette table.
 *
 *  La RPC ne rend que `{ok:true, id}` — le moule du fichier SQL rend
 *  l'identifiant créé, jamais la ligne entière (voir son en-tête : « refus
 *  nommés... et rend l'identifiant créé »). Ce module RELIT donc le tournoi
 *  par son id pour continuer de rendre l'objet `Tournament` COMPLET
 *  qu'attend l'écran d'organisation, qui l'injecte directement dans sa liste
 *  locale sans second aller-retour réseau (`TournamentsTab.onCreated`,
 *  admin.tsx) — changer la forme du retour aurait donc cassé l'écran, alors
 *  que le point d'appel seul pouvait s'adapter.
 *
 *  Passe par `callTournamentRpc`, comme tous les autres appels de ce fichier
 *  — y compris son enveloppe des échecs de TRANSPORT (réseau, RPC introuvable)
 *  en `{ok:false}` SANS raison plutôt qu'une levée. Un refus, transport ou
 *  métier, devient donc ici une exception dont le message est DÉJÀ TRADUIT en
 *  français (`resultMessage`, donc `lib/tournamentReasons.ts` — un `reason`
 *  absent y rend le générique) — jamais un code brut ni l'erreur Postgres —
 *  puisque `TournamentCreateForm` (admin.tsx) l'affiche telle quelle dans son
 *  `Alert.alert('Erreur', ...)`. */
export async function createTournament(input: TournamentCreateInput): Promise<Tournament> {
  const result = await callTournamentRpc('tournament_create', {
    p_name: input.name,
    p_starts_at: input.startsAt,
    p_court_count: input.courtCount,
    p_round_count: input.roundCount,
    p_club_id: input.clubId,
    p_level_min: input.levelMin,
    p_level_max: input.levelMax,
    p_price_mad: input.priceMad,
    p_points_scale: input.pointsScale,
    p_round_minutes: input.roundMinutes,
  });
  if (!result.ok) throw new Error(resultMessage(result));

  const { supabase } = await import('./supabase');
  const { data: row, error } = await supabase
    .from('tournaments')
    .select(TOURNAMENT_COLS)
    .eq('id', result.id as string)
    .single();
  // Le tournoi EXISTE déjà à ce stade (la RPC ci-dessus a rendu `ok:true` et
  // un id) : un refus ICI n'est jamais « la création a échoué », seulement
  // « sa relecture a échoué ». Le dire tel quel — jamais l'erreur Postgres
  // brute (`error.message`), qui laisserait l'organisateur croire que rien
  // n'a été créé et recréer un second tournoi, avec sa propre liste d'inscrits.
  if (error) {
    console.warn('[tournois] tournament_create a réussi mais la relecture a échoué', error);
    throw new Error(
      'Le tournoi a bien été créé, mais son chargement a échoué juste après. ' +
      'Reviens à la liste avant de recommencer : il y figure déjà.',
    );
  }
  return row as unknown as Tournament;
}

// ⚠️ MISE À JOUR Task 13 : `public.tournament_generate_round(uuid)` — LA
// FAÇADE, seule exposée à `authenticated` — N'ACCEPTE QU'UN SEUL ARGUMENT.
// Le paramètre `p_final_round` n'existe plus que sur le MOTEUR
// (`fn_tournament_generate_round(uuid, boolean)`, en-tête SQL), désormais
// REVOQUÉ de `authenticated` : aucune ambiguïté de surcharge n'est donc
// atteignable depuis l'app, la façade appelle TOUJOURS le moteur avec
// `false`. `generateFinalTournamentRound` (`tournament_final_round`,
// ci-dessous) reste le SEUL chemin vers la dernière rotation — c'est elle qui
// porte les enjeux (`stakes`) que la dernière rotation doit afficher — mais
// elle y arrive en appelant le MOTEUR directement côté serveur, jamais en
// passant un second argument à cette façade-ci depuis le client.
// `nextRoundIsFinal` ci-dessous dit QUAND appeler `generateFinalTournamentRound`
// à la place de `generateTournamentRound`.
export function nextRoundIsFinal(currentRound: number, roundCount: number): boolean {
  return currentRound + 1 === roundCount;
}

/** Une entrée du refus `round_incomplete` de `tournament_generate_round` — DÉJÀ
 *  nommée par le serveur (le terrain, les deux binômes), pas seulement des
 *  identifiants que l'écran devrait résoudre lui-même. `entries` dit combien de
 *  joueurs ont saisi (0, 1 ou 2), `disputed` si les deux camps se contredisent :
 *  « personne n'a rien dit » et « litige » ne se règlent pas pareil. */
export interface TournamentMissingMatch {
  match_id: string;
  round_no: number;
  court_no: number;
  team_a: string;
  team_b: string;
  team_a_label: string | null;
  team_b_label: string | null;
  entries: number;
  disputed: boolean;
}

/** Une ligne lisible pour CE refus précis — jamais un identifiant nu à
 *  l'écran. « Un refus qui ne dit pas quoi corriger bloque la soirée. » */
export function missingMatchLabel(m: Pick<TournamentMissingMatch,
  'court_no' | 'team_a_label' | 'team_b_label' | 'entries' | 'disputed'>): string {
  const a = m.team_a_label ?? 'Équipe A';
  const b = m.team_b_label ?? 'Équipe B';
  const state = m.disputed
    ? 'litige : les deux camps se contredisent'
    : m.entries === 0
      ? 'aucune saisie'
      : 'un seul camp a saisi';
  return `Terrain ${m.court_no} — ${a} vs ${b} (${state})`;
}

/** Combien de matchs (réels ET byes, tous confondus) seraient détruits par
 *  `tournament_reopen_match` sur un match du tour `round` — port EXACT du
 *  `DELETE ... WHERE round_no > v_m.round_no` de son en-tête. L'écran le dit
 *  AVANT d'appeler, avec le nombre exact — jamais un « Êtes-vous sûr ? »
 *  générique. */
export function countLaterRoundMatches(
  matches: Pick<TournamentMatch, 'round_no'>[], round: number,
): number {
  return matches.filter(m => m.round_no > round).length;
}

/** Ouvrir le pointage — ORGANISATEUR seul, signature GELÉE
 *  (`tournament_open_check_in(uuid)`). `INSCRIPTIONS_OUVERTES`/`COMPLET` ->
 *  `CHECK_IN`. C'est ce qui rend `checkInToTournament` et `markNoShow`
 *  atteignables : sans ce geste, `CHECK_IN` n'est jamais écrit et le pointage
 *  reste en lecture seule pour tout le monde. */
export function openCheckIn(tournamentId: string): Promise<TournamentResult> {
  return callTournamentRpc('tournament_open_check_in', { p_tournament: tournamentId });
}

/** Marquer un AUTRE joueur absent — ORGANISATEUR seul, signature GELÉE
 *  (`tournament_mark_no_show(uuid, uuid)`). Pendant organisateur de
 *  `checkInToTournament` (le joueur, sur lui-même) : « qui est là, qui
 *  manque ». N'écrase jamais un `checked_in` par erreur : ce geste ne fait
 *  que déclarer absent, jamais présent. */
export function markNoShow(tournamentId: string, playerId: string): Promise<TournamentResult> {
  return callTournamentRpc('tournament_mark_no_show', { p_tournament: tournamentId, p_player: playerId });
}

/** Apparier, au check-in, les joueurs restés seuls. N'apparie QUE les ASSIS
 *  (jamais la liste d'attente), et REFUSE en `INSCRIPTIONS_OUVERTES` — elle
 *  exige `COMPLET`, `CHECK_IN` ou `PRET` (en-tête de `tournament_autopair`),
 *  contrairement à `startTournament` qui accepte les quatre. L'écran doit
 *  refléter cette asymétrie, pas la découvrir en pratique (`tournament_not_open`). */
export function autopairTournament(tournamentId: string): Promise<TournamentResult> {
  return callTournamentRpc('tournament_autopair', { p_tournament: tournamentId });
}

/** Le coup d'envoi. Accepte `INSCRIPTIONS_OUVERTES`, `COMPLET`, `CHECK_IN` ET
 *  `PRET` — c'est ELLE, pas `autopairTournament`, qui sert de « lancer quand
 *  même » : rien ici n'exige que le check-in soit complet, ni même commencé. */
export function startTournament(tournamentId: string): Promise<TournamentResult> {
  return callTournamentRpc('tournament_start', { p_tournament: tournamentId });
}

/** Tire la rotation suivante — TOUJOURS À UN SEUL ARGUMENT (cf. la note
 *  au-dessus de `nextRoundIsFinal`). Refuse la DERNIÈRE rotation
 *  (`not_the_final_round`) : c'est `generateFinalTournamentRound` qui la tire.
 *  Refuse aussi `round_incomplete`, avec la liste `missing`
 *  (`TournamentMissingMatch[]`) que `missingMatchLabel` traduit. */
export function generateTournamentRound(tournamentId: string): Promise<TournamentResult> {
  return callTournamentRpc('tournament_generate_round', { p_tournament: tournamentId });
}

/** LA rotation de classement — la dernière, celle qui fige les places et rend
 *  `stakes` (l'enjeu de chaque terrain : quelles places s'y jouent). Seule
 *  appelante légitime du second argument de `tournament_generate_round`,
 *  qu'elle passe elle-même — cette fonction-ci n'en prend aucun.
 *
 *  ⚠️ `stakes`, DANS CETTE RÉPONSE, N'EST QU'UN CONFORT IMMÉDIAT — capturé par
 *  l'écran organisateur pour éviter un aller-retour réseau juste après l'avoir
 *  tirée. Ce n'est PLUS le seul chemin (Task 13, défaut trouvé en relecture de
 *  branche) : `fetchFinalStakes` ci-dessous lit la MÊME information de façon
 *  DURABLE, via `tournament_final_stakes` — n'importe quel joueur, à tout
 *  moment, y compris après un rechargement d'écran. Un appelant qui veut
 *  l'ENJEU (plutôt que le résultat du tirage lui-même) doit préférer
 *  `fetchFinalStakes` ; seul l'écran organisateur garde une raison d'utiliser
 *  `stakes` de CETTE réponse-ci, comme accélérateur d'affichage juste après le
 *  tirage. `stakeLabel` ci-dessous ne fait que TRADUIRE une ligne déjà
 *  tranchée par le serveur, quelle que soit sa provenance — jamais recalculer
 *  un rang. */
export function generateFinalTournamentRound(tournamentId: string): Promise<TournamentResult> {
  return callTournamentRpc('tournament_final_round', { p_tournament: tournamentId });
}

/** L'ENJEU de la rotation de classement, EN LECTURE DURABLE — port de
 *  `tournament_final_stakes` (Task 13). Corrige le trou que
 *  `generateFinalTournamentRound` documentait sans pouvoir le combler tout
 *  seul : `stakes` n'y existait QUE dans SA réponse, perdu au premier
 *  rechargement d'écran et invisible à tout joueur qui n'était pas
 *  l'organisateur au moment précis de l'appel — alors que « Terrain 2, places
 *  3 et 4 » est le fait le plus important de la soirée.
 *
 *  MÊME MOULE que `fetchStandings` : ouverte à TOUT joueur authentifié,
 *  `ok:true` porte `drawn` (la rotation de classement a-t-elle été tirée ?) et
 *  `stakes` (vide tant que non tirée) — `drawn:false` le dit EXPLICITEMENT,
 *  jamais confondu avec « tirée, mais rien à annoncer » ni avec un refus. Un
 *  refus (`feature_disabled`, `tournament_not_found`, ou aucune raison sur un
 *  aléa réseau) reste un refus, jamais avalé en tableau vide — même
 *  raisonnement que `fetchStandings`. */
export function fetchFinalStakes(tournamentId: string): Promise<TournamentResult> {
  return callTournamentRpc('tournament_final_stakes', { p_tournament: tournamentId });
}

/** Une ligne de `stakes`, rendue par `tournament_final_round` : l'enjeu d'UN
 *  terrain de la rotation de classement. `rank_win`/`rank_lose` NULS pour un
 *  bye qui partage son palier avec un match : ce terrain-là ne dispute
 *  aucune place, `stakeLabel` ne dit alors rien plutôt que d'inventer un
 *  enjeu. */
export interface TournamentStake {
  match_id: string;
  court_no: number;
  team_a: string;
  team_b: string | null;
  rank_win: number | null;
  rank_lose: number | null;
}

/** « Places 3 et 4 en jeu » — la traduction d'UNE ligne de `stakes`, jamais un
 *  calcul de rang. `null` quand le serveur n'a rien à annoncer pour ce
 *  terrain (bye au même palier qu'un match). */
export function stakeLabel(s: Pick<TournamentStake, 'rank_win' | 'rank_lose'>): string | null {
  if (s.rank_win != null && s.rank_lose != null) return `Places ${s.rank_win} et ${s.rank_lose} en jeu`;
  if (s.rank_win != null) return `Place ${s.rank_win} en jeu`;
  return null;
}

/** Trancher un litige. MÊME CONTRAT D'ORIENTATION que `enterTournamentScore` :
 *  `gamesA` est TOUJOURS le score de `team_a` DU MATCH — l'écran nomme les
 *  deux camps, jamais « vous / eux ». Passer par `validateTournamentScore`
 *  côté écran avant l'appel, comme la saisie joueur (mêmes trois refus, même
 *  ordre : `invalid_score`, `score_out_of_range`, `draw_not_allowed`). */
export function resolveTournamentDispute(
  matchId: string, gamesA: number, gamesB: number,
): Promise<TournamentResult> {
  return callTournamentRpc('tournament_resolve_dispute', {
    p_match: matchId, p_games_a: gamesA, p_games_b: gamesB,
  });
}

/** Déclarer un binôme forfait. IRRÉVERSIBLE : aucun chemin ne le défait — un
 *  match soldé par un forfait refuse même `reopenTournamentMatch`
 *  (`forfeited_match`). L'écran doit le dire AVANT d'appeler, avec la même
 *  franchise que pour la réouverture. */
export function forfeitTournamentTeam(tournamentId: string, teamId: string): Promise<TournamentResult> {
  return callTournamentRpc('tournament_forfeit', { p_tournament: tournamentId, p_team: teamId });
}

/** « On commence » — le chrono de CE terrain part. N'importe lequel des quatre
 *  joueurs, et deux appuis simultanés rendent la même heure (`already:true`),
 *  jamais un refus : c'est le cas normal, pas une erreur. */
export function startCourtMatch(matchId: string): Promise<TournamentResult> {
  return callTournamentRpc('tournament_start_match', { p_match: matchId });
}

/** Quelqu'un a appuyé trop tôt. Refusé dès qu'un score existe. */
export function resetCourtStart(matchId: string): Promise<TournamentResult> {
  return callTournamentRpc('tournament_reset_match_start', { p_match: matchId });
}

/** Rouvrir un score acquis — le SEUL chemin qui en défasse un. DÉTRUIT tous
 *  les tours POSTÉRIEURS (matchs, mouvements, saisies) : `countLaterRoundMatches`
 *  donne ce nombre AVANT l'appel, pour que l'écran le dise en toutes lettres,
 *  pas un « Êtes-vous sûr ? » générique. Refuse un match forfait
 *  (`forfeited_match`) : un forfait ne se rouvre pas ici. */
export function reopenTournamentMatch(matchId: string): Promise<TournamentResult> {
  return callTournamentRpc('tournament_reopen_match', { p_match: matchId });
}

/** La clôture — fige `tournament_results` (rang, stats, points) et passe le
 *  tournoi TERMINE. Les points ne comptent PAS encore : seule
 *  `validateTournament` les crédite et fait entrer le tournoi dans
 *  « Mon parcours » de chaque joueur. */
export function closeTournament(tournamentId: string): Promise<TournamentResult> {
  return callTournamentRpc('tournament_close', { p_tournament: tournamentId });
}

/** Le dernier geste : TERMINE → CLASSEMENT_VALIDE. Un ACCORD, pas un calcul —
 *  rien n'est recalculé ici, `tournament_close` a déjà tout figé. */
export function validateTournament(tournamentId: string): Promise<TournamentResult> {
  return callTournamentRpc('tournament_validate', { p_tournament: tournamentId });
}

// ─── Réversibilité et annulation (Task 13) ───────────────────────────────────
//
// Trois fonctions serveur livrées par la vague serveur (Task 12) mais jamais
// branchées : les remèdes aux états sans sortie trouvés en relecture de
// branche. Même moule que le reste de cette section — ORGANISATEUR seul,
// aucun paramètre « organisateur » (le sujet est toujours l'appelant côté
// serveur), refus `{ok:false, reason}` jamais une levée.

/** L'ORGANISATEUR ABANDONNE LA SOIRÉE — IRRÉVERSIBLE. N'importe quel état non
 *  validé → `ANNULE`, terminal (signature GELÉE `tournament_cancel(uuid)`,
 *  en-tête SQL). C'est la SORTIE UNIVERSELLE : un tournoi bloqué (check-in
 *  sans binôme, forfaits en cascade avant le premier tirage…) doit toujours
 *  pouvoir être abandonné. Refuse `already_validated`
 *  (`CLASSEMENT_VALIDE` : les points sont déjà crédités, annuler laisserait
 *  des points sans tournoi pour les justifier) et `already_cancelled`. */
export function cancelTournament(tournamentId: string): Promise<TournamentResult> {
  return callTournamentRpc('tournament_cancel', { p_tournament: tournamentId });
}

/** L'ORGANISATEUR ROUVRE LES INSCRIPTIONS — `CHECK_IN`/`PRET` → le statut de
 *  capacité réel (`INSCRIPTIONS_OUVERTES` ou `COMPLET`). RÉVERSIBLE, à
 *  l'inverse de `cancelTournament` : le remède au pointage ouvert trop tôt,
 *  qui laissait le tournoi bloqué en `CHECK_IN` pour toujours, incapable de
 *  recevoir le binôme manquant (en-tête SQL de `tournament_reopen_registrations`).
 *  Ne touche à AUCUNE inscription, AUCUN binôme, AUCUN jeton de check-in —
 *  seul le statut de capacité change. */
export function reopenTournamentRegistrations(tournamentId: string): Promise<TournamentResult> {
  return callTournamentRpc('tournament_reopen_registrations', { p_tournament: tournamentId });
}

/** L'ORGANISATEUR RETIRE UNE INSCRIPTION — IRRÉVERSIBLE (signature GELÉE
 *  `tournament_remove_registration(uuid, uuid)`). Le SEUL recours contre un
 *  inscrit qui ajoute un tiers sans son accord (`tournament_register(...,
 *  p_partner)` le permet) : sans ce geste, l'organisateur ne pouvait rien
 *  faire pour libérer ce siège. Même suite exacte que `withdrawFromTournament`
 *  (binôme éventuel défait, file avancée, capacité synchronisée) — seul le
 *  SUJET (un paramètre, pas l'appelant) et le garde d'autorité diffèrent.
 *  Refuse `matches_already_generated` : une fois le tableau publié, le recours
 *  de l'organisateur devient `forfeitTournamentTeam`, qui SOLDE plutôt que de
 *  RETIRER. */
export function removeTournamentRegistration(tournamentId: string, playerId: string): Promise<TournamentResult> {
  return callTournamentRpc('tournament_remove_registration', { p_tournament: tournamentId, p_player: playerId });
}

/** TOUS les matchs d'un tournoi, tous tours confondus — ce que
 *  `countLaterRoundMatches` compte avant une réouverture, et l'historique
 *  complet de la soirée pour l'organisateur. `fetchRoundMatches` (Task 8) ne
 *  lit qu'UN tour ; cette fonction existe pour ce que Task 8 n'avait pas
 *  besoin de voir. */
export async function fetchTournamentMatches(tournamentId: string): Promise<TournamentMatch[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .from('tournament_matches')
    .select(TOURNAMENT_MATCH_COLS)
    .eq('tournament_id', tournamentId)
    .order('round_no', { ascending: true })
    .order('court_no', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as TournamentMatch[];
}

/**
 * Prévient à chaque changement d'un match de ce tournoi — score saisi, ou
 * rotation suivante tirée (de nouveaux matchs sont insérés).
 *
 * POURQUOI : depuis tournament_auto_advance.sql, la rotation suivante part
 * TOUTE SEULE quand le dernier terrain saisit. Sans abonnement, l'écran de
 * soirée des trente autres joueurs restait sur l'ancienne rotation jusqu'à ce
 * qu'on le rouvre — on aurait joué sur le mauvais terrain.
 *
 * Ne marche que si `tournament_matches` est dans la publication
 * `supabase_realtime` (ajoutée par cette même migration). Avant, l'abonnement
 * ne reçoit simplement rien : aucune erreur, l'écran se contente de ne pas
 * bouger — d'où le rechargement manuel qui reste possible.
 *
 * Le client Supabase est importé dynamiquement, comme partout dans ce module :
 * les tests purs n'ont pas à charger les variables d'environnement.
 */
export function subscribeTournamentMatches(
  tournamentId: string,
  onChange: () => void,
  /** Appelé à CHAQUE fois que le canal s'ouvre — la première, et après chaque
   *  reconnexion. Deux minutes de réseau mort au club, et les changements
   *  survenus pendant la coupure ne sont JAMAIS rejoués par le temps réel :
   *  sans ce rappel, l'écran reste sur la rotation précédente, et quatre
   *  joueurs vont sur le mauvais terrain. */
  onSubscribed?: () => void,
): () => void {
  let channel: any = null;
  let fini = false;
  const suffix = Math.random().toString(36).slice(2, 8);
  import('./supabase').then(({ supabase }) => {
    if (fini) return;
    channel = supabase
      .channel(`tournament-matches:${tournamentId}:${suffix}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'tournament_matches', filter: `tournament_id=eq.${tournamentId}` },
        () => onChange())
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED' && !fini) onSubscribed?.();
      });
  });
  return () => {
    fini = true;
    if (channel) import('./supabase').then(({ supabase }) => supabase.removeChannel(channel));
  };
}

/**
 * La soirée qui se joue MAINTENANT, et dans laquelle j'ai une place.
 *
 * Pendant une rotation de vingt minutes, le chemin vers la saisie passait par
 * l'accueil, l'onglet Tournois, la fiche, puis le mode soirée. Quatre gestes,
 * six fois dans la soirée. Cette fonction permet à l'accueil de poser un
 * raccourci direct, sans requête supplémentaire : les tournois et les
 * inscriptions y sont déjà chargés pour la section « Tournois ouverts ».
 *
 * TROIS REFUS, et chacun évite une promesse en l'air :
 *
 *   * les statuts où RIEN ne se joue encore. `CHECK_IN` et `PRET` sont
 *     inclus — on est au club, c'est le moment où le raccourci sert le plus ;
 *   * une inscription en LISTE D'ATTENTE : sans siège, il n'y a pas de
 *     terrain à rejoindre, et la bannière enverrait vers un écran qui dirait
 *     « tu ne joues pas cette rotation » ;
 *   * les tournois où je ne suis pas inscrit du tout — un tournoi public en
 *     cours ne me concerne pas.
 *
 * S'il y en a plusieurs (ça ne devrait pas arriver), le plus proche dans le
 * temps gagne : `fetchTournaments` trie déjà par `starts_at`.
 */
export function myLiveTournament(
  tournaments: Tournament[],
  regs: Pick<TournamentRegistration, 'tournament_id' | 'player_id' | 'waitlist_position'>[],
  myId: string,
  now: Date = new Date(),
): Tournament | null {
  const assis = new Set(
    regs.filter(r => r.player_id === myId && r.waitlist_position == null)
        .map(r => r.tournament_id),
  );
  return tournaments.find(t =>
    (t.status === 'EN_COURS' || t.status === 'CHECK_IN' || t.status === 'PRET')
    // Reste en pointage ou pret sans jamais etre lance, et la soiree est
    // passee : la banniere « c'est ce soir » s'afficherait indefiniment. Un
    // tournoi EN_COURS n'est pas concerne -- il se joue, meme en retard.
    && !isExpiredUnstarted(t, now)
    && assis.has(t.id)) ?? null;
}

// ── Accueil : quel tournoi mérite une place sur l'écran d'accueil ───────────
//
// ── Sélection de la date et de l'heure (formulaire de création) ─────────────
//
// Deux fonctions pures, ici plutôt que dans le composant : ce sont elles qui
// peuvent se tromper en silence (un décalage d'un jour, un mois de 28 jours,
// un changement d'heure), et une erreur de calendrier ne se voit pas à l'œil.
// Le rendu, lui, se voit.

/**
 * La grille d'un mois, semaines commençant le LUNDI (convention française) :
 * six lignes de sept cases, `null` pour les cases hors du mois.
 *
 * `month0` est l'indice JavaScript du mois — 0 = janvier.
 */
export function monthMatrix(year: number, month0: number): (number | null)[][] {
  const premier = new Date(year, month0, 1);
  // getDay() rend 0 pour dimanche ; on décale pour que lundi vaille 0.
  const decalage = (premier.getDay() + 6) % 7;
  const joursDuMois = new Date(year, month0 + 1, 0).getDate();

  const cases: (number | null)[] = [
    ...Array<null>(decalage).fill(null),
    ...Array.from({ length: joursDuMois }, (_, i) => i + 1),
  ];
  while (cases.length % 7 !== 0) cases.push(null);

  const lignes: (number | null)[][] = [];
  for (let i = 0; i < cases.length; i += 7) lignes.push(cases.slice(i, i + 7));
  return lignes;
}

/** `2026-09-04` — le format que le formulaire assemble avec l'heure. */
export function isoDay(year: number, month0: number, day: number): string {
  return `${year}-${String(month0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Les créneaux horaires proposés, du plus tôt au plus tard, par pas fixe.
 * Une liste plutôt qu'une saisie libre : personne ne joue à 19h07, et un
 * champ texte laisse passer « 25:00 » ou « 7h ».
 */
export function timeSlots(fromHour = 8, toHour = 23, stepMin = 30): string[] {
  const out: string[] = [];
  for (let m = fromHour * 60; m <= toHour * 60 + (60 - stepMin); m += stepMin) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return out;
}

/**
 * Le barème par défaut pour `teams` binômes — `teamCount(court_count)`.
 *
 * Les huit premières valeurs sont celles du règlement (100 → 15) et ne bougent
 * pas : c'est le format de référence. Au-delà, la décroissance continue de 1
 * en 1 — donc STRICTEMENT décroissante jusqu'au rang 22, soit onze terrains.
 *
 * Elle ne peut pas l'être plus loin : le serveur accepte 20 terrains (40
 * binômes), et sous 15 points il ne reste que quatorze entiers positifs. Un
 * barème de 40 rangs strictement décroissant sous un plafond de 15 n'existe
 * pas. Au-delà du rang 22 tout le monde vaut 1 point — un format qui n'a
 * jamais existé, et l'organisateur peut de toute façon tout réécrire.
 *
 * Pourquoi ça compte : `fn_tournament_points` retient le plus grand rang du
 * barème inférieur ou égal au rang obtenu. Un barème à huit entrées sur un
 * tournoi à dix binômes donnait donc 15 points aux 8ᵉ, 9ᵉ ET 10ᵉ — trois ex
 * æquo créés en silence, sans que rien ne le signale.
 */
export function defaultPointsScale(teams: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (let rang = 1; rang <= Math.max(1, teams); rang++) {
    out[String(rang)] = rang <= 8
      ? DEFAULT_POINTS_SCALE[String(rang)]
      : Math.max(1, 15 - (rang - 8));
  }
  return out;
}

/**
 * Le barème redimensionné quand l'organisateur change le nombre de terrains,
 * en gardant ce qu'il a déjà saisi pour les rangs qui existent encore.
 *
 * Les valeurs sont des chaînes : c'est l'état du formulaire, pas le barème
 * envoyé au serveur.
 */
export function resizePointsScale(
  actuel: Record<string, string>,
  teams: number,
): Record<string, string> {
  const base = defaultPointsScale(teams);
  const out: Record<string, string> = {};
  for (const rang of Object.keys(base)) {
    out[rang] = actuel[rang] ?? String(base[rang]);
  }
  return out;
}

// ── Section « Tournois ouverts » de l'accueil (handoff design 1C) ───────────

/** Où j'en suis sur une soirée — c'est l'état qui change ce que dit la carte. */
export type HomeTournamentState = 'open' | 'registered' | 'waitlisted';

/**
 * « J-7 », « DEMAIN », « CE SOIR » — la pastille d'échéance de la maquette.
 *
 * Le compte est en JOURS DE CALENDRIER, pas en multiples de 24 h : un tournoi
 * demain à 9h est « DEMAIN », même s'il est dans 15 heures.
 */
export function daysUntilLabel(iso: string, now: Date = new Date()): string {
  const bucket = dateBucket(iso, now);
  if (bucket === 'today') return 'CE SOIR';
  if (bucket === 'tomorrow') return 'DEMAIN';

  const a = new Date(now); a.setHours(0, 0, 0, 0);
  const b = new Date(iso); b.setHours(0, 0, 0, 0);
  const jours = Math.round((b.getTime() - a.getTime()) / 86_400_000);
  return jours > 0 ? `J-${jours}` : 'PASSÉ';
}

/**
 * « DOUBLE · NIV. 3-5 » — la ligne de format de la carte, en majuscules.
 * Version courte de `levelRangeLabel`, qui est faite pour une phrase.
 */
export function shortFormatLabel(min: number | null, max: number | null): string {
  const f = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const niv =
    min != null && max != null ? `NIV. ${f(min)}-${f(max)}`
    : min != null ? `NIV. ${f(min)}+`
    : max != null ? `NIV. ${f(max)} MAX`
    : 'TOUS NIVEAUX';
  return `DOUBLE · ${niv}`;
}

/** Une soirée telle que la section d'accueil la consomme. */
export interface HomeTournamentEntry {
  tournament: Tournament;
  /** Places PRISES et TOTAL, en joueurs — l'unité de toute l'app. */
  taken: number;
  total: number;
  state: HomeTournamentState;
}

/**
 * Les soirées à venir, de la plus proche à la plus lointaine, avec où j'en
 * suis sur chacune.
 *
 * Contrairement à la première version de l'accueil, on ne réduit plus à une
 * seule : la maquette montre un carrousel, et un joueur déjà inscrit à jeudi
 * doit voir qu'une autre soirée cherche des joueurs.
 */
export function homeTournamentList(
  tournaments: Tournament[],
  regsByTournament: Map<string, TournamentRegistration[]>,
  myId: string,
  now: Date = new Date(),
): HomeTournamentEntry[] {
  return tournaments
    // Un tournoi jamais lance dont la soiree aurait deja du finir n'est plus
    // « a venir » : le montrer inviterait a s'inscrire a une soiree morte.
    .filter(t => tournamentPhase(t.status) === 'upcoming' && !isExpiredUnstarted(t, now))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map(t => {
      const regs = regsByTournament.get(t.id) ?? [];
      const moi = regs.find(r => r.player_id === myId);
      return {
        tournament: t,
        taken: seatsTaken(regs),
        total: seatCount(t.court_count),
        state: (!moi ? 'open' : moi.waitlist_position != null ? 'waitlisted' : 'registered') as HomeTournamentState,
      };
    });
}

/**
 * Un tournoi JAMAIS LANCÉ dont la soirée aurait déjà dû se terminer.
 *
 * Aucune liste ne regardait la date : l'accueil et l'onglet « À venir » ne
 * filtraient que sur le statut. Un tournoi que personne n'a démarré restait
 * donc proposé indéfiniment, inscription comprise — une soirée morte
 * présentée comme ouverte.
 *
 * LE REPÈRE EST LA FIN PRÉVUE + UNE DEMI-HEURE, PAS L'HEURE DE DÉBUT. Une
 * montante commence rarement à l'heure pile : on arrive, on pointe. Couper à
 * `starts_at` ferait disparaître le tournoi en plein pointage, sous les yeux
 * des joueurs. Et même la fin prévue est trop tôt (demande de l'utilisateur,
 * 2026-09-14) : une soirée lancée en retard déborde d'autant, on ne fait pas
 * disparaître un tournoi qu'on est peut-être en train de lancer. D'où
 * `EXPIRY_GRACE_MINUTES` ajoutée à la fin prévue.
 *
 * `ends_at` ne sert pas : il n'est écrit qu'à la clôture, donc vide avant le
 * lancement. La fin prévue se calcule : début + rotations × durée.
 *
 * Ne concerne que les statuts d'AVANT le lancement (`tournamentPhase` =
 * « upcoming »). Un tournoi en cours, terminé ou annulé n'est jamais
 * « expiré » ici. Une date illisible rend `false` : on ne fait pas
 * disparaître une donnée sur une erreur de lecture.
 *
 * Les écrans ADMIN ne l'utilisent pas, volontairement : c'est là que
 * l'organisateur retrouve ce tournoi pour l'annuler.
 */
export function isExpiredUnstarted(
  t: Pick<Tournament, 'status' | 'starts_at' | 'round_count' | 'round_minutes'>,
  now: Date = new Date(),
): boolean {
  if (tournamentPhase(t.status) !== 'upcoming') return false;
  const debut = new Date(t.starts_at).getTime();
  if (Number.isNaN(debut)) return false;
  const limite = debut
    + (totalDurationMinutes(t.round_count, roundMinutesOf(t)) + EXPIRY_GRACE_MINUTES) * 60_000;
  return now.getTime() > limite;
}

/**
 * La marge accordée APRÈS l'heure de fin supposée d'une soirée, en minutes,
 * avant de cacher un tournoi jamais lancé (`isExpiredUnstarted`).
 *
 * Demandée par l'utilisateur (2026-09-14) : la fin supposée seule est trop
 * juste — une soirée lancée en retard déborde d'autant. Nommée plutôt que
 * noyée dans le calcul, pour qu'on la retrouve et qu'on la règle à un seul
 * endroit.
 */
export const EXPIRY_GRACE_MINUTES = 30;

// ── Filtres de la liste (handoff design, chantier 3) ───────────────────────
//
// Tout se fait CÔTÉ CLIENT : `fetchTournaments` remonte déjà tout, trié par
// date. Aucun changement serveur, et les filtres se combinent sans aller-retour.

export interface TournamentFilters {
  /** Ne garder que les soirées dont la plage de niveau m'accepte. */
  level: boolean;
  /** Samedi et dimanche qui viennent. */
  weekend: boolean;
  /** L'identifiant d'un club, ou null. */
  clubId: string | null;
  /** Ne garder que celles où il reste une place immédiate. */
  free: boolean;
}

export const NO_FILTERS: TournamentFilters = { level: false, weekend: false, clubId: null, free: false };

export function activeFilterCount(f: TournamentFilters): number {
  return (f.level ? 1 : 0) + (f.weekend ? 1 : 0) + (f.clubId ? 1 : 0) + (f.free ? 1 : 0);
}

/** Le libellé du filtre, tel qu'on le montre quand on propose de le retirer. */
export function filterLabel(key: keyof TournamentFilters, clubName?: string | null): string {
  if (key === 'level') return 'Mon niveau';
  if (key === 'weekend') return 'Ce week-end';
  if (key === 'clubId') return clubName ?? 'Ce club';
  return 'Places libres';
}

/** Vrai si `level` tombe dans la plage du tournoi — une borne absente n'exclut rien. */
export function levelAccepted(t: Tournament, level: number | null): boolean {
  if (level == null) return true;
  if (t.level_min != null && level < t.level_min) return false;
  if (t.level_max != null && level > t.level_max) return false;
  return true;
}

/** Samedi ou dimanche de la semaine en cours (au plus 7 jours devant). */
export function isThisWeekend(iso: string, now: Date = new Date()): boolean {
  const d = new Date(iso);
  const jour = d.getDay();               // 0 = dimanche, 6 = samedi
  if (jour !== 0 && jour !== 6) return false;
  const dans = (d.getTime() - now.getTime()) / 86_400_000;
  return dans >= -1 && dans <= 7;
}

export interface FilterContext {
  /** Mon niveau, pour le filtre « Mon niveau ». */
  myLevel: number | null;
  /** Les places libres par tournoi — zéro dès qu'une file existe. */
  freeById: Map<string, number>;
  now?: Date;
}

/** Pourquoi un tournoi est masqué — le PREMIER filtre qui le recale. */
export type HiddenReason = 'level' | 'weekend' | 'clubId' | 'free';

export function tournamentPassesFilters(
  t: Tournament, f: TournamentFilters, ctx: FilterContext,
): HiddenReason | null {
  if (f.level && !levelAccepted(t, ctx.myLevel)) return 'level';
  if (f.weekend && !isThisWeekend(t.starts_at, ctx.now)) return 'weekend';
  if (f.clubId && t.club_id !== f.clubId) return 'clubId';
  if (f.free && (ctx.freeById.get(t.id) ?? 0) <= 0) return 'free';
  return null;
}

export interface FilterOutcome<T> {
  kept: T[];
  hidden: { item: T; reason: HiddenReason }[];
}

export function filterTournaments<T extends { tournament: Tournament }>(
  entries: T[], f: TournamentFilters, ctx: FilterContext,
): FilterOutcome<T> {
  const kept: T[] = [];
  const hidden: { item: T; reason: HiddenReason }[] = [];
  for (const e of entries) {
    const reason = tournamentPassesFilters(e.tournament, f, ctx);
    if (reason) hidden.push({ item: e, reason }); else kept.push(e);
  }
  return { kept, hidden };
}

/**
 * Le filtre qui, retiré SEUL, révèle le plus de soirées — et combien.
 *
 * C'est ce qui permet de ne jamais laisser l'utilisateur dans un cul-de-sac :
 * plutôt qu'un « aucun résultat », on lui montre la sortie la plus rentable.
 * `null` quand aucun retrait ne révèle rien.
 */
export function bestFilterToDrop<T extends { tournament: Tournament }>(
  entries: T[], f: TournamentFilters, ctx: FilterContext,
): { key: keyof TournamentFilters; unlocked: number } | null {
  const base = filterTournaments(entries, f, ctx).kept.length;
  let best: { key: keyof TournamentFilters; unlocked: number } | null = null;

  const essais: { key: keyof TournamentFilters; sans: TournamentFilters }[] = [
    { key: 'level',   sans: { ...f, level: false } },
    { key: 'weekend', sans: { ...f, weekend: false } },
    { key: 'clubId',  sans: { ...f, clubId: null } },
    { key: 'free',    sans: { ...f, free: false } },
  ];

  for (const { key, sans } of essais) {
    // Ne proposer que le retrait d'un filtre RÉELLEMENT actif.
    if (key === 'clubId' ? !f.clubId : !f[key as 'level' | 'weekend' | 'free']) continue;
    const gain = filterTournaments(entries, sans, ctx).kept.length - base;
    if (gain > 0 && (!best || gain > best.unlocked)) best = { key, unlocked: gain };
  }
  return best;
}


// ── L'action du moment sur un tournoi (panel arbitre) ──────────────────────

/**
 * Ce qu'il reste à faire sur un tournoi, et le libellé du geste.
 *
 * PUR à dessein : c'est la règle qui décide de ce que l'organisateur voit en
 * premier, et un libellé faux l'enverrait faire le mauvais geste. Le sous-titre
 * dit toujours POURQUOI l'action est proposée.
 */
export function nextTournamentAction(t: Tournament, seatedTeams: number): {
  label: string; tone: 'brand' | 'dark'; subtitle: string;
} | { label: null; subtitle: string } {
  const format = `${teamCount(t.court_count)} binômes · ${t.court_count} terrains · ${t.round_count} rotations de ${roundMinutesOf(t)} min`;

  switch (t.status) {
    case 'INSCRIPTIONS_OUVERTES':
      return {
        label: 'Relancer les inscrits', tone: 'dark',
        subtitle: `${seatedTeams} binôme${seatedTeams > 1 ? 's' : ''} sur ${teamCount(t.court_count)} · check-in non ouvert`,
      };
    case 'COMPLET':
      return { label: 'Ouvrir le pointage', tone: 'brand', subtitle: format };
    case 'CHECK_IN':
    case 'PRET':
      return { label: 'Démarrer le tournoi', tone: 'brand', subtitle: format };
    case 'EN_COURS':
      // Le serveur tire chaque rotation tout seul dès le dernier score de la
      // précédente : il n'y a plus de bouton à proposer ici. Seule exception,
      // current_round === 0 : le lancement n'a pas réussi à tirer le tour 1
      // (pas assez de binômes assis), et sans porte de secours la seule
      // sortie de l'organisateur serait d'annuler le tournoi.
      if (t.current_round === 0) {
        return { label: 'Tirer le tour 1', tone: 'brand', subtitle: format };
      }
      // À LA DERNIÈRE rotation, il n'y a justement plus de « suivante » : le
      // classement se fige tout seul dès qu'elle est complète, et l'écran
      // mentirait en disant « la suivante part toute seule ». Cette fenêtre
      // dure tout le temps que la dernière rotation se joue — un organisateur
      // la lit vraiment, ce n'est pas un cas limite théorique.
      return t.current_round >= t.round_count
        ? {
            label: null,
            subtitle: `Dernière rotation (${t.current_round} sur ${t.round_count}) — le classement se fige tout seul à la fin, tu n'auras plus qu'à valider.`,
          }
        : {
            label: null,
            subtitle: `Rotation ${t.current_round} sur ${t.round_count} — la suivante part toute seule`,
          };
    case 'TERMINE':
      return { label: 'Valider le classement', tone: 'brand', subtitle: 'Classement figé, points en attente.' };
    case 'CLASSEMENT_VALIDE':
      return { label: 'Voir le classement', tone: 'dark', subtitle: 'Classement validé, points crédités.' };
    case 'ANNULE':
      return { label: null, subtitle: 'Tournoi annulé.' };
    default:
      return { label: null, subtitle: format };
  }
}

// ─── Les inscrits, groupés par binôme ────────────────────────────────────────
//
// La liste montrait les gens UN PAR UN — des initiales, puis des prénoms à la
// suite. Or on ne s'inscrit pas seul à une montante : on s'inscrit à deux, et
// la première question qu'on se pose devant la liste est « qui joue avec
// qui ». La donnée existait (`tournament_teams` relie deux joueurs), elle
// n'était simplement jamais montrée.

export interface PairedPlayer {
  id: string;
  name: string;
  elo: number | null;
  mine: boolean;
  /** `players.avatar_path` — sa photo, si elle existe. */
  avatarPath?: string | null;
}

export interface RegisteredPair {
  /** Stable : l'identifiant de l'équipe, ou celui du joueur encore seul. */
  key: string;
  a: PairedPlayer;
  /** `null` quand le joueur cherche encore un binôme. */
  b: PairedPlayer | null;
  /**
   * Les joueurs avec qui une demande est EN COURS — dans un sens ou dans
   * l'autre. Vide dès que le binôme est formé.
   *
   * Ces liens n'existaient nulle part sur les cartes : deux joueurs qui
   * s'étaient déjà demandés apparaissaient chacun dans sa propre carte
   * « Cherche un binôme », comme s'il ne s'était rien passé. On croit sa
   * demande perdue, et on en envoie une autre.
   *
   * LE SENS N'EST PAS DISTINGUÉ, volontairement : la carte répond « où en est
   * cette personne », et de ce point de vue « je l'ai demandé » et « il m'a
   * demandé » sont la même chose — une réponse manque. Qui doit répondre se
   * lit dans la liste « joueurs sans binôme », qui porte les boutons.
   *
   * Conséquence assumée : une demande entre deux joueurs seuls apparaît sur
   * LEURS DEUX cartes. Ce n'est pas un doublon — chaque carte décrit la
   * situation de son joueur, et en cacher une reviendrait à faire disparaître
   * quelqu'un de la liste des inscrits.
   */
  pending: PairedPlayer[];
  /**
   * `a` et `b` sont réunis par une demande EN COURS, pas par un binôme formé.
   *
   * Deux joueurs qui se sont demandés apparaissaient dans DEUX cartes
   * séparées — « isolés alors qu'ils sont liés ». On les réunit donc dans une
   * seule, sous un sablier : c'est ce que l'œil cherche dans cette liste,
   * « qui est avec qui ».
   *
   * LA FUSION N'A LIEU QUE SI LE LIEN EST SANS AMBIGUÏTÉ : chacun des deux
   * n'a qu'une seule demande en cours, et c'est vers l'autre. Dès qu'un
   * joueur en a plusieurs, le réunir avec l'un d'eux désignerait un vainqueur
   * que personne n'a choisi — il garde alors sa carte, avec ses candidats.
   */
  tentative: boolean;
  /** Le binôme est en liste d'attente — il n'a pas (encore) sa place. */
  waiting: boolean;
}

/**
 * Les inscrits, regroupés par binôme.
 *
 * TROIS PIÈGES, tous rencontrés ailleurs dans ce fichier :
 *
 *  - Une équipe RETIRÉE (`withdrawn`) n'est plus un binôme. Ses membres
 *    redeviennent des joueurs seuls s'ils sont encore inscrits — les afficher
 *    ensemble laisserait croire à une paire qui ne jouera pas.
 *  - Une équipe dont un membre n'est plus inscrit ne doit pas afficher un
 *    fantôme : on ne garde que ce qui existe des deux côtés.
 *  - Un binôme dont les deux moitiés n'ont pas le même statut de file ne peut
 *    pas exister côté serveur (`waitlist_mismatch`). Par sécurité on prend le
 *    statut LE PLUS DÉFAVORABLE : si l'un attend, la paire attend.
 */
export function groupRegistrations(
  regs: TournamentRegistration[],
  teams: TournamentTeam[],
  myId?: string | null,
  /** Les demandes de binôme — seules celles encore `pending` sont lues. */
  requests: JoinRequest[] = [],
): RegisteredPair[] {
  const parJoueur = new Map(regs.map(r => [r.player_id, r]));
  const versPaire = (r: TournamentRegistration): PairedPlayer => ({
    id: r.player_id,
    name: displayName(r.player ?? null, 'player'),
    elo: r.player?.elo_score ?? null,
    mine: !!myId && r.player_id === myId,
    avatarPath: (r.player as any)?.avatar_path ?? null,
  });

  const paires: RegisteredPair[] = [];
  const casees = new Set<string>();

  for (const t of teams) {
    if (t.withdrawn) continue;
    const r1 = parJoueur.get(t.player1_id);
    const r2 = parJoueur.get(t.player2_id);
    if (!r1 || !r2) continue;
    casees.add(t.player1_id);
    casees.add(t.player2_id);
    paires.push({
      key: t.id,
      a: versPaire(r1),
      b: versPaire(r2),
      pending: [],
      tentative: false,
      waiting: r1.waitlist_position != null || r2.waitlist_position != null,
    });
  }

  // Les demandes en cours, dans les deux sens. Une demande vers quelqu'un qui
  // n'est plus inscrit, ou déjà en binôme, ne mène nulle part : on ne la
  // montre pas — promettre un binôme impossible est pire que se taire.
  const enAttente = new Map<string, Set<string>>();
  for (const q of requests) {
    if (q.status !== 'pending') continue;
    for (const [x, y] of [[q.from_player, q.to_player], [q.to_player, q.from_player]] as const) {
      if (casees.has(x) || casees.has(y)) continue;
      if (!parJoueur.has(x) || !parJoueur.has(y)) continue;
      if (!enAttente.has(x)) enAttente.set(x, new Set());
      enAttente.get(x)!.add(y);
    }
  }

  // FUSION DES LIENS SANS AMBIGUÏTÉ. Deux joueurs qui n'ont chacun qu'une
  // demande, et l'un vers l'autre, forment une carte commune sous un sablier.
  // Dès qu'un des deux est courtisé par plusieurs personnes, on ne fusionne
  // pas : désigner un gagnant que personne n'a choisi serait pire que deux
  // cartes.
  for (const r of regs) {
    if (casees.has(r.player_id)) continue;
    const miens = enAttente.get(r.player_id);
    if (!miens || miens.size !== 1) continue;
    const autre = [...miens][0];
    const siens = enAttente.get(autre);
    if (!siens || siens.size !== 1 || !siens.has(r.player_id)) continue;
    const r2 = parJoueur.get(autre);
    if (!r2 || casees.has(autre)) continue;
    casees.add(r.player_id);
    casees.add(autre);
    // MOI à gauche quand je suis dedans : on lit sa propre carte avant celle
    // des autres. Sinon l'ordre alphabétique, pour qu'elle ne change pas d'un
    // chargement à l'autre.
    const [x, y] = !!myId && r2.player_id === myId ? [r2, r] : [r, r2];
    paires.push({
      key: [r.player_id, autre].sort().join(':'),
      a: versPaire(x),
      b: versPaire(y),
      pending: [],
      tentative: true,
      waiting: x.waitlist_position != null || y.waitlist_position != null,
    });
  }

  for (const r of regs) {
    if (casees.has(r.player_id)) continue;
    const candidats = [...(enAttente.get(r.player_id) ?? [])]
      .map(id => parJoueur.get(id))
      .filter((x): x is TournamentRegistration => !!x)
      .map(versPaire)
      // Ordre stable : sans tri, deux chargements peuvent rendre deux ordres
      // et la carte « saute » sous les yeux au rafraîchissement.
      .sort((x, y) => x.name.localeCompare(y.name));
    paires.push({
      key: r.player_id,
      a: versPaire(r),
      b: null,
      pending: candidats,
      tentative: false,
      waiting: r.waitlist_position != null,
    });
  }

  // On lit « qui joue » avant « qui est sur le point de jouer » avant « qui
  // cherche encore ». L'ancien classement mettait TOUTE la file en dernier —
  // ça marchait tant qu'un joueur seul pouvait être assis ; depuis la règle
  // du siège-aux-binômes, tous les solos attendent, et le critère ne
  // départageait plus rien. Une demande en cours passe donc devant : c'est ce
  // qui est le plus près d'aboutir.
  const rang = (p: RegisteredPair) =>
    p.b && !p.tentative ? (p.waiting ? 1 : 0)
      : p.tentative ? 2
      : p.pending.length > 0 ? 3 : 4;
  return paires.sort((x, y) => rang(x) - rang(y) || x.key.localeCompare(y.key));
}

/** « 6 joueurs · 3 binômes » — l'en-tête de la liste des inscrits. */
export function pairsCountLabel(pairs: RegisteredPair[]): string {
  const joueurs = pairs.reduce((n, p) => n + (p.b ? 2 : 1), 0);
  // Une carte SOUS SABLIER n'est pas encore un binome : la compter en
  // annoncerait un appariement que personne n'a accepte.
  const binomes = pairs.filter(p => p.b && !p.tentative).length;
  const j = `${joueurs} joueur${joueurs > 1 ? 's' : ''}`;
  return binomes > 0 ? `${j} · ${binomes} binôme${binomes > 1 ? 's' : ''}` : j;
}

// ─── Choisir un partenaire déjà inscrit ──────────────────────────────────────
//
// La recherche de binôme grisait TOUT joueur déjà inscrit, avec la pastille
// « Déjà inscrit ». Techniquement exact — `tournament_register` refuse
// `partner_already_registered` — mais c'est un cul-de-sac : quelqu'un
// d'inscrit et resté SEUL est précisément la personne avec qui on veut jouer.
//
// Le chemin existe, il est simplement ailleurs : s'inscrire, puis le
// rejoindre. Selon SON réglage, le binôme se forme aussitôt (`open_to_join`)
// ou une demande part et il décide. Plutôt que de griser, on nomme le chemin.

export type PartnerPath =
  /** Pas encore inscrit : une invitation part, il decide. */
  | 'direct'
  /** Inscrit, seul, et ouvert : le binôme se forme dès mon inscription. */
  | 'instant'
  /** Inscrit, seul, mais sur accord : une demande part, il décide. */
  | 'request'
  /** Inscrit ET déjà en binôme : rien à faire de ce côté. */
  | 'blocked';

export interface PartnerContext {
  registered: Set<string>;
  /** Les inscrits restés SEULS, et leur `open_to_join`. */
  soloOpen: Map<string, boolean>;
}

export function partnerPath(playerId: string, ctx: PartnerContext): PartnerPath {
  if (!ctx.registered.has(playerId)) return 'direct';
  const ouvert = ctx.soloOpen.get(playerId);
  if (ouvert === undefined) return 'blocked';
  return ouvert ? 'instant' : 'request';
}

/** Ce que la ligne annonce, et ce que le bouton fera. */
export const PARTNER_PATH_LABEL: Record<PartnerPath, string> = {
  // Depuis tournament_partner_invite.sql, inviter n'inscrit PLUS d'office :
  // une demande part. Le dire ici evite de promettre un binome forme.
  direct: 'Il devra accepter',
  instant: 'Inscrit · cherche un binôme',
  request: 'Inscrit · sur accord',
  blocked: 'Déjà en binôme',
};

/**
 * Ce qui va réellement arriver au partenaire choisi, avant de valider.
 *
 * La feuille affichait UN SEUL texte, quel que soit le partenaire : « Ton
 * partenaire est inscrit sans rien déclarer en son nom : côté "les deux", et
 * "sur accord" pour tout le reste. » Il décrivait l'inscription d'office —
 * supprimée par `tournament_partner_invite.sql`. Il était donc faux dans les
 * DEUX cas : on n'inscrit plus personne à sa place, et quelqu'un de déjà
 * inscrit a évidemment déclaré son côté et son mode lui-même.
 *
 * Les trois situations n'engagent pas la même chose — l'une forme le binôme
 * sur-le-champ, les deux autres attendent une réponse. Le dire avant le geste
 * évite de croire qu'on est appariés alors qu'on attend.
 */
export function partnerIntentNotice(path: PartnerPath, name: string): string {
  switch (path) {
    case 'instant':
      return `${name} est déjà inscrit et cherche un binôme. Il accepte qu’on le prenne d’un geste : le binôme se forme dès ton inscription.`;
    case 'request':
      return `${name} est déjà inscrit et veut qu’on lui demande d’abord. Tu seras inscrit, et le binôme se formera s’il accepte.`;
    case 'direct':
      return `${name} n’est pas encore inscrit à ce tournoi. Il recevra une demande et décidera : rien n’est inscrit en son nom.`;
    case 'blocked':
      return `${name} a déjà un binôme sur ce tournoi.`;
  }
}

/** Le libellé du bouton d'inscription, selon le chemin du partenaire choisi. */
export function registerCtaLabel(path: PartnerPath | null): string {
  if (path === 'instant') return 'S’inscrire et former le binôme';
  // Les deux autres chemins envoient une demande — et le bouton doit le dire :
  // « Nous inscrire » mentirait sur ce qui va se passer.
  if (path === 'request' || path === 'direct') return 'S’inscrire et l’inviter';
  return 'S’inscrire';
}
