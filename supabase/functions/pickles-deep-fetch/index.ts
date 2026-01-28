import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * PICKLES DEEP-FETCH - Lane 2: Enrich matched stubs with detail page data
 * 
 * Fetches detail pages for stubs that matched hunts,
 * extracts variant/fuel/transmission/condition, updates stub_anchors,
 * and creates BUY_OPPORTUNITY records.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-AU,en;q=0.9",
};

interface EnrichedData {
  variant_raw: string | null;
  fuel: string | null;
  transmission: string | null;
  drivetrain: string | null;
  price: number | null;
  price_type: string | null; // 'buy_now', 'current_bid', 'guide', 'sold'
  km_verified: number | null;
  condition_notes: string[];
  wovr_indicator: boolean;
  keys_present: boolean | null;
  starts_drives: boolean | null;
  damage_noted: boolean;
}

// Extract detailed fields from detail page HTML
function extractDetailFields(html: string, titleHint?: string): EnrichedData {
  const result: EnrichedData = {
    variant_raw: null,
    fuel: null,
    transmission: null,
    drivetrain: null,
    price: null,
    price_type: null,
    km_verified: null,
    condition_notes: [],
    wovr_indicator: false,
    keys_present: null,
    starts_drives: null,
    damage_noted: false,
  };

  // Extract variant from title - stop at "##" if present
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i) || 
                     html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (titleMatch) {
    let title = titleMatch[1];
    // Remove year and make at start, keep model+variant
    const yearMakePattern = /^\d{4}\s+\w+\s+/;
    title = title.replace(yearMakePattern, '');
    // Stop at ## or | or –|-
    title = title.split(/##|\||–|-/)[0].trim();
    result.variant_raw = title || null;
  }

  // Extract KM - look for labeled fields
  const kmPatterns = [
    /odometer[:\s]*(\d{1,3}(?:,\d{3})*)\s*km/i,
    /kilometres?[:\s]*(\d{1,3}(?:,\d{3})*)/i,
    /km[:\s]*(\d{1,3}(?:,\d{3})*)/i,
    /"odometer"[:\s]*"?(\d+)"?/i,
  ];
  for (const pattern of kmPatterns) {
    const match = html.match(pattern);
    if (match) {
      result.km_verified = parseInt(match[1].replace(/,/g, ''));
      break;
    }
  }

  // Extract price - prioritize in order: Buy Now > Current Bid > Guide > Sold
  const pricePatterns = [
    { pattern: /buy\s*now[:\s]*\$?([\d,]+)/i, type: 'buy_now' },
    { pattern: /current\s*bid[:\s]*\$?([\d,]+)/i, type: 'current_bid' },
    { pattern: /guide[:\s]*\$?([\d,]+)/i, type: 'guide' },
    { pattern: /sold[:\s]*\$?([\d,]+)/i, type: 'sold' },
    { pattern: /price[:\s]*\$?([\d,]+)/i, type: 'price' },
  ];
  for (const { pattern, type } of pricePatterns) {
    const match = html.match(pattern);
    if (match) {
      result.price = parseInt(match[1].replace(/,/g, ''));
      result.price_type = type;
      break;
    }
  }

  // Extract fuel type
  const fuelPatterns = [
    /fuel[:\s]*(petrol|diesel|hybrid|electric|lpg|phev)/i,
    /(petrol|diesel|hybrid|electric|lpg|phev)\s*engine/i,
  ];
  for (const pattern of fuelPatterns) {
    const match = html.match(pattern);
    if (match) {
      result.fuel = match[1].toLowerCase();
      break;
    }
  }

  // Extract transmission
  const transPatterns = [
    /transmission[:\s]*(automatic|manual|cvt|dct)/i,
    /(automatic|manual|cvt)\s*transmission/i,
    /\b(auto|manual)\b/i,
  ];
  for (const pattern of transPatterns) {
    const match = html.match(pattern);
    if (match) {
      const trans = match[1].toLowerCase();
      result.transmission = trans === 'auto' ? 'automatic' : trans;
      break;
    }
  }

  // Extract drivetrain
  const drivePatterns = [
    /drive[:\s]*(awd|4wd|fwd|rwd|2wd|4x4)/i,
    /\b(awd|4wd|fwd|rwd|4x4)\b/i,
  ];
  for (const pattern of drivePatterns) {
    const match = html.match(pattern);
    if (match) {
      result.drivetrain = match[1].toUpperCase();
      break;
    }
  }

  // Check for condition indicators
  if (/wovr|write[ -]?off|stat[ -]?write/i.test(html)) {
    result.wovr_indicator = true;
    result.condition_notes.push('WOVR indicator');
  }
  if (/damage|accident|repair/i.test(html)) {
    result.damage_noted = true;
    result.condition_notes.push('Damage noted');
  }
  if (/keys?\s*(present|included|available)/i.test(html)) {
    result.keys_present = true;
  } else if (/no\s*keys?|keys?\s*(missing|not)/i.test(html)) {
    result.keys_present = false;
    result.condition_notes.push('Keys missing');
  }
  if (/starts?\s*(and\s*)?drives?/i.test(html)) {
    result.starts_drives = true;
  } else if (/(does\s*not|doesn'?t)\s*start/i.test(html)) {
    result.starts_drives = false;
    result.condition_notes.push('Does not start');
  }

  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json().catch(() => ({}));
    const {
      batch_size = 20,
      dry_run = false,
    } = body;

    console.log(`[DEEP] Starting deep-fetch: batch=${batch_size}`);

    const metrics = {
      stubs_processed: 0,
      enriched: 0,
      opportunities_created: 0,
      exceptions_queued: 0,
      errors: [] as string[],
    };

    // Get matched stubs that need deep-fetch
    const { data: stubs, error: stubError } = await supabase
      .from("stub_anchors")
      .select("*")
      .eq("status", "matched")
      .eq("deep_fetch_triggered", true)
      .is("deep_fetch_at", null)
      .or("status.eq.pending,confidence.in.(low,med)")
      .order("first_seen_at", { ascending: false })
      .limit(batch_size);

    // Fallback: get stubs with deep_fetch_triggered but not enriched yet
    let stubsToProcess = stubs || [];
    if (stubsToProcess.length === 0) {
      const { data: fallbackStubs } = await supabase
        .from("stub_anchors")
        .select("*")
        .eq("deep_fetch_triggered", true)
        .neq("status", "enriched")
        .neq("status", "exception")
        .order("updated_at", { ascending: true })
        .limit(batch_size);
      stubsToProcess = fallbackStubs || [];
    }

    if (stubsToProcess.length === 0) {
      console.log("[DEEP] No stubs to deep-fetch");
      return new Response(
        JSON.stringify({ success: true, message: "No stubs to process", metrics }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    metrics.stubs_processed = stubsToProcess.length;
    console.log(`[DEEP] Processing ${stubsToProcess.length} stubs`);

    for (const stub of stubsToProcess) {
      try {
        // Fetch detail page
        const response = await fetch(stub.detail_url, {
          headers: BROWSER_HEADERS,
          redirect: 'follow',
        });

        if (!response.ok) {
          // Queue as exception
          if (!dry_run) {
            await supabase.from("va_exceptions").insert({
              stub_anchor_id: stub.id,
              url: stub.detail_url,
              source: stub.source,
              missing_fields: ['detail_page'],
              reason: `HTTP ${response.status}`,
            });
            await supabase.from("stub_anchors").update({ status: "exception" }).eq("id", stub.id);
          }
          metrics.exceptions_queued++;
          continue;
        }

        const html = await response.text();
        const enriched = extractDetailFields(html);

        if (!dry_run) {
          // Update stub_anchor with enriched data
          await supabase.from("stub_anchors").update({
            status: "enriched",
            km: enriched.km_verified || stub.km,
            updated_at: new Date().toISOString(),
          }).eq("id", stub.id);

          // If stub has matched hunts, create hunt_unified_candidates entry
          if (stub.matched_hunt_ids && stub.matched_hunt_ids.length > 0) {
            for (const huntId of stub.matched_hunt_ids) {
              // Get spec details
              const { data: spec } = await supabase
                .from("dealer_specs")
                .select("*")
                .eq("id", huntId)
                .single();

              if (spec) {
                // Calculate final score
                let score = 100;
                if (enriched.km_verified && spec.km_max && enriched.km_verified > spec.km_max) {
                  score -= 20;
                }
                if (enriched.wovr_indicator) {
                  score -= 30;
                }
                if (enriched.damage_noted) {
                  score -= 15;
                }

                // Upsert to hunt candidates or external candidates
                await supabase.from("hunt_external_candidates").upsert({
                  hunt_id: huntId,
                  source_name: "pickles",
                  source_url: stub.detail_url,
                  dedup_key: `pickles:${stub.source_stock_id}`,
                  title: enriched.variant_raw || `${stub.year} ${stub.make} ${stub.model}`,
                  year: stub.year,
                  make: stub.make,
                  model: stub.model,
                  variant_raw: enriched.variant_raw,
                  km: enriched.km_verified || stub.km,
                  asking_price: enriched.price,
                  location: stub.location,
                  match_score: score,
                  confidence: stub.confidence,
                  decision: score >= 70 ? "BUY" : score >= 50 ? "WATCH" : "SKIP",
                  discovered_at: new Date().toISOString(),
                  is_listing: true,
                  listing_kind: "auction",
                }, {
                  onConflict: "hunt_id,dedup_key",
                });

                metrics.opportunities_created++;
              }
            }
          }
        }

        metrics.enriched++;

        // Small delay between fetches
        await new Promise(r => setTimeout(r, 300));

      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        console.error(`[DEEP] Error processing ${stub.detail_url}:`, error);
        metrics.errors.push(`${stub.source_stock_id}: ${error}`);

        if (!dry_run) {
          await supabase.from("va_exceptions").insert({
            stub_anchor_id: stub.id,
            url: stub.detail_url,
            source: stub.source,
            missing_fields: ['parse_error'],
            reason: error,
          });
          await supabase.from("stub_anchors").update({ status: "exception" }).eq("id", stub.id);
        }
        metrics.exceptions_queued++;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[DEEP] Completed in ${duration}ms:`, metrics);

    return new Response(
      JSON.stringify({
        success: true,
        duration_ms: duration,
        metrics,
        dry_run,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[DEEP] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
