import { describe, it, expect } from 'vitest';
import { reactionFor, rematchRoute } from '../activityReactions';

describe("reactionFor — le bouton dépend du type d'événement ET de qui je suis", () => {
  it('MA défaite propose « Revanche ? », une action (pas une réaction)', () => {
    const r = reactionFor('match_loss', true);
    expect(r).toEqual({ label: 'Revanche ?', activeLabel: 'Revanche ?', icon: 'swords', kind: 'action' });
  });

  it("la défaite d'un AUTRE ne propose PAS de revanche", () => {
    // Le bug : « Revanche ? » s'affichait sur la défaite d'Alamine contre
    // Galan et Chingoto, une partie où je ne jouais pas.
    const r = reactionFor('match_loss', false);
    expect(r.label).toBe('Respect');
    expect(r.kind).toBe('reaction');
  });

  it("la défaite d'un autre ne propose pas non plus « Féliciter »", () => {
    expect(reactionFor('match_loss', false).label).not.toBe('Féliciter');
  });

  it('sans précision, une défaite est celle de quelqu un d autre', () => {
    // Le cas par défaut doit être le PRUDENT : ne pas proposer de venger
    // un match dont on ne sait rien.
    expect(reactionFor('match_loss').kind).toBe('reaction');
  });

  it('« Revanche ? » ne se verrouille pas : son libellé ne change pas', () => {
    // Il affichait « Défi envoyé » après un tap, alors que rien ne part.
    const r = reactionFor('match_loss', true);
    expect(r.activeLabel).toBe(r.label);
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

  it('ma propre victoire reste « Féliciter » — seule la défaite se dédouble', () => {
    expect(reactionFor('match_win', true).label).toBe('Féliciter');
  });

  it('un type non prévu (ex. bilan) retombe sur « Féliciter » plutôt que de planter', () => {
    expect(reactionFor('bilan' as any).label).toBe('Féliciter');
  });
});

describe('rematchRoute — où mène « Revanche ? »', () => {
  it("mène à l'assistant de création, jamais à l'onglet Défi", () => {
    const route = rematchRoute('m-42');
    expect(route).toContain('/(tabs)/lobby');
    expect(route).not.toContain('matchmaking');
  });

  it('emporte le match pour le rejouer à l identique', () => {
    expect(rematchRoute('m-42')).toBe('/(tabs)/lobby?rematch=m-42');
  });

  it('sans match connu, ouvre quand même l assistant plutôt que rien', () => {
    expect(rematchRoute(null)).toBe('/(tabs)/lobby?create=1');
    expect(rematchRoute(undefined)).toBe('/(tabs)/lobby?create=1');
  });
});
