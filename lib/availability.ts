// lib/availability.ts — « Tu es dispo quand ? » du hub Activité.
//
// Une ligne de sept jours dans le header : on tape les jours où on peut
// jouer. Trois pastilles figées (ce soir / demain / samedi matin) laissaient
// un trou — impossible de se déclarer un dimanche, ni au-delà de 48 h, alors
// que le mercato, lui, regarde tout le week-end.
//
// La partie CALCUL est pure et testée (lib/__tests__/availability.test.ts) ;
// seules les fonctions du bas parlent à la base (table `availability`,
// migration supabase/migrations/availability.sql).
//
// Une dispo n'est qu'une intention : elle ne réserve rien, elle dit au cercle
// « je peux jouer ce jour-là ». Elle expire toute seule.
import { supabase } from './supabase';
import { isMissingRelation } from './pgErrors';

/** Au-delà, une dispo est effacée par le ménage automatique. */
export const AVAILABILITY_TTL_DAYS = 8;

/** Nombre de jours proposés dans la ligne de dispo. */
export const AVAILABILITY_DAYS = 7;

/** La clé d'un créneau : le jour visé, au format `AAAA-MM-JJ`. */
export type SlotKey = string;

export interface Slot {
  key: SlotKey;
  /** Ce qui s'affiche sur la pastille : « Ce soir », « Demain », « Sam. 26 ». */
  label: string;
  start: Date;
  end: Date;
}

const SOIR_DEBUT = 18;      // « ce soir » commence à 18 h
const JOURNEE_DEBUT = 8;    // une journée de padel commence à 8 h

/**
 * Ce qu'il faut de temps devant soi pour que « ce soir » veuille encore dire
 * quelque chose : le temps d'aller au club (1 h) plus un match (1 h 30).
 *
 * Sans ça, la pastille restait proposée jusqu'à minuit — à 23 h, « je suis
 * dispo ce soir » est une promesse que personne ne peut tenir.
 */
const DELAI_DEPLACEMENT_MS = 60 * 60_000;
const DUREE_MATCH_MS = 90 * 60_000;
const SOIREE_MINIMALE_MS = DELAI_DEPLACEMENT_MS + DUREE_MATCH_MS;

const a = (d: Date, jours: number, h: number, min = 0) => {
  const x = new Date(d);
  x.setDate(x.getDate() + jours);
  x.setHours(h, min, 0, 0);
  return x;
};

