// hooks/useOrigin.ts — le point de départ des distances, partagé par toute l'app.
//
// Un seul magasin pour tous les écrans : les cartes de partie, le filtre, le
// compteur de l'onglet et le tri lisent LA MÊME fonction `distanceOf`. Deux
// calculs séparés finiraient par ne plus annoncer les mêmes chiffres.
//
// Ordre : GPS de moins de 10 minutes → zone → aucun (lib/geo.resolveOrigin).
// L'autorisation GPS n'est JAMAIS demandée ici au chargement : seulement par
// `requestGps`, appelé sur un geste du joueur.
import { useEffect, useSyncExternalStore } from 'react';
import { usePlayer } from './usePlayer';
import { supabase } from '../lib/supabase';
import {
  buildClubIndex, makeDistanceOf, resolveOrigin, DEFAULT_RADIUS_KM, GPS_MAX_AGE_MS,
  type ClubPoint, type ClubRow, type DistanceOf, type GpsFix, type Origin, type ZonePoint,
} from '../lib/geo';
import {
  gpsAvailable, gpsPermission, requestGpsPermission, readGpsPosition, type GpsPermission,
} from '../lib/location';
import { fetchMyZone, saveMyZone, deleteMyZone } from '../lib/playerZone';

interface OriginState {
  playerId: string | null;
  ready: boolean;
  zone: ZonePoint | null;
  zoneAvailable: boolean;
  gps: GpsFix | null;
  gpsPermission: GpsPermission;
  index: Map<string, ClubPoint>;
  origin: Origin | null;
  distanceOf: DistanceOf;
}

const VIDE: OriginState = {
  playerId: null, ready: false, zone: null, zoneAvailable: true, gps: null,
  gpsPermission: 'undetermined', index: new Map(), origin: null,
  distanceOf: makeDistanceOf(null, new Map()),
};

let state: OriginState = VIDE;
let chargement: Promise<void> | null = null;
const abonnes = new Set<() => void>();

const memeOrigine = (a: Origin | null, b: Origin | null) =>
  a === b || (!!a && !!b && a.lat === b.lat && a.lng === b.lng && a.source === b.source);

function publier(patch: Partial<OriginState>): void {
  const next = { ...state, ...patch };
  const origin = resolveOrigin(next.gps, next.zone, Date.now());
  const inchange = memeOrigine(origin, state.origin) && next.index === state.index;
  next.origin = inchange ? state.origin : origin;
  // Nouvelle fonction SEULEMENT si le point de départ ou les clubs changent :
  // les distances déjà calculées restent en mémoire sinon.
  next.distanceOf = inchange ? state.distanceOf : makeDistanceOf(origin, next.index);
  state = next;
  abonnes.forEach(f => f());
}

async function chargerClubs(): Promise<Map<string, ClubPoint>> {
  try {
    const { data, error } = await supabase
      .from('clubs')
      .select('name, latitude, longitude, geo_confidence')
      .not('latitude', 'is', null);
    if (error) return new Map();
    return buildClubIndex((data ?? []) as ClubRow[]);
  } catch {
    return new Map();
  }
}

function charger(playerId: string): Promise<void> {
  if (state.playerId === playerId && chargement) return chargement;
  // Changement de compte : on repart de zéro.
  state = { ...VIDE, playerId };
  chargement = (async () => {
    const [zone, index, permission] = await Promise.all([
      fetchMyZone(playerId), chargerClubs(), gpsPermission(),
    ]);
    if (state.playerId !== playerId) return;
    publier({ zone: zone.zone, zoneAvailable: zone.available, index, gpsPermission: permission, ready: true });
    // Autorisation DÉJÀ donnée : on lit la position sans rien demander.
    if (permission === 'granted') {
      const gps = await readGpsPosition();
      if (state.playerId === playerId && gps) publier({ gps });
    }
  })();
  return chargement;
}

async function requestGps(): Promise<GpsFix | null> {
  const permission = await requestGpsPermission();
  publier({ gpsPermission: permission });
  if (permission !== 'granted') return null;
  const gps = await readGpsPosition();
  if (gps) publier({ gps });
  return gps;
}

async function refreshGps(): Promise<void> {
  if (state.gpsPermission !== 'granted') return;
  // Position encore fraîche : inutile d'interroger le téléphone.
  if (state.gps && Date.now() - state.gps.at < GPS_MAX_AGE_MS / 2) return;
  const gps = await readGpsPosition();
  // Même sans nouvelle position, republier recalcule l'origine : un GPS devenu
  // trop ancien cède la place à la zone.
  publier(gps ? { gps } : {});
}

async function saveZone(zone: ZonePoint): Promise<void> {
  if (!state.playerId) throw new Error('Joueur inconnu');
  const enregistree = await saveMyZone(state.playerId, zone);
  publier({ zone: enregistree });
}

async function removeZone(): Promise<void> {
  if (!state.playerId) throw new Error('Joueur inconnu');
  await deleteMyZone(state.playerId);
  publier({ zone: null });
}

function abonner(f: () => void): () => void {
  abonnes.add(f);
  return () => { abonnes.delete(f); };
}

export function useOrigin() {
  const { player } = usePlayer();
  const s = useSyncExternalStore(abonner, () => state);
  const playerId = player?.id ?? null;
  useEffect(() => { if (playerId) void charger(playerId); }, [playerId]);
  return {
    ready: s.ready,
    origin: s.origin,
    zone: s.zone,
    zoneAvailable: s.zoneAvailable,
    gps: s.gps,
    gpsAvailable: gpsAvailable(),
    gpsPermission: s.gpsPermission,
    radiusKm: s.zone?.radiusKm ?? DEFAULT_RADIUS_KM,
    distanceOf: s.distanceOf,
    requestGps,
    refreshGps,
    saveZone,
    removeZone,
  };
}
