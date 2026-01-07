import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * fingerprint-materialize
 * 
 * Daily materialization of fingerprint outcome records.
 * Calls the materialize_fingerprint_outcomes() function to aggregate
 * vehicle_listings and clearance_events into the fingerprint_outcomes table.
 * 
 * Cron: Daily at 8am AEST (after dealer-site-crawl completes)
 */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Parse request body for optional date override
    let asofDate: string | null = null;
    try {
      const body = await req.json();
      if (body.asof_date) {
        asofDate = body.asof_date;
      }
    } catch {
      // No body - use default (today)
    }
    
    console.log(`[fingerprint-materialize] Starting materialization for ${asofDate || 'today'}`);
    const startTime = Date.now();
    
    // Call the materialization function
    const { data, error } = await supabase.rpc('materialize_fingerprint_outcomes', {
      p_asof: asofDate,
    });
    
    if (error) {
      console.error('[fingerprint-materialize] Error:', error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const result = data?.[0] || { records_upserted: 0, regions_processed: 0 };
    const durationMs = Date.now() - startTime;
    
    console.log(`[fingerprint-materialize] Complete: ${result.records_upserted} records, ${result.regions_processed} regions, ${durationMs}ms`);
    
    return new Response(
      JSON.stringify({
        success: true,
        asof_date: asofDate || new Date().toISOString().split('T')[0],
        records_upserted: result.records_upserted,
        regions_processed: result.regions_processed,
        duration_ms: durationMs,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[fingerprint-materialize] Error:', error);
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
