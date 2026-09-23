// La répartition de l'accueil : des POURCENTAGES d'une hauteur MESURÉE.
//
// L'ancien modèle donnait à chaque bloc une part ET un plancher. Deux blocs
// (le bandeau Tournois, « Ça bouge ») n'avaient même pas de part : ils
// prenaient la hauteur de leur contenu. Le budget les croyait à 104 et 150
// points, ils en prenaient davantage, la somme débordait — et comme rien ne
// pouvait rétrécir, le dernier bloc passait sous la barre d'onglets.
//
// Ici, la somme des parts fait exactement la hauteur disponible. Par
// construction, rien ne dépasse. Ce qui manque à un bloc rigide est pris à un
// bloc souple ; si ça ne suffit pas, le bloc souple disparaît plutôt que de
// s'afficher coupé.
import { describe, it, expect } from 'vitest';
import { allocateHome, type HomeBlock } from '../homeLayout';

const somme = (h: Record<string, number>) => Object.values(h).reduce((a, b) => a + b, 0);

const blocs = (o: Partial<Record<string, Partial<HomeBlock>>> = {}): HomeBlock[] => [
  { key: 'ctas', share: 1.8, need: 118, ...(o.ctas ?? {}) },
  { key: 'tournaments', share: 1.0, need: 92, ...(o.tournaments ?? {}) },
  { key: 'nextMatch', share: 2.2, need: 150, ...(o.nextMatch ?? {}) },
  { key: 'pulse', share: 1.6, need: 130, yields: true, ...(o.pulse ?? {}) },
];

describe('la somme fait exactement la hauteur disponible', () => {
  it('grand écran : personne ne déborde, personne ne manque', () => {
    const h = allocateHome(blocs(), 700, 10);
    expect(somme(h)).toBeCloseTo(700 - 3 * 10, 5);
    for (const b of blocs()) expect(h[b.key]).toBeGreaterThanOrEqual(b.need);
  });

  it('petit écran : la somme tient encore exactement', () => {
    const h = allocateHome(blocs(), 520, 10);
    // Le bloc souple a pu disparaître : on compte les espaces réellement posés.
    const rendus = Object.values(h).filter(v => v > 0).length;
    expect(somme(h)).toBeCloseTo(520 - (rendus - 1) * 10, 5);
  });

  it('écran minuscule : tout rétrécit, mais rien ne dépasse', () => {
    const h = allocateHome(blocs(), 260, 10);
    const rendus = Object.values(h).filter(v => v > 0).length;
    expect(somme(h)).toBeLessThanOrEqual(260 - (rendus - 1) * 10 + 0.01);
  });
});

describe('qui cède quand ça ne rentre pas', () => {
  it('le bloc souple rend sa place avant les autres', () => {
    const large = allocateHome(blocs(), 700, 10);
    const serre = allocateHome(blocs(), 560, 10);
    expect(serre.pulse).toBeLessThan(large.pulse);
    expect(serre.nextMatch).toBeGreaterThanOrEqual(150);
  });

  it('trop serré : il disparaît au lieu de s afficher coupé', () => {
    // Un bloc a moitie visible ment sur ce qu'il contient : ses boutons sont
    // sous la barre, on ne sait meme pas qu'ils existent.
    const h = allocateHome(blocs(), 430, 10);
    expect(h.pulse).toBe(0);
    expect(h.nextMatch).toBeGreaterThanOrEqual(150);
    expect(h.ctas).toBeGreaterThanOrEqual(118);
  });

  it('les blocs rigides ne descendent jamais sous leur besoin tant qu il reste du souple', () => {
    const h = allocateHome(blocs(), 450, 10);
    expect(h.ctas).toBeGreaterThanOrEqual(118);
    expect(h.tournaments).toBeGreaterThanOrEqual(92);
    expect(h.nextMatch).toBeGreaterThanOrEqual(150);
  });

  it('plus rien à céder : tout le monde rétrécit ensemble, proportionnellement', () => {
    // Le cas ou meme sans le bloc souple ca ne rentre pas. On ne peut plus
    // rien promettre — mais on ne laisse toujours rien depasser.
    const h = allocateHome(blocs(), 300, 10);
    const rendus = Object.values(h).filter(v => v > 0).length;
    expect(somme(h)).toBeLessThanOrEqual(300 - (rendus - 1) * 10 + 0.01);
    expect(h.ctas).toBeGreaterThan(0);
  });
});

describe('les cas de bord', () => {
  it('aucun bloc : rien à répartir', () => {
    expect(allocateHome([], 600, 10)).toEqual({});
  });

  it('hauteur pas encore mesurée : tout à zéro, on ne devine pas', () => {
    const h = allocateHome(blocs(), 0, 10);
    expect(somme(h)).toBe(0);
  });

  it('un seul bloc : il prend toute la place, sans espace', () => {
    const h = allocateHome([{ key: 'ctas', share: 1, need: 100 }], 400, 10);
    expect(h.ctas).toBeCloseTo(400, 5);
  });

  it('les espaces sont retirés pour de vrai, pas approximés', () => {
    const h = allocateHome(blocs(), 700, 16);
    expect(somme(h)).toBeCloseTo(700 - 3 * 16, 5);
  });
});
