import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * PICKLES STUB MATCH - Lane 2: Match stubs to hunts and trigger deep-fetch
 * 
 * FIX #1: Uses deep_fetch_queued_at timestamp
 * FIX #3: Uses RPC with proper JOIN instead of client-side CROSS JOIN
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MatchMetrics {
  stubs_processed: number;
  matches_found: number;
  deep_fetches_queued: number;
  priority_stubs_queued: number;
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

    console.log(`[MATCH] Starting stub matching: batch=${batch_size}, min_score=${min_match_score}`);

    const metrics: MatchMetrics = {
      stubs_processed: 0,
      matches_found: 0,
      deep_fetches_queued: 0,
      priority_stubs_queued: 0,
      errors: [],
    };

    // FIX #3: Use database RPC for JOIN-based matching (not client-side CROSS JOIN)
    const { data: matches, error: matchError } = await supabase.rpc("match_stubs_to_specs", {
      p_batch_size: batch_size,
      p_min_score: min_match_score,
    });

    if (matchError) {
      throw new Error(`RPC match_stubs_to_specs failed: ${matchError.message}`);
    }

    if (!matches || matches.length === 0) {
      console.log("[MATCH] No matches found from RPC");
      return new Response(
        JSON.stringify({ success: true, message: "No matches found", metrics }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[MATCH] RPC returned ${matches.length} potential matches`);

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
        // Queue to pickles_detail_queue
        const queueItems = stubs.map(s => ({
          source: "pickles",
          detail_url: s.detail_url,
          source_listing_id: s.source_stock_id,
          crawl_status: "pending",
        }));

        const { error: queueError } = await supabase
          .from("pickles_detail_queue")
          .upsert(queueItems, {
            onConflict: "source,source_listing_id",
            ignoreDuplicates: false,
          });

        if (queueError) {
          console.error("[MATCH] Queue error:", queueError);
          metrics.errors.push(`Queue error: ${queueError.message}`);
        } else {
          metrics.deep_fetches_queued = stubs.length;
        }

        // FIX #1: Update stubs with deep_fetch_queued_at and matched_hunt_ids
        for (const stub of stubs) {
          const matchInfo = matchesByStub.get(stub.id);
          if (matchInfo) {
            await supabase
              .from("stub_anchors")
              .update({
                status: "matched",
                deep_fetch_triggered: true,
                deep_fetch_queued_at: new Date().toISOString(),
                deep_fetch_reason: `hunt_match:score=${matchInfo.bestScore}`,
                matched_hunt_ids: matchInfo.specIds,
              })
              .eq("id", stub.id);
          }
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[MATCH] Completed in ${duration}ms:`, metrics);

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
    console.error("[MATCH] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
