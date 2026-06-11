/* lib/players.ts
 * Helpers partagés autour du statut d'un joueur (compte supprimé) et de son
 * libellé d'affichage. Source de vérité unique pour ne plus laisser fuiter le
 * libellé brut « Compte supprimé » dans l'UI ni dans les stories.
 *
 * Rappel produit (cf. supabase/migrations/soft_delete_deleted_at.sql) :
 *   suppression de compte = soft-delete → la ligne `players` est conservée mais
 *   anonymisée (name = 'Compte supprimé', deleted_at = now(), user_id = NULL).
 *   Les profils FRMT importés ont user_id = NULL SANS être supprimés → on se
 *   base donc sur `deleted_at`, jamais sur `user_id`. */

/** Forme minimale d'un joueur joint via un select `winner:winner_id(...)`. */
export interface JoinedPlayer {
  id?: string | null;
  name?: string | null;
  deleted_at?: string | null;
}

export type PlayerRole = 'partner' | 'opponent' | 'player';

const ROLE_LABEL: Record<PlayerRole, string> = {
  partner: 'Partenaire',
  opponent: 'Adversaire',
  player: 'Joueur',
};

/** Vrai si le compte a été supprimé (soft-delete). `deleted_at` fait foi ;
 *  le test sur le nom n'est qu'un secours si la colonne n'est pas sélectionnée. */
export function isDeleted(p: JoinedPlayer | null | undefined): boolean {
  if (!p) return false;
  if (p.deleted_at) return true;
  return p.name === 'Compte supprimé';
}

/** Nom à afficher : vrai nom si actif, sinon libellé générique selon le rôle. */
export function displayName(
  p: JoinedPlayer | null | undefined,
  role: PlayerRole = 'player',
): string {
  if (!p || isDeleted(p)) return ROLE_LABEL[role];
  return p.name ?? ROLE_LABEL[role];
}
