import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * PICKLES STUB MATCH - Lane 2: Match stubs to hunts and queue for deep-fetch
 * 
 * Production hardened:
 * - Uses normalized make_norm/model_norm columns (no LOWER() joins)
 * - Writes to pickles_detail_queue as the driver for deep-fetch
 * - Links stub_anchor_id for back-reference
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

    console.log(`[MATCH] Starting stub matching: batch=${batch_size}, min_score=${min_match_score}`);

    const metrics: MatchMetrics = {
      stubs_processed: 0,
      matches_found: 0,
      queue_items_created: 0,
      errors: [],
    };

    // Use RPC with normalized column JOIN (no LOWER())
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
        // Queue to pickles_detail_queue (the driver for deep-fetch)
        const queueItems = stubs.map(s => ({
          source: "pickles",
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
          console.error("[MATCH] Queue error:", queueError);
          metrics.errors.push(`Queue error: ${queueError.message}`);
        } else {
          metrics.queue_items_created = upserted?.length || 0;
          console.log(`[MATCH] Queued ${metrics.queue_items_created} items to pickles_detail_queue`);
        }

        // Update stubs with matched info
        const stubUpdates = stubs.map(stub => {
          const matchInfo = matchesByStub.get(stub.id);
          return {
            id: stub.id,
            status: "matched",
            deep_fetch_triggered: true,
            deep_fetch_queued_at: new Date().toISOString(),
            deep_fetch_reason: `hunt_match:score=${matchInfo?.bestScore || 0}`,
            matched_hunt_ids: matchInfo?.specIds || [],
          };
        });

        // Batch update stubs
        for (const update of stubUpdates) {
          await supabase
            .from("stub_anchors")
            .update({
              status: update.status,
              deep_fetch_triggered: update.deep_fetch_triggered,
              deep_fetch_queued_at: update.deep_fetch_queued_at,
              deep_fetch_reason: update.deep_fetch_reason,
              matched_hunt_ids: update.matched_hunt_ids,
            })
            .eq("id", update.id);
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
