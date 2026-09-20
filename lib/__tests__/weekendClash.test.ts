import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import {
  teamOf, teamLevel, pickClash, countPredictions, predictionShare, agreementLabel,
  clashWhenLabel, clashReasonLabel, predictionWindow, PREDICTION_DAYS, clashPlayersFrom,
  type ClashGame, type ClashPlayer, type Team,
} from '../weekendClash';

const now = new Date(2026, 8, 20, 10, 0, 0); // dimanche 20 septembre 2026, 10 h

const j = (id: string, team: Team, elo: number | null = 1500): ClashPlayer => ({
  id, name: id, avatarPath: null, memberNumber: null, elo, team,
});

const partie = (gameId: string, matchDate: string, elos: [number, number, number, number], over: Partial<ClashGame> = {}): ClashGame => ({
  gameId, matchDate, location: 'Padel Art', city: 'Casablanca',
  players: [j('a1', 'A', elos[0]), j('a2', 'A', elos[1]), j('b1', 'B', elos[2]), j('b2', 'B', elos[3])],
  ...over,
});

describe('teamOf — lire le camp depuis team_side', () => {
  it('reconnaît les deux camps', () => {
    expect(teamOf('A_GAU')).toBe('A');
    expect(teamOf('B_DRO')).toBe('B');
    expect(teamOf('a_gau')).toBe('A');
  });
  it('ne devine pas un camp qui n\'existe pas', () => {
    expect(teamOf(null)).toBeNull();
    expect(teamOf('')).toBeNull();
    expect(teamOf('X')).toBeNull();
  });
});

describe('teamLevel — le niveau d\'une paire', () => {
  it('fait la moyenne des niveaux connus', () => {
    expect(teamLevel([j('a', 'A', 1400), j('b', 'A', 1650)])).toBeCloseTo(5.5, 5);
  });
  it('ignore un joueur sans ELO plutôt que de le compter zéro', () => {
    expect(teamLevel([j('a', 'A', 1400), j('b', 'A', null)])).toBeCloseTo(5, 5);
  });
  it('aucun ELO → pas de niveau', () => {
    expect(teamLevel([j('a', 'A', null)])).toBeNull();
  });
});

describe('pickClash — la partie la plus serrée', () => {
  it('choisit le plus petit écart de niveau', () => {
    const large = partie('large', '2026-09-20T18:00:00', [1400, 1400, 1900, 1900]);
    const serre = partie('serre', '2026-09-20T20:00:00', [1500, 1520, 1510, 1505]);
    expect(pickClash([large, serre], now)?.gameId).toBe('serre');
  });

  it('à écart égal, la partie la plus proche dans le temps', () => {
    const tard = partie('tard', '2026-09-20T22:00:00', [1500, 1500, 1500, 1500]);
    const tot = partie('tot', '2026-09-20T18:00:00', [1500, 1500, 1500, 1500]);
    expect(pickClash([tard, tot], now)?.gameId).toBe('tot');
  });

  it('ignore une partie déjà commencée', () => {
    const passee = partie('passee', '2026-09-20T09:00:00', [1500, 1500, 1500, 1500]);
    expect(pickClash([passee], now)).toBeNull();
  });

  it('ignore une partie incomplète', () => {
    const troisJoueurs = partie('trois', '2026-09-20T18:00:00', [1500, 1500, 1500, 1500]);
    troisJoueurs.players = troisJoueurs.players.slice(0, 3);
    expect(pickClash([troisJoueurs], now)).toBeNull();
  });

  it('ignore une partie déséquilibrée en nombre (3 contre 1)', () => {
    const bancale = partie('bancale', '2026-09-20T18:00:00', [1500, 1500, 1500, 1500]);
    bancale.players[2] = j('b1', 'A', 1500);
    expect(pickClash([bancale], now)).toBeNull();
  });

  it('ignore une partie dont on ne connaît aucun niveau d\'un camp', () => {
    const sansElo = partie('sansElo', '2026-09-20T18:00:00', [1500, 1500, 1500, 1500]);
    sansElo.players[2] = j('b1', 'B', null);
    sansElo.players[3] = j('b2', 'B', null);
    expect(pickClash([sansElo], now)).toBeNull();
  });

  it('sépare les deux camps et donne l\'écart', () => {
    const c = pickClash([partie('g', '2026-09-20T18:00:00', [1400, 1400, 1650, 1650])], now)!;
    expect(c.teamA.map(p => p.id)).toEqual(['a1', 'a2']);
    expect(c.teamB.map(p => p.id)).toEqual(['b1', 'b2']);
    expect(c.gap).toBe(1);
  });

  it('aucune partie → aucun choc, pas d\'invention', () => {
    expect(pickClash([], now)).toBeNull();
  });

  it('date illisible → ignorée', () => {
    expect(pickClash([partie('g', 'nawak', [1500, 1500, 1500, 1500])], now)).toBeNull();
  });
});

