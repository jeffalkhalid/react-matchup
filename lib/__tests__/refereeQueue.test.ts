import { describe, it, expect } from 'vitest';
import {
  ageHours, ageLabel, priorityScore, sortQueue, countByKind,
  type QueueItem, type QueueKind,
} from '../refereeQueue';

const now = new Date(2026, 8, 4, 12, 0, 0);
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

const item = (id: string, kind: QueueKind, hours: number): QueueItem => ({
  id, kind, title: id, summary: '', context: '',
  createdAt: ago(hours), targetTab: 'x',
});

describe('age d un dossier', () => {
  it('compte en heures, et une date future ne rend pas negatif', () => {
    expect(ageHours(ago(3), now)).toBeCloseTo(3);
    expect(ageHours(new Date(now.getTime() + 3_600_000).toISOString(), now)).toBe(0);
  });

  it('s affiche en heures puis en jours', () => {
    expect(ageLabel(ago(0.5), now)).toBe('à l’instant');
    expect(ageLabel(ago(6), now)).toBe('6 h');
    expect(ageLabel(ago(72), now)).toBe('3 j');
  });
});

describe('priorite de la file', () => {
  it('a anciennete EGALE, le litige passe devant tout', () => {
    const ordre = sortQueue([
      item('frmt', 'frmt', 5),
      item('genre', 'gender', 5),
      item('tournoi', 'tournament', 5),
      item('signal', 'report', 5),
      item('litige', 'dispute', 5),
    ], now).map(i => i.id);
    expect(ordre).toEqual(['litige', 'signal', 'tournoi', 'genre', 'frmt']);
  });

  it('un dossier qui TRAINE finit par doubler un dossier grave tout frais', () => {
    // C'est la regle qui evite qu'un type « peu grave » ne soit jamais traite :
    // sans elle, un rattachement FRMT resterait derriere le moindre litige,
    // indefiniment.
    const vieux = item('frmt-vieux', 'frmt', 24 * 7);   // une semaine
    const frais = item('litige-frais', 'dispute', 1);
    expect(priorityScore(vieux, now)).toBeGreaterThan(priorityScore(frais, now));
    expect(sortQueue([frais, vieux], now)[0].id).toBe('frmt-vieux');
  });

  it('a type egal, le plus ancien passe devant', () => {
    const ordre = sortQueue([item('recent', 'dispute', 1), item('ancien', 'dispute', 48)], now)
      .map(i => i.id);
    expect(ordre).toEqual(['ancien', 'recent']);
  });

  it('le tri est STABLE : deux dossiers identiques gardent un ordre previsible', () => {
    const a = { ...item('a', 'dispute', 5) };
    const b = { ...item('b', 'dispute', 5) };
    expect(sortQueue([b, a], now).map(i => i.id)).toEqual(['a', 'b']);
    expect(sortQueue([a, b], now).map(i => i.id)).toEqual(['a', 'b']);
  });

  it('ne modifie pas le tableau qu on lui donne', () => {
    const src = [item('b', 'dispute', 1), item('a', 'dispute', 9)];
    const copie = [...src];
    sortQueue(src, now);
    expect(src).toEqual(copie);
  });
});

describe('compteurs par type', () => {
  it('compte chaque type, zero compris', () => {
    const c = countByKind([
      item('1', 'dispute', 1), item('2', 'dispute', 2),
      item('3', 'report', 1),
      item('4', 'tournament', 1),
    ]);
    expect(c).toEqual({ dispute: 2, report: 1, frmt: 0, gender: 0, tournament: 1 });
  });

  it('une file vide rend cinq zeros', () => {
    expect(countByKind([])).toEqual({ dispute: 0, report: 0, frmt: 0, gender: 0, tournament: 0 });
  });
});
