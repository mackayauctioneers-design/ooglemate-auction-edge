import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * GRAYS DEEP-FETCH - Lane 2: Enrich matched stubs with detail page data
 * 
 * Production hardened (following Pickles/Manheim pattern):
 * - Uses pickles_detail_queue as the driver (source='grays')
 * - Atomic claim via direct update (FOR UPDATE SKIP LOCKED equivalent)
 * - Batch fetches dealer_specs (no N+1 queries)
 * - State machine: pending → processing → done/error with retry_count
 * - MUST create vehicle_listings BEFORE dealer_spec_matches (FK constraint)
 * - Schedule: every 10 minutes
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-AU,en;q=0.9",
  "Referer": "https://www.grays.com/",
};

interface EnrichedData {
  variant_raw: string | null;
  fuel: string | null;
  transmission: string | null;
  drivetrain: string | null;
  price: number | null;
  price_type: string | null;
  km_verified: number | null;
  condition_notes: string[];
  wovr_indicator: boolean;
  keys_present: boolean | null;
  starts_drives: boolean | null;
  damage_noted: boolean;
  auction_datetime: string | null;
  location: string | null;
  reserve_status: string | null;
}

interface QueueItem {
  id: string;
  source: string;
  source_listing_id: string;
  detail_url: string;
  crawl_status: string;
  retry_count: number;
  stub_anchor_id: string | null;
}

/**
 * Extract detail fields from Grays detail page HTML
 */
