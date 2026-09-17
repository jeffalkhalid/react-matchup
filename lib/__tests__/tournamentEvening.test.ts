import { describe, it, expect, vi } from 'vitest';

// lib/tournaments charge le client Supabase, qui exige les variables
// d'environnement. Les fonctions testees ici sont PURES.
vi.mock('../supabase', () => ({ supabase: {} }));

import {
  courtState, eveningCourts, myCourt, blockingLabel, blocks, courtsDone, roundLabel,
} from '../tournamentEvening';

const M = (o: any = {}) => ({
  id: 'm1', tournament_id: 't', round_no: 2, court_no: 3,
  team_a: 'A', team_b: 'B', games_a: null, games_b: null,
  forfeited_team: null, confirmed_at: null, ...o,
});
const T = (id: string, p1: string, p2: string) =>
  ({ id, tournament_id: 't', player1_id: p1, player2_id: p2, withdrawn: false });
const E = (matchId: string, player: string, a: number, b: number) => ({
  id: `${matchId}-${player}`, tournament_id: 't', match_id: matchId,
  player_id: player, games_a: a, games_b: b, entered_at: '2026-09-11T20:20:00Z',
});

const EQUIPES = [T('A', 'mina', 'alamine'), T('B', 'admin', 'devq')];

describe('l etat d un terrain', () => {
  it('VIDE quand personne n a saisi — et ca bloque', () => {
    expect(courtState(M(), [], [])).toBe('vide');
    expect(blocks('vide')).toBe(true);
  });

  it('PROVISOIRE quand un seul camp a saisi — et ca ne bloque PAS', () => {
    // La distinction que `matchLiveStatus` ne fait pas : il rend « awaiting »
    // dans les deux cas. Les confondre ferait afficher « en attente » sur un
    // terrain qui n'empeche rien, et paniquer a chaque rotation.
    const m = M({ games_a: 6, games_b: 4 });
    expect(courtState(m, [E('m1', 'mina', 6, 4)], [])).toBe('provisoire');
    expect(blocks('provisoire')).toBe(false);
  });

  it('ACQUIS quand les deux camps concordent', () => {
    const m = M({ games_a: 6, games_b: 4, confirmed_at: '2026-09-11T20:21:00Z' });
    expect(courtState(m, [E('m1', 'mina', 6, 4)], [E('m1', 'admin', 6, 4)])).toBe('acquis');
  });

  it('LITIGE quand ils se contredisent — et ca bloque', () => {
    // Dans une montante le score decide OU L'ON VA : un camp lese descend,
    // l'autre monte, et la rotation suivante se joue contre les mauvais
    // adversaires. Ca ne se rattrape pas apres coup.
    const m = M({ games_a: 6, games_b: 4 });
    expect(courtState(m, [E('m1', 'mina', 6, 4)], [E('m1', 'admin', 4, 6)])).toBe('litige');
    expect(blocks('litige')).toBe(true);
  });

  it('EXEMPT sans adversaire, FORFAIT quand un camp a declare', () => {
    expect(courtState(M({ team_b: null }), [], [])).toBe('exempt');
    expect(courtState(M({ forfeited_team: 'B' }), [], [])).toBe('forfait');
  });
});

