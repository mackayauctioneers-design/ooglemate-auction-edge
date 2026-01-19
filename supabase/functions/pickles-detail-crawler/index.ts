import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * PICKLES DETAIL MICRO-CRAWLER - Phase 2 (Hardened)
 * 
 * Improvements:
 * - Atomic claim via RPC (parallel-safe with FOR UPDATE SKIP LOCKED)
 * - Title-based variant extraction
 * - Labeled field parsing (Odometer, Price, etc.)
 * - HTTP status and content length tracking
 * - Sanity bounds on km/price
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

// =====================================================
// EXTRACTION FUNCTIONS - Improved with labeled fields
// =====================================================

// Extract year from text (1990-2030 range)
function parseYear(text: string): number | null {
  const match = text.match(/\b(199\d|20[0-2]\d|2030)\b/);
  return match ? parseInt(match[1], 10) : null;
}

// Extract labeled odometer (priority) or fallback regex
function parseKm(text: string): number | null {
  // Priority: labeled fields
  const labeledPatterns = [
    /odometer[:\s]*(\d{1,3}(?:,\d{3})*|\d+)\s*(?:km|kms)?/i,
    /kilometres?[:\s]*(\d{1,3}(?:,\d{3})*|\d+)/i,
    /mileage[:\s]*(\d{1,3}(?:,\d{3})*|\d+)/i,
    /kms?[:\s]*(\d{1,3}(?:,\d{3})*|\d+)/i,
  ];
  
  for (const pattern of labeledPatterns) {
    const match = text.match(pattern);
    if (match) {
      const km = parseInt(match[1].replace(/,/g, ""), 10);
      if (km >= 50 && km <= 900000) return km;
    }
  }
  
  // Fallback: generic pattern (less reliable)
  const fallbackMatch = text.match(/(\d{1,3}(?:,\d{3})+|\d{4,6})\s*(?:km|kms)\b/i);
  if (fallbackMatch) {
    const km = parseInt(fallbackMatch[1].replace(/,/g, ""), 10);
    if (km >= 50 && km <= 900000) return km;
  }
  
  return null;
}

// Extract labeled price with sanity bounds
function parseLabeledPrice(text: string, ...labels: string[]): number | null {
  for (const label of labels) {
    // Try: "Label: $XX,XXX" or "Label $XX,XXX"
    const pattern = new RegExp(`${label}[:\\s]*\\$?([\\d,]+)`, "i");
    const match = text.match(pattern);
    if (match) {
      const price = parseInt(match[1].replace(/,/g, ""), 10);
      if (price >= 500 && price <= 1000000) return price;
    }
  }
  return null;
}

// Extract any price (fallback)
function parseAnyPrice(text: string): number | null {
  // Skip common false positives
  const skipPatterns = /(?:fee|deposit|admin|charge|gst|stamp duty|transfer)/i;
  
  // Find all dollar amounts
  const matches = text.matchAll(/\$\s*([\d,]+)/g);
  for (const match of matches) {
    // Get context around the match
    const start = Math.max(0, match.index! - 30);
    const context = text.slice(start, match.index! + match[0].length);
    
    if (skipPatterns.test(context)) continue;
    
    const price = parseInt(match[1].replace(/,/g, ""), 10);
    if (price >= 500 && price <= 1000000) return price;
  }
  return null;
}

// Parse URL for year/make/model (most reliable source)
function parseFromUrl(url: string): { year: number | null; make: string | null; model: string | null } {
  try {
    const urlPath = new URL(url).pathname;
    // Format: /used/details/cars/YEAR-MAKE-MODEL-VARIANT/ID
    const slugMatch = urlPath.match(/\/used\/details\/cars\/(\d{4})-([a-z]+)-([a-z0-9]+)/i);
    
    if (slugMatch) {
      return {
        year: parseInt(slugMatch[1], 10),
        make: slugMatch[2].charAt(0).toUpperCase() + slugMatch[2].slice(1).toLowerCase(),
        model: slugMatch[3].charAt(0).toUpperCase() + slugMatch[3].slice(1).toLowerCase(),
      };
    }
  } catch {
    // Invalid URL
  }
  return { year: null, make: null, model: null };
}

