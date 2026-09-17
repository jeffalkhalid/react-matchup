// lib/tournamentEvening.ts — ce qu'on voit pendant qu'on joue.
//
// Une montante se joue en rotations de vingt minutes. Pour saisir un score il
// fallait ouvrir l'app, aller dans Tournois, ouvrir la fiche, faire défiler
// jusqu'à son match : quatre gestes, six fois dans la soirée, par trente-deux
// personnes. L'écran de soirée répond à trois questions et rien d'autre — où
// je joue, contre qui, et où en est le reste.
//
// CE N'EST PAS UN SCORE EN DIRECT. Le live point par point sert un match qu'on
// suit ; ici on joue vingt minutes et on reporte des jeux. Compter les points
// serait PLUS de travail, pas moins. Ce qu'on reprend du live, c'est
// l'emplacement — une surface où l'on atterrit déjà au bon endroit — pas le
// mécanisme.
//
// TOUT LE MONDE VOIT L'ÉTAT DE TOUS LES TERRAINS, et c'est le point. Le
// tournoi se gère entre participants : sans organisateur, « le terrain 5 n'a
// rien rentré » doit s'afficher chez les trente-deux, pour que quelqu'un aille
// leur dire un mot. Signaler un blocage à qui ne peut pas le lever, c'est de
// l'anxiété ; le signaler à tout le monde, c'est de l'autogestion.

import { matchLiveStatus, type MatchLiveStatus, type TournamentMatch,
  type TournamentMatchEntry, type TournamentTeam } from './tournaments';

/**
 * L'état d'un terrain pendant la rotation, du point de vue de la soirée.
 *
 * `matchLiveStatus` rend `'awaiting'` pour DEUX situations que cet écran doit
 * séparer, parce qu'elles n'appellent pas le même geste :
 *
 *   * personne n'a rien saisi — le tirage suivant est bloqué, il faut aller
 *     chercher les quatre joueurs ;
 *   * un camp a saisi, l'autre n'a pas encore répondu — le score compte déjà,
 *     la soirée n'attend personne, il n'y a rien à faire.
 *
 * Les confondre ferait afficher « en attente » sur un terrain qui ne bloque
 * rien, et paniquer pour rien à chaque rotation.
 */
export type CourtState =
  /** Aucune saisie. BLOQUE le tirage suivant. */
  | 'vide'
  /** Un camp a saisi, l'autre n'a pas répondu. Le score compte, rien ne bloque. */
  | 'provisoire'
  /** Les deux camps se contredisent. BLOQUE — on ne sait pas qui monte. */
  | 'litige'
  /** Les deux camps sont d'accord. */
  | 'acquis'
  /** Soldé par un forfait. */
  | 'forfait'
  /** Binôme sans adversaire sur cette rotation. */
  | 'exempt';

export interface CourtView {
  matchId: string;
  courtNo: number;
  state: CourtState;
  /** Vrai quand c'est MON terrain — celui où je suis attendu. */
  mine: boolean;
  /** Le score effectif, `null` tant que personne n'a saisi. */
  gamesA: number | null;
  gamesB: number | null;
}

/** Les deux états qui empêchent de tirer la rotation suivante. */
export function blocks(state: CourtState): boolean {
  return state === 'vide' || state === 'litige';
}

/**
 * L'état d'un terrain, dérivé de `matchLiveStatus` puis affiné.
 *
 * On PART du prédicat existant plutôt que de recalculer : il porte un
 * invariant subtil sur la concordance des saisies, et une seconde lecture de
 * la même règle finirait par en diverger.
 */
export function courtState(
  m: Pick<TournamentMatch, 'team_b' | 'forfeited_team' | 'confirmed_at' | 'games_a'>,
  teamAEntries: Pick<TournamentMatchEntry, 'games_a' | 'games_b'>[],
  teamBEntries: Pick<TournamentMatchEntry, 'games_a' | 'games_b'>[],
): CourtState {
  const base: MatchLiveStatus = matchLiveStatus(
    m.team_b != null, m.forfeited_team, m.confirmed_at, teamAEntries, teamBEntries,
  );
  if (base === 'bye') return 'exempt';
  if (base === 'forfeited') return 'forfait';
  if (base === 'confirmed') return 'acquis';
  if (base === 'disputed') return 'litige';
  // `awaiting` se dédouble : le score écrit dit qu'au moins un camp a saisi.
  return m.games_a != null ? 'provisoire' : 'vide';
}