describe('les terrains de la rotation', () => {
  const matches = [
    M({ id: 'm1', court_no: 3, team_a: 'A', team_b: 'B' }),
    M({ id: 'm2', court_no: 1, team_a: 'C', team_b: 'D', games_a: 6, games_b: 2,
        confirmed_at: '2026-09-11T20:21:00Z' }),
    M({ id: 'm3', court_no: 2, team_a: 'E', team_b: 'F' }),
    M({ id: 'm9', court_no: 9, round_no: 1, team_a: 'A', team_b: 'B' }),
  ];
  const teams = [...EQUIPES, T('C', 'c1', 'c2'), T('D', 'd1', 'd2'),
    T('E', 'e1', 'e2'), T('F', 'f1', 'f2')];

  it('ne garde que la rotation EN COURS', () => {
    const c = eveningCourts(matches, teams, [], 'mina', 2);
    expect(c.map(x => x.courtNo)).toEqual([1, 2, 3]);
  });

  it('trie par NUMERO de terrain, pas par etat', () => {
    // C'est l'ordre du gymnase, le seul que tout le monde partage. Trier par
    // etat ferait sauter les cartes d'une rotation a l'autre alors qu'on
    // cherche « le terrain 5 » avec les yeux.
    const c = eveningCourts(matches, teams, [], 'mina', 2);
    expect(c.map(x => x.courtNo)).toEqual([1, 2, 3]);
  });

  it('marque MON terrain, et lui seul', () => {
    const c = eveningCourts(matches, teams, [], 'mina', 2);
    expect(c.filter(x => x.mine).map(x => x.courtNo)).toEqual([3]);
    expect(myCourt(c)?.courtNo).toBe(3);
  });

  it('me trouve aussi quand je suis dans le camp B', () => {
    const c = eveningCourts(matches, teams, [], 'devq', 2);
    expect(myCourt(c)?.courtNo).toBe(3);
  });

  it('rend null quand je ne joue pas cette rotation', () => {
    expect(myCourt(eveningCourts(matches, teams, [], 'inconnu', 2))).toBe(null);
  });

  it('range les saisies du bon cote', () => {
    // Une saisie rangee du mauvais cote ferait passer un accord pour un
    // litige : `matchLiveStatus` compare les camps OPPOSES.
    const e = [E('m1', 'mina', 6, 4), E('m1', 'admin', 6, 4)];
    const m = matches.map(x => x.id === 'm1'
      ? M({ ...x, games_a: 6, games_b: 4, confirmed_at: 'x' }) : x);
    const c = eveningCourts(m, teams, e, 'mina', 2);
    expect(c.find(x => x.courtNo === 3)!.state).toBe('acquis');
  });
});

describe('ce qui bloque, dit a tout le monde', () => {
  const vue = (courtNo: number, state: any) =>
    ({ matchId: `m${courtNo}`, courtNo, state, mine: false, gamesA: null, gamesB: null });

  it('ne dit rien quand rien ne bloque', () => {
    expect(blockingLabel([vue(1, 'acquis'), vue(2, 'provisoire')])).toBe(null);
  });

  it('distingue « pas de score » de « desaccord »', () => {
    // Deux manques differents, deux gestes differents : aller chercher quatre
    // joueurs, ou demander a deux camps de se mettre d'accord.
    const txt = blockingLabel([vue(5, 'vide'), vue(8, 'litige')])!;
    expect(txt).toContain('Terrain 5 : pas de score rentré');
    expect(txt).toContain('Terrain 8 : les deux camps ne disent pas la même chose');
  });

  it('groupe les terrains de meme manque', () => {
    expect(blockingLabel([vue(5, 'vide'), vue(7, 'vide')]))
      .toBe('Terrains 5, 7 : pas de score rentré');
  });
});

describe('la jauge de la soiree', () => {
  const vue = (courtNo: number, state: any) =>
    ({ matchId: `m${courtNo}`, courtNo, state, mine: false, gamesA: null, gamesB: null });

  it('compte un terrain PROVISOIRE comme fini', () => {
    // Son score est effectif, il n'empeche rien. Ne compter que les acquis
    // afficherait un retard qui n'existe pas et pousserait a relancer des
    // gens qui ont deja fait leur part.
    expect(courtsDone([vue(1, 'acquis'), vue(2, 'provisoire'), vue(3, 'vide')]))
      .toEqual({ done: 2, total: 3 });
  });

  it('ne compte pas les exempts dans le total', () => {
    expect(courtsDone([vue(1, 'acquis'), vue(2, 'exempt')]))
      .toEqual({ done: 1, total: 1 });
  });

  it('un forfait est fini, il n attend rien', () => {
    expect(courtsDone([vue(1, 'forfait')])).toEqual({ done: 1, total: 1 });
  });
});

describe('le libelle de rotation', () => {
  it('se lit sans calcul', () => {
    expect(roundLabel(2, 6)).toBe('Rotation 2 sur 6');
  });
});
