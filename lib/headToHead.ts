// lib/headToHead.ts — « Face-à-face » du hub Activité.
//
// Le handoff « Hub Activite » le place en 5ᵉ priorité et note sa charge
// émotionnelle : ce n'est pas une statistique de plus, c'est un rival. On ne
// l'ouvre donc qu'à partir de trois duels — en dessous, ce n'est pas une
// histoire, c'est un hasard.
//
// Tout se calcule depuis `matches`, qui existe déjà : aucune migration.
// Le haut du fichier est pur et testé (lib/__tests__/headToHead.test.ts).
import { supabase } from './supabase';

/** En dessous, on ne parle pas encore de rival. */
export const RIVAL_MIN_DUELS = 3;
/** Le nombre de barres d'historique affichées sous le score. */
export const HISTORY_LENGTH = 5;

export interface DuelMatch {
  id: string;
  createdAt: string;
  scoreText: string | null;
  winnerId?: string | null;
  winnerId2?: string | null;
  loserId?: string | null;
  loserId2?: string | null;
}

export interface HeadToHead {
  opponentId: string;
  /** Mes victoires face à lui. */
  wins: number;
  losses: number;
  total: number;
  /** Les derniers duels, du plus ancien au plus récent : `true` = j'ai gagné. */
  history: boolean[];
  lastScore: string | null;
  lastAt: string;
  lastWon: boolean;
  /** Date du premier duel — « 5 matchs depuis mars ». */
  firstAt: string;
}

const cote = (m: DuelMatch, id: string): 'gagnant' | 'perdant' | null =>
  m.winnerId === id || m.winnerId2 === id ? 'gagnant'
    : m.loserId === id || m.loserId2 === id ? 'perdant'
      : null;

/** Les deux joueurs d'en face, pour un match où je suis. */
export function opponentsOf(m: DuelMatch, myId: string): string[] {
  const moi = cote(m, myId);
  if (!moi) return [];
  const adverses = moi === 'gagnant' ? [m.loserId, m.loserId2] : [m.winnerId, m.winnerId2];
  return adverses.filter((x): x is string => !!x);
}

/**
 * Le bilan face à chaque adversaire rencontré. Les matchs sont attendus du
 * plus récent au plus ancien (l'ordre de la base) ; l'historique renvoyé est
 * remis dans le sens de la lecture, du plus ancien au plus récent.
 */
export function headToHeadFrom(matches: DuelMatch[], myId: string): Map<string, HeadToHead> {
  const out = new Map<string, HeadToHead>();
  // On ne se fie pas à l'ordre reçu : tout le reste en dépend.
  const parDate = [...matches].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  for (const m of parDate) {
    const moi = cote(m, myId);
    if (!moi) continue;
    const jAiGagne = moi === 'gagnant';
    for (const adv of opponentsOf(m, myId)) {
      let h = out.get(adv);
      if (!h) {
        h = {
          opponentId: adv, wins: 0, losses: 0, total: 0, history: [],
          lastScore: m.scoreText, lastAt: m.createdAt, lastWon: jAiGagne, firstAt: m.createdAt,
        };
        out.set(adv, h);
      }
      if (jAiGagne) h.wins += 1; else h.losses += 1;
      h.total += 1;
      h.history.push(jAiGagne);           // du plus récent au plus ancien pour l'instant
      h.firstAt = m.createdAt;            // le dernier vu est le plus ancien
    }
  }
  for (const h of out.values()) h.history = h.history.slice(0, HISTORY_LENGTH).reverse();
  return out;
}

/** Le rival : le plus de duels, puis le plus récent. `null` sous le seuil. */
export function pickRival(matches: DuelMatch[], myId: string): HeadToHead | null {
  return meilleurAdversaire(headToHeadFrom(matches, myId), RIVAL_MIN_DUELS);
}

/** L'adversaire le plus fréquent, quel que soit le nombre de duels. */
export function closestOpponent(matches: DuelMatch[], myId: string): HeadToHead | null {
  return meilleurAdversaire(headToHeadFrom(matches, myId), 1);
}

/**
 * Tous mes rivaux, du plus affronté au moins affronté. Un seul face-à-face
 * affiché ne racontait qu'une histoire : dans un club, on en a plusieurs, et
 * c'est la comparaison entre eux qui donne envie de rejouer.
 */
export function rivals(matches: DuelMatch[], myId: string, limit = 5): HeadToHead[] {
  return [...headToHeadFrom(matches, myId).values()]
    .filter(h => h.total >= RIVAL_MIN_DUELS)
    .sort((a, b) => b.total - a.total || (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0))
    .slice(0, limit);
}

