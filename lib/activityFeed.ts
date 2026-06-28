// Couche données du feed Activité enrichi (sections au-dessus du fil amis).
// Toutes les fonctions dégradent proprement si une RPC/colonne manque.
import { supabase } from './supabase';
import { freeSpots } from './games';
import type { ActivityEvent } from '../types';

// ── Ta semaine ───────────────────────────────────────────────
export type WeekStats = { matches: number; results: ('W' | 'L')[]; eloDelta: number };

export async function getWeekStats(uid: string, days = 7): Promise<WeekStats> {
  try {
    const { data, error } = await supabase.rpc('activity_week_stats', { p_uid: uid, p_days: days });
    if (error || !data || !data[0]) return { matches: 0, results: [], eloDelta: 0 };
    const row: any = data[0];
    return {
      matches: row.matches ?? 0,
      results: (row.results ?? []) as ('W' | 'L')[],
      eloDelta: Number(row.elo_delta ?? 0),
    };
  } catch {
    return { matches: 0, results: [], eloDelta: 0 };
  }
}

// ── Hero « Il manque 1 joueur » ─────────────────────────────
export type SuggestedGame = {
  gameId: string; location: string | null; matchDate: string;
  gameFormat: string | null; freeSpots: number; friendsIn: number;
};

export async function getSuggestedGame(uid: string): Promise<SuggestedGame | null> {
  try {
    const { data, error } = await supabase.rpc('suggested_open_game', { p_uid: uid });
    if (error || !data || !data[0]) return null;
    const r: any = data[0];
    return {
      gameId: r.game_id, location: r.location, matchDate: r.match_date,
      gameFormat: r.game_format, freeSpots: r.free_spots ?? 1, friendsIn: r.friends_in ?? 0,
    };
  } catch {
    return null;
  }
}

// ── Joue ce week-end ─────────────────────────────────────────
export type WeekendGame = {
  id: string; location: string | null; matchDate: string;
  gameFormat: string | null; freeSpots: number;
};

function nextWeekendBounds(now = new Date()): { from: string; to: string } {
  // Du samedi 00h au dimanche 23h59 de la semaine en cours / à venir.
  const d = new Date(now);
  const day = d.getDay(); // 0 dim … 6 sam
  const daysToSat = (6 - day + 7) % 7; // prochain samedi (0 si on est samedi)
  const sat = new Date(d); sat.setDate(d.getDate() + daysToSat); sat.setHours(0, 0, 0, 0);
  const sun = new Date(sat); sun.setDate(sat.getDate() + 1); sun.setHours(23, 59, 59, 999);
  return { from: sat.toISOString(), to: sun.toISOString() };
}

export async function getWeekendGames(uid: string): Promise<WeekendGame[]> {
  try {
    const { from, to } = nextWeekendBounds();
    const { data, error } = await supabase
      .from('open_games')
      .select('id, location, match_date, game_format, spots_available, creator_id, participants:game_participants(player_id, status, invite_expires_at)')
      .eq('status', 'open')
      .gte('match_date', from)
      .lte('match_date', to)
      .order('match_date', { ascending: true })
      .limit(10);
    if (error || !data) return [];
    return (data as any[])
      // exclure mes propres parties + celles où je suis déjà inscrit/invité
      .filter(g => g.creator_id !== uid && !(g.participants ?? []).some((p: any) => p.player_id === uid))
      .map(g => ({
        id: g.id, location: g.location, matchDate: g.match_date,
        gameFormat: g.game_format, freeSpots: freeSpots(g),
      }))
      .filter(g => g.freeSpots > 0);
  } catch {
    return [];
  }
}

// Parties ouvertes à venir (toutes, pas que le week-end) — pour l'onboarding.
// Exclut mes parties + déjà rejointes, places libres uniquement.
export async function getOpenGames(uid: string, limit = 8): Promise<WeekendGame[]> {
  try {
    const nowISO = new Date().toISOString();
    const { data, error } = await supabase
      .from('open_games')
      .select('id, location, match_date, game_format, spots_available, creator_id, participants:game_participants(player_id, status, invite_expires_at)')
      .eq('status', 'open')
      .gte('match_date', nowISO)
      .order('match_date', { ascending: true })
      .limit(limit * 2);
    if (error || !data) return [];
    return (data as any[])
      .filter(g => g.creator_id !== uid && !(g.participants ?? []).some((p: any) => p.player_id === uid))
      .map(g => ({ id: g.id, location: g.location, matchDate: g.match_date, gameFormat: g.game_format, freeSpots: freeSpots(g) }))
      .filter(g => g.freeSpots > 0)
      .slice(0, limit);
  } catch {
    return [];
  }
}

