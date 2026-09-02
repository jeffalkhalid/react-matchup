// lib/tournament.ts
// Moteur du format montante / descente. Calcul PUR : aucune base, aucun reseau,
// aucun composant. Le SQL fait autorite en production (cf. la spec) ; ce module
// en est le miroir d'affichage, et le test de parite interdit la divergence.
//
// Convention : le palier le plus ELEVE est le terrain le plus fort. On monte
// vers le palier N.

export type TeamState = { id: string; level: number; withdrawn: boolean };

export type Match = {
  round: number;
  court: number;
  teamA: string | null;   // null = bye
  teamB: string | null;
  gamesA: number;
  gamesB: number;
  confirmed: boolean;
};

export type Standing = {
  teamId: string;
  played: number;
  gamesWon: number;
  gamesLost: number;
  diff: number;
  highestCourt: number;
  /** Departage a la confrontation directe : jeux pris aux AUTRES binomes du
   *  meme groupe d ex aequo, moins les jeux concedes a ces memes binomes.
   *  Scalaire, donc ordre total. 0 quand le binome est seul dans son groupe. */
  h2h: number;
  rank: number;
};

/** Deux equipes par terrain, la paire la plus forte au terrain le plus haut. */
export function initialCourts(teams: TeamState[]): Map<string, number> {
  if (teams.length % 2 !== 0) {
    throw new Error('Un tournoi demarre avec un nombre PAIR d equipes');
  }
  const courtCount = teams.length / 2;
  const tri = [...teams].sort((x, y) => y.level - x.level || x.id.localeCompare(y.id));
  const out = new Map<string, number>();
  tri.forEach((t, i) => out.set(t.id, courtCount - Math.floor(i / 2)));
  return out;
}

/** Oppose les equipes d un meme terrain.
 *
 *  Un terrain porte 1, 2 ou 3 equipes -- jamais plus. Preuve : un terrain
 *  recoit au plus le perdant du terrain du dessus, au plus le gagnant du
 *  terrain du dessous, et garde au plus une equipe qui vient d y faire un bye.
 *  Un forfait (ou un nombre impair d equipes) cree les paliers a 1 et a 3.
 *
 *  Regle du bye : si le terrain porte un nombre IMPAIR d equipes, le bye va a
 *  celle qui en a eu le MOINS jusqu ici, l id departageant a egalite ; les
 *  autres se rencontrent. AUCUNE equipe n est jamais laissee de cote. */
export function pairUp(courts: Map<string, number>, byeCount: Map<string, number>): Match[] {
  const parTerrain = new Map<number, string[]>();
  for (const [id, c] of courts) {
    if (!parTerrain.has(c)) parTerrain.set(c, []);
    parTerrain.get(c)!.push(id);
  }
  const out: Match[] = [];
  for (const [court, ids] of [...parTerrain.entries()].sort((a, b) => b[0] - a[0])) {
    // Ordre stable : a byes egaux, l id tranche — jamais l ordre d insertion,
    // pour que TypeScript et SQL produisent le meme appariement.
    const tri = [...ids].sort((x, y) =>
      (byeCount.get(x) ?? 0) - (byeCount.get(y) ?? 0) || x.localeCompare(y));
    // Nombre impair : le bye d abord, a l equipe qui en a eu le moins. Une
    // version precedente appariait tri[0]/tri[1] et abandonnait tri[2] en
    // SILENCE — une paire plantee sur un terrain sans adversaire, absente du
    // tableau du tour. C etait un bug de classement autant que de terrain.
    // Un palier a plus de 3 equipes est IMPOSSIBLE (cf. la demonstration
    // ci-dessus). Si ca arrive quand meme, c est que l echelle est corrompue
    // en amont : on hurle. La version d avant en aurait abandonne une en
    // silence, ce qui est la facon la plus sure de ne jamais trouver le bug.
    if (tri.length > 3) {
      throw new Error(
        `Echelle corrompue : le palier ${court} porte ${tri.length} equipes (max 3)`);
    }
    const impair = tri.length % 2 === 1;
    if (impair) {
      out.push({ round: 0, court, teamA: tri[0], teamB: null, gamesA: 0, gamesB: 0, confirmed: false });
    }
    const reste = impair ? tri.slice(1) : tri;
    if (reste.length >= 2) {
      out.push({ round: 0, court, teamA: reste[0], teamB: reste[1], gamesA: 0, gamesB: 0, confirmed: false });
    }
  }
  return out;
}

/** Gagnant +1, perdant -1, borne aux extremites. Un bye ne bouge pas. */
export function nextCourts(
  courts: Map<string, number>, matches: Match[], courtCount: number,
): Map<string, number> {
  const out = new Map(courts);
  for (const m of matches) {
    if (m.teamA == null || m.teamB == null) continue;      // bye : sur place
    // Un match de padel ne peut pas etre nul. gamesA === gamesB est un etat
    // qui ne devrait jamais arriver (valide en amont, pas ici) ; si il
    // survenait quand meme, ce test le traite comme une victoire de B —
    // choix explicite, pas un oubli.
    const aGagne = m.gamesA > m.gamesB;
    const gagnant = aGagne ? m.teamA : m.teamB;
    const perdant = aGagne ? m.teamB : m.teamA;
    out.set(gagnant, Math.min(courtCount, m.court + 1));
    out.set(perdant, Math.max(1, m.court - 1));
  }
  return out;
}

