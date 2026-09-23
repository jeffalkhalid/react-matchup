import { supabase } from './supabase';

interface NotifyOptions {
  playerIds: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

// Fire-and-forget — never throws, never blocks the UI
//
// Passe par la fonction serveur `notify_related_players` et NON plus par
// l'Edge Function `send-push` directement. Le serveur vérifie que chaque
// destinataire a un lien réel avec l'expéditeur — même partie, défi, binôme
// ou conversation — et écarte les autres en silence.
//
// Pourquoi : `send-push` acceptait n'importe quel destinataire pour n'importe
// quel appelant. Prouvé le 2026-09-23 : un appel portant la seule clé publique
// de l'app envoyait une notification au nom de PAG MATCH (faille E4).
//
// Les destinataires écartés ne font PAS échouer l'envoi : une liste
// partiellement fausse sert quand même les destinataires légitimes.
export async function notifyPlayers({ playerIds, title, body, data }: NotifyOptions): Promise<void> {
  try {
    if (!playerIds?.length) return;

    const { error } = await supabase.rpc('notify_related_players', {
      p_players: playerIds,
      p_title: title,
      p_body: body,
      p_data: data ?? {},
    });
    if (error) console.log('[notifyPlayers] refus serveur', error.message);
  } catch (e) {
    console.log('[notifyPlayers] threw', String(e));
  }
}
