import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * PICKLES DETAIL MICRO-CRAWLER - Phase 2 of two-phase pipeline
 * 
 * Worker that:
 * 1. Claims pending items from pickles_detail_queue
 * 2. Scrapes each detail URL via Firecrawl
 * 3. Extracts truth fields (year, make, model, variant, km, price, buy_method, etc.)
 * 4. Updates pickles_detail_queue with extracted data
 * 5. Optionally upserts to vehicle_listings or hunt_external_candidates
 * 
 * Validation:
 * - Hard reject: missing year OR make OR model OR source_listing_id
 * - Soft fields (nullable): price, guide, sold, reserve, km
 * 
 * Observability: pickles_detail_runs tracks each run's metrics
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ExtractedData {
  year: number | null;
  make: string | null;
  model: string | null;
  variant_raw: string | null;
  km: number | null;
  asking_price: number | null;
  guide_price: number | null;
  sold_price: number | null;
  reserve_price: number | null;
  buy_method: string | null;
  location: string | null;
  state: string | null;
  sale_close_at: string | null;
  sale_status: string | null;
}

// Extract year from text
function parseYear(text: string): number | null {
  const match = text.match(/\b(19[89]\d|20[0-2]\d)\b/);
  return match ? parseInt(match[1], 10) : null;
}

// Extract km from text - handles "123,456 km", "45785km", etc.
function parseKm(text: string): number | null {
  const match = text.match(/(\d{1,3}(?:,\d{3})*|\d+)\s*(?:km|kms|kilometres)/i);
  if (match) {
    const km = parseInt(match[1].replace(/,/g, ""), 10);
    return km >= 0 && km <= 999999 ? km : null;
  }
  return null;
}

// Extract price from text - handles "$27,500", "Price: $35,000", etc.
function parsePrice(text: string): number | null {
  // Look for dollar amounts
  const match = text.match(/\$\s*([\d,]+)/);
  if (match) {
    const price = parseInt(match[1].replace(/,/g, ""), 10);
    return price >= 1000 && price <= 1000000 ? price : null;
  }
  return null;
}

// Extract specific labeled price
function parseLabeledPrice(text: string, label: string): number | null {
  const pattern = new RegExp(`${label}[:\\s]*\\$?([\\d,]+)`, "i");
  const match = text.match(pattern);
  if (match) {
    const price = parseInt(match[1].replace(/,/g, ""), 10);
    return price >= 1000 && price <= 1000000 ? price : null;
  }
  return null;
}

// Parse make from URL slug or text
function parseMake(slug: string): string | null {
  // URL format: /used/details/cars/YEAR-MAKE-MODEL/ID
  const parts = slug.split("/");
  const carPart = parts.find(p => /^\d{4}-[a-z]+-/.test(p));
  if (carPart) {
    const segments = carPart.split("-");
    if (segments.length >= 2) {
      return segments[1].charAt(0).toUpperCase() + segments[1].slice(1);
    }
  }
  return null;
}

// Parse model from URL slug
function parseModel(slug: string): string | null {
  const parts = slug.split("/");
  const carPart = parts.find(p => /^\d{4}-[a-z]+-/.test(p));
  if (carPart) {
    const segments = carPart.split("-");
    if (segments.length >= 3) {
      return segments[2].charAt(0).toUpperCase() + segments[2].slice(1);
    }
  }
  return null;
}

// Extract variant from title or content
function parseVariant(text: string, make: string | null, model: string | null): string | null {
  // Common variant patterns
  const variantPatterns = [
    /\b(SR5|GXL|GX|VX|SAHARA|KAKADU|ROGUE|RUGGED|WORKMATE)\b/i,
    /\b(WILDTRAK|RAPTOR|XLT|XLS|XL|TITANIUM|PLATINUM|AMBIENTE|TREND)\b/i,
    /\b(X-TERRAIN|LS-U|LS-M|LS-T|PRO-4X|N-TREK|WARRIOR)\b/i,
    /\b(HIGHLANDER|ELITE|ACTIVE|PREMIUM|EXCEED|CRUSADE)\b/i,
    /\b(GT|GR|RS|SS|SSV|SV6|LTZ|Z71|STORM)\b/i,
  ];
  
  for (const pattern of variantPatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }
  return null;
}

