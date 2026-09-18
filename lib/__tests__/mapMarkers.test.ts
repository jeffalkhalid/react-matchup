import { describe, it, expect, vi } from 'vitest';

// lib/games charge le client Supabase au chargement ; les fonctions testees
// ici sont pures : on neutralise le module (meme principe qu'urgentGame.test).
vi.mock('../supabase', () => ({ supabase: {} }));

import { groupMapMarkers, panelRows, whenLabel, type MapMarker } from '../mapMarkers';
import { levelRangeLabel } from '../games';

const points: Record<string, { lat: number; lng: number; approx: boolean }> = {
  'Padel 4 Maroc': { lat: 33.53, lng: -7.64, approx: false },
  'Voisin Exact': { lat: 33.53, lng: -7.64, approx: false },       // même point exact
  'COC Padel': { lat: 33.5731, lng: -7.5898, approx: true },       // centre de Casablanca
  'Club Centre 2': { lat: 33.5731, lng: -7.5898, approx: true },   // même ville
  'ACSA': { lat: 34.0209, lng: -6.8416, approx: true },            // centre de Rabat
};
const villes: Record<string, string> = {
  'Padel 4 Maroc': 'Bouskoura', 'Voisin Exact': 'Bouskoura',
  'COC Padel': 'Casablanca', 'Club Centre 2': 'Casablanca', 'ACSA': 'Rabat',
};
const pointOf = (l: string) => points[l] ?? null;
const cityOf = (l: string) => villes[l] ?? null;
const g = (id: string, location: string | null) => ({ id, location });

describe('regrouper les parties en repères', () => {
  it('un repère par position de club PRÉCISE, avec ses parties', () => {
    const { markers } = groupMapMarkers([g('a', 'Padel 4 Maroc'), g('b', 'Padel 4 Maroc')], pointOf, cityOf);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ kind: 'club', label: 'Padel 4 Maroc', clubs: ['Padel 4 Maroc'], gameIds: ['a', 'b'] });
  });

  it('deux clubs précis au même point : un seul repère, les deux noms', () => {
    const { markers } = groupMapMarkers([g('a', 'Padel 4 Maroc'), g('b', 'Voisin Exact')], pointOf, cityOf);
    expect(markers).toHaveLength(1);
    expect(markers[0].label).toBe('Padel 4 Maroc · Voisin Exact');
    expect(markers[0].clubs).toEqual(['Padel 4 Maroc', 'Voisin Exact']);
  });

  it('clubs au centre-ville : UN repère par ville, jamais un faux point par club', () => {
    const { markers } = groupMapMarkers([g('a', 'COC Padel'), g('b', 'Club Centre 2'), g('c', 'ACSA')], pointOf, cityOf);
    const casa = markers.find(m => m.label === 'Casablanca')!;
    expect(casa).toMatchObject({ kind: 'city', clubs: ['COC Padel', 'Club Centre 2'], gameIds: ['a', 'b'] });
    expect(markers.find(m => m.label === 'Rabat')).toMatchObject({ kind: 'city', gameIds: ['c'] });
    expect(markers).toHaveLength(2);
  });

  it('lieu inconnu ou vide : pas de repère, mais on le COMPTE', () => {
    const r = groupMapMarkers([g('a', 'Club Inconnu'), g('b', null), g('c', 'Padel 4 Maroc')], pointOf, cityOf);
    expect(r.unplaced).toBe(2);
    expect(r.markers).toHaveLength(1);
  });

  it('club au centre-ville SANS ville connue : repère à son nom, toujours atténué', () => {
    const r = groupMapMarkers([g('a', 'COC Padel')], pointOf, () => null);
    expect(r.markers[0]).toMatchObject({ kind: 'city', label: 'COC Padel' });
  });

  it('ordre stable d un appel à l autre', () => {
    const a = groupMapMarkers([g('a', 'ACSA'), g('b', 'Padel 4 Maroc'), g('c', 'COC Padel')], pointOf, cityOf);
    const b = groupMapMarkers([g('c', 'COC Padel'), g('a', 'ACSA'), g('b', 'Padel 4 Maroc')], pointOf, cityOf);
    expect(a.markers.map(m => m.key)).toEqual(b.markers.map(m => m.key));
  });
});

describe('libellé de niveau (même règle que la carte du lobby)', () => {
  it('fourchette déclarée', () => {
    expect(levelRangeLabel({ creator_id: 'c', min_elo: 1000, max_elo: 1400 })).toMatch(/^\d\.\d – \d\.\d$/);
  });
  it('bornes confondues : une seule valeur', () => {
    expect(levelRangeLabel({ creator_id: 'c', min_elo: 1200, max_elo: 1200 })).toMatch(/^\d\.\d$/);
  });
  it('aucune fourchette ni joueur : null', () => {
    expect(levelRangeLabel({ creator_id: 'c' })).toBeNull();
  });
});

describe('le moment d une partie', () => {
  const now = new Date(2026, 8, 18, 10, 0);
  it('aujourd hui, demain, puis la date', () => {
    expect(whenLabel(new Date(2026, 8, 18, 19, 30).toISOString(), now)).toBe("Aujourd'hui · 19:30");
    expect(whenLabel(new Date(2026, 8, 19, 9, 5).toISOString(), now)).toBe('Demain · 09:05');
    expect(whenLabel(new Date(2026, 8, 21, 20, 0).toISOString(), now)).toMatch(/^Lun\.? 21 sept\.? · 20:00$/);
  });
  it('sans date : « Date à fixer »', () => {
    expect(whenLabel(null, now)).toBe('Date à fixer');
  });
});

describe('les lignes du panneau', () => {
  const now = new Date(2026, 8, 18, 10, 0);
  const partie = (id: string, location: string, jour: number, heure: number) => ({
    id, location, creator_id: 'c', match_date: new Date(2026, 8, jour, heure).toISOString(),
    min_elo: 1000, max_elo: 1400,
    participants: [{ player_id: 'x', status: 'accepted' }],
  });
  const marker: MapMarker = {
    key: 'ville:casablanca', kind: 'city', lat: 0, lng: 0, label: 'Casablanca',
    clubs: ['COC Padel', 'Club Centre 2'], gameIds: ['tard', 'tot'],
  };
  const distanceOf = (l: string | null | undefined) => (l === 'COC Padel' ? { km: 12.2, approx: true } : null);

  it('les parties du repère, de la plus proche dans le temps à la plus lointaine', () => {
    const rows = panelRows(
      [partie('tard', 'Club Centre 2', 20, 20), partie('tot', 'COC Padel', 18, 19), partie('ailleurs', 'ACSA', 18, 12)],
      marker, distanceOf, now,
    );
    expect(rows.map(r => r.id)).toEqual(['tot', 'tard']);
  });

  it('chaque ligne dit heure, club, niveau, places et distance', () => {
    const [row] = panelRows([partie('tot', 'COC Padel', 18, 19)], marker, distanceOf, now);
    expect(row).toMatchObject({ id: 'tot', when: "Aujourd'hui · 19:00", club: 'COC Padel', places: '2 places dispo' , distance: '~12 km' });
    expect(row.level).toMatch(/^\d\.\d – \d\.\d$/);
  });

  it('distance inconnue : null, jamais un chiffre inventé', () => {
    const [row] = panelRows([partie('tard', 'Club Centre 2', 20, 20)], marker, distanceOf, now);
    expect(row.distance).toBeNull();
  });
});
