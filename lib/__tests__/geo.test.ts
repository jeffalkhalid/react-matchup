import { describe, it, expect } from 'vitest';
import {
  haversineKm, formatKm, formatGameDistance, normClubName, buildClubIndex, makeDistanceOf,
  sortByProximity, sortByMatchDate, roundZoneCoord, isZoneRadius, resolveOrigin, originLabel, initialZoneCenter,
  DEFAULT_MAP_CENTER, GPS_MAX_AGE_MS, distanceSentence, type ClubRow,
} from '../geo';

const CASA = { lat: 33.5731, lng: -7.5898 };
const RABAT = { lat: 34.0209, lng: -6.8416 };

describe('distance à vol d oiseau', () => {
  it('Casablanca → Rabat : environ 85 km', () => {
    const km = haversineKm(CASA, RABAT);
    expect(km).toBeGreaterThan(84);
    expect(km).toBeLessThan(86.5);
  });
  it('un point vers lui-même : 0', () => {
    expect(haversineKm(CASA, CASA)).toBe(0);
  });
});

describe('affichage', () => {
  it('sous 1 km : en mètres, par pas de 50 m, jamais 0', () => {
    expect(formatKm(0.8)).toBe('800 m');
    expect(formatKm(0.012)).toBe('50 m');
    expect(formatKm(0.34)).toBe('350 m');
  });
  it('sous 10 km : une décimale, virgule française', () => {
    expect(formatKm(4.24)).toBe('4,2 km');
    expect(formatKm(0.99)).toBe('1,0 km');
  });
  it('à partir de 10 km : arrondi au kilomètre', () => {
    expect(formatKm(23.4)).toBe('23 km');
    expect(formatKm(9.96)).toBe('10 km');
  });
  it('club au centre-ville : distance précédée de ~', () => {
    expect(formatGameDistance({ km: 12.2, approx: true })).toBe('~12 km');
    expect(formatGameDistance({ km: 4.24, approx: false })).toBe('4,2 km');
  });
});

describe('index des clubs', () => {
  const rows: ClubRow[] = [
    { name: ' Padel 4 Maroc ', latitude: 33.53, longitude: -7.64, geo_confidence: 'exact' },
    { name: 'Club Centre', latitude: 33.5731, longitude: -7.5898, geo_confidence: 'city' },
    { name: 'Sans position', latitude: null, longitude: null, geo_confidence: 'city' },
    { name: null, latitude: 1, longitude: 1, geo_confidence: 'exact' },
  ];
  it('nom normalisé comme lib/maps.ts, précision lue sur geo_confidence', () => {
    const index = buildClubIndex(rows);
    expect(normClubName('  Padel 4 MAROC ')).toBe('padel 4 maroc');
    expect(index.get('padel 4 maroc')).toEqual({ lat: 33.53, lng: -7.64, approx: false });
    expect(index.get('club centre')).toEqual({ lat: 33.5731, lng: -7.5898, approx: true });
    expect(index.has('sans position')).toBe(false);
    expect(index.size).toBe(2);
  });
  it('deux clubs du même nom : la position précise l emporte', () => {
    const index = buildClubIndex([
      { name: 'Doublon', latitude: 33.5, longitude: -7.6, geo_confidence: 'exact' },
      { name: 'doublon', latitude: 33.57, longitude: -7.58, geo_confidence: 'city' },
    ]);
    expect(index.get('doublon')).toEqual({ lat: 33.5, lng: -7.6, approx: false });
  });
});

describe('distance d une partie', () => {
  const index = buildClubIndex([
    { name: 'Padel 4 Maroc', latitude: 33.5331, longitude: -7.645, geo_confidence: 'exact' },
    { name: 'Club Centre', latitude: 33.6, longitude: -7.5, geo_confidence: 'city' },
  ]);
  it('sans point de départ, ou lieu vide ou inconnu : null', () => {
    expect(makeDistanceOf(null, index)('Padel 4 Maroc')).toBeNull();
    const d = makeDistanceOf(CASA, index);
    expect(d('')).toBeNull();
    expect(d(null)).toBeNull();
    expect(d('Club inconnu')).toBeNull();
  });
  it('club précis et club au centre-ville', () => {
    const d = makeDistanceOf(CASA, index);
    const precis = d('padel 4 maroc ')!;
    expect(precis.approx).toBe(false);
    expect(precis.km).toBeGreaterThan(6.5);
    expect(precis.km).toBeLessThan(7);
    expect(d('Club Centre')!.approx).toBe(true);
  });
  it('calculée une seule fois par lieu : même objet rendu', () => {
    const d = makeDistanceOf(CASA, index);
    expect(d('Padel 4 Maroc')).toBe(d('PADEL 4 MAROC'));
  });
});

