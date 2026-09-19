import { describe, it, expect } from 'vitest';
import { maxWinStreak, defisWon, favoriteClub, bestWinLevel, type StatMatch } from '../bilanStats';

const me = 'me';
const m = (o: Partial<StatMatch>): StatMatch => ({
  winner_id: me, winner_id_2: 'p', loser_id: 'x', loser_id_2: 'y',
  stake_multiplier: 1, location: 'Padel Hub', loserLevels: [4, 4], ...o,
});
const perdu = (o: Partial<StatMatch> = {}) => m({ winner_id: 'x', winner_id_2: 'y', loser_id: me, loser_id_2: 'p', ...o });

describe('bilanStats — les chiffres de la carte « Recap du mois »', () => {
  it('série max = plus longue suite de victoires, dans l’ordre des matchs', () => {
    expect(maxWinStreak([m({}), m({}), perdu(), m({}), m({}), m({}), perdu()], me)).toBe(3);
    expect(maxWinStreak([perdu(), perdu()], me)).toBe(0);
    expect(maxWinStreak([], me)).toBe(0);
  });
  it('défis gagnés = victoires avec une mise (×2, ×3…)', () => {
    expect(defisWon([m({ stake_multiplier: 3 }), m({ stake_multiplier: 1 }), perdu({ stake_multiplier: 2 }), m({ stake_multiplier: 2 })], me)).toBe(2);
  });
  it('club favori = lieu le plus joué, avec son nombre de matchs', () => {
    expect(favoriteClub([m({ location: 'A' }), perdu({ location: 'B' }), m({ location: 'B' })])).toEqual({ name: 'B', count: 2 });
    expect(favoriteClub([m({ location: null })])).toBe(null);
    expect(favoriteClub([m({ location: 'Club supprimé' })])).toBe(null);
  });
  it('meilleure perf = la victoire contre la paire adverse au niveau moyen le plus haut', () => {
    expect(bestWinLevel([m({ loserLevels: [5, 5.2] }), m({ loserLevels: [6, 5.84] }), perdu({ loserLevels: [7, 7] })], me)).toBe(5.92);
    expect(bestWinLevel([perdu()], me)).toBe(null);
  });
});