function meilleurAdversaire(m: Map<string, HeadToHead>, seuil: number): HeadToHead | null {
  let best: HeadToHead | null = null;
  for (const h of m.values()) {
    if (h.total < seuil) continue;
    if (!best || h.total > best.total || (h.total === best.total && h.lastAt > best.lastAt)) best = h;
  }
  return best;
}

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MOIS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const minuit = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** « hier », « jeudi dernier », « le 12 sept. » — quand a eu lieu le duel. */
export function relativeDayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const jours = Math.round((minuit(now) - minuit(d)) / 86_400_000);
  if (jours <= 0) return "aujourd'hui";
  if (jours === 1) return 'hier';
  if (jours < 7) return `${JOURS[d.getDay()]} dernier`;
  return `le ${d.getDate()} ${MOIS[d.getMonth()]}`;
}

/** « 5 matchs depuis mars » — l'ancienneté du face-à-face. */
export function duelSinceLabel(h: HeadToHead): string {
  const d = new Date(h.firstAt);
  const matchs = `${h.total} match${h.total > 1 ? 's' : ''}`;
  if (Number.isNaN(d.getTime())) return matchs;
  return `${matchs} depuis ${MOIS_LONG[d.getMonth()]}`;
}

/** Ajoute un point final, sauf si la phrase en a déjà un (« le 4 sept. »). */
const pointFinal = (t: string) => (t.endsWith('.') ? t : `${t}.`);

/** La phrase de contexte sous les barres d'historique. */
export function duelSentence(h: HeadToHead, opponentFirstName: string, now: Date = new Date()): string {
  const tete = h.wins > h.losses
    ? `Tu mènes ${h.wins}–${h.losses}.`
    : h.wins < h.losses
      ? `${opponentFirstName} mène ${h.losses}–${h.wins}.`
      : `Vous êtes à égalité, ${h.wins} partout.`;
  const quand = relativeDayLabel(h.lastAt, now);
  if (!h.lastScore) return quand ? pointFinal(`${tete} Dernier duel ${quand}`) : tete;
  return pointFinal(`${tete} Ton dernier duel : ${h.lastScore}${quand ? `, ${quand}` : ''}`);
}

/**
 * Le libellé du bouton. Une revanche se DEMANDE quand on perd : proposer à
 * quelqu'un qu'on mène 9–3 de « demander la revanche » n'avait aucun sens.
 * C'est alors à nous de la lui donner ; à égalité, on joue la belle.
 */
export function rematchLabel(h: Pick<HeadToHead, 'wins' | 'losses'>, opponentFirstName: string): string {
  if (h.wins > h.losses) return `Donner sa revanche à ${opponentFirstName}`;
  if (h.wins < h.losses) return `Demander la revanche à ${opponentFirstName}`;
  return `Jouer la belle avec ${opponentFirstName}`;
}

// ─── Base de données ──────────────────────────────────────────────────────

export interface RivalPlayer {
  id: string;
  name: string;
  avatarPath: string | null;
  memberNumber: number | null;
  eloScore: number | null;
  courtSide: string | null;
}

/** Mes matchs validés, du plus récent au plus ancien. */
export async function fetchDuels(myId: string, limit = 120): Promise<DuelMatch[]> {
  const { data, error } = await supabase
    .from('matches')
    .select('id, created_at, score_text, winner_id, winner_id_2, loser_id, loser_id_2')
    .eq('status', 'validated')
    .or(`winner_id.eq.${myId},winner_id_2.eq.${myId},loser_id.eq.${myId},loser_id_2.eq.${myId}`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.warn('[headToHead] fetchDuels', error); return []; }

  return ((data ?? []) as any[]).map(m => ({
    id: m.id,
    createdAt: m.created_at,
    scoreText: m.score_text ?? null,
    winnerId: m.winner_id, winnerId2: m.winner_id_2,
    loserId: m.loser_id, loserId2: m.loser_id_2,
  }));
}

/** La fiche du joueur d'en face. */
export async function fetchRivalPlayer(playerId: string): Promise<RivalPlayer | null> {
  const { data, error } = await supabase
    .from('players')
    .select('id, name, avatar_path, member_number, elo_score, court_side')
    .eq('id', playerId)
    .limit(1);
  if (error) { console.warn('[headToHead] fetchRivalPlayer', error); return null; }
  const p = (data ?? [])[0] as any;
  return p ? {
    id: p.id, name: p.name, avatarPath: p.avatar_path ?? null,
    memberNumber: p.member_number ?? null, eloScore: p.elo_score ?? null,
    courtSide: p.court_side ?? null,
  } : null;
}
