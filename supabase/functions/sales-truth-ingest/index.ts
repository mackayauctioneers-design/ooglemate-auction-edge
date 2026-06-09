/**
 * Sales Truth Ingest
 * Receives bulk dealer sales records and upserts into dealer_sales_truth.
 * Uses internal service_role — no external keys needed.
 *
 * POST /functions/v1/sales-truth-ingest
 * Body: { records: [...] }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();
    const records = body.records || [];

    if (!Array.isArray(records) || records.length === 0) {
      return new Response(
        JSON.stringify({ error: "records array required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Map to existing dealer_sales_truth schema
    const enriched = records.map((r: any) => ({
      dealer_id: r.dealer_id,
      stock_number: r.stock_number || r.rego || null,
      vin: r.vin || null,
      make: r.make ? String(r.make).toUpperCase() : null,
      model: r.model ? String(r.model).toUpperCase() : null,
      variant: r.variant ? String(r.variant).toUpperCase() : null,
      year: r.year ?? null,
      km: r.km ?? r.odometer ?? null,
      colour: r.colour || null,
      listed_price: r.listed_price ?? r.sale_price ?? r.price ?? null,
      sold_date: r.sold_date || null,
      source: r.source || r.source_channel || "bulk_load",
      raw_snapshot: r,
    }));

    // Upsert by (dealer_id, stock_number); fall back per row if conflict cols absent
    const { data, error } = await supabase
      .from("dealer_sales_truth")
      .upsert(enriched, {
        onConflict: "dealer_id,stock_number",
        ignoreDuplicates: true,
      })
      .select("id");

    if (error) {
      console.error("Upsert error:", error);
      return new Response(
        JSON.stringify({ error: error.message, hint: error.hint, details: error.details }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        received: records.length,
        inserted: data?.length || 0,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("Fatal:", e);
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
