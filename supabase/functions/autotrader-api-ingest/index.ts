import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// AutoTrader API configuration
const AUTOTRADER_API_BASE = "https://listings.platform.autotrader.com.au/api/v3/search";
const PAGE_SIZE = 48; // AutoTrader's default page size
const MAX_PAGES_PER_RUN = 10; // Limit pages per run to stay within time budget

// The actual listing data is nested in _source
interface AutotraderApiSource {
  id: number;
  source_ref_id?: string;
  manu_year?: number;        // Year is called manu_year
  make?: string;
  model?: string;
  variant?: string;
  badge?: string;
  series?: string;
  transmission?: string;
  fuel_type?: string;        // Snake case
  body_type?: string;
  odometer?: number;
  colour_body?: string;
  vin?: string;
  rego?: string;
  condition?: string;
  is_driveaway?: number;
  description?: string;
  dealer_id?: number;
  // Price fields
  price_display?: number;
  price_egc?: number;
  price_drive_away?: number;
  // Location
  state?: string;
  suburb?: string;
  postcode?: string;
  // Seller
  seller_name?: string;
  [key: string]: unknown;
}

interface AutotraderApiListing {
  _score?: number;
  _source: AutotraderApiSource;
  sort?: unknown[];
}

interface ParsedListing {
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
  transmission?: string;
  fuel?: string;
  seller_name_raw?: string;
}

