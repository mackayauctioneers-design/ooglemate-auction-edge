import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * PICKLES API PROBE - Find the actual API endpoint
 * 
 * Tries common API endpoint patterns that Vue SPAs use
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-AU,en;q=0.9",
  "Referer": "https://www.pickles.com.au/used/search/lob/cars-motorcycles/cars/hyundai/i30",
  "Origin": "https://www.pickles.com.au",
  "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
};

// Common API endpoint patterns to try
const API_ENDPOINTS = [
  // REST API patterns
  "/api/search",
  "/api/v1/search",
  "/api/v2/search",
  "/api/used/search",
  "/api/vehicles/search",
  "/api/listings/search",
  "/api/items/search",
  "/api/catalogue/search",
  
  // GraphQL
  "/graphql",
  "/api/graphql",
  
  // Kentico/CMS patterns (Pickles uses Kentico)
  "/kentico/rest/items",
  "/rest/items",
  "/cmsapi/items",
  
  // Elasticsearch patterns
  "/_search",
  "/search/_search",
  "/vehicles/_search",
  
  // Other common patterns
  "/ajax/search",
  "/xhr/search",
  "/data/search",
  "/feed/search",
  "/service/search",
  
  // Specific to auction sites
  "/auction/api/search",
  "/auction/listings",
  "/lots/search",
  "/catalogue/search",
  
  // Vue/Nuxt patterns
  "/_nuxt/api/search",
  "/api/_content/search",
];

async function probeEndpoint(baseUrl: string, endpoint: string, params: string): Promise<{
  endpoint: string;
  url: string;
  status: number;
  contentType: string;
  bodyPreview: string;
  isJson: boolean;
  hasListings: boolean;
}> {
  const url = `${baseUrl}${endpoint}${params}`;
  
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: BROWSER_HEADERS,
    });
    
    const contentType = response.headers.get("content-type") || "";
    const body = await response.text();
    const isJson = contentType.includes("json") || body.startsWith("{") || body.startsWith("[");
    
    // Check if response contains listing-like data
    const hasListings = body.includes("stockId") || 
                        body.includes("listingId") ||
                        body.includes("vehicle") ||
                        body.includes("make") && body.includes("model") ||
                        body.includes("i30") ||
                        body.includes("hyundai");
    
    return {
      endpoint,
      url,
      status: response.status,
      contentType,
      bodyPreview: body.substring(0, 500),
      isJson,
      hasListings,
    };
  } catch (error) {
    return {
      endpoint,
      url,
      status: 0,
      contentType: "",
      bodyPreview: `Error: ${error instanceof Error ? error.message : String(error)}`,
      isJson: false,
      hasListings: false,
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { make = "hyundai", model = "i30" } = body;
    
    const baseUrl = "https://www.pickles.com.au";
    const params = `?make=${make}&model=${model}&limit=10`;
    
    console.log(`[PROBE] Starting API endpoint probe for ${make} ${model}`);
    
    const results: Array<{
      endpoint: string;
      status: number;
      isJson: boolean;
      hasListings: boolean;
      preview?: string;
    }> = [];
    
    // Probe all endpoints in parallel (batch of 5)
    for (let i = 0; i < API_ENDPOINTS.length; i += 5) {
      const batch = API_ENDPOINTS.slice(i, i + 5);
      const batchResults = await Promise.all(
        batch.map(endpoint => probeEndpoint(baseUrl, endpoint, params))
      );
      
      for (const result of batchResults) {
        console.log(`[PROBE] ${result.endpoint}: ${result.status} json=${result.isJson} listings=${result.hasListings}`);
        
        results.push({
          endpoint: result.endpoint,
          status: result.status,
          isJson: result.isJson,
          hasListings: result.hasListings,
          preview: result.hasListings ? result.bodyPreview : undefined,
        });
      }
      
      // Small delay between batches
      await new Promise(r => setTimeout(r, 200));
    }
    
    // Find promising endpoints
    const promising = results.filter(r => r.status === 200 && r.isJson);
    const withListings = results.filter(r => r.hasListings);
    
    console.log(`[PROBE] Found ${promising.length} JSON endpoints, ${withListings.length} with listing data`);
    
    return new Response(
      JSON.stringify({
        success: true,
        total_probed: API_ENDPOINTS.length,
        promising_json: promising,
        with_listings: withListings,
        all_results: results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[PROBE] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