// Extract variant from title (after stripping year/make/model)
function parseVariantFromTitle(title: string, year: number | null, make: string | null, model: string | null): string | null {
  if (!title || !year || !make || !model) return null;
  
  // Remove year, make, model from title
  let remaining = title
    .replace(new RegExp(`\\b${year}\\b`, "gi"), "")
    .replace(new RegExp(`\\b${make}\\b`, "gi"), "")
    .replace(new RegExp(`\\b${model}\\b`, "gi"), "")
    .replace(/pickles|auction|sale|vehicle/gi, "")
    .trim();
  
  // Clean up whitespace and punctuation
  remaining = remaining.replace(/^[\s\-–—|:]+|[\s\-–—|:]+$/g, "").trim();
  
  // Limit to reasonable length
  if (remaining.length > 0 && remaining.length <= 50) {
    return remaining.toUpperCase();
  }
  
  // Fallback: known variant keywords
  const variantPatterns = [
    /\b(SR5|GXL|GX|VX|SAHARA|KAKADU|ROGUE|RUGGED|WORKMATE)\b/i,
    /\b(WILDTRAK|RAPTOR|XLT|XLS|XL|TITANIUM|PLATINUM|AMBIENTE|TREND)\b/i,
    /\b(X-TERRAIN|LS-U|LS-M|LS-T|PRO-4X|N-TREK|WARRIOR)\b/i,
    /\b(HIGHLANDER|ELITE|ACTIVE|PREMIUM|EXCEED|CRUSADE)\b/i,
    /\b(GT|GR|RS|SS|SSV|SV6|LTZ|Z71|STORM)\b/i,
  ];
  
  for (const pattern of variantPatterns) {
    const match = title.match(pattern);
    if (match) return match[1].toUpperCase();
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
    if (pattern.test(text)) return value;
  }
  return null;
}

// Extract location and state
function parseLocation(text: string): { location: string | null; state: string | null } {
  const stateMap: Record<string, string> = {
    "Yatala": "QLD", "Eagle Farm": "QLD", "Brisbane": "QLD",
    "Altona": "VIC", "Dandenong": "VIC", "Melbourne": "VIC",
    "Sydney": "NSW", "Silverwater": "NSW",
    "Salisbury Plain": "SA", "Adelaide": "SA",
    "Winnellie": "NT", "Darwin": "NT",
    "Moonah": "TAS", "Hobart": "TAS",
    "Welshpool": "WA", "Belmont": "WA", "Hazelmere": "WA", "Canning Vale": "WA", "Perth": "WA",
  };
  
  // Check known locations
  for (const [loc, state] of Object.entries(stateMap)) {
    if (new RegExp(`\\b${loc}\\b`, "i").test(text)) {
      return { location: loc, state };
    }
  }
  
  // Fallback: state abbreviation
  const stateMatch = text.match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/i);
  if (stateMatch) {
    return { location: null, state: stateMatch[1].toUpperCase() };
  }
  
  return { location: null, state: null };
}

// Extract sale status
function parseSaleStatus(text: string): string | null {
  if (/\bsold\b/i.test(text)) return "sold";
  if (/\bpassed[\s\-]?in\b/i.test(text)) return "passed_in";
  if (/\bwithdrawn\b/i.test(text)) return "withdrawn";
  if (/\b(?:live|ending|bidding)\s*(?:now|soon)?\b/i.test(text)) return "live";
  if (/\bupcoming\b|\bstarts?\s*in\b/i.test(text)) return "upcoming";
  return null;
}

// Parse auction close datetime
function parseCloseDate(text: string): string | null {
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  // Pattern: DD/MM/YYYY HH:MM AM/PM
  const slashPattern = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i;
  const slashMatch = text.match(slashPattern);
  if (slashMatch) {
    const [, day, month, year, hour, min, ampm] = slashMatch;
    let h = parseInt(hour);
    if (ampm?.toUpperCase() === "PM" && h < 12) h += 12;
    if (ampm?.toUpperCase() === "AM" && h === 12) h = 0;
    const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), h, parseInt(min));
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // Pattern: DD Mon YYYY HH:MM
  const monthPattern = /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\s+(\d{4}))?\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i;
  const monthMatch = text.match(monthPattern);
  if (monthMatch) {
    const [, day, monthStr, year, hour, min, ampm] = monthMatch;
    const monthNum = months[monthStr.toLowerCase()];
    const yearNum = year ? parseInt(year) : new Date().getFullYear();
    let h = parseInt(hour);
    if (ampm?.toUpperCase() === "PM" && h < 12) h += 12;
    if (ampm?.toUpperCase() === "AM" && h === 12) h = 0;
    const d = new Date(yearNum, monthNum, parseInt(day), h, parseInt(min));
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  return null;
}

