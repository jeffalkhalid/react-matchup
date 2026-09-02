// lib/tournament.ts
// Moteur du format montante / descente. Calcul PUR : aucune base, aucun reseau,
// aucun composant. Le SQL fait autorite en production (cf. la spec) ; ce module
// en est le miroir d'affichage, et le test de parite interdit la divergence.
//
// Convention : le Terrain 1 est le terrain le plus fort. On monte vers le
// Terrain 1 (numero qui DIMINUE) en gagnant, on descend (numero qui augmente)
// en perdant.

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
  wins: number;
  gamesWon: number;
  gamesLost: number;
  diff: number;
  /** Meilleur terrain jamais atteint, min sur tous les matchs reels joues :
   *  le Terrain 1 etant le plus fort, PLUS PETIT est MEILLEUR. Sentinelle
   *  Infinity pour un binome qui n a joue aucun match reel -- il ne doit pas
   *  se retrouver artificiellement premier faute d avoir jamais ete note. */
  bestCourt: number;
  /** Departage a la confrontation directe : jeux pris aux AUTRES binomes du
   *  meme groupe d ex aequo, moins les jeux concedes a ces memes binomes.
   *  Scalaire, donc ordre total. 0 quand le binome est seul dans son groupe. */
  h2h: number;
  rank: number;
};

/** Une entree du classement final (derniere rotation), qui ne fait plus
 *  monter ni descendre mais classe directement d apres le resultat du
 *  dernier tour joue. */
export type FinalRankEntry = { rank: number; teamId: string };

/** Deux equipes par terrain, la paire la plus forte au Terrain 1. */
export function initialCourts(teams: TeamState[]): Map<string, number> {
  if (teams.length % 2 !== 0) {
    throw new Error('Un tournoi demarre avec un nombre PAIR d equipes');
  }
  const tri = [...teams].sort((x, y) => y.level - x.level || x.id.localeCompare(y.id));
  const out = new Map<string, number>();
  tri.forEach((t, i) => out.set(t.id, Math.floor(i / 2) + 1));
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

/** Gagnant -1 (vers le Terrain 1), perdant +1 (vers le dernier terrain),
 *  borne aux extremites. Un bye ne bouge pas. */
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
    out.set(gagnant, Math.max(1, m.court - 1));
    out.set(perdant, Math.min(courtCount, m.court + 1));
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

/** Classement au palier. Departages successifs : nombre de victoires,
 *  difference de jeux, jeux gagnes, puis confrontation directe, puis l id.
 *
 *  Le palier (`bestCourt`) prime sur tout le reste : le Terrain 1 etant le
 *  plus fort, un binome qui l a atteint devance TOUJOURS un binome qui ne l a
 *  pas atteint, quels que soient ses jeux ou ses victoires ailleurs.
 *
 *  La confrontation directe est un SCALAIRE, pas un comparateur : pour chaque
 *  binome, les jeux pris aux AUTRES binomes de son groupe d ex aequo moins
 *  les jeux qu il leur a concedes, sur TOUTES leurs rencontres. Le groupe
 *  d ex aequo est l ensemble des binomes que les cles precedentes n ont pas
 *  departages (memes victoires, meme difference, memes jeux gagnes).
 *
 *  Pourquoi un scalaire. La version precedente comparait deux a deux, ce qui
 *  coincide avec le scalaire pour un groupe de DEUX mais diverge des trois :
 *  m bat n, n bat a, a bat m, tous 6-2, laisse un cycle. Un comparateur
 *  circulaire n est pas un ordre total, et `Array.prototype.sort` n a alors
 *  aucun resultat defini — le SQL et le TypeScript rendaient deux classements
 *  differents sur la meme soiree. Le scalaire est transitif par construction.
 *
 *  Un bye (`teamA` ou `teamB` null) n est ni une victoire ni une defaite, ne
 *  rapporte aucun jeu et ne compte pas comme un match joue : il est exclu de
 *  `joues` au meme titre qu un match non confirme.
 *
 *  `maxRound` borne le classement aux tours <= a cette valeur (cf.
 *  `lastCompleteRound`). Sans lui, tous les matchs confirmes comptent. */
export function standings(
  teams: TeamState[], matches: Match[], maxRound?: number,
): Standing[] {
  const base = new Map<string, Standing>();
  for (const t of teams) {
    base.set(t.id, {
      teamId: t.id, played: 0, wins: 0, gamesWon: 0, gamesLost: 0,
      diff: 0, bestCourt: Infinity, h2h: 0, rank: 0,
    });
  }
  const joues = matches.filter(m =>
    m.confirmed && m.teamA != null && m.teamB != null &&
    (maxRound === undefined || m.round <= maxRound));
  for (const m of joues) {
    const aGagne = m.gamesA > m.gamesB;
    const a = base.get(m.teamA!); const b = base.get(m.teamB!);
    if (a) {
      a.played++; a.gamesWon += m.gamesA; a.gamesLost += m.gamesB;
      a.bestCourt = Math.min(a.bestCourt, m.court);
      if (aGagne) a.wins++;
    }
    if (b) {
      b.played++; b.gamesWon += m.gamesB; b.gamesLost += m.gamesA;
      b.bestCourt = Math.min(b.bestCourt, m.court);
      if (!aGagne) b.wins++;
    }
  }
  for (const s of base.values()) s.diff = s.gamesWon - s.gamesLost;

  // Le groupe d ex aequo : meme palier, memes victoires, meme difference ET
  // memes jeux gagnes -- exactement les quatre cles qui precedent la h2h
  // dans la hierarchie. C est ce que le SQL isole avec dense_rank() sur ces
  // quatre cles.
  const groupe = new Map<string, string>();
  for (const s of base.values())
    groupe.set(s.teamId, `${s.bestCourt}|${s.wins}|${s.diff}|${s.gamesWon}`);

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
    x.bestCourt - y.bestCourt ||
    y.wins - x.wins ||
    y.diff - x.diff ||
    y.gamesWon - x.gamesWon ||
    y.h2h - x.h2h ||
    x.teamId.localeCompare(y.teamId));
  out.forEach((s, i) => { s.rank = i + 1; });
  return out;
}

