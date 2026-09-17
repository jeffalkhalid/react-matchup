// hooks/useOrigin.ts — le point de départ des distances, partagé par toute l'app.
//
// Un seul magasin pour tous les écrans : les cartes de partie, le filtre, le
// compteur de l'onglet et le tri lisent LA MÊME fonction `distanceOf`. Deux
// calculs séparés finiraient par ne plus annoncer les mêmes chiffres.
//
// Ordre : GPS de moins de 10 minutes → zone → aucun (lib/geo.resolveOrigin).
// L'autorisation GPS n'est JAMAIS demandée ici au chargement : seulement par
// `requestGps`, appelé sur un geste du joueur.
//
// supabase-js ne lève pas hors ligne, il rend `{ error }` : un échec réseau ne
// doit jamais se faire passer pour « pas de zone » / « pas de clubs ». Le
// magasin distingue donc `loadFailed` (chargement en échec, à réessayer) de
// `zoneAvailable` (la fonctionnalité existe, migration appliquée).
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
import { shouldReloadOrigin, shouldReadGps } from '../lib/originPolicy';

interface OriginState {
  playerId: string | null;
  ready: boolean;
  zone: ZonePoint | null;
  zoneAvailable: boolean;
  /** Le dernier chargement (zone + clubs) a échoué : à réessayer, pas à interpréter. */
  loadFailed: boolean;
  gps: GpsFix | null;
  gpsPermission: GpsPermission;
  index: Map<string, ClubPoint>;
  origin: Origin | null;
  distanceOf: DistanceOf;
}

const VIDE: OriginState = {
  playerId: null, ready: false, zone: null, zoneAvailable: true, loadFailed: false, gps: null,
  gpsPermission: 'undetermined', index: new Map(), origin: null,
  distanceOf: makeDistanceOf(null, new Map()),
};

let state: OriginState = VIDE;
let chargement: Promise<void> | null = null;
// Horodatage de la dernière tentative de chargement zone+clubs — sert au
// throttle de reloadOrigin (lib/originPolicy.shouldReloadOrigin).
let derniereChargeAt: number | null = null;
// Horodatage du dernier échec de LECTURE GPS — sert au throttle de
// refreshGps/verifierFraicheur (lib/originPolicy.shouldReadGps).
let gpsFailureAt: number | null = null;
// Une seule lecture GPS à la fois : requestGps, refreshGps et le chargement
// initial partagent cette promesse au lieu d'en lancer une seconde.
let lectureGps: Promise<GpsFix | null> | null = null;
const abonnes = new Set<() => void>();
let minuteur: ReturnType<typeof setInterval> | null = null;

const memeOrigine = (a: Origin | null, b: Origin | null) =>
  a === b || (!!a && !!b && a.lat === b.lat && a.lng === b.lng && a.source === b.source);

function publier(patch: Partial<OriginState>): void {
  const next = { ...state, ...patch };
  const origin = resolveOrigin(next.gps, next.zone, Date.now());
  const inchangeOrigin = memeOrigine(origin, state.origin) && next.index === state.index;
  next.origin = inchangeOrigin ? state.origin : origin;
  // Nouvelle fonction SEULEMENT si le point de départ ou les clubs changent :
  // les distances déjà calculées restent en mémoire sinon.
  next.distanceOf = inchangeOrigin ? state.distanceOf : makeDistanceOf(origin, next.index);
  // Rien de changé, champ par champ, par identité : ne pas remplacer l'état
  // ni prévenir les abonnés pour rien.
  const cles = Object.keys(next) as (keyof OriginState)[];
  if (cles.every(k => next[k] === state[k])) return;
  state = next;
  abonnes.forEach(f => f());
}

/** `null` en cas d'erreur — JAMAIS un index vide, qui se lirait comme « aucun club ». */
async function chargerClubs(): Promise<Map<string, ClubPoint> | null> {
  try {
    const { data, error } = await supabase
      .from('clubs')
      .select('name, latitude, longitude, geo_confidence')
      .not('latitude', 'is', null);
    if (error) return null;
    return buildClubIndex((data ?? []) as ClubRow[]);
  } catch {
    return null;
  }
}

/**
 * Charge zone + clubs pour `playerId`, utilisé au premier chargement ET par
 * reloadOrigin(). Un échec réseau ne remplace jamais une donnée déjà connue
 * par du vide : la zone garde sa dernière valeur bonne, l'index de clubs
 * aussi (sinon un index vide tant qu'aucun n'a jamais réussi).
 */
async function chargerZoneEtClubs(playerId: string): Promise<Partial<OriginState>> {
  derniereChargeAt = Date.now();
  const [zone, clubs] = await Promise.all([fetchMyZone(playerId), chargerClubs()]);
  return {
    zone: zone.status === 'error' ? state.zone : zone.zone,
    zoneAvailable: zone.status !== 'missing',
    index: clubs ?? (state.index.size > 0 ? state.index : new Map<string, ClubPoint>()),
    loadFailed: zone.status === 'error' || clubs === null,
  };
}

