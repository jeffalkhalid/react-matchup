import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
vi.mock('../community', () => ({ getFollowingIds: async () => [] }));
import { keepLatestPerPlayer, type CircleBilan } from '../bilanCircle';

const b = (playerId: string, createdAt: string, label: string): CircleBilan => ({
  eventId: `${playerId}-${label}`, playerId, name: playerId, avatarPath: null, memberNumber: null,
  label, createdAt, recap: {} as any,
});

describe('keepLatestPerPlayer — un bilan par joueur dans le bloc du cercle', () => {
  it('garde le plus récent de chaque joueur, dans l\'ordre reçu', () => {
    const out = keepLatestPerPlayer([
      b('rita', '2026-09-02', 'AOÛT'), b('rita', '2026-08-02', 'JUILLET'), b('galan', '2026-09-01', 'AOÛT'),
    ]);
    expect(out.map(x => x.eventId)).toEqual(['rita-AOÛT', 'galan-AOÛT']);
  });
  it('liste vide → rien', () => {
    expect(keepLatestPerPlayer([])).toEqual([]);
  });
});
