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
import { clashPlayersFrom, type ClashCreator, type ClashParticipant, type ClashPlayer } from './weekendClash';
import { occupiesSpot } from './games';

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

// ── Ce que CE match met en jeu, pour MOI ────────────────────────────────────
//
// Le chiffre n'est jamais le même pour deux joueurs du même match, et c'est
// voulu : il dépend de l'écart entre les deux camps — commun aux coéquipiers —
// ET du coefficient personnel, qui suit le nombre de matchs et la fiabilité.
// Un joueur en phase de placement bouge bien plus, sur exactement le même
// match. Chacun voit donc SON chiffre.
//
// Les quatre joueurs viennent de `clashPlayersFrom` (lib/weekendClash), source
// unique : le créateur n'a PAS de ligne `game_participants`, il vit sur
// `creator_id` + `creator_side`. Une lecture maison des participants seuls
// donnerait trois joueurs sur quatre — donc jamais deux contre deux, donc
// aucun chiffre sur une partie pourtant complète.

/** Ce qu'il faut savoir d'une partie pour projeter son enjeu. */
export interface StakeGame extends ClashCreator {
  participants?: ClashParticipant[] | null;
  game_format?: string | null;
  stake_multiplier?: number | null;
  min_elo?: number | null;
  max_elo?: number | null;
}

export interface StakeSides {
  /**
   * Mon coéquipier, ou `null` quand mon camp ne compte que moi.
   *
   * C'est le cas courant d'un défi reçu : on est invité seul, le binôme reste
   * à trouver. Refuser de rendre les camps dans ce cas privait la carte du
   * seul chiffre qui aide à décider s'il faut relever — celui de l'enjeu.
   */
  partner: StakePlayer | null;
  opponents: StakePlayer[];
}

/** Ce qu'on annonce, et si c'est exact ou une fourchette. */
export interface StakeProjection {
  outcome: StakeOutcome;
  /** `false` = il manque un joueur, on a raisonné sur la bande de niveau. */
  exact: boolean;
}

const toStake = (p: ClashPlayer): StakePlayer | null =>
  p.elo == null ? null : { id: p.id, elo_score: p.elo, win_count: p.wins, loss_count: p.losses };

/** Un joueur supposé, dont on ne connaît que le niveau. */
const suppose = (id: string, elo: number): StakePlayer =>
  ({ id, elo_score: elo, win_count: MATCHS_SUPPOSES, loss_count: MATCHS_SUPPOSES, fiability_pct: FIABILITE_SUPPOSEE });

/** L'enveloppe de deux projections — le meilleur gain, la pire perte. */
function enveloppe(a: StakeOutcome | null, b: StakeOutcome | null): StakeOutcome | null {
  if (!a || !b) return a ?? b;
  return {
    level: a.level,
    winMin: Math.min(a.winMin, b.winMin),
    winMax: Math.max(a.winMax, b.winMax),
    loseMin: Math.max(a.loseMin, b.loseMin),
    loseMax: Math.min(a.loseMax, b.loseMax),
  };
}

/** Mon camp et celui d'en face — `null` si je n'y suis pas, ou sans binôme. */
export function stakeSides(game: StakeGame, myId: string): StakeSides | null {
  const tous = clashPlayersFrom(game.participants ?? [], game);
  const moi = tous.find(p => p.id === myId);
  if (!moi) return null;
  const binome = tous.find(p => p.id !== myId && p.team === moi.team);
  return {
    partner: binome ? toStake(binome) : null,
    opponents: tous.filter(p => p.team !== moi.team).map(toStake).filter((p): p is StakePlayer => !!p),
  };
}

/**
 * La bande de niveau admissible pour mon binôme.
 *
 * La contrainte du défi porte sur la MOYENNE du duo — c'est la règle affichée
 * dans « Choisis ton binôme ». Mon binôme peut donc sortir de la bande par le
 * bas comme par le haut, tant que la moyenne y rentre.
 */
export function partnerEloRange(
  myElo: number, minElo: number | null | undefined, maxElo: number | null | undefined,
): [number, number] | null {
  if (minElo == null || maxElo == null) return null;
  const plancher = padelLevelToElo(1);
  return [Math.max(plancher, 2 * minElo - myElo), Math.max(plancher, 2 * maxElo - myElo)];
}

/**
 * Ce que ce match me fait gagner ou perdre — je SUIS dedans (accepté ou invité).
 *
 * Camp adverse incomplet : on retombe sur la bande de niveau du défi. Sans
 * bande (défi nominatif, où elle n'existe pas), on se tait plutôt que
 * d'inventer un adversaire.
 */
