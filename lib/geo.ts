// lib/geo.ts — distances à vol d'oiseau entre le joueur et les clubs.
//
// PUR ET TESTÉ (lib/__tests__/geo.test.ts) : aucun accès réseau, aucun module
// natif. Le GPS vit dans lib/location.ts, la zone dans lib/playerZone.ts, et
// hooks/useOrigin.ts assemble le tout.
//
// Les parties désignent leur club par son NOM (open_games.location) : on
// retrouve la position du club par nom normalisé, avec sa précision. Un club
// « city » est placé au centre de sa ville : sa distance est approximative et
// s'affiche « ~12 km ».

export interface LatLng { lat: number; lng: number }
export type OriginSource = 'gps' | 'zone';
export interface Origin extends LatLng { source: OriginSource }
export interface ClubPoint extends LatLng { approx: boolean }
export interface GameDistance { km: number; approx: boolean }
/** Position du téléphone, avec l'heure où elle a été mesurée (ms). */
export interface GpsFix extends LatLng { at: number }
export interface ZonePoint extends LatLng { radiusKm: number }
export interface ClubRow {
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  geo_confidence: string | null;
}
export type DistanceOf = (location: string | null | undefined) => GameDistance | null;

export const ZONE_RADII_KM = [5, 10, 20, 40] as const;
export const DEFAULT_RADIUS_KM = 20;
/** Une position GPS plus vieille ne décrit plus où est le joueur. */
export const GPS_MAX_AGE_MS = 10 * 60 * 1000;
/** Au-delà, on renonce au GPS et on se replie sur la zone. */
export const GPS_TIMEOUT_MS = 8000;
/** Pas d'arrondi de la zone : ~550 m en latitude, ~460 m en longitude au Maroc. */
export const ZONE_STEP_DEG = 0.005;
/** Casablanca : centre de la carte quand on ne sait rien du joueur. */
export const DEFAULT_MAP_CENTER: LatLng = { lat: 33.5731, lng: -7.5898 };

const RAYON_TERRE_KM = 6371;

export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAYON_TERRE_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** « 800 m » sous 1 km, « 4,2 km » sous 10 km, « 23 km » au-delà. */
export function formatKm(km: number): string {
  const metres = Math.round((km * 1000) / 50) * 50;
  if (metres < 1000) return `${Math.max(50, metres)} m`;
  const unDecimal = Math.round(km * 10) / 10;
  if (unDecimal < 10) return `${unDecimal.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}

export function formatGameDistance(d: GameDistance): string {
  return d.approx ? `~${formatKm(d.km)}` : formatKm(d.km);
}

/** Même règle que lib/maps.ts et lib/clubsMap.ts, qui l'importent d'ici. */
export function normClubName(s: string): string {
  return s.trim().toLowerCase();
}

export function buildClubIndex(rows: ClubRow[]): Map<string, ClubPoint> {
  const index = new Map<string, ClubPoint>();
  for (const r of rows) {
    if (!r.name || r.latitude == null || r.longitude == null) continue;
    const cle = normClubName(r.name);
    const point: ClubPoint = {
      lat: Number(r.latitude), lng: Number(r.longitude), approx: r.geo_confidence !== 'exact',
    };
    const deja = index.get(cle);
    // Deux clubs du même nom : ne jamais remplacer une position précise par
    // une position de centre-ville.
    if (deja && !deja.approx && point.approx) continue;
    index.set(cle, point);
  }
  return index;
}

/**
 * La distance de chaque lieu depuis `origin`, calculée UNE fois par lieu : la
 * fonction rendue garde ses résultats. Un nouveau point de départ = une
 * nouvelle fonction (hooks/useOrigin.ts s'en charge).
 */
export function makeDistanceOf(origin: LatLng | null, index: Map<string, ClubPoint>): DistanceOf {
  const memo = new Map<string, GameDistance | null>();
  return (location) => {
    if (!origin || !location || !location.trim()) return null;
    const cle = normClubName(location);
    if (memo.has(cle)) return memo.get(cle) ?? null;
    const club = index.get(cle);
    const d = club ? { km: haversineKm(origin, club), approx: club.approx } : null;
    memo.set(cle, d);
    return d;
  };
}

/** Précises croissantes, puis approximatives, puis inconnues ; la date départage. */
export function sortByProximity<T extends { location?: string | null; match_date?: string | null }>(
  games: T[], distanceOf: DistanceOf,
): T[] {
  const rang = (d: GameDistance | null) => (d == null ? 2 : d.approx ? 1 : 0);
  const quand = (g: T) => {
    const t = g.match_date ? new Date(g.match_date).getTime() : NaN;
    return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
  };
  return games
    .map(g => ({ g, d: distanceOf(g.location) }))
    .sort((a, b) =>
      rang(a.d) - rang(b.d)
      || (a.d && b.d ? a.d.km - b.d.km : 0)
      || quand(a.g) - quand(b.g))
    .map(x => x.g);
}

/** Arrondi au 0,005° le plus proche — le serveur applique la même règle. */
export function roundZoneCoord(x: number): number {
  return Number((Math.round(x / ZONE_STEP_DEG) * ZONE_STEP_DEG).toFixed(3)) || 0;
}

export function isZoneRadius(n: unknown): n is (typeof ZONE_RADII_KM)[number] {
  return typeof n === 'number' && (ZONE_RADII_KM as readonly number[]).includes(n);
}

/** GPS récent → zone → aucun. */
export function resolveOrigin(gps: GpsFix | null, zone: LatLng | null, now: number): Origin | null {
  if (gps && now - gps.at <= GPS_MAX_AGE_MS) return { lat: gps.lat, lng: gps.lng, source: 'gps' };
  if (zone) return { lat: zone.lat, lng: zone.lng, source: 'zone' };
  return null;
}

export function originLabel(o: Origin): string {
  return o.source === 'gps' ? 'depuis ta position' : 'depuis ta zone';
}

/** Où poser l'épingle en ouvrant « Ma zone ». */
export function initialZoneCenter(zone: LatLng | null, gps: GpsFix | null): LatLng {
  if (zone) return { lat: zone.lat, lng: zone.lng };
  if (gps) return { lat: gps.lat, lng: gps.lng };
  return DEFAULT_MAP_CENTER;
}
