import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// No CORS for internal-only function
const internalHeaders = {
  "Content-Type": "application/json",
};

// AutoTrader API configuration
const AUTOTRADER_API_BASE = "https://listings.platform.autotrader.com.au/api/v3/search";
const DEFAULT_PAGINATE = 48;
const MAX_PAGES_PER_RUN = 10;
const MAX_LISTINGS_PER_RUN = 200; // Hard cap to prevent runaway
const TIME_BUDGET_MS = 28000;
const RETRY_DELAY_MS = 500;

// Internal secret - MUST be set in env for production
const INTERNAL_SECRET = Deno.env.get("AUTOTRADER_INTERNAL_SECRET");
if (!INTERNAL_SECRET) {
  console.warn("WARNING: AUTOTRADER_INTERNAL_SECRET not set, using fallback");
}
const SECRET = INTERNAL_SECRET || "autotrader-internal-v1";

// Retry helper with jitter
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 1): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok || response.status < 500) {
        return response;
      }
      // 5xx error - retry
      if (attempt < maxRetries) {
        const jitter = Math.random() * 300;
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS + jitter));
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const jitter = Math.random() * 300;
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS + jitter));
      }
    }
  }
  throw lastError;
}

interface AutotraderApiSource {
  id: number;
  source_ref_id?: string;
  manu_year?: number;
  make?: string;
  model?: string;
  variant?: string;
  badge?: string;
  series?: string;
  transmission?: string;
  fuel_type?: string;
  body_type?: string;
  odometer?: number;
  colour_body?: string;
  vin?: string;
  rego?: string;
  condition?: string;
  state?: string;
  suburb?: string;
  postcode?: string;
  seller_name?: string;
  price?: {
    advertised_price?: number;
    driveaway_price?: number;
    egc_price?: number;
  };
  price_display?: number;
  [key: string]: unknown;
}

interface AutotraderHit {
  _id?: string;
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

function parseHit(hit: AutotraderHit): ParsedListing | null {
  try {
    const source = hit._source;
    if (!source) return null;

    // ID: prefer source.id, fallback to _id
    const listingId = source.id?.toString() || hit._id || source.source_ref_id?.toString();
    if (!listingId) return null;

    // Year is called manu_year
    const year = source.manu_year || 0;
    if (year < 2000 || year > new Date().getFullYear() + 1) return null;

    const make = (source.make || "").toString().toUpperCase().trim();
    const model = (source.model || "").toString().toUpperCase().trim();
    if (!make || !model) return null;

    // Price: nested in price object → advertised_price or driveaway_price
    const price = source.price?.advertised_price 
      || source.price?.driveaway_price 
      || source.price?.egc_price
      || source.price_display 
      || 0;
    if (price < 1000 || price > 500000) return null;

    // Variant from badge/variant/series
    const variant = [source.badge, source.variant, source.series]
      .filter(Boolean)
      .map(v => String(v).toUpperCase().trim())
      .join(" ")
      .trim() || undefined;

    const km = typeof source.odometer === "number" ? source.odometer : undefined;
    const state = source.state?.toString().toUpperCase() || undefined;
    const suburb = source.suburb?.toString() || undefined;

    return {
      source_listing_id: String(listingId),
      listing_url: `https://www.autotrader.com.au/car/${listingId}`,
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
    console.error("Error parsing hit:", err);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: internalHeaders });
  }

  const startTime = Date.now();

