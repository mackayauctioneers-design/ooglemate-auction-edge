// Version: 5 - Handle direct JSON responses, simplified filter
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PICKLES_API =
  "https://www.pickles.com.au/api-website/buyer/ms-web-asset-search/v2/api/product/public/search";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json().catch(() => ({}));
    const {
      page = 0,
      page_size = 120,
      max_pages = 10,
      debug = false,
    } = body;

    console.log(`[HARVEST] Starting Phase-1 Pickles API harvest (all cars)`);

    // Create harvest run record
    const runId = crypto.randomUUID();
    const searchUrl = "https://www.pickles.com.au/used/search/lob/cars-motorcycles/cars";
    
    await supabase.from("pickles_harvest_runs").insert({
      id: runId,
      search_url: searchUrl,
      status: "running",
    });

    if (debug) {
      // Build sample payload for debugging
      const samplePayload = buildSearchPayload(page_size, 0);
      return new Response(
        JSON.stringify({
          success: true,
          debug: true,
          run_id: runId,
          api_endpoint: PICKLES_API,
          sample_payload: samplePayload,
          encoded_sample: btoa(JSON.stringify(samplePayload)),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Harvest multiple pages
    const allRows: HarvestRow[] = [];
    const errors: string[] = [];
    let pagesCrawled = 0;
    let totalFromApi = 0;

    for (let currentPage = page; currentPage < page + max_pages; currentPage++) {
      console.log(`[HARVEST] Page ${currentPage + 1}/${max_pages}`);
      
      try {
        const result = await fetchPicklesPage(page_size, currentPage);
        if (result.error) {
          errors.push(`Page ${currentPage}: ${result.error}`);
          break;
        }

        totalFromApi = result.totalCount || 0;
        pagesCrawled++;

        if (result.rows.length === 0) {
          console.log(`[HARVEST] Page ${currentPage}: No more results`);
          break;
        }

        allRows.push(...result.rows);
        console.log(`[HARVEST] Page ${currentPage}: ${result.rows.length} items (total so far: ${allRows.length})`);

        // Check if we've got all results
        if (allRows.length >= totalFromApi) {
          console.log(`[HARVEST] Reached total count: ${allRows.length}/${totalFromApi}`);
          break;
        }

        // Rate limit between pages
        await new Promise(r => setTimeout(r, 500));
        
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[HARVEST] Page ${currentPage} error:`, errMsg);
        errors.push(`Page ${currentPage}: ${errMsg}`);
        break;
      }
    }

    // Dedupe by stockId
    const uniqueRows = new Map<string, HarvestRow>();
    for (const row of allRows) {
      if (!uniqueRows.has(row.source_listing_id)) {
        uniqueRows.set(row.source_listing_id, row);
      }
    }

    console.log(`[HARVEST] Total unique: ${uniqueRows.size}`);

    // Batch upsert via RPC
    let urlsNew = 0;
    let urlsUpdated = 0;

    if (uniqueRows.size > 0) {
      const batchItems = Array.from(uniqueRows.values()).map(row => ({
        detail_url: row.detail_url,
        source_listing_id: row.source_listing_id,
        search_url: searchUrl,
        page_no: row.page_no,
      }));

      const { data: upsertResult, error: upsertErr } = await supabase.rpc(
        "upsert_pickles_harvest_batch",
        {
          p_items: batchItems,
          p_run_id: runId,
        }
      );

      if (upsertErr) {
        console.error("[HARVEST] Batch upsert failed:", upsertErr.message);
        errors.push(`Batch upsert: ${upsertErr.message}`);
      } else {
        urlsNew = upsertResult?.inserted || 0;
        urlsUpdated = upsertResult?.updated || 0;
        console.log(`[HARVEST] Upsert: ${urlsNew} new, ${urlsUpdated} updated`);
      }
    }

    // Update run record
    await supabase.from("pickles_harvest_runs").update({
      pages_crawled: pagesCrawled,
      urls_harvested: uniqueRows.size,
      urls_new: urlsNew,
      urls_existing: urlsUpdated,
      errors: errors.length > 0 ? errors : null,
      status: errors.length > 0 && uniqueRows.size === 0 ? "failed" : "completed",
    }).eq("id", runId);

    return new Response(
      JSON.stringify({
        success: true,
        run_id: runId,
        pages_crawled: pagesCrawled,
        total_from_api: totalFromApi,
        harvested: uniqueRows.size,
        urls_new: urlsNew,
        urls_existing: urlsUpdated,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[HARVEST] Error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

interface HarvestRow {
  source_listing_id: string;
  detail_url: string;
  page_no: number;
}

interface FetchResult {
  rows: HarvestRow[];
  totalCount: number;
  error?: string;
}

/**
 * Build the search payload for Pickles API
 * Phase-1: Discover ALL items (cars filter applied after testing confirms it works)
 */
function buildSearchPayload(
  pageSize = 120,
  page = 0
): Record<string, unknown> {
  // Empty filter works - 11,513 results. Keep it simple for Phase-1.
  // Downstream fingerprinting will filter by make/model.
  return {
    search: "*",
    top: pageSize,
    skip: page * pageSize,
    count: true,
    orderby: "year desc",
    filter: "",
    facets: [],
  };
}

/**
 * Fetch a page of results from Pickles API
 */
async function fetchPicklesPage(
  pageSize = 120,
  page = 0
): Promise<FetchResult> {
  const searchPayload = buildSearchPayload(pageSize, page);
  const encodedPayload = btoa(JSON.stringify(searchPayload));

  console.log(`[FETCH] Calling Pickles API page=${page}, filter=${searchPayload.filter}`);

  const res = await fetch(PICKLES_API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-encode-base64": "true",
      "origin": "https://www.pickles.com.au",
      "referer": "https://www.pickles.com.au/used/search/lob/cars-motorcycles/cars",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({ data: encodedPayload }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return { rows: [], totalCount: 0, error: `API ${res.status}: ${errText.substring(0, 200)}` };
  }

  const apiResponse = await res.json();
  
  console.log(`[FETCH] API response keys: ${Object.keys(apiResponse).join(', ')}`);
  
  // Handle both base64-encoded and direct JSON responses
  let decoded: { value?: unknown[]; "@odata.count"?: number };
  
  if (apiResponse?.data && typeof apiResponse.data === "string") {
    // Base64-encoded response
    try {
      decoded = JSON.parse(atob(apiResponse.data));
      console.log(`[FETCH] Decoded base64 response`);
    } catch (e) {
      console.error(`[FETCH] Base64 decode failed:`, e);
      return { rows: [], totalCount: 0, error: `Failed to decode base64: ${e}` };
    }
  } else if (apiResponse?.value !== undefined || apiResponse?.["@odata.count"] !== undefined) {
    // Direct JSON response (no encoding)
    decoded = apiResponse;
    console.log(`[FETCH] Using direct JSON response`);
  } else {
    console.warn("[FETCH] Unexpected response format:", JSON.stringify(apiResponse).slice(0, 300));
    return { rows: [], totalCount: 0, error: "Unexpected response format" };
  }

  const items = decoded.value ?? [];
  const totalCount = decoded["@odata.count"] ?? 0;

  if (!Array.isArray(items)) {
    return { rows: [], totalCount: 0, error: "Invalid response format" };
  }

  console.log(`[FETCH] Got ${items.length} items, total=${totalCount}`);

  // Extract rows
  const rows: HarvestRow[] = [];
  
  for (const item of items) {
    const stockId = (item as Record<string, unknown>).productId ||
                    (item as Record<string, unknown>).assetId ||
                    (item as Record<string, unknown>).id;

    if (!stockId) continue;

    // Build slug from title or year/make/model
    const title = (item as Record<string, unknown>).title as string | undefined;
    const year = (item as Record<string, unknown>).year;
    const itemMake = (item as Record<string, unknown>).make as string | undefined;
    const itemModel = (item as Record<string, unknown>).model as string | undefined;

    let slug = "vehicle";
    if (title) {
      slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    } else if (year && itemMake && itemModel) {
      slug = `${year}-${itemMake}-${itemModel}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    }

    rows.push({
      source_listing_id: String(stockId),
      detail_url: `https://www.pickles.com.au/used/details/cars/${slug}/${stockId}`,
      page_no: page,
    });
  }

  return { rows, totalCount };
}
