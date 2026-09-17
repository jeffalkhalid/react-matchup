// lib/playerZone.ts — la zone de référence du joueur (table player_zones).
//
// Un point choisi sur la carte, arrondi (~500 m), et un rayon. La position
// GPS n'est JAMAIS enregistrée ici.
//
// Si la migration n'est pas appliquée, la table n'existe pas : fetchMyZone le
// dit (`status: 'missing'`) et l'app masque tout ce qui touche à la zone.
// Un échec réseau (`status: 'error'`) est DIFFÉRENT : il ne veut pas dire
// « pas de zone », seulement « on ne sait pas encore » — hooks/useOrigin.ts
// s'en sert pour proposer de réessayer plutôt que d'afficher « aucune zone ».
import { roundZoneCoord, isZoneRadius, DEFAULT_RADIUS_KM, type ZonePoint } from './geo';

export function isMissingTableError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const m = error.message ?? '';
  return /player_zones/.test(m) && /does not exist|could not find/i.test(m);
}

export type ZoneStatus = 'ok' | 'missing' | 'error';

/** Pas d'erreur → 'ok' ; table absente → 'missing' ; toute autre erreur → 'error'. */
export function zoneFetchStatus(error: { code?: string; message?: string } | null | undefined): ZoneStatus {
  if (!error) return 'ok';
  return isMissingTableError(error) ? 'missing' : 'error';
}

export function zoneFromRow(row: unknown): ZonePoint | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as { lat?: unknown; lng?: unknown; radius_km?: unknown };
  const lat = Number(r.lat);
  const lng = Number(r.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const rayon = Number(r.radius_km);
  return { lat, lng, radiusKm: isZoneRadius(rayon) ? rayon : DEFAULT_RADIUS_KM };
}

export function zoneToRow(playerId: string, zone: ZonePoint) {
  return {
    player_id: playerId,
    lat: roundZoneCoord(zone.lat),
    lng: roundZoneCoord(zone.lng),
    radius_km: zone.radiusKm,
  };
}

// ─── Accès base ───────────────────────────────────────────────────────────
// Import supabase paresseux : tout ce qui précède reste testable sans env.

export async function fetchMyZone(playerId: string): Promise<{ zone: ZonePoint | null; status: ZoneStatus }> {
  try {
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase
      .from('player_zones')
      .select('lat, lng, radius_km')
      .eq('player_id', playerId)
      .maybeSingle();
    const status = zoneFetchStatus(error);
    return { zone: status === 'ok' ? zoneFromRow(data) : null, status };
  } catch {
    return { zone: null, status: 'error' };
  }
}

export async function saveMyZone(playerId: string, zone: ZonePoint): Promise<ZonePoint> {
  const { supabase } = await import('./supabase');
  const row = zoneToRow(playerId, zone);
  const { error } = await supabase.from('player_zones').upsert(row, { onConflict: 'player_id' });
  if (error) throw error;
  return { lat: row.lat, lng: row.lng, radiusKm: row.radius_km };
}

export async function deleteMyZone(playerId: string): Promise<void> {
  const { supabase } = await import('./supabase');
  const { error } = await supabase.from('player_zones').delete().eq('player_id', playerId);
  if (error) throw error;
}
