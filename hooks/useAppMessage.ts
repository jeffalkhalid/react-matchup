// hooks/useAppMessage.ts — va chercher le message d'accueil, et retient qu'il
// a été vu.
//
// Le « déjà vu » vit SUR LE SERVEUR, pas dans le téléphone : un joueur qui
// change d'appareil, ou qui réinstalle, ne doit pas revoir la nouveauté du
// mois dernier. Et c'est par joueur ET par message — un simple drapeau
// « il a déjà vu quelque chose » avalerait le message suivant.
import { useCallback, useEffect, useState } from 'react';
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';
import { usePlayer } from './usePlayer';
import { pickMessage, isBlocking, type AppMessage } from '../lib/appMessages';

// UNE fenêtre par ouverture de l'app. Sans ce garde-fou, revenir sur l'app
// après un changement de session rejouerait le message, et un joueur qui
// navigue verrait la même fenêtre plusieurs fois dans la journée.
let dejaMontre = false;

/** La version de l'app installée — celle du build, pas celle du bundle publié. */
export function currentAppVersion(): string {
  return (Constants.expoConfig?.version as string | undefined) ?? '';
}

export function useAppMessage() {
  const { player } = usePlayer();
  const [message, setMessage] = useState<AppMessage | null>(null);

  useEffect(() => {
    if (!player?.id || dejaMontre) return;
    let annule = false;

    (async () => {
      try {
        const { data: messages, error } = await supabase
          .from('app_messages')
          .select('id, level, title, body, cta_label, cta_url, starts_at, ends_at, min_app_version, max_app_version, active, priority, created_at')
          .eq('active', true);
        if (error || !messages || annule) return;

        const { data: vus } = await supabase
          .from('app_message_seen')
          .select('message_id')
          .eq('player_id', player.id);
        if (annule) return;

        const choisi = pickMessage(messages as AppMessage[], {
          now: new Date(),
          appVersion: currentAppVersion(),
          seenIds: (vus ?? []).map((v: any) => v.message_id),
        });
        if (choisi && !annule) { dejaMontre = true; setMessage(choisi); }
      } catch {
        // Un message d'accueil qui ne se charge pas ne doit JAMAIS empêcher
        // d'entrer dans l'app. On se tait, et on réessaiera à l'ouverture
        // suivante.
      }
    })();

    return () => { annule = true; };
  }, [player?.id]);

  /**
   * Fermer : la fenêtre disparaît tout de suite, l'enregistrement suit.
   *
   * Un message bloquant ne s'enregistre pas comme vu — il doit revenir à
   * chaque ouverture tant que l'app n'est pas mise à jour.
   */
  const dismiss = useCallback(async () => {
    const m = message;
    setMessage(null);
    if (!m || !player?.id || isBlocking(m)) return;
    try {
      await supabase.from('app_message_seen').upsert(
        { player_id: player.id, message_id: m.id, seen_at: new Date().toISOString() },
        { onConflict: 'player_id,message_id' },
      );
    } catch { /* on réaffichera une fois de trop, ce n'est pas grave */ }
  }, [message, player?.id]);

  return { message, dismiss };
}
