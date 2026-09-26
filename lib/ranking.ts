// Classement — chargement par pages, rang calculé par le serveur.
//
// L'écran chargeait TOUS les joueurs, toutes colonnes, puis filtrait dans le
// téléphone. Invisible à 18 joueurs ; à 2000, chaque ouverture transfère la
// table entière — et personne ne fait défiler 2000 lignes.
//
// Deux principes :
//   • on ne demande que ce qu'on affiche (4 colonnes, 50 lignes) ;
//   • le RANG vient du serveur, calculé sur la table entière. C'est ce qui
//     permet de filtrer par ligue ou de chercher un nom sans que le rang
//     devienne faux : un joueur 347ᵉ reste 347ᵉ, qu'on l'ait trouvé par la
//     recherche, dans sa ligue, ou en descendant la liste.
import { supabase } from './supabase';
import type { League } from '../types';

/** Une page. 50 = ce qu'on voit en descendant deux ou trois fois. */
export const RANKING_PAGE = 50;

export interface RankedRow {
  id: string;
  name: string;
  elo_score: number;
  avatar_path: string | null;
  /** Rang GLOBAL, tous joueurs confondus — jamais le rang dans le filtre. */
  rang: number;
}

/**
 * Bornes d'ELO d'une ligue — miroir exact de `getLeague` (lib/theme).
 *
 * ⚠️ Les deux doivent rester d'accord : si les seuils bougent là-bas sans
 * bouger ici, le filtre afficherait des joueurs que la ligne appelle
 * autrement. `null` = pas de borne de ce côté.
 */
export function leagueBounds(league: League | 'tous'): { min: number | null; max: number | null } {
  switch (league) {
    case 'diamond':   return { min: 1400, max: null };
    case 'gold':      return { min: 1200, max: 1399 };
    case 'silver':    return { min: 1000, max: 1199 };
    case 'bronze':    return { min: 800,  max: 999  };
    case 'discovery': return { min: null, max: 799  };
    default:          return { min: null, max: null };
  }
}

/** Le décalage à demander pour la page n (0 = la première). */
export function pageOffset(page: number, taille: number = RANKING_PAGE): number {
  return Math.max(0, page) * taille;
}

/**
 * Reste-t-il des pages ? On le déduit du nombre de lignes reçues : une page
 * pleine veut dire « il y en a probablement d'autres », une page incomplète
 * veut dire « c'est la fin ». Une requête de moins qu'un comptage, et le seul
 * défaut est un « Voir plus » qui ne ramène rien quand le total tombe pile.
 */
export function aEncoreDesPages(recues: number, taille: number = RANKING_PAGE): boolean {
  return recues >= taille;
}

/**
 * Une liste d'amis VIDE ne veut pas dire « pas de filtre » : elle veut dire
 * « personne ». Sans cette distinction, l'onglet Amis de quelqu'un qui ne suit
 * encore personne afficherait le classement entier.
 */
export function restreintARien(ids: string[] | null | undefined): boolean {
  return Array.isArray(ids) && ids.length === 0;
}

interface Options {
  /** Recherche par nom ; ignorée si moins de 2 lettres (trop de bruit). */
  recherche?: string;
  ligue?: League | 'tous';
  /** Onglet « Amis » : on restreint à ces joueurs, rangs globaux conservés. */
  ids?: string[] | null;
  page?: number;
}

export async function fetchRankingPage(o: Options = {}): Promise<RankedRow[]> {
  if (restreintARien(o.ids)) return [];

  const { min, max } = leagueBounds(o.ligue ?? 'tous');
  const recherche = (o.recherche ?? '').trim();

  const { data, error } = await supabase.rpc('ranking_page', {
    p_search:  recherche.length >= 2 ? recherche : null,
    p_min_elo: min,
    p_max_elo: max,
    p_ids:     o.ids ?? null,
    p_offset:  pageOffset(o.page ?? 0),
    p_limit:   RANKING_PAGE,
  });

  if (error) { console.log('[classement]', error.message); return []; }
  return (data ?? []) as RankedRow[];
}

/**
 * Mon rang, sans charger le classement.
 *
 * Compter les joueurs devant moi coûte une requête minuscule — bien moins que
 * de descendre la liste jusqu'à se trouver. C'est ce qui permet d'épingler
 * « Toi — 347ᵉ » même quand on regarde le haut du tableau.
 */
export async function fetchMonRang(monElo: number): Promise<number | null> {
  const { count, error } = await supabase
    .from('players')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
    .gt('elo_score', monElo);

  if (error) { console.log('[classement/rang]', error.message); return null; }
  return (count ?? 0) + 1;
}

/** La page où se trouve un rang donné — pour « Voir ma position ». */
export function pageDuRang(rang: number, taille: number = RANKING_PAGE): number {
  return Math.max(0, Math.ceil(rang / taille) - 1);
}

/** Combien de joueurs au total — pour l'entête « N joueurs classés ». */
export async function fetchTotalJoueurs(): Promise<number> {
  const { count, error } = await supabase
    .from('players')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null);

  if (error) { console.log('[classement/total]', error.message); return 0; }
  return count ?? 0;
}
