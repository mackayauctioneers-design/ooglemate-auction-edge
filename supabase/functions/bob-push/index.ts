import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Bob push notification types
type BobAlertType = 'upcoming_watched' | 'auction_reminder' | 'passed_in' | 'price_drop' | 'buy_signal';

interface BobPushRequest {
  dealer_name: string;
  alert_type: BobAlertType;
  vehicle: {
    year?: number;
    make: string;
    model: string;
    variant?: string;
  };
  context: {
    auction_house?: string;
    location?: string;
    auction_time?: string;
    lot_id?: string;
    price_drop_amount?: number;
    current_price?: number;
    estimated_margin?: number;
  };
  // Full context for Bob to speak on tap
  speak_context?: string;
}

// Generate short, direct Bob-style notification
function generateBobNotification(req: BobPushRequest): { title: string; body: string } {
  const vehicle = `${req.vehicle.year || ''} ${req.vehicle.make} ${req.vehicle.model}`.trim();
  
  switch (req.alert_type) {
    case 'upcoming_watched':
      return {
        title: 'Bob: Heads up',
        body: `${vehicle} coming up — ${req.context.auction_house || 'Auction'} ${req.context.location || ''} ${req.context.auction_time || 'soon'}.`
      };
    
    case 'auction_reminder':
      return {
        title: 'Bob: Time check',
        body: `${vehicle} goes in 15 — ${req.context.auction_house || ''} ${req.context.location || ''}.`
      };
    
    case 'passed_in':
      return {
        title: 'Bob: Passed in',
        body: `${vehicle} — money looks right. Want me to run it past Macca?`
      };
    
    case 'price_drop':
      const dropAmount = req.context.price_drop_amount 
        ? `Down $${req.context.price_drop_amount.toLocaleString()}` 
        : 'Price dropped';
      return {
        title: 'Bob: Movement',
        body: `${vehicle} — ${dropAmount}. Worth a look.`
      };
    
    case 'buy_signal':
      const margin = req.context.estimated_margin 
        ? `~$${req.context.estimated_margin.toLocaleString()} margin` 
        : 'Good margin';
      return {
        title: 'Bob: BUY',
        body: `${vehicle} — ${margin}. Ready when you are.`
      };
    
    default:
      return {
        title: 'Bob',
        body: `${vehicle} — tap for details.`
      };
  }
}

// Google Sheets access (reused from push-send)
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

const VAPID_PUBLIC_KEY = 'BLBSNvdFIW9P9y3dg4Br4k8gxlPNZGZOSwFfVfvZXxNlzJJwN0xN1rXuJCVT3C4wjqvK5c5TgFCYKqWfJqLXnw8';

async function createVapidJWT(audience: string): Promise<string> {
  const header = { alg: 'ES256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: audience,
    exp: now + 86400,
    sub: 'mailto:alerts@oglemate.com',
  };

  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${headerB64}.${payloadB64}`;
}

async function sendPush(
  endpoint: string,
  p256dh: string,
  auth: string,
  payload: object
): Promise<boolean> {
  try {
    const url = new URL(endpoint);
    const audience = `${url.protocol}//${url.host}`;
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const pushRequest: BobPushRequest = await req.json();
    
    console.log('Bob push request:', JSON.stringify(pushRequest, null, 2));

    // Generate Bob-style notification
    const notification = generateBobNotification(pushRequest);
    
    // Build URL with context for Bob to speak on tap
    const bobContext = encodeURIComponent(JSON.stringify({
      alert_type: pushRequest.alert_type,
      vehicle: pushRequest.vehicle,
      context: pushRequest.context,
      speak_context: pushRequest.speak_context,
    }));
    const tapUrl = `/valo?bob_context=${bobContext}`;

    const serviceAccountKeyJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY');
    const spreadsheetId = Deno.env.get('GOOGLE_SPREADSHEET_ID');

    if (!serviceAccountKeyJson || !spreadsheetId) {
      throw new Error('Missing Google Sheets configuration');
    }

    const serviceAccountKey = JSON.parse(serviceAccountKeyJson);
    const accessToken = await getAccessToken(serviceAccountKey);

    // Get subscriptions for this dealer
    const sheet = 'Push_Subscriptions';
    const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheet)}!A:F`;
    const readResponse = await fetch(readUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!readResponse.ok) {
      console.log('Push_Subscriptions sheet not found or empty');
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: 'No subscriptions found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await readResponse.json();
    const rows = data.values || [];

    // Filter to dealer's subscriptions
    const subscriptions = rows.slice(1).filter((row: string[]) => {
      const [rowDealer, endpoint, p256dh, auth, createdAt, enabled] = row;
      return enabled === 'Y' && endpoint && rowDealer === pushRequest.dealer_name;
    });

    console.log(`Sending Bob push to ${subscriptions.length} subscriptions for ${pushRequest.dealer_name}`);

    let sent = 0;
    for (const [rowDealer, endpoint, p256dh, auth] of subscriptions) {
      const success = await sendPush(endpoint, p256dh, auth, {
        title: notification.title,
        body: notification.body,
        url: tapUrl,
        tag: `bob-${pushRequest.alert_type}-${Date.now()}`,
        data: {
          alert_type: pushRequest.alert_type,
          vehicle: pushRequest.vehicle,
          context: pushRequest.context,
          speak_context: pushRequest.speak_context,
        }
      });
      if (success) sent++;
    }

    console.log(`Bob push sent: ${sent}/${subscriptions.length}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        sent, 
        total: subscriptions.length,
        notification 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Bob push error:', error);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
