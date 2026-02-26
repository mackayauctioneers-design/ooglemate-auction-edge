import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ══════════════════════════════════════════════════════════════
// OUTWARD SEARCH v3 — Crawl-Based, Domain-Specific Extraction
//
// Architecture:
//   Structured Intent → Build Source URLs → Crawl Listing Pages
//   → Extract Detail URLs → Fetch Details → JSON Schema Extract
//   → Vehicle Gate → Score → Return
//
// NO search APIs. NO semantic search. NO SEO pages.
// ══════════════════════════════════════════════════════════════

// ── Domain Adapters ──
// Each adapter knows how to:
//   1) Build a search URL from structured intent
//   2) Extract detail page URLs from HTML
//   3) Validate a detail URL pattern

interface DomainAdapter {
  domain: string;
  buildSearchUrl: (intent: ParsedIntent) => string;
  detailUrlPattern: RegExp;
  extractDetailUrls: (html: string, baseUrl: string) => string[];
}

const ADAPTERS: DomainAdapter[] = [
    // ── Carsales ──
  {
    domain: "carsales.com.au",
    buildSearchUrl: (intent) => {
      // Use Carsales browse URL: /cars/MAKE/MODEL/ with query params
      const makeLower = (intent.make || "").toLowerCase();
      // Map model keywords to Carsales URL slugs
      const slugMap: Record<string, string> = {
        "LANDCRUISER": "landcruiser", "HILUX": "hilux", "PRADO": "prado",
        "COROLLA": "corolla", "CAMRY": "camry", "RAV4": "rav4", "HIACE": "hiace",
        "RANGER": "ranger", "EVEREST": "everest", "MUSTANG": "mustang",
        "NAVARA": "navara", "PATROL": "patrol", "XTRAIL": "x-trail",
        "TRITON": "triton", "OUTLANDER": "outlander", "PAJERO": "pajero",
        "CX5": "cx-5", "CX-5": "cx-5", "BT50": "bt-50", "BT-50": "bt-50",
        "COLORADO": "colorado", "AMAROK": "amarok", "DMAX": "d-max", "D-MAX": "d-max",
        "FORTUNER": "fortuner", "KLUGER": "kluger", "SUPRA": "supra",
      };
      let modelSlug = "";
      for (const kw of intent.model_keywords) {
        const mapped = slugMap[kw.toUpperCase()];
        if (mapped) { modelSlug = mapped; break; }
      }
      let url = `https://www.carsales.com.au/cars/${makeLower}/${modelSlug || ""}`;
      // Clean trailing slash
      url = url.replace(/\/+$/, "") + "/";
      const params: string[] = [];
      if (intent.year) { params.push(`year_min=${intent.year}`); params.push(`year_max=${intent.year + 1}`); }
      if (intent.max_km) params.push(`odometer_max=${intent.max_km}`);
      if (intent.price_max) params.push(`price_max=${intent.price_max}`);
      if (params.length) url += "?" + params.join("&");
      return url;
    },
    detailUrlPattern: /carsales\.com\.au\/cars\/details\/[^"'\s]+/i,
    extractDetailUrls: (html, _base) => {
      const urls: string[] = [];
      const seen = new Set<string>();
      // Carsales detail URLs: /cars/details/YEAR-MAKE-MODEL-.../SSE-AD-NNNNNNN
      const re = /href=["']((?:https?:)?\/\/(?:www\.)?carsales\.com\.au\/cars\/details\/[^"'\s]+)/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        let url = m[1];
        if (url.startsWith("//")) url = "https:" + url;
        // Strip query params (sponsored tracking)
        url = url.split("?")[0];
        if (!seen.has(url)) { seen.add(url); urls.push(url); }
      }
      return urls;
    },
  },
  // ── Autotrader ──
  {
    domain: "autotrader.com.au",
    buildSearchUrl: (intent) => {
      const make = (intent.make || "").toLowerCase();
      const model = intent.model_keywords[0]?.toLowerCase() || "";
      let url = `https://www.autotrader.com.au/cars/${make}/${model || "all"}`;
      const params: string[] = [];
      if (intent.year) { params.push(`year_from=${intent.year}`); params.push(`year_to=${intent.year}`); }
      if (intent.max_km) params.push(`odometer_to=${intent.max_km}`);
      if (intent.price_max) params.push(`price_to=${intent.price_max}`);
      if (params.length) url += "?" + params.join("&");
      return url;
    },
    detailUrlPattern: /autotrader\.com\.au\/car\/[^"'\s]+/i,
    extractDetailUrls: (html, _base) => {
      const urls: string[] = [];
      const seen = new Set<string>();
      const re = /href=["']((?:https?:)?\/\/(?:www\.)?autotrader\.com\.au\/car\/[^"'\s]+)/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        let url = m[1];
        if (url.startsWith("//")) url = "https:" + url;
        if (!seen.has(url)) { seen.add(url); urls.push(url); }
      }
      return urls;
    },
  },
  // ── Drive ──
  {
    domain: "drive.com.au",
    buildSearchUrl: (intent) => {
      const make = (intent.make || "").toLowerCase().replace(/\s+/g, "-");
      const model = intent.model_keywords[0]?.toLowerCase().replace(/\s+/g, "-") || "";
      let url = `https://www.drive.com.au/cars-for-sale/${make}/${model}/`;
      const params: string[] = [];
      if (intent.year) params.push(`year_min=${intent.year}`);
      if (intent.max_km) params.push(`km_max=${intent.max_km}`);
      if (intent.price_max) params.push(`price_max=${intent.price_max}`);
      if (params.length) url += "?" + params.join("&");
      return url;
    },
    detailUrlPattern: /drive\.com\.au\/cars-for-sale\/[^/]+\/[^/]+\/\d+/i,
    extractDetailUrls: (html, _base) => {
      const urls: string[] = [];
      const seen = new Set<string>();
      // Drive detail: /cars-for-sale/vehicle/MAKE/MODEL/ID
      const re = /href=["']((?:https?:)?\/\/(?:www\.)?drive\.com\.au\/cars-for-sale\/[^"'\s]*\d{4,}[^"'\s]*)/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        let url = m[1];
        if (url.startsWith("//")) url = "https:" + url;
        if (!seen.has(url)) { seen.add(url); urls.push(url); }
      }
      return urls;
    },
  },
  // ── Carsguide ──
  {
    domain: "carsguide.com.au",
    buildSearchUrl: (intent) => {
      const make = (intent.make || "").toLowerCase().replace(/\s+/g, "-");
      const model = intent.model_keywords[0]?.toLowerCase().replace(/\s+/g, "-") || "";
      let url = `https://www.carsguide.com.au/buy-a-car/${make ? make + "/" : ""}${model ? model + "/" : ""}`;
      const params: string[] = [];
      if (intent.year) { params.push(`year_from=${intent.year}`); params.push(`year_to=${intent.year}`); }
      if (intent.max_km) params.push(`kms_max=${intent.max_km}`);
      if (intent.price_max) params.push(`price_max=${intent.price_max}`);
      if (params.length) url += "?" + params.join("&");
      return url;
    },
    detailUrlPattern: /carsguide\.com\.au\/listing\/\d+/i,
    extractDetailUrls: (html, _base) => {
      const urls: string[] = [];
      const seen = new Set<string>();
      const re = /href=["']((?:https?:)?\/\/(?:www\.)?carsguide\.com\.au\/listing\/\d+[^"'\s]*)/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        let url = m[1];
        if (url.startsWith("//")) url = "https:" + url;
        if (!seen.has(url)) { seen.add(url); urls.push(url); }
      }
      return urls;
    },
  },
  // ── EasyAuto123 ──
  {
    domain: "easyauto123.com.au",
    buildSearchUrl: (intent) => {
      const make = (intent.make || "").toLowerCase().replace(/\s+/g, "-");
      const model = intent.model_keywords[0]?.toLowerCase().replace(/\s+/g, "-") || "";
      let url = `https://www.easyauto123.com.au/cars/${make}/${model}`;
      const params: string[] = [];
      if (intent.year) params.push(`year_min=${intent.year}`);
      if (intent.max_km) params.push(`km_max=${intent.max_km}`);
      if (intent.price_max) params.push(`price_max=${intent.price_max}`);
      if (params.length) url += "?" + params.join("&");
      return url;
    },
    detailUrlPattern: /easyauto123\.com\.au\/car\/\d+/i,
    extractDetailUrls: (html, _base) => {
      const urls: string[] = [];
      const seen = new Set<string>();
      const re = /href=["']((?:https?:)?\/\/(?:www\.)?easyauto123\.com\.au\/car\/\d+[^"'\s]*)/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        let url = m[1];
        if (url.startsWith("//")) url = "https:" + url;
        if (!seen.has(url)) { seen.add(url); urls.push(url); }
      }
      return urls;
    },
  },
];

