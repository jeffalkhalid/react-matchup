// La date d'un match, telle qu'on la lit partout : cartes, fiche, cloche.
//
// « ven. 2 oct. » oblige a calculer de tete si c'est aujourd'hui. Dans une
// notification, c'est precisement la question qu'on se pose.
import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import { gameWhenLabel } from '../games';

const MAINTENANT = new Date(2026, 8, 23, 11, 0, 0); // mercredi 23 septembre

describe('les jours qui comptent portent leur nom', () => {
  it('aujourd hui', () => {
    expect(gameWhenLabel(new Date(2026, 8, 23, 18, 30).toISOString(), MAINTENANT))
      .toBe("Aujourd'hui · 18h30");
  });

  it('demain', () => {
    expect(gameWhenLabel(new Date(2026, 8, 24, 14, 0).toISOString(), MAINTENANT))
      .toBe('Demain · 14h');
  });

  it('au-dela, la date', () => {
    expect(gameWhenLabel(new Date(2026, 8, 26, 14, 0).toISOString(), MAINTENANT))
      .toBe('sam. 26 sept. · 14h');
  });

  it('le CALENDRIER decide, pas les heures ecoulees', () => {
    // Demain 9 h est dans vingt-deux heures : c'est « Demain », pas « dans un
    // jour ». Et ce soir 23 h reste « Aujourd'hui », meme a douze heures de la.
    expect(gameWhenLabel(new Date(2026, 8, 24, 9, 0).toISOString(), MAINTENANT))
      .toBe('Demain · 9h');
    expect(gameWhenLabel(new Date(2026, 8, 23, 23, 0).toISOString(), MAINTENANT))
      .toBe("Aujourd'hui · 23h");
  });

  it('hier n est pas « aujourd hui »', () => {
    expect(gameWhenLabel(new Date(2026, 8, 22, 18, 0).toISOString(), MAINTENANT))
      .toBe('mar. 22 sept. · 18h');
  });

  it('sans date, rien', () => {
    expect(gameWhenLabel(null, MAINTENANT)).toBeNull();
    expect(gameWhenLabel('nawak', MAINTENANT)).toBeNull();
  });
});
