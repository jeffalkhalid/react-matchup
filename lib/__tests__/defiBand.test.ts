// Fourchette d'un défi + traduction des refus.
//
// Bug d'origine (2026-09-16, device) : un défi créé avec minimum = maximum
// (6.03) refusait TOUT binôme, et le refus s'affichait en anglais au moment
// d'accepter une invitation.
import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));

import { DEFI_BAND_MIN_LEVEL, defiMinimumMaxLevel, isDefiBandWideEnough } from '../defis';
import { defiRefusalMessage } from '../defiMessages';

describe('largeur de la fourchette', () => {
  it('refuse une fourchette nulle', () => {
    expect(isDefiBandWideEnough(6.03, 6.03)).toBe(false);
  });

  it('accepte la largeur minimale retenue', () => {
    expect(isDefiBandWideEnough(6.0, 6.0 + DEFI_BAND_MIN_LEVEL)).toBe(true);
  });

  it('refuse juste en dessous', () => {
    expect(isDefiBandWideEnough(6.0, 6.4)).toBe(false);
  });

  it('donne le maximum le plus bas acceptable', () => {
    expect(defiMinimumMaxLevel(6.0)).toBe(6.5);
    expect(defiMinimumMaxLevel(7.8)).toBe(8);   // jamais au-dessus du plafond
  });
});

describe('refus traduits', () => {
  const bande = { min_elo: 1400, max_elo: 1650 };   // 5.0 → 6.0

  it('hors fourchette : dit la fourchette et la moyenne de la paire', () => {
    const m = defiRefusalMessage(new Error('binome out of level band'), bande, 1250);
    expect(m?.title).toBe('Niveau de la paire');
    expect(m?.body).toContain('5.0');
    expect(m?.body).toContain('6.0');
    expect(m?.body).toContain('4.3');            // moyenne de la paire (ELO 1250)
  });

  it('fourchette nulle : accuse le défi, pas le binôme', () => {
    const m = defiRefusalMessage(new Error('binome out of level band'), { min_elo: 1659, max_elo: 1659 });
    expect(m?.title).toBe('Défi impossible à relever');
    expect(m?.body).toContain('exactement');
  });

  it('déjà engagés', () => {
    expect(defiRefusalMessage(new Error('already in game'))?.title).toBe('Déjà engagés');
  });

  it('refus inconnu : laisse l’appelant décider', () => {
    expect(defiRefusalMessage(new Error('boom'))).toBeNull();
  });
});
