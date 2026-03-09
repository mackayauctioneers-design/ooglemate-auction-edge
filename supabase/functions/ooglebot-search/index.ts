import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractSeries } from "../_shared/taxonomy/derivePlatform.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const AUCTION_SOURCES = new Set([
  "pickles", "grays", "manheim", "slattery", "f3",
  "auto_auctions", "vma", "bidsonline",
]);
const AUCTION_PREMIUM = 500;
const FREIGHT_FLAT = 800;
const MAX_LIMIT = 50;

// These lifecycle states mean the listing should never be shown to users.
const EXCLUDED_LIFECYCLE = ["STALE", "DEAD", "RETURNED", "INVALID", "DELISTED", "SOLD"];

/** Detect which LC series (LC70/LC200/LC300) a listing belongs to, based on variant+URL signals */
function detectListingSeriesLC(l: {
  variant_raw?: string | null; variant_family?: string | null; variant_used?: string | null;
  listing_id?: string; listing_url?: string | null;
}): string | null {
  const text = [l.variant_raw, l.variant_family, l.variant_used, l.listing_id, l.listing_url]
    .filter(Boolean).join(" ").toUpperCase();
  // LC70 signals: 70/76/78/79 as tokens, 70SERIES in URL, WORKMATE badge
  if (/\b7[0689]\b/.test(text) || /70[\-_\s]?SERIES|LANDCRUISER70|LC7[0689]/.test(text) || /\bWORKMATE\b/.test(text)) return "LC70";
  // LC300 signals: 300 as token, GR-SPORT/GR-S badges unique to 300
  if (/\b300\b/.test(text) || /GR[\-_\s]?SPORT|GR[\-_\s]?S\b|LC300/.test(text)) return "LC300";
  // LC200 signals
  if (/\b200\b/.test(text) || /LC200/.test(text)) return "LC200";
  return null;
}

/** Strip LC series numbers from model string so DB query fetches all generations */
function normalizeModelForQuery(model: string, intentSeries: string | null): string {
  if (!intentSeries?.startsWith("LC")) return model;
  return model.replace(/\b(7[0689]|200|300)\b/gi, "").replace(/\s+/g, " ").trim();
}

interface SearchInput {
  make: string;
  model: string;
  badge: string | null;
  year_min?: number | null;
  year_max?: number | null;
  max_km?: number | null;
  price_max?: number | null;
  limit?: number | null;
}

