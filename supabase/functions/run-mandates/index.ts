import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * RUN-MANDATES — Unified Mandate Dispatcher
 * 
 * Every 15 min, fetches due mandates, runs per-source adapters,
 * and upserts results into mandate_feed_items.
 * 
 * B-mode: store EVERYTHING that matches structural constraints.
 * Score/margin are ranking signals only — never filter on them.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CRON_NAME = "run-mandates";

// ─── Types ───────────────────────────────────────────────────────────────────

type Mandate = {
  id: string;
  name: string;
  make: string;
  model: string;
  variant_family: string | null;
  year_min: number | null;
  year_max: number | null;
  km_max: number | null;
  price_max: number | null;
  source_mask: string[];
  run_frequency_minutes: number;
};

type NormalizedListing = {
  source: string;
  listing_id: string;
  source_url: string | null;
  make: string;
  model: string;
  variant: string | null;
  year: number | null;
  km: number | null;
  asking_price: number | null;
  location: string | null;
  raw: Record<string, unknown>;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parsePrice(raw: unknown): number | null {
  if (raw == null) return null;
  const val = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[,$\s]/g, ""));
  return !isNaN(val) && val > 0 ? Math.round(val) : null;
}

function parseKm(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).replace(/[,\s]/g, "");
  const m = s.match(/(\d+)/);
  if (!m) return null;
  const val = parseInt(m[1]);
  return val > 0 && val < 999999 ? val : null;
}

function parseYear(raw: unknown): number | null {
  if (raw == null) return null;
  const y = parseInt(String(raw));
  return y >= 1990 && y <= 2030 ? y : null;
}

function extractBadge(text: string | null): string {
  if (!text) return "";
  const d = text.toUpperCase();
  const badges = [
    "EXCEED TOURER", "EXCEED", "X-TERRAIN", "SR5", "ROGUE", "RUGGED X", "RUGGED",
    "RAPTOR", "WILDTRAK", "KAKADU", "SAHARA", "ASPIRE", "TITANIUM", "PLATINUM",
    "GXL", "VX", "GX", "XLT", "XLS", "LS-U", "LS-M", "LS-T",
    "ST-X", "ST-L", "GLS", "N-TREK", "COMMUTER", "SLWB", "LWB",
    "WORKMATE", "AMBIENTE", "TREND", "ASCENT SPORT", "ASCENT",
    "MAXX SPORT", "MAXX", "AKARI", "GT-LINE", "TOURING",
    "EDGE", "ATMOS", "CRUSADE", "URBAN CRUISER",
  ];
  const shortBadges = ["SR", "XL", "LS", "ES", "SL", "ST", "SX", "XT", "RX", "ZR"];
  for (const b of badges) { if (d.includes(b)) return b; }
  for (const b of shortBadges) { if (new RegExp(`\\b${b}\\b`).test(d)) return b; }
  return "";
}

// ─── Source Adapters ─────────────────────────────────────────────────────────

