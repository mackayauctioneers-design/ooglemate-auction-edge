import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * carsales-scan-cron: Mandate-driven Carsales market sweep.
 *
 * Reads active_mandates, builds correctly-filtered Carsales URLs
 * using (And.Make.X._.Model.Y._.Year.range(..)...) syntax,
 * then dispatches to carsales-scan for Apify ingestion.
 *
 * Schedule: every 30 minutes
 */

const YEAR_DEFAULT_MIN = 2020;
const KM_DEFAULT_MAX = 150000;

/** Carsales PascalCase slug: "Land Cruiser" → "LandCruiser" */
function carsalesSlug(str: string): string {
  return str
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join("");
}

function buildCarsalesUrl(
  make: string,
  model: string,
  yearMin: number,
  yearMax: number | null,
  kmMax: number
): string {
  const parts = [
    `Make.${carsalesSlug(make)}`,
    `Model.${carsalesSlug(model)}`,
    yearMax
      ? `Year.range(${yearMin}..${yearMax})`
      : `Year.range(${yearMin}..)`,
    `Odometer.range(..${kmMax})`,
  ];
  const q = `(And.${parts.join("._.")})`;
  return `https://www.carsales.com.au/cars/?q=${encodeURIComponent(q)}&sort=~Price`;
}

/**
 * Fallback searches if no mandates exist yet.
 * These are the high-volume models that matter most for arbitrage.
 */
const FALLBACK_SEARCHES = [
  { make: "Toyota", model: "LandCruiser", yearMin: 2020, kmMax: 150000 },
  { make: "Toyota", model: "Hilux", yearMin: 2020, kmMax: 150000 },
  { make: "Toyota", model: "Prado", yearMin: 2020, kmMax: 150000 },
  { make: "Isuzu", model: "D-Max", yearMin: 2020, kmMax: 150000 },
  { make: "Ford", model: "Ranger", yearMin: 2020, kmMax: 150000 },
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Try to pull from active_mandates where carsales is in source_mask
    const { data: mandates } = await supabase
      .from("active_mandates")
      .select("make, model, year_min, year_max, km_max")
      .eq("is_active", true)
      .contains("source_mask", ["carsales"]);

    let startUrls: { url: string }[];

    if (mandates && mandates.length > 0) {
      startUrls = mandates.map((m) => ({
        url: buildCarsalesUrl(
          m.make,
          m.model,
          m.year_min ?? YEAR_DEFAULT_MIN,
          m.year_max,
          m.km_max ?? KM_DEFAULT_MAX
        ),
      }));
      console.log(`Carsales cron: ${startUrls.length} mandate-driven searches`);
    } else {
      // Use fallback high-value model searches
      startUrls = FALLBACK_SEARCHES.map((s) => ({
        url: buildCarsalesUrl(s.make, s.model, s.yearMin, null, s.kmMax),
      }));
      console.log(`Carsales cron: ${startUrls.length} fallback searches (no mandates)`);
    }

    // Dispatch to carsales-scan
    const scanResponse = await fetch(
      `${supabaseUrl}/functions/v1/carsales-scan`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          startUrls,
          limit: 500,
        }),
      }
    );

    const result = await scanResponse.json();

    if (!scanResponse.ok) {
      throw new Error(`carsales-scan returned ${scanResponse.status}: ${JSON.stringify(result)}`);
    }

    // Log heartbeat
    await supabase
      .from("cron_heartbeat")
      .upsert(
        {
          cron_name: "carsales-scan-cron",
          last_seen_at: new Date().toISOString(),
          last_ok: true,
          note: `Dispatched ${startUrls.length} filtered searches`,
        },
        { onConflict: "cron_name" }
      );

    console.log("Carsales cron complete:", JSON.stringify(result));

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Carsales cron error:", errorMsg);

    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );
      await supabase
        .from("cron_heartbeat")
        .upsert(
          {
            cron_name: "carsales-scan-cron",
            last_seen_at: new Date().toISOString(),
            last_ok: false,
            note: errorMsg.slice(0, 200),
          },
          { onConflict: "cron_name" }
        );
    } catch (_) {
      /* best effort */
    }

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
