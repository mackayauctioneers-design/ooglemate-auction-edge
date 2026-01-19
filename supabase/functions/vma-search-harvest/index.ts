import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const SOURCE = "bidsonline_vma";
const BASE_URL = "https://www.valleymotorauctions.com.au";

type HarvestItem = {
  detail_url: string;
  source_listing_id: string;
  source: string;
  search_url: string;
  page_no: number | null;
};

/**
 * Extract actual detail page links from HTML - no URL construction
 * Returns array of { url, id } from real hrefs
 */
function extractDetailLinks(html: string): { url: string; id: string }[] {
  const results: { url: string; id: string }[] = [];
  const seen = new Set<string>();

  // Pattern 1: cp_veh_inspection_report.aspx?MTA=123456
  const pattern1 = /href=["']([^"']*cp_veh_inspection_report\.aspx\?[^"']*MTA=(\d{5,10})[^"']*)/gi;
  let m;
  while ((m = pattern1.exec(html)) !== null) {
    const [, href, mta] = m;
    if (!seen.has(mta)) {
      seen.add(mta);
      // Normalize to absolute URL
      const url = href.startsWith("http") ? href : `${BASE_URL}/${href.replace(/^\//, "")}`;
      results.push({ url, id: mta });
    }
  }

  // Pattern 2: LotDetails.aspx?LotID=123456 or similar
  const pattern2 = /href=["']([^"']*(?:LotDetails|vehicle_details|viewlot)\.aspx\?[^"']*(?:LotID|ID)=(\d{5,10})[^"']*)/gi;
  while ((m = pattern2.exec(html)) !== null) {
    const [, href, lotId] = m;
    if (!seen.has(lotId)) {
      seen.add(lotId);
      const url = href.startsWith("http") ? href : `${BASE_URL}/${href.replace(/^\//, "")}`;
      results.push({ url, id: lotId });
    }
  }

  // Pattern 3: Any href with MTA= param (broader catch)
  const pattern3 = /href=["']([^"']*\bMTA=(\d{5,10})[^"']*)/gi;
  while ((m = pattern3.exec(html)) !== null) {
    const [, href, mta] = m;
    if (!seen.has(mta)) {
      seen.add(mta);
      const url = href.startsWith("http") ? href : `${BASE_URL}/${href.replace(/^\//, "")}`;
      results.push({ url, id: mta });
    }
  }

  return results;
}

/**
 * Extract all hrefs for debug analysis
 */
function extractAllHrefs(html: string): string[] {
  const hrefs: string[] = [];
  const re = /href=["']([^"']+)/gi;
  let m;
  while ((m = re.exec(html)) !== null && hrefs.length < 100) {
    hrefs.push(m[1]);
  }
  return hrefs;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json().catch(() => ({}));
    const {
      search_url = "https://www.valleymotorauctions.com.au/search_results.aspx?sitekey=VMA&make=All%20Makes&model=All%20Models",
      max_pages = 1,
      debug = false,
    } = body;

    console.log(`[vma-search-harvest] Starting harvest from: ${search_url}`);

    const runId = crypto.randomUUID();
    await supabase.from("pickles_harvest_runs").insert({
      id: runId,
      search_url,
      status: "running",
    });

    const allItems: HarvestItem[] = [];
    const errors: string[] = [];

    for (let page = 1; page <= max_pages; page++) {
      // Actual pagination - append page param
      const urlObj = new URL(search_url);
      if (page > 1) {
        urlObj.searchParams.set("page", String(page));
      }
      const url = urlObj.toString();

      console.log(`[vma-search-harvest] Fetching page ${page}: ${url}`);

      const res = await fetch(url, {
        method: "GET",
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
          "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-AU,en;q=0.9",
        },
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        errors.push(`Page ${page}: HTTP ${res.status} ${txt.slice(0, 200)}`);
        console.error(`[vma-search-harvest] HTTP error: ${res.status}`);
        continue;
      }

      const html = await res.text();
      console.log(`[vma-search-harvest] Got HTML: ${html.length} bytes`);

      if (debug) {
        const allHrefs = extractAllHrefs(html);
        const detailLinks = extractDetailLinks(html);
        const hasViewState = html.includes("__VIEWSTATE");
        const hasEventValidation = html.includes("__EVENTVALIDATION");
        
        // Find context around first MTA mention
        const mtaIndex = html.indexOf("MTA=");
        const mtaContext = mtaIndex >= 0 
          ? html.slice(Math.max(0, mtaIndex - 100), mtaIndex + 200)
          : null;

        // Filter hrefs that look like detail pages
        const detailHrefs = allHrefs.filter(h => 
          h.includes("MTA=") || 
          h.includes("LotID=") || 
          h.includes("inspection") ||
          h.includes("details") ||
          h.includes("viewlot")
        ).slice(0, 50);

        return new Response(
          JSON.stringify({
            success: true,
            debug: true,
            run_id: runId,
            fetched_url: url,
            html_len: html.length,
            has_viewstate: hasViewState,
            has_event_validation: hasEventValidation,
            is_webforms_paging: hasViewState && hasEventValidation,
            detail_links_found: detailLinks.length,
            detail_links: detailLinks.slice(0, 30),
            detail_hrefs_sample: detailHrefs,
            mta_context: mtaContext,
            html_snippet: html.slice(0, 3000),
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const detailLinks = extractDetailLinks(html);
      console.log(`[vma-search-harvest] Extracted ${detailLinks.length} detail links`);

      for (const link of detailLinks) {
        allItems.push({
          source_listing_id: link.id,
          detail_url: link.url,
          source: SOURCE,
          search_url,
          page_no: page,
        });
      }

      // If we got zero links on page 1, don't bother with more pages
      if (page === 1 && detailLinks.length === 0) {
        console.warn(`[vma-search-harvest] No detail links on page 1, stopping pagination`);
        break;
      }
    }

    // Dedupe by source_listing_id
    const uniq = new Map<string, HarvestItem>();
    for (const it of allItems) uniq.set(it.source_listing_id, it);

    console.log(`[vma-search-harvest] Unique items: ${uniq.size}`);

    // Upsert - include source in items
    const { data: upsertResult, error: upsertErr } = await supabase.rpc(
      "upsert_pickles_harvest_batch",
      {
        p_items: [...uniq.values()].map((x) => ({
          detail_url: x.detail_url,
          source_listing_id: x.source_listing_id,
          source: x.source,
          search_url: x.search_url,
          page_no: x.page_no,
        })),
        p_run_id: runId,
      }
    );

    if (upsertErr) {
      console.error(`[vma-search-harvest] Upsert error: ${upsertErr.message}`);
      errors.push(`Batch upsert: ${upsertErr.message}`);
    }

    await supabase.from("pickles_harvest_runs").update({
      status: errors.length ? "completed_with_errors" : "completed",
      urls_harvested: uniq.size,
      urls_new: upsertResult?.inserted ?? 0,
      urls_existing: upsertResult?.updated ?? 0,
      errors: errors.length ? errors : null,
    }).eq("id", runId);

    return new Response(
      JSON.stringify({
        success: true,
        run_id: runId,
        source: SOURCE,
        harvested: uniq.size,
        urls_new: upsertResult?.inserted ?? 0,
        urls_existing: upsertResult?.updated ?? 0,
        errors: errors.length ? errors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error(`[vma-search-harvest] Error:`, e);
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