async function fetchPickles(mandate: Mandate): Promise<NormalizedListing[]> {
  const url = "https://backend.caroogle.codesorbit.net/api/ads?source=pickles&limit=5000";
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Pickles API ${resp.status}`);
  const payload = await resp.json();
  const ads: any[] = Array.isArray(payload) ? payload : (payload.data || []);

  const results: NormalizedListing[] = [];
  for (const ad of ads) {
    const lotId = String(ad.lotId || ad.lot_id || ad.id || "");
    if (!lotId) continue;

    const make = ad.make ? String(ad.make).toUpperCase().trim() : null;
    if (!make) continue;

    let model = ad.model ? String(ad.model).toUpperCase().trim() : null;
    if (!model && ad.title && make) {
      const t = String(ad.title).toUpperCase().trim();
      if (t.startsWith(make)) model = t.slice(make.length).trim() || null;
    }
    if (!model) continue;

    const year = parseYear(ad.year);
    const km = parseKm(ad.odometer || ad.km || ad.kms);
    const price = parsePrice(ad.price || ad.askingPrice || ad.asking_price);

    // Structural filters (B-mode: no margin/score filtering)
    if (mandate.make && make !== mandate.make.toUpperCase()) continue;
    if (mandate.model && !model.includes(mandate.model.toUpperCase())) continue;
    if (mandate.year_min && year && year < mandate.year_min) continue;
    if (mandate.year_max && year && year > mandate.year_max) continue;
    if (mandate.km_max && km && km > mandate.km_max) continue;
    if (mandate.price_max && price && price > mandate.price_max) continue;

    const variant = extractBadge(ad.variant || ad.title || ad.sellerNotes) || null;

    results.push({
      source: "pickles",
      listing_id: `pickles:${lotId}`,
      source_url: ad.url || ad.listing_url || ad.link || null,
      make, model, variant, year, km,
      asking_price: price,
      location: ad.location || ad.suburb || null,
      raw: ad,
    });
  }
  return results;
}

async function fetchToyota(mandate: Mandate): Promise<NormalizedListing[]> {
  const url = "https://backend.caroogle.codesorbit.net/api/ads?source=toyota&limit=5000";
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Toyota API ${resp.status}`);
  const payload = await resp.json();
  const ads: any[] = Array.isArray(payload) ? payload : (payload.data || []);

  const results: NormalizedListing[] = [];
  for (const ad of ads) {
    const lotId = String(ad.lotId || ad.lot_id || ad.id || "");
    if (!lotId) continue;

    const make = ad.make ? String(ad.make).toUpperCase().trim() : null;
    if (!make) continue;

    let model = (ad.vehicleModel || ad.vehicle_model || ad.model || "") as string;
    model = model ? model.toUpperCase().trim() : "UNKNOWN";

    const year = parseYear(ad.year);
    const km = parseKm(ad.odometer || ad.km);
    const price = parsePrice(ad.price);

    // Structural filters
    if (mandate.make && make !== mandate.make.toUpperCase()) continue;
    if (mandate.model && !model.includes(mandate.model.toUpperCase())) continue;
    if (mandate.year_min && year && year < mandate.year_min) continue;
    if (mandate.year_max && year && year > mandate.year_max) continue;
    if (mandate.km_max && km && km > mandate.km_max) continue;
    if (mandate.price_max && price && price > mandate.price_max) continue;

    const variant = ad.variant ? extractBadge(String(ad.variant)) || String(ad.variant).toUpperCase().trim() : extractBadge(ad.title as string) || null;

    results.push({
      source: "toyota",
      listing_id: `toyota:${lotId}`,
      source_url: (ad.listingUrl || ad.listing_url || ad.link || null) as string | null,
      make, model, variant, year, km,
      asking_price: price,
      location: (ad.location || ad.suburb || null) as string | null,
      raw: ad,
    });
  }
  return results;
}

const ADAPTERS: Record<string, (m: Mandate) => Promise<NormalizedListing[]>> = {
  pickles: fetchPickles,
  toyota: fetchToyota,
};

// ─── Feed upsert ─────────────────────────────────────────────────────────────

