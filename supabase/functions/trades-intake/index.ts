import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_ACCOUNT_ID = "d24da4ea-f500-47fd-9b66-d2c9aa2d3f51";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: shared secret
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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Accept single trade or array, or object with line_items
    let trades: any[];
    if (Array.isArray(body)) {
      trades = body;
    } else if (Array.isArray(body.line_items)) {
      // Multi-vehicle invoice: spread shared fields into each line item
      const { line_items, ...shared } = body;
      trades = line_items.map((item: any) => ({ ...shared, ...item }));
    } else {
      trades = [body];
    }

    if (trades.length === 0) {
      return new Response(JSON.stringify({ error: "No trades in payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const records = trades.map((t) => ({
      account_id: DEFAULT_ACCOUNT_ID,
      source_system: t.source_system || "easycars",
      direction: t.direction || "sold",
      invoice_number: t.invoice_number || null,
      invoice_date: t.invoice_date || null,
      dealer_name: t.dealer_name || null,
      dealer_abn: t.dealer_abn || null,
      dealer_email: t.dealer_email || null,
      vin: t.vin || null,
      rego: t.rego || t.rego_plate || null,
      state: t.state || null,
      make: t.make ? String(t.make).toUpperCase() : null,
      model: t.model ? String(t.model).toUpperCase() : null,
      variant: t.variant || null,
      series: t.series || null,
      year: t.year ? parseInt(String(t.year)) : null,
      odometer_km: t.odometer_km || t.km ? parseInt(String(t.odometer_km || t.km)) : null,
      colour: t.colour || t.color || null,
      body_type: t.body_type || null,
      transmission: t.transmission || null,
      fuel_type: t.fuel_type || null,
      sell_price_inc_gst: t.sell_price_inc_gst ? Number(t.sell_price_inc_gst) : (t.sale_price ? Number(t.sale_price) : null),
      sell_price_ex_gst: t.sell_price_ex_gst ? Number(t.sell_price_ex_gst) : null,
      gst_amount: t.gst_amount ? Number(t.gst_amount) : null,
      fees_total: t.fees_total ? Number(t.fees_total) : null,
      fees_breakdown: t.fees_breakdown || null,
      trade_in_value: t.trade_in_value ? Number(t.trade_in_value) : null,
      hold_deposit: t.hold_deposit ? Number(t.hold_deposit) : null,
      stock_number: t.stock_number || t.stock_no || null,
      internal_notes: t.internal_notes || null,
      raw_email_id: t.raw_email_id || null,
    }));

    // Insert trades (on conflict skip duplicates)
    const { data: inserted, error: insertErr } = await supabase
      .from("trades")
      .upsert(records, { onConflict: "invoice_number,vin", ignoreDuplicates: true })
      .select("id, vin, rego, make, model");

    if (insertErr) throw insertErr;

    const insertedCount = inserted?.length || 0;
    console.log(`[trades-intake] Inserted ${insertedCount} trade(s)`);

    // Try to fingerprint-match via VIN/rego against vehicle_listings
    let matched = 0;
    if (inserted) {
      for (const trade of inserted) {
        if (!trade.vin && !trade.rego) continue;

        let query = supabase
          .from("vehicle_listings")
          .select("fingerprint")
          .limit(1);

        if (trade.vin) {
          query = query.eq("vin", trade.vin);
        } else if (trade.rego) {
          query = query.eq("rego", trade.rego);
        }

        const { data: match } = await query.maybeSingle();
        if (match?.fingerprint) {
          await supabase
            .from("trades")
            .update({ fingerprint: match.fingerprint })
            .eq("id", trade.id);
          matched++;
        }
      }
    }

    // Also upsert into vehicle_sales_truth for the scoring engine
    const truthRecords = records
      .filter((r) => r.make)
      .map((r) => ({
        account_id: r.account_id,
        make: r.make,
        model: r.model,
        variant: r.variant,
        year: r.year,
        sold_at: r.invoice_date,
        sale_price: r.sell_price_inc_gst,
        km: r.odometer_km,
        body_type: r.body_type,
        transmission: r.transmission,
        fuel_type: r.fuel_type,
        source: `trades_intake_${r.source_system}`,
        confidence: "high",
        notes: [
          r.stock_number ? `Stock #${r.stock_number}` : null,
          r.vin ? `VIN: ${r.vin}` : null,
          r.rego ? `Rego: ${r.rego}` : null,
          r.dealer_name ? `Dealer: ${r.dealer_name}` : null,
        ].filter(Boolean).join(" | ") || null,
      }));

    if (truthRecords.length > 0) {
      const { error: truthErr } = await supabase
        .from("vehicle_sales_truth")
        .insert(truthRecords);
      if (truthErr) {
        console.error("[trades-intake] vehicle_sales_truth insert error:", truthErr.message);
      } else {
        console.log(`[trades-intake] Wrote ${truthRecords.length} to vehicle_sales_truth`);
      }
    }

    // Upsert buyer fingerprints for dealer tracking
    for (const r of records) {
      if (!r.dealer_name || !r.make) continue;
      try {
        const { data: existing } = await supabase
          .from("buyer_fingerprints")
          .select("*")
          .eq("buyer_name", r.dealer_name)
          .maybeSingle();

        const vehicleSummary = `${r.year || ""} ${r.make} ${r.model || ""}`.trim();

        if (existing) {
          const makes = Array.from(new Set([...(existing.makes_purchased || []), r.make]));
          const models = Array.from(new Set([...(existing.models_purchased || []), r.model].filter(Boolean)));
          const totalPurchases = (existing.total_purchases || 0) + 1;
          const price = r.sell_price_inc_gst;
          let priceBandMin = existing.price_band_min;
          let priceBandMax = existing.price_band_max;
          if (price) {
            priceBandMin = priceBandMin ? Math.min(priceBandMin, price) : price;
            priceBandMax = priceBandMax ? Math.max(priceBandMax, price) : price;
          }
          const recentVehicles = [...(existing.recent_vehicles || [])];
          recentVehicles.push({ vehicle: vehicleSummary, price, date: r.invoice_date });
          if (recentVehicles.length > 20) recentVehicles.splice(0, recentVehicles.length - 20);

          await supabase
            .from("buyer_fingerprints")
            .update({
              makes_purchased: makes,
              models_purchased: models,
              price_band_min: priceBandMin,
              price_band_max: priceBandMax,
              last_purchase_date: r.invoice_date || existing.last_purchase_date,
              total_purchases: totalPurchases,
              recent_vehicles: recentVehicles,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
        } else {
          await supabase.from("buyer_fingerprints").insert({
            buyer_name: r.dealer_name,
            buyer_email: r.dealer_email || null,
            account_id: r.account_id,
            makes_purchased: [r.make],
            models_purchased: r.model ? [r.model] : [],
            price_band_min: r.sell_price_inc_gst,
            price_band_max: r.sell_price_inc_gst,
            last_purchase_date: r.invoice_date,
            total_purchases: 1,
            recent_vehicles: [{ vehicle: vehicleSummary, price: r.sell_price_inc_gst, date: r.invoice_date }],
          });
        }
      } catch (err: any) {
        console.error(`[trades-intake] Fingerprint error for ${r.dealer_name}:`, err.message);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        inserted: insertedCount,
        fingerprint_matched: matched,
        trades: records.map((r) => `${r.year} ${r.make} ${r.model}`),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[trades-intake] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
