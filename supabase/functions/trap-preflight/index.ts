import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_CHECKS_PER_RUN = 10;

// Inventory markers by platform
const PLATFORM_MARKERS: Record<string, RegExp[]> = {
  digitaldealer: [
    /class="[^"]*vehicle[^"]*card/i,
    /class="[^"]*stock[^"]*listing/i,
    /data-vehicle-id/i,
    /"@type"\s*:\s*"Vehicle"/i,
    /class="[^"]*inventory[^"]*item/i,
    /vehicleCard|VehicleCard/,
  ],
  adtorque: [
    /class="[^"]*stock-item/i,
    /class="[^"]*vehicle-tile/i,
    /data-stockno/i,
    /adtorqueedge\.com/i,
    /class="[^"]*car-listing/i,
    /"inventory":\s*\[/i,
  ],
  // RAMP / Dealer Solutions / Indiqator platform (Toyota franchise sites)
  ramp: [
    /radius-cdn\.ramp\.indiqator\.com\.au/i,
    /indiqator/i,
    /ramp\.indiqator/i,
    /"@type"\s*:\s*"Vehicle"/i,
    /"@type"\s*:\s*"Car"/i,
    /class="[^"]*vehicle[^"]*"/i,
    /class="[^"]*stock[^"]*"/i,
    /class="[^"]*inventory[^"]*"/i,
    /class="[^"]*listing[^"]*"/i,
  ],
  generic: [
    /"@type"\s*:\s*"Vehicle"/i,
    /class="[^"]*vehicle/i,
    /class="[^"]*stock/i,
    /class="[^"]*inventory/i,
  ],
};

// Strong RAMP markers - if ANY of these are found, pass immediately on Tier1
const RAMP_STRONG_MARKERS: RegExp[] = [
  /radius-cdn\.ramp\.indiqator\.com\.au/i,
  /indiqator/i,
  /ramp\.indiqator/i,
];

interface PreflightResult {
  status: 'pass' | 'fail';
  reason: string;
  markers: string[];
  tier: 1 | 2;
  responseTime: number;
  validation_status?: string; // For failed traps
}

function categorizeFailure(reason: string): string {
  if (reason.startsWith('http_404') || reason.startsWith('http_5')) {
    return 'disabled_invalid_url';
  }
  if (reason.startsWith('http_403') || reason.includes('timeout')) {
    return 'disabled_blocked';
  }
  if (reason.includes('insufficient_markers') || reason.includes('no_html')) {
    return 'disabled_unsupported_platform';
  }
  return 'disabled_preflight_fail';
}

async function tier1DirectFetch(url: string, parserMode: string): Promise<PreflightResult | null> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timeout);
    
    if (!response.ok) {
      return {
        status: 'fail',
        reason: `http_${response.status}`,
        markers: [],
        tier: 1,
        responseTime: Date.now() - start,
        validation_status: categorizeFailure(`http_${response.status}`),
      };
    }
    
    const html = await response.text();
    
    // RAMP special handling: if parser_mode is 'ramp' and we find strong markers, PASS immediately
    if (parserMode === 'ramp') {
      const rampStrongFound: string[] = [];
      for (const marker of RAMP_STRONG_MARKERS) {
        if (marker.test(html)) {
          rampStrongFound.push(marker.source);
        }
      }
      
      // Also check for JSON-LD Vehicle schema as a strong signal
      if (/"@type"\s*:\s*"(Vehicle|Car)"/i.test(html)) {
        rampStrongFound.push('jsonld_vehicle');
      }
      
      if (rampStrongFound.length >= 1) {
        console.log(`[preflight] RAMP strong markers found for ${url}: ${rampStrongFound.join(', ')}`);
        return {
          status: 'pass',
          reason: `tier1_direct_ramp_${rampStrongFound.length}_strong`,
          markers: rampStrongFound,
          tier: 1,
          responseTime: Date.now() - start,
        };
      }
    }
    
    const markers = PLATFORM_MARKERS[parserMode] || PLATFORM_MARKERS.generic;
    const foundMarkers: string[] = [];
    
    for (const marker of markers) {
      if (marker.test(html)) {
        foundMarkers.push(marker.source);
      }
    }
    
    if (foundMarkers.length >= 2) {
      return {
        status: 'pass',
        reason: `tier1_direct_${foundMarkers.length}_markers`,
        markers: foundMarkers,
        tier: 1,
        responseTime: Date.now() - start,
      };
    }
    
    // For RAMP, if Tier1 is inconclusive but we got HTML, mark as timeout-safe (don't auto-disable)
    if (parserMode === 'ramp' && html.length > 5000) {
      return {
        status: 'pass',
        reason: 'tier1_ramp_html_present',
        markers: foundMarkers,
        tier: 1,
        responseTime: Date.now() - start,
      };
    }
    
    // Not enough markers - need tier 2
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('abort')) {
      return {
        status: 'fail',
        reason: 'tier1_timeout',
        markers: [],
        tier: 1,
        responseTime: Date.now() - start,
        validation_status: categorizeFailure('timeout'),
      };
    }
    // Network error - try tier 2
    return null;
  }
}

