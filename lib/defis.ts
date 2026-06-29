// react-matchup/lib/defis.ts
// Couche données UNIQUE du hub Défi 2v2 (modèle ouvert : open_games is_challenge
// + defi_applications + RPC defi_apply/defi_accept). Tout accès Supabase lié aux
// défis passe par ici — les écrans ne font pas de requête défi en direct.
import { supabase } from './supabase';

export interface DefiPlayer { id: string; name: string; elo_score: number; }
export interface DefiParticipant {
  id: string; player_id: string; status: string; team_side: string | null;
  player?: DefiPlayer | null;
}
export interface DefiGame {
  id: string; creator_id: string; status: string;
  is_challenge: boolean; stake_multiplier: number | null;
  min_elo: number | null; max_elo: number | null;
  match_date: string | null; location: string | null;
  creator?: DefiPlayer | null;
  participants?: DefiParticipant[] | null;
}
export interface DefiApplication {
  id: string; game_id: string; initiator_id: string; partner_id: string;
  status: string; created_at: string;
  initiator?: DefiPlayer | null; partner?: DefiPlayer | null;
  game?: DefiGame | null;
}

const GAME_COLS =
  'id, creator_id, status, is_challenge, stake_multiplier, min_elo, max_elo, match_date, location, ' +
  'creator:creator_id(id, name, elo_score), ' +
  'participants:game_participants(id, player_id, status, team_side, player:player_id(id, name, elo_score))';

// ── Helpers d'éligibilité (moyenne du binôme dans la bande du défi) ──
export function binomeAvg(eloA: number, eloB: number): number {
  return (eloA + eloB) / 2;
}
export function isBinomeEligible(eloA: number, eloB: number, minElo: number | null, maxElo: number | null): boolean {
  const avg = binomeAvg(eloA, eloB);
  return avg >= (minElo ?? 0) && avg <= (maxElo ?? 999999);
}

// ── À relever : défis OUVERTS d'autres joueurs où je ne suis pas déjà engagé ──
export async function fetchOpenDefis(playerId: string): Promise<DefiGame[]> {
  const { data, error } = await supabase
    .from('open_games')
    .select(GAME_COLS)
    .eq('is_challenge', true)
    .eq('status', 'open')
    .neq('creator_id', playerId)
    .order('match_date', { ascending: true });
  if (error) { console.warn('[defis] fetchOpenDefis', error); return []; }
  const rows = (data ?? []) as unknown as DefiGame[];
  // Exclure ceux où je suis déjà participant (créateur exclu par la requête).
  return rows.filter(g => !(g.participants ?? []).some(p => p.player_id === playerId));
}

// ── Mes défis : ceux que J'AI créés (draft/open/confirmed) ──
export async function fetchMyDefis(playerId: string): Promise<DefiGame[]> {
  const { data, error } = await supabase
    .from('open_games')
    .select(GAME_COLS)
    .eq('is_challenge', true)
    .eq('creator_id', playerId)
    .in('status', ['draft', 'open', 'confirmed'])
    .order('match_date', { ascending: true });
  if (error) { console.warn('[defis] fetchMyDefis', error); return []; }
  return (data ?? []) as unknown as DefiGame[];
}

const APP_COLS =
  'id, game_id, initiator_id, partner_id, status, created_at, ' +
  'initiator:initiator_id(id, name, elo_score), ' +
  'partner:partner_id(id, name, elo_score), ' +
  `game:game_id(${GAME_COLS})`;

// ── Candidatures sur MES défis (binômes qui postulent) ──
export async function fetchCandidaturesOnMyDefis(playerId: string): Promise<DefiApplication[]> {
  // 1) mes défis (ids) ; 2) candidatures liées. Deux étapes pour éviter un embed
  // filtré complexe côté PostgREST.
  const mine = await fetchMyDefis(playerId);
  const ids = mine.map(g => g.id);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('defi_applications')
    .select(APP_COLS)
    .in('game_id', ids)
    .in('status', ['pending', 'locked'])
    .order('created_at', { ascending: true });
  if (error) { console.warn('[defis] fetchCandidaturesOnMyDefis', error); return []; }
  return (data ?? []) as unknown as DefiApplication[];
}

// ── Invitations binôme : on m'a invité comme PARTENAIRE pour relever ──
export async function fetchBinomeInvitations(playerId: string): Promise<DefiApplication[]> {
  const { data, error } = await supabase
    .from('defi_applications')
    .select(APP_COLS)
    .eq('partner_id', playerId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) { console.warn('[defis] fetchBinomeInvitations', error); return []; }
  return (data ?? []) as unknown as DefiApplication[];
}

// ── Mutations (RPC Phase 1) ──
export async function applyToDefi(gameId: string, partnerId: string): Promise<string> {
  const { data, error } = await supabase.rpc('defi_apply', { p_game_id: gameId, p_partner_id: partnerId });
  if (error) throw error;
  return data as string; // id de la candidature
}
export async function acceptBinomeInvitation(appId: string): Promise<string> {
  const { data, error } = await supabase.rpc('defi_accept', { p_app_id: appId });
  if (error) throw error;
  return data as string; // 'locked' | 'too_late'
}
export async function cancelDefi(gameId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_defi', { p_game_id: gameId });
  if (error) throw error;
}
