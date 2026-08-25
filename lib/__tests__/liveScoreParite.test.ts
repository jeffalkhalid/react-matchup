// Ancre de parité TS ↔ SQL sur un journal RÉEL, remonté par le user le
// 2026-08-25 (session 3329ad1d, mode points, point en or).
//
// Le serveur (fn_live_replay) calcule sur ce même journal :
//   sets    = [1-6, 6-4, 6-1, 5-0]
//   setsWon = { t1: 2, t2: 1 }
// Si ce test échoue, replayEvents et fn_live_replay ont divergé — c'est la
// fragilité documentée en tête de lib/liveScore.ts, et le diff dit à quel
// endroit elles se séparent.
import { describe, it, expect } from 'vitest';
import { replayEvents, type LiveEvent } from '../liveScore';

// 1 = point équipe 1, 2 = point équipe 2, U = annulation.
const JOURNAL =
  '112212211222211122221111222121211222121222112211111211111121211122222212222122222111112222111111111222221111112111111112221111111UUU111UUU111111111111111111111111111111UUUUUUUUU1211221';

function eventsFromJournal(j: string): LiveEvent[] {
  return j.split('').map((c, i) => ({
    seq: i + 1,
    event_type: c === 'U' ? 'undo' : 'point_won',
    payload: c === 'U' ? {} : { team: c === '1' ? 1 : 2 },
  })) as LiveEvent[];
}

describe('parité avec fn_live_replay — session réelle 3329ad1d', () => {
  it('reproduit exactement les sets calculés par le serveur', () => {
    const st = replayEvents(eventsFromJournal(JOURNAL), { mode: 'points', goldenPoint: true });
    expect(st.sets).toEqual([
      { t1: 1, t2: 6 },
      { t1: 6, t2: 4 },
      { t1: 6, t2: 1 },
      { t1: 5, t2: 0 },
    ]);
    expect(st.setsWon).toEqual({ t1: 2, t2: 1 });
  });
});