function extractDetailFields(html: string): EnrichedData {
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
    auction_datetime: null,
    location: null,
    reserve_status: null,
  };

  // Extract title/variant from h1 or title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i) || 
                     html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (titleMatch) {
    let title = titleMatch[1];
    // Strip year and make from beginning
    const yearMakePattern = /^\d{4}\s+\w+\s+/;
    title = title.replace(yearMakePattern, '');
    // Strip common suffixes
    title = title.split(/\||-|Grays/)[0].trim();
    result.variant_raw = title || null;
  }

  // Extract KM/Odometer
  const kmPatterns = [
    /odometer[:\s]*(\d{1,3}(?:,\d{3})*)\s*km/i,
    /kilometres?[:\s]*(\d{1,3}(?:,\d{3})*)/i,
    /km[:\s]*(\d{1,3}(?:,\d{3})*)/i,
    /"odometer"[:\s]*"?(\d+)"?/i,
    /(\d{1,3}(?:,\d{3})*)\s*km\b/i,
  ];
  for (const pattern of kmPatterns) {
    const match = html.match(pattern);
    if (match) {
      const km = parseInt(match[1].replace(/,/g, ''));
      // Sanity check: 50 - 900,000 km
      if (km >= 50 && km <= 900000) {
        result.km_verified = km;
        break;
      }
    }
  }

  // Extract price (current bid, reserve, buy now, sold)
  const pricePatterns = [
    { pattern: /current\s*bid[:\s]*\$?([\d,]+)/i, type: 'current_bid' },
    { pattern: /reserve[:\s]*\$?([\d,]+)/i, type: 'reserve' },
    { pattern: /guide[:\s]*\$?([\d,]+)/i, type: 'guide' },
    { pattern: /buy\s*now[:\s]*\$?([\d,]+)/i, type: 'buy_now' },
    { pattern: /sold[:\s]*\$?([\d,]+)/i, type: 'sold' },
    { pattern: /\$\s*([\d,]+)/i, type: 'price' },
  ];
  for (const { pattern, type } of pricePatterns) {
    const match = html.match(pattern);
    if (match) {
      const price = parseInt(match[1].replace(/,/g, ''));
      // Sanity check: $500 - $500,000
      if (price >= 500 && price <= 500000) {
        result.price = price;
        result.price_type = type;
        break;
      }
    }
  }

  // Extract fuel type
  const fuelPatterns = [
    /fuel\s*type[:\s]*(petrol|diesel|hybrid|electric|lpg|phev|unleaded|turbo diesel)/i,
    /fuel[:\s]*(petrol|diesel|hybrid|electric|lpg|phev|unleaded|turbo diesel)/i,
    /(petrol|diesel|hybrid|electric|lpg|phev)\s*engine/i,
    /turbo\s*diesel/i,
  ];
  for (const pattern of fuelPatterns) {
    const match = html.match(pattern);
    if (match) {
      let fuel = (match[1] || 'diesel').toLowerCase();
      if (fuel === 'turbo diesel') fuel = 'diesel';
      if (fuel === 'unleaded' || fuel === 'premium unleaded') fuel = 'petrol';
      result.fuel = fuel;
      break;
    }
  }

  // Extract transmission
  const transPatterns = [
    /transmission[:\s]*(automatic|manual|cvt|dct|sports automatic)/i,
    /(automatic|manual|cvt)\s*transmission/i,
    /\b(auto|manual|cvt)\b/i,
    /automatic\s*-\s*\d+\s*speed/i,
  ];
  for (const pattern of transPatterns) {
    const match = html.match(pattern);
    if (match) {
      let trans = (match[1] || 'automatic').toLowerCase();
      if (trans === 'auto' || trans.includes('automatic')) trans = 'automatic';
      if (trans === 'sports automatic') trans = 'automatic';
      result.transmission = trans;
      break;
    }
  }

  // Extract drivetrain
  const drivePatterns = [
    /drive\s*type[:\s]*(awd|4wd|fwd|rwd|2wd|4x4|4x2)/i,
    /drive[:\s]*(awd|4wd|fwd|rwd|4x4|4x2)/i,
    /\b(awd|4wd|fwd|rwd|4x4)\b/i,
  ];
  for (const pattern of drivePatterns) {
    const match = html.match(pattern);
    if (match) {
      result.drivetrain = match[1].toUpperCase();
      break;
    }
  }

  // Extract location (state)
  const locationPatterns = [
    /location[:\s]*([^,<]+),?\s*(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)/i,
    /\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/i,
  ];
  for (const pattern of locationPatterns) {
    const match = html.match(pattern);
    if (match) {
      result.location = match[1].trim().toUpperCase();
      break;
    }
  }

  // Reserve status
  if (/no\s*reserve/i.test(html)) {
    result.reserve_status = 'no_reserve';
  } else if (/reserve\s*met/i.test(html)) {
    result.reserve_status = 'reserve_met';
  } else if (/reserve\s*not\s*met/i.test(html)) {
    result.reserve_status = 'reserve_not_met';
  } else if (/reserve\s*near/i.test(html)) {
    result.reserve_status = 'reserve_near';
  }

  // Condition indicators
  if (/wovr|write[ -]?off|stat[ -]?write/i.test(html)) {
    result.wovr_indicator = true;
    result.condition_notes.push('WOVR indicator');
  }
  if (/salvage/i.test(html)) {
    result.damage_noted = true;
    result.condition_notes.push('Salvage');
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
  const workerId = `grays-${crypto.randomUUID().slice(0, 8)}`;

  try {
    const body = await req.json().catch(() => ({}));
    const {
      batch_size = 20,
      max_retries = 3,
      dry_run = false,
    } = body;

    console.log(`[GRAYS-DEEP] Starting deep-fetch: batch=${batch_size}, worker=${workerId}`);

    const metrics = {
      items_claimed: 0,
      enriched: 0,
      vehicle_listings_created: 0,
      dealer_spec_matches_created: 0,
      errors_count: 0,
      error_details: [] as string[],
    };

    // Claim Grays queue items (source='grays')
    const { data: claimedItems, error: claimError } = await supabase
      .from("pickles_detail_queue")
      .update({
        crawl_status: "processing",
        claimed_at: new Date().toISOString(),
        claimed_by: workerId,
      })
      .eq("source", "grays")
      .eq("crawl_status", "pending")
      .is("claimed_at", null)
      .lt("retry_count", max_retries)
      .limit(batch_size)
      .select("id, source, source_listing_id, detail_url, crawl_status, retry_count, stub_anchor_id");

    if (claimError) {
      console.error("[GRAYS-DEEP] Claim error:", claimError.message);
      throw new Error(`Claim failed: ${claimError.message}`);
    }

    const itemsToProcess: QueueItem[] = claimedItems || [];

    if (itemsToProcess.length === 0) {
      console.log("[GRAYS-DEEP] No Grays items to process");
      return new Response(
        JSON.stringify({ success: true, message: "No Grays items to process", metrics }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    metrics.items_claimed = itemsToProcess.length;
    console.log(`[GRAYS-DEEP] Processing ${itemsToProcess.length} Grays queue items`);

    // Batch fetch all related stub_anchors to get matched_hunt_ids
    const stubAnchorIds = itemsToProcess
      .map((item: QueueItem) => item.stub_anchor_id)
      .filter(Boolean);
    
    const stubsMap = new Map<string, { matched_hunt_ids: string[]; year: number; make: string; model: string; km: number; location: string }>();
    
    if (stubAnchorIds.length > 0) {
      const { data: stubs } = await supabase
        .from("stub_anchors")
        .select("id, matched_hunt_ids, year, make, model, km, location")
        .in("id", stubAnchorIds);
      
      if (stubs) {
        for (const s of stubs) {
          stubsMap.set(s.id, {
            matched_hunt_ids: s.matched_hunt_ids || [],
            year: s.year,
            make: s.make,
            model: s.model,
            km: s.km,
            location: s.location,
          });
        }
      }
    }

    // Batch fetch all dealer_specs for matched hunt IDs (no N+1)
    const allHuntIds = new Set<string>();
    for (const stub of stubsMap.values()) {
      for (const id of stub.matched_hunt_ids) {
        allHuntIds.add(id);
      }
    }

    const specsMap = new Map<string, Record<string, unknown>>();
    
    if (allHuntIds.size > 0) {
      const { data: specs } = await supabase
        .from("dealer_specs")
        .select("*")
        .in("id", Array.from(allHuntIds));
      
      if (specs) {
        for (const spec of specs) {
          specsMap.set(spec.id, spec);
        }
      }
      console.log(`[GRAYS-DEEP] Pre-fetched ${specsMap.size} dealer_specs`);
    }

    // Process each claimed queue item
    for (const item of itemsToProcess) {
      const queueId = item.id;
      const detailUrl = item.detail_url;
      const sourceStockId = item.source_listing_id;
      
      try {
        const response = await fetch(detailUrl, {
          headers: BROWSER_HEADERS,
          redirect: 'follow',
        });

        if (!response.ok) {
          const errorMsg = `HTTP ${response.status} for listing ${sourceStockId}`;
          console.warn(`[GRAYS-DEEP] ${errorMsg}`);
          metrics.error_details.push(errorMsg);
          
          if (!dry_run) {
            await supabase
              .from("pickles_detail_queue")
              .update({
                crawl_status: "error",
                last_crawl_error: `HTTP ${response.status}`,
                last_crawl_at: new Date().toISOString(),
                retry_count: item.retry_count + 1,
                claimed_at: null,
                claimed_by: null,
              })
              .eq("id", queueId);
          }
          metrics.errors_count++;
          continue;
        }

        const html = await response.text();
        const enriched = extractDetailFields(html);

        if (!dry_run) {
          // Update queue item as done
          await supabase
            .from("pickles_detail_queue")
            .update({
              crawl_status: "done",
              last_crawl_at: new Date().toISOString(),
              last_crawl_error: null,
              claimed_at: null,
              claimed_by: null,
              km: enriched.km_verified,
              asking_price: enriched.price,
              variant_raw: enriched.variant_raw,
            })
            .eq("id", queueId);

          // Update stub_anchor if linked
          if (item.stub_anchor_id) {
            await supabase.from("stub_anchors").update({
              status: "enriched",
              km: enriched.km_verified,
              deep_fetch_completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }).eq("id", item.stub_anchor_id);

            // Create dealer_spec_matches - MUST create vehicle_listing FIRST (FK constraint)
            const stubInfo = stubsMap.get(item.stub_anchor_id);
            if (stubInfo && stubInfo.matched_hunt_ids.length > 0) {
              // STEP 1: Upsert vehicle_listing FIRST (FK constraint requirement)
              const listingId = `grays:${sourceStockId}`;
              const listingData = {
                listing_id: listingId,
                source: 'grays',
                make: stubInfo.make || 'Unknown',
                model: stubInfo.model || 'Unknown',
                year: stubInfo.year || 2020,
                km: enriched.km_verified || stubInfo.km,
                variant_raw: enriched.variant_raw,
                asking_price: enriched.price,
                listing_url: detailUrl,
                location: enriched.location || stubInfo.location,
                status: 'catalogue',
                source_class: 'auction',
                seller_type: 'dealer',
                first_seen_at: new Date().toISOString(),
                last_seen_at: new Date().toISOString(),
              };

              const { data: listingResult, error: listingError } = await supabase
                .from("vehicle_listings")
                .upsert(listingData, {
                  onConflict: "listing_id,source",
                })
                .select("id")
                .single();

              if (listingError) {
                const errorMsg = `vehicle_listings upsert failed for ${listingId}: ${listingError.message}`;
                console.error(`[GRAYS-DEEP] ${errorMsg}`);
                metrics.error_details.push(errorMsg);
                metrics.errors_count++;
                continue;
              }

              const listingUuid = listingResult?.id;
              if (!listingUuid) {
                const errorMsg = `No listing UUID returned for ${listingId}`;
                console.error(`[GRAYS-DEEP] ${errorMsg}`);
                metrics.error_details.push(errorMsg);
                metrics.errors_count++;
                continue;
              }

              metrics.vehicle_listings_created++;
              console.log(`[GRAYS-DEEP] Created vehicle_listing: ${listingId} -> UUID ${listingUuid}`);

              // STEP 2: Create dealer_spec_matches for each matched spec
              for (const specId of stubInfo.matched_hunt_ids) {
                const spec = specsMap.get(specId);
                if (!spec) continue;

                let score = 100;
                if (enriched.km_verified && (spec.km_max as number) && enriched.km_verified > (spec.km_max as number)) {
                  score -= 20;
                }
                if (enriched.wovr_indicator) score -= 30;
                if (enriched.damage_noted) score -= 15;

                const matchData = {
                  dealer_spec_id: specId,
                  listing_uuid: listingUuid,
                  make: stubInfo.make,
                  model: stubInfo.model,
                  year: stubInfo.year,
                  km: enriched.km_verified || stubInfo.km,
                  asking_price: enriched.price,
                  listing_url: detailUrl,
                  variant_used: enriched.variant_raw,
                  source_class: 'auction',
                  region_id: enriched.location || stubInfo.location,
                  match_score: score,
                  deal_label: score >= 70 ? "BUY" : score >= 50 ? "WATCH" : "SKIP",
                  matched_at: new Date().toISOString(),
                };

                const { error: matchError } = await supabase
                  .from("dealer_spec_matches")
                  .upsert(matchData, {
                    onConflict: "dealer_spec_id,listing_uuid",
                  });

                if (matchError) {
                  const errorMsg = `dealer_spec_matches upsert failed for spec=${specId}, listing=${listingUuid}: ${matchError.message}`;
                  console.error(`[GRAYS-DEEP] ${errorMsg}`);
                  metrics.error_details.push(errorMsg);
                } else {
                  metrics.dealer_spec_matches_created++;
                  console.log(`[GRAYS-DEEP] Created match: spec=${specId}, listing=${listingUuid}`);
                }
              }
            }
          }
        }

        metrics.enriched++;
        // Polite delay between fetches
        await new Promise(r => setTimeout(r, 400));

      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        const errorMsg = `Exception processing ${sourceStockId}: ${error}`;
        console.error(`[GRAYS-DEEP] ${errorMsg}`);
        metrics.error_details.push(errorMsg);

        if (!dry_run) {
          await supabase
            .from("pickles_detail_queue")
            .update({
              crawl_status: "error",
              last_crawl_error: error,
              last_crawl_at: new Date().toISOString(),
              retry_count: item.retry_count + 1,
              claimed_at: null,
              claimed_by: null,
            })
            .eq("id", queueId);
        }
        metrics.errors_count++;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[GRAYS-DEEP] Completed in ${duration}ms:`, metrics);

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
    console.error("[GRAYS-DEEP] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
