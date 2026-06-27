// lib/clubsMap.ts — charge les clubs géolocalisés, les agrège par position
// et y attache le nombre de parties ouvertes (à venir + joignables) par club.
import { supabase } from './supabase';
import { freeSpots } from './games';
import type { ClubMarker } from './clubsMapHtml';

const norm = (s: string) => s.trim().toLowerCase();

export async function loadClubMarkers(): Promise<ClubMarker[]> {
  // 1) Parties ouvertes par club (nom normalisé → compte)
  const nowIso = new Date().toISOString();
  const { data: games } = await supabase
    .from('open_games')
    .select('location, match_date, status, spots_available, creator_id, participants:game_participants(player_id, status, invite_expires_at)')
    .neq('status', 'cancelled');

  const partiesByClub = new Map<string, number>();
  for (const g of games ?? []) {
    if (!g.location) continue;
    if (!g.match_date || g.match_date < nowIso) continue;
    if (freeSpots(g as any) <= 0) continue;
    const k = norm(g.location);
    partiesByClub.set(k, (partiesByClub.get(k) ?? 0) + 1);
  }

  // 2) Clubs géolocalisés, agrégés par position
  const { data: clubs } = await supabase
    .from('clubs')
    .select('name, latitude, longitude')
    .not('latitude', 'is', null);

  const byPos = new Map<string, ClubMarker>();
  for (const c of clubs ?? []) {
    if (c.latitude == null || c.longitude == null || !c.name) continue;
    const key = `${c.latitude},${c.longitude}`;
    const parties = partiesByClub.get(norm(c.name)) ?? 0;
    let m = byPos.get(key);
    if (!m) {
      m = { lat: c.latitude as number, lng: c.longitude as number, clubs: [], partiesCount: 0 };
      byPos.set(key, m);
    }
    m.clubs.push({ name: c.name as string, partiesCount: parties });
    m.partiesCount += parties;
  }
  return Array.from(byPos.values());
}