// ── Intent Parser (deterministic, no LLM) ──
interface ParsedIntent {
  make: string | null;
  model_keywords: string[];
  year: number | null;
  max_km: number | null;
  price_max: number | null;
}

const KNOWN_MAKES = [
  "TOYOTA", "FORD", "HOLDEN", "MAZDA", "NISSAN", "MITSUBISHI",
  "HYUNDAI", "KIA", "SUBARU", "HONDA", "VOLKSWAGEN", "VW",
  "BMW", "MERCEDES", "MERCEDES-BENZ", "AUDI", "LEXUS",
  "ISUZU", "SUZUKI", "JEEP", "LAND ROVER", "LANDROVER",
  "VOLVO", "PEUGEOT", "RENAULT", "SKODA", "FIAT", "TESLA",
  "RAM", "DODGE", "CHEVROLET", "GMC", "HINO", "FUSO",
  "LDV", "GWM", "HAVAL", "MG", "BYD", "GREAT WALL",
  "CHRYSLER", "MINI", "PORSCHE", "JAGUAR", "GENESIS", "CUPRA",
];

const MODEL_TO_MAKE: Record<string, string> = {
  "LANDCRUISER": "TOYOTA", "LAND CRUISER": "TOYOTA", "HILUX": "TOYOTA",
  "CAMRY": "TOYOTA", "COROLLA": "TOYOTA", "RAV4": "TOYOTA", "PRADO": "TOYOTA",
  "HIACE": "TOYOTA", "FORTUNER": "TOYOTA", "KLUGER": "TOYOTA", "YARIS": "TOYOTA",
  "86": "TOYOTA", "SUPRA": "TOYOTA", "AURION": "TOYOTA",
  "RANGER": "FORD", "MUSTANG": "FORD", "EVEREST": "FORD", "FALCON": "FORD",
  "TERRITORY": "FORD", "FOCUS": "FORD", "ESCAPE": "FORD",
  "COMMODORE": "HOLDEN", "COLORADO": "HOLDEN", "CAPTIVA": "HOLDEN",
  "CX-5": "MAZDA", "CX-9": "MAZDA", "CX-3": "MAZDA", "CX-30": "MAZDA",
  "BT-50": "MAZDA", "MX-5": "MAZDA", "CX5": "MAZDA", "CX9": "MAZDA",
  "NAVARA": "NISSAN", "PATROL": "NISSAN", "X-TRAIL": "NISSAN", "XTRAIL": "NISSAN",
  "PATHFINDER": "NISSAN", "QASHQAI": "NISSAN",
  "TRITON": "MITSUBISHI", "OUTLANDER": "MITSUBISHI", "PAJERO": "MITSUBISHI",
  "ASX": "MITSUBISHI", "ECLIPSE CROSS": "MITSUBISHI",
  "TUCSON": "HYUNDAI", "I30": "HYUNDAI", "SANTA FE": "HYUNDAI", "KONA": "HYUNDAI",
  "SPORTAGE": "KIA", "CERATO": "KIA", "SELTOS": "KIA", "CARNIVAL": "KIA",
  "SORENTO": "KIA", "STINGER": "KIA",
  "FORESTER": "SUBARU", "OUTBACK": "SUBARU", "WRX": "SUBARU", "IMPREZA": "SUBARU",
  "CIVIC": "HONDA", "CR-V": "HONDA", "CRV": "HONDA", "HR-V": "HONDA",
  "AMAROK": "VOLKSWAGEN", "GOLF": "VOLKSWAGEN", "TIGUAN": "VOLKSWAGEN",
  "D-MAX": "ISUZU", "DMAX": "ISUZU", "MU-X": "ISUZU", "MUX": "ISUZU",
  "JIMNY": "SUZUKI", "VITARA": "SUZUKI", "SWIFT": "SUZUKI",
  "WRANGLER": "JEEP", "GRAND CHEROKEE": "JEEP", "GLADIATOR": "JEEP",
  "DEFENDER": "LAND ROVER", "DISCOVERY": "LAND ROVER", "RANGE ROVER": "LAND ROVER",
};

