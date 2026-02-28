import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * AUCTION DETAIL ENRICHER - Phase 3: Unified Manus-based detail extraction
 * 
 * Flow:
 * 1. Ensure webhook is registered with Manus (account-scoped, idempotent)
 * 2. Claims batch from pickles_detail_queue via atomic RPC (FOR UPDATE SKIP LOCKED)
 * 3. Fires a Manus task for each URL with structured extraction prompt
 * 4. Results come back via manus-auction-webhook
 * 
 * Cron: every 10 minutes
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SOURCES = ["pickles", "grays", "manheim"];
const MANUS_BASE = "https://api.manus.im";

// ── Webhook Registration (account-scoped, idempotent) ──

let cachedWebhookId: string | null = null;

async function ensureWebhookRegistered(apiKey: string, webhookUrl: string): Promise<string | null> {
  if (cachedWebhookId) return cachedWebhookId;

  try {
    const res = await fetch(`${MANUS_BASE}/v1/webhooks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "API_KEY": apiKey,
        "accept": "application/json",
      },
      body: JSON.stringify({
        webhook: { url: webhookUrl },
      }),
    });

    if (res.ok) {
      const data = await res.json();
      cachedWebhookId = data?.webhook_id || data?.id || "registered";
      console.log(`[AUCTION-ENRICHER] Webhook registered/confirmed: ${cachedWebhookId}`);
      return cachedWebhookId;
    }

    const errText = await res.text();
    // 409 or similar = already registered, which is fine
    if (res.status === 409 || errText.includes("already exists") || errText.includes("already registered")) {
      cachedWebhookId = "pre-existing";
      console.log(`[AUCTION-ENRICHER] Webhook already registered`);
      return cachedWebhookId;
    }

    console.error(`[AUCTION-ENRICHER] Webhook registration failed: ${res.status} ${errText.slice(0, 300)}`);
    return null;
  } catch (err) {
    console.error(`[AUCTION-ENRICHER] Webhook registration error:`, err);
    return null;
  }
}

// ── Extraction Prompt ──

function buildExtractionPrompt(detailUrl: string, source: string): string {
  const sourceHints: Record<string, string> = {
    pickles: `This is a Pickles.com.au auction listing page. Look for:
- Buy method (Buy Now, Pickles Online, Pickles Live, Timed Auction, Make Offer)
- Guide price, reserve price, sold price, and current bid separately
- Sale closing date/time
- Sale status (live, upcoming, sold, passed in, withdrawn)`,
    grays: `This is a Grays.com auction listing page. Look for:
- Reserve status (no reserve, reserve met, reserve not met, reserve near)
- Current bid price
- Auction end date/time`,
    manheim: `This is a Manheim.com.au auction listing page. Look for:
- Auction date and time
- Current bid or guide price`,
  };

  return `Visit this auction listing page and extract all vehicle details:
${detailUrl}

${sourceHints[source] || ""}

IMPORTANT: If the page shows an error, "item not available", redirect, or 404, return:
{"sale_status": "withdrawn", "listing_expired": true}

Otherwise extract and return a JSON object with ALL of these fields (use null if not found):

{
  "variant_raw": "string - full variant/trim/badge text as shown",
  "year": "integer - model year",
  "make": "string - manufacturer",
  "model": "string - model name",
  "km": "integer - odometer reading in kilometres",
  "fuel": "string - petrol, diesel, hybrid, electric, lpg, phev",
  "transmission": "string - automatic, manual, cvt",
  "drivetrain": "string - AWD, 4WD, FWD, RWD, 4x4, 4x2",
  "asking_price": "integer - primary price shown in AUD",
  "guide_price": "integer - guide/estimate price if shown",
  "reserve_price": "integer - reserve price if disclosed",
  "sold_price": "integer - final sale/hammer price if sold",
  "price_type": "string - current_bid, buy_now, guide, reserve, sold, price",
  "buy_method": "string - Buy Now, Timed Auction, Live Auction, Make Offer, Pickles Online, Pickles Live",
  "sale_status": "string - live, upcoming, sold, passed_in, withdrawn",
  "sale_close_at": "string - auction close datetime in ISO 8601 format if shown",
  "location": "string - yard/branch location",
  "state": "string - Australian state code (NSW, VIC, QLD, SA, WA, TAS, NT, ACT)",
  "reserve_status": "string - no_reserve, reserve_met, reserve_not_met, reserve_near",
  "wovr_indicator": "boolean - true if WOVR or write-off mentioned",
  "damage_noted": "boolean - true if damage or salvage mentioned",
  "keys_present": "boolean or null",
  "starts_drives": "boolean or null",
  "condition_notes": "array of strings",
  "listing_expired": "boolean - true ONLY if the listing page was unavailable/redirected"
}

Return ONLY the JSON object. No commentary. No markdown fences.`;
}

// ── Main Handler ──

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const MANUS_API_KEY = Deno.env.get("MANUS_API_KEY");
  if (!MANUS_API_KEY) {
    return new Response(
      JSON.stringify({ error: "MANUS_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const body = await req.json().catch(() => ({}));
  const batchSize = body.batch_size || 5;
  const startTime = Date.now();

  try {
    // Step 0: Ensure webhook is registered (account-scoped, idempotent)
    const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/manus-auction-webhook`;
    const webhookResult = await ensureWebhookRegistered(MANUS_API_KEY, webhookUrl);
    if (!webhookResult) {
      console.warn("[AUCTION-ENRICHER] Webhook registration failed — continuing anyway (may already be registered via dashboard)");
    }

    // Step 1: Atomic claim via RPC
    const { data: claimed, error: claimErr } = await supabase.rpc(
      "claim_auction_detail_batch",
      {
        p_batch_size: batchSize,
        p_claim_by: "manus-enricher",
        p_max_retries: 3,
        p_sources: SOURCES,
      },
    );

    if (claimErr) {
      throw new Error(`Claim failed: ${claimErr.message}`);
    }

    if (!claimed || claimed.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No items to process", tasks_created: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[AUCTION-ENRICHER] Claimed ${claimed.length} items: ${claimed.map((c: any) => `${c.source}:${c.source_listing_id}`).join(", ")}`);

    const tasksCreated: string[] = [];
    const errors: string[] = [];

    for (const item of claimed) {
      const prompt = buildExtractionPrompt(item.detail_url, item.source);

      try {
        // Step 2: Create Manus task — NO webhook_url in body (webhooks are account-scoped)
        const res = await fetch(`${MANUS_BASE}/v1/tasks`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "API_KEY": MANUS_API_KEY,
            "accept": "application/json",
          },
          body: JSON.stringify({ prompt }),
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error(`[AUCTION-ENRICHER] Manus task failed for ${item.source}:${item.source_listing_id}: ${res.status} ${errText.slice(0, 200)}`);
          errors.push(`${item.source}:${item.source_listing_id}: HTTP ${res.status}`);

          await supabase
            .from("pickles_detail_queue")
            .update({
              crawl_status: "error",
              last_crawl_error: `Manus task creation failed: HTTP ${res.status}`,
              last_crawl_at: new Date().toISOString(),
              retry_count: item.retry_count + 1,
              claimed_at: null,
              claimed_by: null,
            })
            .eq("id", item.id);
          continue;
        }

        const task = await res.json();
        const taskId = task?.task_id || task?.id; // task_id is the primary field per Manus docs

        if (!taskId) {
          console.error(`[AUCTION-ENRICHER] No task_id in Manus response for ${item.source}:${item.source_listing_id}:`, JSON.stringify(task).slice(0, 300));
          errors.push(`${item.source}:${item.source_listing_id}: no task_id in response`);

          await supabase
            .from("pickles_detail_queue")
            .update({
              crawl_status: "error",
              last_crawl_error: "Manus returned no task_id",
              last_crawl_at: new Date().toISOString(),
              retry_count: item.retry_count + 1,
              claimed_at: null,
              claimed_by: null,
            })
            .eq("id", item.id);
          continue;
        }

        // Step 3: Track in manus_search_tasks for correlation (non-fatal if insert fails)
        const { error: insertErr } = await supabase.from("manus_search_tasks").insert({
          manus_task_id: taskId,
          source_url: item.detail_url,
          status: "pending",
          search_session_id: crypto.randomUUID(),
          search_filters: {
            queue_item_id: item.id,
            source: item.source,
            source_listing_id: item.source_listing_id,
            stub_anchor_id: item.stub_anchor_id,
            flow: "auction_detail_enrichment",
          },
        });

        if (insertErr) {
          console.error(`[AUCTION-ENRICHER] manus_search_tasks insert failed for ${taskId}: ${insertErr.message} — task was created, webhook should still fire`);
        }

        tasksCreated.push(taskId);
        console.log(`[AUCTION-ENRICHER] Task ${taskId} → ${item.source}:${item.source_listing_id}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[AUCTION-ENRICHER] Error for ${item.source}:${item.source_listing_id}:`, errMsg);
        errors.push(`${item.source}:${item.source_listing_id}: ${errMsg}`);

        await supabase
          .from("pickles_detail_queue")
          .update({
            crawl_status: "error",
            last_crawl_error: `Exception: ${errMsg}`,
            last_crawl_at: new Date().toISOString(),
            retry_count: item.retry_count + 1,
            claimed_at: null,
            claimed_by: null,
          })
          .eq("id", item.id);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[AUCTION-ENRICHER] Done in ${duration}ms: ${tasksCreated.length} tasks, ${errors.length} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        duration_ms: duration,
        items_claimed: claimed.length,
        tasks_created: tasksCreated.length,
        task_ids: tasksCreated,
        webhook_registered: !!webhookResult,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[AUCTION-ENRICHER] Fatal error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