/** Le dernier tour dont TOUS les matchs reels sont confirmes ; 0 si meme le
 *  tour 1 est inacheve. Les byes ne comptent pas : personne ne peut les
 *  confirmer.
 *
 *  Sert a arreter une soiree qui deborde SANS rien detruire : on borne le
 *  classement a ce tour au lieu de compter un tour a moitie joue, ce qui
 *  egalise les nombres de matchs. `tournament_close` fait exactement pareil
 *  cote serveur, en prenant le PREMIER tour incomplet moins un. */
export function lastCompleteRound(matches: Match[]): number {
  const reels = matches.filter(m => m.teamA != null && m.teamB != null);
  const inacheves = reels.filter(m => !m.confirmed).map(m => m.round);
  if (inacheves.length > 0) return Math.min(...inacheves) - 1;
  return reels.reduce((acc, m) => Math.max(acc, m.round), 0);
}

/** Classement aux jeux gagnes. Departages successifs : difference de jeux,
 *  puis confrontation directe, puis palier le plus haut atteint, puis l id.
 *
 *  La confrontation directe est un SCALAIRE, pas un comparateur : pour chaque
 *  binome, les jeux pris aux AUTRES binomes de son groupe d ex aequo moins
 *  les jeux qu il leur a concedes, sur TOUTES leurs rencontres. Le groupe
 *  d ex aequo est l ensemble des binomes que les deux premieres cles n ont
 *  pas departages (memes jeux gagnes ET meme difference).
 *
 *  Pourquoi un scalaire. La version precedente comparait deux a deux, ce qui
 *  coincide avec le scalaire pour un groupe de DEUX mais diverge des trois :
 *  m bat n, n bat a, a bat m, tous 6-2, laisse un cycle. Un comparateur
 *  circulaire n est pas un ordre total, et `Array.prototype.sort` n a alors
 *  aucun resultat defini — le SQL et le TypeScript rendaient deux classements
 *  differents sur la meme soiree. Le scalaire est transitif par construction.
 *
 *  `maxRound` borne le classement aux tours <= a cette valeur (cf.
 *  `lastCompleteRound`). Sans lui, tous les matchs confirmes comptent. */
export function standings(
  teams: TeamState[], matches: Match[], maxRound?: number,
): Standing[] {
  const base = new Map<string, Standing>();
  for (const t of teams) {
    base.set(t.id, {
      teamId: t.id, played: 0, gamesWon: 0, gamesLost: 0,
      diff: 0, highestCourt: 0, h2h: 0, rank: 0,
    });
  }
  const joues = matches.filter(m =>
    m.confirmed && m.teamA != null && m.teamB != null &&
    (maxRound === undefined || m.round <= maxRound));
  for (const m of joues) {
    const a = base.get(m.teamA!); const b = base.get(m.teamB!);
    if (a) {
      a.played++; a.gamesWon += m.gamesA; a.gamesLost += m.gamesB;
      a.highestCourt = Math.max(a.highestCourt, m.court);
    }
    if (b) {
      b.played++; b.gamesWon += m.gamesB; b.gamesLost += m.gamesA;
      b.highestCourt = Math.max(b.highestCourt, m.court);
    }
  }
  for (const s of base.values()) s.diff = s.gamesWon - s.gamesLost;

  // Le groupe d ex aequo : memes jeux gagnes ET meme difference. C est
  // exactement ce que le SQL isole avec dense_rank() sur ces deux cles.
  const groupe = new Map<string, string>();
  for (const s of base.values()) groupe.set(s.teamId, `${s.gamesWon}|${s.diff}`);

  // Le scalaire de confrontation directe. Somme sur TOUTES les rencontres
  // internes au groupe : jamais la premiere trouvee, sinon le resultat
  // dependrait de l ordre d arrivee des matchs, que rien ne garantit — ni
  // cote TypeScript, ni cote SQL sans ORDER BY.
  for (const m of joues) {
    const a = base.get(m.teamA!); const b = base.get(m.teamB!);
    if (!a || !b) continue;
    if (groupe.get(a.teamId) !== groupe.get(b.teamId)) continue;
    a.h2h += m.gamesA - m.gamesB;
    b.h2h += m.gamesB - m.gamesA;
  }

  const out = [...base.values()].sort((x, y) =>
    y.gamesWon - x.gamesWon ||
    y.diff - x.diff ||
    y.h2h - x.h2h ||
    y.highestCourt - x.highestCourt ||
    x.teamId.localeCompare(y.teamId));
  out.forEach((s, i) => { s.rank = i + 1; });
  return out;
}
