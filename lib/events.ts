// lib/events.ts — les événements de club (tables `events`, `event_rsvps`).
//
// Un tournoi se JOUE et se CLASSE ; un événement se VIT. Pas de binôme, pas de
// score, pas de classement — c'est ce qui permet à ce fichier de rester court
// là où `tournaments.ts` fait deux mille lignes.
//
// Import supabase paresseux : les dérivations d'affichage restent testables
// sans variables d'environnement, comme dans `clubFavorites.ts`.

export type EventKind = 'decouverte' | 'stage' | 'afterwork' | 'portes_ouvertes' | 'externe';
export type EventStatus = 'PUBLIE' | 'ANNULE';

export interface ClubEvent {
  id: string;
  kind: EventKind;
  title: string;
  club_id: string | null;
  starts_at: string;
  ends_at: string | null;
  /** `null` = places non limitées. Jamais zéro : voir la CHECK de `events.sql`. */
  capacity: number | null;
  price_mad: number;
  description: string | null;
  /** Renseigné si et seulement si `kind === 'externe'`. */
  external_url: string | null;
  status: EventStatus;
  cancel_reason: string | null;
  created_by: string;
  created_at: string;
  club?: { id: string; name: string; city: string | null } | null;
}

export interface EventRsvp {
  event_id: string;
  player_id: string;
  /** false = « J'y serai » (prend une place) ; true = « Me prévenir » (n'en prend pas). */
  notify_on_free: boolean;
  created_at: string;
  player?: { id: string; name: string | null; avatar_path: string | null; elo_score: number | null } | null;
}

// ── Les dérivations d'affichage ─────────────────────────────────────────────

const KIND_LABEL: Record<EventKind, string> = {
  decouverte:      'Découverte',
  stage:           'Stage',
  afterwork:       'Afterwork',
  portes_ouvertes: 'Portes ouvertes',
  // « Externe » ne veut rien dire pour un joueur. Ce qui compte est que
  // l'événement est officiel et qu'il se passe ailleurs que dans l'app.
  externe:         'Officiel FRMT',
};

/** Le nom lisible d'une nature. Jamais vide : une nature ajoutée en base et
 *  pas encore connue de l'app afficherait sinon une pastille vide, ce qui est
 *  pire qu'un mot générique. */
export function eventKindLabel(kind: EventKind): string {
  return KIND_LABEL[kind] ?? 'Événement';
}

/**
 * ⚠️ `capacity` nul veut dire PLACES NON LIMITÉES, pas zéro place.
 * Le confondre fermerait l'inscription d'un événement ouvert à tous — et
 * c'est l'erreur naturelle, puisque `null` se compare volontiers à 0.
 */
export function eventIsFull(capacity: number | null, attending: number): boolean {
  return capacity != null && attending >= capacity;
}

/**
 * Le seul endroit de l'app qui écrit « Complet ».
 *
 * Même règle que `spotsLabel` côté parties : un compteur de places qui
 * s'affiche à deux endroits finit par dire deux choses différentes.
 */
export function eventSpotsLabel(capacity: number | null, attending: number): string {
  if (capacity == null) return 'Places libres';
  // Une capacité baissée après coup peut laisser plus d'inscrits que de
  // places : « -2 places restantes » serait absurde.
  const reste = capacity - attending;
  if (reste <= 0) return 'Complet';
  return `${reste} place${reste > 1 ? 's' : ''} restante${reste > 1 ? 's' : ''}`;
}

/** « Gratuit » plutôt que « 0 MAD » — et « / personne », parce qu'un
 *  événement se paie pour soi, pas pour un binôme comme un tournoi. */
export function eventPriceLabel(priceMad: number): string {
  return priceMad > 0 ? `${priceMad} MAD / personne` : 'Gratuit';
}

export type EventRsvpState = 'aucun' | 'jy_serai' | 'me_prevenir';

/** Où j'en suis avec cet événement — les trois situations, dont l'absence de
 *  réponse, qui n'est pas la même chose qu'un refus. */
export function eventRsvpState(mine: Pick<EventRsvp, 'notify_on_free'> | null | undefined): EventRsvpState {
  if (!mine) return 'aucun';
  return mine.notify_on_free ? 'me_prevenir' : 'jy_serai';
}