describe('pronostics — le décompte et les parts', () => {
  const rows = (a: number, b: number) => [
    ...Array.from({ length: a }, () => ({ team: 'A' as Team })),
    ...Array.from({ length: b }, () => ({ team: 'B' as Team })),
  ];

  it('compte chaque camp', () => {
    expect(countPredictions(rows(7, 5))).toEqual({ A: 7, B: 5, total: 12 });
  });

  it('les parts sont en pourcentage entier', () => {
    const c = countPredictions(rows(7, 5));
    expect(predictionShare(c, 'A')).toBe(58);
    expect(predictionShare(c, 'B')).toBe(42);
  });

  it('sans aucun avis, pas de division par zéro', () => {
    const c = countPredictions([]);
    expect(c.total).toBe(0);
    expect(predictionShare(c, 'A')).toBe(0);
    expect(agreementLabel(c, 'A')).toBeNull();
  });

  it('« comme toi » ne s\'affiche qu\'une fois qu\'on a voté', () => {
    const c = countPredictions(rows(7, 5));
    expect(agreementLabel(c, null)).toBeNull();
    expect(agreementLabel(c, 'A')).toBe('58 % comme toi');
  });
});

describe('predictionWindow — on ne se limite plus au week-end', () => {
  it('part de maintenant et couvre deux semaines', () => {
    const { start, end } = predictionWindow(now);
    expect(start.getTime()).toBe(now.getTime());
    expect(Math.round((end.getTime() - start.getTime()) / 86_400_000)).toBe(PREDICTION_DAYS);
    expect(PREDICTION_DAYS).toBeGreaterThan(7);
  });
  it('une partie de la semaine prochaine entre dans la fenêtre', () => {
    const { start, end } = predictionWindow(now);
    const dans10Jours = new Date(now.getTime() + 10 * 86_400_000).getTime();
    expect(dans10Jours).toBeGreaterThan(start.getTime());
    expect(dans10Jours).toBeLessThan(end.getTime());
  });
});

describe('libellés du choc', () => {
  it('donne le jour, l\'heure et le club', () => {
    expect(clashWhenLabel({ matchDate: '2026-09-20T18:00:00', location: 'Padel Art' })).toBe('Dim. 18h · Padel Art');
  });
  it('garde les minutes quand il y en a', () => {
    expect(clashWhenLabel({ matchDate: '2026-09-20T18:30:00', location: null })).toBe('Dim. 18h30');
  });
  it('au-delà d\'une semaine, la date complète est donnée', () => {
    const loin = new Date(now.getTime() + 9 * 86_400_000);
    const libelle = clashWhenLabel({ matchDate: loin.toISOString(), location: null }, now);
    expect(libelle).toMatch(/\d+ [a-zéû.]+ \d+h/);
  });
  it('date illisible → on retombe sur le club', () => {
    expect(clashWhenLabel({ matchDate: 'nawak', location: 'Padel Art' })).toBe('Padel Art');
  });
  it('le motif nomme la ville et l\'écart', () => {
    expect(clashReasonLabel({ gap: 0.08, city: 'Casablanca' }))
      .toBe("L'écart de niveau le plus serré de Casablanca en ce moment (0.08).");
  });
  it('sans ville, la phrase reste correcte', () => {
    expect(clashReasonLabel({ gap: 0.5, city: null })).toBe("L'écart de niveau le plus serré en ce moment (0.50).");
  });
});

describe('clashPlayersFrom — qui compte comme joueur de la partie', () => {
  const part = (id: string, status: string, side: string | null, over: Record<string, any> = {}) => ({
    player_id: id, status, team_side: side,
    player: { name: id, elo_score: 1500, avatar_path: null, member_number: null },
    ...over,
  });

  it('garde les joueurs acceptés', () => {
    expect(clashPlayersFrom([part('a', 'accepted', 'A_GAU')]).map(p => p.id)).toEqual(['a']);
  });

  it('garde un INVITÉ non expiré — le Lobby le compte déjà, la partie est « COMPLET »', () => {
    const demain = new Date(Date.now() + 86_400_000).toISOString();
    const out = clashPlayersFrom([part('a', 'invited', 'A_GAU', { invite_expires_at: demain })]);
    expect(out.map(p => p.id)).toEqual(['a']);
  });

  it('écarte une invitation expirée', () => {
    const hier = new Date(Date.now() - 86_400_000).toISOString();
    expect(clashPlayersFrom([part('a', 'invited', 'A_GAU', { invite_expires_at: hier })])).toEqual([]);
  });

  it('écarte une candidature et une liste d\'attente', () => {
    expect(clashPlayersFrom([part('a', 'pending', 'A_GAU'), part('b', 'waitlist', 'B_GAU')])).toEqual([]);
  });

  it('écarte un joueur sans camp — on ne saurait pas de quel côté le mettre', () => {
    expect(clashPlayersFrom([part('a', 'accepted', null)])).toEqual([]);
  });

  it('une partie pleine avec deux invités reste pronostiquable', () => {
    const demain = new Date(Date.now() + 86_400_000).toISOString();
    const out = clashPlayersFrom([
      part('a1', 'accepted', 'A_GAU'),
      part('a2', 'invited', 'A_DRO', { invite_expires_at: demain }),
      part('b1', 'accepted', 'B_GAU'),
      part('b2', 'invited', 'B_DRO', { invite_expires_at: demain }),
    ]);
    expect(out).toHaveLength(4);
    expect(out.filter(p => p.team === 'A')).toHaveLength(2);
    expect(out.filter(p => p.team === 'B')).toHaveLength(2);
  });
});
