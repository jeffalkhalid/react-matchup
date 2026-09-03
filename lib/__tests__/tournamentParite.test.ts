// Ancre de parite TS <-> SQL pour le format montante / descente.
//
// LE SQL FAIT AUTORITE. `supabase/migrations/tournaments_rpcs.sql` est
// l'implementation de production ; `lib/tournament.ts` en est le miroir
// d'affichage. Les deux calculs sont volontairement SEPARES -- port delibere,
// pas un appel -- et ils ont deja diverge quatre fois pendant ce chantier,
// dont une fois sur le SENS DES PALIERS, ou deux erreurs s'annulaient et
// restaient donc invisibles isolement. Ce fichier est ce qui rend la
// divergence impossible a rater.
//
// LE CORPUS. Une soiree de 8 binomes, 4 terrains, 6 rotations, FIGEE
// ci-dessous. Elle n'est pas ecrite a la main : elle a ete PRODUITE par le
// moteur lui-meme -- `initialCourts`, `pairUp`, `nextCourts` enchaines sur six
// tours -- puis verrouillee. Les appariements, les numeros de terrain et les
// byes sont donc ceux d'une vraie echelle ; seuls les vainqueurs et les marges
// ont ete choisis, pour que la soiree contienne les cas qui departagent :
//
//   * UNE EGALITE A TROIS EN CYCLE PARFAIT (T1, T2, T4) : meme palier (1),
//     memes victoires (3), meme difference (+1), memes jeux gagnes (21), et
//     T1 bat T2, T4 bat T1, T2 bat T4. Un comparateur deux a deux est
//     CIRCULAIRE ici -- il n'est pas un ordre total, et `Array.sort` n'a alors
//     aucun resultat defini. Seul l'agregat tranche, et les marges sont
//     volontairement inegales (1, 4, 3) pour qu'il rende un ordre STRICT :
//     T2 (+2), T4 (+1), T1 (-3). Cet ordre est une PERMUTATION SANS POINT
//     FIXE de l'ordre des identifiants -- aucun des trois ne garde sa place --
//     donc un repli sur l'identifiant se trahit immediatement ;
//   * UNE PAIRE A EGALITE (T5, T6) : meme palier (2), memes victoires (2),
//     meme difference (-3), memes jeux gagnes (19), et DEUX confrontations
//     directes, aux tours 1 et 4, GAGNEES CHACUNE PAR UN CAMP. T6 gagne la
//     premiere de 1, T5 la seconde de 5 : l'agregat vaut +4 pour T5, et il
//     RENVERSE l'ordre que la premiere rencontre seule donnerait. Une
//     implementation qui s'arreterait a la premiere rencontre trouvee rendrait
//     donc un classement different, pas seulement une valeur differente ;
//   * UN BINOME PARTI QUI PARTAGE LA SIGNATURE D'UN GROUPE PRESENT : T8
//     (parti au tour 6) a exactement le meme palier (2), les memes victoires
//     (2), la meme difference (-3) et les memes jeux gagnes (19) que T5 et T6,
//     et il les a rencontres tous les deux. Si `withdrawn` sortait de la cle
//     du GROUPE d'ex aequo, les trois tomberaient dans le meme groupe et les
//     matchs de T8 pollueraient la confrontation directe de T5 et T6 ;
//   * DEUX FORFAITS, ORIENTES DES DEUX COTES. T3 declare forfait au tour 4 en
//     etant `teamA`, T8 au tour 6 en etant `teamB`. C'est cette seconde
//     orientation qui compte : un forfait s'inscrit 0-0 des deux cotes, donc
//     `gamesA > gamesB` rend faux et designe B -- ce qui COINCIDE avec le
//     marqueur quand le forfaitaire est en `teamA`, et le CONTREDIT quand il
//     est en `teamB`. Sans un forfait cote B, une regression du forfait
//     passerait inapercue. Celui du tour 6 est de surcroit dans la rotation de
//     classement, donc il discrimine `standings` ET `finalRanking` ;
//   * DES TERRAINS A EFFECTIF IMPAIR : apres le premier forfait l'echelle
//     tombe a 7 binomes, ce qui donne des paliers a 1 equipe (bye) et, a la
//     derniere rotation, UN PALIER A TROIS (le Terrain 2 : un match ET un
//     bye).
//
// LES VALEURS ATTENDUES SONT CELLES DU SERVEUR. Ni PostgreSQL ni Docker ne
// sont installes sur la machine de developpement : elles ont ete derivees A LA
// MAIN en lisant `tournaments_rpcs.sql`, fonction par fonction et cle par cle.
// La trace complete de cette derivation est dans
// `.superpowers/sdd/2026-08-29-tournois-montante-descente/task-6-report.md`.
// Le jour ou la migration est appliquee, ce test devient une verification
// reelle sans rien changer.
//
// SI CE TEST ECHOUE, ce n'est jamais le test qu'on ajuste : c'est que le
// moteur TypeScript et le SQL ont diverge, et le diff dit a quel endroit.
// La regle est toujours la meme -- on ramene le TypeScript sur le SQL.
import { describe, it, expect } from 'vitest';
import { standings, finalRanking, aWon, type TeamState, type Match } from '../tournament';