export interface EventRow {
  event: ClubEvent;
  /** Ceux qui viennent — les « Me prévenir » ne sont pas comptés. */
  attending: number;
  mine: EventRsvpState;
}

export interface EventsBoard {
  /** Le prochain, mis en avant en grande carte. `null` s'il n'y a rien à venir. */
  next: EventRow | null;
  others: EventRow[];
}

/**
 * Ce que montre l'onglet Événements : le prochain en grand, le reste en lignes.
 *
 * ⚠️ Un événement ANNULÉ n'est jamais mis en avant, mais n'est pas caché non
 * plus : « la soirée du 3 est annulée » est précisément ce qu'on vient
 * vérifier, et le faire disparaître passerait pour un bug de l'app. Il
 * redescend simplement dans la liste.
 *
 * Pure : c'est ce qui permet de vérifier ces règles ici plutôt qu'à l'œil sur
 * un téléphone.
 */
export function buildEventsBoard(
  events: ClubEvent[], rsvps: Pick<EventRsvp, 'event_id' | 'player_id' | 'notify_on_free'>[], myId: string | null,
): EventsBoard {
  const parEvent = new Map<string, { attending: number; mine: EventRsvpState }>();
  for (const e of events) parEvent.set(e.id, { attending: 0, mine: 'aucun' });
  for (const r of rsvps) {
    const agg = parEvent.get(r.event_id);
    if (!agg) continue;
    if (!r.notify_on_free) agg.attending += 1;
    if (myId && r.player_id === myId) agg.mine = r.notify_on_free ? 'me_prevenir' : 'jy_serai';
  }

  const lignes: EventRow[] = [...events]
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
    .map(e => ({ event: e, ...(parEvent.get(e.id) ?? { attending: 0, mine: 'aucun' as EventRsvpState }) }));

  const i = lignes.findIndex(r => r.event.status === 'PUBLIE');
  if (i < 0) return { next: null, others: lignes };
  return { next: lignes[i], others: lignes.filter((_, j) => j !== i) };
}

// ── L'assistant de création ─────────────────────────────────────────────────

export interface EventDraft {
  kind: EventKind | null;
  title: string;
  clubId: string | null;
  /** `YYYY-MM-DD`, comme `DateSheet`. */
  date: string;
  /** `HH:MM`, comme `TimeSheet`. */
  start: string;
  end: string | null;
  limit: boolean;
  capacity: number;
  priceMad: number;
  description: string;
  externalUrl: string;
}

/** La date et l'heure composées dans le fuseau DU TÉLÉPHONE — un événement se
 *  donne à l'heure du club, pas en UTC. */
export function eventStartsAt(date: string, time: string): Date {
  return new Date(`${date}T${time}:00`);
}

/**
 * Ce qui manque encore à cette étape, en une phrase — ou `null` si on peut
 * continuer.
 *
 * Une phrase plutôt qu'un booléen : un bouton grisé sans raison est une
 * impasse, on ne sait pas quoi corriger. Chaque refus nomme ce qu'il attend.
 *
 * Les mêmes règles que les CHECK de `events.sql`, dites AVANT l'appel : sans
 * ça, le serveur refuse avec une erreur brute (`violates check constraint
 * events_title_check`) que personne ne peut lire.
 */
export function eventDraftIssue(step: number, d: EventDraft): string | null {
  if (step === 0) {
    return d.kind ? null : 'Choisis ce que c’est.';
  }

  if (step === 1) {
    const titre = d.title.trim();
    if (!titre) return 'Donne-lui un titre.';
    // 28 caractères : au-delà, le titre se fait rogner sur Android.
    if (titre.length > 28) return 'Le titre tient en 28 caractères.';
    if (!d.date || !d.start) return 'Dis quand ça se passe.';
    if (d.end && d.end <= d.start) return 'La fin doit venir après le début.';
    return null;
  }

  if (step === 2 && d.kind === 'externe') {
    const url = d.externalUrl.trim();
    if (!url) return 'Un événement externe a besoin de son lien.';
    if (!/^https?:\/\/\S+\.\S+/.test(url)) return 'Ce lien ne ressemble pas à une adresse web.';
    return null;
  }

  return null;
}