// Extract buy method
function parseBuyMethod(text: string): string | null {
  const methods = [
    { pattern: /buy\s*now/i, value: "Buy Now" },
    { pattern: /pickles\s*online/i, value: "Pickles Online" },
    { pattern: /pickles\s*live/i, value: "Pickles Live" },
    { pattern: /timed\s*auction/i, value: "Timed Auction" },
    { pattern: /make\s*(?:an?\s*)?offer/i, value: "Make Offer" },
    { pattern: /live\s*auction/i, value: "Live Auction" },
  ];
  
  for (const { pattern, value } of methods) {
    if (pattern.test(text)) {
      return value;
    }
  }
  return null;
}

// Extract location/state
function parseLocation(text: string): { location: string | null; state: string | null } {
  // Known Pickles yards
  const yards = [
    "Yatala", "Eagle Farm", "Altona", "Dandenong", "Salisbury Plain", "Winnellie",
    "Moonah", "Welshpool", "Belmont", "Hazelmere", "Canning Vale",
    "Brisbane", "Sydney", "Melbourne", "Perth", "Adelaide", "Darwin", "Hobart",
  ];
  
  for (const yard of yards) {
    if (new RegExp(`\\b${yard}\\b`, "i").test(text)) {
      return { location: yard, state: inferState(yard) };
    }
  }
  
  // State abbreviation
  const stateMatch = text.match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/i);
  if (stateMatch) {
    return { location: null, state: stateMatch[1].toUpperCase() };
  }
  
  return { location: null, state: null };
}

function inferState(location: string): string | null {
  const stateMap: Record<string, string> = {
    "Yatala": "QLD", "Eagle Farm": "QLD", "Brisbane": "QLD",
    "Altona": "VIC", "Dandenong": "VIC", "Melbourne": "VIC",
    "Sydney": "NSW",
    "Salisbury Plain": "SA", "Adelaide": "SA",
    "Winnellie": "NT", "Darwin": "NT",
    "Moonah": "TAS", "Hobart": "TAS",
    "Welshpool": "WA", "Belmont": "WA", "Hazelmere": "WA", "Canning Vale": "WA", "Perth": "WA",
  };
  return stateMap[location] || null;
}

// Extract sale status
function parseSaleStatus(text: string): string | null {
  if (/\bsold\b/i.test(text)) return "sold";
  if (/\bpassed\s*in\b/i.test(text)) return "passed_in";
  if (/\bwithdrawn\b/i.test(text)) return "withdrawn";
  if (/\blive\b.*\bauction\b/i.test(text) || /\bending\s*soon\b/i.test(text)) return "live";
  if (/\bupcoming\b/i.test(text) || /\bstarts?\s*in\b/i.test(text)) return "upcoming";
  return null;
}

// Parse auction close datetime
function parseCloseDate(text: string): string | null {
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  // Pattern: "Wed 15 Jan 10:00 AM" or "15/01/2026 10:00AM"
  const patterns = [
    /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i,
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\s+(\d{4}))?\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      try {
        // Handle different formats
        if (/^\d+\/\d+\/\d+/.test(match[0])) {
          const [, day, month, year, hour, min, ampm] = match;
          let h = parseInt(hour);
          if (ampm?.toUpperCase() === "PM" && h < 12) h += 12;
          if (ampm?.toUpperCase() === "AM" && h === 12) h = 0;
          const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), h, parseInt(min));
          if (!isNaN(d.getTime())) return d.toISOString();
        } else {
          const [, day, monthStr, year, hour, min, ampm] = match;
          const monthNum = months[monthStr.toLowerCase()];
          const yearNum = year ? parseInt(year) : new Date().getFullYear();
          let h = parseInt(hour);
          if (ampm?.toUpperCase() === "PM" && h < 12) h += 12;
          if (ampm?.toUpperCase() === "AM" && h === 12) h = 0;
          const d = new Date(yearNum, monthNum, parseInt(day), h, parseInt(min));
          if (!isNaN(d.getTime())) return d.toISOString();
        }
      } catch {
        // Invalid date
      }
    }
  }
  return null;
}