async function upsertFeedItems(
  sb: ReturnType<typeof createClient>,
  mandateId: string,
  listings: NormalizedListing[],
): Promise<{ upserted: number; errors: number }> {
  let upserted = 0;
  let errors = 0;
  const BATCH = 200;

  for (let i = 0; i < listings.length; i += BATCH) {
    const batch = listings.slice(i, i + BATCH);
    const now = new Date().toISOString();

    const rows = batch.map(l => ({
      mandate_id: mandateId,
      source: l.source,
      listing_id: l.listing_id,
      source_url: l.source_url,
      make: l.make,
      model: l.model,
      variant: l.variant,
      year: l.year,
      km: l.km,
      asking_price: l.asking_price,
      location: l.location,
      last_seen_at: now,
      raw: l.raw,
      // Price tracking: handled via ON CONFLICT update
    }));

    // Use raw SQL-like upsert. On conflict, update last_seen + detect price change.
    const { error, data } = await sb
      .from("mandate_feed_items")
      .upsert(rows, {
        onConflict: "mandate_id,source,listing_id",
        ignoreDuplicates: false,
      })
      .select("id, asking_price, last_price");

    if (error) {
      errors += batch.length;
      console.error(`[run-mandates] Feed upsert error: ${error.message}`);
    } else {
      upserted += data?.length || batch.length;
    }
  }

  // Price change detection pass — update last_price and price_delta for changed prices
  // We do this as a second query to catch items where asking_price != last_price
  await sb.rpc("mandate_feed_detect_price_changes", { p_mandate_id: mandateId }).catch(() => {
    // RPC may not exist yet — that's OK, price tracking is a day-7 enhancement
  });

  return { upserted, errors };
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Create mandate_runs row
    const { data: runRow } = await sb
      .from("mandate_runs")
      .insert({ started_at: new Date().toISOString() })
      .select("id")
      .single();

    const runId = runRow?.id;

    // 2. Fetch due mandates
    const { data: dueMandates, error: fetchErr } = await sb
      .from("active_mandates")
      .select("*")
      .eq("is_active", true)
      .lte("next_run_at", new Date().toISOString());

    if (fetchErr) throw new Error(`Failed to fetch mandates: ${fetchErr.message}`);

    const mandates = (dueMandates || []) as Mandate[];
    console.log(`[run-mandates] ${mandates.length} mandates due`);

    let totalFetched = 0;
    let totalUpserted = 0;
    const runErrors: any[] = [];
    let mandatesExecuted = 0;

    // 3. Execute each mandate
    for (const mandate of mandates) {
      console.log(`[run-mandates] Executing: ${mandate.name} (sources: ${mandate.source_mask.join(",")})`);

      let mandateFetched = 0;
      let mandateUpserted = 0;

      for (const source of mandate.source_mask) {
        const adapter = ADAPTERS[source];
        if (!adapter) {
          console.warn(`[run-mandates] No adapter for source: ${source}`);
          continue;
        }

        try {
          const listings = await adapter(mandate);
          mandateFetched += listings.length;
          console.log(`[run-mandates] ${source} returned ${listings.length} listings for "${mandate.name}"`);

          if (listings.length > 0) {
            const { upserted, errors } = await upsertFeedItems(sb, mandate.id, listings);
            mandateUpserted += upserted;
            if (errors > 0) {
              runErrors.push({ mandate: mandate.name, source, errors });
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[run-mandates] Adapter ${source} failed for "${mandate.name}": ${msg}`);
          runErrors.push({ mandate: mandate.name, source, error: msg });
        }
      }

      totalFetched += mandateFetched;
      totalUpserted += mandateUpserted;
      mandatesExecuted++;

      // 4. Update mandate schedule
      const nextRunAt = new Date(Date.now() + mandate.run_frequency_minutes * 60 * 1000).toISOString();
      await sb
        .from("active_mandates")
        .update({
          last_run_at: new Date().toISOString(),
          next_run_at: nextRunAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", mandate.id);
    }

    // 5. Close out mandate_runs
    if (runId) {
      await sb
        .from("mandate_runs")
        .update({
          finished_at: new Date().toISOString(),
          mandates_due: mandates.length,
          mandates_executed: mandatesExecuted,
          listings_fetched: totalFetched,
          listings_upserted: totalUpserted,
          errors: runErrors.length > 0 ? runErrors : null,
        })
        .eq("id", runId);
    }

    // Heartbeat
    await sb.from("cron_heartbeat").upsert({
      cron_name: CRON_NAME,
      last_seen_at: new Date().toISOString(),
      last_ok: true,
      note: `due=${mandates.length} exec=${mandatesExecuted} fetched=${totalFetched} upserted=${totalUpserted} errors=${runErrors.length}`,
    }, { onConflict: "cron_name" });

    const result = {
      mandates_due: mandates.length,
      mandates_executed: mandatesExecuted,
      listings_fetched: totalFetched,
      listings_upserted: totalUpserted,
      errors: runErrors,
      runtime_ms: Date.now() - startTime,
    };

    console.log(`[run-mandates] Done:`, JSON.stringify(result));

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[run-mandates] Fatal:`, msg);

    try {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      await sb.from("cron_heartbeat").upsert({
        cron_name: CRON_NAME,
        last_seen_at: new Date().toISOString(),
        last_ok: false,
        note: `FATAL: ${msg.slice(0, 100)}`,
      }, { onConflict: "cron_name" });
    } catch (_) {}

    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
