import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePlayer } from './usePlayer';

export interface GameChat {
  id: string;
  location: string;
  match_date: string;
  is_challenge: boolean;
  game_format: string | null;
  creator_id: string;
  creator: { name: string; avatar_path?: string | null } | null;
  participants: Array<{ player_id: string; status: string; player: { name: string; avatar_path?: string | null } | null }>;
  unread: number;
  last_message_at: string | null;
  /** Le dernier message, pour l'apercu de la carte. `null` si la conversation est vide. */
  last_message: { content: string; player_id: string } | null;
  /**
   * Quand la conversation a ete LANCEE. `null` = il n'y en a pas.
   *
   * Avant, toute partie ETAIT une conversation : creer un match creait un fil
   * vide, et la liste se remplissait de conversations ou personne n'avait
   * jamais ecrit. Voir supabase/migrations/game_conversations.sql.
   */
  chat_started_at: string | null;
  archived: boolean;
}

// A chat is archived once the match score is VALIDATED, or the match is past by
// more than the grace window. A 24h grace keeps the chat active through the
// score accept/refuse flow (a pending score must NOT archive — that's exactly
// when players relaunch the discussion to settle the score).
/**
 * Un match a venir SANS conversation.
 *
 * Ce n'est PAS un `GameChat` : il n'a ni non-lus, ni dernier message, ni
 * archivage — ces champs n'ont aucun sens tant que personne n'a ecrit. Le dire
 * dans le type evite qu'un ecran lise `unread` sur un objet qui n'en a pas.
 */
export type StartableGame = Pick<
  GameChat,
  'id' | 'location' | 'match_date' | 'is_challenge' | 'game_format' | 'creator_id' | 'creator' | 'participants'
>;

export const ARCHIVE_GRACE_MS = 24 * 60 * 60 * 1000;

// Whether a match is past the active window (grace included). Shared with the
// tab badge so "active" means the same thing everywhere.
export function isMatchPast(matchDate: string | null | undefined): boolean {
  if (!matchDate) return false;
  return new Date(matchDate).getTime() + ARCHIVE_GRACE_MS < Date.now();
}

const GAME_SELECT =
  'id, location, match_date, is_challenge, game_format, creator_id, chat_started_at, creator:creator_id(name, avatar_path), participants:game_participants(player_id, status, player:player_id(name, avatar_path))';

/**
 * L'ordre d'arrivee, comme une messagerie : le dernier message en haut.
 *
 * Les non-lus ne remontent PLUS a part (refonte 4a). Une conversation qui
 * saute par-dessus les autres parce qu'elle contient un non-lu casse le seul
 * reperage qu'offre une liste de messages — l'ordre dans lequel les choses
 * sont arrivees. Le non-lu se voit deja : pastille rouge et texte en gras.
 *
 * `match_date` reste le repli des conversations sans message.
 */
export function sortGames<T extends { last_message_at: string | null; match_date: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => {
    const aTs = new Date(a.last_message_at ?? a.match_date).getTime();
    const bTs = new Date(b.last_message_at ?? b.match_date).getTime();
    return bTs - aTs;
  });
}

/**
 * Loads the player's game chats (created + accepted) with unread counts and an
 * `archived` flag, and keeps unread/order live. Shared by the Chats tab and the
 * Archived screen so both stay in sync from a single source of truth.
 */
