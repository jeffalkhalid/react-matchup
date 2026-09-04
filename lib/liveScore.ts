// Rejeu du journal live → score. Module PUR (aucune dépendance) : c'est la
// RÉFÉRENCE de la logique, dupliquée en plpgsql dans supabase/migrations/
// live_scoring.sql + live_scoring_points.sql (fn_live_replay). Toute
// modification ICI doit être répercutée LÀ-BAS (même contrainte que
// lib/elo.ts ↔ elo_on_validate.sql).
//
// Deux granularités de saisie :
// - mode 'games' (défaut) : 1 événement game_won par jeu.
// - mode 'points' : 1 événement point_won par point ; jeux (0/15/30/40,
//   point en or OU avantage), tie-break numérique à 6-6, sets et match
//   sont dérivés. game_won reste accepté (semis synthétique côté client).
export type LiveEventType = 'game_won' | 'point_won' | 'undo' | 'contest' | 'contest_resolved' | 'scorer_changed' | 'finished' | 'abandoned';
export type LiveEvent = { seq: number; event_type: LiveEventType; payload: { team?: 1 | 2; target_seq?: number } };
export type SetScore = { t1: number; t2: number };
export type ReplayOpts = { mode?: 'games' | 'points'; goldenPoint?: boolean };
export type LiveState = {
  sets: SetScore[];
  setsWon: { t1: number; t2: number };
  // Points BRUTS du jeu en cours (mode points uniquement, null en mode games).
  // L'affichage 0/15/30/40/AV se fait via gameScoreLabels().
  // OPTIONNELS : les current_state stockés AVANT la migration
  // live_scoring_points.sql ne contiennent pas ces clés — replayEvents les
  // renvoie toujours, mais un état lu en DB peut ne pas les avoir.
  currentGame?: SetScore | null;
  // Le jeu en cours est le tie-break du set à 6-6 (mode points uniquement).
  tieBreak?: boolean;
  finished: boolean;
  openContests: number;
};

// Set terminé : ≥6 jeux avec 2 d'écart, ou 7 jeux (7-5 et tie-break 7-6).
function setIsOver(s: SetScore): boolean {
  const max = Math.max(s.t1, s.t2), diff = Math.abs(s.t1 - s.t2);
  return (max >= 6 && diff >= 2) || max === 7;
}

// Jeu terminé pour l'équipe menante (p = ses points, q = points adverses) :
// - tie-break : premier à 7 avec 2 d'écart ;
// - point en or : 4 points avec 2 d'écart, OU 4e point à 40-40 (q >= 3) ;
// - avantage : 4 points minimum avec 2 d'écart (deuce sans fin).
function gameIsWon(p: number, q: number, golden: boolean, tieBreak: boolean): boolean {
  if (tieBreak) return p >= 7 && p - q >= 2;
  if (golden) return p >= 4 && (p - q >= 2 || q >= 3);
  return p >= 4 && p - q >= 2;
}

export function replayEvents(events: LiveEvent[], opts: ReplayOpts = {}): LiveState {
  const mode = opts.mode ?? 'games';
  const golden = opts.goldenPoint ?? true;
  const ordered = [...events].sort((a, b) => a.seq - b.seq);

  // 1. Résoudre les undo : chaque undo annule le dernier événement de score
  //    (game_won ou point_won) encore effectif.
  const effective: LiveEvent[] = [];
  let openContests = 0;
  for (const e of ordered) {
    if (e.event_type === 'game_won' || (mode === 'points' && e.event_type === 'point_won')) {
      effective.push(e);
    } else if (e.event_type === 'undo') {
      if (effective.length > 0) effective.pop();
    } else if (e.event_type === 'contest') openContests++;
    else if (e.event_type === 'contest_resolved') openContests = Math.max(0, openContests - 1);
  }

  // 2. Rejouer les événements effectifs.
  const sets: SetScore[] = [{ t1: 0, t2: 0 }];
  let curGame: SetScore = { t1: 0, t2: 0 };

  const creditGame = (team: 1 | 2) => {
    const cur = sets[sets.length - 1];
    if (team === 1) cur.t1++; else cur.t2++;
    curGame = { t1: 0, t2: 0 };
    if (setIsOver(cur)) sets.push({ t1: 0, t2: 0 });
  };

  for (const e of effective) {
    const team = e.payload.team === 1 ? 1 : 2;
    if (e.event_type === 'game_won') {
      creditGame(team);
    } else {
      // point_won (mode points uniquement, filtré à l'étape 1)
      const cur = sets[sets.length - 1];
      const inTieBreak = cur.t1 === 6 && cur.t2 === 6;
      if (team === 1) curGame.t1++; else curGame.t2++;
      const p = team === 1 ? curGame.t1 : curGame.t2;
      const q = team === 1 ? curGame.t2 : curGame.t1;
      if (gameIsWon(p, q, golden, inTieBreak)) creditGame(team);
    }
  }

  const done = sets.slice(0, -1);
  const lastSet = sets[sets.length - 1];
  return {
    sets,
    setsWon: {
      t1: done.filter(s => s.t1 > s.t2).length,
      t2: done.filter(s => s.t2 > s.t1).length,
    },
    currentGame: mode === 'points' ? curGame : null,
    tieBreak: mode === 'points' && lastSet.t1 === 6 && lastSet.t2 === 6,
    finished: ordered.some(e => e.event_type === 'finished'),
    openContests,
  };
}

