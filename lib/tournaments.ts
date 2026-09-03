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
  price_mad: number;
  /** Score crédité À CHAQUE camp sur un match soldé par un forfait (0 par
   *  défaut) — c'est `forfeited_team`, jamais ce nombre, qui dit qui a gagné.
   *  Lu pour l'AVERTIR à l'écran avant de déclarer un forfait, jamais pour en
   *  déduire un résultat. */
  forfeit_games: number;
  status: TournamentStatus;
  current_round: number;
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

/** Ce qu'un NOUVEL inscrit obtiendrait immédiatement — port de
 *  `fn_tournament_free_places` : ZÉRO dès que quelqu'un attend, quel que soit
 *  le nombre de sièges vides. Ces sièges appartiennent à la file, pas au
 *  prochain arrivant. C'est la seule lecture qu'un écran peut afficher
 *  honnêtement. */
export function freePlaces(
  regs: Pick<TournamentRegistration, 'waitlist_position'>[],
  courtCount: number,
): number {
  if (waitlistCount(regs) > 0) return 0;
  return Math.max(0, seatCount(courtCount) - seatsTaken(regs));
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

/** Le format en une ligne : « 4 terrains · 6 rotations de 15 min ». La durée
 *  d'une rotation n'est pas au schéma — elle est la constante du format. */
export const ROUND_MINUTES = 15;

export function formatLabel(courtCount: number, roundCount: number): string {
  return `${courtCount} terrain${courtCount > 1 ? 's' : ''} · ${roundCount} rotation${roundCount > 1 ? 's' : ''} de ${ROUND_MINUTES} min`;
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
  'id, name, club_id, starts_at, ends_at, level_min, level_max, court_count, round_count, ' +
  'price_mad, forfeit_games, status, current_round, created_by, created_at, club:club_id(id, name, city)';

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
    .select('tournament_id, player_id, side, open_to_join, waitlist_position, check_in_status, registered_at, player:player_id(id, name, elo_score, deleted_at)')
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
}

const TOURNAMENT_MATCH_COLS =
  'id, tournament_id, round_no, court_no, team_a, team_b, games_a, games_b, forfeited_team, confirmed_at';

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

// ⚠️ `tournament_generate_round` ACCEPTE un second paramètre `p_final_round`,
// mais SEUL `tournament_final_round` a le droit de le passer à `true` — c'est
// elle qui porte les enjeux (`stakes`) que la dernière rotation doit afficher,
// et que `generateTournamentRound` n'a aucun moyen de reconstituer. Cet écran
// appelle TOUJOURS `generateTournamentRound` À UN SEUL ARGUMENT ;
// `nextRoundIsFinal` ci-dessous dit QUAND appeler `generateFinalTournamentRound`
// à la place — jamais en passant un second argument à l'autre.
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
 *  ⚠️ `stakes` N'EST DISPONIBLE QUE DANS CETTE RÉPONSE — aucune table ni RPC
 *  ne le réexpose ensuite (`fn_tournament_final_slots`, qui le calcule, est
 *  révoquée de `authenticated` : c'est un helper interne, jamais un chemin de
 *  lecture). Seul l'ORGANISATEUR appelle cette fonction (Task 10, admin.tsx) :
 *  c'est donc lui, et lui seul, qui peut voir `stakes` — et seulement dans la
 *  même session, entre cet appel et le moment où il quitte l'écran. Ni
 *  l'écran organisateur après un rechargement, ni la fiche d'un joueur
 *  quelconque, n'ont de chemin légitime pour le retrouver : le recalculer
 *  côté client redupliquerait `fn_tournament_final_slots` (byes, binômes
 *  partis, paliers troués) en TypeScript, exactement ce que ce fichier
 *  s'interdit ailleurs. `stakeLabel` ci-dessous ne fait que TRADUIRE la ligne
 *  déjà tranchée par le serveur — jamais recalculer un rang. */
export function generateFinalTournamentRound(tournamentId: string): Promise<TournamentResult> {
  return callTournamentRpc('tournament_final_round', { p_tournament: tournamentId });
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
