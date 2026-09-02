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

/** Oppose les deux equipes d un meme terrain. Un terrain a une seule equipe
 *  (forfait de l adversaire) donne un bye. */
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
    if (tri.length === 1) {
      out.push({ round: 0, court, teamA: tri[0], teamB: null, gamesA: 0, gamesB: 0, confirmed: false });
    } else {
      out.push({ round: 0, court, teamA: tri[0], teamB: tri[1], gamesA: 0, gamesB: 0, confirmed: false });
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
    const aGagne = m.gamesA > m.gamesB;
    const gagnant = aGagne ? m.teamA : m.teamB;
    const perdant = aGagne ? m.teamB : m.teamA;
    out.set(gagnant, Math.min(courtCount, m.court + 1));
    out.set(perdant, Math.max(1, m.court - 1));
  }
  return out;
}

/** Classement aux jeux gagnes. Departages : difference de jeux, puis
 *  confrontation directe si elle a eu lieu, puis palier le plus haut atteint. */
export function standings(teams: TeamState[], matches: Match[]): Standing[] {
  const base = new Map<string, Standing>();
  for (const t of teams) {
    base.set(t.id, {
      teamId: t.id, played: 0, gamesWon: 0, gamesLost: 0,
      diff: 0, highestCourt: 0, rank: 0,
    });
  }
  const joues = matches.filter(m => m.confirmed && m.teamA != null && m.teamB != null);
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

  const directe = (x: string, y: string): number => {
    const m = joues.find(k =>
      (k.teamA === x && k.teamB === y) || (k.teamA === y && k.teamB === x));
    if (!m) return 0;
    const xEstA = m.teamA === x;
    const jx = xEstA ? m.gamesA : m.gamesB;
    const jy = xEstA ? m.gamesB : m.gamesA;
    return jy - jx;   // negatif = x devant
  };

  const out = [...base.values()].sort((x, y) =>
    y.gamesWon - x.gamesWon ||
    y.diff - x.diff ||
    directe(x.teamId, y.teamId) ||
    y.highestCourt - x.highestCourt ||
    x.teamId.localeCompare(y.teamId));
  out.forEach((s, i) => { s.rank = i + 1; });
  return out;
}
