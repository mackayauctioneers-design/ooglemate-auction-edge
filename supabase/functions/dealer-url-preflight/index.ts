import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// WAF/blocked page patterns - check FIRST (immediate reject)
const BLOCK_PATTERNS = [
  /the request is blocked/i,
  /service unavailable/i,
  /access denied/i,
  /attention required/i,
  /cloudflare/i,
  /akamai/i,
  /perimeterx/i,
  /incapsula/i,
  /bot detection/i,
  /captcha/i,
  /please verify you are human/i,
  /checking your browser/i,
  /ddos protection/i,
  /rate limit/i,
  /too many requests/i,
  /forbidden/i,
  /blocked by/i,
];

// Dead/lemon page patterns
const DEAD_PAGE_PATTERNS = [
  /404/i,
  /not found/i,
  /page not found/i,
  /server error/i,
  /resource cannot be found/i,
  /does not exist/i,
  /no longer available/i,
  /expired/i,
  /this page isn't working/i,
  /oops/i,
  /error occurred/i,
  /we couldn't find/i,
  /page you requested/i,
  /sorry, we can't find/i,
  /this vehicle has been sold/i,
  /listing has ended/i,
  /no results/i,
  /empty results/i,
];

// Structural inventory signals (site-agnostic)
const PRICE_PATTERN = /\$\s?\d{1,3}(?:,\d{3})+/g;
const KM_PATTERN = /\b\d{1,3}(?:,\d{3})?\s*(?:km|kms|kilometres?|kilometers?)\b/gi;
const ODOMETER_PATTERN = /odometer|mileage/gi;
const STOCK_PATTERN = /stock\s*(?:#|no|number)?:?\s*\w+/gi;

// Params to strip for URL canonicalization
const STRIP_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'msclkid', 'ref', 'source'];

interface PreflightResult {
  url: string;
  status: 'valid' | 'invalid' | 'needs_review' | 'error';
  reason: string | null;
  http_status: number | null;
  inventory_signals: number;
  dead_signals: number;
  block_signals: number;
  grok_mode: 'inventory_list' | 'vehicle_detail' | 'search_page' | 'blocked' | 'unknown';
}

/**
 * Canonicalize URL: force https, strip tracking params, normalize
 */
function canonicalizeUrl(rawUrl: string): string {
  let url = rawUrl.trim();
  
  // Force https
  if (url.startsWith('http://')) {
    url = url.replace('http://', 'https://');
  } else if (!url.startsWith('https://')) {
    url = 'https://' + url;
  }
  
  try {
    const parsed = new URL(url);
    
    // Strip tracking params
    STRIP_PARAMS.forEach(param => {
      parsed.searchParams.delete(param);
    });
    
    // Normalize trailing slash (remove from paths, keep for root)
    if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    
    return parsed.toString();
  } catch {
    // If URL parsing fails, return cleaned version
    return url;
  }
}

/**
 * Count structural inventory indicators
 */
function countInventoryIndicators(html: string): { prices: number; kms: number; stocks: number; odometers: number } {
  const prices = (html.match(PRICE_PATTERN) || []).length;
  const kms = (html.match(KM_PATTERN) || []).length;
  const stocks = (html.match(STOCK_PATTERN) || []).length;
  const odometers = (html.match(ODOMETER_PATTERN) || []).length;
  
  return { prices, kms, stocks, odometers };
}

/**
 * Detect page type based on URL structure
 */
