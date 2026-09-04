// lib/clubFavorites.ts — clubs favoris du joueur (table club_favorites).
// Source unique pour le wizard (chips favoris) et l'écran « Gérer mes clubs ».
// Les favoris référencent le NOM du club, comme form.location / games.location.
// Import supabase paresseux : les fonctions pures restent testables sans env.

/** Ajoute (en fin) ou retire un club de la liste. Ne mute pas l'entrée. */
export function toggleFavorite(list: string[], name: string): string[] {
  return list.includes(name) ? list.filter(c => c !== name) : [...list, name];
}

/** Déplace un club d'une position (dir -1 = monter, 1 = descendre). No-op aux bords. */
export function moveFavorite(list: string[], name: string, dir: -1 | 1): string[] {
  const i = list.indexOf(name);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Favoris du joueur, ordonnés par position. */
export async function loadClubFavorites(playerId: string): Promise<string[]> {
  const { supabase } = await import('./supabase');
  const { data } = await supabase
    .from('club_favorites')
    .select('club_name')
    .eq('player_id', playerId)
    .order('position');
  return (data ?? []).map((r: any) => r.club_name as string);
}

/** Persiste la liste complète (positions 0..n) puis purge les favoris retirés. */
export async function saveClubFavorites(playerId: string, list: string[]): Promise<void> {
  const { supabase } = await import('./supabase');
  if (list.length > 0) {
    await supabase.from('club_favorites').upsert(
      list.map((club_name, position) => ({ player_id: playerId, club_name, position })),
      { onConflict: 'player_id,club_name' },
    );
  }
  const del = supabase.from('club_favorites').delete().eq('player_id', playerId);
  if (list.length > 0) {
    await del.not('club_name', 'in', `(${list.map(n => `"${n.replace(/"/g, '\\"')}"`).join(',')})`);
  } else {
    await del;
  }
}
