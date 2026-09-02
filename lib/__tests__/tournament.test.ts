import { describe, it, expect } from 'vitest';
import { initialCourts, pairUp, nextCourts, standings, lastCompleteRound, finalRanking,
         type TeamState, type Match } from '../tournament';

const T = (id: string, level: number): TeamState => ({ id, level, withdrawn: false });

// 8 equipes -> 4 terrains, la plus forte au Terrain 1.
const EIGHT: TeamState[] = [
  T('a', 6.0), T('b', 5.8), T('c', 5.5), T('d', 5.2),
  T('e', 4.9), T('f', 4.5), T('g', 4.1), T('h', 3.8),
];

describe('placement du premier tour', () => {
  it('met les deux meilleures au Terrain 1', () => {
    const c = initialCourts(EIGHT);
    expect(c.get('a')).toBe(1);
    expect(c.get('b')).toBe(1);
    expect(c.get('g')).toBe(4);
    expect(c.get('h')).toBe(4);
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

describe('sens des paliers', () => {
  const joue = (ms: Match[], gagnants: Record<number, string>): Match[] =>
    ms.map(m => {
      const g = gagnants[m.court];
      const aGagne = m.teamA === g;
      return { ...m, gamesA: aGagne ? 6 : 2, gamesB: aGagne ? 2 : 6, confirmed: true };
    });

  it('place les plus forts au Terrain 1', () => {
    const c = initialCourts(EIGHT);
    expect(c.get('a')).toBe(1);
    expect(c.get('b')).toBe(1);
    expect(c.get('h')).toBe(4);
  });

  it('le gagnant descend d indice, le perdant monte', () => {
    const c0 = initialCourts(EIGHT);
    const ms = joue(pairUp(c0, new Map()), { 1: 'a', 2: 'c', 3: 'e', 4: 'g' });
    const c1 = nextCourts(c0, ms, 4);
    expect(c1.get('c')).toBe(1);   // gagnant du 2 monte vers 1
    expect(c1.get('d')).toBe(3);   // perdant du 2 descend vers 3
  });

  it('aux extremites, on ne bouge pas', () => {
    const c0 = initialCourts(EIGHT);
    const ms = joue(pairUp(c0, new Map()), { 1: 'a', 2: 'c', 3: 'e', 4: 'g' });
    const c1 = nextCourts(c0, ms, 4);
    expect(c1.get('a')).toBe(1);   // gagne au Terrain 1 : reste
    expect(c1.get('h')).toBe(4);   // perd au dernier : reste
  });
});

describe('appariement', () => {
  it('oppose les deux equipes d un meme terrain, sur tous les terrains', () => {
    const ms = pairUp(initialCourts(EIGHT), new Map());
    expect(ms).toHaveLength(4);
    const byCourt = new Map(ms.map(m => [m.court, m]));
    expect([byCourt.get(1)!.teamA, byCourt.get(1)!.teamB].sort()).toEqual(['a', 'b']);
    expect([byCourt.get(2)!.teamA, byCourt.get(2)!.teamB].sort()).toEqual(['c', 'd']);
    expect([byCourt.get(3)!.teamA, byCourt.get(3)!.teamB].sort()).toEqual(['e', 'f']);
    expect([byCourt.get(4)!.teamA, byCourt.get(4)!.teamB].sort()).toEqual(['g', 'h']);
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

  // Un palier a TROIS equipes n est pas une curiosite : il apparait des qu un
  // binome declare forfait au milieu de l echelle (le survivant reste sur
  // place apres son bye, et recoit le perdant du dessus ET le gagnant du
  // dessous). La version precedente appariait les deux premieres et
  // abandonnait la troisieme SANS RIEN produire : une paire plantee sur un
  // terrain sans adversaire, absente du tableau, et privee des jeux qui font
  // le classement.
  it('un palier a trois equipes ne laisse personne de cote', () => {
    const courts = new Map([['p', 2], ['q', 2], ['r', 2]]);
    const ms = pairUp(courts, new Map());
    expect(ms).toHaveLength(2);                       // un bye + un match
    const places = ms.flatMap(m => [m.teamA, m.teamB]).filter(x => x !== null);
    expect([...places].sort()).toEqual(['p', 'q', 'r']);   // les trois, une fois chacune
  });

  // Les byes sont deliberement A CONTRE-COURANT de l ordre alphabetique :
  // p a le plus de byes et le plus petit id, q en a le moins et un id du
  // milieu. Un jeu de donnees ou byes et id sont alignes (p:0, q:1, r:2)
  // passerait aussi bien avec une implementation qui choisit le bye PAR L ID
  // SEUL, et ne prouverait donc rien de la rotation — qui est justement la
  // regle en jeu ici.
  it('sur un palier impair, le bye va a l equipe qui en a eu le moins, pas au plus petit id', () => {
    const courts = new Map([['p', 2], ['q', 2], ['r', 2]]);
    const byeCount = new Map([['p', 2], ['q', 0], ['r', 1]]);
    const ms = pairUp(courts, byeCount);
    const bye = ms.find(m => m.teamB === null)!;
    expect(bye.teamA).toBe('q');        // 0 bye : c est son tour, malgre l id
    const match = ms.find(m => m.teamB !== null)!;
    expect(match.teamA).toBe('r');      // 1 bye
    expect(match.teamB).toBe('p');      // 2 byes
  });

  it('le bye et le match d un meme palier portent le meme numero de terrain', () => {
    const ms = pairUp(new Map([['p', 7], ['q', 7], ['r', 7]]), new Map());
    expect(ms).toHaveLength(2);         // sans ca, le test passait aussi sur
    expect(ms.every(m => m.court === 7)).toBe(true);   // l abandon silencieux
  });

  it('hurle si un palier porte plus de trois equipes', () => {
    const courts = new Map([['p', 1], ['q', 1], ['r', 1], ['s', 1]]);
    expect(() => pairUp(courts, new Map())).toThrow(/corrompue/);
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
    const ms = joue(pairUp(c0, new Map()), { 1: 'a', 2: 'c', 3: 'e', 4: 'g' });
    const c1 = nextCourts(c0, ms, 4);
    expect(c1.get('e')).toBe(2);   // gagnant du 3 monte
    expect(c1.get('f')).toBe(4);   // perdant du 3 descend
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

  // Le cas qui a motive la correction de pairUp, joue de bout en bout : on
  // retire une equipe d un terrain du MILIEU (le 2) apres le tour 1. Le
  // terrain 2 tombe a 1 equipe (bye), puis remonte a 3 au tour suivant
  // (le bye reste sur place, le perdant du 3 et le gagnant du 1 arrivent).
  // L invariant verifie n est plus "deux par terrain" -- il ne tient plus
  // apres un forfait -- mais le seul qui compte pour un joueur : CHAQUE
  // equipe encore en lice apparait dans EXACTEMENT un match du tour, bye
  // compris.
  it('INVARIANT : apres un forfait au milieu de l echelle, aucune equipe ne disparait du tableau', () => {
    let c = initialCourts(EIGHT);
    const vivantes = new Set(EIGHT.map(t => t.id));
    const byes = new Map<string, number>();
    for (let tour = 1; tour <= 5; tour++) {
      const pairs = pairUp(c, byes);
      const vues = pairs.flatMap(m => [m.teamA, m.teamB]).filter((x): x is string => x !== null);
      expect(vues.slice().sort()).toEqual([...vivantes].sort());
      expect(new Set(vues).size).toBe(vues.length);   // et une seule fois chacune

      for (const m of pairs) {
        if (m.teamB === null) byes.set(m.teamA!, (byes.get(m.teamA!) ?? 0) + 1);
      }
      const reels = pairs.filter(m => m.teamB !== null);
      const gagnants = Object.fromEntries(reels.map(m => [m.court, m.teamA!]));
      c = nextCourts(c, joue(reels, gagnants), 4);

      if (tour === 1) {
        const victime = [...c.entries()].find(([, court]) => court === 2)![0];
        vivantes.delete(victime);
        c.delete(victime);        // le forfait quitte l echelle
      }
    }
    expect(vivantes.size).toBe(7);
  });
});

describe('classement', () => {
  const M = (court: number, a: string, b: string, ga: number, gb: number): Match =>
    ({ round: 1, court, teamA: a, teamB: b, gamesA: ga, gamesB: gb, confirmed: true });

  // a et c sont au meme palier (Terrain 1), avec le meme nombre de victoires
  // et la meme difference : seuls les jeux gagnes les separent.
  it('a palier, victoires et difference egaux, les jeux gagnes departagent', () => {
    const teams = [T('a', 6), T('c', 4)];
    const ms = [M(1, 'a', 'x', 6, 1), { ...M(1, 'c', 'y', 5, 0), round: 2 }];
    const s = standings(teams, ms);
    expect(s[0].teamId).toBe('a');
    expect(s[0].gamesWon).toBe(6);
    expect(s[0].rank).toBe(1);
  });

  it('departage a la difference de jeux', () => {
    const teams = [T('a', 6), T('c', 4)];
    const ms = [M(1, 'a', 'x', 6, 5), { ...M(1, 'c', 'y', 6, 0), round: 2 }];
    const s = standings(teams, ms);
    expect(s[0].teamId).toBe('c');   // meme terrain, memes victoires, meilleure difference
  });

  // La ligne teamB (b.gamesWon += m.gamesB, b.gamesLost += m.gamesA) n etait
  // verifiee par aucun test : toutes les assertions precedentes inspectent
  // une equipe en position A. Si gamesA/gamesB etaient invertis sur cette
  // ligne, ~la moitie des equipes (celles en slot B) auraient des stats
  // fausses sans qu aucun test ne le remarque.
  it('les stats de l equipe en position B ne sont pas inversees (gamesA/gamesB)', () => {
    const s = standings(EIGHT.slice(0, 4), [M(1, 'a', 'b', 6, 1), { ...M(1, 'c', 'd', 6, 5), round: 2 }]);
    const d = s.find(x => x.teamId === 'd')!;   // d est teamB du match (c, d)
    expect(d.gamesWon).toBe(5);
    expect(d.gamesLost).toBe(6);
    expect(d.rank).toBe(3);
  });

  // La confrontation directe doit s agreger sur TOUTES les rencontres entre
  // deux equipes, pas seulement la premiere trouvee dans le tableau — deux
  // paires peuvent se recroiser plusieurs fois pendant la soiree. a et b sont
  // construits pour etre a egalite parfaite au meme palier (memes victoires,
  // meme difference, memes jeux gagnes) une fois les manches directes et les
  // manches de remplissage comptees ; seule la confrontation directe (a mene
  // 4 a -4 sur l ensemble de leurs deux manches) les depart.
  const H2H = [
    M(1, 'a', 'b', 4, 6),                        // 1re manche directe : b devant
    { ...M(1, 'b', 'a', 0, 6), round: 2 },        // 2e manche directe : a ecrase, slots inverses
    { ...M(1, 'a', 'p', 6, 4), round: 3 },        // remplissage : a l emporte de justesse
    { ...M(1, 'b', 'q', 10, 0), round: 4 },       // remplissage symetrique : b ecrase pour recoller
  ];

  it('departage a la confrontation directe agregee sur toutes les rencontres', () => {
    const teams = [T('a', 6), T('b', 5)];
    const a = standings(teams, H2H).find(x => x.teamId === 'a')!;
    const b = standings(teams, H2H).find(x => x.teamId === 'b')!;
    expect(a.gamesWon).toBe(b.gamesWon);   // 16 chacun : egalite globale...
    expect(a.diff).toBe(b.diff);           // ...et meme diff : la h2h doit trancher
    expect(a.wins).toBe(b.wins);           // ...et memes victoires
    expect(a.rank).toBeLessThan(b.rank);   // a mene l ensemble des confrontations directes (4 contre -4)
  });

  it('le departage direct ne depend pas de l ordre des matchs dans le tableau', () => {
    const teams = [T('a', 6), T('b', 5)];
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
  // dans le classement final -- MEME au meme palier que tout le monde, un
  // forfait qui n a plus de victoires finit dernier.
  it('les matchs 0-6 enregistres au forfait comptent comme n importe quel autre match', () => {
    const teams = [T('a', 6), T('b', 5), { ...T('c', 4), withdrawn: true }, T('d', 3)];
    const ms = [
      M(1, 'a', 'b', 6, 3),
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

  // Trois binomes a egalite parfaite qui se sont battus EN ROND : m bat n,
  // n bat a, a bat m, tous 6-2. Chacun finit a 8 jeux gagnes, 8 perdus,
  // difference 0, meme palier, meme nombre de victoires (chacun 1). Le
  // departage a la confrontation directe etait un COMPARATEUR deux a deux :
  // sur un cycle il n est pas un ordre total, et Array.prototype.sort n a
  // alors aucun resultat defini. Le TypeScript rendait m, n, a la ou le SQL
  // rendait a, m, n — sur la meme soiree.
  // Le departage est desormais un SCALAIRE des deux cotes : les jeux pris aux
  // AUTRES membres du groupe d ex aequo, moins ceux concedes. Ici il vaut 0
  // pour les trois (chacun prend 8 et concede 8 dans le groupe), donc c est
  // l id qui tranche, et les deux implementations disent a, m, n.
  const CYCLE = [
    M(1, 'm', 'n', 6, 2),
    M(1, 'n', 'a', 6, 2),
    M(1, 'a', 'm', 6, 2),
  ];

  it('un cycle a trois se departage par un scalaire, jamais par un comparateur circulaire', () => {
    const teams = [T('m', 6), T('n', 5), T('a', 4)];
    const s = standings(teams, CYCLE);
    expect(s.every(x => x.gamesWon === 8 && x.diff === 0)).toBe(true);   // egalite parfaite
    expect(s.every(x => x.h2h === 0)).toBe(true);                        // et cycle parfait
    expect(s.map(x => x.teamId)).toEqual(['a', 'm', 'n']);               // l id tranche
  });

  it('le classement d un cycle a trois ne depend pas de l ordre des matchs', () => {
    const teams = [T('m', 6), T('n', 5), T('a', 4)];
    const normal = standings(teams, CYCLE).map(x => x.teamId);
    const inverse = standings(teams, [...CYCLE].reverse()).map(x => x.teamId);
    expect(inverse).toEqual(normal);
  });

  // Le scalaire n est pas vide de sens hors cycle parfait. Trois binomes a
  // egalite STRICTE (12 jeux gagnes, 12 perdus, difference 0, 2 victoires
  // chacun) mais avec des confrontations internes tres inegales : zeta prend
  // 12 jeux au groupe sans en concede aucun, mu en est a -4, alpha a -8.
  // Les identifiants sont choisis a CONTRE-SENS du resultat attendu : par id
  // seul l ordre serait alpha, mu, zeta — exactement l inverse. Seul le
  // scalaire peut produire l ordre attendu.
  it('dans un groupe de trois, le scalaire departage sur les jeux pris au groupe', () => {
    const teams = [T('zeta', 6), T('mu', 5), T('alpha', 4), T('f1', 3), T('f2', 2)];
    const ms = [
      // les trois rencontres INTERNES au groupe
      M(1, 'zeta', 'mu', 6, 0), M(1, 'zeta', 'alpha', 6, 0), M(1, 'mu', 'alpha', 6, 4),
      // remplissage hors groupe, calibre pour ramener les trois a 12-12 avec
      // 2 victoires chacun (alpha en deux petites victoires plutot qu une
      // seule, pour egaler zeta et mu sur ce critere aussi)
      M(1, 'zeta', 'f1', 0, 6), M(1, 'zeta', 'f2', 0, 6),
      M(1, 'mu', 'f1', 6, 2),
      M(1, 'alpha', 'f2', 4, 0), { ...M(1, 'alpha', 'f2', 4, 0), round: 2 },
    ];
    const s = standings(teams, ms);
    const trois = s.slice(0, 3);
    expect(trois.every(x => x.gamesWon === 12 && x.diff === 0 && x.wins === 2)).toBe(true);
    expect(trois.map(x => x.h2h)).toEqual([12, -4, -8]);
    expect(trois.map(x => x.teamId)).toEqual(['zeta', 'mu', 'alpha']);
  });

  it('le plafond de tour exclut les matchs des tours posterieurs', () => {
    const teams = [T('a', 6), T('b', 5)];
    const ms = [
      { ...M(1, 'a', 'b', 6, 0), round: 1 },
      { ...M(1, 'a', 'b', 0, 6), round: 2 },
    ];
    expect(standings(teams, ms).find(x => x.teamId === 'a')!.played).toBe(2);
    expect(standings(teams, ms, 1).find(x => x.teamId === 'a')!.played).toBe(1);
    expect(standings(teams, ms, 1).find(x => x.teamId === 'a')!.gamesWon).toBe(6);
  });

  it('un match non confirme ne compte pas', () => {
    const ms = [{ ...M(2, 'a', 'b', 6, 1), confirmed: false }];
    const s = standings(EIGHT.slice(0, 2), ms);
    expect(s[0].played).toBe(0);
  });

  // Le palier prime desormais sur tout : a s est maintenu au Terrain 1 (peu
  // de jeux, victoire courte), b a ecrase au Terrain 3 (beaucoup de jeux,
  // beaucoup de victoires). a doit rester devant malgre ca -- sinon le
  // classement ignore le palier et retombe sur l ancienne hierarchie.
  it('le palier prime sur les jeux gagnes', () => {
    const teams = [T('a', 6), T('b', 5)];
    const matchesPalier = [
      M(1, 'a', 'x', 6, 5),
      M(3, 'b', 'y', 6, 0),
      { ...M(3, 'b', 'y', 6, 0), round: 2 },
      { ...M(3, 'b', 'y', 6, 0), round: 3 },
    ];
    const s = standings(teams, matchesPalier);
    expect(s[0].teamId).toBe('a');
    expect(s[0].gamesWon).toBeLessThan(s[1].gamesWon);   // et pourtant devant
  });

  it('a palier egal, les victoires priment sur la difference', () => {
    const teams = [T('a', 6), T('b', 5)];
    const matchesVictoires = [
      M(2, 'a', 'x', 6, 5),
      { ...M(2, 'a', 'x', 6, 5), round: 2 },
      { ...M(2, 'b', 'y', 6, 0), round: 3 },
    ];
    const s = standings(teams, matchesVictoires);
    expect(s[0].wins).toBeGreaterThan(s[1].wins);
    expect(s[0].diff).toBeLessThan(s[1].diff);           // et pourtant devant
  });

  it('un bye n est ni victoire ni defaite et ne rapporte aucun jeu', () => {
    const teams = [T('a', 6)];
    const byeMatch: Match = { round: 1, court: 1, teamA: 'a', teamB: null, gamesA: 0, gamesB: 0, confirmed: true };
    const s = standings(teams, [byeMatch]);
    const t = s.find(x => x.teamId === 'a')!;
    expect(t.played).toBe(0);
    expect(t.wins).toBe(0);
    expect(t.gamesWon).toBe(0);
  });
});

describe('dernier tour complet', () => {
  const R = (round: number, a: string | null, b: string | null, confirmed: boolean): Match =>
    ({ round, court: 1, teamA: a, teamB: b, gamesA: 0, gamesB: 0, confirmed });

  it('rend le dernier tour dont tous les matchs reels sont confirmes', () => {
    expect(lastCompleteRound([
      R(1, 'a', 'b', true), R(1, 'c', 'd', true),
      R(2, 'a', 'c', true), R(2, 'b', 'd', false),   // tour 2 entame, pas fini
    ])).toBe(1);
  });

  it('rend le dernier tour joue quand tout est confirme', () => {
    expect(lastCompleteRound([
      R(1, 'a', 'b', true), R(2, 'a', 'b', true), R(3, 'a', 'b', true),
    ])).toBe(3);
  });

  it('ignore les byes, que personne ne peut confirmer', () => {
    expect(lastCompleteRound([
      R(1, 'a', 'b', true), R(1, 'c', null, false),   // le bye reste non confirme
    ])).toBe(1);
  });

  it('rend 0 quand le tour 1 lui meme est inacheve', () => {
    expect(lastCompleteRound([R(1, 'a', 'b', false), R(1, 'c', 'd', true)])).toBe(0);
  });

  it('rend 0 sur une soiree sans aucun match', () => {
    expect(lastCompleteRound([])).toBe(0);
  });
});

describe('rotation de classement', () => {
  const M = (court: number, a: string, b: string, ga: number, gb: number): Match =>
    ({ round: 5, court, teamA: a, teamB: b, gamesA: ga, gamesB: gb, confirmed: true });

  const FINAL_MATCHES: Match[] = [
    M(1, 'a', 'c', 6, 2),   // Terrain 1 : a gagne
    M(2, 'b', 'd', 6, 3),   // Terrain 2 : b gagne
    M(3, 'e', 'g', 6, 4),   // Terrain 3 : e gagne
    M(4, 'f', 'h', 6, 1),   // Terrain 4 : f gagne
  ];

  it('le gagnant du Terrain 1 est premier, son perdant deuxieme', () => {
    const r = finalRanking(FINAL_MATCHES, 4);
    expect(r[0]).toEqual({ rank: 1, teamId: 'a' });
    expect(r[1]).toEqual({ rank: 2, teamId: 'c' });
    expect(r[2]).toEqual({ rank: 3, teamId: 'b' });   // gagnant du Terrain 2
  });

  // Le Terrain 2 n a qu une equipe (bye) : elle prend le rang 3, et le rang 4
  // (celui de son adversaire absent) reste vacant -- il n est PAS recycle
  // pour decaler les terrains suivants, qui gardent leurs rangs fixes.
  const FINAL_MATCHES_AVEC_BYE: Match[] = [
    M(1, 'a', 'c', 6, 2),
    { round: 5, court: 2, teamA: 'b', teamB: null, gamesA: 0, gamesB: 0, confirmed: false },
    M(3, 'e', 'g', 6, 4),
    M(4, 'f', 'h', 6, 1),
  ];

  it('un terrain sans match ne decale pas les rangs suivants', () => {
    const r = finalRanking(FINAL_MATCHES_AVEC_BYE, 4);
    expect(r.map(x => x.rank)).toEqual([1, 2, 3, 5, 6, 7, 8]);
  });
});
