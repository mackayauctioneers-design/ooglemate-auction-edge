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

// Stop-words: conversational filler that should never become model keywords
const STOP_WORDS = new Set([
  "SEARCH", "FOR", "FIND", "SHOW", "ME", "GET", "WANT", "NEED", "LOOKING",
  "UNDER", "BELOW", "ABOVE", "OVER", "AROUND", "ABOUT", "BETWEEN",
  "MODEL", "MUST", "BE", "THE", "AND", "OR", "WITH", "WITHOUT",
  "ANY", "ALL", "SOME", "NO", "NOT", "FROM", "THAT", "THIS",
  "AUSTRALIA", "WIDE", "NATIONALLY", "NATIONAL", "CHEAP", "CHEAPEST", "BEST",
  "WHOLESALE", "DEALER", "BUY", "SELL", "PRICE", "BUDGET", "MAX", "LOW",
  "KM", "KMS", "KILOMETRES", "KILOMETERS",
]);

function parseInstruction(raw: string): ParsedIntent {
  const input = raw.trim().toUpperCase();
  const tokens = input.split(/\s+/);

  // Year: first 4-digit number 2000–2030
  let year: number | null = null;
  const yearMatch = input.match(/\b(20[0-3]\d)\b/);
  if (yearMatch) year = parseInt(yearMatch[1], 10);

  // Max KM: number before "km" or "kms" (checked FIRST to prevent price collision)
  let max_km: number | null = null;
  const kmMatch = input.match(/([\d,]+)\s*(?:km|kms)\b/i);
  if (kmMatch) {
    max_km = parseInt(kmMatch[1].replace(/,/g, ""), 10);
  } else if (/\bLOW\s*KM\b/i.test(input)) {
    max_km = 60000;
  }

  // Price max: "under $XX,XXX" or "under XXk" — but NOT if the number is followed by "km"
  let price_max: number | null = null;
  const priceMatch = input.match(/(?:UNDER|BELOW|MAX|BUDGET)\s*\$?\s*([\d,]+)\s*K?\b/i);
  if (priceMatch) {
    // Check if this number is actually a km value (number followed by "km")
    const priceNumStr = priceMatch[1];
    const afterMatch = input.slice(input.indexOf(priceMatch[0]) + priceMatch[0].length).trimStart();
    const isKmValue = /^(?:km|kms)\b/i.test(afterMatch);
    if (!isKmValue) {
      let p = parseInt(priceNumStr.replace(/,/g, ""), 10);
      if (p < 1000) p *= 1000;
      price_max = p;
    }
  }

  // Make: dictionary match against tokens
  let make: string | null = null;
  for (const known of KNOWN_MAKES) {
    const knownParts = known.split(/\s+/);
    for (let i = 0; i <= tokens.length - knownParts.length; i++) {
      const slice = tokens.slice(i, i + knownParts.length).join(" ");
      if (slice === known) {
        make = known === "VW" ? "VOLKSWAGEN" : known === "LANDROVER" ? "LAND ROVER" : known;
        break;
      }
    }
    if (make) break;
  }

  // Model keywords: strip noise, then filter stop-words
  const stripPatterns = [
    /\b20[0-3]\d\b/g,
    /(?:UNDER|BELOW|MAX|BUDGET)\s*\$?\s*[\d,]+\s*K?\s*(?:km|kms)?\b/gi,
    /[\d,]+\s*(?:km|kms)\b/gi,
    /\bLOW\s*KM\b/gi,
  ];

  let remaining = input;
  for (const pat of stripPatterns) {
    remaining = remaining.replace(pat, " ");
  }
  if (make) {
    remaining = remaining.replace(new RegExp(`\\b${make.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, "g"), " ");
  }

  const model_keywords = remaining
    .split(/\s+/)
    .map((t) => t.replace(/[^A-Z0-9-]/g, ""))
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));

  return { make, model_keywords, year, max_km, price_max };
}

// ══════════════════════════════════════════
// Firecrawl JSON extraction schema for vehicle listings

// ══════════════════════════════════════════
// Extracted listing interface (same as before)
// ══════════════════════════════════════════
interface ExtractedListing {
  url: string;
  source: string;
  title: string | null;
  year: number | null;
  km: number | null;
  price: number | null;
  location: string | null;
  variant: string | null;
}

// ══════════════════════════════════════════
// Scoring (unchanged deterministic logic)
// ══════════════════════════════════════════
function scoreListing(listing: ExtractedListing, intent: ParsedIntent): number {
  let score = 50;

  if (intent.max_km && listing.km != null) {
    if (listing.km > intent.max_km + 10000) return 0;
    score += Math.round(20 * (1 - listing.km / (intent.max_km + 10000)));
  }

  if (intent.year && listing.year != null) {
    const diff = Math.abs(listing.year - intent.year);
    if (diff === 0) score += 15;
    else if (diff === 1) score += 8;
    else if (diff > 2) return 0;
  }

  if (listing.price != null && intent.price_max) {
    if (listing.price > intent.price_max) score -= 15;
    else score += Math.round(15 * (1 - listing.price / intent.price_max));
  }

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

    const body = await req.json();
    const { instruction, internal_count, urgency } = body;

    if (!instruction || typeof instruction !== "string" || !instruction.trim()) {
      return new Response(
        JSON.stringify({ status: "error", error: "instruction is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── DEMAND GATE: only fire if internal supply is low OR urgency is high ──
    const internalCount = typeof internal_count === "number" ? internal_count : 0;
    const jobUrgency = urgency || "normal";

    if (internalCount >= 3 && jobUrgency === "normal") {
      console.log(`[OUTWARD-V2] Skipped: ${internalCount} internal matches, urgency=${jobUrgency}`);
      return new Response(
        JSON.stringify({
          status: "ok",
          gated: true,
          reason: `Skipped outward search: ${internalCount} internal matches available (threshold: <3 or urgency high/urgent)`,
          results: [],
          duration_ms: Date.now() - startTime,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[OUTWARD-V2] Instruction: "${instruction}" | internal=${internalCount} urgency=${jobUrgency}`);

    // ── STEP 1: Parse intent mechanically ──
    const intent = parseInstruction(instruction);
    console.log(`[OUTWARD-V2] Parsed:`, JSON.stringify(intent));

    if (!intent.make) {
      return new Response(
        JSON.stringify({ status: "error", error: "Could not identify vehicle make. Try: '2024 Toyota HiAce Commuter under 40000 km'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── STEP 2: Build search queries & fire with JSON extraction ──
    const searchTerms = [
      intent.year ? String(intent.year) : "",
      intent.make,
      ...intent.model_keywords,
      intent.max_km ? `under ${intent.max_km} km` : "",
    ].filter(Boolean).join(" ");

    console.log(`[OUTWARD-V2] Search terms: "${searchTerms}"`);

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
            scrapeOptions: {
              formats: ["markdown"],
              onlyMainContent: true,
            },
          }),
        });

        if (!res.ok) {
          const errBody = await res.text();
          console.log(`[OUTWARD-V2] ${domain} search failed: ${res.status} ${errBody.slice(0, 100)}`);
          return [];
        }

        const data = await res.json();
        const results = data.data || [];
        console.log(`[OUTWARD-V2] ${domain}: ${results.length} results`);

        // Extract fields from markdown results
        const extracted: ExtractedListing[] = [];
        for (const r of results) {
          const pageUrl = r.url || "";
          const md = r.markdown || "";
          if (md.length >= 30) {
            extracted.push(extractFromMarkdownFallback(md, pageUrl, domain, r.title || r.metadata?.title || ""));
          }
        }

        return extracted;
      } catch (err) {
        console.error(`[OUTWARD-V2] ${domain} error:`, err);
        return [];
      }
    });

    const rawResults = (await Promise.all(searchPromises)).flat();
    console.log(`[OUTWARD-V2] Total extracted: ${rawResults.length}`);

    if (rawResults.length === 0) {
      logAudit(intent, instruction, 0, 0, 0, Date.now() - startTime, jobUrgency);
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

    // ── STEP 3: Filter ──
    const filtered = rawResults.filter((l) => {
      if (l.price == null) return false;
      if (intent.year && l.year != null && Math.abs(l.year - intent.year) > 2) return false;
      if (intent.max_km && l.km != null && l.km > intent.max_km + 10000) return false;
      return true;
    });

    console.log(`[OUTWARD-V2] After filter: ${filtered.length} listings`);

    // ── STEP 4: Score & rank ──
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

    console.log(`[OUTWARD-V2] Returning ${top3.length} results in ${Date.now() - startTime}ms`);

    logAudit(intent, instruction, rawResults.length, filtered.length, top3.length, Date.now() - startTime, jobUrgency);

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
    console.error("[OUTWARD-V2] Error:", error);
    return new Response(
      JSON.stringify({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ══════════════════════════════════════════
// Markdown fallback extractor (last resort if JSON extraction fails)
// ══════════════════════════════════════════
function extractFromMarkdownFallback(markdown: string, url: string, domain: string, titleHint: string): ExtractedListing {
  const text = markdown || "";

  let title = titleHint || null;
  if (!title) {
    const h1 = text.match(/^#\s+(.+)$/m);
    if (h1) title = h1[1].trim();
  }

  let year: number | null = null;
  const yearM = text.match(/\b(20[0-3]\d)\b/);
  if (yearM) year = parseInt(yearM[1], 10);

  let price: number | null = null;
  const priceMatches = [...text.matchAll(/\$\s*([\d,]+(?:\.\d{2})?)/g)];
  for (const pm of priceMatches) {
    const clean = parseInt(pm[1].replace(/,/g, "").replace(/\.\d+$/, ""), 10);
    if (clean >= 1000 && clean <= 500000) {
      price = clean;
      break;
    }
  }

  let km: number | null = null;
  const kmM = text.match(/([\d,]+)\s*(?:km|kms|kilometres|kilometers)/i);
  if (kmM) {
    const k = parseInt(kmM[1].replace(/,/g, ""), 10);
    if (k >= 0 && k <= 999999) km = k;
  }

  let location: string | null = null;
  const stateM = text.match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/i);
  if (stateM) location = stateM[1].toUpperCase();

  return { url, source: domain, title, year, km, price, location, variant: null };
}

// ── Audit logger (fire-and-forget) ──
function logAudit(
  intent: ParsedIntent,
  instruction: string,
  searched: number,
  filtered: number,
  returned: number,
  durationMs: number,
  urgency: string,
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
      result: { instruction: instruction.trim(), intent, searched, filtered, returned, duration_ms: durationMs, urgency },
    }).then(() => {});
  } catch (_) { /* swallow */ }
}
