import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Types
interface SaleFingerprint {
  fingerprint_id: string;
  dealer_name: string;
  dealer_whatsapp?: string;
  expires_at: string;
  make: string;
  model: string;
  variant_normalised: string;
  variant_family?: string;
  year: number;
  sale_km: number;
  min_km?: number;
  max_km?: number;
  is_active: string;
  fingerprint_type?: string;
  do_not_buy?: string;
}

interface Listing {
  lot_id: string;
  lot_key?: string;
  listing_url?: string;
  auction_house?: string;
  location?: string;
  auction_datetime?: string;
  make: string;
  model: string;
  variant_raw?: string;
  variant_normalised?: string;
  variant_family?: string;
  year: number;
  km?: number;
  status?: string;
  pass_count?: number;
  relist_count?: number;
  reserve?: number;
  price_change_pct?: number;
  estimated_margin?: number;
}

type PicklesAlertType = 'UPCOMING' | 'ACTION';
type PicklesActionReason = 'passed_in' | 'relisted' | 'reserve_softened' | 'price_drop';

interface ProcessAlertsRequest {
  lots: Listing[];
  alertType: PicklesAlertType;
  previousStates?: Record<string, { status: string; price: number }>;
}

// Variant family extraction (simplified version)
const VARIANT_FAMILY_TOKENS = [
  'SR5', 'GXL', 'GX', 'GL', 'SR', 'RUGGED', 'RUGGED X', 'ROGUE', 'WORKMATE', 'SAHARA', 'VX', 'KAKADU', 'GR',
  'XLT', 'WILDTRAK', 'FX4', 'SPORT', 'RAPTOR', 'XL', 'XLS', 'TREND', 'ST',
  'LT', 'LTZ', 'Z71', 'ZR2', 'LS', 'SS', 'SSV', 'SV6', 'REDLINE', 'RS',
  'LS-M', 'LS-U', 'LS-T', 'SX', 'X-TERRAIN',
  'GLX', 'GLS', 'GSR', 'EXCEED', 'TOBY PRICE',
  'ST-X', 'PRO-4X', 'SL', 'N-TREK', 'WARRIOR',
  'GT', 'XTR', 'GSX', 'TOURING', 'BOSS',
  'SPORTLINE', 'CORE', 'STYLE', 'LIFE', 'CANYON',
  'LIMITED', 'PREMIUM', 'PLATINUM', 'TITANIUM', 'ULTIMATE',
];

function extractVariantFamily(variantText?: string): string | undefined {
  if (!variantText) return undefined;
  const normalized = variantText.toUpperCase();
  const sortedTokens = [...VARIANT_FAMILY_TOKENS].sort((a, b) => b.length - a.length);
  for (const token of sortedTokens) {
    const pattern = new RegExp(`\\b${token.replace(/-/g, '[\\s-]?')}\\b`, 'i');
    if (pattern.test(normalized)) {
      return token.toUpperCase();
    }
  }
  return undefined;
}

// Tier 1 matching
function isTier1Match(lot: Listing, fp: SaleFingerprint): boolean {
  if (fp.is_active !== 'Y') return false;
  
  const today = new Date();
  const expiresAt = new Date(fp.expires_at);
  if (today > expiresAt) return false;
  
  if (fp.do_not_buy === 'Y') return false;
  
  if (lot.make.toLowerCase() !== fp.make.toLowerCase()) return false;
  if (lot.model.toLowerCase() !== fp.model.toLowerCase()) return false;
  
  const lotVariantFamily = lot.variant_family || extractVariantFamily(lot.variant_raw || lot.variant_normalised);
  const fpVariantFamily = fp.variant_family || extractVariantFamily(fp.variant_normalised);
  
  if (!lotVariantFamily || !fpVariantFamily) {
    const lotVariant = (lot.variant_normalised || lot.variant_raw || '').toLowerCase().trim();
    const fpVariant = (fp.variant_normalised || '').toLowerCase().trim();
    if (lotVariant !== fpVariant) return false;
  } else if (lotVariantFamily.toUpperCase() !== fpVariantFamily.toUpperCase()) {
    return false;
  }
  
  if (Math.abs(lot.year - fp.year) > 2) return false;
  
  if (fp.fingerprint_type !== 'spec_only' && fp.sale_km && fp.sale_km > 0) {
    const minKm = fp.min_km ?? Math.max(0, fp.sale_km - 15000);
    const maxKm = fp.max_km ?? fp.sale_km + 15000;
    if (lot.km && lot.km > 0) {
      if (lot.km < minKm || lot.km > maxKm) return false;
    }
  }
  
  return true;
}

