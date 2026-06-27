import { isInviteActive } from './games';

// Fragment de `select` à inclure dans TOUTE requête `challenges` destinée à
// l'affichage « défis reçus ». On a besoin du statut de l'invitation liée à la
// partie pour appliquer partout le même filtre de visibilité (voir
// `isReceivedChallengeVisible`). À coller dans la liste de colonnes.
export const CHALLENGE_PARTICIPANTS_SELECT =
  'game:game_id(participants:game_participants(player_id, status, invite_expires_at))';

interface VisibilityChallenge {
  challenger_id: string;
  game?: {
    participants?: { player_id: string; status: string; invite_expires_at?: string | null }[] | null;
  } | null;
}

// ─── Source de vérité UNIQUE : « ce défi reçu est-il encore visible ? » ──────
// Utilisée par l'onglet « Défis reçus » (matchmaking), le compteur de badge
// (useNotificationCount) ET la liste de notifications (notifications.tsx), pour
// qu'ils affichent EXACTEMENT le même ensemble — sinon on dérive (une notif
// fantôme qui pointe vers un onglet vide, un badge qui ne descend pas...).
//
// Pré-requis : l'appelant a déjà filtré côté requête `status='pending'` et
// `expires_at > now` (l'expiration « molle » des défis). Reste à vérifier ici :
//   • le lanceur n'est pas bloqué (modération, deux sens) ;
//   • l'invitation liée à la partie est encore vivante (`isInviteActive` : statut
//     'invited' ET TTL non dépassé). Dès qu'elle passe à accepted / declined /
//     expired — réponse de ma part, auto-décline par chevauchement ±2h, ou
//     expiration — le défi disparaît, même si la ligne `challenges` est restée
//     'pending' (les triggers de chevauchement ne la synchronisent pas).
//   • robustesse : aucune ligne participant ⇒ on affiche (cas legacy).
export function isReceivedChallengeVisible(
  c: VisibilityChallenge,
  playerId: string,
  hidden: Set<string>,
): boolean {
  if (hidden.has(c.challenger_id)) return false;
  const myPart = (c.game?.participants ?? []).find(p => p.player_id === playerId);
  return !myPart || isInviteActive(myPart);
}
