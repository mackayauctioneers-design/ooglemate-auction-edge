import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GumtreeAdData {
  id: string;
  title?: string;
  mainAttributes?: {
    carmake_s?: string;
    carmodel_s?: string;
    caryear_i?: number;
    carmileageinkms_i?: number;
  };
  price?: {
    amount?: number;
  };
  mapAddress?: {
    state?: string;
    suburb?: string;
    postcode?: string;
  };
}

interface GumtreeJsonResponse {
  data?: {
    results?: {
      results?: GumtreeAdData[];
      paging?: {
        totalResultCount?: number;
        numPages?: number;
      };
    };
  };
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
  state: string;
  suburb?: string;
}

interface SessionSecret {
  cookie_header: string;
  user_agent: string;
  expires_at: string | null;
}

// Parse listings from JSON API response
function parseJsonResponse(data: GumtreeJsonResponse, yearMin: number): ParsedListing[] {
  const listings: ParsedListing[] = [];
  const ads = data.data?.results?.results || [];
  
  for (const ad of ads) {
    try {
      const attrs = ad.mainAttributes || {};
      const make = attrs.carmake_s?.toUpperCase() || "";
      const model = attrs.carmodel_s?.toUpperCase() || "";
      const year = attrs.caryear_i || 0;
      const km = attrs.carmileageinkms_i || undefined;
      const price = ad.price?.amount || 0;
      
      if (!make || !model || !year || year < yearMin) continue;
      if (price < 1000 || price > 500000) continue;
      
      const state = ad.mapAddress?.state?.toUpperCase() || "AU";
      const suburb = ad.mapAddress?.suburb || undefined;
      
      // Extract variant from title
      let variantRaw: string | undefined;
      if (ad.title) {
        const titleParts = ad.title.replace(/^\d{4}\s+/, '').split(/\s+/);
        if (titleParts.length > 2) {
          variantRaw = titleParts.slice(2).join(' ').toUpperCase();
        }
      }
      
      listings.push({
        source_listing_id: ad.id,
        listing_url: `https://www.gumtree.com.au/s-ad/${ad.id}`,
        year,
        make,
        model,
        variant_raw: variantRaw,
        km,
        asking_price: price,
        state,
        suburb,
      });
    } catch {
      continue;
    }
  }
  
  return listings;
}

// Parse Gumtree listings from markdown (Firecrawl fallback)
function parseGumtreeMarkdown(markdown: string, yearMin: number): ParsedListing[] {
  const listings: ParsedListing[] = [];
  const listingBlocks = markdown.split(/\[!\[/g).filter(block => block.includes("gumtree.com.au/s-ad/"));
  
  for (const block of listingBlocks) {
    try {
      const urlMatch = block.match(/\]\((https:\/\/www\.gumtree\.com\.au\/s-ad\/[^)]+\/(\d+))\)/);
      if (!urlMatch) continue;
      
      const listingUrl = urlMatch[1];
      const adId = urlMatch[2];
      
      const titleMatch = block.match(/(?:Top|Featured|Urgent)?(\d{4})\s+([A-Za-z-]+)\s+([A-Za-z0-9]+)(?:\s+([A-Za-z0-9-]+))?/);
      if (!titleMatch) continue;
      
      const [, yearStr, make, model, variant] = titleMatch;
      const year = parseInt(yearStr, 10);
      if (year < yearMin) continue;
      
      const kmMatch = block.match(/[\-•]\s*([\d,]+)\s*km/i);
      const km = kmMatch ? parseInt(kmMatch[1].replace(/,/g, ''), 10) : undefined;
      
      const priceMatch = block.match(/\$([\d,]+)/);
      if (!priceMatch) continue;
      const price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
      if (price < 1000 || price > 500000) continue;
      
      const locationMatch = block.match(/([A-Za-z\s]+),\s*([A-Z]{2,3})•/);
      const state = locationMatch ? locationMatch[2].toUpperCase() : 'AU';
      const suburb = locationMatch ? locationMatch[1].trim() : undefined;
      
      listings.push({
        source_listing_id: adId,
        listing_url: listingUrl,
        year,
        make: make.toUpperCase().replace(/-/g, ' '),
        model: model.toUpperCase(),
        variant_raw: variant?.toUpperCase() || undefined,
        km,
        asking_price: price,
        state,
        suburb,
      });
    } catch {
      continue;
    }
  }
  
  return listings;
}

// Try JSON API with stored cookies
/**
 * Validate JSON API results meet quality criteria
 */
function validateJsonResults(results: GumtreeAdData[], yearMin: number): { valid: boolean; reason?: string } {
  if (!Array.isArray(results) || results.length < 5) {
    return { valid: false, reason: `Only ${results?.length || 0} results (need ≥5)` };
  }

  // Check years are within expected range
  let validYears = 0;
  for (const item of results.slice(0, 10)) {
    const year = item.mainAttributes?.caryear_i;
    if (year && year >= yearMin && year <= 2026) {
      validYears++;
    }
  }

  if (validYears < 3) {
    return { valid: false, reason: `Year validation failed (${validYears}/10 valid)` };
  }

  return { valid: true };
}

