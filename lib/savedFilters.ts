// lib/savedFilters.ts — les filtres enregistrés, et l'alerte qui va avec.
//
// Sur un marché clairsemé, le problème n'est pas de trier trop de parties,
// c'est de ne pas savoir QUAND la bonne apparaît. Enregistrer un filtre pour
// le rejouer à la main ne vaut pas grand-chose ; enregistrer un filtre qui
// vous prévient, si.
//
// LA DISTINCTION QUI GOUVERNE CE FICHIER : tous les critères ne peuvent pas
// devenir une alerte.
//
//   « Ce week-end », « il reste une place », « urgent » se lisent par rapport
//   à l'instant où l'on regarde. Une alerte permanente « ce week-end » n'a
//   aucun sens — quel week-end ?
//
//   Le club, la ville, le type, le genre, la tranche horaire et le niveau
//   décrivent la partie qu'on cherche, pas le moment où on la cherche.
//
// Le filtre est enregistré ENTIER — l'écran le rejoue en entier. Mais l'alerte
// n'en surveille qu'une partie, et l'écran doit le DIRE : croire qu'on sera
// prévenu sur un critère que personne ne surveille est pire que ne pas avoir
// d'alerte du tout.

import {
  NO_EXPLORE_FILTERS, type ExploreFilters,
} from './exploreFilters';
import { isZoneRadius } from './geo';

export interface SavedFilter {
  id: string;
  name: string;
  criteria: ExploreFilters;
  alert: boolean;
  created_at: string;
  last_alert_at?: string | null;
}

/** Les critères qu'une alerte sait surveiller — la distance depuis le lot 4
 *  (mesurée côté serveur depuis `player_zones`, jamais depuis le GPS). */
export const ALERTABLE_KEYS = ['clubs', 'cities', 'type', 'gender', 'slot', 'level', 'maxKm'] as const;
/** Ceux qui n'ont de sens qu'au moment où l'on regarde. */
export const VIEW_ONLY_KEYS = ['date', 'spots', 'fill', 'urgentOnly', 'search'] as const;

/**
 * Les critères de ce filtre qu'une alerte surveillera réellement, et ceux
 * qu'elle ignorera. L'écran s'en sert pour le dire avant d'enregistrer.
 */
export function alertCoverage(f: ExploreFilters): { watched: string[]; ignored: string[] } {
  const watched: string[] = [];
  const ignored: string[] = [];
  if (f.clubs.length > 0) watched.push('Club');
  if (f.cities.length > 0) watched.push('Ville');
  if (f.type !== 'all') watched.push('Type de match');
  if (f.gender !== 'all') watched.push('Genre');
  if (f.slot !== 'any') watched.push('Plage horaire');
  if (f.level !== 'all') watched.push('Niveau');
  // Mesurée depuis la zone du joueur au moment où la partie est créée — pas
  // depuis le GPS, jamais envoyé au serveur (supabase/migrations/saved_filters_distance.sql).
  if (f.maxKm !== null) watched.push(`Distance : moins de ${f.maxKm} km de ta zone`);
  if (f.date !== 'any') ignored.push('Date');
  if (f.spots !== null) ignored.push('Places libres');
  if (f.fill !== 'any') ignored.push(f.fill === 'open' ? 'Parties ouvertes' : 'Complètes');
  if (f.urgentOnly) ignored.push('Urgent');
  if (f.search.trim()) ignored.push('Recherche');
  return { watched, ignored };
}

/**
 * Une alerte sans aucun critère stable préviendrait à CHAQUE partie créée.
 * Ce n'est pas une alerte, c'est du bruit — l'écran doit l'empêcher.
 */
export function canAlert(f: ExploreFilters): boolean {
  return alertCoverage(f).watched.length > 0;
}

/** Un nom proposé, tiré de ce que le filtre dit réellement. */
export function suggestFilterName(f: ExploreFilters): string {
  const bouts: string[] = [];
  if (f.cities.length === 1) bouts.push(f.cities[0]);
  else if (f.cities.length > 1) bouts.push(`${f.cities.length} villes`);
  if (f.clubs.length === 1) bouts.push(f.clubs[0]);
  else if (f.clubs.length > 1) bouts.push(`${f.clubs.length} clubs`);
  if (f.maxKm !== null) bouts.push(`Moins de ${f.maxKm} km`);
  if (f.type === 'competitive') bouts.push('Compétitif');
  if (f.type === 'friendly') bouts.push('Amical');
  if (f.type === 'challenge') bouts.push('Défi');
  if (f.slot === 'morning') bouts.push('Matin');
  if (f.slot === 'afternoon') bouts.push('Après-midi');
  if (f.slot === 'evening') bouts.push('Soir');
  if (f.slot === 'night') bouts.push('Nuit');
  if (f.gender === 'men') bouts.push('Hommes');
  if (f.gender === 'women') bouts.push('Femmes');
  if (f.gender === 'mixed') bouts.push('Mixte');
  if (f.level === 'mine') bouts.push('Mon niveau');
  if (f.urgentOnly) bouts.push('Urgent');
  return bouts.length > 0 ? bouts.slice(0, 3).join(' · ') : 'Mon filtre';
}

