import { describe, it, expect } from 'vitest';
import { replayEvents, isMatchDecided, buildScoreText, gameScoreLabels, eventsFromState, progressKey, type LiveEvent } from '../liveScore';

let seq = 0;
const g = (team: 1 | 2): LiveEvent => ({ seq: ++seq, event_type: 'game_won', payload: { team } });
const p = (team: 1 | 2): LiveEvent => ({ seq: ++seq, event_type: 'point_won', payload: { team } });
const undo = (): LiveEvent => ({ seq: ++seq, event_type: 'undo', payload: {} });
const games = (n: number, team: 1 | 2) => Array.from({ length: n }, () => g(team));
const points = (n: number, team: 1 | 2) => Array.from({ length: n }, () => p(team));
const reset = () => { seq = 0; };
const PTS = { mode: 'points' as const, goldenPoint: true };
const ADV = { mode: 'points' as const, goldenPoint: false };

describe('replayEvents — sets', () => {
  it('journal vide → 0-0, un set courant', () => {
    reset();
    const s = replayEvents([]);
    expect(s.sets).toEqual([{ t1: 0, t2: 0 }]);
    expect(s.setsWon).toEqual({ t1: 0, t2: 0 });
  });
  it('set gagné 6-0 → nouveau set ouvert', () => {
    reset();
    const s = replayEvents(games(6, 1));
    expect(s.sets).toEqual([{ t1: 6, t2: 0 }, { t1: 0, t2: 0 }]);
    expect(s.setsWon).toEqual({ t1: 1, t2: 0 });
  });
  it('6-5 ne clôt pas le set', () => {
    reset();
    const s = replayEvents([...games(5, 1), ...games(5, 2), g(1)]);
    expect(s.sets).toEqual([{ t1: 6, t2: 5 }]);
    expect(s.setsWon).toEqual({ t1: 0, t2: 0 });
  });
  it('7-5 clôt le set', () => {
    reset();
    const s = replayEvents([...games(5, 1), ...games(5, 2), g(1), g(1)]);
    expect(s.setsWon).toEqual({ t1: 1, t2: 0 });
  });
  it('6-6 puis jeu décisif → 7-6', () => {
    reset();
    const evts = [...games(5, 1), ...games(5, 2), g(1), g(2), g(1)]; // 6-6 puis t1
    const s = replayEvents(evts);
    expect(s.sets[0]).toEqual({ t1: 7, t2: 6 });
    expect(s.setsWon).toEqual({ t1: 1, t2: 0 });
  });
});

describe('replayEvents — undo', () => {
  it('undo simple annule le dernier jeu', () => {
    reset();
    const s = replayEvents([g(1), g(1), undo()]);
    expect(s.sets).toEqual([{ t1: 1, t2: 0 }]);
  });
  it('undo rouvre un set clos', () => {
    reset();
    const s = replayEvents([...games(6, 1), undo()]);
    expect(s.sets).toEqual([{ t1: 5, t2: 0 }]);
    expect(s.setsWon).toEqual({ t1: 0, t2: 0 });
  });
  it('undos en cascade sautent les jeux déjà annulés', () => {
    reset();
    const s = replayEvents([g(1), g(2), undo(), undo()]); // annule g(2) puis g(1)
    expect(s.sets).toEqual([{ t1: 0, t2: 0 }]);
  });
  it('undo sur journal vide = no-op', () => {
    reset();
    expect(replayEvents([undo()]).sets).toEqual([{ t1: 0, t2: 0 }]);
  });
});

describe('isMatchDecided', () => {
  it('2-0 → équipe 1', () => {
    reset();
    const s = replayEvents([...games(6, 1), ...games(6, 1)]);
    expect(isMatchDecided(s)).toBe(1);
  });
  it('1-1 → null', () => {
    reset();
    const s = replayEvents([...games(6, 1), ...games(6, 2)]);
    expect(isMatchDecided(s)).toBeNull();
  });
  it('2-1 (set fun perdu) → équipe 1', () => {
    reset();
    const s = replayEvents([...games(6, 1), ...games(6, 1), ...games(6, 2)]);
    expect(isMatchDecided(s)).toBe(1);
  });
  it('2-2 → null (pas de vainqueur net)', () => {
    reset();
    const s = replayEvents([...games(6, 1), ...games(6, 1), ...games(6, 2), ...games(6, 2)]);
    expect(isMatchDecided(s)).toBeNull();
  });
});

describe('buildScoreText', () => {
  it('sets terminés + set courant non vide', () => {
    reset();
    const s = replayEvents([...games(6, 1), ...games(4, 2), g(1)]);
    expect(buildScoreText(s)).toBe('6-0, 1-4');
  });
  it('ignore le set courant vide', () => {
    reset();
    const s = replayEvents([...games(6, 1), ...games(6, 1)]);
    expect(buildScoreText(s)).toBe('6-0, 6-0');
  });
});

