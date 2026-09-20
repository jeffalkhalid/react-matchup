import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import {
  weekendWindow, mercatoSlotLabel, mercatoBandLabel, pickMercato, MERCATO_LEVEL_BAND,
  type MercatoRow,
} from '../mercato';

// Semaine repère : lundi 14 → dimanche 20 septembre 2026.
const j = (jour: number, h = 10) => new Date(2026, 8, 13 + jour, h, 0, 0); // 13 sept. = dimanche

describe('weekendWindow — samedi 8 h → dimanche minuit', () => {
  it('en semaine, vise le samedi qui vient', () => {
    const { start, end } = weekendWindow(j(3)); // mercredi 16
    expect(start.getDate()).toBe(19);
    expect(start.getHours()).toBe(8);
    expect(end.getDate()).toBe(20);
  });
  it('le samedi, vise le jour même', () => {
    expect(weekendWindow(j(6)).start.getDate()).toBe(19);
  });
  it('le dimanche, le week-end en cours n\'est pas encore fini', () => {
    const { start, end } = weekendWindow(j(7));
    expect(start.getDate()).toBe(19);
    expect(end.getDate()).toBe(20);
  });
});

describe('mercatoSlotLabel', () => {
  it('samedi matin', () => {
    expect(mercatoSlotLabel('2026-09-19T08:00:00', '2026-09-19T13:00:00')).toBe('Sam. matin');
  });
  it('samedi après-midi', () => {
    expect(mercatoSlotLabel('2026-09-19T15:00:00', '2026-09-19T19:00:00')).toBe('Sam. après-midi');
  });
  it('à cheval sur les deux jours', () => {
    expect(mercatoSlotLabel('2026-09-19T08:00:00', '2026-09-20T23:00:00')).toBe('Sam. ou dim.');
  });
  it('date illisible → rien plutôt qu\'un libellé faux', () => {
    expect(mercatoSlotLabel('nawak', 'nawak')).toBe('');
  });
});

describe('mercatoBandLabel', () => {
  it('annonce la fourchette autour de mon niveau', () => {
    expect(mercatoBandLabel(1500)).toMatch(/^\d\.\d – \d\.\d$/);
  });
  it('sans ELO, pas de fourchette inventée', () => {
    expect(mercatoBandLabel(null)).toBeNull();
  });
});

// ── pickMercato ───────────────────────────────────────────────────────────
const r = (id: string, over: Partial<MercatoRow> = {}): MercatoRow => ({
  playerId: id, name: id, avatarPath: null, memberNumber: null,
  elo: 1500, clubs: [], slotStart: '2026-09-19T08:00:00', slotEnd: '2026-09-19T13:00:00',
  ...over,
});

describe('pickMercato — qui proposer pour le week-end', () => {
  it('ne me propose jamais moi-même', () => {
    const out = pickMercato([r('moi'), r('rita')], { myId: 'moi', myElo: 1500 });
    expect(out.map(x => x.playerId)).toEqual(['rita']);
  });

  it('écarte les joueurs déjà dans une de mes parties du week-end', () => {
    const out = pickMercato([r('rita'), r('galan')], { myId: 'moi', myElo: 1500, excludeIds: ['galan'] });
    expect(out.map(x => x.playerId)).toEqual(['rita']);
  });

  it('garde les joueurs à ma portée de niveau et écarte les autres', () => {
    const out = pickMercato([r('proche', { elo: 1520 }), r('loin', { elo: 2200 })], { myId: 'moi', myElo: 1500 });
    expect(out.map(x => x.playerId)).toEqual(['proche']);
  });

  it('garde un ami même hors de ma portée de niveau', () => {
    const out = pickMercato([r('ami', { elo: 2200 })], { myId: 'moi', myElo: 1500, friendIds: ['ami'] });
    expect(out.map(x => x.playerId)).toEqual(['ami']);
  });

  it('sans ELO de référence, seul le cercle remonte', () => {
    const out = pickMercato([r('ami'), r('inconnu')], { myId: 'moi', myElo: null, friendIds: ['ami'] });
    expect(out.map(x => x.playerId)).toEqual(['ami']);
  });

  it('un joueur n\'apparaît qu\'une fois, sur son créneau le plus tôt', () => {
    const out = pickMercato([
      r('rita', { slotStart: '2026-09-20T09:00:00' }),
      r('rita', { slotStart: '2026-09-19T08:00:00' }),
    ], { myId: 'moi', myElo: 1500 });
    expect(out).toHaveLength(1);
    expect(out[0].slotStart).toBe('2026-09-19T08:00:00');
  });

  it('un club commun passe devant un ami sans club commun', () => {
    const out = pickMercato([
      r('ami', { elo: 1500 }),
      r('memeClub', { elo: 1500, clubs: ['Padel Art'] }),
    ], { myId: 'moi', myElo: 1500, friendIds: ['ami'], myClubs: ['Padel Art'] });
    expect(out.map(x => x.playerId)).toEqual(['memeClub', 'ami']);
  });

  it('à égalité de club et de cercle, le niveau le plus proche passe devant', () => {
    const out = pickMercato([
      r('loinDansLaBande', { elo: 1550 }), // niveau 5.6 contre 5.4 : dans la bande, mais moins proche
      r('pile', { elo: 1500 }),
    ], { myId: 'moi', myElo: 1500 });
    expect(out[0].playerId).toBe('pile');
  });

  it('respecte la limite demandée', () => {
    const rows = ['a', 'b', 'c', 'd'].map(id => r(id));
    expect(pickMercato(rows, { myId: 'moi', myElo: 1500, limit: 2 })).toHaveLength(2);
  });

  it('la bande annoncée est bien celle qui filtre', () => {
    expect(MERCATO_LEVEL_BAND).toBe(0.5);
  });
});
