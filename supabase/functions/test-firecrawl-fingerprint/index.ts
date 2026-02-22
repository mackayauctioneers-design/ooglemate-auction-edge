const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── TEST FINGERPRINT ────────────────────────────────────────────────────────
const TEST_FINGERPRINT = {
  fingerprint_id: "LC300_VX_SAHARA_2020PLUS",
  make: "Toyota",
  model: "Landcruiser",
  allowed_variants: ["VX", "Sahara"],
  fuel: "Diesel",
  year_range: [2020, 2025] as [number, number],
  base_km: 80000,
  km_tolerance: 40000,
  max_buy: 95000,
};

// ─── TEST SEARCH URLS (real auction sites from your allowlist) ────────────────
const TEST_SEARCH_URLS = [
  {
    source: "pickles",
    url: "https://www.pickles.com.au/used/search/cars?q=toyota+landcruiser&yearFrom=2020&yearTo=2025",
  },
  {
    source: "grays",
    url: "https://www.grays.com/search?q=toyota+landcruiser+300&category=motor-vehicles",
  },
];

// ─── FIRECRAWL SCHEMA ────────────────────────────────────────────────────────
const LISTING_SCHEMA = {
  type: "object",
  properties: {
    listings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          make: { type: "string" },
          model: { type: "string" },
          variant: { type: "string" },
          year: { type: "integer" },
          km: { type: "integer" },
          fuel: { type: "string" },
          price: { type: "number" },
          url: { type: "string" },
          site: { type: "string" },
        },
        required: ["make", "model", "year", "km", "url"],
      },
    },
  },
  required: ["listings"],
};

// ─── MATCHER ─────────────────────────────────────────────────────────────────
interface Listing {
  make: string;
  model: string;
  variant?: string;
  year: number;
  km: number;
  fuel?: string;
  price?: number;
  url: string;
  site?: string;
}

function matchesFingerprint(listing: Listing, fp: typeof TEST_FINGERPRINT): boolean {
  if (listing.make.trim().toLowerCase() !== fp.make.toLowerCase()) return false;
  if (!listing.model.toLowerCase().includes("landcruiser")) return false;

  if (listing.year < fp.year_range[0] || listing.year > fp.year_range[1]) return false;

  const km = listing.km;
  if (km < fp.base_km - fp.km_tolerance || km > fp.base_km + fp.km_tolerance) return false;

  const variant = (listing.variant || "").toLowerCase();
  const allowed = fp.allowed_variants.map(v => v.toLowerCase());
  if (!allowed.some(v => variant.includes(v))) return false;

  const fuel = (listing.fuel || "").toLowerCase();
  if (fp.fuel.toLowerCase() !== "" && !fuel.includes(fp.fuel.toLowerCase())) return false;

  if (listing.price != null && listing.price > fp.max_buy) return false;

  return true;
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!firecrawlKey) {
    return new Response(JSON.stringify({ error: "FIRECRAWL_API_KEY not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const fp = body.fingerprint || TEST_FINGERPRINT;
  const urls = body.search_urls || TEST_SEARCH_URLS;
  const dryRun = body.dry_run === true; // skip Firecrawl, use mock data

  const results: Array<{
    source: string;
    search_url: string;
    raw_listings_count: number;
    matches: Listing[];
    error?: string;
  }> = [];

  for (const su of urls) {
    if (dryRun) {
      // Return mock data so you can test the matcher without burning credits
      const mockListings: Listing[] = [
        { make: "Toyota", model: "Landcruiser 300", variant: "VX", year: 2022, km: 78570, fuel: "Diesel", price: 91000, url: "https://mock.example.com/lot/1", site: su.source },
        { make: "Toyota", model: "Landcruiser 300", variant: "GX", year: 2021, km: 65000, fuel: "Diesel", price: 82000, url: "https://mock.example.com/lot/2", site: su.source },
        { make: "Toyota", model: "Landcruiser 300", variant: "Sahara", year: 2023, km: 45000, fuel: "Diesel", price: 110000, url: "https://mock.example.com/lot/3", site: su.source },
        { make: "Toyota", model: "Landcruiser 300", variant: "Sahara", year: 2022, km: 92000, fuel: "Diesel", price: 88000, url: "https://mock.example.com/lot/4", site: su.source },
        { make: "Nissan", model: "Patrol", variant: "Ti", year: 2022, km: 60000, fuel: "Diesel", price: 75000, url: "https://mock.example.com/lot/5", site: su.source },
      ];
      const matches = mockListings.filter(l => matchesFingerprint(l, fp));
      results.push({ source: su.source, search_url: su.url, raw_listings_count: mockListings.length, matches });
      continue;
    }

    try {
      console.log(`[test-fc] Scraping ${su.source}: ${su.url.substring(0, 80)}...`);
      const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          url: su.url,
          formats: ["json"],
          jsonOptions: {
            schema: LISTING_SCHEMA,
            prompt: "Extract all vehicle listings. For each: make, model, variant/trim, year, kilometres, fuel type, price (number only), listing URL, site name.",
          },
          onlyMainContent: true,
          timeout: 15000,
        }),
      });

      const data = await response.json();
      const listings: Listing[] = data?.data?.json?.listings || data?.json?.listings || [];
      console.log(`[test-fc] ${su.source}: ${listings.length} raw listings`);

      const matches = listings.filter(l => matchesFingerprint(l, fp));
      results.push({ source: su.source, search_url: su.url, raw_listings_count: listings.length, matches });
    } catch (err: any) {
      console.error(`[test-fc] Error: ${err.message}`);
      results.push({ source: su.source, search_url: su.url, raw_listings_count: 0, matches: [], error: err.message });
    }
  }

  const totalMatches = results.reduce((s, r) => s + r.matches.length, 0);

  return new Response(JSON.stringify({
    fingerprint: fp,
    total_urls_scraped: results.length,
    total_matches: totalMatches,
    results,
  }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
