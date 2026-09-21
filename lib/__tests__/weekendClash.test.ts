import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import {
  teamOf, teamLevel, pickClash, countPredictions, predictionShare,
  clashWhenLabel, predictionWindow, PREDICTION_DAYS, clashPlayersFrom,
  clashesToPredict, tightestClashId, withoutMyGames,
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
    expect(predictionShare(c, 'B')).toBe(0);
  });

  it('les deux parts couvrent l\'ensemble des avis', () => {
    const c = countPredictions(rows(7, 5));
    expect(predictionShare(c, 'A') + predictionShare(c, 'B')).toBe(100);
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

describe('clashPlayersFrom — le créateur compte aussi', () => {
  const part = (id: string, status: string, side: string | null, over: Record<string, any> = {}) => ({
    player_id: id, status, team_side: side,
    player: { name: id, elo_score: 1500, avatar_path: null, member_number: null },
    ...over,
  });
  const partie = { creator_id: 'chef', creator_side: 'A_GAU', creator: { name: 'Chef', elo_score: 1500 } };

  it('le créateur est un joueur, même absent de game_participants', () => {
    const out = clashPlayersFrom([], partie);
    expect(out.map(p => p.id)).toEqual(['chef']);
    expect(out[0].team).toBe('A');
  });

  it('une partie pleine fait bien 2 contre 2 avec lui', () => {
    const out = clashPlayersFrom([
      part('a2', 'accepted', 'A_DRO'),
      part('b1', 'accepted', 'B_GAU'),
      part('b2', 'accepted', 'B_DRO'),
    ], partie);
    expect(out).toHaveLength(4);
    expect(out.filter(p => p.team === 'A').map(p => p.id)).toEqual(['chef', 'a2']);
    expect(out.filter(p => p.team === 'B').map(p => p.id)).toEqual(['b1', 'b2']);
  });

  it('sans creator_side, le créateur est mis côté A', () => {
    const out = clashPlayersFrom([], { creator_id: 'chef', creator: { name: 'Chef' } });
    expect(out[0].team).toBe('A');
  });

  it('créateur aussi présent dans les participants : compté une seule fois', () => {
    const out = clashPlayersFrom([part('chef', 'accepted', 'A_GAU')], partie);
    expect(out.map(p => p.id)).toEqual(['chef']);
  });

  it('sans partie fournie, on ne lit que les participants', () => {
    expect(clashPlayersFrom([part('a', 'accepted', 'A_GAU')]).map(p => p.id)).toEqual(['a']);
  });

  it('une partie complète devient bien un choc', () => {
    const jeux = [{
      gameId: 'g', matchDate: new Date(now.getTime() + 2 * 86_400_000).toISOString(),
      location: 'ACSA', city: null,
      players: clashPlayersFrom([
        part('galan', 'accepted', 'A_DRO'),
        part('alamine', 'accepted', 'B_GAU'),
        part('rita', 'accepted', 'B_DRO'),
      ], partie),
    }];
    expect(pickClash(jeux, now)?.gameId).toBe('g');
  });
});

describe('clashesToPredict — plusieurs matchs, pas un seul', () => {
  const futur = (jours: number) => new Date(now.getTime() + jours * 86_400_000).toISOString();

  it('rend toutes les parties valides, la plus proche d\'abord', () => {
    const out = clashesToPredict([
      partie('tard', futur(5), [1500, 1500, 1500, 1500]),
      partie('tot', futur(1), [1400, 1400, 1900, 1900]),
      partie('milieu', futur(3), [1500, 1500, 1500, 1500]),
    ], now);
    expect(out.map(c => c.gameId)).toEqual(['tot', 'milieu', 'tard']);
  });

  it('écarte les parties passées et incomplètes', () => {
    const passee = partie('passee', new Date(now.getTime() - 3600_000).toISOString(), [1500, 1500, 1500, 1500]);
    const bancale = partie('bancale', futur(1), [1500, 1500, 1500, 1500]);
    bancale.players = bancale.players.slice(0, 3);
    expect(clashesToPredict([passee, bancale], now)).toEqual([]);
  });

  it('respecte la limite demandée', () => {
    const jeux = [1, 2, 3, 4].map(i => partie(`g${i}`, futur(i), [1500, 1500, 1500, 1500]));
    expect(clashesToPredict(jeux, now, 2)).toHaveLength(2);
  });

  it('tightestClashId désigne la plus serrée, pas la plus proche', () => {
    const out = clashesToPredict([
      partie('large', futur(1), [1400, 1400, 1900, 1900]),
      partie('serre', futur(4), [1500, 1520, 1510, 1505]),
    ], now);
    expect(out[0].gameId).toBe('large');            // la plus proche en tête
    expect(tightestClashId(out)).toBe('serre');     // mais le choc, c'est l'autre
  });

  it('pickClash reste la plus serrée', () => {
    const jeux = [
      partie('large', futur(1), [1400, 1400, 1900, 1900]),
      partie('serre', futur(4), [1500, 1520, 1510, 1505]),
    ];
    expect(pickClash(jeux, now)?.gameId).toBe('serre');
  });

  it('aucune partie → liste vide et aucun choc', () => {
    expect(clashesToPredict([], now)).toEqual([]);
    expect(tightestClashId([])).toBeNull();
  });
});

describe('withoutMyGames — on ne pronostique pas son propre match', () => {
  const futur = (jours: number) => new Date(now.getTime() + jours * 86_400_000).toISOString();

  it('retire la partie où je joue', () => {
    const liste = clashesToPredict([
      partie('sansMoi', futur(1), [1500, 1500, 1500, 1500]),
      partie('avecMoi', futur(2), [1500, 1500, 1500, 1500]),
    ], now);
    liste.find(c => c.gameId === 'avecMoi')!.players[0].id = 'moi';
    expect(withoutMyGames(liste, 'moi').map(c => c.gameId)).toEqual(['sansMoi']);
  });

  it('peu importe le camp où je suis', () => {
    const liste = clashesToPredict([partie('g', futur(1), [1500, 1500, 1500, 1500])], now);
    liste[0].players[3].id = 'moi';
    expect(withoutMyGames(liste, 'moi')).toEqual([]);
  });

  it('ne retire rien si je ne joue nulle part', () => {
    const liste = clashesToPredict([partie('g', futur(1), [1500, 1500, 1500, 1500])], now);
    expect(withoutMyGames(liste, 'inconnu')).toHaveLength(1);
  });
});
