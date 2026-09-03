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
// ci-dessous. Elle n'est pas tiree au hasard : elle est construite pour
// contenir, deliberement, les quatre cas qui departagent -- ceux ou une
// implementation approximative rend un classement plausible mais faux :
//
//   * UNE EGALITE A TROIS EN CYCLE PARFAIT (T1, T2, T4) : meme palier (1),
//     memes victoires (3), meme difference (+5), memes jeux gagnes (22), et
//     T1 bat T2, T4 bat T1, T2 bat T4. Un comparateur deux a deux est
//     CIRCULAIRE ici -- il n'est pas un ordre total, et `Array.sort` n'a alors
//     aucun resultat defini. Seul l'agregat (les jeux pris au groupe moins
//     ceux concedes) tranche, et les marges sont volontairement inegales pour
//     qu'il rende un ordre STRICT : T2 (+2), T4 (+1), T1 (-3). L'ordre des
//     identifiants est l'INVERSE de ce resultat, donc une implementation qui
//     retomberait sur l'id se trahirait immediatement ;
//   * UNE PAIRE A EGALITE (T5, T7) : meme palier (3), memes victoires (2),
//     meme difference (-7), memes jeux gagnes (16), et DEUX confrontations
//     directes entre eux (tours 2 et 5). L'agregat doit porter sur les DEUX,
//     pas sur la premiere rencontre trouvee. La aussi l'id dirait T5 avant T7,
//     et la confrontation directe dit l'inverse ;
//   * DEUX FORFAITS, dont un prononce APRES la generation de la rotation de
//     classement. Un forfait s'inscrit 0-0 des deux cotes : re-deduire le
//     vainqueur des jeux rendrait « B gagne » a tous les coups, forfaitaire
//     compris, et ferait MONTER le forfaitaire. C'est ici que les deux
//     implementations ont deja diverge deux fois ;
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
// T6 declare forfait au tour 4 (Terrain 1) et quitte la soiree ; l'echelle
// passe a 7 binomes. T3 declare forfait au tour 6 (Terrain 4), APRES que la
// rotation de classement a ete tiree : il figure donc encore dans le tableau
// du tour, ce qui est exactement le cas ou un creneau doit lui etre RETIRE.
//
// L'ordre `teamA` / `teamB` de chaque ligne est celui que produit `pairUp`
// (byes croissants, puis identifiant), et l'orientation des scores suit
// `teamA` -- meme contrat que `tournament_enter_score` cote serveur.
// ----------------------------------------------------------------------------
const TEAMS: TeamState[] = [
  { id: 'T1', level: 8.0, withdrawn: false },
  { id: 'T2', level: 7.5, withdrawn: false },
  { id: 'T3', level: 7.0, withdrawn: true },    // forfait au tour 6
  { id: 'T4', level: 6.5, withdrawn: false },
  { id: 'T5', level: 6.0, withdrawn: false },
  { id: 'T6', level: 5.5, withdrawn: true },    // forfait au tour 4
  { id: 'T7', level: 5.0, withdrawn: false },
  { id: 'T8', level: 4.5, withdrawn: false },
];