// Determine action reason
function determineActionReason(
  lot: Listing,
  previousState?: { status: string; price: number }
): PicklesActionReason | undefined {
  if (lot.status === 'passed_in' && previousState?.status !== 'passed_in') {
    return 'passed_in';
  }
  
  if ((lot.pass_count || 0) >= 2 && (lot.relist_count || 0) > 0) {
    return 'relisted';
  }
  
  if (previousState?.price && lot.reserve && lot.reserve < previousState.price) {
    const dropPct = ((previousState.price - lot.reserve) / previousState.price) * 100;
    if (dropPct >= 5) return 'reserve_softened';
  }
  
  if (lot.price_change_pct && lot.price_change_pct <= -5) {
    return 'price_drop';
  }
  
  return undefined;
}

// Generate alert message
function generateAlertMessage(
  lot: Listing,
  alertType: PicklesAlertType,
  actionReason?: PicklesActionReason
): string {
  const vehicle = `${lot.year} ${lot.make} ${lot.model} ${lot.variant_normalised || lot.variant_raw || ''}`.trim();
  
  if (alertType === 'UPCOMING') {
    return `${vehicle} coming up – ${lot.auction_house || 'Pickles'} ${lot.location || ''}`.trim();
  }
  
  switch (actionReason) {
    case 'passed_in':
      return `${vehicle} passed in – ready for negotiation`;
    case 'relisted':
      return `${vehicle} relisted (pass #${lot.pass_count || 2}) – seller getting motivated`;
    case 'reserve_softened':
      return `${vehicle} reserve dropped – worth another look`;
    case 'price_drop':
      return `${vehicle} price dropped – check the numbers`;
    default:
      return `${vehicle} – action opportunity`;
  }
}

// Generate dedup key
function generateDedupKey(
  dealerName: string,
  lotId: string,
  alertType: PicklesAlertType,
  actionReason?: PicklesActionReason
): string {
  const today = new Date().toISOString().split('T')[0];
  return `${dealerName}|${lotId}|${alertType}|${actionReason || 'new'}|${today}`;
}

// Google Sheets API helpers
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

