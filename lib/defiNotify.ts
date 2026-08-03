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
    title: 'Invitation à un défi',
    body: `${inviterName} t'invite à relever un défi avec lui.`,
    data: { type: 'challenge', tab: 'mes' },
  });
}

// Suite à defi_accept = 'queued' : le binôme est complet mais la place est prise
// → prévenir l'initiateur qu'on est EN FILE (promu si une place se libère).
export function notifyBinomeQueued(initiatorId: string, partnerName: string): void {
  if (!initiatorId) return;
  notifyPlayers({
    playerIds: [initiatorId],
    title: 'En file d\'attente',
    body: `${partnerName} a accepté — le défi est déjà pris, mais vous êtes en file (promus si une place se libère).`,
    data: { type: 'challenge', tab: 'mes' },
  });
}

// Suite à un REFUS d'invitation à relever (defi_decline) : prévenir l'initiateur.
export function notifyReleverDeclined(initiatorId: string, byName: string): void {
  if (!initiatorId) return;
  notifyPlayers({
    playerIds: [initiatorId],
    title: 'Défi décliné',
    body: `${byName} a refusé de relever le défi avec toi.`,
    data: { type: 'challenge', tab: 'relever' },
  });
}

// Suite à un REFUS de proposition de binôme (vitrine) : prévenir le nominateur.
export function notifyShowcaseDeclined(nominatorId: string, byName: string): void {
  if (!nominatorId) return;
  notifyPlayers({
    playerIds: [nominatorId],
    title: 'Proposition déclinée',
    body: `${byName} a décliné ta proposition de binôme.`,
    data: { type: 'challenge' },
  });
}

// Suite à openShowcase : prévenir le partenaire nominé qu'il doit confirmer.
// Tap → hub Défi (section « Binômes ouverts »).
export function notifyShowcaseNominated(partnerId: string, byName: string): void {
  if (!partnerId) return;
  notifyPlayers({
    playerIds: [partnerId],
    title: 'Binôme ouvert',
    body: `${byName} veut être ton binôme de défis — confirme depuis ton profil.`,
    // 'showcase' + pid (= le destinataire) → le tap ouvre SON profil sur « À confirmer ».
    data: { type: 'showcase', pid: partnerId },
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
