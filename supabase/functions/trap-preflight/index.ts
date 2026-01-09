import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
  generic: [
    /"@type"\s*:\s*"Vehicle"/i,
    /class="[^"]*vehicle/i,
    /class="[^"]*stock/i,
    /class="[^"]*inventory/i,
  ],
};

interface PreflightResult {
  status: 'pass' | 'fail';
  reason: string;
  markers: string[];
  tier: 1 | 2;
  responseTime: number;
}

async function tier1DirectFetch(url: string, parserMode: string): Promise<PreflightResult | null> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TrapBot/1.0)',
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
      };
    }
    
    const html = await response.text();
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
    // Fall back to fail if no Firecrawl
    return {
      status: 'fail',
      reason: 'tier2_no_firecrawl_key',
      markers: [],
      tier: 2,
      responseTime: Date.now() - start,
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
        waitFor: 3000, // Wait for SPA content
      }),
    });
    
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return {
        status: 'fail',
        reason: `tier2_firecrawl_${response.status}`,
        markers: [],
        tier: 2,
        responseTime: Date.now() - start,
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
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'fail',
      reason: `tier2_error_${message.slice(0, 50)}`,
      markers: [],
      tier: 2,
      responseTime: Date.now() - start,
    };
  }
}

async function runPreflight(url: string, parserMode: string): Promise<PreflightResult> {
  // Tier 1: Direct fetch
  const tier1Result = await tier1DirectFetch(url, parserMode);
  if (tier1Result) {
    return tier1Result;
  }
  
  // Tier 2: Firecrawl for SPA sites
  console.log(`[preflight] Tier 1 inconclusive for ${url}, trying Tier 2`);
  return await tier2FirecrawlFetch(url, parserMode);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { trap_slugs, check_all_pending = false } = await req.json();

    let slugsToCheck: string[] = trap_slugs || [];

    // If checking all pending, fetch them
    if (check_all_pending) {
      const { data: pending } = await supabase
        .from('dealer_traps')
        .select('trap_slug')
        .eq('preflight_status', 'pending')
        .limit(50);
      
      slugsToCheck = pending?.map(t => t.trap_slug) || [];
    }

    if (slugsToCheck.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No traps to preflight', checked: 0 }),
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
    }> = [];

    // Process each trap
    for (const trap of traps || []) {
      console.log(`[preflight] Checking ${trap.trap_slug}: ${trap.inventory_url}`);
      
      const result = await runPreflight(trap.inventory_url, trap.parser_mode);
      
      // Update trap with preflight result
      const { error: updateError } = await supabase
        .from('dealer_traps')
        .update({
          preflight_status: result.status,
          preflight_reason: result.reason,
          last_preflight_markers: result.markers,
          preflight_checked_at: new Date().toISOString(),
        })
        .eq('trap_slug', trap.trap_slug);

      if (updateError) {
        console.error(`[preflight] Update error for ${trap.trap_slug}:`, updateError);
      }

      results.push({
        trap_slug: trap.trap_slug,
        status: result.status,
        reason: result.reason,
        tier: result.tier,
      });

      console.log(`[preflight] ${trap.trap_slug}: ${result.status} (${result.reason}) - ${result.responseTime}ms`);
    }

    const passed = results.filter(r => r.status === 'pass').length;
    const failed = results.filter(r => r.status === 'fail').length;

    console.log(`[preflight] Complete: ${passed} passed, ${failed} failed`);

    return new Response(
      JSON.stringify({
        message: 'Preflight complete',
        checked: results.length,
        passed,
        failed,
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
