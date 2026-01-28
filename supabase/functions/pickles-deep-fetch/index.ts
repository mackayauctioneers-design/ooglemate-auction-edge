import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * PICKLES DEEP-FETCH - Lane 2: Enrich matched stubs with detail page data
 * 
 * Production hardened:
 * - Uses pickles_detail_queue as the driver (not stub_anchors)
 * - Atomic claim via RPC (FOR UPDATE SKIP LOCKED)
 * - Batch fetches dealer_specs (no N+1 queries)
 * - State machine: pending → processing → done/error with retry_count
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
  price_type: string | null;
  km_verified: number | null;
  condition_notes: string[];
  wovr_indicator: boolean;
  keys_present: boolean | null;
  starts_drives: boolean | null;
  damage_noted: boolean;
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
  };

  const titleMatch = html.match(/<title>([^<]+)<\/title>/i) || 
                     html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (titleMatch) {
    let title = titleMatch[1];
    const yearMakePattern = /^\d{4}\s+\w+\s+/;
    title = title.replace(yearMakePattern, '');
    title = title.split(/##|\||–|-/)[0].trim();
    result.variant_raw = title || null;
  }

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
  const workerId = `worker-${crypto.randomUUID().slice(0, 8)}`;

  try {
    const body = await req.json().catch(() => ({}));
    const {
      batch_size = 20,
      max_retries = 3,
      dry_run = false,
    } = body;

    console.log(`[DEEP] Starting deep-fetch: batch=${batch_size}, worker=${workerId}`);

    const metrics = {
      items_claimed: 0,
      enriched: 0,
      opportunities_created: 0,
      errors_count: 0,
      retried: 0,
    };

    // Atomic claim via RPC (FOR UPDATE SKIP LOCKED)
    const { data: claimedItems, error: claimError } = await supabase.rpc(
      "claim_detail_queue_batch",
      {
        p_batch_size: batch_size,
        p_claim_by: workerId,
        p_max_retries: max_retries,
      }
    );

    if (claimError) {
      throw new Error(`Claim RPC failed: ${claimError.message}`);
    }

    if (!claimedItems || claimedItems.length === 0) {
      console.log("[DEEP] No items to process");
      return new Response(
        JSON.stringify({ success: true, message: "No items to process", metrics }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    metrics.items_claimed = claimedItems.length;
    console.log(`[DEEP] Claimed ${claimedItems.length} queue items`);

    // Batch fetch all related stub_anchors to get matched_hunt_ids
    const stubAnchorIds = claimedItems
      .map((item: QueueItem) => item.stub_anchor_id)
      .filter(Boolean);
    
    let stubsMap = new Map<string, { matched_hunt_ids: string[]; year: number; make: string; model: string; km: number; location: string }>();
    
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

    let specsMap = new Map<string, Record<string, unknown>>();
    
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
      console.log(`[DEEP] Pre-fetched ${specsMap.size} dealer_specs`);
    }

    // Process each claimed queue item
    for (const item of claimedItems as QueueItem[]) {
      const queueId = item.id;
      const detailUrl = item.detail_url;
      const sourceStockId = item.source_listing_id;
      
      try {
        const response = await fetch(detailUrl, {
          headers: BROWSER_HEADERS,
          redirect: 'follow',
        });

        if (!response.ok) {
          console.warn(`[DEEP] HTTP ${response.status} for ${sourceStockId}`);
          
          if (!dry_run) {
            // Update queue item as error, increment retry
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

            // Queue VA exception if stub exists
            if (item.stub_anchor_id) {
              await supabase.from("va_exceptions").insert({
                stub_anchor_id: item.stub_anchor_id,
                url: detailUrl,
                source: item.source,
                missing_fields: ['detail_page'],
                reason: `HTTP ${response.status}`,
              });
            }
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
              // Store extracted data
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

            // Create hunt opportunities using pre-fetched specs (no N+1)
            const stubInfo = stubsMap.get(item.stub_anchor_id);
            if (stubInfo && stubInfo.matched_hunt_ids.length > 0) {
              for (const huntId of stubInfo.matched_hunt_ids) {
                const spec = specsMap.get(huntId);
                if (!spec) continue;

                let score = 100;
                if (enriched.km_verified && (spec.km_max as number) && enriched.km_verified > (spec.km_max as number)) {
                  score -= 20;
                }
                if (enriched.wovr_indicator) score -= 30;
                if (enriched.damage_noted) score -= 15;

                await supabase.from("hunt_external_candidates").upsert({
                  hunt_id: huntId,
                  source_name: "pickles",
                  source_url: detailUrl,
                  dedup_key: `pickles:${sourceStockId}`,
                  title: enriched.variant_raw || `${stubInfo.year} ${stubInfo.make} ${stubInfo.model}`,
                  year: stubInfo.year,
                  make: stubInfo.make,
                  model: stubInfo.model,
                  variant_raw: enriched.variant_raw,
                  km: enriched.km_verified || stubInfo.km,
                  asking_price: enriched.price,
                  location: stubInfo.location,
                  match_score: score,
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
        await new Promise(r => setTimeout(r, 300));

      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        console.error(`[DEEP] Error processing ${sourceStockId}:`, error);

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
    console.log(`[DEEP] Completed in ${duration}ms:`, metrics);

    return new Response(
      JSON.stringify({
        success: true,
        duration_ms: duration,
        worker_id: workerId,
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