// deno-lint-ignore no-explicit-any
async function tryJsonApi(
  supabase: any,
  page: number,
  yearMin: number,
  make: string | null,
  state: string | null
): Promise<{ success: boolean; listings: ParsedListing[]; status: number; error?: string; usedCookie: boolean; totalAvailable?: number }> {
  try {
    // Load session secrets - use explicit typing to avoid 'never' issues
    const { data: sessionData, error: sessionError } = await supabase
      .from("http_session_secrets")
      .select("cookie_header, user_agent, expires_at, last_error")
      .eq("site", "gumtree")
      .maybeSingle();

    const session = sessionData as { cookie_header: string; user_agent: string; expires_at: string | null; last_error: string | null } | null;

    // Check if we have valid, unexpired cookies
    const now = new Date();
    const hasValidCookie = session?.cookie_header && 
      session.cookie_header.length > 20 &&
      (!session.expires_at || new Date(session.expires_at) > now) &&
      !session.last_error;

    if (!hasValidCookie) {
      const reason = sessionError?.message || 
        (!session?.cookie_header ? "No cookie stored" : 
         session.last_error ? `Previous error: ${session.last_error}` :
         session.expires_at && new Date(session.expires_at) <= now ? "Cookie expired" : "Unknown");
      console.log(`JSON lane skipped: ${reason}`);
      return { success: false, listings: [], status: 0, error: reason, usedCookie: false };
    }

    const userAgent = session.user_agent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

    // Build search parameters
    const params = new URLSearchParams({
      "categoryId": "18320",
      "pageNum": String(page),
      "pageSize": "48",
      "sortByName": "date",
      "locationId": "0",
      "attributeMap[cars.caryear_i_FROM]": String(yearMin),
      "attributeMap[cars.caryear_i_TO]": "2025",
      "attributeMap[cars.carmileageinkms_i_TO]": "150000",
      "attributeMap[cars.forsaleby_s]": "delr",
    });

    if (make) {
      params.set("attributeMap[cars.carmake_s]", make.toLowerCase());
    }
    if (state) {
      params.set("attributeMap[cars.carstate_s]", state.toLowerCase());
    }

    const url = `https://www.gumtree.com.au/ws/search.json?${params.toString()}`;
    const referer = `https://www.gumtree.com.au/s-cars-vans-utes/caryear-${yearMin}__2025/c18320?carmileageinkms=__150000&forsaleby=delr&sort=date&view=gallery`;

    console.log(`JSON API attempt with cookie (${session.cookie_header.length} chars)`);

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "accept": "application/json",
        "referer": referer,
        "x-requested-with": "XMLHttpRequest",
        "user-agent": userAgent,
        "cookie": session.cookie_header,
      },
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      console.log(`JSON API failed: ${res.status} - ${errorText.slice(0, 100)}`);
      
      // Mark cookie as bad if we get 403
      if (res.status === 403 || res.status === 429) {
        // deno-lint-ignore no-explicit-any
        await (supabase as any)
          .from("http_session_secrets")
          .update({ 
            last_error: `HTTP ${res.status} at ${new Date().toISOString()}`,
            expires_at: new Date().toISOString()
          })
          .eq("site", "gumtree");
      }
      
      return { success: false, listings: [], status: res.status, error: errorText.slice(0, 200), usedCookie: true };
    }

    const data: GumtreeJsonResponse = await res.json();
    const results = data?.data?.results?.results || [];
    const totalAvailable = data?.data?.results?.paging?.totalResultCount || 0;

    // Validate results quality
    const validation = validateJsonResults(results, yearMin);
    if (!validation.valid) {
      console.log(`JSON API validation failed: ${validation.reason}`);
      
      // Mark cookie as suspect
      // deno-lint-ignore no-explicit-any
      await (supabase as any)
        .from("http_session_secrets")
        .update({ 
          last_error: `Validation failed: ${validation.reason} at ${new Date().toISOString()}`,
        })
        .eq("site", "gumtree");
      
      return { success: false, listings: [], status: res.status, error: validation.reason, usedCookie: true };
    }

    const listings = parseJsonResponse(data, yearMin);
    console.log(`JSON API success: ${listings.length} valid listings from ${results.length} results`);

    // Clear any previous errors on success
    // deno-lint-ignore no-explicit-any
    await (supabase as any)
      .from("http_session_secrets")
      .update({ last_error: null })
      .eq("site", "gumtree");

    return { success: true, listings, status: res.status, usedCookie: true, totalAvailable };

  } catch (err) {
    console.error("JSON API error:", err);
    return { success: false, listings: [], status: 0, error: err instanceof Error ? err.message : String(err), usedCookie: false };
  }
}

