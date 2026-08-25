// Client du score en direct : flag, RPC, realtime, et file offline du scoreur.
// Le scoreur est l'UNIQUE écrivain ⇒ rejouer sa file locale dans l'ordre au
// retour du réseau est sûr (pas de conflit possible). File en mémoire module,
// persistée AsyncStorage pour survivre à un kill de l'app.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { LiveState } from './liveScore';

export type LiveSession = {
  id: string; game_id: string; scorer_id: string;
  team1_ids: string[]; team2_ids: string[];
  current_state: LiveState; status: 'live' | 'finished' | 'abandoned';
  contest_count: number; match_id: string | null;
  // Granularité figée au démarrage (migration live_scoring_points.sql).
  // Sessions créées avant la migration : champs absents → défauts games/true.
  scoring_mode?: 'games' | 'points'; golden_point?: boolean;
  updated_at?: string;
  // Appareil qui a la main sur la saisie (migration watch_input_device.sql).
  // Sessions antérieures : champ absent → 'phone'.
  input_device?: 'phone' | 'watch';
};

let _flagCache: boolean | null = null;
export async function getLiveScoringEnabled(): Promise<boolean> {
  if (_flagCache != null) return _flagCache;
  const { data, error } = await supabase.from('app_config').select('value').eq('key', 'live_scoring_enabled').maybeSingle();
  // Ne JAMAIS mémoriser une erreur (réseau, RLS transitoire…) : un flag figé à
  // false pour toute la vie de l'app cacherait la feature jusqu'au redémarrage.
  if (error) return false;
  _flagCache = data?.value === 'true';
  return _flagCache;
}

export async function fetchLiveSession(gameId: string): Promise<LiveSession | null> {
  const { data } = await supabase.from('live_match_sessions').select('*').eq('game_id', gameId).maybeSingle();
  return (data as LiveSession | null) ?? null;
}

export async function startLiveSession(
  gameId: string,
  opts: { mode?: 'games' | 'points'; goldenPoint?: boolean } = {},
): Promise<string> {
  const { data, error } = await supabase.rpc('start_live_session', {
    p_game_id: gameId,
    p_mode: opts.mode ?? 'games',
    p_golden: opts.goldenPoint ?? true,
  });
  if (error) throw error;
  return data as string;
}

// ── File offline (scoreur) ───────────────────────────────────────────────
type QueuedEvent = { type: string; payload: object };
const queues = new Map<string, QueuedEvent[]>();
const queueLoaders = new Map<string, Promise<QueuedEvent[]>>();
const flushing = new Set<string>();
const storageKey = (sid: string) => `live-queue:${sid}`;

// Centralised queue restore helper: memoises the PROMISE to eliminate
// check-then-act races. Loads from AsyncStorage exactly once per session,
// even if multiple taps arrive before the first load completes.
async function ensureQueue(sessionId: string): Promise<QueuedEvent[]> {
  if (!queueLoaders.has(sessionId)) {
    queueLoaders.set(sessionId, (async () => {
      if (queues.has(sessionId)) return queues.get(sessionId)!;
      try {
        const raw = await AsyncStorage.getItem(storageKey(sessionId));
        const q = raw ? JSON.parse(raw) : [];
        queues.set(sessionId, q);
        return q;
      } catch {
        const q: QueuedEvent[] = [];
        queues.set(sessionId, q);
        return q;
      }
    })());
  }
  return queueLoaders.get(sessionId)!;
}