// ----------------------------------------------------------------------------
// LE CORPUS -- fige. Les niveaux donnent le placement du tour 1
// (`initialCourts` : T1/T2 au Terrain 1, T7/T8 au Terrain 4).
//
// T3 declare forfait au tour 4 (Terrain 1, en `teamA`) et quitte la soiree ;
// l'echelle passe a 7 binomes. T8 declare forfait au tour 6 (Terrain 4, en
// `teamB`), APRES que la rotation de classement a ete tiree : il figure donc
// encore dans le tableau du tour, ce qui est exactement le cas ou un creneau
// doit lui etre RETIRE.
//
// L'ordre `teamA` / `teamB` de chaque ligne est celui que produit `pairUp`
// (byes croissants, puis identifiant), et l'orientation des scores suit
// `teamA` -- meme contrat que `tournament_enter_score` cote serveur.
// ----------------------------------------------------------------------------
const TEAMS: TeamState[] = [
  { id: 'T1', level: 8.0, withdrawn: false },
  { id: 'T2', level: 7.5, withdrawn: false },
  { id: 'T3', level: 7.0, withdrawn: true },    // forfait au tour 4, en teamA
  { id: 'T4', level: 6.5, withdrawn: false },
  { id: 'T5', level: 6.0, withdrawn: false },
  { id: 'T6', level: 5.5, withdrawn: false },
  { id: 'T7', level: 5.0, withdrawn: false },
  { id: 'T8', level: 4.5, withdrawn: true },    // forfait au tour 6, en teamB
];

const MATCHES: Match[] = [
  // -- tour 1 : 8 binomes, 4 terrains pleins
  { round: 1, court: 4, teamA: 'T7', teamB: 'T8', gamesA: 7, gamesB: 4, confirmed: true },
  { round: 1, court: 3, teamA: 'T5', teamB: 'T6', gamesA: 5, gamesB: 6, confirmed: true },
  { round: 1, court: 2, teamA: 'T3', teamB: 'T4', gamesA: 7, gamesB: 6, confirmed: true },
  { round: 1, court: 1, teamA: 'T1', teamB: 'T2', gamesA: 6, gamesB: 5, confirmed: true },
  // -- tour 2
  { round: 2, court: 4, teamA: 'T5', teamB: 'T8', gamesA: 3, gamesB: 5, confirmed: true },
  { round: 2, court: 3, teamA: 'T4', teamB: 'T7', gamesA: 6, gamesB: 5, confirmed: true },
  { round: 2, court: 2, teamA: 'T2', teamB: 'T6', gamesA: 5, gamesB: 3, confirmed: true },
  { round: 2, court: 1, teamA: 'T1', teamB: 'T3', gamesA: 3, gamesB: 7, confirmed: true },
  // -- tour 3
  { round: 3, court: 4, teamA: 'T5', teamB: 'T7', gamesA: 0, gamesB: 4, confirmed: true },
  { round: 3, court: 3, teamA: 'T6', teamB: 'T8', gamesA: 3, gamesB: 6, confirmed: true },
  { round: 3, court: 2, teamA: 'T1', teamB: 'T4', gamesA: 2, gamesB: 6, confirmed: true },
  { round: 3, court: 1, teamA: 'T2', teamB: 'T3', gamesA: 0, gamesB: 6, confirmed: true },
  // -- tour 4 : T3 declare forfait au Terrain 1, en teamA, et quitte la soiree
  { round: 4, court: 4, teamA: 'T5', teamB: 'T6', gamesA: 6, gamesB: 1, confirmed: true },
  { round: 4, court: 3, teamA: 'T1', teamB: 'T7', gamesA: 6, gamesB: 1, confirmed: true },
  { round: 4, court: 2, teamA: 'T2', teamB: 'T8', gamesA: 5, gamesB: 2, confirmed: true },
  { round: 4, court: 1, teamA: 'T3', teamB: 'T4', gamesA: 0, gamesB: 0, confirmed: true,
    forfeitedTeam: 'T3' },
  // -- tour 5 : 7 binomes, le Terrain 2 n'en porte plus qu'un (bye)
  { round: 5, court: 4, teamA: 'T6', teamB: 'T7', gamesA: 6, gamesB: 0, confirmed: true },
  { round: 5, court: 3, teamA: 'T5', teamB: 'T8', gamesA: 4, gamesB: 2, confirmed: true },
  { round: 5, court: 2, teamA: 'T1', teamB: null, gamesA: 0, gamesB: 0, confirmed: false },
  { round: 5, court: 1, teamA: 'T2', teamB: 'T4', gamesA: 6, gamesB: 3, confirmed: true },
  // -- tour 6 : LA ROTATION DE CLASSEMENT. Le Terrain 2 porte TROIS binomes
  //    (un bye + un match) ; T8 declare forfait au Terrain 4, en teamB, une
  //    fois le tour deja tire.
  { round: 6, court: 4, teamA: 'T7', teamB: 'T8', gamesA: 0, gamesB: 0, confirmed: true,
    forfeitedTeam: 'T8' },
  { round: 6, court: 3, teamA: 'T6', teamB: null, gamesA: 0, gamesB: 0, confirmed: false },
  { round: 6, court: 2, teamA: 'T4', teamB: null, gamesA: 0, gamesB: 0, confirmed: false },
  { round: 6, court: 2, teamA: 'T5', teamB: 'T1', gamesA: 1, gamesB: 4, confirmed: true },
  { round: 6, court: 1, teamA: 'T2', teamB: null, gamesA: 0, gamesB: 0, confirmed: false },
];

