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
  /** Le binome qui a DECLARE FORFAIT sur ce match, quand il y en a un.
   *  Miroir de `tournament_matches.forfeited_team`. Optionnel : un match
   *  ordinaire ne le porte pas, et tout le code existant continue de
   *  compiler. */
  forfeitedTeam?: string | null;
};

/** QUI A GAGNE — l unique endroit ou le vainqueur se decide, exactement comme
 *  `fn_tournament_a_won(forfeited_team, team_a, games_a, games_b)` cote SQL.
 *
 *  ON SE FIE AU MARQUEUR, JAMAIS AU SCORE. Un forfait s inscrit a EGALITE
 *  (0-0 par defaut, cf. `tournaments.forfeit_games`) : re-deduire le vainqueur
 *  des jeux rendrait « B gagne » a tous les coups, y compris quand c est B qui
 *  a declare forfait — et ferait alors MONTER le forfaitaire.
 *
 *  Hors forfait, la regle reste `gamesA > gamesB`. Une egalite — que
 *  `tournament_enter_score` refuse en amont (`draw_not_allowed`) — tombe donc
 *  du cote de B : choix explicite des deux cotes, pas un oubli. */
export function aWon(m: Match): boolean {
  if (m.forfeitedTeam != null) return m.forfeitedTeam !== m.teamA;
  return m.gamesA > m.gamesB;
}

