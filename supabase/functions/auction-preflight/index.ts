import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PreflightResult {
  source_key: string;
  status: 'pass' | 'fail' | 'blocked' | 'timeout';
  reason: string;
  markers: {
    httpStatus: number;
    hasVehicleContent: boolean;
    hasPriceIndicators: boolean;
    hasLotStructure: boolean;
    estimatedLots: number;
    parserProfileDetected: string | null;
  };
}

// Marker patterns for different BidsOnline variants
const PARSER_PROFILES = {
  bidsonline_grid: {
    patterns: [
      /class=["'][^"']*(?:vehicle-grid|lot-grid|auction-grid)[^"']*["']/i,
      /class=["'][^"']*(?:card|tile)[^"']*["'][^>]*>\s*<(?:img|picture)/i,
    ],
    lotPatterns: [
      /<div[^>]*class=["'][^"']*(?:vehicle-card|lot-card|auction-card)[^"']*["']/gi,
    ],
  },
  bidsonline_table: {
    patterns: [
      /<table[^>]*class=["'][^"']*(?:vehicle|lot|auction|listing)[^"']*["']/i,
      /<tr[^>]*data-(?:lot|vehicle|item)/i,
    ],
    lotPatterns: [
      /<tr[^>]*(?:data-lot|data-vehicle|class=["'][^"']*lot)[^>]*>/gi,
    ],
  },
  bidsonline_default: {
    patterns: [
      /class=["'][^"']*(?:lot-item|vehicle-item|listing-item)[^"']*["']/i,
      /<article[^>]*class=["'][^"']*(?:lot|vehicle)[^"']*["']/i,
    ],
    lotPatterns: [
      /<div[^>]*class=["'][^"']*(?:lot-item|vehicle-card|auction-item|listing-item|stock-item)[^"']*["']/gi,
      /<article[^>]*>/gi,
    ],
  },
};

// General vehicle content markers
const VEHICLE_MARKERS = [
  /\b(toyota|mazda|ford|hyundai|kia|mitsubishi|nissan|holden|volkswagen|honda|subaru|isuzu)\b/i,
  /\b(20[12][0-9])\s+(toyota|mazda|ford|hyundai|kia)\b/i,
  /\b\d{1,3}[,\s]?\d{3}\s*km\b/i,
];

const PRICE_MARKERS = [
  /\$\s*[\d,]+/,
  /(?:reserve|guide|price)\s*:?\s*\$?\s*[\d,]+/i,
  /(?:current\s*bid|bid)\s*:?\s*\$?\s*[\d,]+/i,
  /call\s+for\s+price/i,
];

const LOT_STRUCTURE_MARKERS = [
  /(?:lot|stock)\s*#?\s*:?\s*\d+/i,
  /data-(?:lot|vehicle|item)(?:-id)?/i,
  /href=["'][^"']*\/lot[s]?\//i,
];

const BLOCKED_INDICATORS = [
  /access\s*denied/i,
  /403\s*forbidden/i,
  /captcha/i,
  /cloudflare/i,
  /bot\s*detection/i,
  /rate\s*limit/i,
];

function detectParserProfile(html: string): string | null {
  for (const [profile, config] of Object.entries(PARSER_PROFILES)) {
    if (config.patterns.some(p => p.test(html))) {
      return profile;
    }
  }
  return null;
}

function estimateLotCount(html: string, profile: string | null): number {
  const config = profile ? PARSER_PROFILES[profile as keyof typeof PARSER_PROFILES] : PARSER_PROFILES.bidsonline_default;
  let maxCount = 0;
  
  for (const pattern of config.lotPatterns) {
    const matches = html.match(pattern);
    if (matches && matches.length > maxCount) {
      maxCount = matches.length;
    }
  }
  
  return maxCount;
}

async function runPreflight(
  sourceKey: string,
  listUrl: string,
  firecrawlApiKey: string
): Promise<PreflightResult> {
  const baseResult: PreflightResult = {
    source_key: sourceKey,
    status: 'fail',
    reason: '',
    markers: {
      httpStatus: 0,
      hasVehicleContent: false,
      hasPriceIndicators: false,
      hasLotStructure: false,
      estimatedLots: 0,
      parserProfileDetected: null,
    },
  };

  try {
    // Tier 1: Direct fetch (fast, no JS)
    console.log(`[auction-preflight] Tier 1: Direct fetch for ${sourceKey}`);
    
    const directResponse = await fetch(listUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000),
    });

    baseResult.markers.httpStatus = directResponse.status;

    if (directResponse.status === 403 || directResponse.status === 401) {
      baseResult.status = 'blocked';
      baseResult.reason = `HTTP ${directResponse.status} - Access denied`;
      return baseResult;
    }

    if (!directResponse.ok) {
      baseResult.status = 'fail';
      baseResult.reason = `HTTP ${directResponse.status}`;
      return baseResult;
    }

    let html = await directResponse.text();

    // Check for blocking indicators
    if (BLOCKED_INDICATORS.some(p => p.test(html))) {
      baseResult.status = 'blocked';
      baseResult.reason = 'Blocked by security measures (captcha/cloudflare)';
      return baseResult;
    }

    // Check for vehicle markers in direct fetch
    baseResult.markers.hasVehicleContent = VEHICLE_MARKERS.some(p => p.test(html));
    baseResult.markers.hasPriceIndicators = PRICE_MARKERS.some(p => p.test(html));
    baseResult.markers.hasLotStructure = LOT_STRUCTURE_MARKERS.some(p => p.test(html));
    baseResult.markers.parserProfileDetected = detectParserProfile(html);
    baseResult.markers.estimatedLots = estimateLotCount(html, baseResult.markers.parserProfileDetected);

    // If direct fetch shows vehicle content, we're good
    if (baseResult.markers.hasVehicleContent && baseResult.markers.estimatedLots > 0) {
      baseResult.status = 'pass';
      baseResult.reason = 'Tier 1 (direct): Vehicle content detected';
      return baseResult;
    }

    // Tier 2: Firecrawl for SPA-rendered sites
    console.log(`[auction-preflight] Tier 2: Firecrawl SPA render for ${sourceKey}`);
    
    const crawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${firecrawlApiKey}`,
      },
      body: JSON.stringify({
        url: listUrl,
        formats: ['html'],
        waitFor: 5000,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!crawlResponse.ok) {
      baseResult.status = 'fail';
      baseResult.reason = `Firecrawl error: ${crawlResponse.status}`;
      return baseResult;
    }

    const crawlData = await crawlResponse.json();
    html = crawlData.data?.html || '';

    if (!html) {
      baseResult.status = 'fail';
      baseResult.reason = 'No HTML returned from Firecrawl';
      return baseResult;
    }

    // Re-check markers with SPA-rendered HTML
    baseResult.markers.hasVehicleContent = VEHICLE_MARKERS.some(p => p.test(html));
    baseResult.markers.hasPriceIndicators = PRICE_MARKERS.some(p => p.test(html));
    baseResult.markers.hasLotStructure = LOT_STRUCTURE_MARKERS.some(p => p.test(html));
    baseResult.markers.parserProfileDetected = detectParserProfile(html);
    baseResult.markers.estimatedLots = estimateLotCount(html, baseResult.markers.parserProfileDetected);

    if (baseResult.markers.hasVehicleContent && baseResult.markers.estimatedLots > 0) {
      baseResult.status = 'pass';
      baseResult.reason = 'Tier 2 (Firecrawl): Vehicle content detected';
      return baseResult;
    }

    // Failed both tiers
    baseResult.status = 'fail';
    baseResult.reason = 'No vehicle content found in either tier';
    return baseResult;

  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      baseResult.status = 'timeout';
      baseResult.reason = 'Request timeout';
    } else {
      baseResult.status = 'fail';
      baseResult.reason = error instanceof Error ? error.message : String(error);
    }
    return baseResult;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
  const supabase = createClient(supabaseUrl, supabaseKey);

  if (!firecrawlApiKey) {
    return new Response(
      JSON.stringify({ error: 'FIRECRAWL_API_KEY not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { source_key, check_all = false } = body;

    let sources: { source_key: string; list_url: string }[] = [];

    if (source_key) {
      // Check specific source
      const { data, error } = await supabase
        .from('auction_sources')
        .select('source_key, list_url')
        .eq('source_key', source_key)
        .single();
      
      if (error || !data) {
        return new Response(
          JSON.stringify({ error: `Source not found: ${source_key}` }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      sources = [data];
    } else if (check_all) {
      // Check all pending/failed sources
      const { data, error } = await supabase
        .from('auction_sources')
        .select('source_key, list_url')
        .in('preflight_status', ['pending', 'fail', 'timeout'])
        .order('created_at');
      
      if (error) throw error;
      sources = data || [];
    } else {
      // Check candidates awaiting validation
      const { data, error } = await supabase
        .from('auction_sources')
        .select('source_key, list_url')
        .eq('validation_status', 'candidate')
        .eq('preflight_status', 'pending')
        .order('created_at')
        .limit(5);
      
      if (error) throw error;
      sources = data || [];
    }

    if (sources.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No sources to check', results: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[auction-preflight] Checking ${sources.length} sources`);

    const results: PreflightResult[] = [];

    for (const src of sources) {
      const result = await runPreflight(src.source_key, src.list_url, firecrawlApiKey);
      results.push(result);

      // Update source record
      const updateData: Record<string, unknown> = {
        preflight_status: result.status,
        preflight_checked_at: new Date().toISOString(),
        preflight_reason: result.reason,
        preflight_markers: result.markers,
        updated_at: new Date().toISOString(),
      };

      // Auto-detect parser profile if not set
      if (result.markers.parserProfileDetected) {
        updateData.parser_profile = result.markers.parserProfileDetected;
      }

      // Handle validation status transitions
      if (result.status === 'pass') {
        updateData.validation_status = 'validating';
        updateData.consecutive_failures = 0;
      } else if (result.status === 'blocked') {
        updateData.validation_status = 'disabled_blocked';
        updateData.enabled = false;
        updateData.auto_disabled_at = new Date().toISOString();
        updateData.auto_disabled_reason = result.reason;
      } else if (result.status === 'fail') {
        // Increment failure counter
        const { data: current } = await supabase
          .from('auction_sources')
          .select('consecutive_failures')
          .eq('source_key', src.source_key)
          .single();
        
        const failures = (current?.consecutive_failures || 0) + 1;
        updateData.consecutive_failures = failures;
        
        // Auto-disable after 3 consecutive failures
        if (failures >= 3) {
          updateData.validation_status = 'disabled_invalid_url';
          updateData.enabled = false;
          updateData.auto_disabled_at = new Date().toISOString();
          updateData.auto_disabled_reason = `3 consecutive preflight failures: ${result.reason}`;
        }
      }

      await supabase
        .from('auction_sources')
        .update(updateData)
        .eq('source_key', src.source_key);

      console.log(`[auction-preflight] ${src.source_key}: ${result.status} - ${result.reason}`);
    }

    // Log to cron audit
    await supabase.from('cron_audit_log').upsert({
      cron_name: 'auction-preflight',
      run_date: new Date().toISOString().split('T')[0],
      success: true,
      result: {
        checked: sources.length,
        passed: results.filter(r => r.status === 'pass').length,
        failed: results.filter(r => r.status === 'fail').length,
        blocked: results.filter(r => r.status === 'blocked').length,
      },
    }, { onConflict: 'cron_name,run_date' });

    return new Response(
      JSON.stringify({
        success: true,
        checked: sources.length,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[auction-preflight] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});