describe('contestations', () => {
  it('contest ouvre, contest_resolved ferme', () => {
    reset();
    const evts: LiveEvent[] = [g(1),
      { seq: ++seq, event_type: 'contest', payload: { target_seq: 1 } },
      { seq: ++seq, event_type: 'contest_resolved', payload: { target_seq: 1 } }];
    expect(replayEvents(evts).openContests).toBe(0);
    expect(replayEvents(evts.slice(0, 2)).openContests).toBe(1);
  });
});

describe('mode points — jeux', () => {
  it('mode games : currentGame est null', () => {
    reset();
    expect(replayEvents(games(2, 1)).currentGame).toBeNull();
  });
  it('4 points de suite = jeu gagné, jeu courant remis à 0-0', () => {
    reset();
    const s = replayEvents(points(4, 1), PTS);
    expect(s.sets).toEqual([{ t1: 1, t2: 0 }]);
    expect(s.currentGame).toEqual({ t1: 0, t2: 0 });
  });
  it('40-30 (3-2) : jeu pas fini', () => {
    reset();
    const s = replayEvents([...points(3, 1), ...points(2, 2)], PTS);
    expect(s.sets).toEqual([{ t1: 0, t2: 0 }]);
    expect(s.currentGame).toEqual({ t1: 3, t2: 2 });
  });
  it('point en or : à 40-40 (3-3) le point suivant gagne', () => {
    reset();
    const s = replayEvents([...points(3, 1), ...points(3, 2), p(2)], PTS);
    expect(s.sets).toEqual([{ t1: 0, t2: 1 }]);
    expect(s.currentGame).toEqual({ t1: 0, t2: 0 });
  });
  it('avantage : 4-3 = AV, pas jeu ; 5-3 = jeu', () => {
    reset();
    const base = [...points(3, 1), ...points(3, 2)];
    const av = replayEvents([...base, p(1)], ADV);
    expect(av.sets).toEqual([{ t1: 0, t2: 0 }]);
    expect(av.currentGame).toEqual({ t1: 4, t2: 3 });
    reset();
    const won = replayEvents([...base, p(1), p(1)], ADV);
    expect(won.sets).toEqual([{ t1: 1, t2: 0 }]);
  });
  it('avantage : deuce qui tourne (4-4 puis 5-4 puis 5-5)', () => {
    reset();
    const s = replayEvents([...points(3, 1), ...points(3, 2), p(1), p(2), p(1), p(2)], ADV);
    expect(s.sets).toEqual([{ t1: 0, t2: 0 }]);
    expect(s.currentGame).toEqual({ t1: 5, t2: 5 });
  });
  it('6 jeux gagnés aux points → set fermé', () => {
    reset();
    const evts: LiveEvent[] = [];
    for (let i = 0; i < 6; i++) evts.push(...points(4, 1));
    const s = replayEvents(evts, PTS);
    expect(s.sets).toEqual([{ t1: 6, t2: 0 }, { t1: 0, t2: 0 }]);
    expect(s.setsWon).toEqual({ t1: 1, t2: 0 });
  });
  it('undo à cheval : annuler le point qui a fini le jeu restaure 40-x', () => {
    reset();
    const s = replayEvents([...points(4, 1), undo()], PTS);
    expect(s.sets).toEqual([{ t1: 0, t2: 0 }]);
    expect(s.currentGame).toEqual({ t1: 3, t2: 0 });
  });
  it('game_won accepté en mode points (semis synthétique) : jeu entier direct', () => {
    reset();
    const s = replayEvents([g(1), ...points(2, 2)], PTS);
    expect(s.sets).toEqual([{ t1: 1, t2: 0 }]);
    expect(s.currentGame).toEqual({ t1: 0, t2: 2 });
  });
});

describe('mode points — tie-break', () => {
  const sixSix = (): LiveEvent[] => {
    const evts: LiveEvent[] = [];
    for (let i = 0; i < 5; i++) evts.push(g(1));
    for (let i = 0; i < 5; i++) evts.push(g(2));
    evts.push(g(1), g(2)); // 6-6
    return evts;
  };
  // Points intercalés (p1,p2 alternés) pour ne jamais fermer le TB en chemin.
  const alt = (n: number): LiveEvent[] => {
    const evts: LiveEvent[] = [];
    for (let i = 0; i < n; i++) evts.push(p(1), p(2));
    return evts;
  };
  it('à 6-6 le jeu courant est un tie-break, compté numérique jusqu à 7 avec 2 d écart', () => {
    reset();
    const s = replayEvents([...sixSix(), ...alt(6)], PTS);
    expect(s.tieBreak).toBe(true);
    expect(s.currentGame).toEqual({ t1: 6, t2: 6 });
    reset();
    const notYet = replayEvents([...sixSix(), ...alt(6), p(1)], PTS); // TB 7-6
    expect(notYet.sets[0]).toEqual({ t1: 6, t2: 6 }); // pas 2 d écart → set ouvert
    expect(notYet.currentGame).toEqual({ t1: 7, t2: 6 });
    reset();
    const done = replayEvents([...sixSix(), ...alt(5), p(1), p(1)], PTS); // TB 7-5
    expect(done.sets).toEqual([{ t1: 7, t2: 6 }, { t1: 0, t2: 0 }]);
    expect(done.setsWon).toEqual({ t1: 1, t2: 0 });
  });
  it('hors tie-break, tieBreak est false', () => {
    reset();
    expect(replayEvents(points(2, 1), PTS).tieBreak).toBe(false);
  });
});

