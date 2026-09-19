// lib/availability.ts — « Tu es dispo quand ? » du hub Activité.
//
// Trois créneaux proposés dans le header : ce soir, demain, samedi matin.
// La partie CALCUL est pure et testée (lib/__tests__/availability.test.ts) ;
// seules les fonctions du bas parlent à la base (table `availability`,
// migration supabase/migrations/availability.sql).
//
// Une dispo n'est qu'une intention : elle ne réserve rien, elle dit au cercle
// « je peux jouer à ce moment-là ». Elle expire toute seule.
import { supabase } from './supabase';

/** Au-delà, une dispo est effacée par le ménage automatique. */
export const AVAILABILITY_TTL_DAYS = 8;

export type SlotKey = 'tonight' | 'tomorrow' | 'saturday';

export interface Slot {
  key: SlotKey;
  /** Ce qui s'affiche sur la pastille du header. */
  label: string;
  start: Date;
  end: Date;
}

const SOIR_DEBUT = 18;      // « ce soir » commence à 18 h
const JOURNEE_DEBUT = 8;    // une journée de padel commence à 8 h
const MATIN_FIN = 13;       // « samedi matin » s'arrête à 13 h

const a = (d: Date, jours: number, h: number, min = 0) => {
  const x = new Date(d);
  x.setDate(x.getDate() + jours);
  x.setHours(h, min, 0, 0);
  return x;
};

/**
 * Les créneaux proposés à cet instant. « Ce soir » disparaît une fois la nuit
 * passée ; « Sam. matin » vise le samedi du jour même tant que la matinée n'est
 * pas finie, sinon le samedi suivant.
 */
export function availabilitySlots(now: Date = new Date()): Slot[] {
  const out: Slot[] = [];

  // Ce soir : de 18 h (ou de maintenant s'il est plus tard) jusqu'à minuit.
  if (now.getHours() < 24 && now.getHours() >= 0) {
    const finSoir = a(now, 1, 0);
    const debutSoir = now.getHours() >= SOIR_DEBUT ? new Date(now) : a(now, 0, SOIR_DEBUT);
    if (debutSoir.getTime() < finSoir.getTime() && now.getHours() >= JOURNEE_DEBUT - 2) {
      out.push({ key: 'tonight', label: 'Ce soir', start: debutSoir, end: finSoir });
    }
  }

  out.push({ key: 'tomorrow', label: 'Demain', start: a(now, 1, JOURNEE_DEBUT), end: a(now, 2, 0) });

  // Samedi matin : aujourd'hui si on est samedi avant 13 h, sinon le prochain.
  const jour = now.getDay();                 // 0 = dimanche, 6 = samedi
  const estSamedi = jour === 6;
  const matinPasse = estSamedi && now.getHours() >= MATIN_FIN;
  const versSamedi = estSamedi && !matinPasse ? 0 : ((6 - jour + 7) % 7) || 7;
  out.push({
    key: 'saturday', label: 'Sam. matin',
    start: a(now, versSamedi, JOURNEE_DEBUT),
    end: a(now, versSamedi, MATIN_FIN),
  });

  return out;
}

/** Le créneau d'une clé, ou `null` s'il n'est plus proposé à cette heure-ci. */
export function slotFromKey(key: SlotKey, now: Date = new Date()): Slot | null {
  return availabilitySlots(now).find(s => s.key === key) ?? null;
}

const heure = (d: Date) => (d.getHours() === 0 ? 'minuit' : `${d.getHours()}h${d.getMinutes() ? String(d.getMinutes()).padStart(2, '0') : ''}`);
const JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

/** « Ce soir · 18h – minuit », « Samedi · 8h – 13h ». */
export function slotLabel(slot: Slot, now: Date = new Date()): string {
  const memeJour = slot.start.toDateString() === now.toDateString();
  const demain = slot.start.toDateString() === new Date(now.getTime() + 86_400_000).toDateString();
  const jour = slot.key === 'tonight' || (memeJour && slot.start.getHours() >= SOIR_DEBUT)
    ? 'Ce soir'
    : demain ? 'Demain' : JOURS[slot.start.getDay()];
  return `${jour} · ${heure(slot.start)} – ${heure(slot.end)}`;
}

export interface AvailabilityRow {
  id?: string;
  player_id?: string;
  slot_start: string;
  slot_end: string;
  club_id?: string | null;
  player?: { id: string; name: string; elo_score: number; avatar_path?: string | null } | null;
}

/** Tolérance : l'heure a pu avancer entre la déclaration et l'affichage. */
const PROCHE_MS = 90 * 60_000;

/** Ce créneau est-il déjà déclaré parmi mes dispos ? */
export function isSlotActive(slot: Slot, mine: Pick<AvailabilityRow, 'slot_start' | 'slot_end'>[]): boolean {
  return mine.some(r => {
    const s = Date.parse(r.slot_start);
    const e = Date.parse(r.slot_end);
    if (Number.isNaN(s) || Number.isNaN(e)) return false;
    return Math.abs(s - slot.start.getTime()) < PROCHE_MS && Math.abs(e - slot.end.getTime()) < PROCHE_MS;
  });
}

// ─── Base de données ──────────────────────────────────────────────────────
// La table n'existe peut-être pas encore (migration non appliquée) : toutes
// ces fonctions se taisent alors, et le hub affiche l'état « pas de dispo ».

const MANQUE = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42P01' || /relation .*availability.* does not exist/i.test(e.message ?? ''));

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

/** Retirer un créneau déclaré. */
export async function clearAvailability(playerId: string, slot: Slot): Promise<void> {
  const { error } = await supabase
    .from('availability')
    .delete()
    .eq('player_id', playerId)
    .gte('slot_start', new Date(slot.start.getTime() - PROCHE_MS).toISOString())
    .lte('slot_start', new Date(slot.start.getTime() + PROCHE_MS).toISOString());
  if (error && !MANQUE(error)) throw error;
}

/**
 * Qui est dispo sur ce créneau, parmi les joueurs que je suis. Les autres
 * joueurs du même niveau viendront avec le « mercato » (étape suivante).
 */
export async function fetchCircleAvailability(playerIds: string[], slot: Slot): Promise<AvailabilityRow[]> {
  if (playerIds.length === 0) return [];
  const { data, error } = await supabase
    .from('availability')
    .select('id, player_id, slot_start, slot_end, club_id, player:player_id(id, name, elo_score, avatar_path)')
    .in('player_id', playerIds)
    .lt('slot_start', slot.end.toISOString())
    .gt('slot_end', slot.start.toISOString())
    .order('slot_start');
  if (error) { if (!MANQUE(error)) console.warn('[availability] fetchCircle', error); return []; }
  return (data ?? []) as unknown as AvailabilityRow[];
}
