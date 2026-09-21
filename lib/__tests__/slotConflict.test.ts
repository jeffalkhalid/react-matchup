import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import {
  overlapsSlot, busyPlayerIds, busyCreatorIds, OVERLAP_MS, MATCH_DURATION_MS, BUFFER_MS,
  type BusyParticipation,
} from '../slotConflict';

const CRENEAU = new Date(2026, 8, 24, 19, 0, 0).getTime(); // jeudi 24 sept., 19 h
const h = (n: number) => n * 60 * 60 * 1000;

describe('la fenêtre de chevauchement', () => {
  it('vaut la durée de jeu plus la marge', () => {
    expect(OVERLAP_MS).toBe(MATCH_DURATION_MS + BUFFER_MS);
    expect(OVERLAP_MS).toBe(h(2));
  });
});

describe('overlapsSlot', () => {
  it('même heure : conflit', () => {
    expect(overlapsSlot(CRENEAU, CRENEAU)).toBe(true);
  });
  it('une heure avant ou après : conflit', () => {
    expect(overlapsSlot(CRENEAU - h(1), CRENEAU)).toBe(true);
    expect(overlapsSlot(CRENEAU + h(1), CRENEAU)).toBe(true);
  });
  it('pile deux heures : PAS de conflit (comparaison stricte)', () => {
    expect(overlapsSlot(CRENEAU - h(2), CRENEAU)).toBe(false);
    expect(overlapsSlot(CRENEAU + h(2), CRENEAU)).toBe(false);
  });
  it('au-delà : pas de conflit', () => {
    expect(overlapsSlot(CRENEAU + h(3), CRENEAU)).toBe(false);
  });
  it('juste en deçà des deux heures : conflit', () => {
    expect(overlapsSlot(CRENEAU + h(2) - 60_000, CRENEAU)).toBe(true);
  });
  it('une date illisible ne crée pas de conflit', () => {
    expect(overlapsSlot(NaN, CRENEAU)).toBe(false);
    expect(overlapsSlot(CRENEAU, NaN)).toBe(false);
  });
});

const part = (playerId: string, iso: string | null, status = 'open'): BusyParticipation => ({
  player_id: playerId,
  game: iso === null ? null : { match_date: iso, status },
});

const iso = (dec: number) => new Date(CRENEAU + dec).toISOString();

describe('busyPlayerIds — qui est déjà pris sur le créneau', () => {
  it('marque le joueur dont la partie chevauche', () => {
    const s = busyPlayerIds([part('omar', iso(h(1)))], CRENEAU);
    expect([...s]).toEqual(['omar']);
  });

  it('laisse libre celui dont la partie est à deux heures pile', () => {
    expect(busyPlayerIds([part('omar', iso(h(2)))], CRENEAU).size).toBe(0);
  });

  it('une partie annulée n\'occupe plus personne', () => {
    expect(busyPlayerIds([part('omar', iso(0), 'cancelled')], CRENEAU).size).toBe(0);
  });

  it('une partie déjà scorée non plus', () => {
    expect(busyPlayerIds([part('omar', iso(0), 'closed')], CRENEAU).size).toBe(0);
  });

  it('une participation sans partie ni date est ignorée', () => {
    expect(busyPlayerIds([part('omar', null), part('rita', null)], CRENEAU).size).toBe(0);
  });

  it('ne rend chaque joueur qu\'une fois, même avec deux parties en conflit', () => {
    const s = busyPlayerIds([part('omar', iso(0)), part('omar', iso(h(1)))], CRENEAU);
    expect([...s]).toEqual(['omar']);
  });

  it('sépare bien les joueurs pris de ceux qui sont libres', () => {
    const s = busyPlayerIds([
      part('pris', iso(h(1))),
      part('libre', iso(h(5))),
      part('prisAussi', iso(-h(1))),
    ], CRENEAU);
    expect([...s].sort()).toEqual(['pris', 'prisAussi']);
  });

  it('sans créneau lisible, personne n\'est marqué indisponible', () => {
    expect(busyPlayerIds([part('omar', iso(0))], NaN).size).toBe(0);
  });

  it('liste vide → personne', () => {
    expect(busyPlayerIds([], CRENEAU).size).toBe(0);
  });
});

describe('busyCreatorIds — le créateur n\'est PAS un participant', () => {
  const partie = (creator: string, dec: number, status = 'open') => ({
    creator_id: creator, match_date: new Date(CRENEAU + dec).toISOString(), status,
  });

  it('l\'organisateur est pris à l\'heure de sa partie', () => {
    expect([...busyCreatorIds([partie('alamine', 0)], CRENEAU)]).toEqual(['alamine']);
  });

  it('même règle de chevauchement que pour les participants', () => {
    expect(busyCreatorIds([partie('alamine', h(1))], CRENEAU).size).toBe(1);
    expect(busyCreatorIds([partie('alamine', h(2))], CRENEAU).size).toBe(0);
  });

  it('une partie annulée ou scorée ne l\'occupe plus', () => {
    expect(busyCreatorIds([partie('alamine', 0, 'cancelled')], CRENEAU).size).toBe(0);
    expect(busyCreatorIds([partie('alamine', 0, 'closed')], CRENEAU).size).toBe(0);
  });

  it('sans date ni créateur, rien', () => {
    expect(busyCreatorIds([{ creator_id: 'a', match_date: null }], CRENEAU).size).toBe(0);
    expect(busyCreatorIds([{ creator_id: '', match_date: new Date(CRENEAU).toISOString() }], CRENEAU).size).toBe(0);
  });

  it('sans créneau lisible, personne', () => {
    expect(busyCreatorIds([partie('alamine', 0)], NaN).size).toBe(0);
  });
});
