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
async function tryJsonApi(
  page: number, 
  yearMin: number, 
  yearMax: number, 
  kmMax: number, 
  pageSize: number,
  session: SessionSecret | null
): Promise<{ 
  success: boolean; 
  listings: ParsedListing[]; 
  status?: number;
  errorPreview?: string;
  totalAvailable?: number;
  usedCookie: boolean;
}> {
  const params = new URLSearchParams({
    "attributeMap[cars.carmileageinkms_i_TO]": kmMax.toString(),
    "attributeMap[cars.caryear_i_FROM]": yearMin.toString(),
    "attributeMap[cars.caryear_i_TO]": yearMax.toString(),
    "attributeMap[cars.forsaleby_s]": "delr",
    "categoryId": "18320",
    "categoryName": "Cars, Vans & Utes",
    "defaultRadius": "10",
    "locationId": "0",
    "locationStr": "Australia",
    "pageNum": page.toString(),
    "pageSize": pageSize.toString(),
    "previousCategoryId": "18320",
    "radius": "0",
    "searchView": "GALLERY",
    "sortByName": "date",
  });

  const url = `https://www.gumtree.com.au/ws/search.json?${params.toString()}`;
  const referer = `https://www.gumtree.com.au/s-cars-vans-utes/caryear-${yearMin}__${yearMax}/c18320?carmileageinkms=__${kmMax}&forsaleby=delr&sort=date&view=gallery`;
  
  // Build headers - use stored session if available
  const headers: Record<string, string> = {
    "accept": "application/json",
    "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
    "referer": referer,
    "x-requested-with": "XMLHttpRequest",
    "user-agent": session?.user_agent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
  };
  
  // Add cookie if we have a valid session
  const usedCookie = !!(session?.cookie_header && session.cookie_header.length > 0);
  if (usedCookie) {
    headers["cookie"] = session.cookie_header;
  }
  
  try {
    const response = await fetch(url, { method: "GET", headers });

    if (!response.ok) {
      const body = await response.text();
      return { 
        success: false, 
        listings: [], 
        status: response.status,
        errorPreview: body.slice(0, 200),
        usedCookie,
      };
    }

    const jsonData: GumtreeJsonResponse = await response.json();
    const listings = parseJsonResponse(jsonData, yearMin);
    const totalAvailable = jsonData.data?.results?.paging?.totalResultCount || 0;
    
    return { success: true, listings, totalAvailable, usedCookie };
  } catch (err) {
    return { 
      success: false, 
      listings: [], 
      errorPreview: err instanceof Error ? err.message : String(err),
      usedCookie,
    };
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

    // Load session cookie if available
    let session: SessionSecret | null = null;
    const { data: sessionRow } = await supabase
      .from("http_session_secrets")
      .select("cookie_header, user_agent, expires_at")
      .eq("site", "gumtree")
      .maybeSingle();
    
    if (sessionRow) {
      // Check if expired
      const isExpired = sessionRow.expires_at && new Date(sessionRow.expires_at) < new Date();
      if (!isExpired && sessionRow.cookie_header) {
        session = sessionRow as SessionSecret;
        console.log(`Loaded Gumtree session cookie (${session.cookie_header.length} chars)`);
      } else {
        console.log(`Gumtree session expired or empty`);
      }
    }

    let listings: ParsedListing[] = [];
    let lane: 'json' | 'firecrawl' = 'json';
    let jsonApiStatus: number | undefined;
    let jsonApiError: string | undefined;
    let usedCookie = false;

    // Try JSON API first (with cookie if available)
    console.log(`Trying Gumtree JSON API: page=${page}, hasCookie=${!!session}`);
    const jsonResult = await tryJsonApi(page, year_min, year_max, km_max, page_size, session);
    usedCookie = jsonResult.usedCookie;
    
    if (jsonResult.success && jsonResult.listings.length > 0) {
      listings = jsonResult.listings;
      lane = 'json';
      console.log(`JSON API success: ${listings.length} listings (total available: ${jsonResult.totalAvailable})`);
    } else {
      // Log JSON failure details
      jsonApiStatus = jsonResult.status;
      jsonApiError = jsonResult.errorPreview;
      console.log(`JSON API failed: status=${jsonApiStatus}, preview=${jsonApiError}`);
      
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
