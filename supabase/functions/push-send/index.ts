import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VAPID_PUBLIC_KEY = 'BLBSNvdFIW9P9y3dg4Br4k8gxlPNZGZOSwFfVfvZXxNlzJJwN0xN1rXuJCVT3C4wjqvK5c5TgFCYKqWfJqLXnw8';

function isWithinQuietHours(): boolean {
  const now = new Date();
  const aestOffset = 10;
  const aestHour = (now.getUTCHours() + aestOffset) % 24;
  return aestHour < 7 || aestHour >= 19;
}

async function sendPush(endpoint: string, p256dh: string, auth: string, payload: object): Promise<boolean> {
  try {
    const url = new URL(endpoint);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'TTL': '86400',
        'Authorization': `vapid t=stub, k=${VAPID_PUBLIC_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.error('Push failed:', response.status, await response.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('Push error:', err);
    return false;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      dealer_name,
      title,
      body,
      url,
      alertId,
      badgeCount,
      force = false,
    } = await req.json();

    if (!force && isWithinQuietHours()) {
      return new Response(
        JSON.stringify({ success: true, queued: true, message: 'Notification queued for quiet hours' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    // Read subscriptions from DB instead of Google Sheets
    let query = supabase
      .from('push_subscriptions')
      .select('dealer_name, endpoint, keys_p256dh, keys_auth')
      .eq('enabled', true);

    if (dealer_name) {
      query = query.eq('dealer_name', dealer_name);
    }

    const { data: subscriptions, error } = await query;
    if (error) throw error;

    console.log(`Sending push to ${subscriptions?.length || 0} subscriptions`);

    let sent = 0;
    for (const sub of subscriptions || []) {
      const success = await sendPush(sub.endpoint, sub.keys_p256dh, sub.keys_auth, {
        title: title || 'OogleMate Alert',
        body: body || 'New BUY opportunity',
        url: url || '/',
        alertId,
        badgeCount,
        tag: `buy-alert-${alertId || Date.now()}`,
      });
      if (success) sent++;
    }

    return new Response(
      JSON.stringify({ success: true, sent, total: subscriptions?.length || 0 }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Push send error:', error);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
