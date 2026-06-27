import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { showBanner } from '../lib/inAppBanner';
import { buildNotificationItems } from '../lib/notifications';
import { usePlayer } from './usePlayer';

// Single source of truth for the notification bell total, shared by the Home
// hero bell, the Profile screen AND the tab bar badges (Défi + Profil avatar)
// so they ALWAYS show the same number and update together.
// Le total EST le nombre de cartes affichées par l'écran de notifications : les
// deux dérivent de la MÊME liste (lib/notifications.buildNotificationItems), donc
// la cloche affiche exactement ce qu'on voit en l'ouvrant — aucune divergence
// possible (trophées/à-scorer agrégés en 1 carte, joined/levelup inclus, etc.).
// Unread chat messages are intentionally NOT included here — they belong to the
// Chats tab badge, not the notifications.
export interface NotificationCounts {
  challenges: number;   // défis reçus (badge onglet Défi) — sous-ensemble du total
  total: number;        // = nombre de cartes affichées dans l'écran notifications
}

const EMPTY: NotificationCounts = { challenges: 0, total: 0 };

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

    // Ensemble de mes parties (créateur + accepté) — uniquement pour juger en O(1)
    // si un événement realtime me concerne (bannières / déclenchement reload).
    const [{ data: accParts }, { data: myCreated }] = await Promise.all([
      supabase.from('game_participants').select('game_id').eq('player_id', id).eq('status', 'accepted'),
      supabase.from('open_games').select('id').eq('creator_id', id).in('status', ['open', 'closed']),
    ]);
    myGameIdsRef.current = new Set([
      ...(accParts ?? []).map((p: any) => p.game_id),
      ...(myCreated ?? []).map((g: any) => g.id),
    ]);

    // Liste partagée avec l'écran de notifications : le total de la cloche EST le
    // nombre de cartes affichées (toScore/trophées agrégés en 1 carte, joined &
    // levelup inclus, notifs "info" supprimées déjà retirées). Le badge onglet
    // Défi (`challenges`) = uniquement les défis venant de la table `challenges`
    // (cartes `challenge-…`), pour ne pas changer son périmètre historique.
    const items = await buildNotificationItems(id);
    setCounts({
      total: items.length,
      challenges: items.filter((it) => it.id.startsWith('challenge-')).length,
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