describe('tri de proximité', () => {
  const distances: Record<string, { km: number; approx: boolean } | null> = {
    loin: { km: 20, approx: false },
    pres: { km: 3, approx: false },
    centre: { km: 1, approx: true },
    inconnu: null,
  };
  const distanceOf = (l: string | null | undefined) => (l ? distances[l] ?? null : null);
  const p = (id: string, location: string, jour: number) =>
    ({ id, location, match_date: new Date(2026, 8, jour, 19).toISOString() });

  it('précises croissantes, puis approximatives, puis inconnues', () => {
    const tri = sortByProximity([
      p('a', 'inconnu', 1), p('b', 'centre', 1), p('c', 'loin', 1), p('d', 'pres', 1),
    ], distanceOf);
    expect(tri.map(g => g.id)).toEqual(['d', 'c', 'b', 'a']);
  });
  it('à distance égale, la date départage', () => {
    const tri = sortByProximity([p('tard', 'pres', 9), p('tot', 'pres', 5)], distanceOf);
    expect(tri.map(g => g.id)).toEqual(['tot', 'tard']);
  });
  it('ne modifie pas la liste reçue', () => {
    const liste = [p('c', 'loin', 1), p('d', 'pres', 1)];
    sortByProximity(liste, distanceOf);
    expect(liste.map(g => g.id)).toEqual(['c', 'd']);
  });
});

describe('zone', () => {
  it('coordonnées arrondies au 0,005° le plus proche', () => {
    expect(roundZoneCoord(33.5731)).toBe(33.575);
    expect(roundZoneCoord(-7.5898)).toBe(-7.59);
    expect(roundZoneCoord(33.575)).toBe(33.575);
    expect(roundZoneCoord(0.0024)).toBe(0);
  });
  it('rayons permis : 5, 10, 20, 40', () => {
    expect([5, 10, 20, 40].every(isZoneRadius)).toBe(true);
    expect(isZoneRadius(15)).toBe(false);
    expect(isZoneRadius('20')).toBe(false);
  });
});

describe('point de départ', () => {
  const now = 1_800_000_000_000;
  const zone = { lat: 33.575, lng: -7.59 };
  it('GPS de moins de 10 minutes : prioritaire', () => {
    const gps = { lat: 34, lng: -6.8, at: now - GPS_MAX_AGE_MS };
    expect(resolveOrigin(gps, zone, now)).toEqual({ lat: 34, lng: -6.8, source: 'gps' });
  });
  it('GPS trop ancien : la zone prend le relais', () => {
    const gps = { lat: 34, lng: -6.8, at: now - GPS_MAX_AGE_MS - 1 };
    expect(resolveOrigin(gps, zone, now)).toEqual({ ...zone, source: 'zone' });
    expect(resolveOrigin(gps, null, now)).toBeNull();
  });
  it('ni GPS ni zone : aucun point de départ', () => {
    expect(resolveOrigin(null, null, now)).toBeNull();
  });
  it('libellé de la source', () => {
    expect(originLabel({ lat: 0, lng: 0, source: 'gps' })).toBe('depuis ta position');
    expect(originLabel({ lat: 0, lng: 0, source: 'zone' })).toBe('depuis ta zone');
  });
  it('centre de la carte de zone : zone, sinon GPS, sinon Casablanca', () => {
    expect(initialZoneCenter(zone, { lat: 1, lng: 1, at: now })).toEqual(zone);
    expect(initialZoneCenter(null, { lat: 1, lng: 2, at: now })).toEqual({ lat: 1, lng: 2 });
    expect(initialZoneCenter(null, null)).toEqual(DEFAULT_MAP_CENTER);
  });
});

describe('la phrase des fiches', () => {
  const gps = { lat: 33.5, lng: -7.6, source: 'gps' as const };
  const zone = { lat: 33.5, lng: -7.6, source: 'zone' as const };

  it('club précis : la distance et sa source', () => {
    expect(distanceSentence({ km: 4.24, approx: false }, gps)).toBe('4,2 km depuis ta position');
    expect(distanceSentence({ km: 4.24, approx: false }, zone)).toBe('4,2 km depuis ta zone');
  });

  it('club au centre-ville : on le DIT, au lieu de faire passer une approximation pour une mesure', () => {
    expect(distanceSentence({ km: 12.2, approx: true }, gps))
      .toBe('~12 km depuis ta position (position approximative du club)');
  });

  it('sans point de départ, ou lieu inconnu : aucune phrase', () => {
    expect(distanceSentence({ km: 4.2, approx: false }, null)).toBeNull();
    expect(distanceSentence(null, gps)).toBeNull();
    expect(distanceSentence(undefined, gps)).toBeNull();
  });
});

describe('sortByMatchDate — le tri « Date » de l\'Explorer', () => {
  it('la partie qui se joue le plus tôt d\'abord, quel que soit l\'ordre de création', () => {
    const creees = [
      { id: 'demain', match_date: '2026-09-19T14:30:00Z' },
      { id: 'ce-soir', match_date: '2026-09-18T18:00:00Z' },
      { id: 'sans-date', match_date: null },
      { id: 'dans-une-heure', match_date: '2026-09-18T17:00:00Z' },
    ];
    expect(sortByMatchDate(creees).map(g => g.id)).toEqual(['dans-une-heure', 'ce-soir', 'demain', 'sans-date']);
  });
  it('ne modifie pas la liste reçue', () => {
    const l = [{ match_date: '2026-09-19T00:00:00Z' }, { match_date: '2026-09-18T00:00:00Z' }];
    sortByMatchDate(l);
    expect(l[0].match_date).toBe('2026-09-19T00:00:00Z');
  });
});
