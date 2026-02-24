import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Whitelisted domains ──
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

// ── Intent parse schema for OpenClaw ──
const INTENT_SCHEMA = `You are a vehicle search query parser. Return ONLY a JSON object, nothing else.

Schema:
{"make":string|null,"model_keywords":string[],"year_min":number|null,"year_max":number|null,"max_km":number|null,"price_max":number|null}

Rules:
- Uppercase make
- model_keywords is an array of uppercase keywords for the model/variant. E.g. "Toyota HiAce Commuter" → ["HIACE","COMMUTER"]. "Ford Ranger Wildtrak" → ["RANGER","WILDTRAK"].
- A single year like "2024" means year_min=2024, year_max=2024
- A range "2022-2024" means year_min=2022, year_max=2024
- "under 50k" means price_max=50000
- "low km" means max_km=60000
- Use null for anything not specified
- Output raw JSON only. No markdown. No backticks.`;

// ── Listing extraction schema for OpenClaw ──
const EXTRACT_SCHEMA = `You are a vehicle listing data extractor. Given the markdown content of a vehicle listing page, extract structured data. Return ONLY a JSON object.

Schema:
{"title":string|null,"year":number|null,"km":number|null,"price":number|null,"location":string|null}

Rules:
- year: 4-digit year of the vehicle
- km: odometer reading as integer (no commas). If listed as "xxx,xxx km" extract digits only.
- price: asking price as integer (no commas, no $). For auction lots with no price, use null.
- location: city/state if mentioned, otherwise null
- title: the vehicle title/description
- If a field is not found on the page, return null
- Output raw JSON only. No markdown. No backticks.`;

interface ParsedIntent {
  make: string | null;
  model_keywords: string[];
  year_min: number | null;
  year_max: number | null;
  max_km: number | null;
  price_max: number | null;
}

interface OutwardResult {
  source: string;
  title: string | null;
  year: number | null;
  km: number | null;
  price: number | null;
  location: string | null;
  url: string;
  score: number;
}

