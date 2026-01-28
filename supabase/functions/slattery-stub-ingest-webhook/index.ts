import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * SLATTERY STUB INGEST WEBHOOK - Receives JSON payloads from Apify Playwright actor
 * 
 * Slattery is JavaScript-rendered (React/Next.js) and requires headless browser.
 * This webhook receives pre-extracted stub data from an external Apify actor.
 * 
 * Auth: VMA_INGEST_KEY as Bearer token (same as VMA/Pickles/Manheim/Grays)
 * 
 * Input: { items: [ { source_stock_id, detail_url, year, make, model, location, raw_text } ] }
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface StubItem {
  source_stock_id: string;
  detail_url: string;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  location?: string | null;
  raw_text?: string | null;
}

interface IngestMetrics {
  items_received: number;
  stubs_upserted: number;
  errors: string[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth check - require VMA_INGEST_KEY
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const expected = Deno.env.get("VMA_INGEST_KEY") || "";

  if (!token || token !== expected) {
    console.error("[SLATTERY-STUB-WEBHOOK] Unauthorized - invalid or missing token");
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // deno-lint-ignore no-explicit-any
  const supabase: any = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const items: StubItem[] = body.items || [];

    console.log(`[SLATTERY-STUB-WEBHOOK] Received ${items.length} items`);

    const metrics: IngestMetrics = {
      items_received: items.length,
      stubs_upserted: 0,
      errors: [],
    };

    if (items.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No items to process", metrics }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate and prepare stubs for RPC
    const validStubs = items.filter(item => item.source_stock_id && item.detail_url);
    
    const stubsForRpc = validStubs.map(s => ({
      source_stock_id: s.source_stock_id,
      detail_url: s.detail_url,
      year: s.year || null,
      make_raw: s.make || null,
      model_raw: s.model || null,
      location: s.location || null,
      raw_text: s.raw_text || null,
    }));

    // Use upsert_stub_anchor_batch RPC
    const { data, error } = await supabase.rpc("upsert_stub_anchor_batch", {
      p_source: "slattery",
      p_stubs: stubsForRpc,
    });

    if (error) {
      console.error("[SLATTERY-STUB-WEBHOOK] RPC error:", error);
      metrics.errors.push(`RPC error: ${error.message}`);
    } else {
      metrics.stubs_upserted = data?.upserted || validStubs.length;
      console.log(`[SLATTERY-STUB-WEBHOOK] Upserted ${metrics.stubs_upserted} stubs`);
    }

    const duration = Date.now() - startTime;
    console.log(`[SLATTERY-STUB-WEBHOOK] Completed in ${duration}ms:`, metrics);

    return new Response(
      JSON.stringify({
        success: true,
        duration_ms: duration,
        metrics,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[SLATTERY-STUB-WEBHOOK] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
