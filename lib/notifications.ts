import { supabase } from './supabase';
import { isInvitationVisible, isGameReadyToScore } from './games';
import { matchNeedsMyAction } from './matches';
import { getHiddenPlayerIds } from './moderation';
import { getLeague, getLeagueLabel, eloToLevel } from './theme';

// ─── Source UNIQUE de la liste de notifications ──────────────────────────────
// Construit l'ENSEMBLE des cartes de notification d'un joueur, dans l'ordre
// d'affichage et déjà filtré des notifs "info" supprimées. Consommé par DEUX
// lecteurs qui DOIVENT rester cohérents :
//   • l'écran `notifications.tsx` (rendu des cartes),
//   • le hook `useNotificationCount` (total de la cloche = items.length).
// Toute évolution du comptage se fait ICI, jamais en double — sinon la cloche et
// la liste re-divergent (trophées/à-scorer agrégés en 1 carte, joined/levelup
// présents dans la liste mais pas dans le compteur, etc.).
export interface NotifItem {
  id: string;
  type: 'challenge' | 'invitation' | 'match' | 'badge' | 'levelup' | 'to_score' | 'to_approve' | 'joined' | 'dm_request';
  title: string;
  subtitle: string;
  route: string;
}

// Notifs "info" sans action requise : supprimables définitivement (persistées
// dans la table dismissed_notifications). Les autres types disparaissent en
// traitant l'action correspondante.
export const DISMISSIBLE_NOTIF: ReadonlySet<NotifItem['type']> = new Set(['joined', 'levelup']);
export const isDismissibleNotif = (t: NotifItem['type']) => DISMISSIBLE_NOTIF.has(t);

