// react-matchup/lib/showcase.ts
// Couche données UNIQUE de la vitrine « binômes ouverts aux défis ».
import { supabase } from './supabase';
import { getHiddenPlayerIds } from './moderation';

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
  const hidden = await getHiddenPlayerIds(playerId);   // modération : masquer les binômes avec un joueur bloqué
  return ((data ?? []) as unknown as ShowcaseBinome[])
    .filter(sb => !hidden.has(sb.player_a) && !hidden.has(sb.player_b));
}

// Mes vitrines = binômes que J'AI initiés (player_a, pending ou active) + binômes
// déjà CONFIRMÉS où je suis le partenaire (player_b, active). On EXCLUT les
// nominations pending qui me sont adressées (player_b + pending) : celles-là
// relèvent de « À confirmer » (fetchShowcaseInvites) avec les boutons
// Confirmer/Refuser — sinon elles atterrissent ici en « EN ATTENTE + Fermer »
// et on ne peut jamais les confirmer.
export async function fetchMyShowcases(playerId: string): Promise<ShowcaseBinome[]> {
  const { data, error } = await supabase
    .from('showcase_binomes')
    .select(COLS)
    .or(`and(player_a.eq.${playerId},status.in.(pending,active)),and(player_b.eq.${playerId},status.eq.active)`)
    .order('created_at', { ascending: false });
  if (error) { console.warn('[showcase] fetchMyShowcases', error); return []; }
  return (data ?? []) as unknown as ShowcaseBinome[];
}

// Binômes ACTIFS d'un joueur (onglet profil « Binômes »). Public : la RLS
// autorise la lecture des lignes status='active' pour tout le monde.
export async function fetchActiveBinomes(playerId: string): Promise<ShowcaseBinome[]> {
  const { data, error } = await supabase
    .from('showcase_binomes')
    .select(COLS)
    .eq('status', 'active')
    .or(`player_a.eq.${playerId},player_b.eq.${playerId}`)
    .order('created_at', { ascending: false });
  if (error) { console.warn('[showcase] fetchActiveBinomes', error); return []; }
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
