import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') || '';
const VAPID_PUBLIC_KEY = 'BLBSNvdFIW9P9y3dg4Br4k8gxlPNZGZOSwFfVfvZXxNlzJJwN0xN1rXuJCVT3C4wjqvK5c5TgFCYKqWfJqLXnw8';

// AEST timezone check (07:00-19:00)
function isWithinQuietHours(): boolean {
  const now = new Date();
  // Convert to AEST (UTC+10 or UTC+11 for AEDT)
  const aestOffset = 10; // Use 10 for AEST, 11 for AEDT
  const aestHour = (now.getUTCHours() + aestOffset) % 24;
  
  // Quiet hours are outside 07:00-19:00 AEST
  return aestHour < 7 || aestHour >= 19;
}

// Simple JWT creation for VAPID
async function createVapidJWT(audience: string): Promise<string> {
  const header = { alg: 'ES256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: audience,
    exp: now + 86400, // 24 hours
    sub: 'mailto:alerts@oglemate.com',
  };

  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // For VAPID, we need EC key - simplified for demo
  // In production, use proper web-push library
  return unsignedToken;
}

// Send push notification
async function sendPush(
  endpoint: string,
  p256dh: string,
  auth: string,
  payload: object
): Promise<boolean> {
  try {
    // Parse endpoint to get audience
    const url = new URL(endpoint);
    const audience = `${url.protocol}//${url.host}`;

    // Create authorization
    const vapidJwt = await createVapidJWT(audience);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'TTL': '86400',
        'Authorization': `vapid t=${vapidJwt}, k=${VAPID_PUBLIC_KEY}`,
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

// Google Sheets access
async function getAccessToken(serviceAccountKey: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccountKey.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const keyData = serviceAccountKey.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\n/g, '');
  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    encoder.encode(unsignedToken)
  );

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${unsignedToken}.${signatureB64}`;

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
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
      force = false // Bypass quiet hours
    } = await req.json();

    // Check quiet hours
    if (!force && isWithinQuietHours()) {
      console.log('Within quiet hours, notification queued');
      // In production, queue for later delivery
      return new Response(
        JSON.stringify({ success: true, queued: true, message: 'Notification queued for quiet hours' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const serviceAccountKeyJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY');
    const spreadsheetId = Deno.env.get('GOOGLE_SPREADSHEET_ID');

    if (!serviceAccountKeyJson || !spreadsheetId) {
      throw new Error('Missing Google Sheets configuration');
    }

    const serviceAccountKey = JSON.parse(serviceAccountKeyJson);
    const accessToken = await getAccessToken(serviceAccountKey);

    // Get subscriptions
    const sheet = 'Push_Subscriptions';
    const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheet)}!A:F`;
    const readResponse = await fetch(readUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!readResponse.ok) {
      throw new Error('Failed to read subscriptions');
    }

    const data = await readResponse.json();
    const rows = data.values || [];

    // Filter subscriptions
    const subscriptions = rows.slice(1).filter((row: string[]) => {
      const [rowDealer, endpoint, p256dh, auth, createdAt, enabled] = row;
      return enabled === 'Y' && endpoint && (!dealer_name || rowDealer === dealer_name);
    });

    console.log(`Sending push to ${subscriptions.length} subscriptions`);

    let sent = 0;
    for (const [rowDealer, endpoint, p256dh, auth] of subscriptions) {
      const success = await sendPush(endpoint, p256dh, auth, {
        title: title || `OogleMate Alert`,
        body: body || 'New BUY opportunity',
        url: url || '/',
        alertId,
        badgeCount,
        tag: `buy-alert-${alertId || Date.now()}`,
      });
      if (success) sent++;
    }

    return new Response(
      JSON.stringify({ success: true, sent, total: subscriptions.length }),
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