// ── La lecture et l'écriture ────────────────────────────────────────────────

const EVENT_COLS =
  'id, kind, title, club_id, starts_at, ends_at, capacity, price_mad, description, ' +
  'external_url, status, cancel_reason, created_by, created_at, club:club_id(id, name, city)';

/** Les événements à venir, du plus proche au plus lointain. Les annulés sont
 *  RENDUS : « la soirée du 3 est annulée » est précisément ce qu'on vient
 *  vérifier, et un événement qui disparaît sans un mot passe pour un bug. */
export async function fetchUpcomingEvents(): Promise<ClubEvent[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLS)
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ClubEvent[];
}

/**
 * Tout ce qu'il faut à l'onglet Événements, en DEUX requêtes.
 *
 * Les réponses de tous les événements sont ramenées d'un coup plutôt qu'une
 * requête par carte : à notre échelle la liste est courte, mais le N+1 se
 * paie au premier club actif, et il se paie sur le réseau du joueur.
 */
export async function fetchEventsBoard(playerId: string | null): Promise<EventsBoard> {
  const events = await fetchUpcomingEvents();
  if (events.length === 0) return { next: null, others: [] };
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .from('event_rsvps')
    .select('event_id, player_id, notify_on_free')
    .in('event_id', events.map(e => e.id));
  if (error) throw error;
  return buildEventsBoard(events, (data ?? []) as any, playerId);
}

export async function fetchEvent(id: string): Promise<ClubEvent | null> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.from('events').select(EVENT_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as ClubEvent | null;
}

/** Qui vient — la question qu'on se pose AVANT de répondre soi-même. */
export async function fetchEventRsvps(eventId: string): Promise<EventRsvp[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .from('event_rsvps')
    .select('event_id, player_id, notify_on_free, created_at, player:player_id(id, name, avatar_path, elo_score)')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as EventRsvp[];
}

export interface RsvpResult { ok: boolean; reason?: string }

/**
 * « J'y serai » (`notifyOnFree` faux) ou « Me prévenir » (vrai).
 *
 * Les refus viennent du TRIGGER, pas d'ici : `event_full`, `event_cancelled`,
 * `event_past`. L'écran ne recompte pas les places avant d'appeler — deux
 * joueurs qui touchent le dernier siège à la même seconde passeraient tous
 * les deux si le compte affiché faisait autorité.
 */
export async function rsvpEvent(
  eventId: string, playerId: string, notifyOnFree = false,
): Promise<RsvpResult> {
  const { supabase } = await import('./supabase');
  const { error } = await supabase
    .from('event_rsvps')
    .upsert({ event_id: eventId, player_id: playerId, notify_on_free: notifyOnFree },
            { onConflict: 'event_id,player_id' });
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

/** « Je ne peux plus venir. » */
export async function cancelRsvp(eventId: string, playerId: string): Promise<RsvpResult> {
  const { supabase } = await import('./supabase');
  const { error } = await supabase
    .from('event_rsvps').delete().eq('event_id', eventId).eq('player_id', playerId);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export interface EventCreateInput {
  kind: EventKind;
  title: string;
  clubId: string | null;
  startsAt: Date;
  endsAt?: Date | null;
  capacity?: number | null;
  priceMad?: number;
  description?: string | null;
  externalUrl?: string | null;
}

/** Publie un événement. Qui le crée en est l'organisateur — la RLS le
 *  vérifie (`created_by = current_player_id()`), l'app ne fait que le poser. */
export async function createEvent(
  input: EventCreateInput, createdBy: string,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.from('events').insert({
    kind: input.kind,
    title: input.title.trim(),
    club_id: input.clubId,
    starts_at: input.startsAt.toISOString(),
    ends_at: input.endsAt ? input.endsAt.toISOString() : null,
    capacity: input.capacity ?? null,
    price_mad: input.priceMad ?? 0,
    description: input.description?.trim() || null,
    external_url: input.kind === 'externe' ? (input.externalUrl?.trim() || null) : null,
    created_by: createdBy,
  }).select('id').single();
  if (error) return { ok: false, reason: error.message };
  return { ok: true, id: (data as any).id as string };
}
