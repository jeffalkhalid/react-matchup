// Lot 0 de la localisation : rapprocher les clubs de la base de ceux du
// fichier de l'utilisateur, et ne jamais écrire une position douteuse.
// Les cas viennent des mesures du 2026-09-17 sur les vraies données.
import { describe, it, expect } from 'vitest';
import {
  normaliserVille, motsSignificatifs, distanceKm, centresVilles,
  proposerCorrespondance, marquerPointsPartages, lireLienMaps, estLienCourt,
  controlerPoint, lireDecision, requeteMiseAJour,
} from '../../scripts/clubs-geo/clubsGeo.mjs';

const fichier = (ville: string, nom: string, lat: number, lng: number) =>
  ({ ville, nom, adresse: '', lat, lng, statut: 'Confirmé 2026' });
const base = (name: string, city: string) =>
  ({ id: '74f98e48-a088-4505-b2ac-9f6511496819', name, city, latitude: 0, longitude: 0, geo_confidence: 'city' });

describe('normalisation', () => {
  it('ignore accents, casse et espaces dans les villes', () => {
    expect(normaliserVille('Fès')).toBe(normaliserVille('fes'));
    expect(normaliserVille('Dar Bouazza')).toBe('darbouazza');
  });
  it('retire les mots vides et le nom de la ville', () => {
    expect([...motsSignificatifs('Agadir Padel Club', new Set(['agadir']))]).toEqual([]);
    expect([...motsSignificatifs('Oasis Sport City / City Ball')].sort()).toEqual(['ball', 'city', 'oasis']);
  });
});

describe('distance', () => {
  it('Casablanca → Rabat ≈ 87 km', () => {
    const d = distanceKm({ lat: 33.5731, lng: -7.5898 }, { lat: 34.0209, lng: -6.8416 });
    expect(d).toBeGreaterThan(85);
    expect(d).toBeLessThan(90);
  });
  it('centre des villes = point des clubs « city »', () => {
    const c = centresVilles([
      { ...base('A', 'Rabat'), latitude: 34.02, longitude: -6.84 },
      { ...base('B', 'Rabat'), latitude: 34.02, longitude: -6.84, geo_confidence: 'exact' },
    ]);
    expect(c.get('rabat')).toEqual({ lat: 34.02, lng: -6.84 });
  });
});

describe('rapprochement', () => {
  const casa = [fichier('Casablanca', 'City Ball / Oasis Sports City', 33.5485, -7.6372)];

  it('mêmes mots dans un autre ordre : correspondance sans alerte', () => {
    const p = proposerCorrespondance(base('Oasis Sport City / City Ball', 'Casablanca'), casa, { lat: 33.5731, lng: -7.5898 });
    expect(p.fichier?.nom).toBe('City Ball / Oasis Sports City');
    expect(p.alertes).toEqual([]);
  });

  it('seul le nom de la ville en commun : aucune correspondance', () => {
    const p = proposerCorrespondance(base('Agadir Padel Club', 'Agadir'), [fichier('Agadir', 'Royal Tennis Club Agadir', 30.42, -9.6)]);
    expect(p.fichier).toBeNull();
    expect(p.alertes).toEqual(['absent du fichier']);
  });

  it('un seul mot en commun sur plusieurs : alerte', () => {
    const p = proposerCorrespondance(base('Fairmont Royal Palm Marrakech', 'Marrakech'), [fichier('Marrakech', 'Palm Tennis Club & Padel', 31.6, -8.0)]);
    expect(p.alertes).toContain('un seul mot en commun');
  });

  it('jamais d\'une ville à une autre', () => {
    const p = proposerCorrespondance(base('Hercules Park', 'Agadir'), [fichier('Tanger', 'Hercules Park', 35.7, -5.8)]);
    expect(p.fichier).toBeNull();
  });

  it('loin du centre de la ville : alerte', () => {
    const p = proposerCorrespondance(base('Padel Valley', 'Rabat'), [fichier('Rabat', 'Padel Valley', 34.9, -6.84)], { lat: 34.02, lng: -6.84 });
    expect(p.alertes.some(a => a.startsWith('loin de la ville'))).toBe(true);
  });

  it('deux clubs de la base sur le même point du fichier : alerte des deux côtés', () => {
    const f = fichier('Marrakech', 'Palm Tennis Club & Padel', 31.6, -8.0);
    const ps = marquerPointsPartages([
      proposerCorrespondance(base('Palm Tennis Club', 'Marrakech'), [f]),
      proposerCorrespondance(base('Fairmont Royal Palm', 'Marrakech'), [f]),
    ]);
    expect(ps.every(p => p.alertes.includes('point partagé avec un autre club'))).toBe(true);
  });
});