const MATCHES: Match[] = [
  // -- tour 1 : 8 binomes, 4 terrains pleins
  { round: 1, court: 4, teamA: 'T7', teamB: 'T8', gamesA: 1, gamesB: 6, confirmed: true },
  { round: 1, court: 3, teamA: 'T5', teamB: 'T6', gamesA: 4, gamesB: 6, confirmed: true },
  { round: 1, court: 2, teamA: 'T3', teamB: 'T4', gamesA: 0, gamesB: 5, confirmed: true },
  { round: 1, court: 1, teamA: 'T1', teamB: 'T2', gamesA: 6, gamesB: 5, confirmed: true },
  // -- tour 2
  { round: 2, court: 4, teamA: 'T5', teamB: 'T7', gamesA: 3, gamesB: 5, confirmed: true },
  { round: 2, court: 3, teamA: 'T3', teamB: 'T8', gamesA: 0, gamesB: 4, confirmed: true },
  { round: 2, court: 2, teamA: 'T2', teamB: 'T6', gamesA: 2, gamesB: 4, confirmed: true },
  { round: 2, court: 1, teamA: 'T1', teamB: 'T4', gamesA: 2, gamesB: 6, confirmed: true },
  // -- tour 3
  { round: 3, court: 4, teamA: 'T3', teamB: 'T5', gamesA: 2, gamesB: 5, confirmed: true },
  { round: 3, court: 3, teamA: 'T2', teamB: 'T7', gamesA: 4, gamesB: 1, confirmed: true },
  { round: 3, court: 2, teamA: 'T1', teamB: 'T8', gamesA: 2, gamesB: 5, confirmed: true },
  { round: 3, court: 1, teamA: 'T4', teamB: 'T6', gamesA: 3, gamesB: 5, confirmed: true },
  // -- tour 4 : T6 declare forfait au Terrain 1 et quitte la soiree
  { round: 4, court: 4, teamA: 'T3', teamB: 'T7', gamesA: 7, gamesB: 4, confirmed: true },
  { round: 4, court: 3, teamA: 'T1', teamB: 'T5', gamesA: 5, gamesB: 1, confirmed: true },
  { round: 4, court: 2, teamA: 'T2', teamB: 'T4', gamesA: 6, gamesB: 3, confirmed: true },
  { round: 4, court: 1, teamA: 'T6', teamB: 'T8', gamesA: 0, gamesB: 0, confirmed: true,
    forfeitedTeam: 'T6' },
  // -- tour 5 : 7 binomes, le Terrain 2 n'en porte plus qu'un (bye)
  { round: 5, court: 4, teamA: 'T5', teamB: 'T7', gamesA: 3, gamesB: 5, confirmed: true },
  { round: 5, court: 3, teamA: 'T3', teamB: 'T4', gamesA: 4, gamesB: 5, confirmed: true },
  { round: 5, court: 2, teamA: 'T1', teamB: null, gamesA: 0, gamesB: 0, confirmed: false },
  { round: 5, court: 1, teamA: 'T2', teamB: 'T8', gamesA: 5, gamesB: 3, confirmed: true },
  // -- tour 6 : LA ROTATION DE CLASSEMENT. Le Terrain 2 porte TROIS binomes
  //    (un bye + un match) ; T3 declare forfait au Terrain 4 une fois le tour
  //    deja tire.
  { round: 6, court: 4, teamA: 'T3', teamB: 'T5', gamesA: 0, gamesB: 0, confirmed: true,
    forfeitedTeam: 'T3' },
  { round: 6, court: 3, teamA: 'T7', teamB: null, gamesA: 0, gamesB: 0, confirmed: false },
  { round: 6, court: 2, teamA: 'T4', teamB: null, gamesA: 0, gamesB: 0, confirmed: false },
  { round: 6, court: 2, teamA: 'T8', teamB: 'T1', gamesA: 0, gamesB: 7, confirmed: true },
  { round: 6, court: 1, teamA: 'T2', teamB: null, gamesA: 0, gamesB: 0, confirmed: false },
];

const FINAL_ROUND = MATCHES.filter(m => m.round === 6);

