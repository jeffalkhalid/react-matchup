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
 *   - `match_loss` → action « Revanche ? » (ouvre le Défi, ne touche pas aux réactions).
 *   - `promotion`  → réaction « Machine ! ».
 *   - `match_win`, `badge`, et tout le reste (ex. `bilan`) → réaction « Féliciter »
 *     (l'ancien 🔥 du produit, sans l'emoji).
 */
export function reactionFor(type: ActivityType): ActivityReaction {
  switch (type) {
    case 'match_loss':
      return { label: 'Revanche ?', activeLabel: 'Défi envoyé', icon: 'swords', kind: 'action' };
    case 'promotion':
      return { label: 'Machine !', activeLabel: 'Machine !', icon: 'zap', kind: 'reaction' };
    case 'match_win':
    case 'badge':
    default:
      return { label: 'Féliciter', activeLabel: 'Féliciter', icon: 'flame', kind: 'reaction' };
  }
}