function validate(body: unknown): { ok: true; input: SearchInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Body must be a JSON object" };
  const b = body as Record<string, unknown>;

  if (typeof b.make !== "string" || !b.make.trim()) return { ok: false, error: "make is required (string)" };
  if (typeof b.model !== "string" || !b.model.trim()) return { ok: false, error: "model is required (string)" };

  const make = b.make.trim().substring(0, 50);
  const model = b.model.trim().substring(0, 50);
  const badge = typeof b.badge === "string" && b.badge.trim() ? b.badge.trim().substring(0, 50) : null;
  const year_min = typeof b.year_min === "number" && b.year_min >= 1990 && b.year_min <= 2030 ? b.year_min : null;
  const year_max = typeof b.year_max === "number" && b.year_max >= 1990 && b.year_max <= 2030 ? b.year_max : null;
  const max_km = typeof b.max_km === "number" && b.max_km > 0 && b.max_km <= 999999 ? b.max_km : null;
  const price_max = typeof b.price_max === "number" && b.price_max > 0 ? b.price_max : null;
  let limit = typeof b.limit === "number" ? Math.min(Math.max(1, Math.floor(b.limit)), MAX_LIMIT) : 20;

  return { ok: true, input: { make, model, badge, year_min, year_max, max_km, price_max, limit } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ status: "error", error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();
    const validation = validate(body);
    if (!validation.ok) {
      return new Response(JSON.stringify({ status: "error", error: validation.error }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { input } = validation;

    // Derive intent series from make + model (e.g. "LandCruiser 79" → LC70)
    const intentSeries = extractSeries(input.make, input.model);
    // Normalize model for DB query: "LandCruiser 79" → "LandCruiser" to avoid missing GXL-only variants
    const queryModel = normalizeModelForQuery(input.model, intentSeries);

    // --- 1. Query vehicle_listings ---
    let query = sb
      .from("vehicle_listings")
      .select(`
        id, listing_id, source, source_class, make, model,
        variant_raw, variant_family, variant_used, year, km,
        asking_price, location, state, listing_url,
        auction_house, lifecycle_state, fingerprint,
        fingerprint_confidence, first_seen_at, last_seen_at,
        drivetrain, fuel, transmission, seller_type,
        is_dealer_grade, watch_status
      `)
      .ilike("make", input.make)
      .neq("status", "sold")
      .not("lifecycle_state", "in", `(${EXCLUDED_LIFECYCLE.join(",")})`)
      .order("asking_price", { ascending: false, nullsFirst: false })
      .limit(input.limit! * 3); // over-fetch for scoring/filtering

    // Model matching: use normalized model (series stripped) for LC queries
    const modelParts = queryModel.split(/\s+/);
    if (modelParts.length > 1) {
      const modelFilter = [
        `model.ilike.%${queryModel}%`,
        `variant_raw.ilike.%${modelParts.slice(1).join(" ")}%`,
        `variant_family.ilike.%${modelParts.slice(1).join(" ")}%`,
        `variant_used.ilike.%${modelParts.slice(1).join(" ")}%`,
      ].join(",");
      query = query.or(modelFilter);
    } else {
      query = query.ilike("model", `%${queryModel}%`);
    }

    if (input.year_min) query = query.gte("year", input.year_min);
    if (input.year_max) query = query.lte("year", input.year_max);
    if (input.max_km) query = query.lte("km", input.max_km);
    if (input.price_max) {
      // Include listings with price <= max OR no price (auction TBA)
      query = query.or(`asking_price.lte.${input.price_max},asking_price.is.null`);
    }

    const { data: listings, error: listErr } = await query;
    if (listErr) throw listErr;

    // --- 1b. Badge/variant filtering (exact token match, not substring) ---
    let filtered = listings || [];
    if (input.badge) {
      const badgeUpper = input.badge.toUpperCase().replace(/[^A-Z0-9]/g, "");
      // Exact token match: badge must appear as a complete word, not as prefix of longer badge
      const badgeRegex = new RegExp(`(^|[\\s\\-\\/,])${badgeUpper.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s\\-\\/,])`, "i");
      filtered = filtered.filter((l: any) => {
        const variants = [l.variant_raw, l.variant_family, l.variant_used].filter(Boolean);
        return variants.some((v: string) => {
          const vNorm = v.toUpperCase().replace(/[^A-Z0-9\s\-\/,]/g, "");
          return vNorm === badgeUpper || badgeRegex.test(v);
        });
      });
      console.log(`Badge filter (exact) "${input.badge}": ${(listings || []).length} → ${filtered.length}`);
    }

    // --- 1c. Series gate: reject cross-generation comps (e.g. LC300 when searching LC70) ---
    if (intentSeries) {
      const beforeSeries = filtered.length;
      filtered = filtered.filter((l: any) => {
        const ls = detectListingSeriesLC(l);
        return ls === null || ls === intentSeries;
      });
      console.log(`Series gate (${intentSeries}): ${beforeSeries} → ${filtered.length}`);
    }

    // --- 2. Load fingerprint data for scoring ---
    const { data: fingerprints } = await sb
      .from("dealer_sales_fingerprints")
      .select("make, model, variant, year_from, year_to, km_from, km_to, count_sold")
      .ilike("make", input.make)
      .ilike("model", `%${input.model}%`)
      .gt("count_sold", 0)
      .limit(100);

    // --- 3. Score and rank ---
    interface ScoredResult {
      listing_id: string;
      make: string;
      model: string;
      variant: string | null;
      year: number;
      km: number | null;
      price: number | null;
      effective_cost: number | null;
      score: number;
      match_reason: string[];
      source: string;
      source_class: string;
      location: string | null;
      state: string | null;
      listing_url: string | null;
      auction_house: string | null;
      drivetrain: string | null;
      fuel: string | null;
      transmission: string | null;
      fingerprint: string | null;
      fingerprint_confidence: number;
      lifecycle_state: string;
      days_listed: number | null;
      is_dealer_grade: boolean | null;
    }

    const results: ScoredResult[] = [];

    for (const l of filtered) {
      const askPrice = l.asking_price != null ? Number(l.asking_price) : null;
      const isAuction = AUCTION_SOURCES.has((l.source || "").toLowerCase());
      const premium = isAuction ? AUCTION_PREMIUM : 0;
      const effectiveCost = askPrice != null ? askPrice + premium + FREIGHT_FLAT : null;

      // --- Scoring logic ---
      let score = 50; // base
      const reasons: string[] = [];

      // Exact make/model match
      if ((l.make || "").toUpperCase() === input.make.toUpperCase()) {
        score += 5;
        reasons.push("EXACT_MAKE");
      }

      // Badge/variant match bonus — when badge is specified, ONLY exact matches are kept
      if (input.badge) {
        const badgeUpper = input.badge.toUpperCase().replace(/[^A-Z0-9]/g, "");
        const variants = [l.variant_raw, l.variant_family, l.variant_used].filter(Boolean);
        const badgeRegex = new RegExp(`(^|[\\s\\-\\/,])${badgeUpper.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s\\-\\/,])`, "i");
        const exactBadge = variants.some((v: string) => {
          const vNorm = v.toUpperCase().replace(/[^A-Z0-9\s\-\/,]/g, "");
          return vNorm === badgeUpper || badgeRegex.test(v);
        });
        if (exactBadge) {
          score += 10;
          reasons.push("EXACT_BADGE");
        } else {
          // BADGE_PARTIAL = not an exact match → exclude entirely when badge was specified
          continue; // skip this listing
        }
      }

      // Year proximity bonus
      if (input.year_min && l.year >= input.year_min) {
        score += 5;
        reasons.push("YEAR_IN_RANGE");
      }

      // Low km bonus
      if (l.km && l.km < 30000) {
        score += 10;
        reasons.push("LOW_KM");
      } else if (l.km && l.km < 60000) {
        score += 5;
        reasons.push("MODERATE_KM");
      }

      // Dealer grade bonus
      if (l.is_dealer_grade) {
        score += 5;
        reasons.push("DEALER_GRADE");
      }

      // Fingerprint match bonus
      if (l.fingerprint && fingerprints && fingerprints.length > 0) {
        const fpMatch = fingerprints.find(fp =>
          fp.make.toUpperCase() === (l.make || "").toUpperCase() &&
          (l.model || "").toUpperCase().includes(fp.model.toUpperCase()) &&
          (!fp.year_from || l.year >= fp.year_from) &&
          (!fp.year_to || l.year <= fp.year_to) &&
          (!fp.km_from || !l.km || l.km >= fp.km_from) &&
          (!fp.km_to || !l.km || l.km <= fp.km_to)
        );
        if (fpMatch) {
          const fpBonus = Math.min(fpMatch.count_sold * 3, 15);
          score += fpBonus;
          reasons.push(`FINGERPRINT_HIT:${fpMatch.count_sold}sold`);
        }
      }

      // Price attractiveness
      if (input.price_max && effectiveCost != null && effectiveCost < input.price_max * 0.85) {
        score += 10;
        reasons.push("PRICE_WELL_UNDER_BUDGET");
      }

      // Freshness bonus
      const daysListed = l.first_seen_at
        ? Math.floor((Date.now() - new Date(l.first_seen_at).getTime()) / 86400000)
        : null;
      if (daysListed !== null && daysListed <= 3) {
        score += 5;
        reasons.push("FRESH_LISTING");
      }

      score = Math.min(score, 100);

      results.push({
        listing_id: l.listing_id,
        make: l.make,
        model: l.model,
        variant: l.variant_used || l.variant_family || l.variant_raw || null,
        year: l.year,
        km: l.km,
        price: askPrice,
        effective_cost: effectiveCost,
        score,
        match_reason: reasons,
        source: l.source,
        source_class: l.source_class,
        location: l.location,
        state: l.state,
        listing_url: l.listing_url,
        auction_house: l.auction_house,
        drivetrain: l.drivetrain,
        fuel: l.fuel,
        transmission: l.transmission,
        fingerprint: l.fingerprint,
        fingerprint_confidence: l.fingerprint_confidence,
        lifecycle_state: l.lifecycle_state,
        days_listed: daysListed,
        is_dealer_grade: l.is_dealer_grade,
      });
    }

    // Sort by score descending, then effective_cost ascending
    results.sort((a, b) => b.score - a.score || (b.effective_cost ?? 0) - (a.effective_cost ?? 0));
    const topResults = results.slice(0, input.limit!);

    // --- 4. Log the request ---
    await sb.from("cron_audit_log").insert({
      cron_name: "ooglebot-search",
      run_date: new Date().toISOString().slice(0, 10),
      success: true,
      result: {
        input: { make: input.make, model: input.model, badge: input.badge, year_min: input.year_min, max_km: input.max_km },
        listings_scanned: (listings || []).length,
        badge_filtered: input.badge ? filtered.length : null,
        results_returned: topResults.length,
      },
    });

    return new Response(
      JSON.stringify({
        status: "ok",
        count: topResults.length,
        results: topResults,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("ooglebot-search error:", err);

    try {
      await sb.from("cron_audit_log").insert({
        cron_name: "ooglebot-search",
        run_date: new Date().toISOString().slice(0, 10),
        success: false,
        error: String(err),
      });
    } catch (_) { /* swallow logging errors */ }

    return new Response(
      JSON.stringify({ status: "error", error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
