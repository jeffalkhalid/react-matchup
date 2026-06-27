// Tracking produit minimal — fire-and-forget, jamais bloquant, jamais d'exception.
// Dégrade en silence si la table analytics_events n'est pas (encore) appliquée.
import { supabase } from './supabase';

export type AnalyticsEvent =
  | 'activity_tab_opened'
  | 'activity_hero_join_tapped'
  | 'activity_moment_opened'
  | 'activity_like_toggled'
  | 'activity_friend_filter'
  | 'bilan_opened'
  | 'bilan_month_switched'
  | 'bilan_slide_viewed'
  | 'bilan_completed'
  | 'bilan_shared'
  | 'notif_bilan_received'
  | 'notif_bilan_tapped';

export function track(event: AnalyticsEvent, props: Record<string, unknown> = {}): void {
  // Ne jamais await côté appelant : on lance et on oublie.
  (async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id ?? null;
      await supabase.from('analytics_events').insert({ user_id: uid, event, props });
    } catch {
      // silencieux : le tracking ne doit jamais casser l'UI
    }
  })();
}