async function flush(sessionId: string): Promise<void> {
  if (flushing.has(sessionId)) return;
  flushing.add(sessionId);
  try {
    const q = await ensureQueue(sessionId);
    while (q.length > 0) {
      const e = q[0];
      const { error } = await supabase.rpc('apply_live_event', {
        p_session_id: sessionId, p_event_type: e.type, p_payload: e.payload,
      });
      if (error) {
        // Erreurs métier (not_the_scorer, session_not_live…) : jeter l'événement,
        // il n'a plus de sens. Erreurs réseau : garder, on réessaiera.
        // `watch_has_control` en fait partie — rejouer doublerait le point. En
        // contrepartie l'optimiste local de l'écran est désormais en avance sur le
        // serveur : c'est app/live/[sessionId].tsx qui le réaligne en forçant la
        // réadoption de l'état serveur quand input_device === 'watch'.
        const msg = String(error.message ?? '');
        const business = ['not_the_scorer', 'session_not_live', 'session_not_found', 'invalid_event_type', 'not_a_participant', 'not_authenticated', 'wrong_scoring_mode', 'watch_has_control'];
        if (business.some(b => msg.includes(b))) {
          q.shift();
          // Persist after successful removal, with one retry on failure.
          // If both attempts fail, the residual risk is limited to losing this
          // one event on app kill (resolvable via undo feature; next queue write
          // will rewrite the full queue if app restarts before completing undo).
          try {
            await AsyncStorage.setItem(storageKey(sessionId), JSON.stringify(q));
          } catch {
            try {
              await AsyncStorage.setItem(storageKey(sessionId), JSON.stringify(q));
            } catch {}
          }
        } else break;
      } else {
        q.shift();
        // Persist after successful removal, with one retry on failure (see comment above).
        try {
          await AsyncStorage.setItem(storageKey(sessionId), JSON.stringify(q));
        } catch {
          try {
            await AsyncStorage.setItem(storageKey(sessionId), JSON.stringify(q));
          } catch {}
        }
      }
    }
  } finally { flushing.delete(sessionId); }
}

export async function sendLiveEvent(
  sessionId: string,
  type: 'game_won' | 'point_won' | 'undo' | 'contest' | 'contest_resolved' | 'abandoned',
  payload: object = {},
): Promise<void> {
  const q = await ensureQueue(sessionId);
  q.push({ type, payload });
  try { await AsyncStorage.setItem(storageKey(sessionId), JSON.stringify(q)); } catch {}
  await flush(sessionId);
}

// Synchronous pending count (reflects disk state only after ensureQueueLoaded
// or sendLiveEvent has run; returns 0 on cold start until then).
export function getPendingCount(sessionId: string): number {
  return queues.get(sessionId)?.length ?? 0;
}

// Wrapper to preload queue from disk. Call on screen mount to populate
// getPendingCount and ensure offline events can flush immediately.
export async function ensureQueueLoaded(sessionId: string): Promise<void> {
  await ensureQueue(sessionId);
}

// Copie (shallow) de la file en mémoire, dans l'ordre d'envoi. Permet à l'écran
// de reconstruire un état local COHÉRENT après un remontage : état serveur
// (forcément en retard des événements encore en file) + file rejouée par-dessus.
// Comme getPendingCount, ne reflète le disque qu'après ensureQueueLoaded.
export function getQueuedEvents(sessionId: string): { type: string; payload: any }[] {
  return (queues.get(sessionId) ?? []).map(e => ({ type: e.type, payload: e.payload }));
}

// Wrapper public de `flush` : relance l'envoi des événements restés en file
// (app redémarrée hors ligne, réseau revenu…). Sans appel explicite, une file
// restaurée depuis AsyncStorage n'est jamais vidée tant qu'aucun nouvel
// événement n'est envoyé. Ne throw jamais.
export async function flushQueue(sessionId: string): Promise<void> {
  try { await flush(sessionId); } catch {}
}

export function subscribeLiveSession(sessionId: string, onChange: (s: LiveSession) => void): () => void {
  const suffix = Math.random().toString(36).slice(2, 8);
  const ch = supabase
    .channel(`live-session:${sessionId}:${suffix}`)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'live_match_sessions', filter: `id=eq.${sessionId}` },
      payload => onChange(payload.new as LiveSession))
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

export async function takeOverScoring(sessionId: string): Promise<void> {
  const { error } = await supabase.rpc('take_over_scoring', { p_session_id: sessionId });
  if (error) throw error;
}

// Reprise explicite de la saisie sur CE téléphone : le seul moyen de reprendre
// la main à la montre (elle, la prend automatiquement au premier appui).
// RPC dédiée : elle ne pose AUCUN événement, donc elle ne touche ni au score
// ni au compteur de contestations.
export async function claimPhoneInput(sessionId: string): Promise<void> {
  const { error } = await supabase.rpc('claim_phone_input', { p_session_id: sessionId });
  if (error) throw error;
}

// Le match finalisé est créé `pending` et suit le circuit classique de
// validation (migration live_finalize_pending.sql) — plus de signalement 1 h.
export async function finalizeLiveSession(sessionId: string): Promise<string> {
  await flush(sessionId); // vider la file avant de finaliser
  const { data, error } = await supabase.rpc('finalize_live_session', { p_session_id: sessionId });
  if (error) throw error;
  return data as string;
}