/** Classement direct de la derniere rotation : elle ne fait plus monter ni
 *  descendre, elle classe. Pour chaque terrain, du Terrain 1 au dernier : le
 *  gagnant prend le rang (terrain-1)*2+1, son perdant (terrain-1)*2+2. Ces
 *  deux rangs sont des CRENEAUX FIXES par terrain, pas un compteur qui
 *  avance au fil des resultats : ainsi un terrain sans adversaire (bye) ne
 *  decale jamais les rangs des terrains suivants, il laisse seulement son
 *  propre creneau de perdant vacant.
 *
 *  Ne regarde que le DERNIER tour present dans `matches` (le maximum de
 *  `round`) : c est a l appelant de fournir les matchs de la rotation finale,
 *  mais filtrer ici plutot que de supposer un tableau deja propre evite
 *  qu un historique complet, passe par erreur, ne fausse le resultat. */
export function finalRanking(matches: Match[], courtCount: number): FinalRankEntry[] {
  const maxRound = matches.reduce((acc, m) => Math.max(acc, m.round), 0);
  const parTerrain = new Map<number, Match>();
  for (const m of matches) {
    if (m.round === maxRound) parTerrain.set(m.court, m);
  }
  const out: FinalRankEntry[] = [];
  for (let court = 1; court <= courtCount; court++) {
    const m = parTerrain.get(court);
    if (!m) continue;
    const base = (court - 1) * 2;
    if (m.teamA != null && m.teamB != null) {
      const aGagne = m.gamesA > m.gamesB;
      out.push({ rank: base + 1, teamId: aGagne ? m.teamA : m.teamB });
      out.push({ rank: base + 2, teamId: aGagne ? m.teamB : m.teamA });
    } else if (m.teamA != null) {
      out.push({ rank: base + 1, teamId: m.teamA });
    } else if (m.teamB != null) {
      out.push({ rank: base + 1, teamId: m.teamB });
    }
  }
  return out;
}
