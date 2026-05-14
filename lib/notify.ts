import { supabase } from './supabase';

interface NotifyOptions {
  playerIds: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

// Fire-and-forget — never throws, never blocks the UI
export async function notifyPlayers({ playerIds, title, body, data }: NotifyOptions): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    await supabase.functions.invoke('send-push', {
      body: { playerIds, title, body, data },
    });
  } catch {
    // Swallow silently — push failure must never break the UX
  }
}