export function stakeOutcomeForGame(game: StakeGame, me: StakePlayer): StakeProjection | null {
  if (game.game_format === 'friendly') return null;
  const camps = stakeSides(game, me.id);
  if (!camps) return null;
  const mise = game.stake_multiplier ?? 1;

  // Mon binôme n'est pas encore là : défi reçu, ou je suis le premier de mon
  // camp. Les adversaires, eux, sont connus — il n'y a que MON camp à
  // projeter, sur la bande admissible du binôme. Sans ce cas, une carte
  // « défi reçu » n'affichait aucun enjeu : exactement le moment où le
  // chiffre sert le plus, puisqu'il faut décider de relever ou non.
  if (!camps.partner) {
    if (camps.opponents.length !== 2) return null;
    const bande = partnerEloRange(me.elo_score, game.min_elo, game.max_elo);
    if (!bande) return null;
    const o = enveloppe(
      stakeOutcome(me, suppose('_bin_bas', bande[0]), camps.opponents, mise),
      stakeOutcome(me, suppose('_bin_haut', bande[1]), camps.opponents, mise),
    );
    return o ? { outcome: o, exact: false } : null;
  }

  if (camps.opponents.length === 2) {
    const o = stakeOutcome(me, camps.partner, camps.opponents, mise);
    return o ? { outcome: o, exact: true } : null;
  }
  if (game.min_elo == null || game.max_elo == null) return null;
  const o = stakeOutcomeForBand(me, camps.partner, eloToLevel(game.min_elo), eloToLevel(game.max_elo), mise);
  return o ? { outcome: o, exact: false } : null;
}

/**
 * Ce que ce défi me ferait gagner ou perdre si je le relevais — je n'y suis
 * PAS encore.
 *
 * Mes adversaires sont le camp du créateur, connu au niveau près : un défi
 * n'est publié qu'une fois ce camp complet. Ce qui manque, c'est mon propre
 * binôme — et il compte, puisque c'est la moyenne du camp qui entre dans le
 * calcul. Sans lui, on projette les deux bouts de la bande admissible et on
 * montre l'enveloppe.
 */
export function stakeOutcomeForJoining(
  game: StakeGame, me: StakePlayer, partner: StakePlayer | null,
): StakeProjection | null {
  if (game.game_format === 'friendly') return null;
  const campCreateur = String(game.creator_side ?? 'A_GAU').toUpperCase().startsWith('B') ? 'B' : 'A';
  const adversaires = clashPlayersFrom(game.participants ?? [], game)
    .filter(p => p.team === campCreateur)
    .map(toStake)
    .filter((p): p is StakePlayer => !!p);
  if (adversaires.length !== 2) return null;
  const mise = game.stake_multiplier ?? 1;

  if (partner) {
    const o = stakeOutcome(me, partner, adversaires, mise);
    return o ? { outcome: o, exact: true } : null;
  }
  const bande = partnerEloRange(me.elo_score, game.min_elo, game.max_elo);
  if (!bande) return null;
  const o = enveloppe(
    stakeOutcome(me, suppose('_bin_bas', bande[0]), adversaires, mise),
    stakeOutcome(me, suppose('_bin_haut', bande[1]), adversaires, mise),
  );
  return o ? { outcome: o, exact: false } : null;
}

/**
 * Ce que cette partie me mettrait en jeu si j'y entrais — je ne fais que la
 * REGARDER (Explorer).
 *
 * C'est le chiffre qui donne envie d'entrer. Le taire ici le réserverait à
 * ceux qui sont déjà dedans, c'est-à-dire à ceux qui n'ont plus à être
 * convaincus.
 *
 * Deux inconnues, et on ne triche sur aucune : je ne sais pas quelle place je
 * prendrais, ni qui remplira les autres. On projette donc CHAQUE place libre,
 * on bouche les trous avec les deux bouts de la bande de niveau de la partie,
 * et on montre l'enveloppe. `exact` ne vaut `true` que si rien n'a été
 * supposé — une seule place libre et les trois autres joueurs connus.
 */
