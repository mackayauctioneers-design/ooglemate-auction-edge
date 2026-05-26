import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// JSON extraction schema for dealer inventory pages
const DEALER_INVENTORY_SCHEMA = {
  type: "object",
  properties: {
    vehicles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Full vehicle title e.g. '2024 Toyota HiLux SR5 Auto 4x4 Double Cab'" },
          year: { type: "integer", description: "Model year" },
          make: { type: "string", description: "Vehicle make e.g. Toyota" },
          model: { type: "string", description: "Vehicle model e.g. HiLux" },
          variant: { type: "string", description: "Trim/variant e.g. SR5" },
          price: { type: "integer", description: "Advertised price in AUD" },
          km: { type: "integer", description: "Odometer reading in km" },
          rego: { type: "string", description: "Registration plate if visible" },
          colour: { type: "string", description: "Exterior colour" },
          transmission: { type: "string", description: "Auto or Manual" },
          fuel: { type: "string", description: "Petrol, Diesel, Hybrid, Electric" },
          detail_url: { type: "string", description: "Relative or absolute URL to the vehicle detail page" },
        },
        required: ["title"],
      },
    },
  },
  required: ["vehicles"],
};

interface DealerSource {
  id: string;
  dealer_name: string;
  dealer_slug: string;
  dealer_domain: string;
  inventory_path: string;
  priority: string;
  account_id: string | null;
  consecutive_failures?: number;
}