describe('gameScoreLabels', () => {
  it('0/15/30/40', () => {
    expect(gameScoreLabels({ t1: 0, t2: 0 }, true, false)).toEqual({ t1: '0', t2: '0' });
    expect(gameScoreLabels({ t1: 1, t2: 3 }, true, false)).toEqual({ t1: '15', t2: '40' });
    expect(gameScoreLabels({ t1: 2, t2: 0 }, true, false)).toEqual({ t1: '30', t2: '0' });
  });
  it('avantage : AV-40 et deuce 40-40', () => {
    expect(gameScoreLabels({ t1: 4, t2: 3 }, false, false)).toEqual({ t1: 'AV', t2: '40' });
    expect(gameScoreLabels({ t1: 4, t2: 4 }, false, false)).toEqual({ t1: '40', t2: '40' });
    expect(gameScoreLabels({ t1: 5, t2: 6 }, false, false)).toEqual({ t1: '40', t2: 'AV' });
  });
  it('point en or : 3-3 reste 40-40', () => {
    expect(gameScoreLabels({ t1: 3, t2: 3 }, true, false)).toEqual({ t1: '40', t2: '40' });
  });
  it('tie-break : numérique', () => {
    expect(gameScoreLabels({ t1: 5, t2: 6 }, true, true)).toEqual({ t1: '5', t2: '6' });
  });
});

describe('eventsFromState — round-trip (invariant : aucune fermeture prématurée)', () => {
  // Propriété : rejouer le journal synthétique d'un état atteignable redonne
  // exactement le même score (sets, setsWon, currentGame, tieBreak).
  const scoreOf = (s: ReturnType<typeof replayEvents>) =>
    ({ sets: s.sets, setsWon: s.setsWon, currentGame: s.currentGame, tieBreak: s.tieBreak });
  const roundTrip = (evts: LiveEvent[], opts?: Parameters<typeof replayEvents>[1]) => {
    const s1 = replayEvents(evts, opts);
    const s2 = replayEvents(eventsFromState(s1), opts);
    expect(scoreOf(s2)).toEqual(scoreOf(s1));
  };

  it('cas ciblés : 40-40 point en or, AV en avantage, tie-break, set fun', () => {
    reset(); roundTrip([...points(3, 1), ...points(3, 2)], PTS);                    // 3-3 golden
    reset(); roundTrip([...points(3, 1), ...points(3, 2), p(1), p(2), p(1)], ADV);  // 5-4 AV
    reset(); roundTrip([...games(6, 1), ...games(6, 1), ...games(6, 2)]);           // 2-1 sets (games)
    reset();
    const tb: LiveEvent[] = [];                                                     // 6-6 puis TB 7-6
    for (let i = 0; i < 5; i++) tb.push(g(1), g(2));
    tb.push(g(1), g(2));
    for (let i = 0; i < 6; i++) tb.push(p(1), p(2));
    tb.push(p(1));
    roundTrip(tb, PTS);
  });

  it('propriété : 300 journaux pseudo-aléatoires (déterministes), 4 configs', () => {
    // LCG déterministe — pas de Math.random pour des tests reproductibles.
    let rng = 42;
    const next = () => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648; };
    const configs = [undefined, PTS, ADV, { mode: 'games' as const, goldenPoint: false }];
    for (const opts of configs) {
      for (let run = 0; run < 75; run++) {
        reset();
        const evts: LiveEvent[] = [];
        const len = 5 + Math.floor(next() * 120);
        for (let i = 0; i < len; i++) {
          const r = next();
          if (r < 0.42) evts.push(opts?.mode === 'points' ? p(next() < 0.5 ? 1 : 2) : g(next() < 0.5 ? 1 : 2));
          else if (r < 0.55) evts.push(g(next() < 0.5 ? 1 : 2));
          else if (r < 0.7) evts.push(undo());
          else evts.push(opts?.mode === 'points' ? p(next() < 0.5 ? 1 : 2) : g(next() < 0.5 ? 1 : 2));
        }
        roundTrip(evts, opts);
      }
    }
  });

  it('progressKey : distingue deux états à jeux égaux mais points différents', () => {
    reset(); const a = replayEvents([g(1), ...points(2, 1)], PTS);
    reset(); const b = replayEvents([g(1), ...points(3, 1)], PTS);
    reset(); const c = replayEvents([g(1)], PTS);
    expect(progressKey(b)).toBeGreaterThan(progressKey(a));
    expect(progressKey(a)).toBeGreaterThan(progressKey(c));
    expect(progressKey(replayEvents([]))).toBe(0);
  });
});
