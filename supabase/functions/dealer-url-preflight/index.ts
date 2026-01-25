import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Patterns that indicate a dead/lemon page
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
];

// Patterns that indicate live inventory content
const INVENTORY_SIGNALS = [
  /used.?cars?/i,
  /pre.?owned/i,
  /vehicle/i,
  /stock/i,
  /inventory/i,
  /showroom/i,
  /for sale/i,
  /price/i,
  /\$\d+/,
  /km|kilometres?|kilometers?/i,
  /make|model|year/i,
];

interface PreflightResult {
  url: string;
  status: 'valid' | 'invalid' | 'error';
  reason: string | null;
  http_status: number | null;
  inventory_signals: number;
  dead_signals: number;
}

async function validateUrl(url: string): Promise<PreflightResult> {
  const result: PreflightResult = {
    url,
    status: 'error',
    reason: null,
    http_status: null,
    inventory_signals: 0,
    dead_signals: 0,
  };

  try {
    console.log(`[preflight] Fetching: ${url}`);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    
    clearTimeout(timeout);
    result.http_status = response.status;

    // Check HTTP status
    if (response.status === 404) {
      result.status = 'invalid';
      result.reason = 'HTTP 404 - Page not found';
      return result;
    }

    if (response.status >= 500) {
      result.status = 'invalid';
      result.reason = `HTTP ${response.status} - Server error`;
      return result;
    }

    if (response.status >= 400) {
      result.status = 'invalid';
      result.reason = `HTTP ${response.status} - Client error`;
      return result;
    }

    // Parse body for content signals
    const html = await response.text();
    const bodyLower = html.toLowerCase();

    // Count dead page signals
    for (const pattern of DEAD_PAGE_PATTERNS) {
      if (pattern.test(html)) {
        result.dead_signals++;
      }
    }

    // Count inventory signals
    for (const pattern of INVENTORY_SIGNALS) {
      if (pattern.test(html)) {
        result.inventory_signals++;
      }
    }

    console.log(`[preflight] ${url} - inventory_signals: ${result.inventory_signals}, dead_signals: ${result.dead_signals}`);

    // Decision logic
    if (result.dead_signals >= 3 && result.inventory_signals < 2) {
      result.status = 'invalid';
      result.reason = 'Detected dead/lemon page content';
      return result;
    }

    if (result.inventory_signals >= 2) {
      result.status = 'valid';
      result.reason = 'Inventory content detected';
      return result;
    }

    // Ambiguous - mark as valid but with low confidence
    result.status = 'valid';
    result.reason = 'Page accessible, low inventory signals';
    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    if (errorMessage.includes('abort')) {
      result.reason = 'Request timeout (15s)';
    } else {
      result.reason = `Fetch error: ${errorMessage}`;
    }
    
    result.status = 'error';
    console.error(`[preflight] Error for ${url}:`, errorMessage);
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

    // Batch mode - process queued URLs
    const { data: queuedUrls, error: fetchError } = await supabase
      .from('dealer_url_queue')
      .select('id, url_canonical, domain, grok_class')
      .eq('status', status_filter)
      .is('fail_reason', null)
      .limit(batch_size);

    if (fetchError) {
      console.error('[preflight] Fetch error:', fetchError);
      throw fetchError;
    }

    if (!queuedUrls || queuedUrls.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No URLs to validate', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[preflight] Processing ${queuedUrls.length} URLs`);

    const results: PreflightResult[] = [];
    let validCount = 0;
    let invalidCount = 0;
    let errorCount = 0;

    for (const queueItem of queuedUrls) {
      const result = await validateUrl(queueItem.url_canonical);
      results.push(result);

      // Update database based on result
      if (result.status === 'invalid') {
        await supabase
          .from('dealer_url_queue')
          .update({
            status: 'failed',
            grok_class: 'invalid',
            fail_reason: result.reason,
            last_run_at: new Date().toISOString(),
          })
          .eq('id', queueItem.id);
        invalidCount++;
      } else if (result.status === 'valid') {
        // Only update grok_class if it was previously unknown
        const updates: Record<string, unknown> = {
          last_run_at: new Date().toISOString(),
        };
        
        // Keep existing grok_class if it's already set and not 'invalid'
        if (!queueItem.grok_class || queueItem.grok_class === 'invalid') {
          updates.grok_class = 'grok_safe';
        }
        
        await supabase
          .from('dealer_url_queue')
          .update(updates)
          .eq('id', queueItem.id);
        validCount++;
      } else {
        // Error - don't change status, just log
        await supabase
          .from('dealer_url_queue')
          .update({
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
      errors: errorCount,
      results,
    };

    console.log(`[preflight] Complete:`, { processed: summary.processed, valid: validCount, invalid: invalidCount });

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
