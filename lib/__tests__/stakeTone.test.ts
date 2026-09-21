import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import { stakeTone, formatStake } from '../defis';

describe('stakeTone — une couleur par niveau de mise', () => {
  it('Soft (×2 et moins) = vert, Standard (jusqu\'à ×3) = jaune, High Stakes (au-delà) = rouge', () => {
    expect(stakeTone(2).level).toBe('soft');
    expect(stakeTone(3).level).toBe('standard');
    expect(stakeTone(4).level).toBe('high');
  });
  it('les anciens défis (×1.5, ×2.5) tombent dans le bon niveau', () => {
    expect(stakeTone(1.5).level).toBe('soft');
    expect(stakeTone(2.5).level).toBe('standard');
  });
  it('chaque niveau a un fond et un texte lisible dessus', () => {
    for (const v of [2, 3, 4]) {
      const t = stakeTone(v);
      expect(t.bg).toMatch(/^#/);
      expect(t.fg).toMatch(/^#/);
      expect(t.fg).not.toBe(t.bg);
    }
  });
});

describe("formatStake — la mise ecrite", () => {
  it("un entier ne traine pas de decimale", () => {
    expect(formatStake(3)).toBe("×3");
  });

  it("une demie la garde", () => {
    expect(formatStake(2.5)).toBe("×2.5");
  });

  it("sans mise, il n y a rien a ecrire", () => {
    expect(formatStake(1)).toBeNull();
    expect(formatStake(null)).toBeNull();
    expect(formatStake(undefined)).toBeNull();
  });

  it("une valeur abimee ne fabrique pas un ×NaN", () => {
    expect(formatStake(NaN)).toBeNull();
  });
});
