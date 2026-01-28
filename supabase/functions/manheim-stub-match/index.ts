import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * MANHEIM STUB MATCH - Lane 2: Match stubs to hunts and queue for deep-fetch
 * 
 * Production hardened (following Pickles pattern):
 * - Uses normalized make_norm/model_norm columns (no LOWER() joins)
 * - Writes to pickles_detail_queue as the driver for deep-fetch
 * - Links stub_anchor_id for back-reference
 * - Uses same RPC as Pickles but filters by source='manheim'
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

    console.log(`[MANHEIM-MATCH] Starting stub matching: batch=${batch_size}, min_score=${min_match_score}`);

    const metrics: MatchMetrics = {
      stubs_processed: 0,
      matches_found: 0,
      queue_items_created: 0,
      errors: [],
    };

    // Use RPC with source filter for Manheim
    const { data: matches, error: matchError } = await supabase.rpc("match_stubs_to_specs", {
      p_batch_size: batch_size,
      p_min_score: min_match_score,
      p_source: "manheim", // Filter for Manheim stubs only
    });

    if (matchError) {
      // RPC might not support p_source yet, fall back to filtering Manheim stubs manually
      console.log("[MANHEIM-MATCH] Falling back to manual Manheim filter");
      
      // Fetch pending Manheim stubs
      const { data: stubs, error: stubError } = await supabase
        .from("stub_anchors")
        .select("id, source_stock_id, detail_url, make_norm, model_norm, year, km")
        .eq("source", "manheim")
        .eq("status", "pending")
        .eq("deep_fetch_triggered", false)
        .limit(batch_size);
      
      if (stubError || !stubs || stubs.length === 0) {
        console.log("[MANHEIM-MATCH] No pending Manheim stubs found");
        return new Response(
          JSON.stringify({ success: true, message: "No Manheim stubs to match", metrics }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // Fetch enabled dealer specs
      const { data: specs, error: specError } = await supabase
        .from("dealer_specs")
        .select("id, make_norm, model_norm, year_min, year_max, km_max, dealer_id, dealer_name")
        .eq("enabled", true)
        .is("deleted_at", null);
      
      if (specError || !specs || specs.length === 0) {
        console.log("[MANHEIM-MATCH] No enabled dealer specs found");
        return new Response(
          JSON.stringify({ success: true, message: "No dealer specs to match against", metrics }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // Manual matching with normalized columns - support partial model match
      const matchResults: { stub_id: string; spec_id: string; match_score: number }[] = [];
      
      for (const stub of stubs) {
        for (const spec of specs) {
          // Match on normalized make
          if (stub.make_norm !== spec.make_norm) continue;
          
          // Model match: spec model should be contained in stub model (partial match)
          // e.g., spec "rav4" matches stub "rav4 gx 5d station wagon"
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
          source: "manheim",
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
          console.error("[MANHEIM-MATCH] Queue error:", queueError);
          metrics.errors.push(`Queue error: ${queueError.message}`);
        } else {
          metrics.queue_items_created = upserted?.length || 0;
          console.log(`[MANHEIM-MATCH] Queued ${metrics.queue_items_created} items`);
        }
        
        // Update stubs with matched info
        for (const stub of matchedStubs) {
          const matchInfo = matchesByStub.get(stub.id);
          await supabase
            .from("stub_anchors")
            .update({
              status: "matched",
              deep_fetch_triggered: true,
              deep_fetch_queued_at: new Date().toISOString(),
              deep_fetch_reason: `hunt_match:score=${matchInfo?.bestScore || 0}`,
              matched_hunt_ids: matchInfo?.specIds || [],
            })
            .eq("id", stub.id);
        }
      }
      
      const duration = Date.now() - startTime;
      console.log(`[MANHEIM-MATCH] Completed in ${duration}ms:`, metrics);
      
      return new Response(
        JSON.stringify({
          success: true,
          duration_ms: duration,
          metrics,
          dry_run,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If RPC worked (supports p_source parameter)
    if (!matches || matches.length === 0) {
      console.log("[MANHEIM-MATCH] No matches found from RPC");
      return new Response(
        JSON.stringify({ success: true, message: "No matches found", metrics }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[MANHEIM-MATCH] RPC returned ${matches.length} potential matches`);

    // Group matches by stub_id
    const matchesByStub = new Map<string, { specIds: string[]; bestScore: number }>();
    for (const m of matches) {
      const existing = matchesByStub.get(m.stub_id);
      if (existing) {
        existing.specIds.push(m.spec_id);
        existing.bestScore = Math.max(existing.bestScore, m.match_score);
      } else {
        matchesByStub.set(m.stub_id, { specIds: [m.spec_id], bestScore: m.match_score });
      }
    }

    metrics.stubs_processed = matchesByStub.size;
    metrics.matches_found = matchesByStub.size;

    if (!dry_run) {
      // Get stub details for queuing
      const stubIds = Array.from(matchesByStub.keys());
      const { data: stubs } = await supabase
        .from("stub_anchors")
        .select("id, source, source_stock_id, detail_url")
        .in("id", stubIds);

      if (stubs && stubs.length > 0) {
        // Queue to pickles_detail_queue (shared queue)
        const queueItems = stubs.map(s => ({
          source: "manheim",
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
          console.error("[MANHEIM-MATCH] Queue error:", queueError);
          metrics.errors.push(`Queue error: ${queueError.message}`);
        } else {
          metrics.queue_items_created = upserted?.length || 0;
          console.log(`[MANHEIM-MATCH] Queued ${metrics.queue_items_created} items`);
        }

        // Update stubs with matched info
        for (const stub of stubs) {
          const matchInfo = matchesByStub.get(stub.id);
          await supabase
            .from("stub_anchors")
            .update({
              status: "matched",
              deep_fetch_triggered: true,
              deep_fetch_queued_at: new Date().toISOString(),
              deep_fetch_reason: `hunt_match:score=${matchInfo?.bestScore || 0}`,
              matched_hunt_ids: matchInfo?.specIds || [],
            })
            .eq("id", stub.id);
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[MANHEIM-MATCH] Completed in ${duration}ms:`, metrics);

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
    console.error("[MANHEIM-MATCH] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
