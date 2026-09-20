import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import {
  featuredBlock, featuredDayLabel, monthLabel, monthKey, weekKey, isoWeekNumber,
  weekendWindow, mercatoSlotLabel, mercatoBandLabel, pickMercato, MERCATO_LEVEL_BAND,
  type MercatoRow,
} from '../hubFeatured';

// Semaine repère : lundi 14 → dimanche 20 septembre 2026.
const j = (jour: number, h = 10) => new Date(2026, 8, 13 + jour, h, 0, 0); // 13 sept. = dimanche
// j(0) = dimanche 13, j(1) = lundi 14, … j(7) = dimanche 20.

describe('featuredBlock — un seul bloc par jour', () => {
  it('lundi, mardi, mercredi → le taulier du club', () => {
    expect(featuredBlock(j(1))).toBe('taulier');
    expect(featuredBlock(j(2))).toBe('taulier');
    expect(featuredBlock(j(3))).toBe('taulier');
  });
  it('jeudi, vendredi, samedi → le mercato du week-end', () => {
    expect(featuredBlock(j(4))).toBe('mercato');
    expect(featuredBlock(j(5))).toBe('mercato');
    expect(featuredBlock(j(6))).toBe('mercato');
  });
  it('dimanche → le panthéon', () => {
    expect(featuredBlock(j(7))).toBe('pantheon');
    expect(featuredBlock(j(0))).toBe('pantheon');
  });
  it('les sept jours sont couverts, sans trou', () => {
    const vus = [0, 1, 2, 3, 4, 5, 6].map(d => featuredBlock(j(d)));
    expect(vus.filter(Boolean)).toHaveLength(7);
  });
});

describe('featuredDayLabel — la fin de « À LA UNE · … »', () => {
  it('donne le jour en capitales', () => {
    expect(featuredDayLabel(j(1))).toBe('LUNDI');
    expect(featuredDayLabel(j(4))).toBe('JEUDI');
    expect(featuredDayLabel(j(7))).toBe('DIMANCHE');
  });
});

describe('clés de période — doivent coller aux vues SQL', () => {
  it('monthKey = le 1er du mois', () => {
    expect(monthKey(new Date(2026, 7, 31))).toBe('2026-08-01');
    expect(monthKey(new Date(2026, 0, 1))).toBe('2026-01-01');
  });
  it('weekKey = le lundi de la semaine, dimanche compris', () => {
    expect(weekKey(j(1))).toBe('2026-09-14'); // lundi
    expect(weekKey(j(4))).toBe('2026-09-14'); // jeudi
    expect(weekKey(j(7))).toBe('2026-09-14'); // dimanche 20 → lundi 14
  });
  it('monthLabel est en toutes lettres', () => {
    expect(monthLabel(new Date(2026, 7, 3))).toBe('août');
  });
});

describe('isoWeekNumber — la pastille « SEMAINE n »', () => {
  it('numérote la semaine du 14 au 20 septembre 2026', () => {
    expect(isoWeekNumber(j(1))).toBe(isoWeekNumber(j(7)));
    expect(isoWeekNumber(j(1))).toBe(38);
  });
  it('le 4 janvier est toujours en semaine 1', () => {
    expect(isoWeekNumber(new Date(2026, 0, 4))).toBe(1);
    expect(isoWeekNumber(new Date(2024, 0, 4))).toBe(1);
  });
});

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
