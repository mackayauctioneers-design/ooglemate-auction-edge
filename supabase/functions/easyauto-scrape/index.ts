import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * EasyAuto123 Retail Under-Market Engine
 * 
 * 1. Scrape EasyAuto123 via Firecrawl
 * 2. Parse listings from markdown
 * 3. Structural pre-filter (price, km, year, completeness, salvage)
 * 4. Page-level bottom-40% price filter
 * 5. Grok valuation (single integer) — re-evaluate if price drops >$2k
 * 6. Calculate delta, store opportunity if delta ≥ $3k
 * 7. Slack alert if delta ≥ $5k
 */

const STRUCTURAL_FILTERS = {
  price_min: 8000,
  price_max: 120000,
  km_max: 250000,
  year_min: 2008,
  percentile_cutoff: 0.4, // bottom 40% of page prices
};

const SALVAGE_KEYWORDS = [
  "salvage", "write-off", "writeoff", "write off", "hail",
  "damaged", "repairable", "stat write", "wovr", "statutory",
];

interface ParsedListing {
  url: string;
  year: number;
  make: string;
  model: string;
  badge: string;
  kms: number;
  price: number;
  location: string;
  raw_text: string;
}

function parsePriceString(s: string): number | null {
  const m = s.replace(/[,$\s]/g, "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function parseKmString(s: string): number | null {
  const m = s.replace(/[,\s]/g, "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function parseListingsFromMarkdown(markdown: string): ParsedListing[] {
  const listings: ParsedListing[] = [];

  // EasyAuto123 listings typically appear as repeated blocks with vehicle details
  // We look for patterns: Year Make Model, price, km, location
  const blocks = markdown.split(/\n{2,}/);

  for (const block of blocks) {
    try {
      const lines = block.trim().split("\n").map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) continue;

      // Try to find year/make/model pattern
      const yearMakeMatch = lines[0]?.match(/(\d{4})\s+(\w+)\s+(.+)/);
      if (!yearMakeMatch) continue;

      const year = parseInt(yearMakeMatch[1], 10);
      if (year < 1990 || year > 2030) continue;

      const make = yearMakeMatch[2];
      const modelBadge = yearMakeMatch[3];

      // Split model and badge
      const modelParts = modelBadge.split(/\s+/);
      const model = modelParts[0] || "";
      const badge = modelParts.slice(1).join(" ") || "";

      // Find price
      let price: number | null = null;
      let kms: number | null = null;
      let location = "";
      let url = "";

      for (const line of lines) {
        if (!price) {
          const priceMatch = line.match(/\$[\d,]+/);
          if (priceMatch) price = parsePriceString(priceMatch[0]);
        }
        if (!kms) {
          const kmMatch = line.match(/([\d,]+)\s*km/i);
          if (kmMatch) kms = parseKmString(kmMatch[1]);
        }
        if (!location) {
          const locMatch = line.match(/(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)/i);
          if (locMatch) location = locMatch[0].toUpperCase();
        }
        if (!url) {
          const urlMatch = line.match(/https?:\/\/[^\s)]+easyauto[^\s)]+/i);
          if (urlMatch) url = urlMatch[0];
        }
      }

      // Also check for easyauto URL in markdown links
      if (!url) {
        const linkMatch = block.match(/\(https?:\/\/[^\s)]*easyauto[^\s)]*\)/i);
        if (linkMatch) url = linkMatch[0].replace(/[()]/g, "");
      }

      if (!price || !year || !make || !model) continue;

      listings.push({
        url: url || `easyauto123-${year}-${make}-${model}-${price}`,
        year,
        make,
        model,
        badge,
        kms: kms || 0,
        price,
        location,
        raw_text: block,
      });
    } catch {
      continue;
    }
  }

  return listings;
}

function passesStructuralFilter(listing: ParsedListing): boolean {
  // Price bounds
  if (listing.price < STRUCTURAL_FILTERS.price_min || listing.price > STRUCTURAL_FILTERS.price_max) return false;

  // KM cap
  if (listing.kms > STRUCTURAL_FILTERS.km_max) return false;

  // Year floor
  if (listing.year < STRUCTURAL_FILTERS.year_min) return false;

  // Must have year + make + model
  if (!listing.year || !listing.make || !listing.model) return false;

  // Salvage / write-off exclusion
  const text = listing.raw_text.toLowerCase();
  for (const kw of SALVAGE_KEYWORDS) {
    if (text.includes(kw)) return false;
  }

  return true;
}

