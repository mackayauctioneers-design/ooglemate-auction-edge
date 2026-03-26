import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VAPID_PUBLIC_KEY = 'BH8R8XwYBlOYs5qtEtAvZ4lgzONINSuFa0NmVjWYKCR7IgLd51rhDbU9L1dZJpy6I_9gf8_HfuRSgP6prQkE1z8';
const VAPID_SUBJECT = 'mailto:alerts@ooglemate.com.au';

function isWithinQuietHours(): boolean {
  const now = new Date();
  const aestOffset = 10;
  const aestHour = (now.getUTCHours() + aestOffset) % 24;
  return aestHour < 7 || aestHour >= 19;
}

// Base64url encode/decode helpers
function base64urlEncode(data: Uint8Array): string {
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Build a signed VAPID JWT
async function createVapidJwt(audience: string): Promise<string> {
  const privateKeyBase64 = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!privateKeyBase64) throw new Error('VAPID_PRIVATE_KEY not configured');

  const now = Math.floor(Date.now() / 1000);
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: now + 86400,
    sub: VAPID_SUBJECT,
  };

  const headerB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Import the raw private key for ES256 signing
  const rawKey = base64urlDecode(privateKeyBase64);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  // Sign and convert DER signature to raw r||s (64 bytes)
  const derSig = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      cryptoKey,
      new TextEncoder().encode(unsignedToken)
    )
  );

  // Web Crypto returns raw r||s on some platforms, DER on others. Handle both.
  let signature: Uint8Array;
  if (derSig.length === 64) {
    signature = derSig;
  } else {
    // Parse DER: 0x30 <len> 0x02 <rlen> <r> 0x02 <slen> <s>
    let offset = 2; // skip 0x30 <len>
    offset += 1; // 0x02
    const rLen = derSig[offset++];
    const r = derSig.slice(offset, offset + rLen);
    offset += rLen;
    offset += 1; // 0x02
    const sLen = derSig[offset++];
    const s = derSig.slice(offset, offset + sLen);
    
    signature = new Uint8Array(64);
    signature.set(r.length > 32 ? r.slice(r.length - 32) : r, 32 - Math.min(r.length, 32));
    signature.set(s.length > 32 ? s.slice(s.length - 32) : s, 64 - Math.min(s.length, 32));
  }

  return `${unsignedToken}.${base64urlEncode(signature)}`;
}

async function sendPush(endpoint: string, p256dh: string, auth: string, payload: object): Promise<boolean> {
  try {
    const url = new URL(endpoint);
    const audience = `${url.protocol}//${url.host}`;
    const jwt = await createVapidJwt(audience);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'TTL': '86400',
        'Authorization': `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`,
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

Deno.serve(async (req) => {
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
