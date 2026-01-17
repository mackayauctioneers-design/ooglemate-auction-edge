import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Build Unified Candidates - Merges internal + outward candidates
 * 
 * This runs AFTER both run-hunt-scan (internal) and outward-hunt (external)
 * to produce a single ranked list sorted by "best buy" (cheapest first).
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { hunt_id, run_all_active } = await req.json().catch(() => ({}));

    const results: { hunt_id: string; success: boolean; counts?: any; error?: string }[] = [];

    if (run_all_active) {
      // Build unified candidates for all active hunts
      const { data: activeHunts, error: huntsErr } = await supabase
        .from('sale_hunts')
        .select('id')
        .eq('status', 'active')
        .limit(50);

      if (huntsErr) throw huntsErr;

      for (const hunt of activeHunts || []) {
        const { data, error } = await supabase.rpc('rpc_build_unified_candidates', {
          p_hunt_id: hunt.id
        });

        results.push({
          hunt_id: hunt.id,
          success: !error,
          counts: data,
          error: error?.message
        });
      }
    } else if (hunt_id) {
      // Build for specific hunt
      const { data, error } = await supabase.rpc('rpc_build_unified_candidates', {
        p_hunt_id: hunt_id
      });

      results.push({
        hunt_id,
        success: !error,
        counts: data,
        error: error?.message
      });
    } else {
      throw new Error("Either hunt_id or run_all_active must be provided");
    }

    return new Response(
      JSON.stringify({
        success: true,
        results,
        duration_ms: Date.now() - startTime
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Build unified candidates error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