// Firecrawl fallback
async function tryFirecrawl(
  firecrawlKey: string,
  page: number,
  yearMin: number,
  make?: string,
  state?: string
): Promise<{ success: boolean; listings: ParsedListing[]; error?: string }> {
  let searchUrl = "https://www.gumtree.com.au/s-cars-vans-utes";
  const pathParts: string[] = [];
  const queryParams = new URLSearchParams();
  
  if (make) pathParts.push(`carmake-${make.toLowerCase().replace(/\s+/g, '')}`);
  if (state) pathParts.push(state.toLowerCase());
  
  searchUrl += pathParts.length > 0 ? `/${pathParts.join('/')}/c18320` : "/c18320";
  queryParams.append("caryearfrom1", yearMin.toString());
  if (page > 1) queryParams.append("page", page.toString());
  searchUrl += `?${queryParams.toString()}`;

  try {
    const scrapeResponse = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: searchUrl,
        formats: ["markdown"],
        waitFor: 5000,
        onlyMainContent: false,
      }),
    });

    if (!scrapeResponse.ok) {
      const errorData = await scrapeResponse.json();
      return { success: false, listings: [], error: `Firecrawl error: ${errorData.error || scrapeResponse.status}` };
    }

    const scrapeData = await scrapeResponse.json();
    const markdown = scrapeData.data?.markdown || scrapeData.markdown || "";
    const listings = parseGumtreeMarkdown(markdown, yearMin);
    
    return { success: true, listings };
  } catch (err) {
    return { success: false, listings: [], error: err instanceof Error ? err.message : String(err) };
  }
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

    const body = await req.json().catch(() => ({}));
    const { 
      make = null, 
      state = null,
      page = 1,
      page_size = 24,
      year_min = 2016,
      year_max = 2025,
      km_max = 150000,
      limit = 50 
    } = body;

    let listings: ParsedListing[] = [];
    let lane: 'json' | 'firecrawl' = 'json';
    let jsonApiStatus: number | undefined;
    let jsonApiError: string | undefined;
    let usedCookie = false;

    // Try JSON API first (supabase handles cookie loading internally)
    console.log(`Trying Gumtree JSON API: page=${page}`);
    const jsonResult = await tryJsonApi(supabase, page, year_min, make, state);
    usedCookie = jsonResult.usedCookie;
    
    if (jsonResult.success && jsonResult.listings.length > 0) {
      listings = jsonResult.listings;
      lane = 'json';
      console.log(`JSON API success: ${listings.length} listings (total available: ${jsonResult.totalAvailable})`);
    } else {
      // Log JSON failure details
      jsonApiStatus = jsonResult.status;
      jsonApiError = jsonResult.error;
      console.log(`JSON API failed: status=${jsonApiStatus}, error=${jsonApiError}`);
      
      // Fallback to Firecrawl
      const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
      if (firecrawlKey) {
        console.log("Falling back to Firecrawl...");
        const firecrawlResult = await tryFirecrawl(firecrawlKey, page, year_min, make, state);
        
        if (firecrawlResult.success) {
          listings = firecrawlResult.listings;
          lane = 'firecrawl';
          console.log(`Firecrawl success: ${listings.length} listings`);
        } else {
          throw new Error(`Both lanes failed. JSON: ${jsonApiError}. Firecrawl: ${firecrawlResult.error}`);
        }
      } else {
        throw new Error(`JSON API failed (${jsonApiStatus}): ${jsonApiError}. No FIRECRAWL_API_KEY for fallback.`);
      }
    }

    // Upsert listings
    const results = {
      lane,
      used_cookie: usedCookie,
      json_api_status: jsonApiStatus,
      json_api_error: jsonApiError,
      total_found: listings.length,
      new_listings: 0,
      updated_listings: 0,
      price_changes: 0,
      errors: 0,
      sample_listings: [] as string[],
    };

    for (const listing of listings.slice(0, limit)) {
      try {
        const { data, error } = await supabase.rpc("upsert_retail_listing", {
          p_source: "gumtree",
          p_source_listing_id: listing.source_listing_id,
          p_listing_url: listing.listing_url,
          p_year: listing.year,
          p_make: listing.make,
          p_model: listing.model,
          p_variant_raw: listing.variant_raw || null,
          p_variant_family: null,
          p_km: listing.km || null,
          p_asking_price: listing.asking_price,
          p_state: listing.state,
          p_suburb: listing.suburb || null,
        });

        if (error) {
          console.error(`Error upserting ${listing.source_listing_id}:`, error.message);
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
      } catch (err) {
        console.error(`Error processing listing:`, err);
        results.errors++;
      }
    }

    await supabase.from("cron_audit_log").insert({
      cron_name: "gumtree-ingest",
      success: true,
      result: results,
      run_date: new Date().toISOString().split("T")[0],
    });

    console.log("Gumtree ingest complete:", results);

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Gumtree ingest error:", errorMsg);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    await supabase.from("cron_audit_log").insert({
      cron_name: "gumtree-ingest",
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
