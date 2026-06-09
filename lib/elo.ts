// Port of web lib/elo.ts — used by admin panel

// Plancher de fiabilité à 10% (clamp 10..100) → K plafonne à 59, plancher 16.
// Réplique public.elo_k_factor (elo_per_player_k.sql).
export function getKFactor(totalMatches: number, fiabilityPct?: number): number {
  if (fiabilityPct !== undefined) {
    const f = Math.min(100, Math.max(10, fiabilityPct));
    return Math.round(16 + 48 * (1 - f / 100));
  }
  if (totalMatches < 10)  return 40;
  if (totalMatches < 30)  return 32;
  if (totalMatches < 100) return 24;
  return 16;
}

// Fiabilité +5 par match, plancher 10, plafond 100.
export function getNewFiabilityPct(current: number): number {
  return Math.min(Math.max(10, current) + 5, 100);
}

export function getInactivityDecay(lastMatchAt: string | null): number {
  if (!lastMatchAt) return 1.0;
  const daysSince = (Date.now() - new Date(lastMatchAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince <= 45) return 1.0;
  const weeksExtra = Math.floor((daysSince - 45) / 7);
  return Math.max(0.85, 1 - weeksExtra * 0.01);
}

export function getMarginMultiplier(scoreText: string | null | undefined): number {
  if (!scoreText) return 1.0;
  let t1 = 0, t2 = 0;
  for (const set of scoreText.split(',')) {
    const m = set.trim().match(/^(\d+)-(\d+)$/);
    if (!m) continue;
    t1 += parseInt(m[1], 10);
    t2 += parseInt(m[2], 10);
  }
  if (t1 + t2 === 0) return 1.0;
  const diff = Math.abs(t1 - t2);
  if (diff >= 10) return 1.5;
  if (diff >= 6)  return 1.3;
  if (diff <= 2)  return 0.8;
  return 1.0;
}

function getAntiFarmMultiplier(winnerTeamElo: number, loserTeamElo: number): number {
  const diff = winnerTeamElo - loserTeamElo;
  if (diff > 300) return 0.5;
  if (diff > 150) return 0.75;
  return 1.0;
}

export function computeEloExchange(
  winnerTeamElo: number,
  loserTeamElo: number,
  winnerMatchCount = 30,
  fiabilityPct?: number,
): number {
  const expectedWin = 1 / (1 + Math.pow(10, (loserTeamElo - winnerTeamElo) / 400));
  const K = getKFactor(winnerMatchCount, fiabilityPct);
  const antiFarm = getAntiFarmMultiplier(winnerTeamElo, loserTeamElo);
  return Math.max(1, Math.round(K * (1 - expectedWin) * antiFarm));
}

export function teamElo(p1Elo: number, p2Elo?: number | null): number {
  if (p2Elo === null || p2Elo === undefined) return p1Elo;
  return (p1Elo + p2Elo) / 2;
}

export interface EloPlayerInput {
  id: string;
  name: string;
  elo_score: number;
  win_count: number;
  loss_count: number;
  last_match_at: string | null;
  fiability_pct: number;
  isWinner: boolean;
}

export interface EloSimPlayer {
  id: string;
  name: string;
  oldElo: number;
  decayFactor: number;
  decayedElo: number;
  kFactor: number;   // K propre au joueur (sur SA fiabilité)
  delta: number;     // ampleur du mouvement de CE joueur
  newElo: number;
  change: number;
  isWinner: boolean;
}

export interface EloSimResult {
  // Niveau match (communs aux 4 joueurs)
  antiFarmMultiplier: number;
  marginMultiplier: number;
  winnerTeamElo: number;
  loserTeamElo: number;
  // K et delta sont désormais PAR JOUEUR (cf. players[].kFactor / .delta)
  players: EloSimPlayer[];
}

// K-factor par joueur : chaque joueur bouge selon SA propre fiabilité.
// Réplique fidèlement le trigger public.fn_distribute_elo_on_validate
// (elo_per_player_k.sql) : attendu/anti/marge au niveau équipe, K per-joueur.
export function simulateElo(players: EloPlayerInput[], scoreText?: string | null): EloSimResult {
  const winners = players.filter(p => p.isWinner);
  const losers  = players.filter(p => !p.isWinner);

  const decayed = (p: EloPlayerInput) => {
    const f = getInactivityDecay(p.last_match_at);
    return { ...p, decayFactor: f, decayedElo: Math.round(p.elo_score * f) };
  };

  const dWinners = winners.map(decayed);
  const dLosers  = losers.map(decayed);

  const winnerTeamElo = dWinners.length === 2
    ? (dWinners[0].decayedElo + dWinners[1].decayedElo) / 2
    : dWinners[0]?.decayedElo ?? 1000;
  const loserTeamElo = dLosers.length === 2
    ? (dLosers[0].decayedElo + dLosers[1].decayedElo) / 2
    : dLosers[0]?.decayedElo ?? 1000;

  const expectedWin = 1 / (1 + Math.pow(10, (loserTeamElo - winnerTeamElo) / 400));
  const diff = winnerTeamElo - loserTeamElo;
  const antiFarmMultiplier = diff > 300 ? 0.5 : diff > 150 ? 0.75 : 1.0;
  const marginMultiplier = getMarginMultiplier(scoreText);
  // Facteur commun ; seul le K varie d'un joueur à l'autre.
  const factor = (1 - expectedWin) * antiFarmMultiplier;

  const kFor     = (fiab: number) => getKFactor(0, fiab);
  const deltaFor = (fiab: number) =>
    Math.round(Math.max(1, Math.round(kFor(fiab) * factor)) * marginMultiplier);

  const simPlayers: EloSimPlayer[] = [
    ...dWinners.map(p => {
      const kFactor = kFor(p.fiability_pct);
      const delta   = deltaFor(p.fiability_pct);
      const newElo  = p.decayedElo + delta;
      return {
        id: p.id, name: p.name, oldElo: p.elo_score,
        decayFactor: p.decayFactor, decayedElo: p.decayedElo,
        kFactor, delta, newElo, change: newElo - p.elo_score, isWinner: true,
      };
    }),
    ...dLosers.map(p => {
      const kFactor = kFor(p.fiability_pct);
      const delta   = deltaFor(p.fiability_pct);
      const newElo  = Math.max(100, p.decayedElo - delta);
      return {
        id: p.id, name: p.name, oldElo: p.elo_score,
        decayFactor: p.decayFactor, decayedElo: p.decayedElo,
        kFactor, delta, newElo, change: newElo - p.elo_score, isWinner: false,
      };
    }),
  ];

  return { antiFarmMultiplier, marginMultiplier, winnerTeamElo, loserTeamElo, players: simPlayers };
}
