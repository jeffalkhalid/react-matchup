import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import {
  opponentsOf, headToHeadFrom, pickRival, closestOpponent,
  relativeDayLabel, duelSinceLabel, duelSentence,
  RIVAL_MIN_DUELS, HISTORY_LENGTH, type DuelMatch,
} from '../headToHead';

const MOI = 'moi';

/** Un match validé : `gagne` dit si je l'ai gagné, `adv` qui était en face. */
const m = (id: string, createdAt: string, gagne: boolean, adv: string[], scoreText = '6/4 6/2'): DuelMatch => ({
  id, createdAt, scoreText,
  winnerId: gagne ? MOI : adv[0],
  winnerId2: gagne ? 'monBinome' : adv[1] ?? null,
  loserId: gagne ? adv[0] : MOI,
  loserId2: gagne ? adv[1] ?? null : 'monBinome',
});

describe('opponentsOf — qui était en face', () => {
  it('rend les deux joueurs du camp adverse', () => {
    expect(opponentsOf(m('1', '2026-09-01', true, ['omar', 'salma']), MOI)).toEqual(['omar', 'salma']);
  });
  it('marche aussi quand j\'ai perdu', () => {
    expect(opponentsOf(m('1', '2026-09-01', false, ['omar', 'salma']), MOI)).toEqual(['omar', 'salma']);
  });
  it('un match où je ne suis pas ne rend personne', () => {
    expect(opponentsOf(m('1', '2026-09-01', true, ['omar', 'salma']), 'inconnu')).toEqual([]);
  });
});

describe('headToHeadFrom — le bilan face à chacun', () => {
  const matchs = [
    m('5', '2026-09-18', false, ['omar', 'salma']),
    m('4', '2026-09-10', true, ['omar', 'kenza']),
    m('3', '2026-08-20', false, ['omar', 'salma']),
    m('2', '2026-07-05', true, ['omar', 'hicham']),
    m('1', '2026-03-02', false, ['omar', 'salma']),
  ];

  it('compte mes victoires et mes défaites face à un adversaire', () => {
    const h = headToHeadFrom(matchs, MOI).get('omar')!;
    expect(h.total).toBe(5);
    expect(h.wins).toBe(2);
    expect(h.losses).toBe(3);
  });

  it('l\'historique se lit du plus ancien au plus récent', () => {
    const h = headToHeadFrom(matchs, MOI).get('omar')!;
    expect(h.history).toEqual([false, true, false, true, false]);
  });

  it('l\'historique est plafonné aux derniers duels', () => {
    const beaucoup = Array.from({ length: 9 }, (_, i) =>
      m(`x${i}`, `2026-0${(i % 9) + 1}-01`, i % 2 === 0, ['omar', 'salma']));
    expect(headToHeadFrom(beaucoup, MOI).get('omar')!.history).toHaveLength(HISTORY_LENGTH);
  });

  it('retient le dernier duel : score, date, issue', () => {
    const h = headToHeadFrom(matchs, MOI).get('omar')!;
    expect(h.lastAt).toBe('2026-09-18');
    expect(h.lastWon).toBe(false);
    expect(h.lastScore).toBe('6/4 6/2');
  });

  it('retient le premier duel, pour l\'ancienneté', () => {
    expect(headToHeadFrom(matchs, MOI).get('omar')!.firstAt).toBe('2026-03-02');
  });

  it('ne dépend pas de l\'ordre dans lequel les matchs arrivent', () => {
    const melange = [matchs[2], matchs[0], matchs[4], matchs[1], matchs[3]];
    const a = headToHeadFrom(matchs, MOI).get('omar')!;
    const b = headToHeadFrom(melange, MOI).get('omar')!;
    expect(b.history).toEqual(a.history);
    expect(b.lastAt).toBe(a.lastAt);
    expect(b.firstAt).toBe(a.firstAt);
  });

  it('compte chaque adversaire séparément', () => {
    const map = headToHeadFrom(matchs, MOI);
    expect(map.get('salma')!.total).toBe(3);
    expect(map.get('kenza')!.total).toBe(1);
  });
});

