import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { derivePlatform, extractBadge, extractSeries } from "../_shared/taxonomy/derivePlatform.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: verify shared secret
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const expectedSecret = Deno.env.get("LINDY_WEBHOOK_SECRET");

    if (!expectedSecret || token !== expectedSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();

    // Accept single sale or array of sales
    const sales: any[] = Array.isArray(body) ? body : [body];

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Default account_id for EasyCars dealer
    const EASYCARS_ACCOUNT_ID = body.account_id || "easycars-default";

    const records = sales
      .filter((s) => s.make || s.description)
      .map((s) => ({
        account_id: s.account_id || EASYCARS_ACCOUNT_ID,
        make: s.make?.toUpperCase() || null,
        model: s.model?.toUpperCase() || null,
        variant: s.variant || null,
        year: s.year ? parseInt(String(s.year)) : null,
        sold_at: s.sold_at || s.sale_date || s.invoice_date || null,
        sale_price: s.sale_price ? Math.round(Number(s.sale_price)) : null,
        buy_price: s.buy_price || s.cost_price ? Math.round(Number(s.buy_price || s.cost_price)) : null,
        days_to_clear: s.days_to_clear || s.days_in_stock ? parseInt(String(s.days_to_clear || s.days_in_stock)) : null,
        body_type: s.body_type || null,
        transmission: s.transmission || null,
        fuel_type: s.fuel_type || null,
        drive_type: s.drive_type || null,
        source: "easycars_invoice_gmail",
        confidence: "high",
        notes: [
          s.stock_no ? `Stock #${s.stock_no}` : null,
          s.vin ? `VIN: ${s.vin}` : null,
          s.invoice_number ? `Invoice: ${s.invoice_number}` : null,
          s.km || s.kilometres ? `KM: ${s.km || s.kilometres}` : null,
        ]
          .filter(Boolean)
          .join(" | ") || null,
      }));

    if (records.length === 0) {
      return new Response(
        JSON.stringify({ error: "No valid sale records in payload" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { error } = await supabase
      .from("vehicle_sales_truth")
      .insert(records);

    if (error) throw error;

    console.log(
      `[easycars-invoice-ingest] Inserted ${records.length} sale(s) from Gmail trigger`
    );

    return new Response(
      JSON.stringify({
        success: true,
        inserted: records.length,
        sales: records.map((r) => `${r.year} ${r.make} ${r.model}`),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("[easycars-invoice-ingest] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
