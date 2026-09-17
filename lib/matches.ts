// ─── Source de vérité UNIQUE : « quelle action ce match attend-il DE MOI ? » ──
// Partagée par le badge (useNotificationCount), la liste de notifications ET le
// lobby — pour qu'ils s'accordent toujours (un score qui compte dans la cloche
// doit pointer vers un écran réel).
//
//   • 'validate' : score 'pending' soumis par un ADVERSAIRE → je valide/conteste.
//                  Exclut l'auteur du score ET son partenaire (eux n'ont rien à
//                  valider — ils ont soumis). Exclut AUSSI tout score dont
//                  l'heure d'ouverture n'est pas atteinte (cf. plus bas).
//   • 'resolve'  : score 'counter_proposed' que J'AI soumis (created_by === moi)
//                  et qu'un adversaire a contesté → je résous (accepter / litige).
//   • null       : rien à faire de mon côté.
export type MatchAction = 'validate' | 'resolve' | null;

/**
 * Les colonnes que TOUTE requête alimentant `matchNeedsMyAction` doit
 * sélectionner.
 *
 * Piège payé le 2026-09-16 : la cloche listait ses colonnes à la main et avait
 * oublié `validation_opens_at`. Or une heure d'ouverture ABSENTE veut dire
 * « score d'avant la règle, donc ouvert » — la cloche annonçait donc un score
 * à valider que le lobby masquait encore, et le joueur atterrissait sur un
 * écran qui disait « tout est validé ». Une colonne oubliée ne doit plus
 * pouvoir se traduire par une règle qui change de réponse.
 */
export const MATCH_ACTION_FIELDS =
  'id, status, created_by, winner_id, winner_id_2, loser_id, loser_id_2, validation_opens_at';

interface ActionMatch {
  status: string;
  created_by?: string | null;
  winner_id?: string | null;
  winner_id_2?: string | null;
  loser_id?: string | null;
  loser_id_2?: string | null;
  /** Heure à partir de laquelle l'adversaire peut valider — posée par le
   *  serveur à la création (heure du match + 1h30, au moins 30 min après la
   *  saisie). Absente sur les scores d'avant la règle : ils sont ouverts. */
  validation_opens_at?: string | null;
}

// ─── L'heure d'ouverture ─────────────────────────────────────────────────────
// Un score saisi juste après le coup d'envoi ne prouve rien : le match n'est
// pas fini. Tant que l'heure d'ouverture n'est pas atteinte, le score reste
// INVISIBLE pour le camp adverse (rien dans la cloche, rien dans le lobby,
// aucune notification) et le serveur refuse la validation.
//
// Le calcul vit côté serveur (migration score_validation_delay.sql) : l'app ne
// fait que LIRE `validation_opens_at`. Deux horloges qui calculeraient la même
// règle finiraient par diverger, et celle du téléphone se règle à la main.

/** Le score est-il ouvert à la validation ? Un score sans heure d'ouverture
 *  (saisi avant la règle) l'est toujours. */
export function isValidationOpen(m: ActionMatch, now: Date = new Date()): boolean {
  if (!m.validation_opens_at) return true;
  const opens = new Date(m.validation_opens_at).getTime();
  if (Number.isNaN(opens)) return true;   // date illisible : ne bloque personne
  return now.getTime() >= opens;
}

export function matchNeedsMyAction(m: ActionMatch, playerId: string, now: Date = new Date()): MatchAction {
  if (m.status === 'counter_proposed') {
    // Une contestation ne peut exister qu'APRÈS l'ouverture : l'auteur tranche
    // sans délai supplémentaire.
    return m.created_by === playerId ? 'resolve' : null;
  }
  if (m.status !== 'pending') return null;
  if (m.created_by === playerId) return null;
  // Trop tôt : pour l'adversaire, ce score n'existe pas encore.
  if (!isValidationOpen(m, now)) return null;
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
