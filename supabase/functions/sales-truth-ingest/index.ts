// sales-truth-ingest
// Receives bulk dealer sales records from a trusted COO data bridge.
// Auth: Bearer SALES_TRUTH_INGEST_KEY
// Insert into: dealer_sales_truth (upsert on unique constraints)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: SALES_TRUTH_INGEST_KEY
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const expected = Deno.env.get("SALES_TRUTH_INGEST_KEY");

    if (!expected || token !== expected) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const records = Array.isArray(body?.records)
      ? body.records
      : Array.isArray(body)
      ? body
      : [];

    if (records.length === 0) {
      return new Response(
        JSON.stringify({ error: "records array required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cap payload size (soft guard)
    if (records.length > 2000) {
      return new Response(
        JSON.stringify({ error: "Payload too large. Max 2000 records per batch." }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const raw of records) {
      try {
        const row: Record<string, unknown> = {
          dealer_id: raw.dealer_id,
          stock_number: raw.stock_number
            ? String(raw.stock_number).toUpperCase().trim()
            : null,
          vin: raw.vin ? String(raw.vin).toUpperCase().trim() : null,
          make: raw.make ? String(raw.make).toUpperCase().trim() : null,
          model: raw.model ? String(raw.model).toUpperCase().trim() : null,
          variant: raw.variant ? String(raw.variant).trim() : null,
          year: raw.year ? parseInt(String(raw.year)) : null,
          km:
            raw.km !== undefined && raw.km !== null
              ? parseInt(String(raw.km))
              : null,
          colour: raw.colour ? String(raw.colour).trim() : null,
          listed_price:
            raw.listed_price !== undefined && raw.listed_price !== null
              ? Math.round(Number(raw.listed_price))
              : null,
          first_seen: raw.first_seen || raw.first_seen_at || null,
          last_seen: raw.last_seen || raw.last_seen_at || null,
          sold_date: raw.sold_date || raw.sold_at || null,
          days_online:
            raw.days_online !== undefined && raw.days_online !== null
              ? parseInt(String(raw.days_online))
              : null,
          sale_confidence:
            raw.sale_confidence !== undefined && raw.sale_confidence !== null
              ? Number(raw.sale_confidence)
              : null,
          source: raw.source || "coo_bulk_upload",
          raw_snapshot: raw.raw_snapshot || null,
        };

        // Upsert strategy: stock_number takes precedence, then vin, else plain insert
        let conflictCols: string | null = null;
        if (row.stock_number) {
          conflictCols = "dealer_id,stock_number";
        } else if (row.vin) {
          conflictCols = "dealer_id,vin";
        }

        if (conflictCols) {
          const { error: upsertErr } = await supabase
            .from("dealer_sales_truth")
            .upsert(row, { onConflict: conflictCols, ignoreDuplicates: false });
          if (upsertErr) throw upsertErr;
          updated++;
        } else {
          const { error: insertErr } = await supabase
            .from("dealer_sales_truth")
            .insert(row);
          if (insertErr) throw insertErr;
          inserted++;
        }
      } catch (err: any) {
        skipped++;
        const key = raw.stock_number || raw.vin || raw.make || "?";
        errors.push(`${key}: ${err.message}`);
        console.error("[sales-truth-ingest] row error:", err.message, raw);
      }
    }

    console.log(
      `[sales-truth-ingest] Batch done: received=${records.length} inserted=${inserted} updated=${updated} skipped=${skipped}`
    );

    return new Response(
      JSON.stringify({
        success: true,
        received: records.length,
        inserted,
        updated,
        skipped,
        errors: errors.length ? errors.slice(0, 30) : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[sales-truth-ingest] fatal error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