describe('pickRival — on n\'invente pas un rival', () => {
  it('rien en dessous de trois duels', () => {
    const peu = [
      m('1', '2026-09-01', true, ['omar', 'salma']),
      m('2', '2026-09-02', false, ['omar', 'salma']),
    ];
    expect(pickRival(peu, MOI)).toBeNull();
    expect(RIVAL_MIN_DUELS).toBe(3);
  });

  it('au seuil, le face-à-face s\'ouvre', () => {
    const pile = [1, 2, 3].map(i => m(String(i), `2026-09-0${i}`, i === 1, ['omar', 'salma']));
    expect(pickRival(pile, MOI)?.opponentId).toBe('omar');
  });

  it('choisit celui qu\'on a le plus affronté', () => {
    const matchs = [
      ...[1, 2, 3, 4].map(i => m(`o${i}`, `2026-09-0${i}`, true, ['omar', 'x'])),
      ...[1, 2, 3].map(i => m(`k${i}`, `2026-08-0${i}`, true, ['kenza', 'y'])),
    ];
    expect(pickRival(matchs, MOI)?.opponentId).toBe('omar');
  });

  it('à égalité de duels, le plus récent l\'emporte', () => {
    const matchs = [
      ...[1, 2, 3].map(i => m(`o${i}`, `2026-07-0${i}`, true, ['omar', 'x'])),
      ...[1, 2, 3].map(i => m(`k${i}`, `2026-09-0${i}`, true, ['kenza', 'y'])),
    ];
    expect(pickRival(matchs, MOI)?.opponentId).toBe('kenza');
  });

  it('sans aucun match, rien', () => {
    expect(pickRival([], MOI)).toBeNull();
  });
});

describe('closestOpponent — pour l\'état calme', () => {
  it('rend l\'adversaire le plus fréquent même sous le seuil', () => {
    const peu = [m('1', '2026-09-01', true, ['omar', 'salma'])];
    expect(closestOpponent(peu, MOI)?.opponentId).toBe('omar');
  });
  it('sans match, rien à proposer', () => {
    expect(closestOpponent([], MOI)).toBeNull();
  });
});

describe('relativeDayLabel', () => {
  const now = new Date(2026, 8, 20, 12, 0, 0); // dimanche 20 sept. 2026
  it('hier', () => {
    expect(relativeDayLabel('2026-09-19T20:00:00', now)).toBe('hier');
  });
  it('dans la semaine, nomme le jour', () => {
    expect(relativeDayLabel('2026-09-17T20:00:00', now)).toBe('jeudi dernier');
  });
  it('au-delà, donne la date', () => {
    expect(relativeDayLabel('2026-09-02T20:00:00', now)).toBe('le 2 sept.');
  });
  it('aujourd\'hui', () => {
    expect(relativeDayLabel('2026-09-20T09:00:00', now)).toBe("aujourd'hui");
  });
  it('date illisible → rien plutôt qu\'une date fausse', () => {
    expect(relativeDayLabel('nawak', now)).toBe('');
  });
});

describe('duelSinceLabel', () => {
  it('donne le mois du premier duel', () => {
    const h = headToHeadFrom([1, 2, 3].map(i => m(String(i), `2026-03-0${i}`, true, ['omar', 'x'])), MOI).get('omar')!;
    expect(duelSinceLabel(h)).toBe('3 matchs depuis mars');
  });
});

describe('duelSentence — la phrase de contexte', () => {
  const now = new Date(2026, 8, 20, 12, 0, 0);
  const bilan = (gagnes: number, perdus: number) => headToHeadFrom([
    ...Array.from({ length: gagnes }, (_, i) => m(`g${i}`, `2026-09-0${i + 1}`, true, ['omar', 'x'])),
    ...Array.from({ length: perdus }, (_, i) => m(`p${i}`, `2026-08-0${i + 1}`, false, ['omar', 'x'])),
  ], MOI).get('omar')!;

  it('quand je mène', () => {
    expect(duelSentence(bilan(3, 1), 'Omar', now)).toMatch(/^Tu mènes 3–1\./);
  });
  it('quand il mène, il est nommé', () => {
    expect(duelSentence(bilan(1, 3), 'Omar', now)).toMatch(/^Omar mène 3–1\./);
  });
  it('à égalité', () => {
    expect(duelSentence(bilan(2, 2), 'Omar', now)).toMatch(/^Vous êtes à égalité, 2 partout\./);
  });
  it('rappelle le score du dernier duel', () => {
    expect(duelSentence(bilan(3, 1), 'Omar', now)).toContain('Ton dernier duel : 6/4 6/2');
  });
  it('sans score enregistré, pas de « : » vide', () => {
    const h = headToHeadFrom([1, 2, 3].map(i => m(String(i), `2026-09-0${i}`, true, ['omar', 'x'], null as any)), MOI).get('omar')!;
    expect(duelSentence(h, 'Omar', now)).not.toContain('Ton dernier duel :');
  });
});
