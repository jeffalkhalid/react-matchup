import { describe, it, expect } from 'vitest';
import { fitLabelFontSize } from '../homeLayout';

// Les deux boutons de l'accueil : la taille du texte dérive de la largeur
// RÉELLE du bouton. `adjustsFontSizeToFit` n'est pas fiable sur Android avec
// Barlow Condensed Italic — vu sur un téléphone : « TROUVER UN MATCH » coupé
// en « TROUVER UN ».

const base = { max: 16, ref: 20, safety: 1, min: 9 };

describe('la taille des libelles des boutons', () => {
  it('garde la taille voulue quand le libelle tient', () => {
    // A la taille 20, le libelle fait 100 dp ; il y en a 200 : 16 tient.
    expect(fitLabelFontSize({ ...base, width: 200, naturalWidths: [100] })).toBe(16);
  });

  it('reduit PROPORTIONNELLEMENT quand le libelle ne tient pas', () => {
    // 20 * 120 / 200 = 12 : a 12, le libelle de 200 dp a 20 en fait 120.
    expect(fitLabelFontSize({ ...base, width: 120, naturalWidths: [200] })).toBe(12);
  });

  it('le libelle le PLUS LONG impose la taille, et les deux la partagent', () => {
    // « TROUVER UN MATCH » est plus long que « MATCH DEFI » : c'est lui qui
    // decide. Deux tailles differentes cote a cote se liraient comme un defaut.
    const t = fitLabelFontSize({ ...base, width: 120, naturalWidths: [200, 110] });
    expect(t).toBe(12);
  });

  it('applique la marge de securite (debord de l italique, arrondis Android)', () => {
    const sans = fitLabelFontSize({ ...base, width: 120, naturalWidths: [200] });
    const avec = fitLabelFontSize({ ...base, safety: 0.9, width: 120, naturalWidths: [200] });
    expect(avec).toBeLessThan(sans);
    expect(avec).toBeCloseTo(10.8);
  });

  it('ne descend jamais sous le plancher de lisibilite', () => {
    expect(fitLabelFontSize({ ...base, width: 30, naturalWidths: [400] })).toBe(9);
  });

  it('ne depasse jamais la taille voulue, meme avec beaucoup de place', () => {
    expect(fitLabelFontSize({ ...base, width: 5000, naturalWidths: [100] })).toBe(16);
  });

  it('rend la taille voulue tant que rien n est mesure', () => {
    // L'appelant masque le texte pendant ce premier rendu.
    expect(fitLabelFontSize({ ...base, width: 0, naturalWidths: [200] })).toBe(16);
    expect(fitLabelFontSize({ ...base, width: 120, naturalWidths: [] })).toBe(16);
    expect(fitLabelFontSize({ ...base, width: 120, naturalWidths: [200, 0] })).toBe(16);
  });

  it('utilise une marge de securite par defaut', () => {
    const defaut = fitLabelFontSize({ max: 16, ref: 20, width: 120, naturalWidths: [200] });
    expect(defaut).toBeLessThan(12);
  });
});