// Libellés d'affichage du jeu en cours (mode points).
// tieBreak → numérique ; sinon 0/15/30/40 avec AV/40 en mode avantage.
const POINT_LABELS = ['0', '15', '30', '40'];
export function gameScoreLabels(cur: SetScore, golden: boolean, tieBreak: boolean): { t1: string; t2: string } {
  if (tieBreak) return { t1: String(cur.t1), t2: String(cur.t2) };
  if (cur.t1 >= 3 && cur.t2 >= 3) {
    if (golden || cur.t1 === cur.t2) return { t1: '40', t2: '40' };
    return cur.t1 > cur.t2 ? { t1: 'AV', t2: '40' } : { t1: '40', t2: 'AV' };
  }
  return { t1: POINT_LABELS[Math.min(cur.t1, 3)], t2: POINT_LABELS[Math.min(cur.t2, 3)] };
}

// Nombre total de jeux joués.
export function totalGames(s: LiveState): number {
  return s.sets.reduce((n, set) => n + set.t1 + set.t2, 0);
}

// « Version » comparable entre deux représentations du même match (l'état
// local du scoreur et l'état serveur : le scoreur est l'unique écrivain, donc
// à progression égale les deux états sont forcément identiques). En mode
// points, deux états peuvent avoir le même nombre de JEUX mais différer par
// les points du jeu en cours — la clé combine donc jeux puis points (un jeu
// vaut au plus quelques dizaines de points, la pondération ×1000 rend les
// deux composantes non ambiguës).
export function progressKey(s: LiveState): number {
  const curPts = s.currentGame ? s.currentGame.t1 + s.currentGame.t2 : 0;
  return totalGames(s) * 1000 + curPts;
}

// Reconstruit un journal d'événements équivalent à un état donné : pour CHAQUE
// set (terminés ET set courant), des paires alternées 1,2 × min(t1,t2) puis le
// reliquat pour l'équipe en tête — idem ensuite pour les POINTS du jeu en
// cours (mode points). L'entrelacement garantit qu'aucun jeu ni set ne se
// ferme prématurément : pendant les paires l'écart reste ≤ 1, et une position
// stockée est par construction non terminale (en point en or, un jeu stocké a
// forcément max ≤ 3 — propriété couverte par les tests round-trip).
//
// LIMITE ASSUMÉE — le journal produit est SYNTHÉTIQUE : bon SCORE, pas l'ordre
// réel des jeux/points. Un `undo` juste après un re-semis peut donc retirer le
// jeu (ou le point) de la mauvaise équipe — voire un jeu entier là où le
// serveur ne retire qu'un point, si le jeu courant est à 0-0. Accepté : le
// serveur applique l'undo sur son VRAI journal et l'adoption au round-trip
// suivant recale l'écran (divergence purement visuelle, < 1 aller-retour).
export function eventsFromState(state: LiveState): LiveEvent[] {
  const events: LiveEvent[] = [];
  let seq = 1;
  const push = (event_type: 'game_won' | 'point_won', team: 1 | 2) => {
    events.push({ seq: seq++, event_type, payload: { team } });
  };
  for (const set of state.sets) {
    const pairs = Math.min(set.t1, set.t2);
    for (let i = 0; i < pairs; i++) { push('game_won', 1); push('game_won', 2); }
    const leader: 1 | 2 = set.t1 >= set.t2 ? 1 : 2;
    const rest = Math.abs(set.t1 - set.t2);
    for (let i = 0; i < rest; i++) push('game_won', leader);
  }
  if (state.currentGame) {
    const { t1, t2 } = state.currentGame;
    const pairs = Math.min(t1, t2);
    for (let i = 0; i < pairs; i++) { push('point_won', 1); push('point_won', 2); }
    const leader: 1 | 2 = t1 >= t2 ? 1 : 2;
    const rest = Math.abs(t1 - t2);
    for (let i = 0; i < rest; i++) push('point_won', leader);
  }
  return events;
}

export function isMatchDecided(state: LiveState): 1 | 2 | null {
  const { t1, t2 } = state.setsWon;
  if (Math.max(t1, t2) >= 2 && t1 !== t2) return t1 > t2 ? 1 : 2;
  return null;
}

export function buildScoreText(state: LiveState): string {
  const done = state.sets.slice(0, -1);
  const cur = state.sets[state.sets.length - 1];
  const all = (cur.t1 > 0 || cur.t2 > 0) ? [...done, cur] : done;
  return all.map(s => `${s.t1}-${s.t2}`).join(', ');
}