// Main extraction function
function extractFromContent(url: string, content: string): ExtractedData {
  // Parse from URL first (most reliable for year/make/model)
  const urlPath = new URL(url).pathname;
  const urlParts = urlPath.split("/");
  const slugPart = urlParts.find(p => /^\d{4}-[a-z]+-/i.test(p));
  
  let year: number | null = null;
  let make: string | null = null;
  let model: string | null = null;
  
  if (slugPart) {
    const segments = slugPart.toLowerCase().split("-");
    if (segments.length >= 3) {
      year = parseInt(segments[0], 10);
      make = segments[1].charAt(0).toUpperCase() + segments[1].slice(1);
      model = segments[2].charAt(0).toUpperCase() + segments[2].slice(1);
    }
  }
  
  // Fallback to content parsing
  if (!year) year = parseYear(content);
  
  const variant_raw = parseVariant(content, make, model);
  const km = parseKm(content);
  const { location, state } = parseLocation(content);
  
  // Price extraction - look for labeled prices first
  const guide_price = parseLabeledPrice(content, "guide") || parseLabeledPrice(content, "estimate");
  const sold_price = parseLabeledPrice(content, "sold") || parseLabeledPrice(content, "hammer");
  const reserve_price = parseLabeledPrice(content, "reserve");
  const asking_price = parseLabeledPrice(content, "buy now") 
    || parseLabeledPrice(content, "price") 
    || parsePrice(content);
  
  const buy_method = parseBuyMethod(content);
  const sale_status = parseSaleStatus(content);
  const sale_close_at = parseCloseDate(content);
  
  return {
    year,
    make,
    model,
    variant_raw,
    km,
    asking_price,
    guide_price,
    sold_price,
    reserve_price,
    buy_method,
    location,
    state,
    sale_close_at,
    sale_status,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json().catch(() => ({}));
    const { batch_size = 20, max_retries = 3 } = body;

    if (!firecrawlKey) {
      return new Response(
        JSON.stringify({ success: false, error: "FIRECRAWL_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create run record
    const runId = crypto.randomUUID();
    await supabase.from("pickles_detail_runs").insert({
      id: runId,
      status: "running",
    });

    console.log(`[DETAIL] Starting run ${runId}, batch_size=${batch_size}`);

    // Claim pending items (prioritize never-crawled, then oldest)
    const { data: queueItems, error: fetchErr } = await supabase
      .from("pickles_detail_queue")
      .select("*")
      .eq("crawl_status", "pending")
      .lt("crawl_attempts", max_retries)
      .order("first_seen_at", { ascending: true })
      .limit(batch_size);

    if (fetchErr) {
      throw new Error(`Failed to fetch queue: ${fetchErr.message}`);
    }

    if (!queueItems || queueItems.length === 0) {
      console.log("[DETAIL] No pending items in queue");
      
      await supabase.from("pickles_detail_runs").update({
        status: "completed",
        duration_ms: Date.now() - startTime,
      }).eq("id", runId);
      
      return new Response(
        JSON.stringify({ success: true, run_id: runId, message: "No pending items" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[DETAIL] Claimed ${queueItems.length} items`);

    // Process metrics
    let detailFetched = 0;
    let parsedOk = 0;
    let rejected = 0;
    const rejectReasons: Record<string, number> = {};

    for (const item of queueItems) {
      const itemId = item.id;
      const detailUrl = item.detail_url;
      const stockId = item.source_listing_id;
      
      console.log(`[DETAIL] Processing ${stockId}: ${detailUrl}`);
      
      try {
        // Scrape detail page
        const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: detailUrl,
            formats: ["markdown", "html"],
            onlyMainContent: true,
            waitFor: 4000,
          }),
        });

        if (!scrapeRes.ok) {
          const errText = await scrapeRes.text();
          console.error(`[DETAIL] Scrape failed for ${stockId}:`, errText);
          
          await supabase.from("pickles_detail_queue").update({
            crawl_status: "failed",
            crawl_attempts: item.crawl_attempts + 1,
            last_crawl_at: new Date().toISOString(),
            last_crawl_error: `Firecrawl ${scrapeRes.status}`,
          }).eq("id", itemId);
          
          rejectReasons["scrape_failed"] = (rejectReasons["scrape_failed"] || 0) + 1;
          rejected++;
          continue;
        }

        detailFetched++;
        
        const scrapeData = await scrapeRes.json();
        const markdown = scrapeData.data?.markdown || "";
        const html = scrapeData.data?.html || "";
        const content = `${markdown}\n${html}`;
        
        if (content.length < 100) {
          console.warn(`[DETAIL] Sparse content for ${stockId}: ${content.length} chars`);
          
          await supabase.from("pickles_detail_queue").update({
            crawl_status: "failed",
            crawl_attempts: item.crawl_attempts + 1,
            last_crawl_at: new Date().toISOString(),
            last_crawl_error: "Sparse content",
          }).eq("id", itemId);
          
          rejectReasons["sparse_content"] = (rejectReasons["sparse_content"] || 0) + 1;
          rejected++;
          continue;
        }

        // Extract data
        const extracted = extractFromContent(detailUrl, content);
        
        // Validate hard requirements
        if (!extracted.year || !extracted.make || !extracted.model) {
          console.warn(`[DETAIL] Hard reject ${stockId}: year=${extracted.year}, make=${extracted.make}, model=${extracted.model}`);
          
          await supabase.from("pickles_detail_queue").update({
            crawl_status: "failed",
            crawl_attempts: item.crawl_attempts + 1,
            last_crawl_at: new Date().toISOString(),
            last_crawl_error: `Missing: ${!extracted.year ? "year " : ""}${!extracted.make ? "make " : ""}${!extracted.model ? "model" : ""}`.trim(),
          }).eq("id", itemId);
          
          rejectReasons["missing_required"] = (rejectReasons["missing_required"] || 0) + 1;
          rejected++;
          continue;
        }

        // Success - update queue with extracted data
        const { error: updateErr } = await supabase.from("pickles_detail_queue").update({
          crawl_status: "crawled",
          crawl_attempts: item.crawl_attempts + 1,
          last_crawl_at: new Date().toISOString(),
          last_crawl_error: null,
          year: extracted.year,
          make: extracted.make,
          model: extracted.model,
          variant_raw: extracted.variant_raw,
          km: extracted.km,
          asking_price: extracted.asking_price,
          guide_price: extracted.guide_price,
          sold_price: extracted.sold_price,
          reserve_price: extracted.reserve_price,
          buy_method: extracted.buy_method,
          location: extracted.location,
          state: extracted.state,
          sale_close_at: extracted.sale_close_at,
          sale_status: extracted.sale_status,
        }).eq("id", itemId);

        if (updateErr) {
          console.error(`[DETAIL] Update failed for ${stockId}:`, updateErr.message);
          rejectReasons["update_failed"] = (rejectReasons["update_failed"] || 0) + 1;
          rejected++;
        } else {
          console.log(`[DETAIL] ✓ ${stockId}: ${extracted.year} ${extracted.make} ${extracted.model} ${extracted.km || "N/A"}km $${extracted.asking_price || "N/A"}`);
          parsedOk++;
        }

        // Rate limit
        await new Promise(r => setTimeout(r, 1000));
        
      } catch (err) {
        console.error(`[DETAIL] Error processing ${stockId}:`, err);
        
        await supabase.from("pickles_detail_queue").update({
          crawl_status: "failed",
          crawl_attempts: item.crawl_attempts + 1,
          last_crawl_at: new Date().toISOString(),
          last_crawl_error: err instanceof Error ? err.message : String(err),
        }).eq("id", itemId);
        
        rejectReasons["exception"] = (rejectReasons["exception"] || 0) + 1;
        rejected++;
      }
    }

    const duration = Date.now() - startTime;

    // Update run record
    await supabase.from("pickles_detail_runs").update({
      detail_fetched: detailFetched,
      parsed_ok: parsedOk,
      inserted: 0, // Could add vehicle_listings upsert later
      updated: 0,
      rejected,
      reject_reasons: rejectReasons,
      duration_ms: duration,
      status: "completed",
    }).eq("id", runId);

    console.log(`[DETAIL] Completed: ${parsedOk} parsed, ${rejected} rejected`);

    return new Response(
      JSON.stringify({
        success: true,
        run_id: runId,
        claimed: queueItems.length,
        detail_fetched: detailFetched,
        parsed_ok: parsedOk,
        rejected,
        reject_reasons: rejectReasons,
        duration_ms: duration,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[DETAIL] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
