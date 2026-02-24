import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ══════════════════════════════════════════
// WHITELISTED DOMAINS — no free browsing
// ══════════════════════════════════════════
const WHITELISTED_DOMAINS = [
  "pickles.com.au",
  "grays.com",
  "manheim.com.au",
  "slatteryauctions.com.au",
  "lloydsauctions.com.au",
  "carsales.com.au",
  "autotrader.com.au",
  "drive.com.au",
  "carsguide.com.au",
  "easyauto123.com.au",
];

// ══════════════════════════════════════════
// KNOWN MAKES — dictionary match
// ══════════════════════════════════════════
const KNOWN_MAKES = [
  "TOYOTA", "FORD", "HOLDEN", "MAZDA", "NISSAN", "MITSUBISHI",
  "HYUNDAI", "KIA", "SUBARU", "HONDA", "VOLKSWAGEN", "VW",
  "BMW", "MERCEDES", "MERCEDES-BENZ", "AUDI", "LEXUS",
  "ISUZU", "SUZUKI", "JEEP", "LAND ROVER", "LANDROVER",
  "VOLVO", "PEUGEOT", "RENAULT", "SKODA", "FIAT", "TESLA",
  "RAM", "DODGE", "CHEVROLET", "GMC", "HINO", "FUSO",
  "IVECO", "MAN", "SCANIA", "KENWORTH", "MACK",
  "LDV", "GWM", "HAVAL", "MG", "BYD", "GREAT WALL",
  "CHRYSLER", "CITROEN", "MINI", "PORSCHE", "JAGUAR",
  "BENTLEY", "ROLLS ROYCE", "FERRARI", "LAMBORGHINI",
  "MASERATI", "ALFA ROMEO", "GENESIS", "CUPRA", "SEAT",
];

// ══════════════════════════════════════════
// STEP 1: Deterministic intent parser (NO AI)
// ══════════════════════════════════════════
interface ParsedIntent {
  make: string | null;
  model_keywords: string[];
  year: number | null;
  max_km: number | null;
  price_max: number | null;
}

