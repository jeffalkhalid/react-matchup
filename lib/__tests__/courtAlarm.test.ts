import { describe, it, expect, vi } from 'vitest';
import { syncCourtAlarms, type AlarmPort } from '../courtAlarm';

const faussePorte = () => {
  const programmees: { seconds: number; title: string; id: string }[] = [];
  const annulees: string[] = [];
  let n = 0;
  const port: AlarmPort = {
    schedule: async (o) => { const id = `n${++n}`; programmees.push({ ...o, id }); return id; },
    cancel: async (id) => { annulees.push(id); },
  };
  return { port, programmees, annulees };
};

describe('les sonneries d un terrain', () => {
  it('programme la fin et la relance quand le chrono part', async () => {
    const { port, programmees } = faussePorte();
    await syncCourtAlarms({ matchId: 'm1', courtNo: 3, secondsLeft: 900, hasScore: false }, port, new Map());
    expect(programmees.map(p => p.seconds)).toEqual([900, 1080]);
  });

  it('ne reprogramme rien si les sonneries du match sont deja posees', async () => {
    const { port, programmees } = faussePorte();
    const memoire = new Map([['m1', ['deja1', 'deja2']]]);
    await syncCourtAlarms({ matchId: 'm1', courtNo: 3, secondsLeft: 600, hasScore: false }, port, memoire);
    expect(programmees).toEqual([]);
  });

  it('annule tout des qu un score est saisi', async () => {
    const { port, annulees } = faussePorte();
    const memoire = new Map([['m1', ['a', 'b']]]);
    await syncCourtAlarms({ matchId: 'm1', courtNo: 3, secondsLeft: 300, hasScore: true }, port, memoire);
    expect(annulees).toEqual(['a', 'b']);
    expect(memoire.has('m1')).toBe(false);
  });

  it('annule les sonneries de la rotation precedente quand on change de terrain', async () => {
    const { port, annulees } = faussePorte();
    const memoire = new Map([['ancien', ['x']]]);
    await syncCourtAlarms({ matchId: 'm2', courtNo: 1, secondsLeft: 900, hasScore: false }, port, memoire);
    expect(annulees).toEqual(['x']);
    expect(memoire.has('m2')).toBe(true);
  });

  it('ne programme rien pour un temps deja depasse', async () => {
    const { port, programmees } = faussePorte();
    await syncCourtAlarms({ matchId: 'm1', courtNo: 2, secondsLeft: -30, hasScore: false }, port, new Map());
    expect(programmees.map(p => p.seconds)).toEqual([150]);
  });

  it('ne fait rien, et ne leve pas, quand la porte refuse (notifications coupees)', async () => {
    const port: AlarmPort = {
      schedule: async () => { throw new Error('permission refusée'); },
      cancel: async () => { throw new Error('permission refusée'); },
    };
    const memoire = new Map<string, string[]>();
    await expect(
      syncCourtAlarms({ matchId: 'm1', courtNo: 2, secondsLeft: 900, hasScore: false }, port, memoire),
    ).resolves.toBeUndefined();
    expect(memoire.size).toBe(0);
  });

  it('ne programme rien quand je ne joue pas cette rotation', async () => {
    const { port, programmees } = faussePorte();
    await syncCourtAlarms({ matchId: null, courtNo: 0, secondsLeft: null, hasScore: false }, port, new Map());
    expect(programmees).toEqual([]);
  });
});
