import { describe, it, expect } from 'vitest';
import { headlineFor } from '../activityHeadline';

const phrase = (type: string, isMe: boolean, name = 'Khalid', accent?: string) => {
  const h = headlineFor(type, isMe, name, accent);
  return [h.subject, h.verb, h.accent].filter(Boolean).join(' ');
};

describe('headlineFor — on ne parle pas de soi à la troisième personne', () => {
  it('mon match gagné', () => {
    expect(phrase('match_win', true)).toBe('Tu as gagné');
  });
  it('celui d\'un autre', () => {
    expect(phrase('match_win', false)).toBe('Khalid a gagné');
  });
  it('mon match perdu', () => {
    expect(phrase('match_loss', true)).toBe('Tu as perdu');
  });
  it('mon badge', () => {
    expect(phrase('badge', true)).toBe('Tu as débloqué un badge');
  });
  it('ma montée de ligue garde le complément', () => {
    expect(phrase('promotion', true, 'Khalid', 'Argent')).toBe('Tu montes en Argent');
    expect(phrase('promotion', false, 'Khalid', 'Argent')).toBe('Khalid monte en Argent');
  });
  it('mon bilan est le MIEN, le sien est le SIEN', () => {
    expect(phrase('bilan', true, 'Khalid', 'AOÛT')).toBe('Tu as partagé ton bilan AOÛT');
    expect(phrase('bilan', false, 'Khalid', 'AOÛT')).toBe('Khalid a partagé son bilan AOÛT');
  });
  it('sans nom connu, on ne laisse pas un blanc', () => {
    expect(phrase('match_win', false, '')).toBe('Joueur a gagné');
  });
  it('un type inconnu ne fabrique pas de verbe', () => {
    expect(headlineFor('nawak', false, 'Khalid').verb).toBe('');
  });
});