describe('liens Google Maps', () => {
  it('lit ?q=lat,lng', () => {
    expect(lireLienMaps('https://www.google.com/maps?q=33.5025278,-7.6837912')).toEqual({ lat: 33.5025278, lng: -7.6837912 });
  });
  it('préfère l\'épingle (!3d!4d) au centre de la vue (@)', () => {
    const l = 'https://www.google.com/maps/place/X/@33.54,-7.61,17z/data=!3d33.5425125!4d-7.6182031';
    expect(lireLienMaps(l)).toEqual({ lat: 33.5425125, lng: -7.6182031 });
  });
  it('lit une virgule encodée et un couple collé tel quel', () => {
    expect(lireLienMaps('https://maps.google.com/?q=33.5%2C-7.6')).toEqual({ lat: 33.5, lng: -7.6 });
    expect(lireLienMaps('33.5025, -7.6838')).toEqual({ lat: 33.5025, lng: -7.6838 });
  });
  it('rend null sur un texte illisible, et repère les liens courts', () => {
    expect(lireLienMaps('voir avec le club')).toBeNull();
    expect(estLienCourt('https://maps.app.goo.gl/AbCd123')).toBe(true);
    expect(estLienCourt('https://www.google.com/maps?q=1,2')).toBe(false);
  });
});

describe('contrôles', () => {
  const rabat = { lat: 34.02, lng: -6.84 };
  it('accepte un point proche de la ville', () => {
    expect(controlerPoint({ lat: 34.0, lng: -6.8 }, rabat, 'Rabat')).toEqual([]);
  });
  it('refuse un point hors du Maroc', () => {
    expect(controlerPoint({ lat: 48.85, lng: 2.35 }, rabat, 'Rabat')).toEqual(['hors du Maroc']);
  });
  it('refuse un point à plus de 40 km de la ville', () => {
    expect(controlerPoint({ lat: 34.6, lng: -6.84 }, rabat, 'Rabat')[0]).toMatch(/km de Rabat$/);
  });
});

describe('décisions', () => {
  it('oui / non / vide, sans tenir compte de la casse ni des accents', () => {
    expect(lireDecision('Oui')).toEqual({ type: 'oui' });
    expect(lireDecision(' NON ')).toEqual({ type: 'non' });
    expect(lireDecision('')).toEqual({ type: 'vide' });
    expect(lireDecision(null)).toEqual({ type: 'vide' });
  });
  it('un lien, y compris sous forme de cellule lien d\'Excel', () => {
    expect(lireDecision('https://maps.app.goo.gl/x')).toEqual({ type: 'lien', texte: 'https://maps.app.goo.gl/x' });
    expect(lireDecision({ text: 'lien', hyperlink: 'https://www.google.com/maps?q=1.5,2.5' }))
      .toEqual({ type: 'lien', texte: 'https://www.google.com/maps?q=1.5,2.5' });
  });
  it('tout le reste est signalé, jamais deviné', () => {
    expect(lireDecision('peut-être')).toEqual({ type: 'inconnu', texte: 'peut-être' });
  });
});

describe('requête SQL', () => {
  it('ne touche qu\'un club encore imprécis, et note la source', () => {
    const sql = requeteMiseAJour({ id: '74f98e48-a088-4505-b2ac-9f6511496819', lat: 33.5, lng: -7.6 });
    expect(sql).toBe("UPDATE public.clubs SET latitude = 33.5000000, longitude = -7.6000000, geo_confidence = 'exact', geo_source = 'verification_2026-09' WHERE id = '74f98e48-a088-4505-b2ac-9f6511496819' AND geo_confidence = 'city';");
  });
  it('refuse un identifiant qui n\'est pas un uuid', () => {
    expect(() => requeteMiseAJour({ id: "x'; DROP TABLE clubs; --", lat: 1, lng: 1 })).toThrow();
  });
});
