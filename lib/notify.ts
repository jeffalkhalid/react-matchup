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
    console.log('[notifyPlayers] called', { count: playerIds?.length, hasSession: !!session, title });
    if (!session) { console.log('[notifyPlayers] no session → abort'); return; }

    const res = await supabase.functions.invoke('send-push', {
      body: { playerIds, title, body, data },
    });
    console.log('[notifyPlayers] invoke result', { data: res.data, error: res.error });
  } catch (e) {
    console.log('[notifyPlayers] invoke threw', String(e));
  }
}