describe('parite avec tournament_standings -- soiree de reference', () => {
  // Ce que rend `tournament_standings(tournoi, 6)` sur ce corpus, ligne par
  // ligne, dans l'ordre du `rank` qu'il calcule. Les cles sont celles de son
  // jsonb ; `losses` et `games_avg`, qu'il expose pour l'affichage et n'utilise
  // JAMAIS au tri, se deduisent de `played`/`wins` et de `games_won`/`played`.
  const SERVEUR = [
    { rank: 1, teamId: 'T8', withdrawn: false, bestCourt: 1, played: 6, wins: 4, gamesWon: 18, gamesLost: 15, diff: 3, h2h: 0 },
    { rank: 2, teamId: 'T2', withdrawn: false, bestCourt: 1, played: 5, wins: 3, gamesWon: 22, gamesLost: 17, diff: 5, h2h: 2 },
    { rank: 3, teamId: 'T4', withdrawn: false, bestCourt: 1, played: 5, wins: 3, gamesWon: 22, gamesLost: 17, diff: 5, h2h: 1 },
    { rank: 4, teamId: 'T1', withdrawn: false, bestCourt: 1, played: 5, wins: 3, gamesWon: 22, gamesLost: 17, diff: 5, h2h: -3 },
    { rank: 5, teamId: 'T7', withdrawn: false, bestCourt: 3, played: 5, wins: 2, gamesWon: 16, gamesLost: 23, diff: -7, h2h: 4 },
    { rank: 6, teamId: 'T5', withdrawn: false, bestCourt: 3, played: 6, wins: 2, gamesWon: 16, gamesLost: 23, diff: -7, h2h: -4 },
    { rank: 7, teamId: 'T6', withdrawn: true,  bestCourt: 1, played: 4, wins: 3, gamesWon: 15, gamesLost: 9,  diff: 6, h2h: 0 },
    { rank: 8, teamId: 'T3', withdrawn: true,  bestCourt: 2, played: 6, wins: 1, gamesWon: 13, gamesLost: 23, diff: -10, h2h: 0 },
  ];

  it('reproduit EXACTEMENT le classement calcule par le serveur', () => {
    expect(standings(TEAMS, MATCHES)).toEqual(SERVEUR);
  });

  // Les trois assertions qui suivent ne rajoutent aucune donnee : elles
  // NOMMENT les cas que la comparaison globale ci-dessus verifie deja en bloc,
  // pour qu'un echec dise QUOI a diverge et pas seulement QUE quelque chose a
  // diverge. C'est la seule raison de leur existence.

  // Cle 0 de `tournament_standings` : `s.withdrawn ASC`, avant meme le palier.
  // T6 a le MEILLEUR bilan de jeux de la soiree (+6) et a atteint le Terrain 1
  // avec 3 victoires : sans cette cle il serait 2e. Il est 7e, et il l'est
  // PENDANT la soiree, a l'ecran, pas seulement a la cloture.
  it('l abandon passe avant le palier, et il se voit tout de suite', () => {
    const s = standings(TEAMS, MATCHES);
    const t6 = s.find(x => x.teamId === 'T6')!;
    expect(t6.diff).toBe(6);                                   // le meilleur du plateau...
    expect(Math.max(...s.map(x => x.diff))).toBe(6);
    expect(t6.bestCourt).toBe(1);                              // ...au meilleur palier...
    expect(t6.rank).toBe(7);                                   // ...et pourtant 7e sur 8.
    const partis = s.filter(x => x.withdrawn).map(x => x.rank);
    expect(partis).toEqual([7, 8]);                            // les partis ferment la marche
  });

  // Le cycle : T1 bat T2, T4 bat T1, T2 bat T4. Un comparateur deux a deux est
  // circulaire ici. L'agregat, lui, est transitif par construction, et les
  // marges inegales (1, 4, 3) lui font rendre un ordre STRICT.
  it('l egalite a trois se tranche par l agregat, pas par un comparateur circulaire', () => {
    const s = standings(TEAMS, MATCHES);
    const trio = s.filter(x => ['T1', 'T2', 'T4'].includes(x.teamId));
    expect(trio.every(x => !x.withdrawn && x.bestCourt === 1 && x.wins === 3
                        && x.diff === 5 && x.gamesWon === 22)).toBe(true);
    expect(trio.map(x => x.teamId)).toEqual(['T2', 'T4', 'T1']);   // et non T1, T2, T4
    expect(trio.map(x => x.h2h)).toEqual([2, 1, -3]);
    expect(trio.reduce((n, x) => n + x.h2h, 0)).toBe(0);           // un agregat interne se compense
  });

  // La paire s'est rencontree DEUX fois (tours 2 et 5), T7 gagnant les deux
  // 5-3 : l'agregat vaut +4 / -4, pas +2 / -2. Une implementation qui ne
  // retiendrait que la premiere rencontre trouverait le meme ORDRE et
  // passerait -- d'ou la verification de la VALEUR.
  it('la confrontation directe additionne toutes les rencontres, pas la premiere', () => {
    const s = standings(TEAMS, MATCHES);
    const t7 = s.find(x => x.teamId === 'T7')!;
    const t5 = s.find(x => x.teamId === 'T5')!;
    expect([t7.h2h, t5.h2h]).toEqual([4, -4]);
    expect(t7.rank).toBeLessThan(t5.rank);                     // l id dirait l inverse
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

  // Dans le corpus : T6 (teamA, tour 4) et T3 (teamA, tour 6) declarent
  // forfait. Le serveur credite la victoire a T8 et a T5, et n'en tire
  // AUCUN jeu -- un forfait ne rapporte rien a personne.
  it('les deux forfaits du corpus creditent l adversaire sans donner de jeux', () => {
    const s = standings(TEAMS, MATCHES);
    const ff4 = MATCHES.find(m => m.forfeitedTeam === 'T6')!;
    const ff6 = MATCHES.find(m => m.forfeitedTeam === 'T3')!;
    expect(aWon(ff4)).toBe(false);                             // T6 est teamA : T8 gagne
    expect(aWon(ff6)).toBe(false);                             // T3 est teamA : T5 gagne
    expect(s.find(x => x.teamId === 'T8')!.wins).toBe(4);       // dont le forfait du tour 4
    expect(s.find(x => x.teamId === 'T5')!.wins).toBe(2);       // dont le forfait du tour 6
    // Le forfait compte comme un match JOUE, et pour zero jeu des deux cotes.
    expect(s.find(x => x.teamId === 'T6')!.played).toBe(4);
    expect(s.find(x => x.teamId === 'T6')!.gamesLost).toBe(9);  // rien de plus qu avant
  });
});

describe('parite avec fn_tournament_final_slots -- la rotation de classement', () => {
  // Ce que rend `fn_tournament_final_slots(tournoi, 6, 6)` sur ce corpus.
  // Les CRENEAUX bruts sont 1 (bye T2), 3 et 4 (le match du Terrain 2), 5
  // (bye T7), 7 et 8 (le match du Terrain 4) -- le creneau 2 n'existe pas (le
  // Terrain 1 ne porte qu'un bye), le creneau 6 non plus (Terrain 3), et le
  // creneau 8 est RETIRE parce qu'il revient a T3, qui a quitte la soiree.
  // Les non-places (T4, du bye du palier a trois ; puis T6 et T3, partis)
  // suivent le plus grand creneau attribue, dans l'ordre du classement
  // provisoire. La renumerotation contigue referme ensuite tous les trous.
  const SERVEUR = [
    { rank: 1, teamId: 'T2' },   // creneau 1  -- bye du Terrain 1
    { rank: 2, teamId: 'T1' },   // creneau 3  -- gagnant du Terrain 2
    { rank: 3, teamId: 'T8' },   // creneau 4  -- perdant du Terrain 2
    { rank: 4, teamId: 'T7' },   // creneau 5  -- bye du Terrain 3
    { rank: 5, teamId: 'T5' },   // creneau 7  -- gagnant du Terrain 4
    { rank: 6, teamId: 'T4' },   // creneau 8  -- non place (bye du palier a trois)
    { rank: 7, teamId: 'T6' },   // creneau 9  -- non place (parti au tour 4)
    { rank: 8, teamId: 'T3' },   // creneau 10 -- non place (parti au tour 6)
  ];

  it('reproduit EXACTEMENT les rangs finaux calcules par le serveur', () => {
    expect(finalRanking(FINAL_ROUND, 4, standings(TEAMS, MATCHES))).toEqual(SERVEUR);
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

  // Le palier a TROIS : le Terrain 2 porte un bye (T4) ET un match (T8 vs T1).
  // C'est le MATCH qui dispute les deux creneaux ; T4 repart dans les
  // non-places, ou son classement provisoire (3e) le range. Une version
  // precedente ecrasait sa Map par terrain et retenait la DERNIERE ligne
  // rencontree : le resultat dependait de l'ordre du tableau.
  it('sur un palier a trois, le match prend les creneaux et le bye est non place', () => {
    const s = standings(TEAMS, MATCHES);
    const r = finalRanking(FINAL_ROUND, 4, s);
    expect(s.find(x => x.teamId === 'T4')!.rank).toBe(3);          // 3e au provisoire...
    expect(r.find(x => x.teamId === 'T4')!.rank).toBe(6);          // ...6e a l arrivee
    expect(r.find(x => x.teamId === 'T1')!.rank).toBe(2);          // le match, lui, place
    expect(r.find(x => x.teamId === 'T8')!.rank).toBe(3);
    // Et l ordre du tableau n y change rien.
    expect(finalRanking([...FINAL_ROUND].reverse(), 4, s)).toEqual(r);
  });

  // T3 declare forfait APRES le tirage : il reste dans le tableau du tour, et
  // `fn_tournament_a_won` le declare perdant du Terrain 4. Sans le garde, il
  // prendrait le creneau 8 -- une place disputee -- alors que l'ecran l'a
  // montre dernier toute la soiree. Le creneau du VAINQUEUR (T5) n'est pas
  // touche pour autant.
  it('un binome parti n occupe jamais un creneau, mais n en libere pas pour son vainqueur', () => {
    const s = standings(TEAMS, MATCHES);
    const r = finalRanking(FINAL_ROUND, 4, s);
    expect(r.find(x => x.teamId === 'T5')!.rank).toBe(5);          // le gagnant garde sa place
    expect(r.find(x => x.teamId === 'T3')!.rank).toBe(8);          // le parti finit dernier
    expect(r[r.length - 1].teamId).toBe('T3');
  });
});