const FINAL_ROUND = MATCHES.filter(m => m.round === 6);

describe('parite avec tournament_standings -- soiree de reference', () => {
  // Ce que rend `tournament_standings(tournoi, 6)` sur ce corpus, ligne par
  // ligne, dans l'ordre du `rank` qu'il calcule. Les cles sont celles de son
  // jsonb ; `losses` et `games_avg`, qu'il expose pour l'affichage et n'utilise
  // JAMAIS au tri, se deduisent de `played`/`wins` et de `games_won`/`played`.
  const SERVEUR = [
    { rank: 1, teamId: 'T2', withdrawn: false, bestCourt: 1, played: 5, wins: 3, gamesWon: 21, gamesLost: 20, diff: 1, h2h: 2 },
    { rank: 2, teamId: 'T4', withdrawn: false, bestCourt: 1, played: 5, wins: 3, gamesWon: 21, gamesLost: 20, diff: 1, h2h: 1 },
    { rank: 3, teamId: 'T1', withdrawn: false, bestCourt: 1, played: 5, wins: 3, gamesWon: 21, gamesLost: 20, diff: 1, h2h: -3 },
    { rank: 4, teamId: 'T5', withdrawn: false, bestCourt: 2, played: 6, wins: 2, gamesWon: 19, gamesLost: 22, diff: -3, h2h: 4 },
    { rank: 5, teamId: 'T6', withdrawn: false, bestCourt: 2, played: 5, wins: 2, gamesWon: 19, gamesLost: 22, diff: -3, h2h: -4 },
    { rank: 6, teamId: 'T7', withdrawn: false, bestCourt: 3, played: 6, wins: 3, gamesWon: 17, gamesLost: 22, diff: -5, h2h: 0 },
    { rank: 7, teamId: 'T3', withdrawn: true,  bestCourt: 1, played: 4, wins: 3, gamesWon: 20, gamesLost: 9,  diff: 11, h2h: 0 },
    { rank: 8, teamId: 'T8', withdrawn: true,  bestCourt: 2, played: 6, wins: 2, gamesWon: 19, gamesLost: 22, diff: -3, h2h: 0 },
  ];

  it('reproduit EXACTEMENT le classement calcule par le serveur', () => {
    expect(standings(TEAMS, MATCHES)).toEqual(SERVEUR);
  });

  // Les assertions qui suivent ne rajoutent aucune donnee : elles NOMMENT les
  // cas que la comparaison globale ci-dessus verifie deja en bloc, pour qu'un
  // echec dise QUOI a diverge et pas seulement QUE quelque chose a diverge.

  // Cle 0 de `tournament_standings` : `s.withdrawn ASC`, avant meme le palier.
  // T3 a la MEILLEURE difference de jeux de la soiree (+11), au MEILLEUR
  // palier (1), avec autant de victoires que le trio de tete : sans cette cle
  // il serait PREMIER. Il est 7e, et il l'est PENDANT la soiree, a l'ecran,
  // pas seulement a la cloture.
  it('l abandon passe avant le palier, et il se voit tout de suite', () => {
    const s = standings(TEAMS, MATCHES);
    const t3 = s.find(x => x.teamId === 'T3')!;
    expect(t3.diff).toBe(Math.max(...s.map(x => x.diff)));     // la meilleure du plateau...
    expect(t3.bestCourt).toBe(1);                              // ...au meilleur palier...
    expect(t3.wins).toBe(3);                                   // ...autant de victoires que le 1er...
    expect(t3.rank).toBe(7);                                   // ...et pourtant 7e sur 8.
    expect(s.filter(x => x.withdrawn).map(x => x.rank)).toEqual([7, 8]);
  });

  // La cinquieme cle du GROUPE d'ex aequo. T8 est parti, mais il partage avec
  // T5 et T6 les quatre cles suivantes -- palier 2, 2 victoires, difference
  // -3, 19 jeux gagnes -- et il les a rencontres tous les deux. Si `withdrawn`
  // sortait de la cle du groupe, les trois n'en formeraient qu'un et les
  // matchs de T8 entreraient dans la confrontation directe de T5 et T6.
  // Le SQL forme ce groupe avec un `dense_rank()` sur CINQ cles, `withdrawn`
  // en tete : les deux camps doivent rester separes.
  it('un binome parti ne partage jamais le groupe d ex aequo d un binome present', () => {
    const s = standings(TEAMS, MATCHES);
    const sig = (id: string) => {
      const x = s.find(t => t.teamId === id)!;
      return [x.bestCourt, x.wins, x.diff, x.gamesWon];
    };
    // Les quatre cles SOUS `withdrawn` sont identiques pour les trois...
    expect(sig('T8')).toEqual(sig('T5'));
    expect(sig('T8')).toEqual(sig('T6'));
    // ...et T8 a bien rencontre les deux autres, donc le groupe changerait.
    const contre = (a: string, b: string) => MATCHES.filter(m =>
      m.confirmed && ((m.teamA === a && m.teamB === b) || (m.teamA === b && m.teamB === a)));
    expect(contre('T8', 'T5')).toHaveLength(2);
    expect(contre('T8', 'T6')).toHaveLength(1);
    // Et pourtant la confrontation directe de T8 vaut ZERO : il est seul dans
    // son groupe, l'abandon l'ayant deja departage de tout le monde.
    expect(s.find(x => x.teamId === 'T8')!.h2h).toBe(0);
    // Cote present, l'agregat ne porte que sur T5 <-> T6 : +4 / -4, et non la
    // valeur qu'il prendrait si les matchs de T8 y entraient.
    expect([s.find(x => x.teamId === 'T5')!.h2h,
            s.find(x => x.teamId === 'T6')!.h2h]).toEqual([4, -4]);
  });

  // Le cycle : T1 bat T2, T4 bat T1, T2 bat T4. Un comparateur deux a deux est
  // circulaire ici. L'agregat, lui, est transitif par construction, et les
  // marges inegales (1, 4, 3) lui font rendre un ordre STRICT.
  it('l egalite a trois se tranche par l agregat, pas par un comparateur circulaire', () => {
    const s = standings(TEAMS, MATCHES);
    const trio = s.filter(x => ['T1', 'T2', 'T4'].includes(x.teamId));
    expect(trio.every(x => !x.withdrawn && x.bestCourt === 1 && x.wins === 3
                        && x.diff === 1 && x.gamesWon === 21)).toBe(true);
    expect(trio.map(x => x.teamId)).toEqual(['T2', 'T4', 'T1']);
    // Permutation SANS POINT FIXE de l'ordre des identifiants : aucun des
    // trois ne garde la place que l'identifiant lui donnerait. Un repli sur
    // l'identifiant serait donc detecte, quelle que soit la position lue.
    const parId = ['T1', 'T2', 'T4'];
    trio.forEach((x, i) => expect(x.teamId).not.toBe(parId[i]));
    expect(trio.map(x => x.h2h)).toEqual([2, 1, -3]);
    expect(trio.reduce((n, x) => n + x.h2h, 0)).toBe(0);       // un agregat interne se compense
  });

  // La paire s'est rencontree DEUX fois, et chaque camp en a gagne une : T6 la
  // premiere (de 1 jeu), T5 la seconde (de 5). L'agregat vaut donc +4 pour T5
  // et le met DEVANT -- alors que la premiere rencontre seule mettrait T6
  // devant. C'est l'ORDRE, et pas seulement la valeur, qui depend de la somme.
  it('la confrontation directe additionne toutes les rencontres, pas la premiere', () => {
    const s = standings(TEAMS, MATCHES);
    const t5 = s.find(x => x.teamId === 'T5')!;
    const t6 = s.find(x => x.teamId === 'T6')!;
    const duels = MATCHES.filter(m => m.confirmed &&
      ((m.teamA === 'T5' && m.teamB === 'T6') || (m.teamA === 'T6' && m.teamB === 'T5')));
    expect(duels).toHaveLength(2);
    expect(duels[0].gamesA - duels[0].gamesB).toBe(-1);        // T6 gagne la 1re, de 1
    expect(duels[1].gamesA - duels[1].gamesB).toBe(5);         // T5 gagne la 2e, de 5
    expect([t5.h2h, t6.h2h]).toEqual([4, -4]);                 // et non [-1, 1]
    expect(t5.rank).toBeLessThan(t6.rank);                     // la 1re rencontre dirait l inverse
  });

  it('ne depend pas de l ordre des matchs dans le tableau', () => {
    const inverse = standings(TEAMS, [...MATCHES].reverse());
    expect(inverse).toEqual(standings(TEAMS, MATCHES));
  });
});