// ── Moments = highlights curés (matchs partagés + bilans), 7 j ──────
// (rendus depuis activity_events, AUCUN média serveur)
// Fenêtre + tri sur la DATE DE MISE EN AVANT (`highlighted_at`, repli `created_at`
// pour les anciens highlights) : partager un match ancien le fait bien apparaître
// dans « Moments de la semaine ». Tri robuste : MES moments d'abord (récent →
// ancien), PUIS ceux des amis (récent → ancien) → mon partage toujours visible en
// tête, indépendamment de l'activité des amis. `myId` optionnel (rétro-compat).
export function pickMoments(feed: ActivityEvent[], myId?: string, max = 6, days = 7): ActivityEvent[] {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const ts = (e: ActivityEvent) => new Date(e.highlighted_at ?? e.created_at).getTime();
  const byRecency = (a: ActivityEvent, b: ActivityEvent) => ts(b) - ts(a);
  const highlights = feed.filter(e => e.is_highlight && ts(e) >= since);
  const mine = highlights.filter(e => e.player_id === myId).sort(byRecency);
  const others = highlights.filter(e => e.player_id !== myId).sort(byRecency);
  return [...mine, ...others].slice(0, max);
}

// ── Partage in-app ───────────────────────────────────────────
// Renvoie null si OK, sinon le message d'erreur (pour l'afficher à l'utilisateur).
export async function shareMatchMoment(matchId: string, caption: string): Promise<string | null> {
  try {
    const { error } = await supabase.rpc('share_match_moment', { p_match_id: matchId, p_caption: caption.trim() || null });
    if (error) { console.log('[shareMatchMoment]', error.message); return error.message; }
    return null;
  } catch (e: any) { console.log('[shareMatchMoment] threw', String(e)); return String(e?.message ?? e); }
}

// Poste le bilan mensuel dans le fil des amis (post in-app).
export async function postBilan(month: string, payload: Record<string, unknown>): Promise<string | null> {
  try {
    const { error } = await supabase.rpc('post_bilan', { p_month: month, p_payload: payload });
    if (error) { console.log('[postBilan]', error.message); return error.message; }
    return null;
  } catch (e: any) { console.log('[postBilan] threw', String(e)); return String(e?.message ?? e); }
}

// ── État de l'écran Activité (états vides) ───────────────────
export type ActivityState = 'onboarding' | 'friends_inactive' | 'nominal';

// Nb total de matchs joués (tous slots). head:true → pas de payload.
export async function getMyMatchCount(uid: string): Promise<number> {
  try {
    const { count } = await supabase.from('matches')
      .select('id', { count: 'exact', head: true })
      .or(`winner_id.eq.${uid},loser_id.eq.${uid},winner_id_2.eq.${uid},loser_id_2.eq.${uid}`);
    return count ?? 0;
  } catch { return 0; }
}

// Nb de parties créées OU rejointes (open_games + game_participants).
// « Créer un match » crée une partie (pas une ligne `matches`) → sert à savoir
// si l'utilisateur a déjà engagé une activité (sortie d'onboarding).
export async function getMyGameCount(uid: string): Promise<number> {
  try {
    const [created, joined] = await Promise.all([
      supabase.from('open_games').select('id', { count: 'exact', head: true }).eq('creator_id', uid),
      supabase.from('game_participants').select('id', { count: 'exact', head: true }).eq('player_id', uid),
    ]);
    return (created.count ?? 0) + (joined.count ?? 0);
  } catch { return 0; }
}

// Détermine l'état d'affichage à partir de données déjà chargées.
//  - onboarding : aucune activité du tout (ni match enregistré, ni partie créée/rejointe).
//  - friends_inactive : a déjà de l'activité, ≥1 ami, mais 0 activité d'amis sur 7 j.
//  - nominal : sinon.
export function deriveActivityState(args: {
  totalMatches: number; totalGames: number; friendsCount: number; recentFriendActivity: number;
}): ActivityState {
  if (args.totalMatches === 0 && args.totalGames === 0) return 'onboarding';
  if (args.friendsCount >= 1 && args.recentFriendActivity === 0) return 'friends_inactive';
  return 'nominal';
}
