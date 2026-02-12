import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * generate-search-urls v1.0
 * 
 * For each active sales_target_candidate, generates search URLs
 * for Carsales, Autotrader, and Pickles.
 */

function buildCarsalesUrl(make: string, model: string, yearMin: number, yearMax: number, kmMin: number, kmMax: number): string {
  const m = encodeURIComponent(make.toLowerCase());
  const mod = encodeURIComponent(model.toLowerCase());
  return `https://www.carsales.com.au/cars/${m}/${mod}/?q=(And.Service.Carsales._.Make.${encodeURIComponent(make)}._.Model.${encodeURIComponent(model)}._.Year.range(${yearMin}..${yearMax})._.Odometer.range(..${kmMax})..)`;
}

function buildAutotraderUrl(make: string, model: string, yearMin: number, yearMax: number, kmMax: number): string {
  const m = encodeURIComponent(make);
  const mod = encodeURIComponent(model);
  return `https://www.autotrader.com.au/cars/${m.toLowerCase()}/${mod.toLowerCase()}?year_from=${yearMin}&year_to=${yearMax}&odometer_max=${kmMax}`;
}

function buildPicklesUrl(make: string, model: string): string {
  const m = encodeURIComponent(make);
  const mod = encodeURIComponent(model);
  return `https://www.pickles.com.au/cars/search?make=${m}&model=${mod}&channel=cars`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const accountId: string | undefined = body.account_id;
    const fingerprintId: string | undefined = body.fingerprint_id;

    if (!accountId) {
      return new Response(JSON.stringify({ error: "account_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load target candidates
    let query = supabase
      .from("sales_target_candidates")
      .select("id, make, model, variant, median_km, median_sale_price, body_type, transmission, fuel_type")
      .eq("account_id", accountId)
      .in("status", ["active", "candidate"]);

    if (fingerprintId) {
      query = query.eq("id", fingerprintId);
    }

    const { data: candidates, error: candErr } = await query;

    if (candErr) {
      return new Response(JSON.stringify({ error: candErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!candidates || candidates.length === 0) {
      return new Response(JSON.stringify({ success: true, generated: 0, message: "No active candidates" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[generate-search-urls] Processing ${candidates.length} candidates`);

    const urls: Array<Record<string, unknown>> = [];

    for (const c of candidates) {
      const medianKm = c.median_km || 80000;
      // Adaptive KM band
      let kmLow: number, kmHigh: number;
      if (medianKm <= 80000) {
        kmLow = Math.max(0, medianKm - 15000);
        kmHigh = medianKm + 15000;
      } else if (medianKm <= 150000) {
        kmLow = Math.max(0, Math.round(medianKm * 0.8));
        kmHigh = Math.round(medianKm * 1.2);
      } else {
        kmLow = Math.max(0, Math.round(medianKm * 0.75));
        kmHigh = Math.round(medianKm * 1.25);
      }

      // Year range: estimate from model (default 2020 ±1)
      // We don't have year in candidates, so use a broad range
      const yearMin = 2015;
      const yearMax = 2026;

      const sources = [
        { source: "carsales", url: buildCarsalesUrl(c.make, c.model, yearMin, yearMax, kmLow, kmHigh) },
        { source: "autotrader", url: buildAutotraderUrl(c.make, c.model, yearMin, yearMax, kmHigh) },
        { source: "pickles", url: buildPicklesUrl(c.make, c.model) },
      ];

      for (const s of sources) {
        urls.push({
          fingerprint_id: c.id,
          account_id: accountId,
          source: s.source,
          search_url: s.url,
        });
      }
    }

    // Delete old URLs for these fingerprints, then insert new
    const fpIds = candidates.map((c: any) => c.id);
    await supabase
      .from("fingerprint_search_urls")
      .delete()
      .eq("account_id", accountId)
      .in("fingerprint_id", fpIds);

    const { error: insertErr } = await supabase
      .from("fingerprint_search_urls")
      .insert(urls);

    if (insertErr) {
      console.error("[generate-search-urls] Insert error:", insertErr);
      return new Response(JSON.stringify({ error: insertErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[generate-search-urls] Generated ${urls.length} URLs for ${candidates.length} fingerprints`);

    return new Response(
      JSON.stringify({ success: true, generated: urls.length, fingerprints: candidates.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[generate-search-urls] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
