// lib/activityReactions.ts — le bouton de réaction du fil dépend du TYPE
// d'événement (hub Activité, étape 1 : « Réactions contextuelles »).
//
// Fonction PURE : elle ne parle jamais à la base. Le modèle de données ne
// change PAS — tous les boutons « reaction » continuent d'appeler
// `toggleReaction(eventId)` avec la clé '🔥' existante (lib/community) ; seuls
// le libellé, l'icône et la bascule visuelle varient. Le bouton « Revanche ? »
// n'est PAS une réaction : c'est une action qui ouvre l'onglet Défi (câblée
// dans le composant, pas ici).
import type { ActivityType } from '../types';
import type { IconName } from '../components/community/icons';

export type ReactionKind = 'reaction' | 'action';

export interface ActivityReaction {
  /** Libellé au repos. */
  label: string;
  /** Libellé une fois basculé (aimé / défi envoyé). */
  activeLabel: string;
  icon: IconName;
  kind: ReactionKind;
}

/**
 * Le bouton de réaction pour un type d'événement du fil.
 *   - `match_loss` MIEN → action « Revanche ? » (ouvre l'assistant de création).
 *   - `match_loss` d'un AUTRE → réaction « Respect ».
 *   - `promotion`  → réaction « Machine ! ».
 *   - `match_win`, `badge`, et tout le reste (ex. `bilan`) → réaction « Féliciter »
 *     (l'ancien 🔥 du produit, sans l'emoji).
 *
 * `mienne` compte : « Revanche ? » s'affichait sur TOUTES les défaites, donc
 * aussi sur celles de parties où l'on ne jouait pas. On proposait de venger
 * quelqu'un d'autre. Et « Féliciter » sonne faux sous une défaite.
 */
export function reactionFor(type: ActivityType, mienne: boolean = false): ActivityReaction {
  switch (type) {
    case 'match_loss':
      return mienne
        ? { label: 'Revanche ?', activeLabel: 'Revanche ?', icon: 'swords', kind: 'action' }
        : { label: 'Respect', activeLabel: 'Respect', icon: 'flame', kind: 'reaction' };
    case 'promotion':
      return { label: 'Machine !', activeLabel: 'Machine !', icon: 'zap', kind: 'reaction' };
    case 'match_win':
    case 'badge':
    default:
      return { label: 'Féliciter', activeLabel: 'Féliciter', icon: 'flame', kind: 'reaction' };
  }
}

/**
 * Où mène « Revanche ? » : l'assistant de création, jamais l'onglet Défi.
 *
 * Avec l'identifiant du match, le lobby le rejoue à l'identique — mon binôme
 * reste mon binôme, les deux adversaires repassent en face (`handleRematch`).
 * Sans lui, on ouvre l'assistant vide plutôt que de ne rien faire.
 *
 * À ne pas confondre avec le bouton du Face-à-face, qui lui ne connaît qu'un
 * adversaire et le place seul dans le camp d'en face.
 */
export function rematchRoute(matchId: string | null | undefined): string {
  return matchId ? `/(tabs)/lobby?rematch=${matchId}` : '/(tabs)/lobby?create=1';
}