function parseInstruction(raw: string): ParsedIntent {
  const input = raw.trim().toUpperCase();
  const tokens = input.split(/\s+/);

  // Year: first 4-digit number 2000–2030
  let year: number | null = null;
  const yearMatch = input.match(/\b(20[0-3]\d)\b/);
  if (yearMatch) year = parseInt(yearMatch[1], 10);

  // Max KM: number before "km" or "kms"
  let max_km: number | null = null;
  const kmMatch = input.match(/([\d,]+)\s*(?:km|kms)\b/i);
  if (kmMatch) {
    max_km = parseInt(kmMatch[1].replace(/,/g, ""), 10);
  } else if (/\bLOW\s*KM\b/i.test(input)) {
    max_km = 60000;
  }

  // Price max: "under $XX,XXX" or "under XXk" or "under XXXXX" or "budget $XX,XXX"
  let price_max: number | null = null;
  const priceMatch = input.match(/(?:UNDER|BELOW|MAX|BUDGET)\s*\$?\s*([\d,]+)\s*K?\b/i);
  if (priceMatch) {
    let p = parseInt(priceMatch[1].replace(/,/g, ""), 10);
    if (p < 1000) p *= 1000; // "50k" → 50000
    price_max = p;
  }

  // Make: dictionary match against tokens
  let make: string | null = null;
  let makeTokenCount = 0;
  for (const known of KNOWN_MAKES) {
    const knownParts = known.split(/\s+/);
    // Check if consecutive tokens match
    for (let i = 0; i <= tokens.length - knownParts.length; i++) {
      const slice = tokens.slice(i, i + knownParts.length).join(" ");
      if (slice === known) {
        make = known === "VW" ? "VOLKSWAGEN" : known === "LANDROVER" ? "LAND ROVER" : known;
        makeTokenCount = knownParts.length;
        break;
      }
    }
    if (make) break;
  }

  // Model keywords: everything that's NOT year, km phrase, price phrase, or make
  const stripPatterns = [
    /\b20[0-3]\d\b/g,                            // year
    /[\d,]+\s*(?:km|kms)\b/gi,                    // km
    /(?:UNDER|BELOW|MAX|BUDGET)\s*\$?\s*[\d,]+\s*K?\b/gi, // price
    /\bLOW\s*KM\b/gi,                              // "low km"
  ];

  let remaining = input;
  for (const pat of stripPatterns) {
    remaining = remaining.replace(pat, " ");
  }
  // Remove make tokens
  if (make) {
    remaining = remaining.replace(new RegExp(`\\b${make.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, "g"), " ");
  }

  const model_keywords = remaining
    .split(/\s+/)
    .map((t) => t.replace(/[^A-Z0-9-]/g, ""))
    .filter((t) => t.length >= 2);

  return { make, model_keywords, year, max_km, price_max };
}

// ══════════════════════════════════════════
// STEP 3: Deterministic field extraction (NO AI)
// ══════════════════════════════════════════
interface ExtractedListing {
  url: string;
  source: string;
  title: string | null;
  year: number | null;
  km: number | null;
  price: number | null;
  location: string | null;
}

function extractFromMarkdown(markdown: string, url: string, domain: string, titleHint: string): ExtractedListing {
  const text = markdown || "";

  // Title: use metadata title or first heading
  let title = titleHint || null;
  if (!title) {
    const h1 = text.match(/^#\s+(.+)$/m);
    if (h1) title = h1[1].trim();
  }

  // Year: first 4-digit 2000-2030
  let year: number | null = null;
  const yearM = text.match(/\b(20[0-3]\d)\b/);
  if (yearM) year = parseInt(yearM[1], 10);

  // Price: $XX,XXX pattern — take the first reasonable one
  let price: number | null = null;
  const priceMatches = [...text.matchAll(/\$\s*([\d,]+(?:\.\d{2})?)/g)];
  for (const pm of priceMatches) {
    const p = parseInt(pm[1].replace(/[,\.]/g, "").slice(0, -2) || pm[1].replace(/,/g, ""), 10);
    const clean = parseInt(pm[1].replace(/,/g, "").replace(/\.\d+$/, ""), 10);
    if (clean >= 1000 && clean <= 500000) {
      price = clean;
      break;
    }
  }

  // KM: XX,XXX km
  let km: number | null = null;
  const kmM = text.match(/([\d,]+)\s*(?:km|kms|kilometres|kilometers)/i);
  if (kmM) {
    const k = parseInt(kmM[1].replace(/,/g, ""), 10);
    if (k >= 0 && k <= 999999) km = k;
  }

  // Location: AU state codes
  let location: string | null = null;
  const stateM = text.match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/i);
  if (stateM) location = stateM[1].toUpperCase();

  return { url, source: domain, title, year, km, price, location };
}

// ══════════════════════════════════════════
// STEP 5: Deterministic scoring (NO AI)
// ══════════════════════════════════════════
function scoreListing(listing: ExtractedListing, intent: ParsedIntent): number {
  let score = 50;

  // KM filter: disqualify if over max + 10k tolerance
  if (intent.max_km && listing.km != null) {
    if (listing.km > intent.max_km + 10000) return 0;
    // Reward lower km
    score += Math.round(20 * (1 - listing.km / (intent.max_km + 10000)));
  }

  // Year proximity: ±1 year tolerance
  if (intent.year && listing.year != null) {
    const diff = Math.abs(listing.year - intent.year);
    if (diff === 0) score += 15;
    else if (diff === 1) score += 8;
    else if (diff > 2) return 0; // too far
  }

  // Price: lower is better
  if (listing.price != null && intent.price_max) {
    if (listing.price > intent.price_max) score -= 15;
    else score += Math.round(15 * (1 - listing.price / intent.price_max));
  }

  // Bonus: has all key fields
  if (listing.price != null && listing.km != null && listing.year != null) {
    score += 5;
  }

  return Math.max(0, Math.min(100, score));
}

// ══════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════
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

    const { instruction } = await req.json();
    if (!instruction || typeof instruction !== "string" || !instruction.trim()) {
      return new Response(
        JSON.stringify({ status: "error", error: "instruction is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[OUTWARD-V1] Instruction: "${instruction}"`);

    // ── STEP 1: Parse intent mechanically ──
    const intent = parseInstruction(instruction);
    console.log(`[OUTWARD-V1] Parsed:`, JSON.stringify(intent));

    if (!intent.make) {
      return new Response(
        JSON.stringify({ status: "error", error: "Could not identify vehicle make. Try: '2024 Toyota HiAce Commuter under 40000 km'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── STEP 2: Build search queries per domain ──
    const searchTerms = [
      intent.year ? String(intent.year) : "",
      intent.make,
      ...intent.model_keywords,
      intent.max_km ? `${intent.max_km} km` : "",
    ].filter(Boolean).join(" ");

    console.log(`[OUTWARD-V1] Search terms: "${searchTerms}"`);

    // Run all domain searches in parallel
    const searchPromises = WHITELISTED_DOMAINS.map(async (domain) => {
      const query = `site:${domain} ${searchTerms}`;
      try {
        const res = await fetch("https://api.firecrawl.dev/v1/search", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query,
            limit: 5,
            scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
          }),
        });

        if (!res.ok) {
          const body = await res.text();
          console.log(`[OUTWARD-V1] ${domain} search failed: ${res.status} ${body.slice(0, 100)}`);
          return [];
        }

        const data = await res.json();
        const results = data.data || [];
        console.log(`[OUTWARD-V1] ${domain}: ${results.length} results`);

        return results.map((r: any) => ({
          domain,
          url: r.url || "",
          markdown: r.markdown || "",
          title: r.title || r.metadata?.title || "",
        }));
      } catch (err) {
        console.error(`[OUTWARD-V1] ${domain} error:`, err);
        return [];
      }
    });

    const rawResults = (await Promise.all(searchPromises)).flat();
    console.log(`[OUTWARD-V1] Total raw results: ${rawResults.length}`);

    if (rawResults.length === 0) {
      logAudit(intent, instruction, 0, 0, 0, Date.now() - startTime);
      return new Response(
        JSON.stringify({
          status: "ok",
          intent,
          results: [],
          message: "No qualifying vehicles found within current filters.",
          total_searched: 0,
          duration_ms: Date.now() - startTime,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── STEP 3: Extract fields mechanically ──
    const listings: ExtractedListing[] = rawResults
      .filter((r: any) => r.markdown && r.markdown.length >= 30)
      .map((r: any) => extractFromMarkdown(r.markdown, r.url, r.domain, r.title));

    console.log(`[OUTWARD-V1] Extracted ${listings.length} listings`);

    // ── STEP 4: Filter ──
    const filtered = listings.filter((l) => {
      // Must have price (discard if missing)
      if (l.price == null) return false;
      // Year tolerance ±1
      if (intent.year && l.year != null && Math.abs(l.year - intent.year) > 2) return false;
      // KM tolerance +10k
      if (intent.max_km && l.km != null && l.km > intent.max_km + 10000) return false;
      return true;
    });

    console.log(`[OUTWARD-V1] After filter: ${filtered.length} listings`);

    // ── STEP 5: Score & rank ──
    const scored = filtered
      .map((l) => ({ ...l, score: scoreListing(l, intent) }))
      .filter((l) => l.score > 0)
      .sort((a, b) => b.score - a.score || (a.price ?? Infinity) - (b.price ?? Infinity));

    // Deduplicate by URL
    const seen = new Set<string>();
    const top3: (ExtractedListing & { score: number })[] = [];
    for (const r of scored) {
      if (!seen.has(r.url)) {
        seen.add(r.url);
        top3.push(r);
      }
      if (top3.length >= 3) break;
    }

    console.log(`[OUTWARD-V1] Returning ${top3.length} results in ${Date.now() - startTime}ms`);

    // ── Audit log ──
    logAudit(intent, instruction, rawResults.length, filtered.length, top3.length, Date.now() - startTime);

    return new Response(
      JSON.stringify({
        status: "ok",
        intent,
        results: top3,
        total_searched: rawResults.length,
        total_filtered: filtered.length,
        duration_ms: Date.now() - startTime,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[OUTWARD-V1] Error:", error);
    return new Response(
      JSON.stringify({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ── Audit logger (fire-and-forget) ──
function logAudit(
  intent: ParsedIntent,
  instruction: string,
  searched: number,
  filtered: number,
  returned: number,
  durationMs: number,
) {
  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    sb.from("cron_audit_log").insert({
      cron_name: "run-outward-search",
      run_date: new Date().toISOString().slice(0, 10),
      success: true,
      result: { instruction: instruction.trim(), intent, searched, filtered, returned, duration_ms: durationMs },
    }).then(() => {});
  } catch (_) { /* swallow */ }
}
