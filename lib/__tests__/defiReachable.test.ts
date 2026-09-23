// Un défi ciblé qu'on ne peut pas relever.
//
// Le plancher est la moyenne du binôme qui lance ; désigner un adversaire fige
// la moitié de la moyenne adverse. S'il est très loin, aucun partenaire ne
// rattrape : à 2,00 contre un plancher de 4,66, il faudrait un binôme à 7,32.
// Le défi partait quand même, et l'adversaire cherchait quelqu'un qui n'existe
// pas.
import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import { defiGapTooWide, partnerLevelRangeFor } from '../defis';

describe('quel binôme l adversaire désigné doit-il amener', () => {
  it('le cas ordinaire : une fourchette large et atteignable', () => {
    // Plancher 4,66 (Galan 5,11 + Chingoto 4,21), plafond 5,50, Alamine 4,95.
    expect(partnerLevelRangeFor(4.95, 4.66, 5.5)).toEqual([4.37, 6.05]);
  });

  it('un adversaire tres faible : il faut un tres gros binome', () => {
    // Improbable n'est pas impossible, et la fonction ne doit pas mentir :
    // a 2,00 contre un plancher de 4,66, il faut 7,32 — ce qui EXISTE. On
    // montre le chiffre et le createur juge, plutot que d'inventer un seuil
    // de « difficulte » qui serait arbitraire.
    expect(partnerLevelRangeFor(2.0, 4.66, 5.5)).toEqual([7.32, 8]);
  });

  it('vraiment impossible : la fenetre se referme', () => {
    // Un adversaire au plafond de l'echelle sur une fourchette basse : meme
    // le joueur le plus faible ferait deborder la moyenne.
    expect(partnerLevelRangeFor(8.0, 1.0, 1.5)).toBeNull();
  });

  it('la borne haute de l echelle ne se depasse pas', () => {
    const r = partnerLevelRangeFor(4.0, 5.0, 7.0);
    expect(r![1]).toBeLessThanOrEqual(8);
  });

  it('la borne basse non plus', () => {
    const r = partnerLevelRangeFor(7.0, 2.0, 4.0);
    expect(r![0]).toBeGreaterThanOrEqual(1);
  });
});

describe("l ecart est-il trop grand pour retomber sur la moyenne", () => {
  it('aucun adversaire designe : rien a dire', () => {
    expect(defiGapTooWide([], 4.66, 5.5)).toBeNull();
  });

  it('un adversaire dans la fourchette : rien a dire', () => {
    expect(defiGapTooWide([4.95], 4.66, 5.5)).toBeNull();
  });

  it('un peu en dessous : ca reste rattrapable', () => {
    // 4,20 contre un plancher de 4,66 : il faut un binome a 5,12, juste
    // au-dessus du plafond. Raisonnable, on ne dit rien.
    expect(defiGapTooWide([4.2], 4.66, 5.5)).toBeNull();
  });

  it('tres en dessous : le binome devrait etre bien au-dessus du plafond', () => {
    // 2,00 : il faudrait 7,32 pour une fourchette qui s arrete a 5,50.
    expect(defiGapTooWide([2.0], 4.66, 5.5)).toBe('haut');
  });

  it('tres au-dessus : l inverse', () => {
    expect(defiGapTooWide([8.0], 2.0, 2.5)).toBe('bas');
  });

  it('deux adversaires : c est leur moyenne qu on regarde', () => {
    expect(defiGapTooWide([4.95, 4.81], 4.66, 5.5)).toBeNull();
    expect(defiGapTooWide([2.0, 2.5], 4.66, 5.5)).toBe('haut');
  });
});
