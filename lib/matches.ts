// ─── Source de vérité UNIQUE : « quelle action ce match attend-il DE MOI ? » ──
// Partagée par le badge (useNotificationCount), la liste de notifications ET le
// lobby — pour qu'ils s'accordent toujours (un score qui compte dans la cloche
// doit pointer vers un écran réel).
//
//   • 'validate' : score 'pending' soumis par un ADVERSAIRE → je valide/conteste.
//                  Exclut l'auteur du score ET son partenaire (eux n'ont rien à
//                  valider — ils ont soumis).
//   • 'resolve'  : score 'counter_proposed' que J'AI soumis (created_by === moi)
//                  et qu'un adversaire a contesté → je résous (accepter / litige).
//   • null       : rien à faire de mon côté.
export type MatchAction = 'validate' | 'resolve' | null;

interface ActionMatch {
  status: string;
  created_by?: string | null;
  winner_id?: string | null;
  winner_id_2?: string | null;
  loser_id?: string | null;
  loser_id_2?: string | null;
}

export function matchNeedsMyAction(m: ActionMatch, playerId: string): MatchAction {
  if (m.status === 'counter_proposed') {
    return m.created_by === playerId ? 'resolve' : null;
  }
  if (m.status !== 'pending') return null;
  if (m.created_by === playerId) return null;
  // Le partenaire de l'auteur n'a rien à valider non plus.
  const cb = m.created_by;
  if (
    (cb === m.winner_id   && m.winner_id_2 === playerId) ||
    (cb === m.winner_id_2 && m.winner_id   === playerId) ||
    (cb === m.loser_id    && m.loser_id_2  === playerId) ||
    (cb === m.loser_id_2  && m.loser_id    === playerId)
  ) return null;
  return 'validate';
}
