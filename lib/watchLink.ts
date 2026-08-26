// Appairage montre ↔ compte : le téléphone génère un code éphémère, la montre
// l'échange contre un jeton durable. Cf. docs/superpowers/specs/2026-08-25-app-montre-design.md §5
// Import supabase paresseux : les fonctions pures (formatCode) restent testables sans env.

export type WatchLink = {
  id: string;
  device_label: string | null;
  created_at: string;
  last_seen_at: string | null;
};

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
