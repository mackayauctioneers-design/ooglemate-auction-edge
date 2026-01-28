import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * PICKLES STUB MATCH - Lane 2: Match stubs to hunts and trigger deep-fetch
 * 
 * Runs after stub ingest to:
 * 1. Match pending stubs against active dealer_specs (hunts)
 * 2. Trigger deep-fetch for matched stubs or low-confidence priority stubs
 * 3. Queue detail URLs to pickles_detail_queue for Phase 2 extraction
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MatchResult {
  stub_id: string;
  spec_id: string;
  spec_name: string;
  match_score: number;
}

interface MatchMetrics {
  stubs_processed: number;
  matches_found: number;
  deep_fetches_triggered: number;
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
      include_low_confidence = true,
      dry_run = false,
    } = body;

    console.log(`[MATCH] Starting stub matching: batch=${batch_size}, min_score=${min_match_score}`);

    const metrics: MatchMetrics = {
      stubs_processed: 0,
      matches_found: 0,
      deep_fetches_triggered: 0,
      priority_stubs_queued: 0,
      errors: [],
    };

    // Step 1: Get pending stubs
    const { data: pendingStubs, error: stubError } = await supabase
      .from("stub_anchors")
      .select("id, source, source_stock_id, detail_url, year, make, model, km, location, confidence")
      .eq("status", "pending")
      .eq("deep_fetch_triggered", false)
      .order("first_seen_at", { ascending: false })
      .limit(batch_size);

    if (stubError) {
      throw new Error(`Failed to fetch stubs: ${stubError.message}`);
    }

    if (!pendingStubs || pendingStubs.length === 0) {
      console.log("[MATCH] No pending stubs to process");
      return new Response(
        JSON.stringify({ success: true, message: "No pending stubs", metrics }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    metrics.stubs_processed = pendingStubs.length;
    console.log(`[MATCH] Processing ${pendingStubs.length} stubs`);

    // Step 2: Get active dealer specs (hunts)
    const { data: activeSpecs, error: specError } = await supabase
      .from("dealer_specs")
      .select("id, name, make, model, year_min, year_max, km_max, variant_family, priority")
      .eq("enabled", true)
      .is("deleted_at", null);

    if (specError) {
      throw new Error(`Failed to fetch specs: ${specError.message}`);
    }

    console.log(`[MATCH] Matching against ${activeSpecs?.length || 0} active specs`);

    // Step 3: Match stubs to specs
    const matchedStubIds = new Set<string>();
    const stubsToDeepFetch: { id: string; url: string; reason: string; huntIds: string[] }[] = [];

    for (const stub of pendingStubs) {
      const matchingSpecs: { specId: string; specName: string; score: number }[] = [];

      for (const spec of activeSpecs || []) {
        // Make/model must match (case-insensitive)
        if (!stub.make || !stub.model) continue;
        if (stub.make.toLowerCase() !== spec.make.toLowerCase()) continue;
        if (stub.model.toLowerCase() !== spec.model.toLowerCase()) continue;

        // Calculate match score
        let score = 100;

        // Year check
        if (stub.year) {
          const yearMin = spec.year_min || 1900;
          const yearMax = spec.year_max || 2100;
          if (stub.year < yearMin - 1 || stub.year > yearMax + 1) {
            continue; // Year out of range
          }
          if (stub.year >= yearMin && stub.year <= yearMax) {
            // Perfect year match
          } else {
            score -= 10; // Within tolerance
          }
        } else {
          score -= 20; // Missing year
        }

        // KM check
        if (stub.km && spec.km_max) {
          if (stub.km > spec.km_max * 1.25) {
            continue; // KM too high
          }
          if (stub.km > spec.km_max) {
            score -= 15; // Within tolerance
          }
        } else if (!stub.km) {
          score -= 15; // Missing KM
        }

        if (score >= min_match_score) {
          matchingSpecs.push({
            specId: spec.id,
            specName: spec.name,
            score,
          });
        }
      }

      if (matchingSpecs.length > 0) {
        matchedStubIds.add(stub.id);
        metrics.matches_found++;

        // Sort by score and take best matches
        matchingSpecs.sort((a, b) => b.score - a.score);
        const bestScore = matchingSpecs[0].score;
        const huntIds = matchingSpecs.map(m => m.specId);

        stubsToDeepFetch.push({
          id: stub.id,
          url: stub.detail_url,
          reason: `hunt_match:${matchingSpecs[0].specName}:${bestScore}`,
          huntIds,
        });
      } else if (include_low_confidence && stub.confidence === "low") {
        // Low confidence stubs with popular makes get queued for deep-fetch
        const popularMakes = ["Toyota", "Mazda", "Hyundai", "Kia", "Ford"];
        if (stub.make && popularMakes.some(m => m.toLowerCase() === stub.make?.toLowerCase())) {
          stubsToDeepFetch.push({
            id: stub.id,
            url: stub.detail_url,
            reason: "low_confidence_priority",
            huntIds: [],
          });
          metrics.priority_stubs_queued++;
        }
      }
    }

    console.log(`[MATCH] Found ${metrics.matches_found} matches, ${stubsToDeepFetch.length} to deep-fetch`);

    if (!dry_run && stubsToDeepFetch.length > 0) {
      // Step 4: Queue for deep-fetch (add to pickles_detail_queue)
      const queueItems = stubsToDeepFetch.map(s => {
        // Extract source_listing_id from URL
        const urlParts = s.url.split("/");
        const sourceListingId = urlParts[urlParts.length - 1] || crypto.randomUUID();
        
        return {
          source: "pickles",
          detail_url: s.url,
          source_listing_id: sourceListingId,
          crawl_status: "pending",
        };
      });

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
        metrics.deep_fetches_triggered = stubsToDeepFetch.length;
      }

      // Step 5: Update stub_anchors with match info
      for (const s of stubsToDeepFetch) {
        await supabase
          .from("stub_anchors")
          .update({
            status: s.huntIds.length > 0 ? "matched" : "pending",
            deep_fetch_triggered: true,
            deep_fetch_at: new Date().toISOString(),
            deep_fetch_reason: s.reason,
            matched_hunt_ids: s.huntIds,
          })
          .eq("id", s.id);
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