export type Standing = {
  teamId: string;
  /** Le binome a quitte la soiree. PREMIERE cle du tri, avant meme le palier :
   *  un binome parti passe derriere tous ceux qui ont fini. Miroir de
   *  `tournament_teams.withdrawn`, remonte tel quel par
   *  `tournament_standings`. */
  withdrawn: boolean;
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
    // Match non confirme : l equipe RESTE ou elle est. C est ce que fait
    // `fn_tournament_ladder` (`confirmed_at IS NOT NULL`) ; sans ce garde,
    // le defaut `0-0` d un match pas encore joue vaudrait « B gagne » et
    // ferait descendre une equipe sur un match que personne n a joue.
    if (!m.confirmed) continue;
    // Un match de padel ne peut pas etre nul. gamesA === gamesB est un etat
    // qui ne devrait jamais arriver (valide en amont, pas ici) ; si il
    // survenait quand meme, `aWon` le traite comme une victoire de B —
    // choix explicite, pas un oubli. Le FORFAIT, lui, se lit au marqueur.
    const aGagne = aWon(m);
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

/** Classement au palier. Departages successifs : l ABANDON (`withdrawn`), le
 *  palier (`bestCourt`), le nombre de victoires, la difference de jeux, les
 *  jeux gagnes, puis la confrontation directe, puis l id.
 *
 *  L ABANDON PASSE AVANT LE PALIER, et c est la seule cle au-dessus de lui.
 *  Un binome parti garde le meilleur palier de son passage, donc un tres bon
 *  rang s il est parti de haut : sans cette cle il devancait des binomes qui
 *  ont joue toute la soiree. Il descend en bas IMMEDIATEMENT, a l ecran,
 *  pendant la soiree — pas seulement a la cloture. C est ce qui garde UNE
 *  SEULE source de verite entre le classement affiche et le classement fige.
 *  `tournament_standings` trie sur la meme cle, en premier lui aussi.
 *
 *  Le palier (`bestCourt`) prime sur tout le reste : le Terrain 1 etant le
 *  plus fort, un binome qui l a atteint devance TOUJOURS un binome qui ne l a
 *  pas atteint, quels que soient ses jeux ou ses victoires ailleurs.
 *
 *  La confrontation directe est un SCALAIRE, pas un comparateur : pour chaque
 *  binome, les jeux pris aux AUTRES binomes de son groupe d ex aequo moins
 *  les jeux qu il leur a concedes, sur TOUTES leurs rencontres. Le groupe
 *  d ex aequo est l ensemble des binomes que les cles precedentes n ont pas
 *  departages (meme statut d abandon, meme palier, memes victoires, meme
 *  difference, memes jeux gagnes) : un troisieme binome qui ne partagerait que la difference et les
 *  jeux gagnes, sans etre au meme palier ni avoir le meme nombre de
 *  victoires, n en fait PAS partie -- sinon un de ses matchs, sans rapport
 *  avec le duel des deux binomes reellement lies, polluerait leur agregat et
 *  pourrait inverser leur ordre (cf. le test de non-regression correspondant).
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
      teamId: t.id, withdrawn: t.withdrawn, played: 0, wins: 0,
      gamesWon: 0, gamesLost: 0,
      diff: 0, bestCourt: Infinity, h2h: 0, rank: 0,
    });
  }
  const joues = matches.filter(m =>
    m.confirmed && m.teamA != null && m.teamB != null &&
    (maxRound === undefined || m.round <= maxRound));
  for (const m of joues) {
    const aGagne = aWon(m);
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

  // Le groupe d ex aequo : meme statut d abandon, meme palier, memes
  // victoires, meme difference ET memes jeux gagnes -- exactement les cinq
  // cles qui precedent la h2h dans la hierarchie. C est ce que le SQL isole
  // avec dense_rank() sur ces memes cles. Un binome parti et un binome
  // present ne sont donc JAMAIS dans le meme groupe : leur eventuelle
  // rencontre n a plus a les departager, l abandon l a fait.
  const groupe = new Map<string, string>();
  for (const s of base.values())
    groupe.set(s.teamId,
      `${s.withdrawn}|${s.bestCourt}|${s.wins}|${s.diff}|${s.gamesWon}`);

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
    Number(x.withdrawn) - Number(y.withdrawn) ||
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
 *  descendre, elle CLASSE. Pour chaque terrain, du Terrain 1 au dernier : le
 *  gagnant prend le CRENEAU (terrain-1)*2+1, son perdant (terrain-1)*2+2. Ces
 *  deux creneaux sont FIXES par terrain, pas un compteur qui avance au fil des
 *  resultats : ainsi un terrain sans adversaire (bye) ne decale jamais les
 *  creneaux des terrains suivants, il laisse seulement son propre creneau de
 *  perdant vacant. Un terrain absent de `matches` laisse ses DEUX creneaux
 *  vacants, meme traitement.
 *
 *  MAIS LE CRENEAU N EST PAS LE RANG. Les creneaux vacants sont REFERMES par
 *  une renumerotation contigue 1..N, exactement comme
 *  `fn_tournament_final_slots` : un bareme qui va du rang 1 au rang 8 ne peut
 *  pas sauter le rang 4 — ces points ne seraient jamais attribues et tous les
 *  rangs suivants recevraient moins que leur du. Les creneaux ne servent qu a
 *  ORDONNER ; le rang se COMPTE. Une version precedente rendait les creneaux
 *  BRUTS, et son test affirmait `[1,2,3,5,6,7,8]` : c etait la regle d avant.
 *
 *  UN MATCH REEL NON CONFIRME OCCUPE SES DEUX CRENEAUX sans les remplir : on
 *  ne sait pas encore qui prendra ces places, mais elles sont disputees, donc
 *  elles ne se referment pas. Le SQL fait pareil (`team_id` NULL, cas normal a
 *  la GENERATION du tour) ; ici ces creneaux comptent dans la renumerotation
 *  et ne produisent simplement aucune entree. Sans ce garde, le defaut
 *  `gamesA: 0, gamesB: 0` d un match pas encore joue rendrait `0 > 0` faux et
 *  declarerait le binome B gagnant en silence. Un bye n a rien a confirmer
 *  (cf. `lastCompleteRound`) : lui seul ignore `confirmed`.
 *
 *  UN PALIER A TROIS EQUIPES (possible apres un forfait) porte un match ET un
 *  bye. C est le MATCH qui prend les deux creneaux du terrain — le SQL le dit
 *  par `row_number() ... ORDER BY (team_b IS NOT NULL) DESC` — et le binome du
 *  bye repart dans les NON-PLACES. La version precedente ecrasait sa `Map` par
 *  terrain et retenait la DERNIERE ligne rencontree : le classement dependait
 *  de l ordre du tableau, donc n etait pas defini.
 *
 *  `provisional` — le classement provisoire, c est-a-dire la sortie de
 *  `standings(teams, matches, lastCompleteRound(...))`, exactement ce que le
 *  SQL lit dans `st`. Optionnel, et c est lui qui apporte les deux dernieres
 *  regles :
 *    * UN BINOME PARTI N OCCUPE JAMAIS UN CRENEAU. Un forfait prononce APRES
 *      la generation de la rotation le laisse dans le tableau du tour, et
 *      `aWon` le declare perdant : il prendrait le creneau PERDANT de son
 *      terrain — le rang 2 sur 8 s il etait au Terrain 1 — alors que l ecran
 *      l a montre DERNIER toute la soiree. Son creneau devient vacant, la
 *      renumerotation le referme, et le creneau du VAINQUEUR n est pas touche.
 *    * LES NON-PLACES suivent, dans l ordre du classement provisoire, apres le
 *      plus grand creneau attribue. Le provisoire trie deja les binomes partis
 *      en dernier, sur sa premiere cle : inutile de le refaire ici.
 *  Sans `provisional`, la fonction ne connait que les binomes du tableau : ni
 *  abandon, ni non-places — l ancien comportement, renumerotation comprise.
 *
 *  Ne regarde que le DERNIER tour present dans `matches` (le maximum de
 *  `round`) : c est a l appelant de fournir les matchs de la rotation finale,
 *  mais filtrer ici plutot que de supposer un tableau deja propre evite qu un
 *  historique complet, passe par erreur, ne fausse le resultat. */
export function finalRanking(
  matches: Match[], courtCount: number, provisional?: Standing[],
): FinalRankEntry[] {
  const maxRound = matches.reduce((acc, m) => Math.max(acc, m.round), 0);
  const partis = new Set((provisional ?? []).filter(s => s.withdrawn).map(s => s.teamId));

  // `fr` du SQL : une ligne par terrain, le MATCH prioritaire sur le bye.
  const parTerrain = new Map<number, Match>();
  for (const m of matches) {
    if (m.round !== maxRound) continue;
    const prec = parTerrain.get(m.court);
    if (prec === undefined || (prec.teamB == null && m.teamB != null)) {
      parTerrain.set(m.court, m);
    }
  }

  // `bruts` puis `places` du SQL : le creneau, et le binome quand il est
  // connu. Un binome parti est ECARTE ; un creneau encore indecis (null)
  // traverse, il n y a rien a exclure.
  type Creneau = { slot: number; teamId: string | null };
  const places: Creneau[] = [];
  const engages = new Set<string>();
  const garde = (c: Creneau) => {
    if (c.teamId != null && partis.has(c.teamId)) return;
    places.push(c);
  };
  for (let court = 1; court <= courtCount; court++) {
    const m = parTerrain.get(court);
    if (!m) continue;
    const base = (court - 1) * 2;
    if (m.teamB != null) {
      const a = m.confirmed ? aWon(m) : null;
      garde({ slot: base + 1, teamId: a === null ? null : (a ? m.teamA : m.teamB) });
      garde({ slot: base + 2, teamId: a === null ? null : (a ? m.teamB : m.teamA) });
      // `engages` porte sur le TABLEAU du tour, pas sur le resultat : un
      // binome dont le match n est pas acquis a bien un creneau, il n est
      // donc pas non-place. Les binomes partis en sont exclus, comme
      // ci-dessus : leur creneau n existe pas, ils doivent tomber dans les
      // non-places.
      for (const t of [m.teamA, m.teamB]) if (t != null && !partis.has(t)) engages.add(t);
    } else if (m.teamA != null) {
      // Un bye SEUL sur son palier dispute la MEILLEURE des deux places du
      // terrain. L autre creneau reste vacant.
      garde({ slot: base + 1, teamId: m.teamA });
      if (!partis.has(m.teamA)) engages.add(m.teamA);
    }
  }

  // `plafond` : le plus grand creneau attribue, plancher de tout ce qui suit.
  // Aucun non-place ne passe devant un binome que le tour a departage sur le
  // terrain — un terrain reduit a un bye libere un creneau BAS, et c est
  // exactement la forme d echelle que produit un forfait.
  const plafond = places.reduce((acc, c) => Math.max(acc, c.slot), 0);
  const reste: Creneau[] = (provisional ?? [])
    .filter(s => !engages.has(s.teamId))
    .sort((x, y) => x.rank - y.rank)
    .map((s, i) => ({ slot: plafond + i + 1, teamId: s.teamId }));

  const attribue = [...places, ...reste].sort((x, y) => x.slot - y.slot);
  const out: FinalRankEntry[] = [];
  attribue.forEach((c, i) => {
    if (c.teamId != null) out.push({ rank: i + 1, teamId: c.teamId });
  });
  return out;
}
