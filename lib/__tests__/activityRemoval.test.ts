import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import { activityRemovalFor, removalPrompt } from '../activityFeed';

const MOI = 'moi';
const e = (type: string, over: Record<string, any> = {}) =>
  ({ type, player_id: MOI, is_highlight: false, ...over });

describe('activityRemovalFor — ce que je peux retirer de mon fil', () => {
  it('mon bilan s\'efface', () => {
    expect(activityRemovalFor(e('bilan'), MOI)).toBe('delete');
  });

  it('un moment que j\'ai partagé se retire de la mise en avant', () => {
    expect(activityRemovalFor(e('match_win', { is_highlight: true }), MOI)).toBe('unshare');
    expect(activityRemovalFor(e('match_loss', { is_highlight: true }), MOI)).toBe('unshare');
  });

  it('une victoire ou une défaite NON partagée ne se retire pas', () => {
    expect(activityRemovalFor(e('match_win'), MOI)).toBeNull();
    expect(activityRemovalFor(e('match_loss'), MOI)).toBeNull();
  });

  it('un badge et une montée de ligue non plus', () => {
    expect(activityRemovalFor(e('badge'), MOI)).toBeNull();
    expect(activityRemovalFor(e('promotion'), MOI)).toBeNull();
  });

  it('rien sur la publication de quelqu\'un d\'autre, même un bilan', () => {
    expect(activityRemovalFor(e('bilan', { player_id: 'autre' }), MOI)).toBeNull();
    expect(activityRemovalFor(e('match_win', { player_id: 'autre', is_highlight: true }), MOI)).toBeNull();
  });

  it('sans joueur connecté, rien', () => {
    expect(activityRemovalFor(e('bilan'), null)).toBeNull();
    expect(activityRemovalFor(e('bilan'), undefined)).toBeNull();
  });
});

describe('removalPrompt — la confirmation dit ce qui se passe vraiment', () => {
  it('le bilan disparaît', () => {
    expect(removalPrompt('delete').action).toBe('Supprimer');
    expect(removalPrompt('delete').message).toMatch(/republier/);
  });

  it('le moment ne supprime PAS le match — c\'est le point à ne pas rater', () => {
    const p = removalPrompt('unshare');
    expect(p.action).toBe('Retirer');
    expect(p.message).toMatch(/le match, lui, reste/i);
  });
});