describe('parite avec fn_tournament_a_won -- le forfait se lit au marqueur', () => {
  // Un forfait s'inscrit `tournaments.forfeit_games` DES DEUX COTES (0-0 par
  // defaut). `gamesA > gamesB` vaut alors faux, donc « B gagne » -- ce qui
  // ferait MONTER le forfaitaire quand c'est lui qui est en `teamB`.
  it('le forfaitaire perd, qu il soit en teamA ou en teamB', () => {
    const base = { round: 1, court: 1, gamesA: 0, gamesB: 0, confirmed: true };
    expect(aWon({ ...base, teamA: 'X', teamB: 'Y', forfeitedTeam: 'X' })).toBe(false);
    expect(aWon({ ...base, teamA: 'X', teamB: 'Y', forfeitedTeam: 'Y' })).toBe(true);
    // Sans marqueur, le 0-0 retombe du cote de B, exactement comme le
    // `coalesce(p_games_a > p_games_b, false)` du SQL.
    expect(aWon({ ...base, teamA: 'X', teamB: 'Y' })).toBe(false);
  });

  // Le forfait du tour 6 est celui qui compte pour l'ancre : le forfaitaire T8
  // est en `teamB`, donc `gamesA > gamesB` designerait T8 VAINQUEUR alors que
  // le marqueur donne T7. Un site d'appel qui oublierait le marqueur se
  // trahirait ici -- et pas sur celui du tour 4, ou T3 est en `teamA` et ou
  // les deux lectures coincident par accident.
  it('le forfait du tour 6 est oriente cote teamB, la ou les deux lectures divergent', () => {
    const ff4 = MATCHES.find(m => m.forfeitedTeam === 'T3')!;
    const ff6 = MATCHES.find(m => m.forfeitedTeam === 'T8')!;
    expect(ff4.teamA).toBe('T3');                              // forfaitaire en teamA...
    expect(aWon(ff4)).toBe(ff4.gamesA > ff4.gamesB);           // ...les deux lectures coincident
    expect(ff6.teamB).toBe('T8');                              // forfaitaire en teamB...
    expect(aWon(ff6)).not.toBe(ff6.gamesA > ff6.gamesB);       // ...elles divergent
    expect(aWon(ff6)).toBe(true);                              // le marqueur donne T7 vainqueur
  });

  it('les deux forfaits creditent l adversaire sans donner de jeux', () => {
    const s = standings(TEAMS, MATCHES);
    expect(s.find(x => x.teamId === 'T4')!.wins).toBe(3);       // dont le forfait du tour 4
    expect(s.find(x => x.teamId === 'T7')!.wins).toBe(3);       // dont le forfait du tour 6
    // Le forfait compte comme un match JOUE, et pour zero jeu des deux cotes.
    expect(s.find(x => x.teamId === 'T3')!.played).toBe(4);
    expect(s.find(x => x.teamId === 'T3')!.gamesLost).toBe(9);
    expect(s.find(x => x.teamId === 'T8')!.played).toBe(6);
    expect(s.find(x => x.teamId === 'T8')!.gamesLost).toBe(22);
  });
});