function detectGrokMode(url: string, html: string): 'inventory_list' | 'vehicle_detail' | 'search_page' | 'blocked' | 'unknown' {
  const urlLower = url.toLowerCase();
  const { prices, kms } = countInventoryIndicators(html);
  
  // Search/listing pages
  if (/\/used-?cars?|\/stock|\/inventory|\/vehicles?\/?$|\/search|\/results/i.test(urlLower)) {
    return 'inventory_list';
  }
  
  // Vehicle detail pages (single vehicle)
  if (/\/vehicle\/|\/car\/|\/listing\/|\/stock\/\w+|\/used-cars?\/\w+.*\d{4}/i.test(urlLower)) {
    return 'vehicle_detail';
  }
  
  // If many prices/kms, likely a list page
  if (prices >= 5 || kms >= 5) {
    return 'inventory_list';
  }
  
  // If exactly 1 price and 1 km, likely detail
  if (prices === 1 && kms === 1) {
    return 'vehicle_detail';
  }
  
  return 'unknown';
}

async function validateUrl(url: string): Promise<PreflightResult> {
  // Canonicalize first
  const canonicalUrl = canonicalizeUrl(url);
  
  const result: PreflightResult = {
    url: canonicalUrl,
    status: 'error',
    reason: null,
    http_status: null,
    inventory_signals: 0,
    dead_signals: 0,
    block_signals: 0,
    grok_mode: 'unknown',
  };

  try {
    console.log(`[preflight] Fetching: ${canonicalUrl}`);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    
    const response = await fetch(canonicalUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-AU,en;q=0.9',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    
    clearTimeout(timeout);
    result.http_status = response.status;

    // Check HTTP status first
    if (response.status === 404) {
      result.status = 'invalid';
      result.reason = 'HTTP 404 - Page not found';
      result.grok_mode = 'blocked';
      return result;
    }

    if (response.status === 403) {
      result.status = 'invalid';
      result.reason = 'HTTP 403 - Access forbidden';
      result.grok_mode = 'blocked';
      return result;
    }

    if (response.status >= 500) {
      result.status = 'invalid';
      result.reason = `HTTP ${response.status} - Server error`;
      result.grok_mode = 'blocked';
      return result;
    }

    if (response.status >= 400) {
      result.status = 'invalid';
      result.reason = `HTTP ${response.status} - Client error`;
      result.grok_mode = 'blocked';
      return result;
    }

    // Parse body
    const html = await response.text();

    // 1. Check WAF/blocked patterns FIRST (immediate reject)
    for (const pattern of BLOCK_PATTERNS) {
      if (pattern.test(html)) {
        result.block_signals++;
      }
    }

    if (result.block_signals >= 1) {
      result.status = 'invalid';
      result.reason = 'WAF/blocked page detected';
      result.grok_mode = 'blocked';
      console.log(`[preflight] ${canonicalUrl} - BLOCKED (${result.block_signals} block signals)`);
      return result;
    }

    // 2. Count dead page signals
    for (const pattern of DEAD_PAGE_PATTERNS) {
      if (pattern.test(html)) {
        result.dead_signals++;
      }
    }

    // 3. Count structural inventory indicators
    const indicators = countInventoryIndicators(html);
    const totalInventorySignals = indicators.prices + indicators.kms + indicators.stocks + indicators.odometers;
    result.inventory_signals = totalInventorySignals;

    // 4. Detect grok mode
    result.grok_mode = detectGrokMode(canonicalUrl, html);

    console.log(`[preflight] ${canonicalUrl} - prices: ${indicators.prices}, kms: ${indicators.kms}, dead: ${result.dead_signals}, mode: ${result.grok_mode}`);

    // Decision logic (revised thresholds)
    
    // High dead signals + low inventory = invalid
    if (result.dead_signals >= 2 && totalInventorySignals < 5) {
      result.status = 'invalid';
      result.reason = 'Dead/lemon page content detected';
      return result;
    }

    // Strong inventory signals = valid (grok_safe candidate)
    // At least 5 prices OR 5 kms OR 3 stocks
    if (indicators.prices >= 5 || indicators.kms >= 5 || indicators.stocks >= 3) {
      result.status = 'valid';
      result.reason = 'Strong inventory signals detected';
      return result;
    }

    // Moderate signals = valid but note it
    if (indicators.prices >= 2 || indicators.kms >= 2) {
      result.status = 'valid';
      result.reason = 'Moderate inventory signals detected';
      return result;
    }

    // Ambiguous = needs_review (NOT valid)
    result.status = 'needs_review';
    result.reason = 'Ambiguous page - manual review needed';
    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    if (errorMessage.includes('abort')) {
      result.reason = 'Request timeout (15s)';
    } else {
      result.reason = `Fetch error: ${errorMessage}`;
    }
    
    result.status = 'error';
    console.error(`[preflight] Error for ${canonicalUrl}:`, errorMessage);
    return result;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { url, batch_size = 5, status_filter = 'queued' } = body;

    // Single URL mode
    if (url) {
      const result = await validateUrl(url);
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Batch mode - claim URLs first (concurrent-safe)
    const claimToken = crypto.randomUUID();
    
    // Step 1: Claim unclaimed queued URLs
    const { error: claimError } = await supabase
      .from('dealer_url_queue')
      .update({ 
        status: 'validating',
        last_run_at: new Date().toISOString(),
      })
      .eq('status', status_filter)
      .is('fail_reason', null)
      .limit(batch_size);

    if (claimError) {
      console.error('[preflight] Claim error:', claimError);
      throw claimError;
    }

    // Step 2: Fetch claimed URLs
    const { data: claimedUrls, error: fetchError } = await supabase
      .from('dealer_url_queue')
      .select('id, url_canonical, domain, grok_class')
      .eq('status', 'validating')
      .limit(batch_size);

    if (fetchError) {
      console.error('[preflight] Fetch error:', fetchError);
      throw fetchError;
    }

    if (!claimedUrls || claimedUrls.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No URLs to validate', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[preflight] Processing ${claimedUrls.length} URLs`);

    const results: PreflightResult[] = [];
    let validCount = 0;
    let invalidCount = 0;
    let needsReviewCount = 0;
    let errorCount = 0;

    for (const queueItem of claimedUrls) {
      const result = await validateUrl(queueItem.url_canonical);
      results.push(result);

      // Map grok_mode to grok_class
      const grokClass = result.status === 'valid' ? 'grok_safe' : 
                        result.status === 'invalid' ? 'invalid' :
                        result.status === 'needs_review' ? 'ambiguous' : 
                        queueItem.grok_class;

      // Update database based on result
      if (result.status === 'invalid') {
        await supabase
          .from('dealer_url_queue')
          .update({
            status: 'invalid',
            grok_class: 'invalid',
            fail_reason: result.reason,
            last_run_at: new Date().toISOString(),
          })
          .eq('id', queueItem.id);
        invalidCount++;
      } else if (result.status === 'valid') {
        await supabase
          .from('dealer_url_queue')
          .update({
            status: 'validated',
            grok_class: 'grok_safe',
            fail_reason: null,
            last_run_at: new Date().toISOString(),
          })
          .eq('id', queueItem.id);
        validCount++;
      } else if (result.status === 'needs_review') {
        await supabase
          .from('dealer_url_queue')
          .update({
            status: 'needs_review',
            grok_class: 'ambiguous',
            fail_reason: result.reason,
            last_run_at: new Date().toISOString(),
          })
          .eq('id', queueItem.id);
        needsReviewCount++;
      } else {
        // Error - revert to queued so it can be retried
        await supabase
          .from('dealer_url_queue')
          .update({
            status: 'queued',
            fail_reason: result.reason,
            last_run_at: new Date().toISOString(),
          })
          .eq('id', queueItem.id);
        errorCount++;
      }

      // Small delay between requests to be polite
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const summary = {
      processed: results.length,
      valid: validCount,
      invalid: invalidCount,
      needs_review: needsReviewCount,
      errors: errorCount,
      results,
    };

    console.log(`[preflight] Complete:`, { 
      processed: summary.processed, 
      valid: validCount, 
      invalid: invalidCount,
      needs_review: needsReviewCount 
    });

    return new Response(
      JSON.stringify(summary),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[preflight] Error:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
