// lib/__tests__/badgesNeutral.test.ts — badges neutres proposables au vote
// (hub Activité, carte « Ton match d'hier »).
import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import { getNeutralVoteBadges, isNeutralBadgeColor } from '../badges';

describe('isNeutralBadgeColor — ni victoire ni défaite', () => {
  it('le rouge et le vert de la charte sont réservés à défaite/victoire', () => {
    expect(isNeutralBadgeColor('#E5484D')).toBe(false); // rouge (La Bombe, Le Smash)
    expect(isNeutralBadgeColor('#16A34A')).toBe(false); // vert (Fair-Play, Ponctuel…)
  });

  it('les autres teintes du catalogue sont neutres', () => {
    expect(isNeutralBadgeColor('#5B6B82')).toBe(true);  // slate (Le Mur)
    expect(isNeutralBadgeColor('#7C5CD6')).toBe(true);  // violet (Le Cerveau)
    expect(isNeutralBadgeColor('#E6A21A')).toBe(true);  // or (Le Capitaine)
  });
});

describe('getNeutralVoteBadges — le sous-ensemble proposé par la carte de vote', () => {
  it('exclut les badges rouges/verts et MVP, sur le catalogue par défaut', () => {
    const keys = getNeutralVoteBadges().map(b => b.key);
    expect(keys).not.toContain('MVP');
    expect(keys).not.toContain('La Bombe');
    expect(keys).not.toContain('Le Smash');
    expect(keys).not.toContain('Fair-Play');
    expect(keys).not.toContain('Ponctuel');
    expect(keys).not.toContain('Bonne Ambiance');
    expect(keys).not.toContain('3e Mi-temps');
    // Les badges neutres du catalogue par défaut restent proposables.
    expect(keys).toContain('Le Mur');
    expect(keys).toContain('Le Cerveau');
    expect(keys).toContain("L'Essuie-glace");
    expect(keys).toContain('Le Capitaine');
  });
});
