import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
vi.mock('react-native', () => ({ Linking: { openURL: vi.fn() } }));
import { hasMapTarget, DELETED_CLUB_LOCATION } from '../maps';

describe('hasMapTarget', () => {
  it('un club connu ou un lieu tapé peut s\'ouvrir dans Maps', () => {
    expect(hasMapTarget('Padel Hub')).toBe(true);
  });
  it('rien à ouvrir : lieu vide ou club retiré de l\'app', () => {
    expect(hasMapTarget(null)).toBe(false);
    expect(hasMapTarget('  ')).toBe(false);
    expect(hasMapTarget(DELETED_CLUB_LOCATION)).toBe(false);
    expect(hasMapTarget(' Club supprimé ')).toBe(false);
  });
});
