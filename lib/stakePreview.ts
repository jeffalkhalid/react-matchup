// lib/stakePreview.ts — ce que la mise change vraiment, avant de publier.
//
// L'assistant annonçait « Points ELO gagnés/perdus : ×2 ». Multiplié par quoi,
// personne ne le savait : le mouvement dépend surtout du niveau adverse et de
// SA PROPRE fiabilité, pas du multiplicateur.
//
// On ne devine rien : `simulateElo` est la réplique fidèle du trigger serveur
// qui distribue les points à la validation. On lui donne la configuration
// réelle et on lit le résultat.
//
// Exprimé en NIVEAU et non en points ELO : « +34 ELO » ne dit rien à un
// joueur de padel, « 5,41 → 5,55 » se comprend d'un coup d'œil.
import { simulateElo, type EloPlayerInput } from './elo';
import { eloToLevel, padelLevelToElo } from './theme';

/** Ce qu'il faut savoir d'un joueur pour simuler — tout vient de sa fiche. */
export interface StakePlayer {
  id: string;
  elo_score: number;
  win_count?: number | null;
  loss_count?: number | null;
  last_match_at?: string | null;
  fiability_pct?: number | null;
}

/**
 * Les deux manières de gagner qui bornent la fourchette.
 *
 * La marge au score pèse lourd — un 6-0 6-0 ajoute 50 %, un tie-break serré
 * retire 20 %. Même en connaissant les quatre joueurs, le résultat reste donc
 * une fourchette, et c'est honnête de le montrer ainsi.
 */
const SERRE = '7-6, 7-6';
const LARGE = '6-0, 6-0';

export interface StakeOutcome {
  /** Mon niveau actuel. */
  level: number;
  /** Variation de niveau si mon camp gagne — du plus petit au plus grand. */
  winMin: number;
  winMax: number;
  /** Variation si mon camp perd — négatives, de la plus petite à la plus grande. */
  loseMin: number;
  loseMax: number;
}

/**
 * Ce qu'on suppose d'un joueur dont on n'a que le niveau.
 *
 * Des compteurs a zero feraient croire a une PHASE DE PLACEMENT (K=85, quatre
 * premiers matchs) et tripleraient la projection ; une fiabilite a zero ferait
 * bondir le K de la meme facon. On suppose donc un joueur etabli et moyen.
 * `??` ne se declenche que sur une valeur absente : un vrai debutant, lui,
 * arrive avec un 0 explicite et garde son traitement de placement.
 */
const MATCHS_SUPPOSES = 10;
const FIABILITE_SUPPOSEE = 70;

const joueur = (p: StakePlayer, isWinner: boolean): EloPlayerInput => ({
  id: p.id,
  name: p.id,
  elo_score: p.elo_score,
  win_count: p.win_count ?? MATCHS_SUPPOSES,
  loss_count: p.loss_count ?? MATCHS_SUPPOSES,
  last_match_at: p.last_match_at ?? null,
  fiability_pct: p.fiability_pct ?? FIABILITE_SUPPOSEE,
  isWinner,
});

/** La variation de MON niveau sur une issue et une marge données. */
function variation(
  me: StakePlayer, partner: StakePlayer, opponents: StakePlayer[],
  jeGagne: boolean, score: string, stake: number,
): number {
  const res = simulateElo(
    [
      joueur(me, jeGagne), joueur(partner, jeGagne),
      ...opponents.map(o => joueur(o, !jeGagne)),
    ],
    score,
    stake,
  );
  const moi = res.players.find(p => p.id === me.id);
  if (!moi) return 0;
  return eloToLevel(moi.newElo) - eloToLevel(moi.oldElo);
}

/**
 * Ce que la mise me fait gagner ou perdre, en niveau.
 *
 * `opponents` vides ou incomplets → `null` : on préfère ne rien annoncer
 * plutôt qu'un chiffre calculé sur un adversaire inventé.
 */
export function stakeOutcome(
  me: StakePlayer | null | undefined,
  partner: StakePlayer | null | undefined,
  opponents: StakePlayer[],
  stake: number,
): StakeOutcome | null {
  if (!me || !partner || opponents.length !== 2) return null;

  const gains = [SERRE, LARGE].map(s => variation(me, partner, opponents, true, s, stake));
  const pertes = [SERRE, LARGE].map(s => variation(me, partner, opponents, false, s, stake));

  return {
    level: eloToLevel(me.elo_score),
    winMin: Math.min(...gains),
    winMax: Math.max(...gains),
    loseMin: Math.max(...pertes),   // la moins lourde (plus proche de 0)
    loseMax: Math.min(...pertes),   // la plus lourde
  };
}

/**
 * Défi OUVERT : l'adversaire est inconnu, on ne connaît que la bande de
 * niveau. On simule les deux extrêmes de cette bande et on garde l'enveloppe —
 * une vraie fourchette, pas une formule inventée.
 */
export function stakeOutcomeForBand(
  me: StakePlayer | null | undefined,
  partner: StakePlayer | null | undefined,
  minLevel: number,
  maxLevel: number,
  stake: number,
): StakeOutcome | null {
  if (!me || !partner) return null;
  const paire = (niveau: number): StakePlayer[] => {
    const elo = padelLevelToElo(niveau);
    return [
      { id: '_adv1', elo_score: elo, win_count: 10, loss_count: 10, fiability_pct: 70 },
      { id: '_adv2', elo_score: elo, win_count: 10, loss_count: 10, fiability_pct: 70 },
    ];
  };
  const bas = stakeOutcome(me, partner, paire(minLevel), stake);
  const haut = stakeOutcome(me, partner, paire(maxLevel), stake);
  if (!bas || !haut) return bas ?? haut;
  return {
    level: bas.level,
    winMin: Math.min(bas.winMin, haut.winMin),
    winMax: Math.max(bas.winMax, haut.winMax),
    loseMin: Math.max(bas.loseMin, haut.loseMin),
    loseMax: Math.min(bas.loseMax, haut.loseMax),
  };
}

/** « +0,14 » · « −0,21 ». Virgule décimale, signe toujours visible. */
export function formatLevelDelta(delta: number): string {
  const signe = delta > 0 ? '+' : delta < 0 ? '−' : '';
  return `${signe}${Math.abs(delta).toFixed(2).replace('.', ',')}`;
}

/** « +0,14 à +0,21 », ou une seule valeur quand les deux bouts se rejoignent. */
export function formatLevelRange(a: number, b: number): string {
  const min = formatLevelDelta(a);
  const max = formatLevelDelta(b);
  return min === max ? min : `${min} à ${max}`;
}