// ── Call OpenClaw for JSON extraction ──
async function callOpenClaw(
  apiKey: string,
  systemPrompt: string,
  userContent: string,
  timeoutMs = 25000
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(
      "https://consistency-commitments-handed-moms.trycloudflare.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openclaw",
          temperature: 0,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
        }),
        signal: controller.signal,
      }
    );
    if (!res.ok) throw new Error(`OpenClaw ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  } finally {
    clearTimeout(timer);
  }
}

// ── Extract JSON from LLM response ──
function extractJson(raw: string): any {
  let cleaned = raw;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) cleaned = fenced[1].trim();
  else {
    const braced = raw.match(/\{[\s\S]*\}/);
    if (braced) cleaned = braced[0].trim();
  }
  return JSON.parse(cleaned);
}

// ── Score a result deterministically ──
function scoreResult(
  r: { year: number | null; km: number | null; price: number | null },
  intent: ParsedIntent
): number {
  let score = 50;

  // KM: required if max_km set
  if (intent.max_km && r.km != null) {
    if (r.km > intent.max_km) return 0; // disqualified
    score += 20 * (1 - r.km / intent.max_km); // lower km = higher score
  }

  // Year proximity
  if (intent.year_min && r.year != null) {
    if (r.year >= intent.year_min) score += 15;
    else score -= 10 * (intent.year_min - r.year);
  }

  // Price: lower is better
  if (r.price != null && intent.price_max) {
    if (r.price <= intent.price_max) {
      score += 15 * (1 - r.price / intent.price_max);
    } else {
      score -= 10;
    }
  }

  return Math.max(0, Math.round(score));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const openclawKey = (Deno.env.get("OPENCLAW_API_KEY") || "").replace(/[^\x20-\x7E]/g, "").trim();
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");

    if (!openclawKey) {
      return new Response(
        JSON.stringify({ status: "error", error: "OPENCLAW_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
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

    console.log(`[OUTWARD] Instruction: "${instruction}"`);

    // ════════════════════════════════════════
    // STEP A: Parse intent via OpenClaw
    // ════════════════════════════════════════
    const intentRaw = await callOpenClaw(openclawKey, INTENT_SCHEMA, instruction.trim());
    console.log(`[OUTWARD] Intent raw: ${intentRaw}`);

    let intent: ParsedIntent;
    try {
      const parsed = extractJson(intentRaw);
      intent = {
        make: typeof parsed.make === "string" ? parsed.make.trim().toUpperCase() : null,
        model_keywords: Array.isArray(parsed.model_keywords)
          ? parsed.model_keywords.map((k: any) => String(k).trim().toUpperCase()).filter(Boolean)
          : [],
        year_min: typeof parsed.year_min === "number" ? parsed.year_min : null,
        year_max: typeof parsed.year_max === "number" ? parsed.year_max : null,
        max_km: typeof parsed.max_km === "number" ? parsed.max_km : null,
        price_max: typeof parsed.price_max === "number" ? parsed.price_max : null,
      };
    } catch (e) {
      console.error("[OUTWARD] Intent parse failed:", e);
      return new Response(
        JSON.stringify({ status: "error", error: "Failed to parse search intent" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!intent.make) {
      return new Response(
        JSON.stringify({ status: "error", error: "Could not extract vehicle make from query" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[OUTWARD] Parsed intent:`, JSON.stringify(intent));

    // ════════════════════════════════════════
    // STEP B: Search whitelisted domains via Firecrawl
    // ════════════════════════════════════════
    const modelStr = intent.model_keywords.join(" ");
    const yearStr = intent.year_min ? String(intent.year_min) : "";
    const kmStr = intent.max_km ? `${intent.max_km} km` : "";
    const searchTerms = [intent.make, modelStr, yearStr, kmStr].filter(Boolean).join(" ");

    console.log(`[OUTWARD] Search terms: "${searchTerms}"`);

    // Run searches in parallel across all domains
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
          console.log(`[OUTWARD] Search ${domain} failed: ${res.status}`);
          return [];
        }

        const data = await res.json();
        const results = data.data || [];
        console.log(`[OUTWARD] ${domain}: ${results.length} results`);

        return results.map((r: any) => ({
          domain,
          url: r.url || "",
          markdown: r.markdown || "",
          title: r.title || r.metadata?.title || "",
        }));
      } catch (err) {
        console.error(`[OUTWARD] ${domain} error:`, err);
        return [];
      }
    });

    const allSearchResults = (await Promise.all(searchPromises)).flat();
    console.log(`[OUTWARD] Total search results: ${allSearchResults.length}`);

    if (allSearchResults.length === 0) {
      return new Response(
        JSON.stringify({
          status: "ok",
          intent,
          results: [],
          message: "No qualifying vehicles found within current filters.",
          duration_ms: Date.now() - startTime,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ════════════════════════════════════════
    // STEP D: Extract structured fields from each result via OpenClaw
    // ════════════════════════════════════════
    // Use the markdown already returned by Firecrawl search (scrapeOptions included)
    // to avoid extra Firecrawl calls. Parse with OpenClaw.
    const extractPromises = allSearchResults.map(async (sr: any) => {
      // If markdown is too short, skip extraction
      if (!sr.markdown || sr.markdown.length < 50) {
        return null;
      }

      try {
        // Truncate markdown to avoid token limits
        const truncated = sr.markdown.slice(0, 3000);
        const extractRaw = await callOpenClaw(openclawKey, EXTRACT_SCHEMA, truncated, 15000);
        const extracted = extractJson(extractRaw);

        return {
          source: sr.domain,
          title: extracted.title || sr.title || null,
          year: typeof extracted.year === "number" ? extracted.year : null,
          km: typeof extracted.km === "number" ? extracted.km : null,
          price: typeof extracted.price === "number" ? extracted.price : null,
          location: extracted.location || null,
          url: sr.url,
        } as Omit<OutwardResult, "score">;
      } catch (err) {
        console.error(`[OUTWARD] Extract failed for ${sr.url}:`, err);
        // Fallback: use basic regex parsing
        return {
          source: sr.domain,
          title: sr.title || null,
          year: parseYear(sr.markdown),
          km: parseKm(sr.markdown),
          price: parsePrice(sr.markdown),
          location: null,
          url: sr.url,
        } as Omit<OutwardResult, "score">;
      }
    });

    const extracted = (await Promise.all(extractPromises)).filter(Boolean) as Omit<OutwardResult, "score">[];
    console.log(`[OUTWARD] Extracted ${extracted.length} listings`);

    // ════════════════════════════════════════
    // STEP E: Deterministic ranking → top 3
    // ════════════════════════════════════════
    const scored: OutwardResult[] = extracted.map((r) => ({
      ...r,
      score: scoreResult(r, intent),
    }));

    // Filter out disqualified (score 0) and sort
    const ranked = scored
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || (a.price ?? Infinity) - (b.price ?? Infinity));

    // Deduplicate by URL
    const seen = new Set<string>();
    const deduped: OutwardResult[] = [];
    for (const r of ranked) {
      if (!seen.has(r.url)) {
        seen.add(r.url);
        deduped.push(r);
      }
      if (deduped.length >= 3) break;
    }

    console.log(`[OUTWARD] Returning ${deduped.length} results in ${Date.now() - startTime}ms`);

    // ── Log to cron_audit_log ──
    try {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      await sb.from("cron_audit_log").insert({
        cron_name: "run-outward-search",
        run_date: new Date().toISOString().slice(0, 10),
        success: true,
        result: {
          instruction: instruction.trim(),
          intent,
          total_search_results: allSearchResults.length,
          extracted_count: extracted.length,
          returned_count: deduped.length,
          duration_ms: Date.now() - startTime,
        },
      });
    } catch (_) { /* swallow */ }

    return new Response(
      JSON.stringify({
        status: "ok",
        intent,
        results: deduped,
        total_searched: allSearchResults.length,
        duration_ms: Date.now() - startTime,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[OUTWARD] Error:", error);
    return new Response(
      JSON.stringify({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ── Fallback regex parsers ──
function parseYear(text: string): number | null {
  const m = text.match(/\b(20[0-2]\d)\b/);
  return m ? parseInt(m[1], 10) : null;
}

function parsePrice(text: string): number | null {
  const m = text.match(/\$\s*([\d,]+)/);
  if (m) {
    const p = parseInt(m[1].replace(/,/g, ""), 10);
    return p >= 1000 && p <= 500000 ? p : null;
  }
  return null;
}

function parseKm(text: string): number | null {
  const m = text.match(/([\d,]+)\s*(?:km|kms|kilometres)/i);
  if (m) {
    const k = parseInt(m[1].replace(/,/g, ""), 10);
    return k >= 0 && k <= 999999 ? k : null;
  }
  return null;
}