/** Les joueurs d'un binôme, tels quels — jamais « toi / l'adversaire ». */
function teamOf(teams: TournamentTeam[], id: string | null): TournamentTeam | null {
  return id ? teams.find(t => t.id === id) ?? null : null;
}

/** Suis-je dans ce binôme ? */
export function inTeam(t: TournamentTeam | null, myId: string): boolean {
  return !!t && (t.player1_id === myId || t.player2_id === myId);
}

/**
 * Tous les terrains de la rotation en cours, le mien marqué.
 *
 * Trié par numéro de terrain : c'est l'ordre du gymnase, et le seul que tout
 * le monde partage. Trier par état ferait sauter les cartes d'une rotation à
 * l'autre, alors qu'on cherche « le terrain 5 » avec les yeux.
 */
export function eveningCourts(
  matches: TournamentMatch[],
  teams: TournamentTeam[],
  entries: TournamentMatchEntry[],
  myId: string,
  currentRound: number,
): CourtView[] {
  const parMatch = new Map<string, TournamentMatchEntry[]>();
  for (const e of entries) {
    const l = parMatch.get(e.match_id);
    if (l) l.push(e); else parMatch.set(e.match_id, [e]);
  }

  return matches
    .filter(m => m.round_no === currentRound)
    .map(m => {
      const ta = teamOf(teams, m.team_a);
      const tb = teamOf(teams, m.team_b);
      const mes = parMatch.get(m.id) ?? [];
      const dansA = (e: TournamentMatchEntry) => inTeam(ta, e.player_id);
      return {
        matchId: m.id,
        courtNo: m.court_no,
        state: courtState(m, mes.filter(dansA), mes.filter(e => !dansA(e))),
        mine: inTeam(ta, myId) || inTeam(tb, myId),
        gamesA: m.games_a,
        gamesB: m.games_b,
      };
    })
    .sort((a, b) => a.courtNo - b.courtNo);
}

/** Mon terrain de cette rotation, s'il y en a un. */
export function myCourt(courts: CourtView[]): CourtView | null {
  return courts.find(c => c.mine) ?? null;
}

/**
 * Ce qui empêche la rotation suivante, dit à tout le monde.
 *
 * Deux manques différents, deux phrases différentes — parce qu'ils appellent
 * deux gestes différents : aller chercher quatre joueurs, ou demander à deux
 * camps de se mettre d'accord.
 */
export function blockingLabel(courts: CourtView[]): string | null {
  const vides = courts.filter(c => c.state === 'vide').map(c => c.courtNo);
  const litiges = courts.filter(c => c.state === 'litige').map(c => c.courtNo);
  if (vides.length === 0 && litiges.length === 0) return null;

  const liste = (n: number[]) => n.length === 1 ? `Terrain ${n[0]}` : `Terrains ${n.join(', ')}`;
  const bouts: string[] = [];
  if (vides.length > 0) {
    bouts.push(`${liste(vides)} : pas de score rentré`);
  }
  if (litiges.length > 0) {
    bouts.push(`${liste(litiges)} : les deux camps ne disent pas la même chose`);
  }
  return bouts.join(' · ');
}

/** « Rotation 2 sur 6 ». */
export function roundLabel(current: number, total: number): string {
  return `Rotation ${Math.max(1, current)} sur ${Math.max(1, total)}`;
}

/**
 * Combien de terrains ont fini, sur combien — la jauge de la soirée.
 *
 * Un terrain « provisoire » COMPTE comme fini : son score est effectif, il
 * n'empêche rien. Ne compter que les acquis afficherait un retard qui n'existe
 * pas et pousserait à relancer des gens qui ont déjà fait leur part.
 */
export function courtsDone(courts: CourtView[]): { done: number; total: number } {
  const jouables = courts.filter(c => c.state !== 'exempt');
  return {
    done: jouables.filter(c => !blocks(c.state)).length,
    total: jouables.length,
  };
}
