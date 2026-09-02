import { describe, it, expect } from 'vitest';
import { initialCourts, pairUp, nextCourts, standings, type TeamState, type Match } from '../tournament';

const T = (id: string, level: number): TeamState => ({ id, level, withdrawn: false });

// 8 equipes -> 4 terrains, la plus forte au terrain 4.
const EIGHT: TeamState[] = [
  T('a', 6.0), T('b', 5.8), T('c', 5.5), T('d', 5.2),
  T('e', 4.9), T('f', 4.5), T('g', 4.1), T('h', 3.8),
];

describe('placement du premier tour', () => {
  it('met les deux meilleures au terrain le plus haut', () => {
    const c = initialCourts(EIGHT);
    expect(c.get('a')).toBe(4);
    expect(c.get('b')).toBe(4);
    expect(c.get('g')).toBe(1);
    expect(c.get('h')).toBe(1);
  });

  it('place exactement deux equipes par terrain', () => {
    const c = initialCourts(EIGHT);
    const parTerrain = new Map<number, number>();
    for (const t of c.values()) parTerrain.set(t, (parTerrain.get(t) ?? 0) + 1);
    expect([...parTerrain.values()]).toEqual([2, 2, 2, 2]);
  });

  it('refuse un nombre impair d equipes', () => {
    expect(() => initialCourts(EIGHT.slice(0, 7))).toThrow();
  });
});

describe('appariement', () => {
  it('oppose les deux equipes d un meme terrain, sur tous les terrains', () => {
    const ms = pairUp(initialCourts(EIGHT), new Map());
    expect(ms).toHaveLength(4);
    const byCourt = new Map(ms.map(m => [m.court, m]));
    expect([byCourt.get(4)!.teamA, byCourt.get(4)!.teamB].sort()).toEqual(['a', 'b']);
    expect([byCourt.get(3)!.teamA, byCourt.get(3)!.teamB].sort()).toEqual(['c', 'd']);
    expect([byCourt.get(2)!.teamA, byCourt.get(2)!.teamB].sort()).toEqual(['e', 'f']);
    expect([byCourt.get(1)!.teamA, byCourt.get(1)!.teamB].sort()).toEqual(['g', 'h']);
  });

  it('un terrain a une seule equipe donne un bye', () => {
    const courts = new Map([['z', 5]]);
    const ms = pairUp(courts, new Map());
    expect(ms).toHaveLength(1);
    expect(ms[0]).toEqual({ round: 0, court: 5, teamA: 'z', teamB: null, gamesA: 0, gamesB: 0, confirmed: false });
  });

  it('a byes inegaux sur un meme terrain, la moins de byes prend la place de paire', () => {
    const courts = new Map([['x', 1], ['y', 1]]);
    const byeCount = new Map([['x', 2], ['y', 0]]);
    const ms = pairUp(courts, byeCount);
    expect(ms).toHaveLength(1);
    expect(ms[0].teamA).toBe('y');   // 0 bye : priorite
    expect(ms[0].teamB).toBe('x');   // 2 byes
  });
});

describe('mouvement entre les tours', () => {
  const joue = (ms: Match[], gagnants: Record<number, string>): Match[] =>
    ms.map(m => {
      const g = gagnants[m.court];
      const aGagne = m.teamA === g;
      return { ...m, gamesA: aGagne ? 6 : 2, gamesB: aGagne ? 2 : 6, confirmed: true };
    });

  it('le gagnant monte, le perdant descend', () => {
    const c0 = initialCourts(EIGHT);
    const ms = joue(pairUp(c0, new Map()), { 4: 'a', 3: 'c', 2: 'e', 1: 'g' });
    const c1 = nextCourts(c0, ms, 4);
    expect(c1.get('c')).toBe(4);   // gagnant du 3 monte
    expect(c1.get('d')).toBe(2);   // perdant du 3 descend
  });

  it('aux extremites, on ne bouge pas', () => {
    const c0 = initialCourts(EIGHT);
    const ms = joue(pairUp(c0, new Map()), { 4: 'a', 3: 'c', 2: 'e', 1: 'g' });
    const c1 = nextCourts(c0, ms, 4);
    expect(c1.get('a')).toBe(4);   // gagne en haut : reste
    expect(c1.get('h')).toBe(1);   // perd en bas : reste
  });

  it('INVARIANT : chaque terrain garde exactement deux equipes, tour apres tour', () => {
    let c = initialCourts(EIGHT);
    for (let tour = 1; tour <= 5; tour++) {
      // Un seul appel a pairUp par tour : on reutilise ses matchs pour designer
      // les gagnants (teamA, arbitraire mais deterministe) plutot que de
      // rappeler pairUp une seconde fois pour la meme chose.
      const pairs = pairUp(c, new Map());
      const gagnants = Object.fromEntries(pairs.map(m => [m.court, m.teamA!]));
      const ms = joue(pairs, gagnants);
      c = nextCourts(c, ms, 4);
      const parTerrain = new Map<number, number>();
      for (const t of c.values()) parTerrain.set(t, (parTerrain.get(t) ?? 0) + 1);
      expect([...parTerrain.values()].sort()).toEqual([2, 2, 2, 2]);
    }
  });
});