/**
 * Un filtre relu depuis la base, complété des valeurs par défaut.
 *
 * Le `criteria` stocké peut dater d'une version qui ne connaissait pas encore
 * une dimension. Sans ce complètement, `f.clubs.length` planterait sur un
 * filtre enregistré avant l'ajout des clubs.
 */
export function hydrateFilter(raw: unknown): ExploreFilters {
  const c = (raw && typeof raw === 'object') ? raw as Partial<ExploreFilters> : {};
  return {
    ...NO_EXPLORE_FILTERS,
    ...c,
    clubs: Array.isArray(c.clubs) ? c.clubs : [],
    cities: Array.isArray(c.cities) ? c.cities : [],
    search: typeof c.search === 'string' ? c.search : '',
    maxKm: isZoneRadius(c.maxKm) ? c.maxKm : null,
    fill: c.fill === 'open' || c.fill === 'full' ? c.fill : 'any',
  };
}

/** Le nom, nettoyé et borné. Vide → le nom proposé. */
export function normalizeFilterName(name: string, f: ExploreFilters): string {
  const n = name.trim().replace(/\s+/g, ' ');
  return (n || suggestFilterName(f)).slice(0, 40);
}

/**
 * Une alerte avec distance a besoin d'une zone pour se déclencher — le
 * serveur mesure depuis `player_zones`, jamais depuis le GPS. Sans zone,
 * l'alerte est enregistrable (elle marchera dès que la zone sera choisie),
 * mais l'écran doit le dire avant d'enregistrer.
 */
export function alertNeedsZone(f: ExploreFilters, hasZone: boolean): boolean {
  return f.maxKm !== null && !hasZone;
}

/** Combien de filtres enregistrés ont une alerte active ET portent une distance. */
export function distanceAlertCount(saved: SavedFilter[]): number {
  return saved.filter(sf => sf.alert && sf.criteria.maxKm !== null).length;
}

/**
 * Le message avant de supprimer sa zone. Sans alerte à distance, rien ne
 * change : le message reste celui d'avant le lot 4. Singulier pour une seule
 * alerte — « tes 1 alertes » ne se dit pas.
 */
export function zoneDeletionMessage(n: number): string {
  const base = 'Les distances ne seront plus calculées depuis cette zone.';
  if (n <= 0) return base;
  if (n === 1) return `${base} Ton alerte avec distance ne se déclenchera plus.`;
  return `${base} Tes ${n} alertes avec distance ne se déclencheront plus.`;
}

// ─── Accès base ───────────────────────────────────────────────────────────
// Import supabase paresseux : tout ce qui précède reste testable sans env.

export async function listSavedFilters(): Promise<SavedFilter[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .from('saved_filters')
    .select('id, name, criteria, alert, created_at, last_alert_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(r => ({ ...r, criteria: hydrateFilter(r.criteria) })) as SavedFilter[];
}

export async function createSavedFilter(
  playerId: string, name: string, criteria: ExploreFilters, alert: boolean,
): Promise<void> {
  const { supabase } = await import('./supabase');
  const { error } = await supabase.from('saved_filters').insert({
    player_id: playerId,
    name: normalizeFilterName(name, criteria),
    criteria,
    // Une alerte sans critère stable préviendrait à chaque partie créée.
    alert: alert && canAlert(criteria),
  });
  if (error) throw error;
}

export async function setSavedFilterAlert(id: string, alert: boolean): Promise<void> {
  const { supabase } = await import('./supabase');
  const { error } = await supabase.from('saved_filters').update({ alert }).eq('id', id);
  if (error) throw error;
}

export async function deleteSavedFilter(id: string): Promise<void> {
  const { supabase } = await import('./supabase');
  const { error } = await supabase.from('saved_filters').delete().eq('id', id);
  if (error) throw error;
}
