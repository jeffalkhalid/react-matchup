// lib/originPolicy.ts — règles pures autour du point de départ (hooks/useOrigin.ts).
//
// PUR ET TESTÉ (lib/__tests__/originPolicy.test.ts) : aucun accès réseau,
// aucun module natif. Regroupe trois décisions qui étaient éparpillées et
// divergentes dans le hook : quand relancer un chargement en échec, quand
// relire le GPS, et quel message afficher quand la position est indisponible.
import { GPS_MAX_AGE_MS, type GpsFix, type OriginSource } from './geo';
import type { GpsPermission } from './location';

/** Entre deux tentatives de reloadOrigin() après un échec. */
export const ORIGIN_RELOAD_THROTTLE_MS = 30_000;

/**
 * reloadOrigin() ne relance le chargement (zone + clubs) que si la dernière
 * tentative a échoué ET date d'au moins ORIGIN_RELOAD_THROTTLE_MS. Une zone
 * absente ('missing', pas 'error') ne compte pas comme un échec : inutile de
 * la re-demander, elle n'existera pas davantage la seconde d'après.
 */
export function shouldReloadOrigin(params: {
  loadFailed: boolean;
  lastAttemptAt: number | null;
  now: number;
}): boolean {
  const { loadFailed, lastAttemptAt, now } = params;
  if (!loadFailed) return false;
  if (lastAttemptAt === null) return true;
  return now - lastAttemptAt >= ORIGIN_RELOAD_THROTTLE_MS;
}

/**
 * Le minuteur (toutes les 60 s) et refreshGps() partagent cette même règle :
 * faux si la permission n'est pas accordée ; faux si la position connue est
 * encore fraîche (moins de la moitié de GPS_MAX_AGE_MS) ; faux si une lecture
 * a déjà échoué récemment (même fenêtre) — pas la peine de réessayer toutes
 * les minutes si le téléphone ne répond pas. Vrai sinon.
 */
export function shouldReadGps(params: {
  permission: GpsPermission;
  gps: GpsFix | null;
  lastFailureAt: number | null;
  now: number;
}): boolean {
  const { permission, gps, lastFailureAt, now } = params;
  if (permission !== 'granted') return false;
  if (gps && now - gps.at < GPS_MAX_AGE_MS / 2) return false;
  if (lastFailureAt !== null && now - lastFailureAt < GPS_MAX_AGE_MS / 2) return false;
  return true;
}

/**
 * Le même message partout où une lecture GPS échoue. `alternative` remplace
 * la fin par défaut (« , ou choisis ta zone. » / « . ») quand le contexte a
 * une meilleure suite à proposer — par exemple sur l'écran « Ma zone », où
 * proposer de choisir sa zone n'a pas de sens puisqu'on y est déjà.
 */
export function gpsFailureMessage(
  permission: GpsPermission,
  zoneAvailable: boolean,
  alternative?: string,
): { title: string; body: string } {
  const title = 'Position indisponible';
  const debut = permission === 'granted'
    ? "Ta position n'a pas pu être lue. Réessaie dans un endroit dégagé"
    : 'Autorise la localisation dans les réglages du téléphone';
  const fin = alternative ?? (zoneAvailable ? ', ou choisis ta zone.' : '.');
  return { title, body: `${debut}${fin}` };
}

/**
 * Un joueur qui a choisi une zone mesure ses distances depuis elle. Si son
 * téléphone sait donner sa position et qu'il ne l'a pas encore autorisée, on
 * lui propose « Utiliser ma position » (décision utilisateur 2026-09-18) :
 * plus juste que la zone quand il n'est pas chez lui. Jamais quand la
 * permission est déjà accordée (la position est relue toute seule), ni sans
 * module GPS, ni sans point de départ (l'encart de l'Explorer s'en charge).
 */
export function shouldOfferGps(params: {
  gpsAvailable: boolean;
  permission: GpsPermission;
  originSource: OriginSource | null;
}): boolean {
  const { gpsAvailable, permission, originSource } = params;
  return gpsAvailable && originSource === 'zone' && permission !== 'granted' && permission !== 'unavailable';
}