describe('parite avec fn_tournament_final_slots -- la rotation de classement', () => {
  // Ce que rend `fn_tournament_final_slots(tournoi, 6, 6)` sur ce corpus.
  // Les CRENEAUX bruts sont 1 (bye T2), 3 et 4 (le match du Terrain 2), 5
  // (bye T6), 7 et 8 (le match du Terrain 4) -- le creneau 2 n'existe pas (le
  // Terrain 1 ne porte qu'un bye), le creneau 6 non plus (Terrain 3), et le
  // creneau 8 est RETIRE parce qu'il revient a T8, qui a quitte la soiree.
  // Les non-places (T4, du bye du palier a trois ; puis T3 et T8, partis)
  // suivent le plus grand creneau attribue, dans l'ordre du classement
  // provisoire. La renumerotation contigue referme ensuite tous les trous.
  const SERVEUR = [
    { rank: 1, teamId: 'T2' },   // creneau 1  -- bye du Terrain 1
    { rank: 2, teamId: 'T1' },   // creneau 3  -- gagnant du Terrain 2
    { rank: 3, teamId: 'T5' },   // creneau 4  -- perdant du Terrain 2
    { rank: 4, teamId: 'T6' },   // creneau 5  -- bye du Terrain 3
    { rank: 5, teamId: 'T7' },   // creneau 7  -- gagnant du Terrain 4 (par forfait)
    { rank: 6, teamId: 'T4' },   // creneau 8  -- non place (bye du palier a trois)
    { rank: 7, teamId: 'T3' },   // creneau 9  -- non place (parti au tour 4)
    { rank: 8, teamId: 'T8' },   // creneau 10 -- non place (parti au tour 6)
  ];

  it('reproduit EXACTEMENT les rangs finaux calcules par le serveur', () => {
    expect(finalRanking(FINAL_ROUND, 4, standings(TEAMS, MATCHES))).toEqual(SERVEUR);
  });

  // LE TOUR DE CLASSEMENT SE LIT SEUL. Le SQL borne son CTE `fr` a
  // `m.round_no = p_final_round` : les cinq tours precedents n'y entrent pas.
  // Passer l'HISTORIQUE COMPLET a la fonction doit donc donner exactement le
  // meme classement que lui passer la seule rotation de classement -- c'est le
  // garde-fou que promet son docblock, et sans lui les matchs du tour 1
  // reprendraient les creneaux (T7 devant T8 au Terrain 4, T3 au Terrain 2...)
  // et le classement changerait de fond en comble.
  it('un historique complet passe par erreur donne le meme classement', () => {
    const s = standings(TEAMS, MATCHES);
    expect(finalRanking(MATCHES, 4, s)).toEqual(finalRanking(FINAL_ROUND, 4, s));
  });

  // La renumerotation contigue, isolee. Les creneaux bruts sont 1, 3, 4, 5, 7
  // (et 8, 9, 10 pour les non-places) : les rangs rendus sont 1..8 sans trou.
  // Un bareme qui va du rang 1 au rang 8 ne peut pas sauter un rang -- ces
  // points ne seraient jamais attribues et tous les suivants recevraient moins
  // que leur du.
  it('les rangs sont contigus 1..N, jamais les creneaux bruts', () => {
    const r = finalRanking(FINAL_ROUND, 4, standings(TEAMS, MATCHES));
    expect(r.map(x => x.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(r).toHaveLength(TEAMS.length);        // personne ne disparait
  });

  // Le palier a TROIS : le Terrain 2 porte un bye (T4) ET un match (T5 vs T1).
  // C'est le MATCH qui dispute les deux creneaux ; T4 repart dans les
  // non-places, ou son classement provisoire (2e) le range. Une version
  // precedente ecrasait sa Map par terrain et retenait la DERNIERE ligne
  // rencontree : le resultat dependait de l'ordre du tableau.
  it('sur un palier a trois, le match prend les creneaux et le bye est non place', () => {
    const s = standings(TEAMS, MATCHES);
    const r = finalRanking(FINAL_ROUND, 4, s);
    expect(s.find(x => x.teamId === 'T4')!.rank).toBe(2);          // 2e au provisoire...
    expect(r.find(x => x.teamId === 'T4')!.rank).toBe(6);          // ...6e a l arrivee
    expect(r.find(x => x.teamId === 'T1')!.rank).toBe(2);          // le match, lui, place
    expect(r.find(x => x.teamId === 'T5')!.rank).toBe(3);
  });

  // Et le resultat ne doit dependre NI de l'ordre du tableau, NI de l'ordre de
  // declaration des deux lignes du palier a trois. Le SQL tranche par
  // `ORDER BY (team_b IS NOT NULL) DESC`, pas par l'ordre d'arrivee : les deux
  // dispositions ci-dessous doivent donner le meme classement.
  it('l ordre de declaration du bye et du match du palier a trois n y change rien', () => {
    const s = standings(TEAMS, MATCHES);
    const attendu = finalRanking(FINAL_ROUND, 4, s);
    const hors = FINAL_ROUND.filter(m => m.court !== 2);
    const bye = FINAL_ROUND.find(m => m.court === 2 && m.teamB === null)!;
    const match = FINAL_ROUND.find(m => m.court === 2 && m.teamB !== null)!;
    expect(finalRanking([...hors, bye, match], 4, s)).toEqual(attendu);   // bye d abord
    expect(finalRanking([...hors, match, bye], 4, s)).toEqual(attendu);   // match d abord
    expect(finalRanking([...FINAL_ROUND].reverse(), 4, s)).toEqual(attendu);
  });

  // LE VAINQUEUR D'UN MATCH FORFAIT SE LIT AU MARQUEUR ICI AUSSI. Sur le
  // chemin de production, cette lecture est INOBSERVABLE : `tournament_forfeit`
  // est le seul ecrivain de `forfeited_team` et il pose `withdrawn = true` dans
  // la meme transaction, donc le forfaitaire perd de toute facon son creneau et
  // la renumerotation contigue absorbe l'ecart -- le SQL lui-meme y est
  // insensible. Elle redevient observable des que `provisional` n'est pas
  // fourni : sans lui, aucun binome n'est connu comme parti, les deux creneaux
  // du Terrain 4 sont attribues, et `gamesA > gamesB` donnerait le forfaitaire
  // T8 VAINQUEUR devant T7. C'est ce que verrouille l'assertion ci-dessous --
  // et c'est ce qui empeche le site d'appel de se desaligner en silence.
  it('sans classement provisoire, le forfait se lit quand meme au marqueur', () => {
    const r = finalRanking(FINAL_ROUND, 4);
    // Aucun binome n'est connu comme parti : les six creneaux attribues
    // restent, et seuls les non-places manquent.
    expect(r.map(x => x.teamId)).toEqual(['T2', 'T1', 'T5', 'T6', 'T7', 'T8']);
    expect(r.map(x => x.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    // T7 devant T8 : le marqueur, pas le score. `gamesA > gamesB` inverserait
    // exactement ces deux-la.
    const t7 = r.findIndex(x => x.teamId === 'T7');
    const t8 = r.findIndex(x => x.teamId === 'T8');
    expect(t7).toBeLessThan(t8);
  });

  // T8 declare forfait APRES le tirage : il reste dans le tableau du tour. Le
  // marqueur le declare perdant du Terrain 4 -- mais `gamesA > gamesB` le
  // declarerait VAINQUEUR, et il prendrait alors le creneau 7. Le garde
  // `withdrawn` l'ecarte de toute facon des creneaux, et le creneau du
  // VAINQUEUR (T7) n'est pas touche pour autant.
  it('un binome parti n occupe jamais un creneau, mais n en libere pas pour son vainqueur', () => {
    const s = standings(TEAMS, MATCHES);
    const r = finalRanking(FINAL_ROUND, 4, s);
    expect(r.find(x => x.teamId === 'T7')!.rank).toBe(5);          // le gagnant garde sa place
    expect(r.find(x => x.teamId === 'T8')!.rank).toBe(8);          // le parti finit dernier
    expect(r[r.length - 1].teamId).toBe('T8');
  });
});
