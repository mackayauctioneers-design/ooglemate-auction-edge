import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Time budget to stay under platform timeout
const TIME_BUDGET_MS = 25000;
const LOCK_DURATION_MS = 60000; // 1 minute lock per run

interface AutotraderListing {
  source_listing_id: string;
  listing_url: string;
  year: number;
  make: string;
  model: string;
  variant_raw?: string;
  km?: number;
  asking_price: number;
  state?: string;
  suburb?: string;
}

// Map Apify dataset item to our canonical format
function mapApifyItem(item: Record<string, unknown>): AutotraderListing | null {
  try {
    const listingUrl = (item.url || item.listingUrl || item.link || "") as string;
    const idMatch = listingUrl.match(/\/car\/(\d+)/);
    const listingId = (item.id || item.listingId || idMatch?.[1] || "") as string;
    
    if (!listingId) return null;
    
    const title = (item.title || item.name || "") as string;
    let year = item.year as number;
    if (!year) {
      const yearMatch = title.match(/\b(20\d{2})\b/);
      year = yearMatch ? parseInt(yearMatch[1], 10) : 0;
    }
    if (!year || year < 2000) return null;
    
    let make = (item.make || "") as string;
    let model = (item.model || "") as string;
    let variant = (item.variant || item.badge || item.trim || "") as string;
    
    if (!make || !model) {
      const titleParts = title.replace(/^\d{4}\s+/, "").split(/\s+/);
      if (titleParts.length >= 2) {
        make = make || titleParts[0];
        model = model || titleParts[1];
        variant = variant || titleParts.slice(2).join(" ");
      }
    }
    
    if (!make || !model) return null;
    
    let price = item.price as number;
    if (!price) {
      const priceStr = (item.priceText || item.priceString || "") as string;
      const priceMatch = priceStr.replace(/[,$]/g, "").match(/(\d+)/);
      price = priceMatch ? parseInt(priceMatch[1], 10) : 0;
    }
    if (price < 1000 || price > 500000) return null;
    
    let km: number | undefined = item.odometer as number || item.km as number || item.mileage as number;
    if (!km) {
      const odometerStr = (item.odometerText || "") as string;
      const kmMatch = odometerStr.replace(/,/g, "").match(/(\d+)/);
      km = kmMatch ? parseInt(kmMatch[1], 10) : undefined;
    }
    
    const location = (item.location || item.suburb || "") as string;
    const stateRaw = (item.state || "") as string;
    let state = stateRaw.toUpperCase();
    let suburb = location;
    
    if (!state && location) {
      const stateMatch = location.match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/i);
      state = stateMatch ? stateMatch[1].toUpperCase() : "";
    }
    
    return {
      source_listing_id: String(listingId),
      listing_url: listingUrl || `https://www.autotrader.com.au/car/${listingId}`,
      year,
      make: make.toUpperCase().trim(),
      model: model.toUpperCase().trim(),
      variant_raw: variant?.toUpperCase().trim() || undefined,
      km,
      asking_price: price,
      state: state || undefined,
      suburb: suburb || undefined,
    };
  } catch (err) {
    console.error("Error mapping Apify item:", err);
    return null;
  }
}