// Extract title from HTML/markdown
function extractTitle(content: string): string | null {
  // Try meta title
  const metaMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (metaMatch) return metaMatch[1].trim();
  
  // Try og:title
  const ogMatch = content.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i);
  if (ogMatch) return ogMatch[1].trim();
  
  // Try H1
  const h1Match = content.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1Match) return h1Match[1].trim();
  
  return null;
}

// Main extraction function
function extractFromContent(url: string, content: string): ExtractedData {
  // URL is most reliable for year/make/model
  const urlData = parseFromUrl(url);
  const title = extractTitle(content);
  
  const year = urlData.year || parseYear(content);
  const make = urlData.make;
  const model = urlData.model;
  
  // Variant from title (stripped of year/make/model)
  const variant_raw = parseVariantFromTitle(title || "", year, make, model);
  
  // Labeled fields
  const km = parseKm(content);
  const { location, state } = parseLocation(content);
  
  // Price extraction - prioritize labeled
  const guide_price = parseLabeledPrice(content, "guide", "estimate", "estimated");
  const sold_price = parseLabeledPrice(content, "sold", "hammer", "final bid", "winning bid");
  const reserve_price = parseLabeledPrice(content, "reserve");
  const asking_price = parseLabeledPrice(content, "buy now", "buy-now", "price", "current bid") || parseAnyPrice(content);
  
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

    // ATOMIC CLAIM via RPC (parallel-safe with FOR UPDATE SKIP LOCKED)
    const { data: claimedItems, error: claimErr } = await supabase.rpc(
      "claim_pickles_detail_batch",
      {
        p_batch_size: batch_size,
        p_max_retries: max_retries,
        p_run_id: runId,
      }
    );

    if (claimErr) {
      throw new Error(`Claim failed: ${claimErr.message}`);
    }

    if (!claimedItems || claimedItems.length === 0) {
      console.log("[DETAIL] No items to process");
      
      await supabase.from("pickles_detail_runs").update({
        status: "completed",
        duration_ms: Date.now() - startTime,
      }).eq("id", runId);
      
      return new Response(
        JSON.stringify({ success: true, run_id: runId, message: "No pending items" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[DETAIL] Claimed ${claimedItems.length} items`);

    // Process metrics
    let detailFetched = 0;
    let parsedOk = 0;
    let rejected = 0;
    const rejectReasons: Record<string, number> = {};

    for (const item of claimedItems) {
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

        const httpStatus = scrapeRes.status;

        if (!scrapeRes.ok) {
          const errText = await scrapeRes.text();
          console.error(`[DETAIL] Scrape failed for ${stockId}:`, errText);
          
          await supabase.from("pickles_detail_queue").update({
            crawl_status: "failed",
            crawl_attempts: item.crawl_attempts + 1,
            last_crawl_at: new Date().toISOString(),
            last_crawl_error: `Firecrawl ${httpStatus}`,
            last_crawl_http_status: httpStatus,
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
        const contentLen = content.length;
        
        if (contentLen < 200) {
          console.warn(`[DETAIL] Sparse content for ${stockId}: ${contentLen} chars`);
          
          await supabase.from("pickles_detail_queue").update({
            crawl_status: "failed",
            crawl_attempts: item.crawl_attempts + 1,
            last_crawl_at: new Date().toISOString(),
            last_crawl_error: "Sparse content",
            last_crawl_http_status: httpStatus,
            content_len: contentLen,
          }).eq("id", itemId);
          
          rejectReasons["sparse_content"] = (rejectReasons["sparse_content"] || 0) + 1;
          rejected++;
          continue;
        }

        // Extract data
        const extracted = extractFromContent(detailUrl, content);
        
        // Validate hard requirements
        if (!extracted.year || !extracted.make || !extracted.model) {
          const missing = [
            !extracted.year && "year",
            !extracted.make && "make",
            !extracted.model && "model",
          ].filter(Boolean).join(", ");
          
          console.warn(`[DETAIL] Hard reject ${stockId}: missing ${missing}`);
          
          await supabase.from("pickles_detail_queue").update({
            crawl_status: "failed",
            crawl_attempts: item.crawl_attempts + 1,
            last_crawl_at: new Date().toISOString(),
            last_crawl_error: `Missing: ${missing}`,
            last_crawl_http_status: httpStatus,
            content_len: contentLen,
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
          last_crawl_http_status: httpStatus,
          content_len: contentLen,
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
      inserted: 0,
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
        claimed: claimedItems.length,
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
