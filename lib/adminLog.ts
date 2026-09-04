// lib/adminLog.ts — le journal d'arbitrage, côté lecture.
//
// Implémente `design_handoff_panel_arbitre`, journal d'arbitrage. Les lignes
// sont écrites par la base (admin_actions_log.sql) : ici on ne fait que les
// mettre en français et les ranger par jour.
//
// Les codes d'action viennent du déclencheur SQL et sont volontairement
// stables — c'est un journal, une ligne écrite il y a six mois doit encore se
// lire aujourd'hui. Un code inconnu s'affiche tel quel plutôt que de
// disparaître : une décision qu'on ne sait pas nommer reste une décision, et
// l'effacer de l'écran serait pire que de montrer son code brut.

export interface AdminAction {
  id: string;
  action: string;
  entity_table: string;
  entity_id: string;
  details: Record<string, any> | null;
  created_at: string;
  actor_name: string | null;
  subject_name: string | null;
  subject_id: string | null;
}

export type ActionTone = 'danger' | 'warning' | 'success' | 'info' | 'muted';

const LABEL: Record<string, string> = {
  match_valide_force:  'Match validé de force',
  match_annule:        'Match annulé',
  match_statut:        'Statut de match modifié',
  signalement_retenu:  'Signalement retenu',
  signalement_classe:  'Signalement classé sans suite',
  signalement_statut:  'Signalement mis à jour',
  genre_accepte:       'Changement de genre accepté',
  genre_refuse:        'Changement de genre refusé',
  genre_statut:        'Demande de genre mise à jour',
  genre_modifie:       'Genre modifié',
  frmt_bloque:         'Revendication FRMT bloquée',
  frmt_debloque:       'Revendication FRMT débloquée',
  frmt_lie:            'Joueur lié au classement FRMT',
  frmt_delie:          'Joueur délié du classement FRMT',
  arbitre_nomme:       'Arbitre nommé',
  arbitre_retire:      'Arbitre retiré',
};

const TONE: Record<string, ActionTone> = {
  match_valide_force:  'warning',
  match_annule:        'danger',
  signalement_retenu:  'danger',
  signalement_classe:  'muted',
  genre_accepte:       'success',
  genre_refuse:        'muted',
  genre_modifie:       'info',
  frmt_bloque:         'danger',
  frmt_debloque:       'success',
  frmt_lie:            'success',
  frmt_delie:          'warning',
  arbitre_nomme:       'info',
  arbitre_retire:      'warning',
};

/** Le libellé lisible. Un code inconnu se montre tel quel. */
export function actionLabel(action: string): string {
  return LABEL[action] ?? action;
}

/** La couleur de la ligne. Neutre par défaut : on ne dramatise pas l'inconnu. */
export function actionTone(action: string): ActionTone {
  return TONE[action] ?? 'muted';
}

/**
 * La ligne de détail — ce que la décision a changé, en une phrase.
 *
 * Le score d'un match n'apparaît QUE s'il a effectivement changé : « 6-3, 7-5
 * → 6-3, 7-5 » remplirait le journal de flèches qui ne veulent rien dire.
 */
export function actionSummary(a: AdminAction): string {
  const d = a.details ?? {};
  const parts: string[] = [];
  if (a.subject_name) parts.push(a.subject_name);
  else if (typeof d.nom === 'string' && d.nom) parts.push(d.nom);

  if (a.entity_table === 'matches') {
    const avant = d.score_avant ?? null;
    const apres = d.score_apres ?? null;
    if (avant && apres && avant !== apres) parts.push(`${avant} → ${apres}`);
    else if (apres) parts.push(String(apres));
  } else if (a.action === 'genre_modifie' && d.de && d.vers) {
    parts.push(`${genreLabel(d.de)} → ${genreLabel(d.vers)}`);
  } else if (typeof d.motif === 'string' && d.motif) {
    parts.push(d.motif);
  }
  return parts.join(' · ');
}

function genreLabel(g: string): string {
  return g === 'male' ? 'Homme' : g === 'female' ? 'Femme' : g;
}

/** « 18h04 » — l'heure d'une décision, dans sa journée. */
export function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/** L'en-tête d'un groupe : « Aujourd'hui », « Hier », puis la date. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Date inconnue';
  if (sameDay(d, now)) return 'Aujourd’hui';
  if (sameDay(d, new Date(now.getTime() - 86_400_000))) return 'Hier';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export interface DayGroup {
  /** La clé de journée, stable et triable : « 2026-09-04 ». */
  key: string;
  label: string;
  items: AdminAction[];
}

/** La clé de journée en heure LOCALE — `toISOString` basculerait les
 *  décisions du soir sur le lendemain pour tout fuseau à l'est de Greenwich. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'inconnu';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Regroupe les décisions par journée, la plus récente d'abord.
 *
 * L'ordre d'arrivée est conservé À L'INTÉRIEUR d'un groupe : le serveur les
 * rend déjà de la plus récente à la plus ancienne, et re-trier ici ferait
 * diverger l'affichage de la pagination par curseur.
 */
export function groupByDay(actions: AdminAction[], now: Date = new Date()): DayGroup[] {
  const groups: DayGroup[] = [];
  const index = new Map<string, DayGroup>();
  for (const a of actions) {
    const key = dayKey(a.created_at);
    let g = index.get(key);
    if (!g) {
      g = { key, label: dayLabel(a.created_at, now), items: [] };
      index.set(key, g);
      groups.push(g);
    }
    g.items.push(a);
  }
  return groups;
}

/** Le curseur de la page suivante : la date de la dernière ligne reçue. */
export function nextCursor(actions: AdminAction[]): string | null {
  return actions.length > 0 ? actions[actions.length - 1].created_at : null;
}

/** Lit une page du journal. `before` vient de `nextCursor`. */
export async function fetchAdminLog(
  opts: { limit?: number; before?: string | null; search?: string | null } = {},
): Promise<AdminAction[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('admin_action_log', {
    p_limit: opts.limit ?? 40,
    p_before: opts.before ?? null,
    p_search: opts.search ?? null,
  });
  if (error) throw error;
  return (data as AdminAction[]) ?? [];
}