function parseApiListing(item: AutotraderApiListing): ParsedListing | null {
  try {
    // Data is nested in _source
    const source = item._source;
    if (!source) return null;
    
    const listingId = source.id || source.source_ref_id;
    if (!listingId) return null;

    // Year is called manu_year
    const year = source.manu_year || 0;
    if (year < 2000 || year > new Date().getFullYear() + 1) return null;

    const make = (source.make || "").toString().toUpperCase().trim();
    const model = (source.model || "").toString().toUpperCase().trim();
    if (!make || !model) return null;

    // Price is nested in price object
    const priceObj = source.price as Record<string, number> | undefined;
    const price = priceObj?.advertised_price || priceObj?.driveaway_price || source.price_display || 0;
    if (price < 1000 || price > 500000) return null;

    // Build variant from badge/variant/series
    const variant = [source.badge, source.variant, source.series]
      .filter(Boolean)
      .map(v => String(v).toUpperCase().trim())
      .join(" ")
      .trim() || undefined;

    // Extract odometer
    const km = typeof source.odometer === "number" ? source.odometer : undefined;

    // Location
    const state = source.state?.toString().toUpperCase() || undefined;
    const suburb = source.suburb?.toString() || undefined;

    // Build listing URL
    const listingUrl = `https://www.autotrader.com.au/car/${listingId}`;

    return {
      source_listing_id: String(listingId),
      listing_url: listingUrl,
      year,
      make,
      model,
      variant_raw: variant,
      km,
      asking_price: price,
      state,
      suburb,
      transmission: source.transmission?.toString().toUpperCase() || undefined,
      fuel: source.fuel_type?.toString().toUpperCase() || undefined,
      seller_name_raw: source.seller_name || undefined,
    };
  } catch (err) {
    console.error("Error parsing API listing:", err);
    return null;
  }
}

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

    const body = await req.json().catch(() => ({}));
    const {
      make = null,
      model = null,
      state = null,
      year_min = 2016,
      year_max = null,
      page_start = 1,
      max_pages = MAX_PAGES_PER_RUN,
    } = body;

    const results = {
      total_api_results: 0,
      pages_fetched: 0,
      raw_payloads_stored: 0,
      new_listings: 0,
      updated_listings: 0,
      price_changes: 0,
      parse_errors: 0,
      api_errors: [] as string[],
      sample_listings: [] as string[],
      elapsed_ms: 0,
    };

    let currentPage = page_start;
    let hasMore = true;

    while (hasMore && currentPage < page_start + max_pages) {
      // Build API query params
      const params = new URLSearchParams({
        page: currentPage.toString(),
        pageSize: PAGE_SIZE.toString(),
        sort: "price_asc",
      });

      if (make) params.append("make", make);
      if (model) params.append("model", model);
      if (state) params.append("state", state.toUpperCase());
      if (year_min) params.append("yearFrom", year_min.toString());
      if (year_max) params.append("yearTo", year_max.toString());

      const apiUrl = `${AUTOTRADER_API_BASE}?${params.toString()}`;
      console.log(`Fetching: ${apiUrl}`);

      try {
        const response = await fetch(apiUrl, {
          headers: {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          results.api_errors.push(`Page ${currentPage}: ${response.status} - ${errorText.slice(0, 200)}`);
          console.error(`API error page ${currentPage}:`, response.status);
          break;
        }

        const data = await response.json();
        
        // Debug: Log the actual response structure
        const dataKeys = Object.keys(data);
        console.log(`API response keys: ${dataKeys.join(", ")}`);
        
        // Try multiple possible response structures
        let listings: AutotraderApiListing[] = [];
        let totalResults = 0;
        
        if (Array.isArray(data)) {
          // Direct array response
          listings = data;
          totalResults = data.length;
        } else if (data.results && Array.isArray(data.results)) {
          listings = data.results;
          totalResults = data.totalResults || data.total || data.count || listings.length;
        } else if (data.listings && Array.isArray(data.listings)) {
          listings = data.listings;
          totalResults = data.totalResults || data.total || listings.length;
        } else if (data.data && Array.isArray(data.data)) {
          listings = data.data;
          totalResults = data.totalResults || data.total || listings.length;
        } else if (data.items && Array.isArray(data.items)) {
          listings = data.items;
          totalResults = data.totalItems || data.total || listings.length;
        }
        
        // If still no listings, log first 500 chars of response
        if (listings.length === 0) {
          console.log(`No listings found. Response sample: ${JSON.stringify(data).slice(0, 500)}`);
        } else if (currentPage === page_start) {
          // Log first listing structure for debugging
          const first = listings[0];
          console.log(`Sample listing keys: ${Object.keys(first).join(", ")}`);
          console.log(`Sample listing: ${JSON.stringify(first).slice(0, 800)}`);
        }

        console.log(`Page ${currentPage}: ${listings.length} listings (total: ${totalResults})`);

        if (currentPage === page_start) {
          results.total_api_results = totalResults;
        }

        results.pages_fetched++;

        // Process each listing
        for (const item of listings) {
          try {
            const source = item._source;
            if (!source) continue;
            
            const listingId = source.id?.toString() || source.source_ref_id?.toString();
            if (!listingId) continue;
            
            const price = source.price_display || source.price_egc || source.price_drive_away || 0;

            // Store raw payload for lifecycle tracking
            const { error: rawError } = await supabase
              .from("autotrader_raw_payloads")
              .upsert({
                source_listing_id: listingId,
                payload: source,
                price_at_first_seen: price,
                price_at_last_seen: price,
                last_seen_at: new Date().toISOString(),
                times_seen: 1,
              }, {
                onConflict: "source_listing_id",
                ignoreDuplicates: false,
              });

            // If exists, update the times_seen and last_seen
            if (!rawError) {
              await supabase
                .from("autotrader_raw_payloads")
                .update({
                  last_seen_at: new Date().toISOString(),
                  price_at_last_seen: price,
                  payload: source,
                })
                .eq("source_listing_id", listingId);
              
              results.raw_payloads_stored++;
            }

            // Parse and upsert to retail_listings
            const parsed = parseApiListing(item);
            if (!parsed) {
              results.parse_errors++;
              continue;
            }

            const { data: upsertResult, error: upsertError } = await supabase.rpc("upsert_retail_listing", {
              p_source: "autotrader",
              p_source_listing_id: parsed.source_listing_id,
              p_listing_url: parsed.listing_url,
              p_year: parsed.year,
              p_make: parsed.make,
              p_model: parsed.model,
              p_variant_raw: parsed.variant_raw || null,
              p_variant_family: null,
              p_km: parsed.km || null,
              p_asking_price: parsed.asking_price,
              p_state: parsed.state || null,
              p_suburb: parsed.suburb || null,
            });

            if (upsertError) {
              console.error(`Upsert error for ${listingId}:`, upsertError.message);
              continue;
            }

            const result = upsertResult?.[0] || upsertResult;
            if (result?.is_new) {
              results.new_listings++;
              if (results.sample_listings.length < 5) {
                results.sample_listings.push(
                  `${parsed.year} ${parsed.make} ${parsed.model} @ $${parsed.asking_price}`
                );
              }
            } else {
              results.updated_listings++;
            }
            if (result?.price_changed) results.price_changes++;

          } catch (err) {
            console.error("Error processing listing:", err);
            results.parse_errors++;
          }
        }

        // Check if more pages
        hasMore = listings.length === PAGE_SIZE && 
                  currentPage * PAGE_SIZE < totalResults;
        currentPage++;

        // Time budget check (50s max for edge function)
        if (Date.now() - startTime > 50000) {
          console.log("Time budget exhausted, stopping pagination");
          break;
        }

      } catch (fetchErr) {
        const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        results.api_errors.push(`Page ${currentPage}: ${errMsg}`);
        console.error(`Fetch error page ${currentPage}:`, errMsg);
        break;
      }
    }

    results.elapsed_ms = Date.now() - startTime;

    // Log to audit
    await supabase.from("cron_audit_log").insert({
      cron_name: "autotrader-api-ingest",
      success: results.api_errors.length === 0,
      result: results,
      run_date: new Date().toISOString().split("T")[0],
    });

    console.log("AutoTrader API ingest complete:", JSON.stringify(results, null, 2));

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("AutoTrader API ingest error:", errorMsg);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    await supabase.from("cron_audit_log").insert({
      cron_name: "autotrader-api-ingest",
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
