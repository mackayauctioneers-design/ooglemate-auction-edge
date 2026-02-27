import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ══════════════════════════════════════════════════════════════
// OUTWARD SEARCH v4 — Crawl-Based, Domain-Specific Extraction
//
// Fixes from v3:
//   1. Search pages scraped as HTML (not markdown), onlyMainContent=false
//   2. Firecrawl extract mode on detail pages with schema
//   3. Concurrency limiter (mapLimit) — max 3 parallel detail scrapes
//   4. Proper normalizeExtract + toInt/toStr helpers
//   5. Graceful degradation when search pages return thin/empty HTML
// ══════════════════════════════════════════════════════════════

// ── Concurrency limiter ──
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (true) {
      const current = index++;
      if (current >= items.length) break;
      results[current] = await fn(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ── Normalizer helpers ──
function toInt(x: any): number | null {
  if (x == null) return null;
  if (typeof x === "number" && Number.isFinite(x)) return Math.round(x);
  const n = parseInt(String(x).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function toStr(x: any): string | null {
  if (x == null) return null;
  const s = String(x).trim();
  return s ? s : null;
}

// ── Firecrawl: scrape search page as HTML ──
async function firecrawlScrapeHtml(
  url: string,
  firecrawlKey: string,
): Promise<string | null> {
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${firecrawlKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ["html"],
      onlyMainContent: false,
      waitFor: 1500,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.log(
      `[OUTWARD-V4] Firecrawl scrape failed ${res.status} ${url} :: ${txt.slice(0, 200)}`,
    );
    return null;
  }

  const json = await res.json();
  const html = json?.data?.html ?? json?.html ?? null;
  return typeof html === "string" && html.length > 100 ? html : null;
}

// ── Firecrawl: extract vehicle JSON from detail page ──
async function firecrawlExtractVehicle(
  url: string,
  firecrawlKey: string,
): Promise<any | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${firecrawlKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        url,
        formats: ["html"],
        extract: {
          schema: VEHICLE_EXTRACT_SCHEMA,
          prompt:
            "Extract the vehicle listing details from this page. Return year as a 4-digit number, price in AUD as integer, km as integer.",
        },
        onlyMainContent: true,
        waitFor: 2000,
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.log(
        `[OUTWARD-V4] Firecrawl extract failed ${res.status} ${url} :: ${txt.slice(0, 200)}`,
      );
      return null;
    }

    const json = await res.json();
    const extracted = json?.data?.extract ?? null;
    if (!extracted || typeof extracted !== "object") {
      const preview = JSON.stringify(json).slice(0, 300);
      console.log(`[OUTWARD-V4] Unexpected extract payload from ${url}: ${preview}`);
      return null;
    }
    return extracted;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      console.log(`[OUTWARD-V4] Detail scrape timeout (25s): ${url}`);
    } else {
      console.log(`[OUTWARD-V4] Detail scrape error: ${url} :: ${e}`);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Domain Adapters ──
interface DomainAdapter {
  domain: string;
  buildSearchUrl: (intent: ParsedIntent) => string;
  detailUrlPattern: RegExp;
  extractDetailUrls: (html: string, baseUrl: string) => string[];
  searchPageMarker: string; // semantic marker to validate search page rendered
}

const ADAPTERS: DomainAdapter[] = [
  // ── Carsales ──
  {
    domain: "carsales.com.au",
    searchPageMarker: "/cars/details/",
    buildSearchUrl: (intent) => {
      // Use path-based URL for known models (more reliable than q= text search)
      const makeLower = (intent.make || "").toLowerCase();
      const slugMap: Record<string, string> = {
        "LANDCRUISER": "landcruiser", "LAND CRUISER": "landcruiser",
        "HILUX": "hilux", "PRADO": "prado", "COROLLA": "corolla",
        "CAMRY": "camry", "RAV4": "rav4", "HIACE": "hiace",
        "RANGER": "ranger", "EVEREST": "everest", "MUSTANG": "mustang",
        "NAVARA": "navara", "PATROL": "patrol", "XTRAIL": "x-trail",
        "X-TRAIL": "x-trail", "TRITON": "triton", "OUTLANDER": "outlander",
        "PAJERO": "pajero", "CX5": "cx-5", "CX-5": "cx-5",
        "BT50": "bt-50", "BT-50": "bt-50", "COLORADO": "colorado",
        "AMAROK": "amarok", "DMAX": "d-max", "D-MAX": "d-max",
        "FORTUNER": "fortuner", "KLUGER": "kluger", "SUPRA": "supra",
        "TUCSON": "tucson", "SPORTAGE": "sportage", "FORESTER": "forester",
        "CIVIC": "civic", "WRANGLER": "wrangler", "JIMNY": "jimny",
      };
      // Find slug from model keywords
      let modelSlug = "";
      for (const kw of intent.model_keywords) {
        const mapped = slugMap[kw.toUpperCase()];
        if (mapped) { modelSlug = mapped; break; }
      }
      // Fallback: use text query if no slug match
      if (!modelSlug && intent.model_keywords.length > 0) {
        const q = [makeLower, ...intent.model_keywords.map(k => k.toLowerCase())].join("+");
        let url = `https://www.carsales.com.au/cars/?q=${q}`;
        if (intent.year) url += `&year_min=${intent.year}&year_max=${intent.year + 1}`;
        if (intent.max_km) url += `&odometer_max=${intent.max_km}`;
        if (intent.price_max) url += `&price_max=${intent.price_max}`;
        return url;
      }
      let url = `https://www.carsales.com.au/cars/${makeLower}/${modelSlug}/`;
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
      const re =
        /href=["']((?:https?:)?\/\/(?:www\.)?carsales\.com\.au\/cars\/details\/[^"'\s]+)/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        let url = m[1];
        if (url.startsWith("//")) url = "https:" + url;
        url = url.split("?")[0]; // strip tracking params
        if (!seen.has(url)) {
          seen.add(url);
          urls.push(url);
        }
      }
      return urls;
    },
  },
  // ── Autotrader ──
  {
    domain: "autotrader.com.au",
    searchPageMarker: "/car/",
    buildSearchUrl: (intent) => {
      const make = (intent.make || "").toLowerCase();
      const model = intent.model_keywords[0]?.toLowerCase() || "";
      let url = `https://www.autotrader.com.au/cars/${make}/${model || "all"}`;
      const params: string[] = [];
      if (intent.year) {
        params.push(`year_from=${intent.year}`);
        params.push(`year_to=${intent.year}`);
      }
      if (intent.max_km) params.push(`odometer_to=${intent.max_km}`);
      if (intent.price_max) params.push(`price_to=${intent.price_max}`);
      if (params.length) url += "?" + params.join("&");
      return url;
    },
    detailUrlPattern: /autotrader\.com\.au\/car\/[^"'\s]+/i,
    extractDetailUrls: (html, _base) => {
      const urls: string[] = [];
      const seen = new Set<string>();
      const re =
        /href=["']((?:https?:)?\/\/(?:www\.)?autotrader\.com\.au\/car\/[^"'\s]+)/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        let url = m[1];
        if (url.startsWith("//")) url = "https:" + url;
        if (!seen.has(url)) {
          seen.add(url);
          urls.push(url);
        }
      }
      return urls;
    },
  },
  // ── Drive ──
  {
    domain: "drive.com.au",
    searchPageMarker: "/cars-for-sale/",
    buildSearchUrl: (intent) => {
      const make = (intent.make || "").toLowerCase().replace(/\s+/g, "-");
      const model =
        intent.model_keywords[0]?.toLowerCase().replace(/\s+/g, "-") || "";
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
      const re =
        /href=["']((?:https?:)?\/\/(?:www\.)?drive\.com\.au\/cars-for-sale\/[^"'\s]*\d{4,}[^"'\s]*)/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        let url = m[1];
        if (url.startsWith("//")) url = "https:" + url;
        if (!seen.has(url)) {
          seen.add(url);
          urls.push(url);
        }
      }
      return urls;
    },
  },
  // ── Carsguide ──
  {
    domain: "carsguide.com.au",
    searchPageMarker: "/listing/",
    buildSearchUrl: (intent) => {
      const make = (intent.make || "").toLowerCase().replace(/\s+/g, "-");
      const model =
        intent.model_keywords[0]?.toLowerCase().replace(/\s+/g, "-") || "";
      let url = `https://www.carsguide.com.au/buy-a-car/${make ? make + "/" : ""}${model ? model + "/" : ""}`;
      const params: string[] = [];
      if (intent.year) {
        params.push(`year_from=${intent.year}`);
        params.push(`year_to=${intent.year}`);
      }
      if (intent.max_km) params.push(`kms_max=${intent.max_km}`);
      if (intent.price_max) params.push(`price_max=${intent.price_max}`);
      if (params.length) url += "?" + params.join("&");
      return url;
    },
    detailUrlPattern: /carsguide\.com\.au\/listing\/\d+/i,
    extractDetailUrls: (html, _base) => {
      const urls: string[] = [];
      const seen = new Set<string>();
      const re =
        /href=["']((?:https?:)?\/\/(?:www\.)?carsguide\.com\.au\/listing\/\d+[^"'\s]*)/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        let url = m[1];
        if (url.startsWith("//")) url = "https:" + url;
        if (!seen.has(url)) {
          seen.add(url);
          urls.push(url);
        }
      }
      return urls;
    },
  },
  // ── EasyAuto123 ──
  {
    domain: "easyauto123.com.au",
    buildSearchUrl: (intent) => {
      const make = (intent.make || "").toLowerCase().replace(/\s+/g, "-");
      const model =
        intent.model_keywords[0]?.toLowerCase().replace(/\s+/g, "-") || "";
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
      const re =
        /href=["']((?:https?:)?\/\/(?:www\.)?easyauto123\.com\.au\/car\/\d+[^"'\s]*)/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        let url = m[1];
        if (url.startsWith("//")) url = "https:" + url;
        if (!seen.has(url)) {
          seen.add(url);
          urls.push(url);
        }
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
  const priceMatch = input.match(
    /(?:UNDER|BELOW|MAX|BUDGET)\s*\$?\s*([\d,]+)\s*K?\b/i,
  );
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
        make =
          known === "VW"
            ? "VOLKSWAGEN"
            : known === "LANDROVER"
              ? "LAND ROVER"
              : known;
        break;
      }
    }
    if (make) break;
  }

  if (!make) {
    const sortedModels = Object.keys(MODEL_TO_MAKE).sort(
      (a, b) => b.length - a.length,
    );
    for (const model of sortedModels) {
      if (input.includes(model)) {
        make = MODEL_TO_MAKE[model];
        break;
      }
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
  if (make)
    remaining = remaining.replace(
      new RegExp(
        `\\b${make.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "g",
      ),
      " ",
    );

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
    title: {
      type: "string",
      description: "Full listing title e.g. '2024 Toyota LandCruiser 79 Series GXL'",
    },
    year: { type: "integer", description: "Model year (4-digit e.g. 2024)" },
    make: { type: "string", description: "Vehicle manufacturer e.g. Toyota, Ford" },
    model: { type: "string", description: "Vehicle model e.g. LandCruiser, Ranger" },
    variant: { type: "string", description: "Trim/variant e.g. GXL, Wildtrak, SR5" },
    price: {
      type: "integer",
      description: "Listed price in AUD (no decimals, no cents)",
    },
    km: { type: "integer", description: "Odometer reading in kilometres" },
    location: {
      type: "string",
      description: "City or state where the vehicle is located",
    },
    body_type: {
      type: "string",
      description: "Body type e.g. Ute, Wagon, Sedan, SUV",
    },
    transmission: { type: "string", description: "Auto or Manual" },
    engine: {
      type: "string",
      description: "Engine description e.g. 4.5L V8 Diesel",
    },
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

function normalizeExtract(
  url: string,
  source: string,
  raw: any,
): ExtractedListing {
  return {
    url,
    source,
    title: toStr(raw?.title),
    year: toInt(raw?.year),
    make: toStr(raw?.make)?.toUpperCase() ?? null,
    model: toStr(raw?.model),
    variant: toStr(raw?.variant),
    price: toInt(raw?.price),
    km: toInt(raw?.km),
    location: toStr(raw?.location),
    body_type: toStr(raw?.body_type),
    transmission: toStr(raw?.transmission),
    engine: toStr(raw?.engine),
    score: 0,
  };
}

// ── Scoring ──
function scoreListing(l: ExtractedListing, intent: ParsedIntent): number {
  let score = 50;

  // Completeness bonus
  const fields = [l.year, l.price, l.km, l.model, l.variant].filter(
    Boolean,
  ).length;
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
        JSON.stringify({
          status: "error",
          error: "FIRECRAWL_API_KEY not configured",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const body = await req.json();
    const { instruction, internal_count, urgency } = body;

    if (!instruction || typeof instruction !== "string" || !instruction.trim()) {
      return new Response(
        JSON.stringify({ status: "error", error: "instruction is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ── DEMAND GATE ──
    const internalCount =
      typeof internal_count === "number" ? internal_count : 0;
    const jobUrgency = urgency || "normal";
    if (internalCount >= 3 && jobUrgency === "normal") {
      console.log(`[OUTWARD-V4] Gated: ${internalCount} internal matches`);
      return new Response(
        JSON.stringify({
          status: "ok",
          gated: true,
          reason: `${internalCount} internal matches (threshold <3)`,
          results: [],
          duration_ms: Date.now() - startTime,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── STEP 1: Parse intent ──
    const intent = parseInstruction(instruction);
    console.log(`[OUTWARD-V4] STRUCTURED_QUERY`, JSON.stringify(intent));

    if (!intent.make) {
      return new Response(
        JSON.stringify({
          status: "error",
          error:
            "Could not identify vehicle make. Try: '2024 Toyota HiAce Commuter under 40000 km'",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ── Pipeline metrics ──
    const pipeline = {
      adapters_tried: 0,
      search_pages_crawled: 0,
      search_pages_empty: 0,
      detail_urls_found: 0,
      details_scraped: 0,
      schema_valid: 0,
      constraint_pass: 0,
      returned: 0,
    };

    // ── STEP 2: Crawl search pages → extract detail URLs (parallel per adapter) ──
    const MAX_DETAILS_PER_DOMAIN = 3;
    const detailTargets: { url: string; source: string }[] = [];

    await Promise.all(
      ADAPTERS.map(async (adapter) => {
        pipeline.adapters_tried++;
        const searchUrl = adapter.buildSearchUrl(intent);
        console.log(`[OUTWARD-V4] Crawling search: ${searchUrl}`);

        const html = await firecrawlScrapeHtml(searchUrl, firecrawlKey);
        pipeline.search_pages_crawled++;

        if (!html || html.length < 5000) {
          pipeline.search_pages_empty++;
          console.log(
            `[OUTWARD-V4] ${adapter.domain}: thin/empty search page (${html?.length ?? 0} chars) — skipping`,
          );
          return;
        }

        // Semantic marker check: verify the page actually contains listing links
        if (!html.includes(adapter.searchPageMarker)) {
          pipeline.search_pages_empty++;
          console.log(
            `[OUTWARD-V4] ${adapter.domain}: page missing semantic marker "${adapter.searchPageMarker}" — likely cookie/consent/JS shell`,
          );
          return;
        }

        // Filter URLs to only those containing the make slug
        const makeSlug = (intent.make || "").toLowerCase().replace(/\s+/g, "-");
        const urls = adapter
          .extractDetailUrls(html, searchUrl)
          .map((u) => u.replace(/&amp;/g, "&"))
          .filter((u) => !makeSlug || u.toLowerCase().includes(makeSlug))
          .slice(0, MAX_DETAILS_PER_DOMAIN);

        console.log(
          `[OUTWARD-V4] ${adapter.domain}: ${urls.length} detail URLs extracted`,
        );
        pipeline.detail_urls_found += urls.length;

        for (const u of urls) {
          detailTargets.push({ url: u, source: adapter.domain });
        }
      }),
    );

    // Global dedupe + cap total detail scrapes
    const MAX_TOTAL_DETAILS = 10;
    const deduped = Array.from(
      new Map(detailTargets.map((t) => [t.url, t])).values(),
    ).slice(0, MAX_TOTAL_DETAILS);

    console.log(
      `[OUTWARD-V4] Total detail URLs: ${pipeline.detail_urls_found}, deduped to scrape: ${deduped.length}`,
    );

    if (deduped.length === 0) {
      logAudit(intent, instruction, pipeline, Date.now() - startTime, jobUrgency);
      return new Response(
        JSON.stringify({
          status: "ok",
          intent,
          results: [],
          message: "No listing detail pages found on target domains.",
          pipeline,
          duration_ms: Date.now() - startTime,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── STEP 3: Fetch detail pages with concurrency limiter (max 3 parallel) ──
    // Request-wide budget: return partial results if we're running long
    const BUDGET_MS = 28000;

    const extracted = await mapLimit(deduped, 3, async (t) => {
      // Budget check: skip remaining if we've used too much time
      if (Date.now() - startTime > BUDGET_MS) {
        console.log(`[OUTWARD-V4] Budget exceeded (${BUDGET_MS}ms), skipping ${t.url}`);
        return null;
      }
      pipeline.details_scraped++;
      const raw = await firecrawlExtractVehicle(t.url, firecrawlKey);
      if (!raw) return null;

      const listing = normalizeExtract(t.url, t.source, raw);
      console.log(
        `[OUTWARD-V4] Extracted from ${t.url}:`,
        JSON.stringify({
          year: listing.year,
          make: listing.make,
          model: listing.model,
          price: listing.price,
          km: listing.km,
        }),
      );

      // Hard gate: must have year + make. Price=0 means "contact dealer" — allow through.
      if (!listing.year || !listing.make) return null;
      // Treat price=0 as unknown (many Carsales listings are "contact for price")
      if (listing.price === 0) listing.price = null;

      pipeline.schema_valid++;

      // Make gate: prevent garbage
      if (intent.make && listing.make) {
        const a = listing.make.replace(/\s+/g, "");
        const b = intent.make.replace(/\s+/g, "");
        if (a !== b) {
          console.log(
            `[OUTWARD-V4] Make mismatch: "${listing.make}" vs "${intent.make}"`,
          );
          return null;
        }
      }

      // Model keyword gate
      if (intent.model_keywords.length > 0 && listing.model) {
        const modelUpper = (
          (listing.model || "") +
          " " +
          (listing.title || "")
        ).toUpperCase();
        const hasModelMatch = intent.model_keywords.some((kw) =>
          modelUpper.includes(kw),
        );
        if (!hasModelMatch) {
          console.log(
            `[OUTWARD-V4] Model mismatch: "${listing.model}" vs [${intent.model_keywords.join(",")}]`,
          );
          return null;
        }
      }

      // Numeric constraint gate
      if (intent.year && listing.year && Math.abs(listing.year - intent.year) > 2)
        return null;
      if (
        intent.max_km &&
        listing.km != null &&
        listing.km > intent.max_km + 10000
      )
        return null;
      if (
        intent.price_max &&
        listing.price != null &&
        listing.price > intent.price_max * 1.15
      )
        return null;

      pipeline.constraint_pass++;

      // Score
      listing.score = scoreListing(listing, intent);
      if (listing.score <= 0) return null;

      return listing;
    });

    const results = extracted
      .filter((x): x is ExtractedListing => Boolean(x))
      .sort(
        (a, b) =>
          b.score - a.score || (a.price ?? Infinity) - (b.price ?? Infinity),
      )
      .slice(0, 10);

    pipeline.returned = results.length;

    console.log(`[OUTWARD-V4] FINAL: ${results.length} results`);
    console.log(
      `[OUTWARD-V4] TOP_RESULTS:`,
      JSON.stringify(
        results.map((r) => ({
          url: r.url,
          year: r.year,
          make: r.make,
          model: r.model,
          price: r.price,
          km: r.km,
          score: r.score,
          source: r.source,
        })),
      ),
    );

    logAudit(intent, instruction, pipeline, Date.now() - startTime, jobUrgency);

    return new Response(
      JSON.stringify({
        status: "ok",
        intent,
        results,
        pipeline,
        duration_ms: Date.now() - startTime,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[OUTWARD-V4] Error:", error);
    return new Response(
      JSON.stringify({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
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
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    sb.from("cron_audit_log")
      .insert({
        cron_name: "run-outward-search-v4",
        run_date: new Date().toISOString().slice(0, 10),
        success: true,
        result: {
          instruction: instruction.trim(),
          intent,
          pipeline,
          duration_ms: durationMs,
          urgency,
        },
      })
      .then(() => {});
  } catch (_) {
    /* swallow */
  }
}
