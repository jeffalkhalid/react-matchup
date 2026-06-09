import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface PushPayload {
  playerIds: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } });
  }

  try {
    const { playerIds, title, body, data }: PushPayload = await req.json();
    if (!playerIds?.length) return new Response('ok');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Fetch push tokens for the given player IDs
    const { data: players, error } = await supabase
      .from('players')
      .select('push_token')
      .in('id', playerIds)
      .not('push_token', 'is', null);

    if (error) throw error;

    const tokens = (players ?? [])
      .map((p: { push_token: string | null }) => p.push_token)
      .filter((t): t is string => !!t && t.startsWith('ExponentPushToken'));

    if (!tokens.length) return new Response('ok');

    // Send to Expo push service.
    // `priority: 'high'` + `channelId` sont requis pour le heads-up (pop-up)
    // Android : sans eux la notif arrive (icône) mais sans bannière. Le canal
    // 'default' est créé côté app avec une importance MAX (usePushNotifications).
    const messages = tokens.map(to => ({
      to, title, body, data,
      sound: 'default',
      badge: 1,
      priority: 'high',
      channelId: 'default',
    }));
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Accept-Encoding': 'gzip, deflate' },
      body: JSON.stringify(messages),
    });

    return new Response(JSON.stringify({ sent: tokens.length }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
