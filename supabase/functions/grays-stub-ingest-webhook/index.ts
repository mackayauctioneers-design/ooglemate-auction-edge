import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * GRAYS STUB INGEST WEBHOOK
 * 
 * Receives scraped stub data from Apify Playwright actor and inserts into stub_anchors.
 * NO direct fetching of Grays pages (Cloudflare blocks Edge functions).
 * 
 * Auth: Bearer token via GRAYS_INGEST_KEY secret
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // Auth check - Bearer token
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const expected = Deno.env.get("GRAYS_INGEST_KEY") || "";

    console.log(`[grays-stub-webhook] Auth check: token_len=${token.length}, expected_len=${expected.length}`);

    if (!expected || token !== expected) {
      console.error("[grays-stub-webhook] Unauthorized - token mismatch");
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const items: StubItem[] = Array.isArray(body?.items) ? body.items : [];

    console.log(`[grays-stub-webhook] Received ${items.length} stub items`);

    if (items.length === 0) {
      return new Response(
        JSON.stringify({ success: true, created: 0, updated: 0, message: "No items" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRole);

    // Validate and normalize items
    const validStubs = items
      .filter(item => item.source_stock_id && item.detail_url)
      .map(item => ({
        source_stock_id: String(item.source_stock_id).trim(),
        detail_url: item.detail_url,
        year: item.year ?? null,
        make: item.make ?? null,
        model: item.model ?? null,
        km: null, // Will be extracted in detail phase
        location: item.location ?? null,
        raw_text: item.raw_text?.substring(0, 500) ?? null,
      }));

    console.log(`[grays-stub-webhook] ${validStubs.length} valid stubs after filtering`);

    if (validStubs.length === 0) {
      return new Response(
        JSON.stringify({ success: true, created: 0, updated: 0, message: "No valid items" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call the batch upsert RPC
    const { data: result, error } = await supabase.rpc("upsert_stub_anchor_batch", {
      p_source: "grays",
      p_stubs: validStubs,
    });

    if (error) {
      console.error("[grays-stub-webhook] RPC error:", error);
      throw error;
    }

    const metrics = result?.[0] || { created_count: 0, updated_count: 0, exception_count: 0 };
    const duration = Date.now() - startTime;

    console.log(`[grays-stub-webhook] Completed in ${duration}ms:`, metrics);

    return new Response(
      JSON.stringify({
        success: true,
        created: metrics.created_count || 0,
        updated: metrics.updated_count || 0,
        exceptions: metrics.exception_count || 0,
        duration_ms: duration,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[grays-stub-webhook] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
