// react-matchup/lib/defiNotify.ts
// Notifications des événements défi (émises côté client après un appel RPC réussi).
// Centralise les messages pour que le hub ET le lobby envoient EXACTEMENT les mêmes.
import { notifyPlayers } from './notify';
import type { DefiApplication } from './defis';

// Suite à defi_apply : prévenir le partenaire qu'on l'invite à relever un défi.
// Tap → hub Défi (section « Invitations binôme »).
export function notifyPartnerInvitedToRelever(partnerId: string, inviterName: string): void {
  if (!partnerId) return;
  notifyPlayers({
    playerIds: [partnerId],
    title: '🎾 Invitation binôme',
    body: `${inviterName} veut relever un défi avec toi — accepte pour verrouiller le binôme.`,
    data: { type: 'challenge' },
  });
}

// Suite à defi_accept = 'locked' : prévenir les 3 AUTRES joueurs (créateur + son
// partenaire Team A, + l'initiateur de la candidature Team B) que le défi est
// confirmé. L'appelant (le partenaire qui accepte) est exclu via accepterId.
// Tap → la partie dans le lobby.
export function notifyDefiConfirmed(app: DefiApplication, accepterId: string): void {
  const g = app.game;
  const teamAIds = (g?.participants ?? [])
    .filter(p => (p.team_side ?? '').startsWith('A'))
    .map(p => p.player_id);
  const ids = Array.from(new Set([
    app.initiator_id,
    ...(g?.creator_id ? [g.creator_id] : []),
    ...teamAIds,
  ])).filter(id => !!id && id !== accepterId);
  if (ids.length === 0) return;
  notifyPlayers({
    playerIds: ids,
    title: '✅ Défi confirmé',
    body: 'Le binôme est complet — rendez-vous sur le terrain !',
    data: g?.id ? { type: 'lobby', gameId: g.id } : { type: 'challenge' },
  });
}
