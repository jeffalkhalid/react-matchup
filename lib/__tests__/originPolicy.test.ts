import { describe, it, expect } from 'vitest';
import { GPS_MAX_AGE_MS, type GpsFix } from '../geo';
import { shouldReloadOrigin, shouldReadGps, gpsFailureMessage, ORIGIN_RELOAD_THROTTLE_MS } from '../originPolicy';

const fix = (at: number): GpsFix => ({ lat: 33.5, lng: -7.5, at });

describe('shouldReloadOrigin — throttle 30 s de reloadOrigin', () => {
  it('rien à recharger si le dernier chargement n a pas échoué', () => {
    expect(shouldReloadOrigin({ loadFailed: false, lastAttemptAt: null, now: 1000 })).toBe(false);
    expect(shouldReloadOrigin({ loadFailed: false, lastAttemptAt: 0, now: 1000 })).toBe(false);
  });
  it('échec sans tentative connue → on relance', () => {
    expect(shouldReloadOrigin({ loadFailed: true, lastAttemptAt: null, now: 1000 })).toBe(true);
  });
  it('échec récent (< 30 s) → on attend', () => {
    expect(shouldReloadOrigin({ loadFailed: true, lastAttemptAt: 1000, now: 1000 + ORIGIN_RELOAD_THROTTLE_MS - 1 })).toBe(false);
  });
  it('échec d au moins 30 s → on relance', () => {
    expect(shouldReloadOrigin({ loadFailed: true, lastAttemptAt: 1000, now: 1000 + ORIGIN_RELOAD_THROTTLE_MS })).toBe(true);
    expect(shouldReloadOrigin({ loadFailed: true, lastAttemptAt: 1000, now: 1000 + ORIGIN_RELOAD_THROTTLE_MS + 5000 })).toBe(true);
  });
});

describe('shouldReadGps — relecture GPS économe', () => {
  const now = 1_000_000;
  it('faux si la permission n est pas accordée', () => {
    expect(shouldReadGps({ permission: 'denied', gps: null, lastFailureAt: null, now })).toBe(false);
    expect(shouldReadGps({ permission: 'undetermined', gps: null, lastFailureAt: null, now })).toBe(false);
    expect(shouldReadGps({ permission: 'unavailable', gps: null, lastFailureAt: null, now })).toBe(false);
  });
  it('faux si la position connue est encore fraîche (< moitié de GPS_MAX_AGE_MS)', () => {
    const recente = fix(now - (GPS_MAX_AGE_MS / 2 - 1));
    expect(shouldReadGps({ permission: 'granted', gps: recente, lastFailureAt: null, now })).toBe(false);
  });
  it('vrai si la position connue a exactement atteint la moitié de son âge max', () => {
    const pileMoitie = fix(now - GPS_MAX_AGE_MS / 2);
    expect(shouldReadGps({ permission: 'granted', gps: pileMoitie, lastFailureAt: null, now })).toBe(true);
  });
  it('faux si un échec récent (< moitié de GPS_MAX_AGE_MS) a déjà eu lieu', () => {
    const vieille = fix(now - GPS_MAX_AGE_MS);
    expect(shouldReadGps({ permission: 'granted', gps: vieille, lastFailureAt: now - (GPS_MAX_AGE_MS / 2 - 1), now })).toBe(false);
  });
  it('vrai si aucune position, ou position périmée et aucun échec récent', () => {
    expect(shouldReadGps({ permission: 'granted', gps: null, lastFailureAt: null, now })).toBe(true);
    const vieille = fix(now - GPS_MAX_AGE_MS);
    expect(shouldReadGps({ permission: 'granted', gps: vieille, lastFailureAt: now - GPS_MAX_AGE_MS / 2, now })).toBe(true);
    expect(shouldReadGps({ permission: 'granted', gps: vieille, lastFailureAt: null, now })).toBe(true);
  });
});

describe('gpsFailureMessage — message unique GPS indisponible', () => {
  it('permission accordée, zone disponible', () => {
    expect(gpsFailureMessage('granted', true)).toEqual({
      title: 'Position indisponible',
      body: "Ta position n'a pas pu être lue. Réessaie dans un endroit dégagé, ou choisis ta zone.",
    });
  });
  it('permission accordée, pas de zone', () => {
    expect(gpsFailureMessage('granted', false)).toEqual({
      title: 'Position indisponible',
      body: "Ta position n'a pas pu être lue. Réessaie dans un endroit dégagé.",
    });
  });
  it('permission refusée, zone disponible', () => {
    expect(gpsFailureMessage('denied', true)).toEqual({
      title: 'Position indisponible',
      body: 'Autorise la localisation dans les réglages du téléphone, ou choisis ta zone.',
    });
  });
  it('permission refusée, pas de zone', () => {
    expect(gpsFailureMessage('denied', false)).toEqual({
      title: 'Position indisponible',
      body: 'Autorise la localisation dans les réglages du téléphone.',
    });
  });
  it('module absent (unavailable), sans zone', () => {
    expect(gpsFailureMessage('unavailable', false)).toEqual({
      title: 'Position indisponible',
      body: 'Autorise la localisation dans les réglages du téléphone.',
    });
  });
  it('alternative explicite : remplace la fin, même si une zone est disponible', () => {
    expect(gpsFailureMessage('granted', true, ", ou place l'épingle à la main.")).toEqual({
      title: 'Position indisponible',
      body: "Ta position n'a pas pu être lue. Réessaie dans un endroit dégagé, ou place l'épingle à la main.",
    });
    expect(gpsFailureMessage('denied', false, ", ou place l'épingle à la main.")).toEqual({
      title: 'Position indisponible',
      body: "Autorise la localisation dans les réglages du téléphone, ou place l'épingle à la main.",
    });
  });
});