/**
 * autotrader-fetch: WORKER FUNCTION
 * 
 * Claims queued Apify runs, checks if complete, fetches datasets, upserts listings.
 * Runs repeatedly on schedule to drain the queue.
 * 
 * CRITICAL STATE MACHINE:
 * - queued → running (Apify still processing)
 * - running → fetching (Apify complete, fetching dataset)
 * - fetching → fetching (partial progress, time budget exhausted)
 * - fetching → done (all items fetched)
 * - any → error (on failure)
 * 
 * A run is ONLY marked "done" when:
 * - items.length === 0 (no more items)
 * - items.length < batchSize (last page)
 */

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    
    const apifyToken = Deno.env.get("APIFY_TOKEN");
    if (!apifyToken) {
      throw new Error("APIFY_TOKEN not configured");
    }

    const now = new Date();

    let runsProcessed = 0;
    let totalNew = 0;
    let totalUpdated = 0;
    let totalErrors = 0;
    const runResults: Array<{ run_id: string; status: string; items?: number; reason?: string }> = [];

    // Process runs until time budget exhausted
    while (Date.now() - startTime < TIME_BUDGET_MS) {
      // Claim next queued or running run
      const { data: runs, error: fetchError } = await supabase
        .from("apify_runs_queue")
        .select("*")
        .in("status", ["queued", "running", "fetching"])
        .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`)
        .order("created_at", { ascending: true })
        .limit(1);

      if (fetchError || !runs || runs.length === 0) {
        console.log("No runs to process");
        break;
      }

      const run = runs[0];

      // Generate PER-RUN lock token (not reused across loop iterations)
      const runLockToken = crypto.randomUUID();
      const lockUntil = new Date(Date.now() + LOCK_DURATION_MS).toISOString();

      // Try to acquire lock for this specific run
      const { error: lockError } = await supabase
        .from("apify_runs_queue")
        .update({ 
          locked_until: lockUntil, 
          lock_token: runLockToken,
          updated_at: now.toISOString()
        })
        .eq("id", run.id)
        .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`);

      if (lockError) {
        console.log(`Failed to lock run ${run.id}`);
        continue;
      }

      // Verify lock acquisition
      const { data: lockCheck } = await supabase
        .from("apify_runs_queue")
        .select("lock_token")
        .eq("id", run.id)
        .single();

      if (lockCheck?.lock_token !== runLockToken) {
        console.log(`Lost lock race for run ${run.id}`);
        continue;
      }

      console.log(`Processing run ${run.run_id} (status: ${run.status}, lock: ${runLockToken})`);

      try {
        // Check Apify run status
        const statusResponse = await fetch(
          `https://api.apify.com/v2/actor-runs/${run.run_id}?token=${apifyToken}`
        );
        const statusData = await statusResponse.json();
        const apifyStatus = statusData.data?.status;
        const datasetId = statusData.data?.defaultDatasetId || run.dataset_id;

        console.log(`Apify run ${run.run_id} status: ${apifyStatus}`);

        if (apifyStatus === "RUNNING" || apifyStatus === "READY") {
          // Still running, update status and release lock
          await supabase
            .from("apify_runs_queue")
            .update({ 
              status: "running",
              dataset_id: datasetId,
              locked_until: null,
              lock_token: null,
              updated_at: now.toISOString()
            })
            .eq("id", run.id);

          runResults.push({ run_id: run.run_id, status: "still_running" });
          continue;
        }

        if (apifyStatus === "FAILED" || apifyStatus === "ABORTED" || apifyStatus === "TIMED-OUT") {
          // Failed, mark as error and release lock
          await supabase
            .from("apify_runs_queue")
            .update({ 
              status: "error",
              last_error: `Apify run ${apifyStatus}`,
              completed_at: now.toISOString(),
              locked_until: null,
              lock_token: null,
              updated_at: now.toISOString()
            })
            .eq("id", run.id);

          runResults.push({ run_id: run.run_id, status: "error", reason: apifyStatus });
          totalErrors++;
          continue;
        }

        if (apifyStatus !== "SUCCEEDED") {
          // Unknown status, release lock and skip
          await supabase
            .from("apify_runs_queue")
            .update({ 
              locked_until: null,
              lock_token: null,
              updated_at: now.toISOString()
            })
            .eq("id", run.id);

          runResults.push({ run_id: run.run_id, status: `unknown_${apifyStatus}` });
          continue;
        }

        // Apify run succeeded - update to fetching status
        await supabase
          .from("apify_runs_queue")
          .update({ 
            status: "fetching",
            dataset_id: datasetId,
            updated_at: now.toISOString()
          })
          .eq("id", run.id);

        // Fetch dataset items with pagination
        // Start from where we left off (items_fetched tracks progress)
        let offset = run.items_fetched || 0;
        const batchSize = 100;
        
        // Track progress IN MEMORY for this run
        let itemsFetchedThisRun = 0;
        let itemsUpsertedThisRun = 0;
        let runNew = 0;
        let runUpdated = 0;
        let runErrors = 0;
        let isFinished = false;

        while (Date.now() - startTime < TIME_BUDGET_MS) {
          const datasetResponse = await fetch(
            `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}&offset=${offset}&limit=${batchSize}`
          );

          if (!datasetResponse.ok) {
            throw new Error(`Failed to fetch dataset: ${datasetResponse.status}`);
          }

          const items = await datasetResponse.json();
          
          // Check if we've reached the end
          if (!items || items.length === 0) {
            isFinished = true;
            console.log(`Run ${run.run_id}: no more items at offset ${offset}, marking done`);
            break;
          }

          console.log(`Fetched ${items.length} items from offset ${offset}`);
          itemsFetchedThisRun += items.length;

          // Map and upsert listings
          const listings = items
            .map(mapApifyItem)
            .filter((l: AutotraderListing | null): l is AutotraderListing => l !== null);

          for (const listing of listings) {
            try {
              const { data, error } = await supabase.rpc("upsert_retail_listing", {
                p_source: "autotrader",
                p_source_listing_id: listing.source_listing_id,
                p_listing_url: listing.listing_url,
                p_year: listing.year,
                p_make: listing.make,
                p_model: listing.model,
                p_variant_raw: listing.variant_raw || null,
                p_variant_family: null,
                p_km: listing.km || null,
                p_asking_price: listing.asking_price,
                p_state: listing.state || null,
                p_suburb: listing.suburb || null,
              });

              if (error) {
                runErrors++;
                continue;
              }

              itemsUpsertedThisRun++;
              const result = data?.[0] || data;
              if (result?.is_new) {
                runNew++;
              } else {
                runUpdated++;
              }
            } catch {
              runErrors++;
            }
          }

          offset += items.length;

          // Check if this was the last page
          if (items.length < batchSize) {
            isFinished = true;
            console.log(`Run ${run.run_id}: last page (${items.length} < ${batchSize}), marking done`);
            break;
          }

          // Save intermediate progress (in case we hit time budget)
          await supabase
            .from("apify_runs_queue")
            .update({ 
              items_fetched: offset,
              items_upserted: (run.items_upserted || 0) + itemsUpsertedThisRun,
              updated_at: new Date().toISOString()
            })
            .eq("id", run.id);
        }

        // Update final state based on whether we finished
        if (isFinished) {
          // COMPLETED: Mark as done
          await supabase
            .from("apify_runs_queue")
            .update({ 
              status: "done",
              completed_at: new Date().toISOString(),
              items_fetched: offset,
              items_upserted: (run.items_upserted || 0) + itemsUpsertedThisRun,
              locked_until: null,
              lock_token: null,
              updated_at: new Date().toISOString()
            })
            .eq("id", run.id);

          runResults.push({ 
            run_id: run.run_id, 
            status: "done", 
            items: itemsFetchedThisRun 
          });
        } else {
          // PARTIAL: Time budget exhausted, keep as fetching for next worker
          await supabase
            .from("apify_runs_queue")
            .update({ 
              status: "fetching", // Stay in fetching state
              items_fetched: offset,
              items_upserted: (run.items_upserted || 0) + itemsUpsertedThisRun,
              locked_until: null, // Release lock for next worker
              lock_token: null,
              updated_at: new Date().toISOString()
            })
            .eq("id", run.id);

          runResults.push({ 
            run_id: run.run_id, 
            status: "partial", 
            items: itemsFetchedThisRun,
            reason: `time_budget_at_offset_${offset}`
          });
        }

        totalNew += runNew;
        totalUpdated += runUpdated;
        totalErrors += runErrors;
        runsProcessed++;

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`Error processing run ${run.run_id}:`, errorMsg);

        // Release lock but keep status so we can retry
        await supabase
          .from("apify_runs_queue")
          .update({ 
            last_error: errorMsg,
            locked_until: null,
            lock_token: null,
            updated_at: new Date().toISOString()
          })
          .eq("id", run.id);

        totalErrors++;
        runResults.push({ run_id: run.run_id, status: "error", reason: errorMsg });
      }
    }

    const results = {
      runs_processed: runsProcessed,
      new_listings: totalNew,
      updated_listings: totalUpdated,
      errors: totalErrors,
      run_results: runResults,
      elapsed_ms: Date.now() - startTime,
    };

    // Log to audit
    await supabase.from("cron_audit_log").insert({
      cron_name: "autotrader-fetch",
      success: true,
      result: results,
      run_date: now.toISOString().split("T")[0],
    });

    console.log("Autotrader fetch complete:", results);

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Autotrader fetch error:", errorMsg);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    await supabase.from("cron_audit_log").insert({
      cron_name: "autotrader-fetch",
      success: false,
      error: errorMsg,
      run_date: new Date().toISOString().split("T")[0],
    });

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
