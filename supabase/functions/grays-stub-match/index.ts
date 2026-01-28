import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * GRAYS STUB MATCH - Lane 2: Match stubs to hunts and queue for deep-fetch
 * 
 * Production hardened (following Pickles/Manheim pattern):
 * - Uses normalized make_norm/model_norm columns (no LOWER() joins)
 * - Writes to pickles_detail_queue as the driver for deep-fetch
 * - Links stub_anchor_id for back-reference
 * - source='grays' filter throughout
 * - Schedule: every 15 minutes
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MatchMetrics {
  stubs_processed: number;
  matches_found: number;
  queue_items_created: number;
  errors: string[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json().catch(() => ({}));
    const {
      batch_size = 100,
      min_match_score = 50,
      dry_run = false,
    } = body;

    console.log(`[GRAYS-MATCH] Starting stub matching: batch=${batch_size}, min_score=${min_match_score}`);

    const metrics: MatchMetrics = {
      stubs_processed: 0,
      matches_found: 0,
      queue_items_created: 0,
      errors: [],
    };

    // Fetch pending Grays stubs (source='grays')
    const { data: stubs, error: stubError } = await supabase
      .from("stub_anchors")
      .select("id, source_stock_id, detail_url, make_norm, model_norm, year, km")
      .eq("source", "grays")
      .eq("status", "pending")
      .eq("deep_fetch_triggered", false)
      .limit(batch_size);
    
    if (stubError || !stubs || stubs.length === 0) {
      console.log("[GRAYS-MATCH] No pending Grays stubs found");
      return new Response(
        JSON.stringify({ success: true, message: "No Grays stubs to match", metrics }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[GRAYS-MATCH] Found ${stubs.length} pending Grays stubs`);
    
    // Fetch enabled dealer specs
    const { data: specs, error: specError } = await supabase
      .from("dealer_specs")
      .select("id, make_norm, model_norm, year_min, year_max, km_max, dealer_id, dealer_name")
      .eq("enabled", true)
      .is("deleted_at", null);
    
    if (specError || !specs || specs.length === 0) {
      console.log("[GRAYS-MATCH] No enabled dealer specs found");
      return new Response(
        JSON.stringify({ success: true, message: "No dealer specs to match against", metrics }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[GRAYS-MATCH] Found ${specs.length} enabled dealer specs`);
    
    // Manual matching with normalized columns - support partial model match
    const matchResults: { stub_id: string; spec_id: string; match_score: number }[] = [];
    
    for (const stub of stubs) {
      for (const spec of specs) {
        // Match on normalized make
        if (stub.make_norm !== spec.make_norm) continue;
        
        // Model match: spec model should be contained in stub model (partial match)
        // e.g., spec "rav4" matches stub "rav4 gx wagon"
        const stubModel = stub.model_norm || '';
        const specModel = spec.model_norm || '';
        if (!stubModel.startsWith(specModel) && !stubModel.includes(specModel)) continue;
        
        // Year check
        if (stub.year && spec.year_min && stub.year < spec.year_min) continue;
        if (stub.year && spec.year_max && stub.year > spec.year_max) continue;
        
        // KM check (soft)
        let score = 100;
        if (stub.km && spec.km_max && stub.km > spec.km_max) {
          score -= 20;
        }
        
        if (score >= min_match_score) {
          matchResults.push({
            stub_id: stub.id,
            spec_id: spec.id,
            match_score: score,
          });
        }
      }
    }

    console.log(`[GRAYS-MATCH] Found ${matchResults.length} match pairs`);
    
    // Group matches by stub
    const matchesByStub = new Map<string, { specIds: string[]; bestScore: number }>();
    for (const m of matchResults) {
      const existing = matchesByStub.get(m.stub_id);
      if (existing) {
        existing.specIds.push(m.spec_id);
        existing.bestScore = Math.max(existing.bestScore, m.match_score);
      } else {
        matchesByStub.set(m.stub_id, { specIds: [m.spec_id], bestScore: m.match_score });
      }
    }
    
    metrics.stubs_processed = stubs.length;
    metrics.matches_found = matchesByStub.size;
    
    if (!dry_run && matchesByStub.size > 0) {
      const stubIds = Array.from(matchesByStub.keys());
      const matchedStubs = stubs.filter(s => stubIds.includes(s.id));
      
      // Queue to pickles_detail_queue (shared queue for all sources)
      const queueItems = matchedStubs.map(s => ({
        source: "grays",
        detail_url: s.detail_url,
        source_listing_id: s.source_stock_id,
        crawl_status: "pending",
        stub_anchor_id: s.id,
        first_seen_at: new Date().toISOString(),
      }));
      
      const { data: upserted, error: queueError } = await supabase
        .from("pickles_detail_queue")
        .upsert(queueItems, {
          onConflict: "source,source_listing_id",
          ignoreDuplicates: false,
        })
        .select("id");
      
      if (queueError) {
        console.error("[GRAYS-MATCH] Queue error:", queueError);
        metrics.errors.push(`Queue error: ${queueError.message}`);
      } else {
        metrics.queue_items_created = upserted?.length || 0;
        console.log(`[GRAYS-MATCH] Queued ${metrics.queue_items_created} items`);
      }
      
      // Update stubs with matched info
      for (const stub of matchedStubs) {
        const matchInfo = matchesByStub.get(stub.id);
        const { error: updateError } = await supabase
          .from("stub_anchors")
          .update({
            status: "matched",
            deep_fetch_triggered: true,
            deep_fetch_queued_at: new Date().toISOString(),
            deep_fetch_reason: `hunt_match:score=${matchInfo?.bestScore || 0}`,
            matched_hunt_ids: matchInfo?.specIds || [],
          })
          .eq("id", stub.id);

        if (updateError) {
          console.error(`[GRAYS-MATCH] Failed to update stub ${stub.id}:`, updateError.message);
          metrics.errors.push(`Stub update error: ${updateError.message}`);
        }
      }
    }
    
    const duration = Date.now() - startTime;
    console.log(`[GRAYS-MATCH] Completed in ${duration}ms:`, metrics);
    
    return new Response(
      JSON.stringify({
        success: true,
        duration_ms: duration,
        metrics,
        dry_run,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[GRAYS-MATCH] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
