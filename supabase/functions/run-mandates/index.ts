import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * RUN-MANDATES — Unified Mandate Dispatcher
 * 
 * Every 15 min, fetches due mandates, runs per-source adapters,
 * and upserts results into mandate_feed_items.
 * 
 * B-mode: store EVERYTHING that matches structural constraints.
 * Score/margin are ranking signals only — never filter on them.
 * 
 * Code Red alerts: price drops + new tight listings → Slack.
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
  km_min: number | null;
  km_max: number | null;
  price_max: number | null;
  source_mask: string[];
  run_frequency_minutes: number;
  // Dealer intelligence passthrough — populated from active_mandates SELECT *
  dealer_id: string | null;
  account_id: string | null;
  created_from_fingerprint_id: string | null;
  min_expected_gp: number | null;
  preferred_body_types: string[] | null;
  preferred_fuel: string[] | null;
  preferred_transmission: string[] | null;
  lane: string | null;
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

type FeedItemRow = {
  id: string;
  mandate_id: string;
  source: string;
  listing_id: string;
  source_url: string | null;
  make: string;
  model: string;
  variant: string | null;
  year: number | null;
  km: number | null;
  asking_price: number | null;
  last_price: number | null;
  price_delta: number | null;
  first_seen_at: string;
  last_seen_at: string;
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

function formatPrice(price: number | null): string {
  if (!price) return "N/A";
  return "$" + price.toLocaleString("en-AU", { maximumFractionDigits: 0 });
}

function formatKm(km: number | null): string {
  if (!km) return "N/A";
  return Math.round(km / 1000) + "k km";
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

async function fetchGumtree(mandate: Mandate): Promise<NormalizedListing[]> {
  const url = "https://backend.caroogle.codesorbit.net/api/ads?source=gumtree&limit=5000";
  const resp = await fetch(url);
  if (!resp.ok) { console.error(`Gumtree API ${resp.status}`); return []; }
  const payload = await resp.json();
  const ads: Record<string, unknown>[] = Array.isArray(payload) ? payload : (payload.data || payload.ads || payload.results || []);
  const results: NormalizedListing[] = [];
  for (const ad of ads) {
    const make = String(ad.make || "").toUpperCase();
    const model = String(ad.vehicleModel || ad.vehicle_model || ad.model || "").toUpperCase();
    const year = parseInt(String(ad.year || "0"));
    const km = parseInt(String(ad.odometer || ad.km || "0").replace(/[,\s]/g, "")) || null;
    const price = typeof ad.price === "number" ? ad.price : parseFloat(String(ad.price || "0").replace(/[,$\s]/g, "")) || null;
    if (!make || !model || !year || !price) continue;
    if (mandate.make && make !== mandate.make.toUpperCase()) continue;
    if (mandate.model && model !== mandate.model.toUpperCase()) continue;
    if (mandate.year_min && year < mandate.year_min) continue;
    if (mandate.year_max && year > mandate.year_max) continue;
    if (mandate.km_max && km && km > mandate.km_max) continue;
    if (mandate.price_max && price > mandate.price_max) continue;
    results.push({
      source: "gumtree",
      listing_id: `gumtree:${ad.lotId || ad.lot_id || ad.id}`,
      make, model, year, km, price,
      variant: String(ad.variant || "").toUpperCase() || null,
      location: String(ad.location || ad.suburb || "") || null,
      listing_url: String(ad.listingUrl || ad.listing_url || ad.link || "") || null,
    });
  }
  return results;
}

async function fetchAutotrader(mandate: Mandate): Promise<NormalizedListing[]> {
  const url = "https://backend.caroogle.codesorbit.net/api/ads?source=autotrader&limit=5000";
  const resp = await fetch(url);
  if (!resp.ok) { console.error(`Autotrader API ${resp.status}`); return []; }
  const payload = await resp.json();
  const ads: Record<string, unknown>[] = Array.isArray(payload) ? payload : (payload.data || payload.ads || payload.results || []);
  const results: NormalizedListing[] = [];
  for (const ad of ads) {
    const make = String(ad.make || "").toUpperCase();
    const model = String(ad.vehicleModel || ad.vehicle_model || ad.model || "").toUpperCase();
    const year = parseInt(String(ad.year || "0"));
    const km = parseInt(String(ad.odometer || ad.km || "0").replace(/[,\s]/g, "")) || null;
    const price = typeof ad.price === "number" ? ad.price : parseFloat(String(ad.price || "0").replace(/[,$\s]/g, "")) || null;
    if (!make || !model || !year || !price) continue;
    if (mandate.make && make !== mandate.make.toUpperCase()) continue;
    if (mandate.model && model !== mandate.model.toUpperCase()) continue;
    if (mandate.year_min && year < mandate.year_min) continue;
    if (mandate.year_max && year > mandate.year_max) continue;
    if (mandate.km_max && km && km > mandate.km_max) continue;
    if (mandate.price_max && price > mandate.price_max) continue;
    results.push({
      source: "autotrader",
      listing_id: `caroogle-autotrader:${ad.lotId || ad.lot_id || ad.id}`,
      make, model, year, km, price,
      variant: String(ad.variant || "").toUpperCase() || null,
      location: String(ad.location || ad.suburb || "") || null,
      listing_url: String(ad.listingUrl || ad.listing_url || ad.link || "") || null,
    });
  }
  return results;
}

const ADAPTERS: Record<string, (m: Mandate) => Promise<NormalizedListing[]>> = {
  pickles: fetchPickles,
  toyota: fetchToyota,
  gumtree: fetchGumtree,
  autotrader: fetchAutotrader,
};

// ─── Lindy Discovery Dispatch ───────────────────────────────────────────────

const MIN_RESULTS_THRESHOLD = 5;
const LINDY_COOLDOWN_HOURS = 6;
const MAX_DEALER_JOBS_PER_RUN = 20;

const LINDY_SOURCES: Array<{ key: string; builder: (m: Mandate) => string | null }> = [
  {
    key: "carsales",
    builder: (m) => {
      const params = new URLSearchParams();
      params.set("q", `(And.Service.carsales._(C.Make.${m.make}._.Model.${m.model || ""}.))` );
      if (m.year_min) params.set("yearFrom", String(m.year_min));
      if (m.year_max) params.set("yearTo", String(m.year_max));
      if (m.km_max) params.set("odometersMax", String(m.km_max));
      if (m.price_max) params.set("priceTo", String(m.price_max));
      return `https://www.carsales.com.au/cars/?${params}`;
    },
  },
  {
    key: "gumtree",
    builder: (m) => {
      const q = [m.make, m.model, m.variant_family].filter(Boolean).join(" ");
      const params = new URLSearchParams({ search_query: q });
      if (m.price_max) params.set("price_max", String(m.price_max));
      return `https://www.gumtree.com.au/s-cars-vans-utes/c18320?${params}`;
    },
  },
  {
    key: "drive",
    builder: (m) => {
      const params = new URLSearchParams({ make: m.make.toLowerCase(), sort: "price" });
      if (m.model) params.set("model", m.model.toLowerCase());
      if (m.year_min) params.set("year_from", String(m.year_min));
      if (m.year_max) params.set("year_to", String(m.year_max));
      if (m.km_max) params.set("max_km", String(m.km_max));
      return `https://www.drive.com.au/cars-for-sale/?${params}`;
    },
  },
];

function buildLindyPrompt(source: string, url: string, mandate: Mandate): string {
  const ctx = [
    `Target make: ${mandate.make}`,
    mandate.model && `Target model: ${mandate.model}`,
    mandate.variant_family && `Target variant: ${mandate.variant_family}`,
    mandate.year_min && mandate.year_max
      ? `Target year range: ${mandate.year_min}–${mandate.year_max}`
      : mandate.year_min ? `Target year from: ${mandate.year_min}` : null,
    mandate.km_min && `Min odometer: ${mandate.km_min.toLocaleString()} km`,
    mandate.km_max && `Max odometer: ${mandate.km_max.toLocaleString()} km`,
    mandate.price_max && `Max price: $${mandate.price_max.toLocaleString()}`,
    // ─── Dealer intelligence (why this mandate exists) ───
    mandate.dealer_id && `Dealer ID: ${mandate.dealer_id}`,
    mandate.lane && `Mandate lane: ${mandate.lane}`,
    mandate.created_from_fingerprint_id && `Originating fingerprint: ${mandate.created_from_fingerprint_id}`,
    mandate.min_expected_gp && `Minimum expected gross profit: $${mandate.min_expected_gp.toLocaleString()} (results below this are not commercially relevant)`,
    mandate.preferred_body_types?.length && `Preferred body types: ${mandate.preferred_body_types.join(", ")}`,
    mandate.preferred_fuel?.length && `Preferred fuel: ${mandate.preferred_fuel.join(", ")}`,
    mandate.preferred_transmission?.length && `Preferred transmission: ${mandate.preferred_transmission.join(", ")}`,
  ].filter(Boolean).join("\n");

  if (source === "dealer_site") {
    return buildDealerSitePrompt(url, mandate, ctx);
  }

  return `Browse this URL and extract all used car listings:\n${url}\n\nSearch context:\n${ctx}\n\nFor each listing return a JSON object with: make, model, year, variant, odometer_km, price_asking, listing_url, listing_id, image_url, seller_name.\nReturn a JSON array of listings. If no listings found, return [].\nExtract ONLY listings visible on this page. Do NOT follow pagination.\nStrip "$", ",", "AUD" from prices — digits only. Same for odometer — digits only.\nIf price is "POA" or missing, use null. If odometer missing, use null.`;
}

function buildDealerSitePrompt(url: string, mandate: Mandate, ctx: string): string {
  return `Browse this dealer inventory page and extract all used vehicle listings that match the search criteria.

URL: ${url}

Search criteria:
${ctx}

RULES:
- Extract ONLY vehicles visible on this page. Do NOT follow pagination or "load more" links.
- Only return vehicles matching the target Make and Model. Skip everything else.
- For each matching vehicle, return a JSON object with:
  { "make": string, "model": string, "year": string, "variant": string|null, "odometer_km": string|null, "price_asking": string|null, "listing_url": string, "listing_id": string, "image_url": string|null, "seller_name": string|null }
- For listing_url: use the full absolute URL to the vehicle detail page. Prepend the site domain if the href is relative.
- For listing_id: use the stock number, VIN, or any unique identifier visible on the listing card. If none, use a slug from the URL.
- For price: digits only — strip "$", ",", "AUD", spaces. If "POA" or missing, use null.
- For odometer: digits only — strip "km", ",", spaces. If missing, use null.
- For image_url: extract the primary vehicle photo URL (not dealer logos or banners). Use null if unclear.
- For seller_name: use the dealer name shown on the page.
- Return a JSON array. If no matching vehicles found, return [].`;
}

/**
 * Load dealer sites relevant to a mandate's make and dispatch Lindy jobs for each.
 * Returns count of dispatched jobs and skipped reasons.
 */
async function dispatchDealerSiteJobs(
  sb: ReturnType<typeof createClient>,
  mandate: Mandate,
  searchRunId: string,
  today: string,
  lindyUrl: string,
  callbackUrl: string,
): Promise<{ dispatched: number; skipped: string[]; prefiltered: number }> {
  // Query enabled dealer sites, optionally filtered by brands matching the mandate make
  const { data: dealerSources, error: dsErr } = await sb
    .from("dealer_outbound_sources")
    .select("id, dealer_name, dealer_domain, inventory_path, brands, priority, dealer_slug")
    .eq("enabled", true)
    .limit(200);

  if (dsErr || !dealerSources || dealerSources.length === 0) {
    if (dsErr) console.error("[run-mandates] Failed to load dealer_outbound_sources:", dsErr.message);
    return { dispatched: 0, skipped: ["dealer_sites:no_sources"], prefiltered: 0 };
  }

  // Filter: only dealers whose brands array includes the mandate make (case-insensitive),
  // or dealers with no brands specified (generic inventory pages)
  const mandateMakeLower = mandate.make.toLowerCase();
  const relevant = dealerSources.filter((d) => {
    if (!d.brands || d.brands.length === 0) return true;
    return d.brands.some((b: string) => b.toLowerCase() === mandateMakeLower);
  });

  if (relevant.length === 0) {
    return { dispatched: 0, skipped: ["dealer_sites:no_relevant_dealers"], prefiltered: 0 };
  }

  // Prioritise: franchise first, then regional, then others. Limit to MAX_DEALER_JOBS_PER_RUN.
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const sorted = relevant.sort((a, b) => (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1));
  const batch = sorted.slice(0, MAX_DEALER_JOBS_PER_RUN);

  let dispatched = 0;
  let prefiltered = 0;
  const skipped: string[] = [];

  // Build search terms for HTML pre-filter from mandate context
  const searchTerms = [
    mandate.make,
    mandate.model,
    mandate.variant_family,
  ].filter(Boolean).map((t) => t!.toLowerCase());

  // Inventory card CSS class patterns — if none found, page likely isn't an inventory page
  const cardPatterns = ["vehicle", "stock-item", "inventory", "listing-card", "product-card", "car-card", "vdp-link"];

  for (const dealer of batch) {
    const inventoryUrl = `https://${dealer.dealer_domain}${dealer.inventory_path}`;
    const sourceKey = `dealer_site:${dealer.dealer_slug}`;

    // ─── HTML pre-filter: quick fetch + keyword scan before launching Lindy ─────
    try {
      const preflight = await fetch(inventoryUrl, {
        method: "GET",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; CarbitrageBot/1.0)" },
        signal: AbortSignal.timeout(8000), // 8s timeout
      });

      if (!preflight.ok) {
        prefiltered++;
        skipped.push(`${sourceKey}:http_${preflight.status}`);
        await preflight.text().catch(() => {}); // consume body
        continue;
      }

      const html = await preflight.text();
      const htmlLower = html.toLowerCase();

      // Check 1: does the page contain inventory card patterns?
      const hasInventoryCards = cardPatterns.some((p) => htmlLower.includes(p));
      if (!hasInventoryCards) {
        prefiltered++;
        skipped.push(`${sourceKey}:no_inventory_cards`);
        continue;
      }

      // Check 2: does the page mention the mandate's make/model?
      const hasRelevantVehicles = searchTerms.some((term) => htmlLower.includes(term));
      if (!hasRelevantVehicles) {
        prefiltered++;
        skipped.push(`${sourceKey}:no_keyword_match`);
        continue;
      }
    } catch (err) {
      // Timeout or network error — skip this dealer site
      prefiltered++;
      skipped.push(`${sourceKey}:preflight_err`);
      continue;
    }

    // ─── Pre-filter passed — dispatch Lindy ─────────────────────────────────────
    const jobId = crypto.randomUUID();

    // Insert job row — unique constraint prevents duplicate dispatch per mandate+source+day
    const { error: jobErr } = await sb.from("outward_jobs").insert({
      id: jobId,
      search_run_id: searchRunId,
      source_key: sourceKey,
      search_url: inventoryUrl,
      status: "dispatched",
      dispatched_at: new Date().toISOString(),
      mandate_id: mandate.id,
      dispatch_date: today,
    });

    if (jobErr) {
      if (jobErr.code === "23505") {
        skipped.push(`${sourceKey}:already_today`);
      } else {
        console.error(`[run-mandates] Dealer job insert failed for ${dealer.dealer_name}:`, jobErr.message);
        skipped.push(`${sourceKey}:job_err`);
      }
      continue;
    }

    const prompt = buildDealerSitePrompt(inventoryUrl, mandate, [
      `Target make: ${mandate.make}`,
      mandate.model && `Target model: ${mandate.model}`,
      mandate.variant_family && `Target variant: ${mandate.variant_family}`,
      mandate.year_min && mandate.year_max
        ? `Target year range: ${mandate.year_min}–${mandate.year_max}`
        : mandate.year_min ? `Target year from: ${mandate.year_min}` : null,
      mandate.km_max && `Max odometer: ${mandate.km_max.toLocaleString()} km`,
      mandate.price_max && `Max price: $${mandate.price_max.toLocaleString()}`,
    ].filter(Boolean).join("\n"));

    try {
      const resp = await fetch(lindyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jobId,
          search_run_id: searchRunId,
          source: "dealer_site",
          url: inventoryUrl,
          prompt,
          callback_url: callbackUrl,
          callback_headers: {
            ...(Deno.env.get("LINDY_WEBHOOK_SECRET")
              ? { "x-lindy-signature": Deno.env.get("LINDY_WEBHOOK_SECRET")! }
              : {}),
            "Content-Type": "application/json",
          },
          mandate_id: mandate.id,
          mandate_name: mandate.name,
          dealer_slug: dealer.dealer_slug,
          dealer_name: dealer.dealer_name,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        console.error(`[run-mandates] Dealer site ${dealer.dealer_name} dispatch failed: ${resp.status} ${errText.slice(0, 200)}`);
        await sb.from("outward_jobs").update({ status: "failed", error: `HTTP ${resp.status}` }).eq("id", jobId);
        skipped.push(`${sourceKey}:http_${resp.status}`);
        continue;
      }
      await resp.text(); // consume body
      dispatched++;
      console.log(`[run-mandates] Dealer site dispatched: ${dealer.dealer_name} for "${mandate.name}"`);
    } catch (err) {
      console.error(`[run-mandates] Dealer site ${dealer.dealer_name} error:`, err);
      await sb.from("outward_jobs").update({ status: "failed", error: String(err) }).eq("id", jobId);
      skipped.push(`${sourceKey}:fetch_err`);
    }
  }

  if (prefiltered > 0) {
    console.log(`[run-mandates] Dealer pre-filter: ${prefiltered}/${batch.length} sites skipped (no relevant content) for "${mandate.name}"`);
  }

  return { dispatched, skipped, prefiltered };
}

async function dispatchLindyForMandate(
  sb: ReturnType<typeof createClient>,
  mandate: Mandate,
): Promise<{ dispatched: number; skipped: string[] }> {
  const LINDY_URL = Deno.env.get("LINDY_HTTP_WEBHOOK_URL");
  if (!LINDY_URL) {
    console.warn("[run-mandates] LINDY_HTTP_WEBHOOK_URL not configured — skipping Lindy dispatch");
    return { dispatched: 0, skipped: ["no_webhook_url"] };
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/lindy-results-webhook`;

  // Check cooldown: skip if Lindy was dispatched for this mandate within LINDY_COOLDOWN_HOURS
  const cooldownCutoff = new Date(Date.now() - LINDY_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
  const { count: recentJobs } = await sb
    .from("outward_jobs")
    .select("id", { count: "exact", head: true })
    .eq("mandate_id", mandate.id)
    .gte("dispatched_at", cooldownCutoff)
    .in("status", ["dispatched", "complete"]);

  if ((recentJobs ?? 0) > 0) {
    console.log(`[run-mandates] Lindy cooldown active for "${mandate.name}" — skipping`);
    return { dispatched: 0, skipped: ["cooldown"] };
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD for dispatch_date

  const searchRunId = crypto.randomUUID();
  let dispatched = 0;
  const skipped: string[] = [];

  for (const { key, builder } of LINDY_SOURCES) {
    const searchUrl = builder(mandate);
    if (!searchUrl) { skipped.push(`${key}:no_url`); continue; }

    const jobId = crypto.randomUUID();
    const { error: jobErr } = await sb.from("outward_jobs").insert({
      id: jobId,
      search_run_id: searchRunId,
      source_key: key,
      search_url: searchUrl,
      status: "dispatched",
      dispatched_at: new Date().toISOString(),
      mandate_id: mandate.id,
      dispatch_date: today,
    });
    if (jobErr) {
      // Unique constraint violation = already dispatched today for this mandate+source
      if (jobErr.code === "23505") {
        console.log(`[run-mandates] Lindy already dispatched today for "${mandate.name}" on ${key} — skipping`);
        skipped.push(`${key}:already_today`);
        continue;
      }
      skipped.push(`${key}:job_err`);
      continue;
    }

    const prompt = buildLindyPrompt(key, searchUrl, mandate);
    console.log("[run-mandates] dispatch", {
      mandate_id: mandate.id,
      dealer_id: mandate.dealer_id ?? null,
      lane: mandate.lane ?? null,
      source: key,
      prompt_preview: prompt.slice(0, 500),
    });
    try {
      const resp = await fetch(LINDY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jobId,
          search_run_id: searchRunId,
          source: key,
          url: searchUrl,
          prompt,
          callback_url: CALLBACK_URL,
          callback_headers: {
            ...(Deno.env.get("LINDY_WEBHOOK_SECRET")
              ? { "x-lindy-signature": Deno.env.get("LINDY_WEBHOOK_SECRET")! }
              : {}),
            "Content-Type": "application/json",
          },
          mandate_id: mandate.id,
          mandate_name: mandate.name,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        console.error(`[run-mandates] Lindy ${key} dispatch failed: HTTP ${resp.status} body=${errText.slice(0, 300)}`);
        await sb.from("outward_jobs").update({ status: "failed", error: `HTTP ${resp.status}: ${errText.slice(0, 200)}` }).eq("id", jobId);
        skipped.push(`${key}:http_${resp.status}`);
        continue;
      }
      const respBody = await resp.text().catch(() => "");
      console.log(`[run-mandates] Lindy ${key} dispatched OK status=${resp.status} body_preview=${respBody.slice(0, 200)} job=${jobId}`);
      dispatched++;
    } catch (err) {
      console.error(`[run-mandates] Lindy ${key} fetch error:`, err);
      await sb.from("outward_jobs").update({ status: "failed", error: `fetch_err: ${String(err).slice(0, 200)}` }).eq("id", jobId);
      skipped.push(`${key}:fetch_err`);
    }
  }

  // ─── Dealer site dispatch (first-class Lindy source) ────────────────────────
  try {
    const dealerResult = await dispatchDealerSiteJobs(
      sb, mandate, searchRunId, today, LINDY_URL, CALLBACK_URL,
    );
    dispatched += dealerResult.dispatched;
    skipped.push(...dealerResult.skipped);
    if (dealerResult.dispatched > 0 || dealerResult.prefiltered > 0) {
      console.log(`[run-mandates] Dealer sites: ${dealerResult.dispatched} dispatched, ${dealerResult.prefiltered} pre-filtered for "${mandate.name}"`);
    }
  } catch (err) {
    console.error(`[run-mandates] Dealer site dispatch error for "${mandate.name}":`, err);
    skipped.push("dealer_sites:error");
  }

  return { dispatched, skipped };
}

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
    }));

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

  await sb.rpc("mandate_feed_detect_price_changes", { p_mandate_id: mandateId }).catch(() => {});

  return { upserted, errors };
}

// ─── Code Red Alert Logic ────────────────────────────────────────────────────

function isPriceDropCodeRed(priceDelta: number | null, lastPrice: number | null): boolean {
  if (priceDelta == null || lastPrice == null || lastPrice <= 0) return false;
  if (priceDelta <= -3000) return true;
  if (priceDelta <= -2000 && Math.abs(priceDelta) / lastPrice >= 0.05) return true;
  return false;
}

function isNewCleanCodeRed(item: FeedItemRow, mandate: Mandate, runStartedAt: string): boolean {
  // first_seen_at must be within this run
  if (item.first_seen_at < runStartedAt) return false;

  // Year check: must be >= (year_max - 1) if year_max exists
  if (mandate.year_max && item.year) {
    if (item.year < mandate.year_max - 1) return false;
  }

  // KM check: must be <= 70% of km_max if km_max exists
  if (mandate.km_max && item.km) {
    if (item.km > 0.7 * mandate.km_max) return false;
  }

  // Price check: must be >= 97% of price_max (priced to move, near ceiling)
  if (mandate.price_max && item.asking_price) {
    if (item.asking_price < 0.97 * mandate.price_max) return false;
  }

  return true;
}

async function checkCooldown(
  sb: ReturnType<typeof createClient>,
  mandateId: string,
  source: string,
  listingId: string,
  alertType: string,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await sb
    .from("mandate_alerts")
    .select("id")
    .eq("mandate_id", mandateId)
    .eq("source", source)
    .eq("listing_id", listingId)
    .eq("alert_type", alertType)
    .gte("created_at", cutoff)
    .limit(1);
  return (data?.length || 0) > 0;
}

async function sendCodeRedToSlack(
  webhook: string,
  item: FeedItemRow,
  reason: string,
  alertType: string,
): Promise<boolean> {
  const vehicle = `${item.year || ""} ${item.make || ""} ${item.model || ""} ${item.variant || ""}`.trim();
  const dropText = item.price_delta ? `Drop: ${formatPrice(Math.abs(item.price_delta))}` : "";

  const fields = [
    { type: "mrkdwn", text: `*Price:*\n${formatPrice(item.asking_price)}` },
    { type: "mrkdwn", text: `*KM:*\n${formatKm(item.km)}` },
    { type: "mrkdwn", text: `*Source:*\n${item.source}` },
    { type: "mrkdwn", text: `*Reason:*\n${reason}` },
  ];
  if (dropText) {
    fields.splice(1, 0, { type: "mrkdwn", text: `*${dropText}*` });
  }

  const blocks: any[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `🚨 *CODE RED — ${vehicle}*` },
    },
    { type: "section", fields },
  ];

  if (item.source_url) {
    blocks.push({
      type: "actions",
      elements: [{
        type: "button",
        text: { type: "plain_text", text: "View Listing" },
        url: item.source_url,
        style: "danger",
      }],
    });
  }

  blocks.push({ type: "divider" });

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attachments: [{
          color: "#EF4444",
          blocks,
        }],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function evaluateCodeRedAlerts(
  sb: ReturnType<typeof createClient>,
  mandate: Mandate,
  runStartedAt: string,
  slackWebhook: string | undefined,
): Promise<number> {
  let codeRedCount = 0;

  // Fetch all feed items for this mandate that were touched in this run
  const { data: items, error } = await sb
    .from("mandate_feed_items")
    .select("id, mandate_id, source, listing_id, source_url, make, model, variant, year, km, asking_price, last_price, price_delta, first_seen_at, last_seen_at")
    .eq("mandate_id", mandate.id)
    .gte("last_seen_at", runStartedAt);

  if (error || !items) return 0;

  for (const item of items as FeedItemRow[]) {
    let alertType: string | null = null;
    let reason = "";

    // Check price drop
    if (isPriceDropCodeRed(item.price_delta, item.last_price)) {
      alertType = "price_drop";
      const pct = item.last_price ? Math.round(Math.abs(item.price_delta!) / item.last_price * 100) : 0;
      reason = `Price dropped ${formatPrice(Math.abs(item.price_delta!))} (${pct}%) from ${formatPrice(item.last_price)}`;
    }
    // Check new + tight
    else if (isNewCleanCodeRed(item, mandate, runStartedAt)) {
      alertType = "new_clean";
      reason = `New listing: tight spec — ${item.year} model, ${formatKm(item.km)}, priced ${formatPrice(item.asking_price)}`;
    }

    if (!alertType) continue;

    // Cooldown check
    const onCooldown = await checkCooldown(sb, mandate.id, item.source, item.listing_id, alertType);
    if (onCooldown) continue;

    console.log(`[run-mandates] CODE RED triggered for ${item.listing_id}`);

    // Insert alert
    const { error: insertErr } = await sb
      .from("mandate_alerts")
      .upsert({
        mandate_id: mandate.id,
        source: item.source,
        listing_id: item.listing_id,
        alert_type: alertType,
        severity: "code_red",
        reason,
      }, { onConflict: "mandate_id,source,listing_id,alert_type" });

    if (insertErr) {
      console.error(`[run-mandates] Alert insert error: ${insertErr.message}`);
      continue;
    }

    codeRedCount++;

    // Send Slack
    if (slackWebhook) {
      const sent = await sendCodeRedToSlack(slackWebhook, item, reason, alertType);
      if (sent) {
        await sb
          .from("mandate_alerts")
          .update({ sent_at: new Date().toISOString() })
          .eq("mandate_id", mandate.id)
          .eq("source", item.source)
          .eq("listing_id", item.listing_id)
          .eq("alert_type", alertType);
      }
    }
  }

  return codeRedCount;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const runStartedAt = new Date().toISOString();

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const SLACK_WEBHOOK = Deno.env.get("SLACK_WEBHOOK_URL");

    // 1. Create mandate_runs row
    const { data: runRow } = await sb
      .from("mandate_runs")
      .insert({ started_at: runStartedAt })
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
    let totalCodeRed = 0;
    let totalLindyDispatched = 0;
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

      // 3b. Lindy outward discovery if internal results insufficient
      if (mandateFetched < MIN_RESULTS_THRESHOLD) {
        console.log(`[run-mandates] "${mandate.name}" has ${mandateFetched} results (< ${MIN_RESULTS_THRESHOLD}) — triggering Lindy discovery`);
        try {
          const { dispatched, skipped } = await dispatchLindyForMandate(sb, mandate);
          totalLindyDispatched += dispatched;
          if (skipped.length > 0) {
            console.log(`[run-mandates] Lindy skipped for "${mandate.name}": ${skipped.join(", ")}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[run-mandates] Lindy dispatch failed for "${mandate.name}": ${msg}`);
          runErrors.push({ mandate: mandate.name, source: "lindy", error: msg });
        }
      }

      // 4. Evaluate Code Red alerts for this mandate
      try {
        const codeReds = await evaluateCodeRedAlerts(sb, mandate, runStartedAt, SLACK_WEBHOOK);
        totalCodeRed += codeReds;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[run-mandates] Code Red eval failed for "${mandate.name}": ${msg}`);
      }

      // 5. Update mandate schedule
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

    // 6. Close out mandate_runs
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
      note: `due=${mandates.length} exec=${mandatesExecuted} fetched=${totalFetched} upserted=${totalUpserted} code_red=${totalCodeRed} lindy=${totalLindyDispatched} errors=${runErrors.length}`,
    }, { onConflict: "cron_name" });

    const result = {
      mandates_due: mandates.length,
      mandates_executed: mandatesExecuted,
      listings_fetched: totalFetched,
      listings_upserted: totalUpserted,
      code_red_count: totalCodeRed,
      lindy_dispatched: totalLindyDispatched,
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
