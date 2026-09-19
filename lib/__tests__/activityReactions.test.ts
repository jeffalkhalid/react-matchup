import { describe, it, expect } from 'vitest';
import { reactionFor } from '../activityReactions';

describe('reactionFor — le bouton de réaction dépend du type d\'événement', () => {
  it('une défaite propose « Revanche ? », une action (pas une réaction)', () => {
    const r = reactionFor('match_loss');
    expect(r).toEqual({ label: 'Revanche ?', activeLabel: 'Défi envoyé', icon: 'swords', kind: 'action' });
  });

  it('une promotion propose « Machine ! », une réaction', () => {
    const r = reactionFor('promotion');
    expect(r.label).toBe('Machine !');
    expect(r.icon).toBe('zap');
    expect(r.kind).toBe('reaction');
  });

  it('une victoire propose « Féliciter », une réaction', () => {
    const r = reactionFor('match_win');
    expect(r.label).toBe('Féliciter');
    expect(r.icon).toBe('flame');
    expect(r.kind).toBe('reaction');
  });

  it('un badge propose aussi « Féliciter »', () => {
    expect(reactionFor('badge').label).toBe('Féliciter');
  });

  it('un type non prévu (ex. bilan) retombe sur « Féliciter » plutôt que de planter', () => {
    expect(reactionFor('bilan' as any).label).toBe('Féliciter');
  });
});
