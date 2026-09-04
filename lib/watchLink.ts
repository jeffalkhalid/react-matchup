// Appairage montre ↔ compte : le téléphone génère un code éphémère, la montre
// l'échange contre un jeton durable. Cf. docs/superpowers/specs/2026-08-25-app-montre-design.md §5
// Import supabase paresseux : les fonctions pures (formatCode) restent testables sans env.

export type WatchLink = {
  id: string;
  device_label: string | null;
  created_at: string;
  last_seen_at: string | null;
  /**
   * Combien de matchs ont été marqués depuis cet appareil. OPTIONNEL à
   * dessein : il vient de la migration watch_link_details.sql, et tant
   * qu'elle n'est pas appliquée le champ est absent. L'écran n'affiche
   * alors simplement pas la ligne, au lieu d'afficher « 0 matchs » — ce
   * qui serait faux.
   */
  matches_count?: number;
};

/** Le nom affiché : une montre sans nom reste une montre. */
export function deviceName(l: Pick<WatchLink, 'device_label'>): string {
  return (l.device_label ?? '').trim() || 'Montre';
}

/** « Aucun match marqué » / « 1 match marqué » / « 7 matchs marqués ». */
export function matchesLabel(n: number): string {
  if (n <= 0) return 'Aucun match marqué depuis cette montre';
  return n === 1 ? '1 match marqué depuis cette montre' : `${n} matchs marqués depuis cette montre`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function hhmm(d: Date): string {
  return `${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * La dernière synchro, en langage humain.
 *
 * C'est la seule preuve que la liaison FONCTIONNE encore : une montre vue
 * il y a dix minutes n'inquiète pas, une montre jamais vue depuis
 * l'appairage veut dire que l'app montre n'a pas été ouverte. La date brute
 * ne disait ni l'un ni l'autre.
 */
export function lastSeenLabel(lastSeenAt: string | null, now: Date = new Date()): string {
  if (!lastSeenAt) return 'Jamais utilisée';
  const d = new Date(lastSeenAt);
  if (Number.isNaN(d.getTime())) return 'Jamais utilisée';
  const min = (now.getTime() - d.getTime()) / 60_000;
  // Une horloge de montre peut avancer sur celle du téléphone : une date
  // « dans le futur » se lit à l'instant, jamais « il y a -3 min ».
  if (min < 2) return 'À l’instant';
  if (min < 60) return `Il y a ${Math.floor(min)} min`;
  if (sameDay(d, now)) return `Aujourd’hui à ${hhmm(d)}`;
  const hier = new Date(now.getTime() - 86_400_000);
  if (sameDay(d, hier)) return `Hier à ${hhmm(d)}`;
  return `Le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
}

/** « Connectée depuis le 12 août ». */
export function linkedSinceLabel(createdAt: string): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return '';
  return `Connectée depuis le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
}

// « 123 456 » se relit et se saisit plus sûrement que « 123456 » sur un petit écran.
export function formatCode(code: string): string {
  return /^\d{6}$/.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

// Interrupteur global du Panel Arbitre (app_config.watch_pairing_enabled).
// Absent ou illisible → considéré ACTIVÉ : on ne cache jamais la
// fonctionnalité à cause d'un aléa réseau. Le vrai verrou est côté serveur,
// celui-ci ne fait que masquer l'entrée du menu.
export async function getWatchPairingEnabled(): Promise<boolean> {
  try {
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase
      .from('app_config').select('value').eq('key', 'watch_pairing_enabled').maybeSingle();
    if (error) return true;
    return data?.value !== 'false';
  } catch {
    return true;
  }
}

export async function createPairingCode(): Promise<string> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('create_watch_pairing_code');
  if (error) throw error;
  return data as string;
}

export async function listWatchLinks(): Promise<WatchLink[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('list_watch_links');
  if (error) throw error;
  return (data as WatchLink[]) ?? [];
}

export async function revokeWatchLink(id: string): Promise<void> {
  const { supabase } = await import('./supabase');
  const { error } = await supabase.rpc('revoke_watch_link', { p_link_id: id });
  if (error) throw error;
}

/**
 * Renommer un appareil. Avec deux montres liées, la liste affichait deux fois
 * « Montre » et délier revenait à tirer au sort.
 *
 * La RPC vient de watch_link_details.sql. Tant qu'elle n'est pas appliquée,
 * PostgREST répond « fonction inconnue » : on traduit, plutôt que de laisser
 * remonter un message technique en anglais.
 */
export async function renameWatchLink(id: string, label: string): Promise<void> {
  const { supabase } = await import('./supabase');
  const { error } = await supabase.rpc('rename_watch_link', { p_link_id: id, p_label: label });
  if (!error) return;
  const msg = `${error.message ?? ''} ${(error as any).details ?? ''}`.toLowerCase();
  if (msg.includes('could not find') || msg.includes('does not exist') || (error as any).code === 'PGRST202') {
    throw new Error('Renommer n’est pas encore disponible sur ce compte.');
  }
  throw error;
}
