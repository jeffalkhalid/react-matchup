// lib/location.ts — la position du téléphone, chargée PRUDEMMENT.
//
// `expo-location` est un module natif. Un APK construit avant son ajout ne le
// contient pas : l'importer normalement ferait planter l'app au démarrage. On
// vérifie donc d'abord que le module natif existe, et on ne charge le code
// JavaScript qu'ensuite. Absent = GPS indisponible : l'app se replie sur la
// zone du joueur.
//
// C'est le SEUL fichier autorisé à nommer ce module
// (garde-fou : lib/__tests__/noDirectExpoLocation.test.ts).
//
// Aucune fonction ici n'écrit en base : la position ne quitte pas le téléphone.
import { requireOptionalNativeModule } from 'expo';
import { GPS_MAX_AGE_MS, GPS_TIMEOUT_MS, type GpsFix } from './geo';

type LocationModule = typeof import('expo-location');

export type GpsPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

let charge: LocationModule | null | undefined;

function chargerModule(): LocationModule | null {
  if (charge !== undefined) return charge;
  try {
    charge = requireOptionalNativeModule('ExpoLocation')
      ? (require('expo-location') as LocationModule)
      : null;
  } catch {
    charge = null;
  }
  return charge;
}

export function gpsAvailable(): boolean {
  return chargerModule() !== null;
}

function lireStatut(status: string): GpsPermission {
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

/** L'autorisation actuelle, SANS rien demander. */
export async function gpsPermission(): Promise<GpsPermission> {
  const L = chargerModule();
  if (!L) return 'unavailable';
  try {
    return lireStatut((await L.getForegroundPermissionsAsync()).status);
  } catch {
    return 'unavailable';
  }
}

/** Affiche la demande du système. À n'appeler que sur un geste du joueur. */
export async function requestGpsPermission(): Promise<GpsPermission> {
  const L = chargerModule();
  if (!L) return 'unavailable';
  try {
    return lireStatut((await L.requestForegroundPermissionsAsync()).status);
  } catch {
    return 'unavailable';
  }
}

function avecDelai<T>(promesse: Promise<T>, ms: number): Promise<T | null> {
  return new Promise(resolve => {
    const minuteur = setTimeout(() => resolve(null), ms);
    promesse.then(
      v => { clearTimeout(minuteur); resolve(v); },
      () => { clearTimeout(minuteur); resolve(null); },
    );
  });
}

/**
 * La position du téléphone, SANS demander l'autorisation : null si elle est
 * refusée, si le module manque, ou si le téléphone ne répond pas en 8 s. Une
 * position connue de moins de 10 minutes évite d'allumer le GPS.
 */
export async function readGpsPosition(): Promise<GpsFix | null> {
  const L = chargerModule();
  if (!L) return null;
  try {
    const { status } = await L.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const connue = await L.getLastKnownPositionAsync({ maxAge: GPS_MAX_AGE_MS });
    const pos = connue
      ?? await avecDelai(L.getCurrentPositionAsync({ accuracy: L.Accuracy.Balanced }), GPS_TIMEOUT_MS);
    if (!pos) return null;
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, at: pos.timestamp || Date.now() };
  } catch {
    return null;
  }
}
