// ingest-vma (Lovable Edge Function)
// Receives scraped MTAs from Apify and inserts into pickles_detail_queue with source='vma'

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Simple shared-secret auth (Bearer token)
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

    const expected = Deno.env.get("INGEST_WEBHOOK_SECRET") || "";
    if (!expected || token !== expected) {
      console.error("[ingest-vma] Unauthorized - token mismatch");
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const items = Array.isArray(body?.items) ? body.items : [];

    console.log(`[ingest-vma] Received ${items.length} items`);

    if (items.length === 0) {
      return new Response(JSON.stringify({ success: true, upserted: 0, message: "No items" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service role is available inside Lovable Edge (via env)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRole);

    const now = new Date().toISOString();

    const rows = items
      .map((x: any) => {
        const mta = String(x.mta || x.source_listing_id || "").trim();
        if (!mta) return null;

        return {
          source: "vma",
          source_listing_id: mta,
          detail_url:
            x.detail_url ||
            `https://www.valleymotorauctions.com.au/cp_veh_inspection_report.aspx?MTA=${mta}&sitekey=VMA`,
          search_url: x.search_url || null,
          page_no: x.page_no ?? null,
          crawl_status: "pending",
          first_seen_at: now,
          last_seen_at: now,
        };
      })
      .filter(Boolean);

    console.log(`[ingest-vma] Upserting ${rows.length} valid rows`);

    // Upsert into pickles_detail_queue
    const { data, error } = await supabase
      .from("pickles_detail_queue")
      .upsert(rows, { onConflict: "source,source_listing_id" })
      .select("id");

    if (error) {
      console.error("[ingest-vma] Upsert error:", error);
      throw error;
    }

    console.log(`[ingest-vma] Successfully upserted ${data?.length ?? 0} rows`);

    return new Response(JSON.stringify({ success: true, upserted: data?.length ?? 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[ingest-vma] Error:", e);
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