const deux = (n: number) => String(n).padStart(2, '0');
const cle = (d: Date) => `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;

const JOURS_COURTS = ['Dim.', 'Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'];
const JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const JOURS_MINUSCULE = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/**
 * Les sept prochains jours. Le jour même n'est proposé que s'il reste une
 * soirée à jouer : il part de 18 h, ou de maintenant s'il est plus tard, et
 * s'appelle « Ce soir ». Les jours suivants couvrent la journée entière.
 */
export function availabilitySlots(now: Date = new Date(), jours: number = AVAILABILITY_DAYS): Slot[] {
  const out: Slot[] = [];

  for (let i = 0; out.length < jours && i <= jours; i++) {
    if (i === 0) {
      // Entre minuit et 6 h, « ce soir » n'a plus de sens : la soirée est passée.
      if (now.getHours() < JOURNEE_DEBUT - 2) continue;
      const debut = now.getHours() >= SOIR_DEBUT ? new Date(now) : a(now, 0, SOIR_DEBUT);
      const fin = a(now, 1, 0);
      // Trop tard pour jouer : on ne propose pas un créneau intenable.
      if (fin.getTime() - debut.getTime() < SOIREE_MINIMALE_MS) continue;
      out.push({ key: cle(now), label: 'Ce soir', start: debut, end: fin });
      continue;
    }
    const debut = a(now, i, JOURNEE_DEBUT);
    out.push({
      key: cle(debut),
      label: i === 1 ? 'Demain' : `${JOURS_COURTS[debut.getDay()]} ${debut.getDate()}`,
      start: debut,
      end: a(now, i + 1, 0),
    });
  }

  return out;
}

/** Le créneau d'une clé, ou `null` s'il n'est plus proposé. */
export function slotFromKey(key: SlotKey, now: Date = new Date()): Slot | null {
  return availabilitySlots(now).find(s => s.key === key) ?? null;
}

const memeJour = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** « ce soir » / « demain » / « samedi » — pour une phrase (« 3 joueurs dispos samedi »). */
export function slotShortLabel(slot: Slot, now: Date = new Date()): string {
  if (memeJour(slot.start, now)) return 'ce soir';
  if (memeJour(slot.start, new Date(now.getTime() + 86_400_000))) return 'demain';
  return JOURS_MINUSCULE[slot.start.getDay()];
}

/** « Dispos ce soir » — titre de la carte du même nom, selon le créneau affiché. */
export function slotTitle(slot: Slot, now: Date = new Date()): string {
  return `Dispos ${slotShortLabel(slot, now)}`;
}

const heure = (d: Date) => (d.getHours() === 0 ? 'minuit' : `${d.getHours()}h${d.getMinutes() ? String(d.getMinutes()).padStart(2, '0') : ''}`);

/** « Ce soir · 18h – minuit », « Samedi · 8h – minuit ». */
export function slotLabel(slot: Slot, now: Date = new Date()): string {
  const demain = memeJour(slot.start, new Date(now.getTime() + 86_400_000));
  const jour = memeJour(slot.start, now) ? 'Ce soir' : demain ? 'Demain' : JOURS[slot.start.getDay()];
  return `${jour} · ${heure(slot.start)} – ${heure(slot.end)}`;
}

export interface AvailabilityRow {
  id?: string;
  player_id?: string;
  slot_start: string;
  slot_end: string;
  club_id?: string | null;
  player?: { id: string; name: string; elo_score: number; avatar_path?: string | null; member_number?: number | null } | null;
}

/**
 * Ce créneau est-il déjà déclaré parmi mes dispos ?
 *
 * La comparaison se fait au JOUR, pas à l'heure près : « ce soir » commence à
 * 18 h ou à l'heure qu'il est, donc une dispo déclarée à 18 h ne se
 * reconnaissait plus à 20 h quand on comparait les horaires.
 */
export function isSlotActive(slot: Slot, mine: Pick<AvailabilityRow, 'slot_start' | 'slot_end'>[]): boolean {
  const jour = slot.start.toDateString();
  return mine.some(r => {
    const s = new Date(r.slot_start);
    return !Number.isNaN(s.getTime()) && s.toDateString() === jour;
  });
}

/**
 * Le créneau que la carte « Dispos » doit montrer : MON premier jour déclaré.
 *
 * Elle montrait toujours le plus proche — « Dispos ce soir » — même à
 * quelqu'un qui s'était déclaré pour demain et mercredi. Il voyait donc les
 * joueurs d'un soir où il ne joue pas, et pas ceux du sien.
 *
 * Sans aucune déclaration, on retombe sur le plus proche : il faut bien
 * montrer quelque chose, et c'est l'invitation à se déclarer.
 */
export function displayedSlot(
  slots: Slot[],
  mine: Pick<AvailabilityRow, 'slot_start' | 'slot_end'>[],
): Slot | null {
  return slots.find(s => isSlotActive(s, mine)) ?? slots[0] ?? null;
}

/**
 * L'heure à proposer quand on monte une partie sur ce créneau : le début du
 * créneau, ou la prochaine demi-heure s'il a déjà commencé. On ne propose
 * jamais une heure passée — ni « dans cinq minutes », le temps d'y aller.
 */
export function suggestedStart(slot: Slot, now: Date = new Date()): Date {
  const plancher = new Date(now.getTime() + DELAI_DEPLACEMENT_MS);
  const base = slot.start.getTime() >= plancher.getTime() ? new Date(slot.start) : plancher;
  // Arrondi à la demi-heure supérieure : l'assistant ne propose que celles-là.
  const min = base.getMinutes();
  base.setMinutes(min === 0 || min === 30 ? min : min < 30 ? 30 : 60, 0, 0);
  return base;
}

/** « 2026-09-20 » et « 19:30 » — les deux champs de l'assistant de création. */
export function slotFormFields(slot: Slot, now: Date = new Date()): { day: string; time: string } {
  const d = suggestedStart(slot, now);
  const deuxCh = (n: number) => String(n).padStart(2, '0');
  return {
    day: `${d.getFullYear()}-${deuxCh(d.getMonth() + 1)}-${deuxCh(d.getDate())}`,
    time: `${deuxCh(d.getHours())}:${deuxCh(d.getMinutes())}`,
  };
}

/** Combien de joueurs manquent pour former une partie (4), moi inclus. */
export function missingPlayers(othersDispoCount: number): number {
  return Math.max(0, 4 - (othersDispoCount + 1));
}

/** La phrase sous les chips de dispo : qui voit ma dispo dès que je la déclare. */
/**
 * Qui voit ma disponibilité, et combien ils sont.
 *
 * Ce compte portait sur les joueurs que JE suis — le mauvais groupe. Ceux qui
 * voient ma dispo sont ceux qui me SUIVENT : leur rail affiche les dispos des
 * joueurs qu'ils suivent, donc les miennes. Et suivre quelqu'un ne lui montre
 * rien de moi, contrairement à ce que conseillait l'ancienne phrase.
 */
export function circleVisibilityLabel(followerCount: number): string {
  if (followerCount <= 0) return 'Personne ne te suit encore : invite des joueurs pour que tes dispos se voient.';
  if (followerCount === 1) return 'Ton abonné le voit tout de suite.';
  return `Tes ${followerCount} abonnés le voient tout de suite.`;
}

// ─── Base de données ──────────────────────────────────────────────────────
// La table n'existe peut-être pas encore (migration non appliquée) : toutes
// ces fonctions se taisent alors, et le hub affiche l'état « pas de dispo ».

const MANQUE = isMissingRelation;

/** Mes dispos à venir. */
export async function fetchMyAvailability(playerId: string): Promise<AvailabilityRow[]> {
  const { data, error } = await supabase
    .from('availability')
    .select('id, slot_start, slot_end, club_id')
    .eq('player_id', playerId)
    .gte('slot_end', new Date().toISOString())
    .order('slot_start');
  if (error) { if (!MANQUE(error)) console.warn('[availability] fetchMine', error); return []; }
  return (data ?? []) as AvailabilityRow[];
}

/** Déclarer un créneau. Rejouable : deux appels ne créent qu'une ligne. */
export async function declareAvailability(playerId: string, slot: Slot): Promise<void> {
  const { error } = await supabase.from('availability').upsert({
    player_id: playerId,
    slot_start: slot.start.toISOString(),
    slot_end: slot.end.toISOString(),
  }, { onConflict: 'player_id,slot_start' });
  if (error && !MANQUE(error)) throw error;
}

/** Retirer un jour déclaré — tout ce qui a été posé sur ce jour-là. */
export async function clearAvailability(playerId: string, slot: Slot): Promise<void> {
  const debutJour = new Date(slot.start.getFullYear(), slot.start.getMonth(), slot.start.getDate());
  const finJour = new Date(debutJour.getTime() + 86_400_000);
  const { error } = await supabase
    .from('availability')
    .delete()
    .eq('player_id', playerId)
    .gte('slot_start', debutJour.toISOString())
    .lt('slot_start', finJour.toISOString());
  if (error && !MANQUE(error)) throw error;
}

/**
 * Qui est dispo sur ce créneau, parmi les joueurs que je suis. Les autres
 * joueurs du même niveau viendront avec le « mercato » (étape suivante).
 */
/**
 * Qui s'est declare libre sur ce creneau, TOUS joueurs confondus.
 *
 * `fetchCircleAvailability` ne regarde que mon cercle — c'est ce qu'il faut
 * dans l'onglet Activite, ou l'on monte une partie avec ses amis. L'accueil,
 * lui, annonce « des joueurs de ton niveau » : la question n'est plus qui je
 * connais, mais qui joue a ma hauteur.
 *
 * Le filtrage par niveau se fait chez l'appelant, avec la bande partagee
 * MERCATO_LEVEL_BAND — pas un troisieme seuil invente ici.
 */
export async function fetchAvailableOnSlot(slot: Slot, excludeId: string, limit = 30): Promise<AvailabilityRow[]> {
  const { data, error } = await supabase
    .from('availability')
    .select('id, player_id, slot_start, slot_end, club_id, player:player_id(id, name, elo_score, avatar_path, member_number)')
    .neq('player_id', excludeId)
    .lt('slot_start', slot.end.toISOString())
    .gt('slot_end', slot.start.toISOString())
    .order('slot_start')
    .limit(limit);
  if (error) { if (!MANQUE(error)) console.warn('[availability] fetchAvailableOnSlot', error); return []; }
  return (data ?? []) as unknown as AvailabilityRow[];
}

export async function fetchCircleAvailability(playerIds: string[], slot: Slot): Promise<AvailabilityRow[]> {
  if (playerIds.length === 0) return [];
  const { data, error } = await supabase
    .from('availability')
    .select('id, player_id, slot_start, slot_end, club_id, player:player_id(id, name, elo_score, avatar_path, member_number)')
    .in('player_id', playerIds)
    .lt('slot_start', slot.end.toISOString())
    .gt('slot_end', slot.start.toISOString())
    .order('slot_start');
  if (error) { if (!MANQUE(error)) console.warn('[availability] fetchCircle', error); return []; }
  return (data ?? []) as unknown as AvailabilityRow[];
}