async function readSheet(accessToken: string, spreadsheetId: string, sheet: string): Promise<any[]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheet)}!A:ZZ`;
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  
  if (!response.ok) {
    console.log(`Sheet ${sheet} not found or empty`);
    return [];
  }
  
  const data = await response.json();
  const rows = data.values || [];
  if (rows.length < 2) return [];
  
  const headers = rows[0].map((h: string) => h.toLowerCase().trim());
  return rows.slice(1).map((row: string[], index: number) => {
    const obj: any = { _rowIndex: index + 2 };
    headers.forEach((header: string, i: number) => {
      obj[header] = row[i] || '';
    });
    return obj;
  });
}

async function appendSheet(accessToken: string, spreadsheetId: string, sheet: string, data: Record<string, any>): Promise<void> {
  // First get headers
  const headersUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheet)}!1:1`;
  const headersResponse = await fetch(headersUrl, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  
  let headers: string[] = [];
  if (headersResponse.ok) {
    const headersData = await headersResponse.json();
    headers = headersData.values?.[0] || [];
  }
  
  // Map data to row
  const row = headers.map((h: string) => {
    const key = h.toLowerCase().trim();
    const value = data[key];
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return JSON.stringify(value);
    return String(value);
  });
  
  const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheet)}!A:ZZ:append?valueInputOption=USER_ENTERED`;
  await fetch(appendUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [row] }),
  });
}

// Send Bob push notification
async function sendBobPush(
  dealerName: string,
  lot: Listing,
  alertType: PicklesAlertType,
  actionReason?: PicklesActionReason
): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
  
  if (!supabaseUrl || !supabaseKey) {
    console.log('Missing Supabase config for push');
    return;
  }
  
  const pushAlertType = alertType === 'UPCOMING' ? 'upcoming_watched' : 
    (actionReason === 'passed_in' ? 'passed_in' : 
    (actionReason === 'reserve_softened' || actionReason === 'price_drop' ? 'price_drop' : 'buy_signal'));
  
  const payload = {
    dealer_name: dealerName,
    alert_type: pushAlertType,
    vehicle: {
      year: lot.year,
      make: lot.make,
      model: lot.model,
      variant: lot.variant_family || lot.variant_normalised || lot.variant_raw,
    },
    context: {
      auction_house: lot.auction_house || 'Pickles',
      location: lot.location,
      auction_time: lot.auction_datetime,
      lot_id: lot.lot_key || lot.lot_id,
      estimated_margin: lot.estimated_margin,
    },
    speak_context: generateAlertMessage(lot, alertType, actionReason),
  };
  
  try {
    await fetch(`${supabaseUrl}/functions/v1/bob-push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    console.log(`Push sent to ${dealerName} for ${lot.lot_id}`);
  } catch (err) {
    console.error(`Push failed for ${dealerName}:`, err);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { lots, alertType, previousStates = {} }: ProcessAlertsRequest = await req.json();
    
    console.log(`Processing ${lots.length} lots for ${alertType} alerts`);
    
    const serviceAccountKeyJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY');
    const spreadsheetId = Deno.env.get('GOOGLE_SPREADSHEET_ID');

    if (!serviceAccountKeyJson || !spreadsheetId) {
      throw new Error('Missing Google Sheets configuration');
    }

    const serviceAccountKey = JSON.parse(serviceAccountKeyJson);
    const accessToken = await getAccessToken(serviceAccountKey);

    // Read fingerprints
    const fingerprintsRaw = await readSheet(accessToken, spreadsheetId, 'Sale_Fingerprints');
    const fingerprints: SaleFingerprint[] = fingerprintsRaw.map(row => ({
      fingerprint_id: row.fingerprint_id || '',
      dealer_name: row.dealer_name || '',
      dealer_whatsapp: row.dealer_whatsapp || '',
      expires_at: row.expires_at || '',
      make: row.make || '',
      model: row.model || '',
      variant_normalised: row.variant_normalised || '',
      variant_family: row.variant_family || undefined,
      year: parseInt(row.year) || 0,
      sale_km: parseInt(row.sale_km) || 0,
      min_km: row.min_km ? parseInt(row.min_km) : undefined,
      max_km: row.max_km ? parseInt(row.max_km) : undefined,
      is_active: row.is_active || 'N',
      fingerprint_type: row.fingerprint_type || 'full',
      do_not_buy: row.do_not_buy || 'N',
    }));
    
    console.log(`Loaded ${fingerprints.length} fingerprints`);
    
    // Read existing alerts for deduplication
    const existingAlerts = await readSheet(accessToken, spreadsheetId, 'Alert_Log');
    const existingDedupKeys = new Set(existingAlerts.map(a => a.dedup_key));
    
    let alertsCreated = 0;
    let matchesFound = 0;
    let duplicatesSkipped = 0;
    
    for (const lot of lots) {
      // Find matching fingerprints
      const matches = fingerprints.filter(fp => isTier1Match(lot, fp));
      
      if (matches.length === 0) continue;
      matchesFound += matches.length;
      
      // Determine action reason for ACTION alerts
      let actionReason: PicklesActionReason | undefined;
      if (alertType === 'ACTION') {
        const prevState = previousStates[lot.lot_id];
        actionReason = determineActionReason(lot, prevState);
        
        // Skip if no actionable change detected
        if (!actionReason) continue;
      }
      
      // Create alerts for each matching fingerprint
      for (const fp of matches) {
        const dedupKey = generateDedupKey(
          fp.dealer_name,
          lot.lot_key || lot.lot_id,
          alertType,
          actionReason
        );
        
        // Check deduplication
        if (existingDedupKeys.has(dedupKey)) {
          duplicatesSkipped++;
          console.log(`Skipped duplicate: ${dedupKey}`);
          continue;
        }
        
        // Create alert entry
        const alert = {
          alert_id: `ALT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          created_at: new Date().toISOString(),
          dealer_name: fp.dealer_name,
          recipient_whatsapp: fp.dealer_whatsapp || '',
          channel: 'in_app',
          lot_id: lot.lot_key || lot.lot_id,
          fingerprint_id: fp.fingerprint_id,
          action_change: alertType === 'UPCOMING' ? 'UPCOMING' : `ACTION:${actionReason}`,
          message_text: generateAlertMessage(lot, alertType, actionReason),
          link: lot.listing_url || '',
          status: 'new',
          dedup_key: dedupKey,
          lot_make: lot.make,
          lot_model: lot.model,
          lot_variant: lot.variant_normalised || lot.variant_raw || '',
          lot_year: lot.year,
          auction_house: lot.auction_house || 'Pickles',
          auction_datetime: lot.auction_datetime || '',
          estimated_margin: lot.estimated_margin || 0,
          why_flagged: alertType === 'ACTION' ? (actionReason?.toUpperCase().replace('_', ' ') || '') : '',
        };
        
        await appendSheet(accessToken, spreadsheetId, 'Alert_Log', alert);
        existingDedupKeys.add(dedupKey); // Prevent duplicates within same batch
        alertsCreated++;
        
        console.log(`Created alert for ${fp.dealer_name}: ${lot.lot_id} (${alertType}${actionReason ? ':' + actionReason : ''})`);
        
        // Send push notification
        await sendBobPush(fp.dealer_name, lot, alertType, actionReason);
      }
    }
    
    console.log(`Alerts summary: ${alertsCreated} created, ${matchesFound} matches, ${duplicatesSkipped} duplicates skipped`);
    
    return new Response(
      JSON.stringify({
        success: true,
        alertsCreated,
        matchesFound,
        duplicatesSkipped,
        lotsProcessed: lots.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Pickles alerts error:', error);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