export async function buildNotificationItems(playerId: string): Promise<NotifItem[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  // Fenêtre d'invite « Distribue des badges » : 48 h après la saisie du score.
  const badgeWindowAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const playerOr = [
    `winner_id.eq.${playerId}`,
    `loser_id.eq.${playerId}`,
    `winner_id_2.eq.${playerId}`,
    `loser_id_2.eq.${playerId}`,
  ].join(',');

  // "Partie à scorer" : mêmes critères que score-entry et lobby.readyToScore.
  const nowIso = new Date().toISOString();
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: acceptedGames } = await supabase
    .from('game_participants')
    .select('game_id')
    .eq('player_id', playerId)
    .eq('status', 'accepted');
  const acceptedGameIds = (acceptedGames ?? []).map((e: any) => e.game_id).filter(Boolean) as string[];
  const orParts = [
    `creator_id.eq.${playerId}`,
    ...(acceptedGameIds.length > 0 ? [`id.in.(${acceptedGameIds.join(',')})`] : []),
  ].join(',');

  const [
    { data: binomeInvites },
    { data: pending },
    { data: recentMatches },
    { data: alreadyVoted },
    { data: eloHistory },
    { data: toScoreGames },
    { data: invitations },
    { data: myGames },
    { data: dismissedRows },
    { data: dmRequests },
    { data: showcaseNoms },
    { data: badgeSkips },
  ] = await Promise.all([
    supabase
      .from('defi_applications')
      .select('id, initiator:initiator_id(name)')
      .eq('partner_id', playerId)
      .eq('status', 'pending'),
    supabase
      .from('matches')
      .select('id, status, winner:winner_id(name), submitter:created_by(name), created_by, winner_id, winner_id_2, loser_id, loser_id_2')
      .or(playerOr)
      .in('status', ['pending', 'counter_proposed']),
    supabase
      .from('matches')
      .select('id')
      .or(playerOr)
      .in('status', ['pending', 'validated'])
      .gte('created_at', badgeWindowAgo),
    supabase
      .from('reputation_votes')
      .select('match_id')
      .eq('giver_id', playerId),
    supabase
      .from('elo_history')
      .select('elo_score, elo_change, match_id')
      .eq('player_id', playerId)
      .gt('elo_change', 0)
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false }),
    supabase
      .from('open_games')
      .select('id, creator_id, match_date, status, participants:game_participants(player_id, status)')
      .neq('status', 'cancelled')
      .neq('status', 'closed')
      .lt('match_date', nowIso)
      .gte('match_date', fortyEightHoursAgo)
      .or(orParts),
    supabase
      .from('game_participants')
      .select('id, invite_expires_at, team_side, game:game_id(id, location, is_challenge, match_date, status, creator:creator_id(name))')
      .eq('player_id', playerId)
      .eq('status', 'invited'),
    // Mes parties (créateur ou participant validé) — pour les demandes à valider.
    supabase
      .from('open_games')
      .select('id, location, status, match_date')
      .neq('status', 'cancelled')
      .or(orParts),
    // Notifs "info" déjà supprimées par l'utilisateur (joined / levelup).
    supabase
      .from('dismissed_notifications')
      .select('notif_key')
      .eq('player_id', playerId),
    // Demandes de message directes (DM) en attente, adressées à moi.
    supabase
      .from('direct_conversations')
      .select('id, requester_id, requester:players!requester_id(name)')
      .eq('addressee_id', playerId)
      .eq('status', 'pending'),
    // Nominations de binôme en vitrine à confirmer (on me propose comme binôme ouvert).
    supabase
      .from('showcase_binomes')
      .select('id, a:player_a(name)')
      .eq('player_b', playerId)
      .eq('status', 'pending'),
    supabase
      .from('badge_prompt_skips')
      .select('match_id')
      .eq('player_id', playerId),
  ]);

  const dismissedKeys = new Set((dismissedRows ?? []).map((d: any) => d.notif_key));

  // Modération : masquer les défis émis par un joueur bloqué (deux sens).
  const hidden = await getHiddenPlayerIds(playerId);

  const votedIds = new Set((alreadyVoted ?? []).map((v: any) => v.match_id));
  const skippedIds = new Set((badgeSkips ?? []).map((s: any) => s.match_id));
  const unvotedCount = (recentMatches ?? [])
    .filter((m: any) => !votedIds.has(m.id) && !skippedIds.has(m.id)).length;

  // "Partie à scorer" — point de vérité unique lib/games.isGameReadyToScore
  // (partagé avec badge / lobby / score-entry). Occupation dérivée des
  // participants (jamais spots_available), + exclusion des parties déjà scorées.
  const toScoreIds = (toScoreGames ?? []).map((g: any) => g.id).filter(Boolean);
  let scoredToScore = new Set<string>();
  if (toScoreIds.length > 0) {
    const { data: scoredRows } = await supabase
      .from('matches').select('game_id').in('game_id', toScoreIds).in('status', ['pending', 'validated']);
    scoredToScore = new Set((scoredRows ?? []).map((m: any) => m.game_id).filter(Boolean));
  }
  const toScoreCount = (toScoreGames ?? []).filter((g: any) => isGameReadyToScore(g, playerId, scoredToScore)).length;

  // Scores qui attendent une action de ma part — point de vérité unique
  // lib/matches.matchNeedsMyAction (partagé avec badge + lobby) : 'validate'
  // (score d'un adversaire à valider) ou 'resolve' (mon score contesté à régler).
  const visiblePending = (pending ?? [])
    .map((m: any) => ({ m, action: matchNeedsMyAction(m, playerId) }))
    .filter((x: any) => x.action !== null);

  // Detect most recent league or full-level promotion in the last 7 days
  const levelUpEntry = (eloHistory ?? []).find((h: any) => {
    const prevElo = h.elo_score - h.elo_change;
    const leagueChanged = getLeague(h.elo_score) !== getLeague(prevElo);
    const levelIncreased = Math.floor(eloToLevel(h.elo_score)) > Math.floor(eloToLevel(prevElo));
    return leagueChanged || levelIncreased;
  });

  // Anti-doublon défi 1v1 supprimé : les invitations binôme (defi_applications)
  // n'ont pas de game_id associé à ce stade — aucun doublon possible avec
  // game_participants 'invited'. On passe un Set vide à isInvitationVisible.
  const challengeGameIds = new Set<string>();

  // Invitations actives — point de vérité unique partagé avec le badge
  // (lib/games.isInvitationVisible) : TTL, anti-doublon défi, partie
  // non close/annulée/passée.
  const activeInvites = (invitations ?? []).filter((inv: any) => isInvitationVisible(inv, challengeGameIds));

  // Demandes à valider — candidatures 'pending' sur mes parties (créateur ou
  // participant validé) que je n'ai pas encore approuvées. Lien → carte détail.
  const myGameById = new Map((myGames ?? []).map((g: any) => [g.id, g]));
  const validReqGameIds = (myGames ?? []).filter((g: any) => {
    if (g.status === 'closed' || g.status === 'cancelled') return false;
    if (g.match_date && new Date(g.match_date).getTime() < Date.now()) return false;
    return true;
  }).map((g: any) => g.id);

  let pendingReqItems: NotifItem[] = [];
  let joinedItems: NotifItem[] = [];
  if (validReqGameIds.length > 0) {
    const { data: reqs } = await supabase
      .from('game_participants')
      .select('id, game_id, player_id, approvals, player:player_id(name)')
      .in('game_id', validReqGameIds)
      .eq('status', 'pending');
    pendingReqItems = (reqs ?? [])
      .filter((r: any) => r.player_id !== playerId && !(r.approvals ?? []).includes(playerId))
      .map((r: any) => {
        const g = myGameById.get(r.game_id);
        const where = g?.location ? ` à ${g.location}` : '';
        return {
          id: `req-${r.id}`,
          type: 'to_approve' as const,
          title: 'Demande à valider',
          subtitle: `${r.player?.name ?? 'Un joueur'} veut rejoindre la partie${where}`,
          route: `/(tabs)/lobby?gameId=${r.game_id}`,
        };
      });

    // Joined events — accepted participants sur mes parties dans les 7 derniers jours,
    // que ce soit auto-accept, invitation acceptée ou candidature approuvée.
    const { data: joined } = await supabase
      .from('game_participants')
      .select('id, game_id, player_id, approvals, created_at, player:player_id(name)')
      .in('game_id', validReqGameIds)
      .eq('status', 'accepted')
      .neq('player_id', playerId)
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false });
    joinedItems = (joined ?? []).map((j: any) => {
      const g = myGameById.get(j.game_id);
      const where = g?.location ? ` à ${g.location}` : '';
      const wasApproved = (j.approvals ?? []).length > 0;
      return {
        id: `joined-${j.id}`,
        type: 'joined' as const,
        title: wasApproved ? '✅ Candidature acceptée' : '👋 Nouveau joueur',
        subtitle: `${j.player?.name ?? 'Un joueur'} a rejoint la partie${where}`,
        route: `/(tabs)/lobby?gameId=${j.game_id}`,
      };
    });
  }

  // Demandes de message (DM) : une carte par personne (→ « plusieurs » si
  // plusieurs demandes). Masque les demandeurs bloqués (deux sens).
  const dmRequestItems: NotifItem[] = (dmRequests ?? [])
    .filter((c: any) => !hidden.has(c.requester_id))
    .map((c: any) => ({
      id: `dmreq-${c.id}`,
      type: 'dm_request' as const,
      title: 'Demande de message',
      subtitle: `${c.requester?.name ?? 'Quelqu’un'} souhaite te contacter`,
      route: `/dm/${c.id}`,
    }));

  const result: NotifItem[] = [
    ...dmRequestItems,
    ...pendingReqItems,
    ...joinedItems,
    ...activeInvites.map((inv: any) => {
      const isChall = !!inv.game?.is_challenge;
      const who = inv.game?.creator?.name ?? '?';
      const where = inv.game?.location ? ` à ${inv.game.location}` : '';
      // Sur un défi 2v2, une invitation = binôme du créateur (Team A) OU adversaire
      // ciblé (Team B). Seul le camp B est réellement « défié en duel » ; le camp A
      // est invité à FORMER le binôme du créateur.
      const isPartner = isChall && String(inv.team_side ?? '').startsWith('A');
      return {
        id: `invitation-${inv.id}`,
        type: (isChall ? 'challenge' : 'invitation') as 'challenge' | 'invitation',
        title: isPartner ? 'Invitation binôme' : isChall ? '⚡ Défi reçu' : '✉️ Invitation reçue',
        subtitle: isPartner
          ? `${who} t'invite comme binôme pour un défi${where}`
          : isChall ? `${who} te défie en duel${where}` : `${who} t'invite à jouer${where}`,
        route: `/(tabs)/lobby?gameId=${inv.game.id}`,
      };
    }),
    // Invitations binôme : requête déjà filtrée partner_id + status='pending',
    // RLS garantit la visibilité — pas de filtre supplémentaire nécessaire.
    ...(binomeInvites ?? []).map((a: any) => ({
      id: `binome-${a.id}`,
      type: 'challenge' as const,
      title: 'Invitation à un défi',
      subtitle: `${a.initiator?.name ?? '?'} t'invite à relever un défi avec lui`,
      route: '/(tabs)/matchmaking?tab=mes',
    })),
    // Nominations de binôme en vitrine à confirmer → route vers MON profil
    // (section « À confirmer » du gestionnaire de vitrine).
    ...(showcaseNoms ?? []).map((s: any) => ({
      id: `showcase-${s.id}`,
      type: 'challenge' as const,
      title: 'Proposition de binôme',
      subtitle: `${s.a?.name ?? '?'} veut être ton binôme de défis — confirme depuis ton profil.`,
      route: `/(tabs)/player/${playerId}?showcase=1`,
    })),
    ...visiblePending.map(({ m, action }: any) => action === 'resolve' ? {
      id: `match-${m.id}`,
      type: 'match' as const,
      title: 'Score contesté',
      subtitle: 'Ton score a été contesté — accepte ou signale un litige',
      route: '/(tabs)/lobby?tab=history&openValidation=1',
    } : {
      id: `match-${m.id}`,
      type: 'match' as const,
      title: 'Score à valider',
      subtitle: `Soumis par ${m.submitter?.name ?? m.winner?.name ?? '?'}`,
      route: '/(tabs)/lobby?tab=history&openValidation=1',
    }),
    ...((toScoreCount ?? 0) > 0 ? [{
      id: 'to-score',
      type: 'to_score' as const,
      title: 'Partie à scorer',
      subtitle: `${toScoreCount} partie${(toScoreCount ?? 0) > 1 ? 's' : ''} en attente de score`,
      route: '/(tabs)/lobby?tab=history',
    }] : []),
    ...(unvotedCount > 0 ? [{
      id: 'badge-prompt',
      type: 'badge' as const,
      title: unvotedCount > 1 ? `Distribue des badges · ${unvotedCount} matchs` : 'Distribue des badges',
      subtitle: unvotedCount > 1
        ? `Attribue des badges à tes coéquipiers sur ${unvotedCount} matchs`
        : 'Attribue des badges à tes coéquipiers',
      route: '/(tabs)?openBadge=1',
    }] : []),
    ...(levelUpEntry ? [{
      id: `levelup-${levelUpEntry.match_id ?? 'last'}`,
      type: 'levelup' as const,
      title: 'Montée de niveau 🎉',
      subtitle: (() => {
        const prev = levelUpEntry.elo_score - levelUpEntry.elo_change;
        if (getLeague(levelUpEntry.elo_score) !== getLeague(prev)) {
          return `Tu es passé en ligue ${getLeagueLabel(getLeague(levelUpEntry.elo_score))} !`;
        }
        return `Tu as atteint le niveau ${Math.floor(eloToLevel(levelUpEntry.elo_score))} !`;
      })(),
      route: '/(tabs)',
    }] : []),
  ];

  // Retirer les notifs "info" déjà supprimées par l'utilisateur.
  return result.filter(it => !(isDismissibleNotif(it.type) && dismissedKeys.has(it.id)));
}
