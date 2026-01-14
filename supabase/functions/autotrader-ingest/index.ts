import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    // Extract listing ID from URL or use provided ID
    const listingUrl = (item.url || item.listingUrl || item.link || "") as string;
    const idMatch = listingUrl.match(/\/car\/(\d+)/);
    const listingId = (item.id || item.listingId || idMatch?.[1] || "") as string;
    
    if (!listingId) return null;
    
    // Parse year from title or dedicated field
    const title = (item.title || item.name || "") as string;
    let year = item.year as number;
    if (!year) {
      const yearMatch = title.match(/\b(20\d{2})\b/);
      year = yearMatch ? parseInt(yearMatch[1], 10) : 0;
    }
    if (!year || year < 2000) return null;
    
    // Extract make/model
    let make = (item.make || "") as string;
    let model = (item.model || "") as string;
    let variant = (item.variant || item.badge || item.trim || "") as string;
    
    // If make/model not provided, try to parse from title
    if (!make || !model) {
      // Title format usually: "2024 Toyota Corolla Ascent Sport..."
      const titleParts = title.replace(/^\d{4}\s+/, "").split(/\s+/);
      if (titleParts.length >= 2) {
        make = make || titleParts[0];
        model = model || titleParts[1];
        variant = variant || titleParts.slice(2).join(" ");
      }
    }
    
    if (!make || !model) return null;
    
    // Extract price
    let price = item.price as number;
    if (!price) {
      const priceStr = (item.priceText || item.priceString || "") as string;
      const priceMatch = priceStr.replace(/[,$]/g, "").match(/(\d+)/);
      price = priceMatch ? parseInt(priceMatch[1], 10) : 0;
    }
    if (price < 1000 || price > 500000) return null;
    
    // Extract odometer
    let km: number | undefined = item.odometer as number || item.km as number || item.mileage as number;
    if (!km) {
      const odometerStr = (item.odometerText || "") as string;
      const kmMatch = odometerStr.replace(/,/g, "").match(/(\d+)/);
      km = kmMatch ? parseInt(kmMatch[1], 10) : undefined;
    }
    
    // Extract location
    const location = (item.location || item.suburb || "") as string;
    const stateRaw = (item.state || "") as string;
    let state = stateRaw.toUpperCase();
    let suburb = location;
    
    // Try to extract state from location if not provided
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

// Run Apify actor and get results
async function runApifyActor(
  apifyToken: string,
  actorId: string,
  input: Record<string, unknown>
): Promise<Record<string, unknown>[]> {
  console.log(`Running Apify actor: ${actorId} with input:`, input);
  
  // Start the actor run
  const runResponse = await fetch(
    `https://api.apify.com/v2/acts/${actorId}/runs?token=${apifyToken}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  
  if (!runResponse.ok) {
    const err = await runResponse.text();
    throw new Error(`Apify run start failed: ${runResponse.status} - ${err}`);
  }
  
  const runData = await runResponse.json();
  const runId = runData.data?.id;
  if (!runId) throw new Error("No run ID returned from Apify");
  
  console.log(`Apify run started: ${runId}`);
  
  // Poll for completion (max 90 seconds)
  const pollStart = Date.now();
  const maxPollTime = 90000;
  let status = runData.data?.status;
  
  while (status === "RUNNING" || status === "READY") {
    if (Date.now() - pollStart > maxPollTime) {
      throw new Error(`Apify run timed out after ${maxPollTime / 1000}s`);
    }
    
    await new Promise((r) => setTimeout(r, 3000));
    
    const statusResponse = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`
    );
    const statusData = await statusResponse.json();
    status = statusData.data?.status;
    console.log(`Apify run status: ${status}`);
  }
  
  if (status !== "SUCCEEDED") {
    throw new Error(`Apify run failed with status: ${status}`);
  }
  
  // Fetch dataset items
  const datasetId = runData.data?.defaultDatasetId;
  if (!datasetId) throw new Error("No dataset ID from Apify run");
  
  const datasetResponse = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}&limit=200`
  );
  
  if (!datasetResponse.ok) {
    throw new Error(`Failed to fetch Apify dataset: ${datasetResponse.status}`);
  }
  
  const items = await datasetResponse.json();
  console.log(`Fetched ${items.length} items from Apify dataset`);
  
  return items;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    
    const apifyToken = Deno.env.get("APIFY_TOKEN");
    const actorId = Deno.env.get("APIFY_ACTOR_ID_AUTOTRADER_AU") || "fayoussef/autotrader-au-scraper";
    
    if (!apifyToken) {
      throw new Error("APIFY_TOKEN not configured");
    }

    const body = await req.json().catch(() => ({}));
    const { 
      search = null,
      state = null,
      year_min = 2016,
      limit = 100,
      run_mode = "seed"
    } = body;

    // Build Apify actor input based on the actor's expected schema
    const actorInput: Record<string, unknown> = {
      maxItems: Math.min(limit, 200),
      yearMin: year_min,
    };
    
    if (search) actorInput.search = search;
    if (state) actorInput.state = state.toLowerCase();

    console.log(`Autotrader ingest: mode=${run_mode}, search=${search}, state=${state}, year_min=${year_min}`);

    // Run Apify actor
    const rawItems = await runApifyActor(apifyToken, actorId, actorInput);
    
    // Map to our format
    const listings = rawItems
      .map(mapApifyItem)
      .filter((l): l is AutotraderListing => l !== null);

    console.log(`Mapped ${listings.length} valid listings from ${rawItems.length} raw items`);

    // Upsert each listing
    const results = {
      total_found: rawItems.length,
      mapped: listings.length,
      new_listings: 0,
      updated_listings: 0,
      price_changes: 0,
      evaluations_triggered: 0,
      errors: 0,
      sample_listings: [] as string[],
    };

    for (const listing of listings.slice(0, limit)) {
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
          console.error(`Error upserting listing ${listing.source_listing_id}:`, error.message);
          results.errors++;
          continue;
        }

        const result = data?.[0] || data;
        if (result?.is_new) {
          results.new_listings++;
          if (results.sample_listings.length < 5) {
            results.sample_listings.push(`${listing.year} ${listing.make} ${listing.model} @ $${listing.asking_price}`);
          }
        } else {
          results.updated_listings++;
        }
        if (result?.price_changed) results.price_changes++;
        if (result?.evaluation_result) results.evaluations_triggered++;
      } catch (err) {
        console.error(`Error processing listing:`, err);
        results.errors++;
      }
    }

    // Log to cron_audit_log
    await supabase.from("cron_audit_log").insert({
      cron_name: "autotrader-ingest",
      success: true,
      result: { ...results, search, state, run_mode },
      run_date: new Date().toISOString().split("T")[0],
    });

    console.log("Autotrader ingest complete:", results);

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Autotrader ingest error:", errorMsg);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    await supabase.from("cron_audit_log").insert({
      cron_name: "autotrader-ingest",
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
