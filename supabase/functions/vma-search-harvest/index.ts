import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

type HarvestItem = {
  detail_url: string;
  source_listing_id: string;
  search_url: string;
  page_no: number | null;
};

function extractMtasFromHtml(html: string): string[] {
  const mtas = new Set<string>();

  // Pattern 1: cp_veh_inspection_report.aspx?MTA=123456
  const linkRe = /cp_veh_inspection_report\.aspx\?[^"'\s>]*\bMTA=(\d{5,10})\b/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) mtas.add(m[1]);

  // Pattern 2: fallback – stock numbers in table text (6–8 digits typical)
  if (mtas.size === 0) {
    const stockRe = /\b\d{6,8}\b/g;
    const matches = html.match(stockRe) || [];
    for (const x of matches) mtas.add(x);
  }

  return [...mtas];
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
      const url = search_url;

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
      
      const mtas = extractMtasFromHtml(html);
      console.log(`[vma-search-harvest] Extracted ${mtas.length} MTAs`);

      if (debug) {
        return new Response(
          JSON.stringify({
            success: true,
            debug: true,
            run_id: runId,
            fetched_url: url,
            html_len: html.length,
            mtas_found: mtas.slice(0, 30),
            html_snippet: html.slice(0, 2000),
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      for (const mta of mtas) {
        allItems.push({
          source_listing_id: mta,
          detail_url: `https://www.valleymotorauctions.com.au/cp_veh_inspection_report.aspx?MTA=${mta}&sitekey=VMA`,
          search_url,
          page_no: null,
        });
      }
    }

    // Dedupe
    const uniq = new Map<string, HarvestItem>();
    for (const it of allItems) uniq.set(it.source_listing_id, it);

    console.log(`[vma-search-harvest] Unique items: ${uniq.size}`);

    // Upsert via existing RPC
    const { data: upsertResult, error: upsertErr } = await supabase.rpc(
      "upsert_pickles_harvest_batch",
      {
        p_items: [...uniq.values()].map((x) => ({
          detail_url: x.detail_url,
          source_listing_id: x.source_listing_id,
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