/** Une seule lecture GPS en vol : les appelants partagent la même promesse. */
function lireGps(): Promise<GpsFix | null> {
  if (!lectureGps) {
    lectureGps = readGpsPosition().finally(() => { lectureGps = null; });
  }
  return lectureGps;
}

function charger(playerId: string): Promise<void> {
  if (state.playerId === playerId && chargement) return chargement;
  // Changement de compte : on repart de zéro.
  state = { ...VIDE, playerId };
  abonnes.forEach(f => f());
  chargement = (async () => {
    const [donnees, permission] = await Promise.all([
      chargerZoneEtClubs(playerId), gpsPermission(),
    ]);
    if (state.playerId !== playerId) return;
    publier({ ...donnees, gpsPermission: permission, ready: true });
    // Échec : on invalide le cache pour qu'un appel ultérieur (remontage d'un
    // écran, reloadOrigin) relance vraiment le chargement au lieu de rendre
    // pour toujours cette même tentative ratée.
    if (donnees.loadFailed) chargement = null;
    // Autorisation DÉJÀ donnée : on lit la position sans rien demander.
    if (permission === 'granted') {
      const gps = await lireGps();
      if (state.playerId === playerId && gps) publier({ gps });
    }
  })();
  return chargement;
}

/**
 * Relance le chargement zone + clubs pour le joueur courant — seulement si le
 * dernier a échoué et que le throttle de 30 s est passé (lib/originPolicy).
 * Sans effet si la zone est simplement absente ('missing') : ça ne changera
 * pas tout seul.
 */
async function reloadOrigin(): Promise<void> {
  const playerId = state.playerId;
  if (!playerId) return;
  if (!shouldReloadOrigin({ loadFailed: state.loadFailed, lastAttemptAt: derniereChargeAt, now: Date.now() })) return;
  const donnees = await chargerZoneEtClubs(playerId);
  if (state.playerId !== playerId) return;
  publier(donnees);
}

async function requestGps(): Promise<{ gps: GpsFix | null; permission: GpsPermission }> {
  const playerId = state.playerId;
  const permission = await requestGpsPermission();
  if (state.playerId !== playerId) return { gps: null, permission };
  publier({ gpsPermission: permission });
  if (permission !== 'granted') return { gps: null, permission };
  const gps = await lireGps();
  if (state.playerId !== playerId) return { gps: null, permission };
  if (gps) { gpsFailureAt = null; publier({ gps }); } else { gpsFailureAt = Date.now(); }
  return { gps, permission };
}

async function refreshGps(): Promise<void> {
  const playerId = state.playerId;
  if (!shouldReadGps({ permission: state.gpsPermission, gps: state.gps, lastFailureAt: gpsFailureAt, now: Date.now() })) return;
  const gps = await lireGps();
  if (state.playerId !== playerId) return;
  if (gps) {
    gpsFailureAt = null;
    publier({ gps });
  } else {
    // Échec : la position était périmée de toute façon, on la lâche tout de
    // suite plutôt que d'attendre les 10 minutes complètes.
    gpsFailureAt = Date.now();
    publier({ gps: null });
  }
}

async function saveZone(zone: ZonePoint): Promise<void> {
  const playerId = state.playerId;
  if (!playerId) throw new Error('Joueur inconnu');
  const enregistree = await saveMyZone(playerId, zone);
  if (state.playerId !== playerId) throw new Error('Joueur inconnu');
  publier({ zone: enregistree });
}

async function removeZone(): Promise<void> {
  const playerId = state.playerId;
  if (!playerId) throw new Error('Joueur inconnu');
  await deleteMyZone(playerId);
  if (state.playerId !== playerId) throw new Error('Joueur inconnu');
  publier({ zone: null });
}

// Une position de plus de 10 minutes ne décrit plus où est le joueur, même écran
// ouvert : on la réévalue automatiquement toutes les minutes (règle partagée
// avec refreshGps — lib/originPolicy.shouldReadGps).
function verifierFraicheur(): void {
  if (shouldReadGps({ permission: state.gpsPermission, gps: state.gps, lastFailureAt: gpsFailureAt, now: Date.now() })) {
    void refreshGps();
  }
}

function abonner(f: () => void): () => void {
  abonnes.add(f);
  if (minuteur === null) {
    minuteur = setInterval(verifierFraicheur, 60_000);
  }
  return () => {
    abonnes.delete(f);
    if (abonnes.size === 0 && minuteur !== null) {
      clearInterval(minuteur);
      minuteur = null;
    }
  };
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
    loadFailed: s.loadFailed,
    gps: s.gps,
    gpsAvailable: gpsAvailable(),
    gpsPermission: s.gpsPermission,
    radiusKm: s.zone?.radiusKm ?? DEFAULT_RADIUS_KM,
    distanceOf: s.distanceOf,
    requestGps,
    refreshGps,
    reloadOrigin,
    saveZone,
    removeZone,
  };
}