describe('classement', () => {
  const M = (court: number, a: string, b: string, ga: number, gb: number): Match =>
    ({ round: 1, court, teamA: a, teamB: b, gamesA: ga, gamesB: gb, confirmed: true });

  it('classe aux jeux gagnes', () => {
    const s = standings(EIGHT.slice(0, 4), [M(2, 'a', 'b', 6, 1), M(1, 'c', 'd', 6, 5)]);
    expect(s[0].teamId).toBe('a');
    expect(s[0].gamesWon).toBe(6);
    expect(s[0].rank).toBe(1);
  });

  it('departage a la difference de jeux', () => {
    const s = standings(EIGHT.slice(0, 4), [M(2, 'a', 'b', 6, 5), M(1, 'c', 'd', 6, 0)]);
    expect(s[0].teamId).toBe('c');   // meme 6 jeux gagnes, meilleure difference
  });

  // La ligne teamB (b.gamesWon += m.gamesB, b.gamesLost += m.gamesA) n etait
  // verifiee par aucun test : toutes les assertions precedentes inspectent
  // une equipe en position A. Si gamesA/gamesB etaient invertis sur cette
  // ligne, ~la moitie des equipes (celles en slot B) auraient des stats
  // fausses sans qu aucun test ne le remarque.
  it('les stats de l equipe en position B ne sont pas inversees (gamesA/gamesB)', () => {
    const s = standings(EIGHT.slice(0, 4), [M(2, 'a', 'b', 6, 1), M(1, 'c', 'd', 6, 5)]);
    const d = s.find(x => x.teamId === 'd')!;   // d est teamB du match (c, d)
    expect(d.gamesWon).toBe(5);
    expect(d.gamesLost).toBe(6);
    expect(d.rank).toBe(3);
  });

  // La confrontation directe doit s agreger sur TOUTES les rencontres entre
  // deux equipes, pas seulement la premiere trouvee dans le tableau — deux
  // paires peuvent se recroiser plusieurs fois pendant la soiree (l invariant
  // le montre : a et b se rencontrent 3 fois en 5 tours). a et b sont
  // construits pour etre a egalite parfaite (12 jeux gagnes, diff 0 chacun)
  // une fois les matchs de a contre c et de b contre d comptes ; seule la
  // confrontation directe (a mene 12-4 sur les deux manches jouees entre eux)
  // les depart.
  const H2H = [
    M(2, 'a', 'b', 4, 6),   // 1re manche : b devant sur CE match
    M(3, 'b', 'a', 0, 6),   // 2e manche : a ecrase, teamA/teamB inverses
    M(1, 'a', 'c', 0, 4),   // remplissage : ramene a et b a egalite globale
    M(1, 'b', 'd', 4, 0),   // remplissage symetrique pour b
  ];

  it('departage a la confrontation directe agregee sur toutes les rencontres', () => {
    const teams = [T('a', 6), T('b', 5), T('c', 4), T('d', 3)];
    const a = standings(teams, H2H).find(x => x.teamId === 'a')!;
    const b = standings(teams, H2H).find(x => x.teamId === 'b')!;
    expect(a.gamesWon).toBe(b.gamesWon);   // 10 chacun : egalite globale...
    expect(a.diff).toBe(b.diff);           // ...et meme diff : la h2h doit trancher
    expect(a.rank).toBeLessThan(b.rank);   // a mene l ensemble des confrontations directes (10-6)
  });

  it('le departage direct ne depend pas de l ordre des matchs dans le tableau', () => {
    const teams = [T('a', 6), T('b', 5), T('c', 4), T('d', 3)];
    const ordreNormal = standings(teams, H2H).map(x => x.teamId);
    const ordreInverse = standings(teams, [...H2H].reverse()).map(x => x.teamId);
    expect(ordreInverse).toEqual(ordreNormal);
    expect(ordreNormal[0]).toBe('a');
    expect(ordreNormal[1]).toBe('b');
  });

  // La regle "un forfait compte ses matchs restants comme des defaites 0-6" ne
  // se joue PAS dans standings : standings ne connait pas le nombre de tours
  // restants et ne peut rien synthetiser. C'est au moment du retrait (cote
  // serveur, tache ulterieure) que les matchs deja generes et non joues de
  // l'equipe forfait sont enregistres 0-6. Ce que standings doit prouver ici,
  // c'est qu'une fois ENREGISTRES, ces matchs comptent exactement comme
  // n'importe quel autre match confirme : dans played, dans gamesLost, et
  // dans le classement final.
  it('les matchs 0-6 enregistres au forfait comptent comme n importe quel autre match', () => {
    const teams = [T('a', 6), T('b', 5), { ...T('c', 4), withdrawn: true }, T('d', 3)];
    const ms = [
      M(2, 'a', 'b', 6, 3),
      M(1, 'c', 'd', 2, 6),   // dernier match joue par c avant son retrait
      M(1, 'c', 'd', 0, 6),   // tour restant, enregistre 0-6 au forfait
      M(1, 'c', 'd', 0, 6),   // idem
    ];
    const s = standings(teams, ms);
    const c = s.find(x => x.teamId === 'c')!;
    expect(c.played).toBe(3);
    expect(c.gamesWon).toBe(2);
    expect(c.gamesLost).toBe(18);
    expect(c.rank).toBe(s.length);   // derniere place : les forfaits ne l epargnent pas
  });

  it('un match non confirme ne compte pas', () => {
    const ms = [{ ...M(2, 'a', 'b', 6, 1), confirmed: false }];
    const s = standings(EIGHT.slice(0, 2), ms);
    expect(s[0].played).toBe(0);
  });
});
