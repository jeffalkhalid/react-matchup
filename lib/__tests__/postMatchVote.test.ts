import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import { featuredReceiver } from '../postMatchVote';

const p = (id: string, name = id) => ({ id, name, elo_score: 1000 } as any);

describe('featuredReceiver — le joueur mis en avant par « Ton match d\'hier »', () => {
  it('si j\'ai perdu, met en avant le vainqueur (« Omar t\'a battu »)', () => {
    const match = { winner: p('omar'), winner_2: undefined, loser: p('me'), loser_2: undefined };
    expect(featuredReceiver(match as any, 'me')?.id).toBe('omar');
  });

  it('en double, si je suis vainqueur, met en avant mon binôme avant l\'adversaire', () => {
    const match = { winner: p('me'), winner_2: p('binome'), loser: p('adv1'), loser_2: p('adv2') };
    expect(featuredReceiver(match as any, 'me')?.id).toBe('binome');
  });

  it('en simple (pas de binôme/second adversaire), retombe sur l\'adversaire', () => {
    const match = { winner: p('me'), winner_2: null, loser: p('adv'), loser_2: null };
    expect(featuredReceiver(match as any, 'me')?.id).toBe('adv');
  });

  it('rend null si aucun autre joueur n\'est identifiable', () => {
    const match = { winner: p('me'), winner_2: null, loser: null, loser_2: null };
    expect(featuredReceiver(match as any, 'me')).toBe(null);
  });
});