export function useGameChats() {
  const { player } = usePlayer();
  const [games, setGames] = useState<GameChat[]>([]);
  /** Mes matchs a venir SANS conversation : de quoi en lancer une. */
  const [startableGames, setStartable] = useState<StartableGame[]>([]);
  const [loading, setLoading] = useState(true);
  const hasLoadedRef = useRef(false);
  /** Les parties deja dans la liste, lisibles depuis l'abonnement temps reel. */
  const idsRef = useRef<Set<string>>(new Set());

  const loadGames = useCallback(async () => {
    if (!player) return;
    // Stale-while-revalidate : on n'affiche le spinner qu'au tout premier
    // chargement. Sur les focus suivants, on garde la liste précédente à
    // l'écran et on rafraîchit en arrière-plan → plus de spinner à chaque visite.
    if (!hasLoadedRef.current) setLoading(true);

    // Games created by the player.
    //
    // On EXCLUT ce qui est mort ('cancelled') au lieu de LISTER ce qui est
    // vivant. Une liste à cocher a déjà coûté : le cycle de vie des défis a
    // gagné deux statuts après l'écriture de ce fichier — 'draft' (défi en
    // attente de son binôme) et 'confirmed' (defi_accept_rpc.sql : le binôme
    // adverse a verrouillé). Le lobby a été corrigé, pas cette liste : la
    // discussion d'un défi COMPLET n'apparaissait donc nulle part, ni active ni
    // archivée, alors que le bouton « Discussion » du lobby l'ouvrait — et que
    // ses messages non lus restaient invisibles dans le badge de l'onglet, qui
    // dérive de ce même hook.
    const { data: created } = await supabase
      .from('open_games').select(GAME_SELECT)
      .eq('creator_id', player.id).neq('status', 'cancelled');

    // Games where the player is an accepted participant
    const { data: joinedParts } = await supabase
      .from('game_participants').select('game_id')
      .eq('player_id', player.id).eq('status', 'accepted');
    const joinedIds = (joinedParts ?? []).map((j: any) => j.game_id);
    let joined: any[] = [];
    if (joinedIds.length > 0) {
      const { data } = await supabase
        .from('open_games').select(GAME_SELECT)
        .in('id', joinedIds).neq('status', 'cancelled').neq('creator_id', player.id);
      joined = data ?? [];
    }

    // Deduplicate
    const seen = new Set<string>();
    const all = [...(created ?? []), ...joined].filter(g => {
      if (seen.has(g.id)) return false;
      seen.add(g.id);
      return true;
    });

    // Une conversation existe quand quelqu'un l'a lancee. Le reste, ce sont
    // des matchs a venir dans lesquels on PEUT en lancer une — ils alimentent
    // la feuille « Nouvelle conversation », pas la liste.
    const maintenant = Date.now();
    const avecChat = all.filter((g: any) => !!g.chat_started_at);
    const startables = all
      .filter((g: any) => !g.chat_started_at && g.match_date && new Date(g.match_date).getTime() >= maintenant)
      .sort((a: any, b: any) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime());

    const ids = avecChat.map(g => g.id);

    // Games whose score is VALIDATED → archived. A pending score is left active
    // so the chat stays reachable during the accept/refuse-score flow.
    let scoredIds = new Set<string>();
    if (ids.length > 0) {
      const { data: scored } = await supabase
        .from('matches').select('game_id')
        .in('game_id', ids).eq('status', 'validated');
      scoredIds = new Set((scored ?? []).map((m: any) => m.game_id).filter(Boolean));
    }

    // Unread baselines
    const { data: reads } = await supabase
      .from('game_chat_reads').select('game_id, last_read_at').eq('player_id', player.id);
    const readMap = Object.fromEntries((reads ?? []).map((r: any) => [r.game_id, r.last_read_at]));

    // UNE seule requête pour le dernier message + le nombre de non-lus de TOUTES
    // les parties, au lieu de 2 requêtes par partie (N+1). On ne tire que les 3
    // colonnes nécessaires et on agrège en JS.
    const lastByGame = new Map<string, string>();
    const contentByGame = new Map<string, { content: string; player_id: string }>();
    const unreadByGame = new Map<string, number>();
    if (ids.length > 0) {
      const { data: msgs } = await supabase
        .from('messages').select('game_id, created_at, player_id, content')
        .in('game_id', ids).order('created_at', { ascending: false });
      for (const m of (msgs ?? []) as any[]) {
        // Trié du + récent au + ancien → le 1er vu par partie = son dernier message.
        if (!lastByGame.has(m.game_id)) {
          lastByGame.set(m.game_id, m.created_at);
          contentByGame.set(m.game_id, { content: m.content ?? '', player_id: m.player_id });
        }
        // Non-lus : messages des autres postérieurs à mon dernier accusé de lecture.
        const lastReadMs = new Date(readMap[m.game_id] ?? '1970-01-01').getTime();
        if (m.player_id !== player.id && new Date(m.created_at).getTime() > lastReadMs) {
          unreadByGame.set(m.game_id, (unreadByGame.get(m.game_id) ?? 0) + 1);
        }
      }
    }

    const enriched: GameChat[] = avecChat.map((game) => ({
      ...game,
      unread: unreadByGame.get(game.id) ?? 0,
      last_message_at: lastByGame.get(game.id) ?? null,
      last_message: contentByGame.get(game.id) ?? null,
      archived: scoredIds.has(game.id) || isMatchPast(game.match_date),
    }));

    setGames(sortGames(enriched));
    setStartable(startables as StartableGame[]);
    hasLoadedRef.current = true;
    setLoading(false);
  }, [player]);

  // Live updates: new messages bump unread + reorder, read receipts zero out.
  useEffect(() => {
    if (!player) return;
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const msgCh = supabase
      .channel(`chats-list-msgs:${player.id}:${suffix}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        const m = payload.new as { game_id: string; player_id: string; created_at: string; content?: string } | null;
        if (!m) return;
        // Premier message d'une partie qu'on ne suivait pas : quelqu'un vient
        // de lancer la conversation. Elle n'existe nulle part dans l'etat, il
        // faut aller la chercher — une mise a jour optimiste ne peut pas
        // inventer la partie et ses joueurs.
        if (!idsRef.current.has(m.game_id)) { loadGames(); return; }
        setGames(prev => {
          if (!prev.some(g => g.id === m.game_id)) return prev;
          return sortGames(prev.map(g => g.id !== m.game_id ? g : {
            ...g,
            last_message_at: m.created_at,
            last_message: { content: m.content ?? '', player_id: m.player_id },
            unread: m.player_id === player.id ? g.unread : g.unread + 1,
          }));
        });
      })
      .subscribe();

    const readCh = supabase
      .channel(`chats-list-reads:${player.id}:${suffix}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_chat_reads', filter: `player_id=eq.${player.id}` }, payload => {
        const r = payload.new as { game_id: string } | null;
        if (!r?.game_id) return;
        setGames(prev => prev.some(g => g.id === r.game_id)
          ? sortGames(prev.map(g => g.id === r.game_id ? { ...g, unread: 0 } : g))
          : prev);
      })
      .subscribe();

    return () => { supabase.removeChannel(msgCh); supabase.removeChannel(readCh); };
  }, [player, loadGames]);

  // L'abonnement temps reel lit cet ensemble sans dependre de l'etat React.
  useEffect(() => { idsRef.current = new Set(games.map(g => g.id)); }, [games]);

  return { games, startableGames, loading, loadGames };
}