function parseInstruction(raw: string): ParsedIntent {
  const input = raw.trim().toUpperCase();
  const tokens = input.split(/\s+/);

  let year: number | null = null;
  const yearMatch = input.match(/\b(20[0-3]\d)\b/);
  if (yearMatch) year = parseInt(yearMatch[1], 10);

  let max_km: number | null = null;
  const kmMatch = input.match(/([\d,]+)\s*(?:klms|klm|kms|km)\b/i);
  if (kmMatch) max_km = parseInt(kmMatch[1].replace(/,/g, ""), 10);
  else if (/\bLOW\s*KM\b/i.test(input)) max_km = 60000;

  let price_max: number | null = null;
  const priceMatch = input.match(/(?:UNDER|BELOW|MAX|BUDGET)\s*\$?\s*([\d,]+)\s*K?\b/i);
  if (priceMatch) {
    let p = parseInt(priceMatch[1].replace(/,/g, ""), 10);
    if (p < 1000) p *= 1000;
    price_max = p;
  }

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

  if (!make) {
    const sortedModels = Object.keys(MODEL_TO_MAKE).sort((a, b) => b.length - a.length);
    for (const model of sortedModels) {
      if (input.includes(model)) { make = MODEL_TO_MAKE[model]; break; }
    }
  }

  const stripPatterns = [
    /\b20[0-3]\d\b/g,
    /(?:UNDER|BELOW|MAX|BUDGET)\s*\$?\s*[\d,]+\s*(?:klms|klm|kms|km|K)?\b/gi,
    /[\d,]+\s*(?:klms|klm|kms|km)\b/gi,
    /\bLOW\s*KM\b/gi,
  ];
  let remaining = input;
  for (const pat of stripPatterns) remaining = remaining.replace(pat, " ");
  if (make) remaining = remaining.replace(new RegExp(`\\b${make.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, "g"), " ");

  const STOP_WORDS = new Set([
    "MODEL", "MODELS", "UNDER", "BELOW", "BUDGET", "MAX", "AUSTRALIA",
    "WIDE", "NATIONALLY", "NATIONAL", "CHEAP", "CHEAPEST", "BEST",
    "WHOLESALE", "FOR", "SALE", "THE", "AND", "WITH", "ANY", "SERIES",
    "DUAL", "CAB", "SINGLE", "EXTRA",
  ]);

  const model_keywords = remaining
    .split(/\s+/)
    .map((t) => t.replace(/[^A-Z0-9-]/g, ""))
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));

  return { make, model_keywords, year, max_km, price_max };
}

// ── Vehicle JSON extraction schema for Firecrawl ──
const VEHICLE_EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Full listing title e.g. '2024 Toyota LandCruiser 79 Series GXL'" },
    year: { type: "integer", description: "Model year (4-digit e.g. 2024)" },
    make: { type: "string", description: "Vehicle manufacturer e.g. Toyota, Ford" },
    model: { type: "string", description: "Vehicle model e.g. LandCruiser, Ranger" },
    variant: { type: "string", description: "Trim/variant e.g. GXL, Wildtrak, SR5" },
    price: { type: "integer", description: "Listed price in AUD (no decimals, no cents)" },
    km: { type: "integer", description: "Odometer reading in kilometres" },
    location: { type: "string", description: "City or state where the vehicle is located" },
    body_type: { type: "string", description: "Body type e.g. Ute, Wagon, Sedan, SUV" },
    transmission: { type: "string", description: "Auto or Manual" },
    engine: { type: "string", description: "Engine description e.g. 4.5L V8 Diesel" },
  },
  required: ["year", "make", "price"],
};

// ── Extracted listing ──
interface ExtractedListing {
  url: string;
  source: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  price: number | null;
  km: number | null;
  location: string | null;
  body_type: string | null;
  transmission: string | null;
  engine: string | null;
  score: number;
}

// ── Scoring ──
function scoreListing(l: ExtractedListing, intent: ParsedIntent): number {
  let score = 50;

  // Completeness bonus
  const fields = [l.year, l.price, l.km, l.model, l.variant].filter(Boolean).length;
  score += fields * 3; // up to +15

  if (intent.max_km && l.km != null) {
    if (l.km > intent.max_km + 10000) return 0;
    score += Math.round(15 * (1 - l.km / (intent.max_km + 10000)));
  }

  if (intent.year && l.year != null) {
    const diff = Math.abs(l.year - intent.year);
    if (diff === 0) score += 15;
    else if (diff === 1) score += 8;
    else if (diff > 2) return 0;
  }

  if (l.price != null && intent.price_max) {
    if (l.price > intent.price_max * 1.15) return 0;
    score += Math.round(10 * (1 - l.price / (intent.price_max * 1.15)));
  }

  return Math.max(0, Math.min(100, score));
}

// ═════════════════════════════════════════════════
// MAIN HANDLER
// ═════════════════════════════════════════════════
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

    // ── DEMAND GATE ──
    const internalCount = typeof internal_count === "number" ? internal_count : 0;
    const jobUrgency = urgency || "normal";
    if (internalCount >= 3 && jobUrgency === "normal") {
      console.log(`[OUTWARD-V3] Gated: ${internalCount} internal matches`);
      return new Response(
        JSON.stringify({
          status: "ok", gated: true,
          reason: `${internalCount} internal matches (threshold <3)`,
          results: [], duration_ms: Date.now() - startTime,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── STEP 1: Parse intent ──
    const intent = parseInstruction(instruction);
    console.log(`[OUTWARD-V3] STRUCTURED_QUERY`, JSON.stringify(intent));

    if (!intent.make) {
      return new Response(
        JSON.stringify({ status: "error", error: "Could not identify vehicle make. Try: '2024 Toyota HiAce Commuter under 40000 km'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── STEP 2: Crawl search pages → extract detail URLs (parallel per adapter) ──
    const MAX_DETAILS_PER_DOMAIN = 3; // credit-conscious
    const pipeline = {
      adapters_tried: 0,
      search_pages_crawled: 0,
      detail_urls_found: 0,
      details_scraped: 0,
      schema_valid: 0,
      constraint_pass: 0,
      returned: 0,
    };

    const detailUrlsByDomain: { adapter: DomainAdapter; urls: string[] }[] = [];

    // Crawl search pages in parallel
    const searchCrawls = ADAPTERS.map(async (adapter) => {
      pipeline.adapters_tried++;
      const searchUrl = adapter.buildSearchUrl(intent);
      console.log(`[OUTWARD-V3] Crawling search: ${searchUrl}`);

      try {
        const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: searchUrl,
            formats: ["html"],
            onlyMainContent: false, // need full HTML to find hrefs
            waitFor: 3000,
          }),
        });

        if (!res.ok) {
          console.log(`[OUTWARD-V3] ${adapter.domain}: search crawl HTTP ${res.status}`);
          return { adapter, urls: [] };
        }

        const data = await res.json();
        const html = data.data?.html || data.html || "";
        pipeline.search_pages_crawled++;

        if (html.length < 200) {
          console.log(`[OUTWARD-V3] ${adapter.domain}: empty HTML (${html.length} bytes)`);
          return { adapter, urls: [] };
        }

        // Filter URLs to only those containing the make in the slug
        const makeSlug = (intent.make || "").toLowerCase().replace(/\s+/g, "-");
        const detailUrls = adapter.extractDetailUrls(html, searchUrl)
          .map(u => u.replace(/&amp;/g, "&"))
          .filter(u => !makeSlug || u.toLowerCase().includes(makeSlug))
          .slice(0, MAX_DETAILS_PER_DOMAIN);

        console.log(`[OUTWARD-V3] ${adapter.domain}: ${detailUrls.length} detail URLs extracted`);
        return { adapter, urls: detailUrls };
      } catch (err) {
        console.error(`[OUTWARD-V3] ${adapter.domain}: search crawl error:`, err);
        return { adapter, urls: [] };
      }
    });

    const crawlResults = await Promise.all(searchCrawls);
    for (const r of crawlResults) {
      if (r.urls.length > 0) {
        detailUrlsByDomain.push(r);
        pipeline.detail_urls_found += r.urls.length;
      }
    }

    console.log(`[OUTWARD-V3] Total detail URLs: ${pipeline.detail_urls_found} from ${detailUrlsByDomain.length} domains`);

    if (pipeline.detail_urls_found === 0) {
      logAudit(intent, instruction, pipeline, Date.now() - startTime, jobUrgency);
      return new Response(
        JSON.stringify({
          status: "ok", intent, results: [],
          message: "No listing detail pages found on target domains.",
          pipeline, duration_ms: Date.now() - startTime,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── STEP 3: Scrape detail pages with JSON extraction (parallel, all domains) ──
    const allDetailUrls = detailUrlsByDomain.flatMap(d =>
      d.urls.map(url => ({ url, domain: d.adapter.domain }))
    );

    // Limit total scrapes to control credits
    const MAX_TOTAL_SCRAPES = 8;
    const toScrape = allDetailUrls.slice(0, MAX_TOTAL_SCRAPES);

    const detailScrapes = toScrape.map(async ({ url, domain }) => {
      try {
        const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url,
            formats: ["extract"],
            extract: {
              schema: VEHICLE_EXTRACT_SCHEMA,
              prompt: "Extract the vehicle listing details from this page. Return year as a 4-digit number, price in AUD as integer, km as integer.",
            },
            onlyMainContent: true,
            waitFor: 2000,
          }),
        });

        if (!res.ok) {
          console.log(`[OUTWARD-V3] Detail scrape failed: ${url} (${res.status})`);
          return null;
        }

        const data = await res.json();
        const json = data.data?.extract || data.extract || data.data?.json || data.json || null;
        pipeline.details_scraped++;

        if (!json) {
          console.log(`[OUTWARD-V3] No JSON extracted from: ${url}`);
          return null;
        }

        console.log(`[OUTWARD-V3] Extracted from ${url}:`, JSON.stringify(json));

        return {
          url,
          source: domain,
          title: json.title || null,
          year: typeof json.year === "number" ? json.year : null,
          make: json.make || null,
          model: json.model || null,
          variant: json.variant || null,
          price: typeof json.price === "number" ? json.price : null,
          km: typeof json.km === "number" ? json.km : null,
          location: json.location || null,
          body_type: json.body_type || null,
          transmission: json.transmission || null,
          engine: json.engine || null,
          score: 0,
        } as ExtractedListing;
      } catch (err) {
        console.error(`[OUTWARD-V3] Detail scrape error (${url}):`, err);
        return null;
      }
    });

    const detailResults = (await Promise.all(detailScrapes)).filter(Boolean) as ExtractedListing[];
    console.log(`[OUTWARD-V3] Details scraped: ${detailResults.length}`);

    // ── STEP 4: Vehicle schema gate ──
    const schemaValid = detailResults.filter(l => {
      if (!l.year) return false;
      if (l.price != null && l.price > 0 && l.price < 3000) return false;
      // Make must match intent
      if (intent.make && l.make && !l.make.toUpperCase().includes(intent.make)) return false;
      // Model must contain at least one model keyword from intent
      if (intent.model_keywords.length > 0 && l.model) {
        const modelUpper = (l.model + " " + (l.title || "")).toUpperCase();
        const hasModelMatch = intent.model_keywords.some(kw => modelUpper.includes(kw));
        if (!hasModelMatch) {
          console.log(`[OUTWARD-V3] Model mismatch: "${l.model}" vs keywords [${intent.model_keywords.join(",")}]`);
          return false;
        }
      }
      return true;
    });
    pipeline.schema_valid = schemaValid.length;
    console.log(`[OUTWARD-V3] Schema valid: ${schemaValid.length}`);

    // ── STEP 5: Constraint filter ──
    const constrained = schemaValid.filter(l => {
      if (intent.year && l.year != null && Math.abs(l.year - intent.year) > 2) return false;
      if (intent.max_km && l.km != null && l.km > intent.max_km + 10000) return false;
      if (intent.price_max && l.price != null && l.price > intent.price_max * 1.15) return false;
      return true;
    });
    pipeline.constraint_pass = constrained.length;
    console.log(`[OUTWARD-V3] Constraint pass: ${constrained.length}`);

    // ── STEP 6: Score & rank ──
    const scored = constrained
      .map(l => ({ ...l, score: scoreListing(l, intent) }))
      .filter(l => l.score > 0)
      .sort((a, b) => b.score - a.score || (a.price ?? Infinity) - (b.price ?? Infinity));

    // Deduplicate
    const seen = new Set<string>();
    const top: ExtractedListing[] = [];
    for (const r of scored) {
      if (!seen.has(r.url)) { seen.add(r.url); top.push(r); }
      if (top.length >= 5) break;
    }
    pipeline.returned = top.length;

    console.log(`[OUTWARD-V3] FINAL: ${top.length} results`);
    console.log(`[OUTWARD-V3] TOP_RESULTS:`, JSON.stringify(top.map(r => ({
      url: r.url, year: r.year, make: r.make, model: r.model,
      price: r.price, km: r.km, score: r.score, source: r.source,
    }))));

    logAudit(intent, instruction, pipeline, Date.now() - startTime, jobUrgency);

    return new Response(
      JSON.stringify({
        status: "ok", intent, results: top, pipeline,
        duration_ms: Date.now() - startTime,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[OUTWARD-V3] Error:", error);
    return new Response(
      JSON.stringify({ status: "error", error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ── Audit logger ──
function logAudit(
  intent: ParsedIntent,
  instruction: string,
  pipeline: Record<string, number>,
  durationMs: number,
  urgency: string,
) {
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    sb.from("cron_audit_log").insert({
      cron_name: "run-outward-search-v3",
      run_date: new Date().toISOString().slice(0, 10),
      success: true,
      result: { instruction: instruction.trim(), intent, pipeline, duration_ms: durationMs, urgency },
    }).then(() => {});
  } catch (_) { /* swallow */ }
}