  // Check internal secret header
  const internalSecret = req.headers.get("x-internal-secret");
  if (internalSecret !== SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: internalHeaders,
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = await req.json().catch(() => ({}));
    const {
      cursor_id = null, // For cursor-based crawling
      make = null,
      model = null,
      state = null,
      year_min = 2016,
      year_max = null,
      page_start = 1,
      max_pages = MAX_PAGES_PER_RUN,
    } = body;

    const results = {
      cursor_id,
      make,
      state,
      total_api_results: 0,
      pages_fetched: 0,
      last_page_crawled: page_start - 1,
      raw_payloads_stored: 0,
      new_raw_payloads: 0,
      new_listings: 0,
      updated_listings: 0,
      price_changes: 0,
      parse_errors: 0,
      api_errors: [] as string[],
      has_more: false,
      elapsed_ms: 0,
    };

    let currentPage = page_start;
    let hasMore = true;

    while (hasMore && currentPage < page_start + max_pages) {
      // Check time budget
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        console.log(`Time budget exhausted at page ${currentPage}`);
        results.has_more = true;
        break;
      }

      // Build API URL with EXACT DevTools params
      // Build URL with EXACT DevTools params
      const params = new URLSearchParams();
      params.set("page", currentPage.toString());
      params.set("paginate", DEFAULT_PAGINATE.toString());
      params.set("sortBy", "listing_created");
      params.set("orderBy", "desc");
      params.set("sourceCondition", "1:Used"); // EXACT value from DevTools
      params.set("ipLookup", "1");
      params.set("sorting_variation", "smart_sort_3");
      if (year_min) params.set("yearFrom", year_min.toString());
      if (year_max) params.set("yearTo", year_max.toString());
      
      // Filters - make works with lowercase
      if (make) params.set("make", make.toLowerCase());
      // State filter: try "state" (observed in _source field)
      if (state) params.set("state", state.toLowerCase());

      const apiUrl = `${AUTOTRADER_API_BASE}?${params.toString()}`;
      console.log(`Fetching page ${currentPage}: ${apiUrl}`);

      try {
        const response = await fetchWithRetry(apiUrl, {
          headers: {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          results.api_errors.push(`Page ${currentPage}: ${response.status}`);
          console.error(`API error page ${currentPage}: ${response.status} - ${errorText.slice(0, 200)}`);
          break;
        }

        const data = await response.json();

        // Parse response - data is array of hits
        let hits: AutotraderHit[] = [];
        let totalResults = 0;

        if (Array.isArray(data)) {
          hits = data;
          totalResults = data.length;
        } else if (data.data && Array.isArray(data.data)) {
          hits = data.data;
          totalResults = data.total || data.totalResults || hits.length;
        } else if (data.results && Array.isArray(data.results)) {
          hits = data.results;
          totalResults = data.total || data.totalResults || hits.length;
        }

        if (hits.length === 0) {
          console.log(`No hits on page ${currentPage}`);
          hasMore = false;
          break;
        }

        if (currentPage === page_start) {
          results.total_api_results = totalResults || hits.length * 10;
          console.log(`First page: ${hits.length} hits, estimated total: ${results.total_api_results}`);
        }

        console.log(`Page ${currentPage}: ${hits.length} hits`);
        results.pages_fetched++;
        results.last_page_crawled = currentPage;

        // Process each hit with MAX_LISTINGS_PER_RUN cap
        for (const hit of hits) {
          // Hard cap check
          if (results.raw_payloads_stored >= MAX_LISTINGS_PER_RUN) {
            console.log(`Hit MAX_LISTINGS_PER_RUN (${MAX_LISTINGS_PER_RUN}), stopping`);
            results.has_more = true;
            hasMore = false;
            break;
          }

          try {
            const source = hit._source;
            if (!source) continue;

            const listingId = source.id?.toString() || hit._id || source.source_ref_id?.toString();
            if (!listingId) continue;

            const price = source.price?.advertised_price 
              || source.price?.driveaway_price 
              || source.price_display 
              || 0;

            // Store full hit (not just _source) for metadata like _score, _id
            const { data: rawResult, error: rawError } = await supabase.rpc("autotrader_raw_seen", {
              p_source_listing_id: listingId,
              p_payload: hit, // Full hit including _source, _score, _id
              p_price: price,
            });

            if (rawError) {
              console.error(`Raw upsert error for ${listingId}:`, rawError.message);
              continue;
            }

            results.raw_payloads_stored++;
            if (rawResult?.[0]?.is_new || rawResult?.is_new) {
              results.new_raw_payloads++;
            }

            // Parse and upsert to retail_listings
            const parsed = parseHit(hit);
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
            if (result?.is_new) results.new_listings++;
            else results.updated_listings++;
            if (result?.price_changed) results.price_changes++;

          } catch (err) {
            console.error("Error processing hit:", err);
            results.parse_errors++;
          }
        }

        // Check if more pages
        hasMore = hits.length === DEFAULT_PAGINATE;
        if (hasMore) {
          results.has_more = true;
        }
        currentPage++;

      } catch (fetchErr) {
        const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        results.api_errors.push(`Page ${currentPage}: ${errMsg}`);
        console.error(`Fetch error page ${currentPage}:`, errMsg);
        break;
      }
    }

    results.elapsed_ms = Date.now() - startTime;

    // Update cursor if provided
    if (cursor_id) {
      await supabase.rpc("update_autotrader_crawl_cursor", {
        p_cursor_id: cursor_id,
        p_page_crawled: results.last_page_crawled,
        p_listings_found: results.raw_payloads_stored,
        p_has_more: results.has_more,
        p_error: results.api_errors.length > 0 ? results.api_errors.join("; ") : null,
      });
    }

    // Log to audit
    await supabase.from("cron_audit_log").insert({
      cron_name: "autotrader-api-ingest",
      success: results.api_errors.length === 0,
      result: results,
      run_date: new Date().toISOString().split("T")[0],
    });

    console.log("AutoTrader API ingest complete:", JSON.stringify(results));

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: internalHeaders,
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("AutoTrader API ingest error:", errorMsg);

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: internalHeaders,
    });
  }
});
