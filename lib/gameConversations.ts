// lib/gameConversations.ts — lancer la conversation d'une partie.
//
// Refonte de l'onglet Chats, lot B. Créer un match ne crée plus de fil : un
// joueur le lance, avec un premier message obligatoire. Une conversation
// vide, c'est exactement le bruit qu'on vient de supprimer — elle
// reviendrait par la porte de service.
//
// Tout se passe dans UNE transaction serveur (`start_game_conversation`,
// supabase/migrations/game_conversations.sql) : la vérification des droits,
// la date de lancement et le premier message. Le faire en deux appels depuis
// le téléphone laissait la porte ouverte à une partie marquée « lancée » sans
// message, si le second appel échouait.
import { supabase } from './supabase';
import { isMissingRelation } from './pgErrors';
import { notifyPlayers } from './notify';
import { autoTitle, firstName } from './chatList';

/** Les joueurs à prévenir : tout le monde sauf moi. */
export interface ConversationCible {
  gameId: string;
  location: string | null;
  matchDate: string;
  /** Créateur ET participants acceptés — le créateur n'est pas un participant. */
  playerIds: string[];
}

export interface StartResult {
  /** `true` quand la conversation existe désormais (ou existait déjà). */
  ok: boolean;
  /** Ce qu'on montre au joueur quand ça n'a pas marché. */
  erreur?: string;
  /** Vrai quand la conversation existait DÉJÀ : on l'ouvre au lieu d'en créer une. */
  dejaLancee?: boolean;
}

/** Traduit les refus du serveur. Les codes viennent de la RPC. */
function messageDeRefus(brut: string): string {
  if (/CHAT_EMPTY/.test(brut)) return 'Écris un premier message.';
  if (/CHAT_NOT_IN_GAME/.test(brut)) return 'Tu ne joues pas cette partie.';
  if (/CHAT_CANCELLED/.test(brut)) return 'Cette partie est annulée.';
  if (/CHAT_NO_GAME/.test(brut)) return 'Cette partie est introuvable.';
  if (/CHAT_NO_PLAYER/.test(brut)) return 'Reconnecte-toi puis réessaie.';
  if (/row-level security|policy/i.test(brut)) return "Ce message a été refusé : tu n'as pas le droit de l'écrire.";
  return "La conversation n'a pas pu être lancée.";
}

/**
 * Lance la conversation d'une partie et prévient les autres joueurs.
 *
 * Rend toujours un résultat lisible — jamais d'exception à attraper chez
 * l'appelant, qui est un écran.
 */
export async function startGameConversation(
  cible: ConversationCible,
  content: string,
  moi: { id: string; name: string },
): Promise<StartResult> {
  const texte = content.trim();
  if (!texte) return { ok: false, erreur: 'Écris un premier message.' };

  const { data, error } = await supabase.rpc('start_game_conversation', {
    p_game: cible.gameId,
    p_content: texte,
  });

  if (error) {
    if (isMissingRelation(error)) {
      return { ok: false, erreur: "Les conversations à la demande ne sont pas encore activées côté serveur." };
    }
    console.warn('[gameConversations] start', error);
    return { ok: false, erreur: messageDeRefus(error.message ?? '') };
  }

  // La RPC rend la partie telle quelle quand la conversation existait déjà.
  // On le reconnaît à la date de lancement, antérieure à cet appel.
  const lancee = (data as { chat_started_at?: string | null } | null)?.chat_started_at ?? null;
  const dejaLancee = !!lancee && Date.now() - new Date(lancee).getTime() > 5_000;

  if (!dejaLancee) {
    const autres = cible.playerIds.filter(id => id && id !== moi.id);
    if (autres.length > 0) {
      await notifyPlayers({
        playerIds: autres,
        title: `💬 ${firstName(moi.name)} a lancé le chat`,
        body: `${autoTitle(cible.matchDate, cible.location)} : ${texte}`,
        data: { type: 'game_chat', gameId: cible.gameId },
      });
    }
  }

  return { ok: true, dejaLancee };
}