async function tier2FirecrawlFetch(url: string, parserMode: string): Promise<PreflightResult> {
  const start = Date.now();
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  
  if (!firecrawlKey) {
    return {
      status: 'fail',
      reason: 'tier2_no_firecrawl_key',
      markers: [],
      tier: 2,
      responseTime: Date.now() - start,
      validation_status: 'disabled_preflight_fail',
    };
  }
  
  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['html'],
        onlyMainContent: false,
        waitFor: 3000,
      }),
    });
    
    if (!response.ok) {
      return {
        status: 'fail',
        reason: `tier2_firecrawl_${response.status}`,
        markers: [],
        tier: 2,
        responseTime: Date.now() - start,
        validation_status: categorizeFailure(`tier2_firecrawl_${response.status}`),
      };
    }
    
    const data = await response.json();
    const html = data.data?.html || data.html || '';
    
    if (!html) {
      return {
        status: 'fail',
        reason: 'tier2_no_html',
        markers: [],
        tier: 2,
        responseTime: Date.now() - start,
        validation_status: categorizeFailure('no_html'),
      };
    }
    
    const markers = PLATFORM_MARKERS[parserMode] || PLATFORM_MARKERS.generic;
    const foundMarkers: string[] = [];
    
    for (const marker of markers) {
      if (marker.test(html)) {
        foundMarkers.push(marker.source);
      }
    }
    
    if (foundMarkers.length >= 2) {
      return {
        status: 'pass',
        reason: `tier2_firecrawl_${foundMarkers.length}_markers`,
        markers: foundMarkers,
        tier: 2,
        responseTime: Date.now() - start,
      };
    }
    
    return {
      status: 'fail',
      reason: `tier2_insufficient_markers_${foundMarkers.length}`,
      markers: foundMarkers,
      tier: 2,
      responseTime: Date.now() - start,
      validation_status: categorizeFailure('insufficient_markers'),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'fail',
      reason: `tier2_error_${message.slice(0, 30)}`,
      markers: [],
      tier: 2,
      responseTime: Date.now() - start,
      validation_status: 'disabled_preflight_fail',
    };
  }
}