export function stakeOutcomeForExploring(game: StakeGame, me: StakePlayer): StakeProjection | null {
  if (game.game_format === 'friendly') return null;
  const tous = clashPlayersFrom(game.participants ?? [], game);
  // Déjà dedans : ce n'est plus une projection d'entrée, c'est mon match.
  if (tous.some(p => p.id === me.id)) return null;

  const cote = (v: string | null | undefined) => String(v ?? '').toUpperCase();
  const prises = new Set<string>();
  if (game.creator_id) prises.add(cote(game.creator_side || 'A_GAU'));
  for (const p of game.participants ?? []) {
    if (occupiesSpot(p) && p.team_side) prises.add(cote(p.team_side));
  }
  const toutes = ['A_GAU', 'A_DRO', 'B_GAU', 'B_DRO'];
  const vraimentLibres = toutes.filter(c => !prises.has(c));
  // Partie COMPLETE : on projette quand meme. « Tu ne peux pas entrer » n'est
  // pas une raison de se taire — on rejoint la liste d'attente precisement
  // parce qu'on veut ce match, et le chiffre est ce qui aide a decider si ca
  // vaut l'attente. On regarde alors chaque place comme si elle se liberait :
  // les trois autres joueurs sont connus, donc le chiffre est exact.
  const libres = vraimentLibres.length > 0 ? vraimentLibres : toutes;
  const remplace = vraimentLibres.length === 0;

  const bande = game.min_elo != null && game.max_elo != null ? [game.min_elo, game.max_elo] : null;
  // Le binôme manquant ne se borne PAS comme un adversaire : la contrainte du
  // jeu porte sur la moyenne du duo, donc il peut sortir de la bande par le
  // bas comme par le haut. Prendre la bande brute donnait un chiffre plus
  // étroit ici que sur la même partie vue depuis « À relever » — deux écrans,
  // deux vérités, exactement ce qu'un test attrape.
  const bandeBinome = partnerEloRange(me.elo_score, game.min_elo, game.max_elo);
  const mise = game.stake_multiplier ?? 1;

  let envelope: StakeOutcome | null = null;
  let toutConnu = true;

  for (const place of libres) {
    const monCamp = place.startsWith('B') ? 'B' : 'A';
    const miens = tous.filter(p => p.team === monCamp);
    // Sur une partie complete, je prends la place de quelqu'un : il sort du
    // calcul, sinon mon camp compterait trois joueurs.
    const coequipiers = (remplace ? miens.slice(1) : miens)
      .map(toStake).filter((p): p is StakePlayer => !!p);
    const enFace = tous.filter(p => p.team !== monCamp).map(toStake).filter((p): p is StakePlayer => !!p);
    const manqueBinome = coequipiers.length === 0;
    const manqueAdversaires = Math.max(0, 2 - enFace.length);
    if (manqueBinome || manqueAdversaires > 0) toutConnu = false;
    // Sans bande, on ne peut rien supposer d'honnête : on se tait.
    if (manqueBinome && !bandeBinome) return null;
    if (manqueAdversaires > 0 && !bande) return null;

    // Les deux bouts de chaque inconnue : le scénario le plus faible et le
    // plus fort qu'on puisse encore rencontrer dans cette partie.
    const binomes = manqueBinome
      ? bandeBinome!.map((elo, i) => suppose(`_co${i}`, elo))
      : [coequipiers[0]];
    const elosAdverses = manqueAdversaires > 0 ? bande! : [0];

    for (const binome of binomes) {
      for (const elo of elosAdverses) {
        const adversaires = [...enFace];
        while (adversaires.length < 2) adversaires.push(suppose(`_adv${adversaires.length}`, elo));
        envelope = enveloppe(envelope, stakeOutcome(me, binome, adversaires, mise));
      }
    }
  }
  return envelope ? { outcome: envelope, exact: toutConnu } : null;
}

/**
 * Ce que ce match me met en jeu, que j'y sois ou non.
 *
 * Les deux cas s'excluent — `stakeOutcomeForGame` ne repond que si je suis un
 * des quatre joueurs, `stakeOutcomeForExploring` que si je n'en suis pas — et
 * c'est exactement pourquoi ils doivent etre appeles ensemble. La carte le
 * faisait, la fiche du match non : en liste d'attente sur un defi complet, la
 * carte annoncait « -0,36 / +0,32 » et la fiche ne disait rien. Le meme match,
 * deux reponses.
 *
 * Tout ecran qui affiche l'enjeu passe par ici.
 */
export function stakeForViewer(game: StakeGame, me: StakePlayer): StakeProjection | null {
  return stakeOutcomeForGame(game, me) ?? stakeOutcomeForExploring(game, me);
}

/** Le meilleur gain possible — celui qu'on affiche. */
export function bestGain(o: StakeOutcome): number { return o.winMax; }

/** La perte la plus lourde — celle qu'on affiche. */
export function worstLoss(o: StakeOutcome): number { return o.loseMax; }
