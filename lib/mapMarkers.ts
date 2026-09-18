// lib/mapMarkers.ts — ce que montre la carte de l'Explorer.
//
// PUR ET TESTÉ (lib/__tests__/mapMarkers.test.ts). Deux règles :
//
//   * un repère par position de club PRÉCISE ; les clubs placés au centre de
//     leur ville (position approximative) sont regroupés en UN repère par
//     ville — sinon on dessinerait dix faux points empilés sur la même place ;
//   * le panneau d'un repère liste ses parties avec heure, club, niveau,
//     places et distance, par les mêmes fonctions que le reste de l'app
//     (spotsLabel, levelRangeLabel, formatGameDistance).
import { normClubName, formatGameDistance, type ClubPoint, type DistanceOf } from './geo';
import { spotsLabel, levelRangeLabel } from './games';

export type MarkerKind = 'club' | 'city';

export interface MapMarker {
  /** Identifiant stable : 'club:<lat>,<lng>' ou 'ville:<nom normalisé>'. */
  key: string;
  kind: MarkerKind;
  lat: number;
  lng: number;
  /** Nom du club (ou des clubs au même point), ou nom de la ville. */
  label: string;
  clubs: string[];
  gameIds: string[];
}

export interface MarkerGame { id: string; location?: string | null }

export function groupMapMarkers<G extends MarkerGame>(
  games: G[],
  pointOf: (location: string) => ClubPoint | null,
  cityOf: (location: string) => string | null,
): { markers: MapMarker[]; unplaced: number } {
  const parCle = new Map<string, MapMarker>();
  let unplaced = 0;
  for (const g of games) {
    const lieu = (g.location ?? '').trim();
    const point = lieu ? pointOf(lieu) : null;
    if (!point) { unplaced++; continue; }
    let key: string;
    let kind: MarkerKind;
    let label: string;
    if (point.approx) {
      const ville = cityOf(lieu);
      kind = 'city';
      label = ville ?? lieu;
      key = `ville:${normClubName(label)}`;
    } else {
      kind = 'club';
      label = lieu;
      key = `club:${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;
    }
    let m = parCle.get(key);
    if (!m) {
      m = { key, kind, lat: point.lat, lng: point.lng, label, clubs: [], gameIds: [] };
      parCle.set(key, m);
    }
    if (!m.clubs.some(c => normClubName(c) === normClubName(lieu))) m.clubs.push(lieu);
    if (kind === 'club') m.label = m.clubs.join(' · ');
    m.gameIds.push(g.id);
  }
  const markers = [...parCle.values()].sort((a, b) => a.key.localeCompare(b.key));
  return { markers, unplaced };
}

const deux = (n: number) => String(n).padStart(2, '0');
const memeJour = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** « Aujourd'hui · 19:30 », « Demain · 09:05 », « Lun. 21 sept. · 20:00 ». */
export function whenLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'Date à fixer';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Date à fixer';
  const heure = `${deux(d.getHours())}:${deux(d.getMinutes())}`;
  if (memeJour(d, now)) return `Aujourd'hui · ${heure}`;
  // Par composants calendaires, jamais +86 400 000 ms : un changement d'heure
  // (jour de 23h ou 25h) ferait sauter ou redoubler « demain ».
  const demain = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (memeJour(d, demain)) return `Demain · ${heure}`;
  const jour = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${jour.charAt(0).toUpperCase()}${jour.slice(1)} · ${heure}`;
}

export interface PanelRow {
  id: string;
  when: string;
  club: string;
  level: string | null;
  places: string;
  distance: string | null;
}

type PanelGame = MarkerGame & Parameters<typeof spotsLabel>[0] & Parameters<typeof levelRangeLabel>[0] & {
  match_date?: string | null;
};

/** Les parties d'un repère, dans l'ordre du temps. */
export function panelRows<G extends PanelGame>(
  games: G[], marker: MapMarker, distanceOf: DistanceOf, now: Date = new Date(),
): PanelRow[] {
  const ids = new Set(marker.gameIds);
  const quand = (g: G) => {
    const t = g.match_date ? new Date(g.match_date).getTime() : NaN;
    return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
  };
  return games
    .filter(g => ids.has(g.id))
    .sort((a, b) => quand(a) - quand(b))
    .map(g => {
      const d = distanceOf(g.location);
      return {
        id: g.id,
        when: whenLabel(g.match_date, now),
        club: (g.location ?? '').trim(),
        level: levelRangeLabel(g),
        places: spotsLabel(g),
        distance: d ? formatGameDistance(d) : null,
      };
    });
}