async function runPreflight(url: string, parserMode: string): Promise<PreflightResult> {
  const tier1Result = await tier1DirectFetch(url, parserMode);
  if (tier1Result) {
    return tier1Result;
  }
  
  console.log(`[preflight] Tier 1 inconclusive for ${url}, trying Tier 2`);
  const tier2Result = await tier2FirecrawlFetch(url, parserMode);
  
  // For RAMP mode: if Tier2 times out, don't auto-disable - mark as 'timeout' status
  if (parserMode === 'ramp' && tier2Result.status === 'fail' && tier2Result.reason.includes('timeout') || tier2Result.reason.includes('408')) {
    console.log(`[preflight] RAMP tier2 timeout for ${url} - marking as timeout, not disabled`);
    return {
      ...tier2Result,
      reason: 'ramp_firecrawl_timeout',
      validation_status: undefined, // Don't auto-disable
    };
  }
  
  return tier2Result;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const { trap_slugs, check_all_pending = false, limit = MAX_CHECKS_PER_RUN } = body;

    let slugsToCheck: string[] = trap_slugs || [];

    // If checking all pending, fetch them with limit
    if (check_all_pending && !trap_slugs) {
      const { data: pending } = await supabase
        .from('dealer_traps')
        .select('trap_slug')
        .eq('preflight_status', 'pending')
        .order('created_at', { ascending: true })
        .limit(Math.min(limit, MAX_CHECKS_PER_RUN));
      
      slugsToCheck = pending?.map(t => t.trap_slug) || [];
    }

    // Get remaining count
    const { count: remainingPending } = await supabase
      .from('dealer_traps')
      .select('*', { count: 'exact', head: true })
      .eq('preflight_status', 'pending');

    if (slugsToCheck.length === 0) {
      return new Response(
        JSON.stringify({ 
          message: 'No traps to preflight', 
          checked: 0,
          remaining_pending: remainingPending || 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch trap details
    const { data: traps, error: fetchError } = await supabase
      .from('dealer_traps')
      .select('trap_slug, inventory_url, parser_mode')
      .in('trap_slug', slugsToCheck);

    if (fetchError) throw fetchError;

    const results: Array<{
      trap_slug: string;
      status: string;
      reason: string;
      tier: number;
      validation_status?: string;
    }> = [];

    // Process each trap
    for (const trap of traps || []) {
      console.log(`[preflight] Checking ${trap.trap_slug}: ${trap.inventory_url}`);
      
      const result = await runPreflight(trap.inventory_url, trap.parser_mode);
      
      // Build update payload
      const updatePayload: Record<string, unknown> = {
        preflight_status: result.status,
        preflight_reason: result.reason,
        last_preflight_markers: result.markers,
        preflight_checked_at: new Date().toISOString(),
      };

      // If failed, update validation_status to disable the trap
      if (result.status === 'fail' && result.validation_status) {
        updatePayload.validation_status = result.validation_status;
      }

      const { error: updateError } = await supabase
        .from('dealer_traps')
        .update(updatePayload)
        .eq('trap_slug', trap.trap_slug);

      if (updateError) {
        console.error(`[preflight] Update error for ${trap.trap_slug}:`, updateError);
      }

      results.push({
        trap_slug: trap.trap_slug,
        status: result.status,
        reason: result.reason,
        tier: result.tier,
        validation_status: result.validation_status,
      });

      console.log(`[preflight] ${trap.trap_slug}: ${result.status} (${result.reason}) - ${result.responseTime}ms`);
    }

    const passed = results.filter(r => r.status === 'pass').length;
    const failed = results.filter(r => r.status === 'fail').length;
    const actualRemaining = (remainingPending || 0) - results.length;

    console.log(`[preflight] Complete: ${passed} passed, ${failed} failed, ${actualRemaining} remaining`);

    // Log to cron_audit if this was an automated run
    if (check_all_pending) {
      const today = new Date().toISOString().split('T')[0];
      await supabase
        .from('cron_audit_log')
        .upsert({
          cron_name: 'trap-preflight',
          run_date: today,
          run_at: new Date().toISOString(),
          success: true,
          result: { checked: results.length, passed, failed, remaining: actualRemaining },
        }, { onConflict: 'cron_name,run_date' });
    }

    return new Response(
      JSON.stringify({
        message: 'Preflight complete',
        checked: results.length,
        passed,
        failed,
        remaining_pending: Math.max(0, actualRemaining),
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[preflight] Error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
