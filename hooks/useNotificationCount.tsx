import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { showBanner } from '../lib/inAppBanner';
import { isInviteActive } from '../lib/games';
import { usePlayer } from './usePlayer';

// Single source of truth for the notification bell total, shared by the Home
// hero bell, the Profile screen AND the tab bar badges (Défi + Profil avatar)
// so they ALWAYS show the same number and update together.
// Unread chat messages are intentionally NOT included here — they belong to the
// Chats tab badge, not the notifications.
export interface NotificationCounts {
  challenges: number;   // défis reçus
  toValidate: number;   // scores à valider (saisis par un adversaire)
  invitations: number;  // invitations à une partie
  toApprove: number;    // demandes de joueurs à valider (sur mes parties)
  trophies: number;     // trophées à distribuer
  toScore: number;      // matchs à scorer (saisir le score)
  total: number;
}

const EMPTY: NotificationCounts = { challenges: 0, toValidate: 0, invitations: 0, toApprove: 0, trophies: 0, toScore: 0, total: 0 };

interface NotificationContextValue extends NotificationCounts {
  loading: boolean;
  reload: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue>({
  ...EMPTY, loading: true, reload: async () => {},
});

// Mounted once above the tabs (inside PlayerProvider) so every consumer reads
// the SAME state. Any reload() — on focus, on pull-to-refresh, or right after
// accepting/declining a défi — updates the bell, the screen counts and the tab
// badges in one shot.
export function NotificationProvider({ children }: { children: ReactNode }) {
  const { player } = usePlayer();
  const [counts, setCounts] = useState<NotificationCounts>(EMPTY);
  const [loading, setLoading] = useState(true);
  // Ensemble de mes parties (créées + acceptées) — recalculé à chaque reload et
  // lu en O(1) par l'abonnement realtime pour juger si un événement me concerne.
  const myGameIdsRef = useRef<Set<string>>(new Set());

  const reload = useCallback(async () => {
    if (!player) { setCounts(EMPTY); setLoading(false); return; }
    const id = player.id;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const h48 = now - 48 * 60 * 60 * 1000;
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const playerOr = `winner_id.eq.${id},winner_id_2.eq.${id},loser_id.eq.${id},loser_id_2.eq.${id}`;

    // Game ids where I'm creator or accepted — needed for "à scorer".
    const [{ data: accParts }, { data: myCreated }] = await Promise.all([
      supabase.from('game_participants').select('game_id').eq('player_id', id).eq('status', 'accepted'),
      supabase.from('open_games').select('id').eq('creator_id', id).in('status', ['open', 'closed']),
    ]);
    const gameIds = [...new Set([
      ...(accParts ?? []).map((p: any) => p.game_id),
      ...(myCreated ?? []).map((g: any) => g.id),
    ])];
    myGameIdsRef.current = new Set(gameIds);

    const [
      { data: challengeRows },
      { data: pendingMatches },
      { data: invites },
      { data: recentMatches },
      { data: myVotes },
    ] = await Promise.all([
      supabase.from('challenges').select('game_id')
        .eq('challenged_id', id).eq('status', 'pending').gt('expires_at', nowIso),
      supabase.from('matches')
        .select('id, created_by, winner_id, winner_id_2, loser_id, loser_id_2, status')
        .or(playerOr).in('status', ['pending', 'counter_proposed']),
      supabase.from('game_participants')
        .select('id, game_id, invite_expires_at, game:game_id(status, match_date)').eq('player_id', id).eq('status', 'invited'),
      supabase.from('matches').select('id')
        .or(playerOr).in('status', ['pending', 'validated']).gte('created_at', sevenDaysAgo),
      supabase.from('reputation_votes').select('match_id').eq('giver_id', id),
    ]);

    // Scores à valider — mirror index.tsx visiblePending:
    //  • counter_proposed → it's the original author who responds
    //  • pending          → the opponents validate (not the author nor partner)
    const toValidate = (pendingMatches ?? []).filter((m: any) => {
      if (m.status === 'counter_proposed') return m.created_by === id;
      if (m.created_by === id) return false;
      const cb = m.created_by;
      if (
        (cb === m.winner_id   && m.winner_id_2 === id) ||
        (cb === m.winner_id_2 && m.winner_id   === id) ||
        (cb === m.loser_id    && m.loser_id_2  === id) ||
        (cb === m.loser_id_2  && m.loser_id    === id)
      ) return false;
      return true;
    }).length;

    // Anti-doublon : un défi crée à la fois une ligne `challenges` ET un
    // game_participants 'invited' sur la même partie. On exclut ces invitations
    // pour ne pas compter le défi deux fois (il est déjà dans `challenges`).
    const challengeGameIds = new Set((challengeRows ?? []).map((c: any) => c.game_id).filter(Boolean));

    // Active invitations (status='invited' on a non-past, non-cancelled game).
    const invitations = (invites ?? []).filter((inv: any) => {
      const g = inv.game;
      if (!g) return false;
      // Invitation expirée (TTL dépassé) — vérifie la date car le cron de bascule
      // 'invited' → 'expired' peut avoir jusqu'à 10 min de retard.
      if (!isInviteActive({ status: 'invited', invite_expires_at: inv.invite_expires_at })) return false;
      if (inv.game_id && challengeGameIds.has(inv.game_id)) return false;
      if (g.status === 'closed' || g.status === 'cancelled') return false;
      if (g.match_date && new Date(g.match_date).getTime() < now) return false;
      return true;
    }).length;

    // Trophées à distribuer — recent matches I haven't voted badges on.
    const votedIds = new Set((myVotes ?? []).map((v: any) => v.match_id));
    const trophies = (recentMatches ?? []).filter((m: any) => !votedIds.has(m.id)).length;

    // Matchs à scorer — mirror lobby.tsx readyToScore (full game, played < 48h, no score).
    // + Demandes à valider — candidatures 'pending' sur mes parties que je n'ai
    //   pas encore approuvées (miroir du push envoyé dans handleApply).
    let toScore = 0;
    let toApprove = 0;
    if (gameIds.length > 0) {
      const [{ data: scGames }, { data: scored }] = await Promise.all([
        supabase.from('open_games')
          .select('id, match_date, spots_available, status, creator_id, participants:game_participants(player_id, status, approvals)')
          .in('id', gameIds),
        supabase.from('matches').select('game_id').in('game_id', gameIds).in('status', ['pending', 'validated']),
      ]);
      const scoredSet = new Set((scored ?? []).map((m: any) => m.game_id).filter(Boolean));
      toScore = (scGames ?? []).filter((g: any) => {
        if (!g.match_date) return false;
        const t = new Date(g.match_date).getTime();
        if (t >= now || t < h48) return false;
        if (scoredSet.has(g.id)) return false;
        if (g.status === 'closed' || g.status === 'cancelled') return false;
        if (g.spots_available !== 0) return false;
        const isCreator = g.creator_id === id;
        const accepted = (g.participants ?? []).filter((p: any) => p.status === 'accepted');
        if (!isCreator && !accepted.some((p: any) => p.player_id === id)) return false;
        return 1 + accepted.length >= 4;
      }).length;

      toApprove = (scGames ?? []).reduce((acc: number, g: any) => {
        if (g.status === 'closed' || g.status === 'cancelled') return acc;
        if (g.match_date && new Date(g.match_date).getTime() < now) return acc;
        const pend = (g.participants ?? []).filter((p: any) =>
          p.status === 'pending' && p.player_id !== id && !(p.approvals ?? []).includes(id));
        return acc + pend.length;
      }, 0);
    }

    // Robustesse : ne pas compter un défi dont la partie est déjà acceptée par
    // moi (la ligne `challenges` a pu rester 'pending' — drift historique ou
    // réponse via un autre chemin). Miroir du filtre de l'onglet Défis reçus.
    const acceptedGameIds = new Set((accParts ?? []).map((p: any) => p.game_id));
    const challenges = (challengeRows ?? []).filter((c: any) => !c.game_id || !acceptedGameIds.has(c.game_id)).length;
    setCounts({
      challenges, toValidate, invitations, toApprove, trophies, toScore,
      total: challenges + toValidate + invitations + toApprove + trophies + toScore,
    });
    setLoading(false);
  }, [player]);

  useEffect(() => { reload(); }, [reload]);

  // ─── Realtime ────────────────────────────────────────────────
  // Source : `game_participants` (lecture publique par conception — aucune fuite
  // même sans RLS active). Chaque défi/invitation crée une ligne ici pour le
  // destinataire, et chaque demande/arrivée sur mes parties aussi → un seul
  // abonnement couvre défis, invitations, demandes à valider et joined. Le
  // compteur partagé (badge Défi, avatar Profil, cloche) se met à jour sans
  // qu'on ait besoin de naviguer, et une bannière in-app est émise pour les
  // événements importants.
  //
  // NB : pas de filtre serveur (les filtres realtime ne gèrent pas « OR » ni les
  // listes), donc on filtre la pertinence côté client via myGameIdsRef. À l'échelle
  // actuelle c'est négligeable ; un trigger DB → broadcast par utilisateur serait
  // l'optimisation suivante si le volume explose.
  useEffect(() => {
    if (!player) return;
    const me = player.id;

    // Reload débouncé : coalesce les rafales d'événements en un seul refresh.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { reload(); }, 600);
    };

    // Enrichit un événement (nom du joueur / de la partie) puis pousse la bannière.
    const emitBanner = async (
      kind: 'challenge' | 'request' | 'joined',
      row: { id: string; game_id: string; player_id: string },
    ) => {
      const [{ data: game }, { data: who }] = await Promise.all([
        supabase.from('open_games')
          .select('location, is_challenge, creator:creator_id(name)')
          .eq('id', row.game_id).maybeSingle(),
        supabase.from('players').select('name').eq('id', row.player_id).maybeSingle(),
      ]);
      const where = (game as any)?.location ? ` à ${(game as any).location}` : '';
      if (kind === 'challenge') {
        // Un défi reçu : ne pousser la bannière que si c'est bien un défi (sinon
        // c'est une invitation classique — couverte par le même flux côté compteur).
        if (!(game as any)?.is_challenge) return;
        const from = (game as any)?.creator?.name ?? 'Un joueur';
        showBanner({
          id: `challenge-${row.game_id}`,
          emoji: '⚡',
          title: 'Défi reçu',
          body: `${from} te défie en duel${where}`,
          route: '/(tabs)/matchmaking',
        });
      } else if (kind === 'request') {
        showBanner({
          id: `request-${row.id}`,
          emoji: '🙋',
          title: 'Demande à valider',
          body: `${(who as any)?.name ?? 'Un joueur'} veut rejoindre ta partie${where}`,
          route: `/(tabs)/lobby?gameId=${row.game_id}`,
        });
      } else {
        showBanner({
          id: `joined-${row.id}`,
          emoji: '👋',
          title: 'Nouveau joueur',
          body: `${(who as any)?.name ?? 'Un joueur'} a rejoint ta partie${where}`,
          route: `/(tabs)/lobby?gameId=${row.game_id}`,
        });
      }
    };

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ch = supabase
      .channel(`notif-rt:${me}:${suffix}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_participants' }, payload => {
        const row = (payload.new ?? payload.old) as any;
        if (!row?.game_id) return;
        const isMine = row.player_id === me;            // l'événement me cible directement
        const onMyGame = myGameIdsRef.current.has(row.game_id); // activité sur une de mes parties
        if (!isMine && !onMyGame) return;               // ne me concerne pas

        // Toujours rafraîchir le compteur partagé (débouncé).
        scheduleReload();

        // Bannières (best-effort, on ignore les erreurs d'enrichissement).
        const ev = payload.eventType;
        const newRow = payload.new as any;
        const oldRow = payload.old as any;
        if (isMine && ev === 'INSERT' && newRow?.status === 'invited') {
          // Défi/invitation qui m'est adressé.
          emitBanner('challenge', newRow).catch(() => {});
        } else if (onMyGame && !isMine && ev === 'INSERT' && newRow?.status === 'pending') {
          // Quelqu'un demande à rejoindre ma partie.
          emitBanner('request', newRow).catch(() => {});
        } else if (onMyGame && !isMine && newRow?.status === 'accepted') {
          // Quelqu'un a rejoint : arrivée directe (INSERT) ou invitation acceptée
          // (UPDATE invited→accepted). On exclut l'approbation d'une demande que
          // J'AI validée (UPDATE pending→accepted), que je viens de déclencher.
          const joinedNow = ev === 'INSERT' || (ev === 'UPDATE' && oldRow?.status === 'invited');
          if (joinedNow) emitBanner('joined', newRow).catch(() => {});
        }
      })
      .subscribe();

    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
  }, [player, reload]);

  return (
    <NotificationContext.Provider value={{ ...counts, loading, reload }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotificationCount() {
  return useContext(NotificationContext);
}
