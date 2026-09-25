// lib/tournamentReports.ts — « Un score est faux ? », entre la fin de la
// soirée et la validation du classement (table `tournament_reports`).
//
// CE QUE CE N'EST PAS : le litige en cours de soirée. Pendant le jeu, deux
// camps qui se contredisent produisent un état `litige` sur le terrain, et ce
// terrain BLOQUE la rotation jusqu'à l'accord. Ici la soirée est finie, plus
// rien ne bloque, et c'est l'organisateur qui tranche.
//
// Les deux fonctions pures ci-dessous sont le MIROIR côté écran du garde-fou
// SQL : elles évitent de proposer un geste que le serveur refusera. Elles ne
// le remplacent pas — c'est le trigger qui fait foi.
import { validateTournamentScore, type TournamentStatus } from './tournaments';

export interface TournamentReport {
  id: string;
  tournament_id: string;
  match_id: string;
  player_id: string;
  proposed_a: number;
  proposed_b: number;
  status: 'ouvert' | 'accepte' | 'refuse';
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

/**
 * La fenêtre du signalement : `TERMINE`, et rien d'autre.
 *
 * Avant, le désaccord a son propre chemin et il bloque la rotation ; après
 * validation, les points sont crédités et l'ELO a bougé — rouvrir là
 * n'appartient plus à un joueur.
 */
export function canReportNow(status: TournamentStatus): boolean {
  return status === 'TERMINE';
}

/** Ce qui manque pour envoyer, en une phrase — ou `null` si c'est bon.
 *  La règle du score vient de `validateTournamentScore` : un seul endroit
 *  décide qu'un nul est refusé et qu'un 40 est aberrant. */
export function reportIssue(a: number | null, b: number | null): string | null {
  if (a == null || b == null) return 'Entre le score que tu dis être le bon.';
  return validateTournamentScore(a, b);
}

// ── Lecture et écriture ─────────────────────────────────────────────────────

const COLS =
  'id, tournament_id, match_id, player_id, proposed_a, proposed_b, status, resolved_by, resolved_at, created_at';

/** Les signalements visibles pour moi sur ce tournoi. La RLS fait le tri :
 *  un joueur ne voit que les siens, l'organisateur voit tous ceux de son
 *  tournoi. L'écran n'a donc rien à filtrer. */
export async function fetchTournamentReports(tournamentId: string): Promise<TournamentReport[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .from('tournament_reports')
    .select(COLS)
    .eq('tournament_id', tournamentId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as TournamentReport[];
}

export interface ReportResult { ok: boolean; reason?: string }

/** Les refus viennent du trigger (`not_reportable_now`, `not_your_match`,
 *  `match_not_in_tournament`) : on les traduit à l'appel, une fois. */
export async function reportScore(
  tournamentId: string, matchId: string, playerId: string, a: number, b: number,
): Promise<ReportResult> {
  const { supabase } = await import('./supabase');
  const { error } = await supabase.from('tournament_reports').insert({
    tournament_id: tournamentId, match_id: matchId, player_id: playerId,
    proposed_a: a, proposed_b: b,
  });
  if (error) return { ok: false, reason: reportRefusal(error.message) };
  return { ok: true };
}

/** Se rétracter — le serveur ne l'autorise que tant que personne n'a tranché. */
export async function withdrawReport(id: string): Promise<ReportResult> {
  const { supabase } = await import('./supabase');
  const { error } = await supabase.from('tournament_reports').delete().eq('id', id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

/** Trancher : réservé à l'organisateur par la RLS. */
export async function resolveReport(
  id: string, status: 'accepte' | 'refuse', byPlayerId: string,
): Promise<ReportResult> {
  const { supabase } = await import('./supabase');
  const { error } = await supabase.from('tournament_reports')
    .update({ status, resolved_by: byPlayerId, resolved_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

/** Les refus du serveur, dits en français. Un message brut de PostgreSQL
 *  (« new row violates row-level security policy ») n'apprend rien à
 *  personne. */
function reportRefusal(message: string): string {
  if (/not_reportable_now/.test(message)) {
    return 'Ce n’est plus le moment : soit la soirée tourne encore, soit les points sont déjà crédités.';
  }
  if (/not_your_match/.test(message)) return 'On ne signale que les terrains où l’on a joué.';
  if (/match_not_in_tournament/.test(message)) return 'Ce terrain n’appartient pas à cette soirée.';
  if (/duplicate key|unique/i.test(message)) return 'Tu as déjà signalé ce terrain.';
  if (/violates check/i.test(message)) return 'Ce score ne peut pas exister : il faut un vainqueur.';
  if (/row-level security/i.test(message)) return 'Tu n’as pas le droit de signaler ce terrain.';
  return message;
}