// Global vehicle eligibility filter (matches score-operator-opportunities / fingerprint engine)
const MIN_YEAR = 2020;
const MAX_KM = 120000;
// Only treat a missing listing as SOLD after it's been absent for this long
const SOLD_PROMOTE_AFTER_HOURS = 36;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlKey) {
      return new Response(
        JSON.stringify({ status: "error", error: "FIRECRAWL_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const batchSize = body.batch_size || 5;
    const specificSlug = body.dealer_slug || null;

    // ── Fetch enabled dealer sources ──
    let query = sb
      .from("dealer_outbound_sources")
      .select("id, dealer_name, dealer_slug, dealer_domain, inventory_path, priority, account_id, consecutive_failures")
      .eq("enabled", true)
      .order("priority", { ascending: true })
      .order("last_crawl_at", { ascending: true, nullsFirst: true })
      .limit(batchSize);

    if (specificSlug) {
      query = query.eq("dealer_slug", specificSlug);
    }

    const { data: dealers, error: fetchErr } = await query;
    if (fetchErr) throw new Error(`Failed to fetch dealers: ${fetchErr.message}`);
    if (!dealers || dealers.length === 0) {
      return new Response(
        JSON.stringify({ status: "ok", message: "No enabled dealer sources to crawl", results: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[DEALER-INGEST] Processing ${dealers.length} dealer sites`);

    const results: { dealer: string; found: number; upserted: number; sold_promoted?: number; error?: string }[] = [];

    for (const dealer of dealers as DealerSource[]) {
      const inventoryUrl = `https://${dealer.dealer_domain}${dealer.inventory_path}`;
      console.log(`[DEALER-INGEST] Crawling: ${inventoryUrl}`);

      try {
        // Use Firecrawl scrape with JSON extraction
        const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: inventoryUrl,
            formats: ["extract"],
            extract: {
              schema: DEALER_INVENTORY_SCHEMA,
              prompt: "Extract all used vehicle listings from this dealer inventory page. Include year, make, model, variant/trim, price in AUD, odometer km, registration, colour, transmission, fuel type, and the detail page URL for each vehicle.",
            },
            waitFor: 5000,
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error(`[DEALER-INGEST] ${dealer.dealer_slug} failed: ${res.status} ${errText.slice(0, 200)}`);

          // Update failure tracking
          await sb.from("dealer_outbound_sources").update({
            last_crawl_at: new Date().toISOString(),
            last_crawl_error: `HTTP ${res.status}: ${errText.slice(0, 200)}`,
            last_crawl_count: 0,
            consecutive_failures: (dealer as any).consecutive_failures + 1,
          }).eq("id", dealer.id);

          results.push({ dealer: dealer.dealer_slug, found: 0, upserted: 0, error: `HTTP ${res.status}` });
          continue;
        }

        const data = await res.json();
        const jsonData = data.data?.extract || data.extract || data.data?.json || data.json;
        const vehicles = jsonData?.vehicles || [];

        console.log(`[DEALER-INGEST] ${dealer.dealer_slug}: ${vehicles.length} vehicles extracted`);

        // Upsert into vehicle_listings
        let upsertCount = 0;
        for (const v of vehicles) {
          if (!v.title || !v.year || !v.price) continue;
          if (v.price < 1000 || v.price > 500000) continue;
          if (v.year < 2008 || v.year > new Date().getFullYear() + 2) continue;

          const make = (v.make || "").toUpperCase().trim();
          const model = (v.model || "").toUpperCase().trim();
          if (!make || !model) continue;

          // Build a stable listing ID from dealer + title hash
          const listingKey = `dealer_site:${dealer.dealer_slug}:${v.title.replace(/\s+/g, "_").toLowerCase().slice(0, 80)}`;

          const detailUrl = v.detail_url
            ? (v.detail_url.startsWith("http") ? v.detail_url : `https://${dealer.dealer_domain}${v.detail_url.startsWith("/") ? "" : "/"}${v.detail_url}`)
            : inventoryUrl;

          const { error: upsertErr } = await sb
            .from("vehicle_listings")
            .upsert({
              source_listing_id: listingKey,
              source: `dealer_site:${dealer.dealer_slug}`,
              source_class: "dealer_site",
              make,
              model,
              variant_raw: v.variant || null,
              year: v.year,
              km: typeof v.km === "number" ? v.km : null,
              asking_price: v.price,
              listing_url: detailUrl,
              location: null,
              state: null,
              transmission: v.transmission || null,
              fuel: v.fuel || null,
              colour: v.colour || null,
              lifecycle_state: "ACTIVE",
              last_seen_at: new Date().toISOString(),
            }, {
              onConflict: "source_listing_id",
              ignoreDuplicates: false,
            });

          if (upsertErr) {
            console.error(`[DEALER-INGEST] Upsert error for ${listingKey}: ${upsertErr.message}`);
          } else {
            upsertCount++;
          }
        }

        // Update dealer source tracking
        await sb.from("dealer_outbound_sources").update({
          last_crawl_at: new Date().toISOString(),
          last_crawl_count: vehicles.length,
          last_crawl_error: null,
          consecutive_failures: 0,
        }).eq("id", dealer.id);

        results.push({ dealer: dealer.dealer_slug, found: vehicles.length, upserted: upsertCount });
      } catch (err) {
        console.error(`[DEALER-INGEST] ${dealer.dealer_slug} exception:`, err);
        results.push({ dealer: dealer.dealer_slug, found: 0, upserted: 0, error: String(err) });
      }
    }

    const totalUpserted = results.reduce((s, r) => s + r.upserted, 0);
    const durationMs = Date.now() - startTime;
    console.log(`[DEALER-INGEST] Done: ${totalUpserted} total upserted in ${durationMs}ms`);

    // Audit log
    try {
      await sb.from("cron_audit_log").insert({
        cron_name: "dealer-site-ingest",
        run_date: new Date().toISOString().slice(0, 10),
        success: true,
        result: { dealers_processed: results.length, total_upserted: totalUpserted, duration_ms: durationMs, details: results },
      });
    } catch (_) { /* swallow */ }

    return new Response(
      JSON.stringify({
        status: "ok",
        dealers_processed: results.length,
        total_upserted: totalUpserted,
        duration_ms: durationMs,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[DEALER-INGEST] Fatal:", error);
    return new Response(
      JSON.stringify({ status: "error", error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
