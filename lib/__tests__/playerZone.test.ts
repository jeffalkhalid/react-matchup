import { describe, it, expect } from 'vitest';
import { isMissingTableError, zoneFromRow, zoneToRow, zoneFetchStatus } from '../playerZone';

describe('migration absente', () => {
  it('reconnaît une table inexistante (Postgres et PostgREST)', () => {
    expect(isMissingTableError({ code: '42P01', message: 'relation "public.player_zones" does not exist' })).toBe(true);
    expect(isMissingTableError({ code: 'PGRST205', message: "Could not find the table 'public.player_zones' in the schema cache" })).toBe(true);
  });
  it('une autre erreur n est PAS une migration absente', () => {
    expect(isMissingTableError({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingTableError({ message: 'Network request failed' })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});

describe('zoneFetchStatus — un échec réseau ne doit pas se faire passer pour « pas de zone »', () => {
  it('pas d erreur → ok', () => {
    expect(zoneFetchStatus(null)).toBe('ok');
    expect(zoneFetchStatus(undefined)).toBe('ok');
  });
  it('table absente → missing (jamais une panne)', () => {
    expect(zoneFetchStatus({ code: '42P01', message: 'relation "public.player_zones" does not exist' })).toBe('missing');
    expect(zoneFetchStatus({ code: 'PGRST205', message: "Could not find the table 'public.player_zones' in the schema cache" })).toBe('missing');
  });
  it('toute autre erreur → error', () => {
    expect(zoneFetchStatus({ code: '42501', message: 'permission denied' })).toBe('error');
    expect(zoneFetchStatus({ message: 'Network request failed' })).toBe('error');
  });
});

describe('ligne ↔ zone', () => {
  it('relit une ligne, nombres en texte compris', () => {
    expect(zoneFromRow({ lat: '33.575', lng: -7.59, radius_km: 10 })).toEqual({ lat: 33.575, lng: -7.59, radiusKm: 10 });
  });
  it('rayon aberrant → 20 km ; ligne vide ou illisible → null', () => {
    expect(zoneFromRow({ lat: 33.575, lng: -7.59, radius_km: 15 })!.radiusKm).toBe(20);
    expect(zoneFromRow(null)).toBeNull();
    expect(zoneFromRow({ lat: 'x', lng: -7.59, radius_km: 10 })).toBeNull();
  });
  it('arrondit AVANT d envoyer', () => {
    expect(zoneToRow('p1', { lat: 33.5731, lng: -7.5898, radiusKm: 20 }))
      .toEqual({ player_id: 'p1', lat: 33.575, lng: -7.59, radius_km: 20 });
  });
});
