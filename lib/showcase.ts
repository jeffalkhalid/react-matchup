// react-matchup/lib/showcase.ts
// Couche données UNIQUE de la vitrine « binômes ouverts aux défis ».
import { supabase } from './supabase';

export interface ShowcasePlayer { id: string; name: string; elo_score: number; court_side?: string | null; }
export interface ShowcaseBinome {
  id: string; player_a: string; player_b: string; status: string; created_at: string;
  a?: ShowcasePlayer | null; b?: ShowcasePlayer | null;
}

const COLS =
  'id, player_a, player_b, status, created_at, ' +
  'a:player_a(id, name, elo_score, court_side), b:player_b(id, name, elo_score, court_side)';

// Vitrine publique : binômes ACTIFS que je peux défier (pas les miens).
export async function fetchVitrine(playerId: string): Promise<ShowcaseBinome[]> {
  const { data, error } = await supabase
    .from('showcase_binomes')
    .select(COLS)
    .eq('status', 'active')
    .neq('player_a', playerId)
    .neq('player_b', playerId)
    .order('created_at', { ascending: false });
  if (error) { console.warn('[showcase] fetchVitrine', error); return []; }
  return (data ?? []) as unknown as ShowcaseBinome[];
}

// Mes vitrines (actives + en attente de confirmation de mon partenaire).
export async function fetchMyShowcases(playerId: string): Promise<ShowcaseBinome[]> {
  const { data, error } = await supabase
    .from('showcase_binomes')
    .select(COLS)
    .or(`player_a.eq.${playerId},player_b.eq.${playerId}`)
    .in('status', ['pending', 'active'])
    .order('created_at', { ascending: false });
  if (error) { console.warn('[showcase] fetchMyShowcases', error); return []; }
  return (data ?? []) as unknown as ShowcaseBinome[];
}

// Nominations à confirmer : on m'a proposé d'être binôme (je suis player_b, pending).
export async function fetchShowcaseInvites(playerId: string): Promise<ShowcaseBinome[]> {
  const { data, error } = await supabase
    .from('showcase_binomes')
    .select(COLS)
    .eq('player_b', playerId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) { console.warn('[showcase] fetchShowcaseInvites', error); return []; }
  return (data ?? []) as unknown as ShowcaseBinome[];
}

export async function openShowcase(partnerId: string): Promise<string> {
  const { data, error } = await supabase.rpc('showcase_open', { p_partner_id: partnerId });
  if (error) throw error;
  return data as string;
}
export async function confirmShowcase(id: string): Promise<void> {
  const { error } = await supabase.rpc('showcase_confirm', { p_id: id });
  if (error) throw error;
}
export async function closeShowcase(id: string): Promise<void> {
  const { error } = await supabase.rpc('showcase_close', { p_id: id });
  if (error) throw error;
}