function applyBottomPercentileFilter(listings: ParsedListing[]): ParsedListing[] {
  if (listings.length === 0) return [];

  // Sort by price ascending
  const sorted = [...listings].sort((a, b) => a.price - b.price);
  const cutoffIndex = Math.ceil(sorted.length * STRUCTURAL_FILTERS.percentile_cutoff);

  // Return bottom 40%
  return sorted.slice(0, cutoffIndex);
}

async function getGrokEstimate(listing: ParsedListing, apiKey: string): Promise<number | null> {
  const prompt = `Return ONLY a single integer.\n\nEstimate current Australian retail value (AUD) for:\n\nYear: ${listing.year}\nMake: ${listing.make}\nModel: ${listing.model}\nBadge: ${listing.badge || "N/A"}\nKM: ${listing.kms || "Unknown"}\nState: ${listing.location || "NSW"}\n\nDo not explain.\nDo not provide a range.\nReturn only the number.`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are an Australian used car wholesale/retail pricing expert. Return ONLY a single integer number. No text, no currency symbol, no explanation." },
          { role: "user", content: prompt },
        ],
        max_tokens: 20,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      console.error("OpenAI error:", response.status, await response.text());
      return null;
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || "";
    const num = parseInt(raw.replace(/[^0-9]/g, ""), 10);
    return isNaN(num) ? null : num;
  } catch (err) {
    console.error("Grok estimate error:", err);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY") ?? "";
    const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
    const slackWebhook = Deno.env.get("SLACK_WEBHOOK_URL") ?? "";

    const sb = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const searchUrl = body.url || "https://easyauto123.com.au/buy/used-cars?limit=48&page=1";
    const maxGrokCalls = body.max_grok_calls || 30;

    const results = {
      scraped: 0,
      parsed: 0,
      structural_passed: 0,
      percentile_passed: 0,
      grok_called: 0,
      grok_succeeded: 0,
      opportunities_created: 0,
      slack_sent: 0,
      errors: [] as string[],
    };

    // Step 1: Scrape with Firecrawl
    console.log("Scraping:", searchUrl);
    const scrapeResponse = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: searchUrl,
        formats: ["markdown", "html"],
        waitFor: 8000,
        onlyMainContent: false,
        actions: [
          { type: "wait", milliseconds: 3000 },
          { type: "scroll", direction: "down", amount: 3 },
          { type: "wait", milliseconds: 2000 },
        ],
      }),
    });

    if (!scrapeResponse.ok) {
      const errText = await scrapeResponse.text();
      throw new Error(`Firecrawl error: ${scrapeResponse.status} - ${errText}`);
    }

    const scrapeData = await scrapeResponse.json();
    const markdown = scrapeData?.data?.markdown || scrapeData?.markdown || "";
    const html = scrapeData?.data?.html || scrapeData?.html || "";
    console.log(`Firecrawl returned: markdown=${markdown.length} chars, html=${html.length} chars`);
    results.scraped = 1;

    if (!markdown && !html) {
      console.error("Firecrawl response keys:", Object.keys(scrapeData || {}));
      console.error("Firecrawl data keys:", Object.keys(scrapeData?.data || {}));
      throw new Error("No content returned from Firecrawl");
    }

    // Step 2: Parse listings
    const allListings = parseListingsFromMarkdown(markdown);
    results.parsed = allListings.length;
    console.log(`Parsed ${allListings.length} listings`);

    // Step 3: Structural pre-filter
    const structuralPassed = allListings.filter(passesStructuralFilter);
    results.structural_passed = structuralPassed.length;
    console.log(`Structural filter: ${structuralPassed.length} passed`);

    // Step 4: Bottom 40% price filter
    const percentilePassed = applyBottomPercentileFilter(structuralPassed);
    results.percentile_passed = percentilePassed.length;
    console.log(`Percentile filter: ${percentilePassed.length} passed`);

    // Step 5: Upsert into retail_source_listings
    for (const listing of allListings) {
      if (!listing.url.startsWith("http")) continue;
      await sb.from("retail_source_listings").upsert({
        source: "easyauto123",
        listing_url: listing.url,
        year: listing.year,
        make: listing.make,
        model: listing.model,
        badge: listing.badge,
        kms: listing.kms || null,
        price: listing.price,
        location: listing.location || null,
        scraped_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "listing_url" });
    }

    // Step 6: Grok valuation for percentile-passed listings
    let grokCalls = 0;
    for (const listing of percentilePassed) {
      if (grokCalls >= maxGrokCalls) break;
      if (!listing.url.startsWith("http")) continue;

      // Check if we already have a Grok estimate for this listing
      const { data: existing } = await sb
        .from("retail_source_listings")
        .select("grok_estimate, price_at_grok")
        .eq("listing_url", listing.url)
        .single();

      // Re-evaluate if: no estimate yet, OR price dropped by >$2k
      const needsEval = !existing?.grok_estimate ||
        (existing.price_at_grok && listing.price < existing.price_at_grok - 2000);

      if (!needsEval) {
        // Use cached estimate
        const cachedEstimate = existing?.grok_estimate;
        if (cachedEstimate) {
          const delta = cachedEstimate - listing.price;
          if (delta >= 3000 && cachedEstimate > 0 && listing.price > 2000 && listing.price < 200000) {
            await upsertOpportunity(sb, listing, cachedEstimate, delta, slackWebhook, results);
          }
        }
        continue;
      }

      // Call Grok
      grokCalls++;
      results.grok_called++;
      console.log(`Grok ${grokCalls}/${maxGrokCalls}: ${listing.year} ${listing.make} ${listing.model} @ $${listing.price}`);

      const estimate = await getGrokEstimate(listing, openaiKey);
      if (!estimate) {
        results.errors.push(`Grok failed: ${listing.year} ${listing.make} ${listing.model}`);
        continue;
      }
      results.grok_succeeded++;

      // Save estimate
      await sb.from("retail_source_listings").update({
        grok_estimate: estimate,
        grok_estimated_at: new Date().toISOString(),
        price_at_grok: listing.price,
      }).eq("listing_url", listing.url);

      // Calculate delta
      const delta = estimate - listing.price;
      console.log(`  Estimate: $${estimate}, Delta: $${delta}`);

      // Store opportunity if delta ≥ $3k
      if (delta >= 3000 && estimate > 0 && listing.price > 2000 && listing.price < 200000) {
        await upsertOpportunity(sb, listing, estimate, delta, slackWebhook, results);
      }

      // Rate limit: 500ms between calls
      await new Promise(r => setTimeout(r, 500));
    }

    // Log to cron audit
    await sb.from("cron_audit_log").insert({
      cron_name: "easyauto-scrape",
      success: results.errors.length === 0,
      result: results,
      run_date: new Date().toISOString().split("T")[0],
    });

    console.log("EasyAuto scrape complete:", results);

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("EasyAuto scrape error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function upsertOpportunity(
  sb: any,
  listing: ParsedListing,
  estimate: number,
  delta: number,
  slackWebhook: string,
  results: any,
) {
  const confidenceScore =
    (delta * 0.5) +
    (delta * 0.4) + // grok_gap = delta for retail signals
    0; // no pattern_strong for retail yet

  const tier = delta >= 8000 ? "HIGH" : delta >= 5000 ? "MEDIUM" : "LOW";

  await sb.from("opportunities").upsert({
    source_type: "market_deviation",
    listing_url: listing.url,
    year: listing.year,
    make: listing.make,
    model: listing.model,
    variant: listing.badge || null,
    kms: listing.kms || null,
    location: listing.location || null,
    buy_price: listing.price,
    retail_median_price: estimate,
    retail_gap: delta,
    deviation: delta,
    grok_wholesale_estimate: estimate,
    grok_gap: delta,
    confidence_score: confidenceScore,
    confidence_tier: tier,
    status: "new",
  }, { onConflict: "listing_url" });

  results.opportunities_created++;

  // Slack alert only if delta ≥ $5k
  if (delta >= 5000 && slackWebhook) {
    try {
      const slackMsg = `🟢 Retail Under-Market\n\n${listing.year} ${listing.make} ${listing.model} ${listing.badge || ""}\nPrice: $${listing.price.toLocaleString()}\nEst Retail: $${estimate.toLocaleString()}\nDelta: +$${delta.toLocaleString()}\n\n${listing.url}`;

      await fetch(slackWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: slackMsg }),
      });
      results.slack_sent++;
    } catch (err) {
      console.error("Slack send error:", err);
    }
  }
}
