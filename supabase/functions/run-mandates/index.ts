import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * RUN-MANDATES — Unified Mandate Dispatcher
 * 
 * Every 15 min, fetches due mandates, runs per-source adapters,
 * and upserts results into mandate_feed_items.
 * 
 * B-mode: store EVERYTHING that matches structural constraints.
 * Score/margin are ranking signals only — never filter on them.
 * 
 * Code Red alerts: price drops + new tight listings → Slack.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CRON_NAME = "run-mandates";

// ─── Types ───────────────────────────────────────────────────────────────────

type Mandate = {
  id: string;
  name: string;
  make: string;
  model: string;
  variant_family: string | null;
  year_min: number | null;
  year_max: number | null;
  km_max: number | null;
  price_max: number | null;
  source_mask: string[];
  run_frequency_minutes: number;
};

type NormalizedListing = {
  source: string;
  listing_id: string;
  source_url: string | null;
  make: string;
  model: string;
  variant: string | null;
  year: number | null;
  km: number | null;
  asking_price: number | null;
  location: string | null;
  raw: Record<string, unknown>;
};

type FeedItemRow = {
  id: string;
  mandate_id: string;
  source: string;
  listing_id: string;
  source_url: string | null;
  make: string;
  model: string;
  variant: string | null;
  year: number | null;
  km: number | null;
  asking_price: number | null;
  last_price: number | null;
  price_delta: number | null;
  first_seen_at: string;
  last_seen_at: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parsePrice(raw: unknown): number | null {
  if (raw == null) return null;
  const val = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[,$\s]/g, ""));
  return !isNaN(val) && val > 0 ? Math.round(val) : null;
}

function parseKm(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).replace(/[,\s]/g, "");
  const m = s.match(/(\d+)/);
  if (!m) return null;
  const val = parseInt(m[1]);
  return val > 0 && val < 999999 ? val : null;
}

function parseYear(raw: unknown): number | null {
  if (raw == null) return null;
  const y = parseInt(String(raw));
  return y >= 1990 && y <= 2030 ? y : null;
}

function extractBadge(text: string | null): string {
  if (!text) return "";
  const d = text.toUpperCase();
  const badges = [
    "EXCEED TOURER", "EXCEED", "X-TERRAIN", "SR5", "ROGUE", "RUGGED X", "RUGGED",
    "RAPTOR", "WILDTRAK", "KAKADU", "SAHARA", "ASPIRE", "TITANIUM", "PLATINUM",
    "GXL", "VX", "GX", "XLT", "XLS", "LS-U", "LS-M", "LS-T",
    "ST-X", "ST-L", "GLS", "N-TREK", "COMMUTER", "SLWB", "LWB",
    "WORKMATE", "AMBIENTE", "TREND", "ASCENT SPORT", "ASCENT",
    "MAXX SPORT", "MAXX", "AKARI", "GT-LINE", "TOURING",
    "EDGE", "ATMOS", "CRUSADE", "URBAN CRUISER",
  ];
  const shortBadges = ["SR", "XL", "LS", "ES", "SL", "ST", "SX", "XT", "RX", "ZR"];
  for (const b of badges) { if (d.includes(b)) return b; }
  for (const b of shortBadges) { if (new RegExp(`\\b${b}\\b`).test(d)) return b; }
  return "";
}

function formatPrice(price: number | null): string {
  if (!price) return "N/A";
  return "$" + price.toLocaleString("en-AU", { maximumFractionDigits: 0 });
}

function formatKm(km: number | null): string {
  if (!km) return "N/A";
  return Math.round(km / 1000) + "k km";
}

// ─── Source Adapters ─────────────────────────────────────────────────────────

async function fetchPickles(mandate: Mandate): Promise<NormalizedListing[]> {
  const url = "https://backend.caroogle.codesorbit.net/api/ads?source=pickles&limit=5000";
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Pickles API ${resp.status}`);
  const payload = await resp.json();
  const ads: any[] = Array.isArray(payload) ? payload : (payload.data || []);

  const results: NormalizedListing[] = [];
  for (const ad of ads) {
    const lotId = String(ad.lotId || ad.lot_id || ad.id || "");
    if (!lotId) continue;

    const make = ad.make ? String(ad.make).toUpperCase().trim() : null;
    if (!make) continue;

    let model = ad.model ? String(ad.model).toUpperCase().trim() : null;
    if (!model && ad.title && make) {
      const t = String(ad.title).toUpperCase().trim();
      if (t.startsWith(make)) model = t.slice(make.length).trim() || null;
    }
    if (!model) continue;

    const year = parseYear(ad.year);
    const km = parseKm(ad.odometer || ad.km || ad.kms);
    const price = parsePrice(ad.price || ad.askingPrice || ad.asking_price);

    if (mandate.make && make !== mandate.make.toUpperCase()) continue;
    if (mandate.model && !model.includes(mandate.model.toUpperCase())) continue;
    if (mandate.year_min && year && year < mandate.year_min) continue;
    if (mandate.year_max && year && year > mandate.year_max) continue;
    if (mandate.km_max && km && km > mandate.km_max) continue;
    if (mandate.price_max && price && price > mandate.price_max) continue;

    const variant = extractBadge(ad.variant || ad.title || ad.sellerNotes) || null;

    results.push({
      source: "pickles",
      listing_id: `pickles:${lotId}`,
      source_url: ad.url || ad.listing_url || ad.link || null,
      make, model, variant, year, km,
      asking_price: price,
      location: ad.location || ad.suburb || null,
      raw: ad,
    });
  }
  return results;
}

async function fetchToyota(mandate: Mandate): Promise<NormalizedListing[]> {
  const url = "https://backend.caroogle.codesorbit.net/api/ads?source=toyota&limit=5000";
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Toyota API ${resp.status}`);
  const payload = await resp.json();
  const ads: any[] = Array.isArray(payload) ? payload : (payload.data || []);

  const results: NormalizedListing[] = [];
  for (const ad of ads) {
    const lotId = String(ad.lotId || ad.lot_id || ad.id || "");
    if (!lotId) continue;

    const make = ad.make ? String(ad.make).toUpperCase().trim() : null;
    if (!make) continue;

    let model = (ad.vehicleModel || ad.vehicle_model || ad.model || "") as string;
    model = model ? model.toUpperCase().trim() : "UNKNOWN";

    const year = parseYear(ad.year);
    const km = parseKm(ad.odometer || ad.km);
    const price = parsePrice(ad.price);

    if (mandate.make && make !== mandate.make.toUpperCase()) continue;
    if (mandate.model && !model.includes(mandate.model.toUpperCase())) continue;
    if (mandate.year_min && year && year < mandate.year_min) continue;
    if (mandate.year_max && year && year > mandate.year_max) continue;
    if (mandate.km_max && km && km > mandate.km_max) continue;
    if (mandate.price_max && price && price > mandate.price_max) continue;

    const variant = ad.variant ? extractBadge(String(ad.variant)) || String(ad.variant).toUpperCase().trim() : extractBadge(ad.title as string) || null;

    results.push({
      source: "toyota",
      listing_id: `toyota:${lotId}`,
      source_url: (ad.listingUrl || ad.listing_url || ad.link || null) as string | null,
      make, model, variant, year, km,
      asking_price: price,
      location: (ad.location || ad.suburb || null) as string | null,
      raw: ad,
    });
  }
  return results;
}

const ADAPTERS: Record<string, (m: Mandate) => Promise<NormalizedListing[]>> = {
  pickles: fetchPickles,
  toyota: fetchToyota,
};

// ─── Feed upsert ─────────────────────────────────────────────────────────────

async function upsertFeedItems(
  sb: ReturnType<typeof createClient>,
  mandateId: string,
  listings: NormalizedListing[],
): Promise<{ upserted: number; errors: number }> {
  let upserted = 0;
  let errors = 0;
  const BATCH = 200;

  for (let i = 0; i < listings.length; i += BATCH) {
    const batch = listings.slice(i, i + BATCH);
    const now = new Date().toISOString();

    const rows = batch.map(l => ({
      mandate_id: mandateId,
      source: l.source,
      listing_id: l.listing_id,
      source_url: l.source_url,
      make: l.make,
      model: l.model,
      variant: l.variant,
      year: l.year,
      km: l.km,
      asking_price: l.asking_price,
      location: l.location,
      last_seen_at: now,
      raw: l.raw,
    }));

    const { error, data } = await sb
      .from("mandate_feed_items")
      .upsert(rows, {
        onConflict: "mandate_id,source,listing_id",
        ignoreDuplicates: false,
      })
      .select("id, asking_price, last_price");

    if (error) {
      errors += batch.length;
      console.error(`[run-mandates] Feed upsert error: ${error.message}`);
    } else {
      upserted += data?.length || batch.length;
    }
  }

  await sb.rpc("mandate_feed_detect_price_changes", { p_mandate_id: mandateId }).catch(() => {});

  return { upserted, errors };
}

// ─── Code Red Alert Logic ────────────────────────────────────────────────────

function isPriceDropCodeRed(priceDelta: number | null, lastPrice: number | null): boolean {
  if (priceDelta == null || lastPrice == null || lastPrice <= 0) return false;
  if (priceDelta <= -3000) return true;
  if (priceDelta <= -2000 && Math.abs(priceDelta) / lastPrice >= 0.05) return true;
  return false;
}

function isNewCleanCodeRed(item: FeedItemRow, mandate: Mandate, runStartedAt: string): boolean {
  // first_seen_at must be within this run
  if (item.first_seen_at < runStartedAt) return false;

  // Year check: must be >= (year_max - 1) if year_max exists
  if (mandate.year_max && item.year) {
    if (item.year < mandate.year_max - 1) return false;
  }

  // KM check: must be <= 70% of km_max if km_max exists
  if (mandate.km_max && item.km) {
    if (item.km > 0.7 * mandate.km_max) return false;
  }

  // Price check: must be >= 97% of price_max (priced to move, near ceiling)
  if (mandate.price_max && item.asking_price) {
    if (item.asking_price < 0.97 * mandate.price_max) return false;
  }

  return true;
}

async function checkCooldown(
  sb: ReturnType<typeof createClient>,
  mandateId: string,
  source: string,
  listingId: string,
  alertType: string,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await sb
    .from("mandate_alerts")
    .select("id")
    .eq("mandate_id", mandateId)
    .eq("source", source)
    .eq("listing_id", listingId)
    .eq("alert_type", alertType)
    .gte("created_at", cutoff)
    .limit(1);
  return (data?.length || 0) > 0;
}

async function sendCodeRedToSlack(
  webhook: string,
  item: FeedItemRow,
  reason: string,
  alertType: string,
): Promise<boolean> {
  const vehicle = `${item.year || ""} ${item.make || ""} ${item.model || ""} ${item.variant || ""}`.trim();
  const dropText = item.price_delta ? `Drop: ${formatPrice(Math.abs(item.price_delta))}` : "";

  const fields = [
    { type: "mrkdwn", text: `*Price:*\n${formatPrice(item.asking_price)}` },
    { type: "mrkdwn", text: `*KM:*\n${formatKm(item.km)}` },
    { type: "mrkdwn", text: `*Source:*\n${item.source}` },
    { type: "mrkdwn", text: `*Reason:*\n${reason}` },
  ];
  if (dropText) {
    fields.splice(1, 0, { type: "mrkdwn", text: `*${dropText}*` });
  }

  const blocks: any[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `🚨 *CODE RED — ${vehicle}*` },
    },
    { type: "section", fields },
  ];

  if (item.source_url) {
    blocks.push({
      type: "actions",
      elements: [{
        type: "button",
        text: { type: "plain_text", text: "View Listing" },
        url: item.source_url,
        style: "danger",
      }],
    });
  }

  blocks.push({ type: "divider" });

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attachments: [{
          color: "#EF4444",
          blocks,
        }],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function evaluateCodeRedAlerts(
  sb: ReturnType<typeof createClient>,
  mandate: Mandate,
  runStartedAt: string,
  slackWebhook: string | undefined,
): Promise<number> {
  let codeRedCount = 0;

  // Fetch all feed items for this mandate that were touched in this run
  const { data: items, error } = await sb
    .from("mandate_feed_items")
    .select("id, mandate_id, source, listing_id, source_url, make, model, variant, year, km, asking_price, last_price, price_delta, first_seen_at, last_seen_at")
    .eq("mandate_id", mandate.id)
    .gte("last_seen_at", runStartedAt);

  if (error || !items) return 0;

  for (const item of items as FeedItemRow[]) {
    let alertType: string | null = null;
    let reason = "";

    // Check price drop
    if (isPriceDropCodeRed(item.price_delta, item.last_price)) {
      alertType = "price_drop";
      const pct = item.last_price ? Math.round(Math.abs(item.price_delta!) / item.last_price * 100) : 0;
      reason = `Price dropped ${formatPrice(Math.abs(item.price_delta!))} (${pct}%) from ${formatPrice(item.last_price)}`;
    }
    // Check new + tight
    else if (isNewCleanCodeRed(item, mandate, runStartedAt)) {
      alertType = "new_clean";
      reason = `New listing: tight spec — ${item.year} model, ${formatKm(item.km)}, priced ${formatPrice(item.asking_price)}`;
    }

    if (!alertType) continue;

    // Cooldown check
    const onCooldown = await checkCooldown(sb, mandate.id, item.source, item.listing_id, alertType);
    if (onCooldown) continue;

    console.log(`[run-mandates] CODE RED triggered for ${item.listing_id}`);

    // Insert alert
    const { error: insertErr } = await sb
      .from("mandate_alerts")
      .upsert({
        mandate_id: mandate.id,
        source: item.source,
        listing_id: item.listing_id,
        alert_type: alertType,
        severity: "code_red",
        reason,
      }, { onConflict: "mandate_id,source,listing_id,alert_type" });

    if (insertErr) {
      console.error(`[run-mandates] Alert insert error: ${insertErr.message}`);
      continue;
    }

    codeRedCount++;

    // Send Slack
    if (slackWebhook) {
      const sent = await sendCodeRedToSlack(slackWebhook, item, reason, alertType);
      if (sent) {
        await sb
          .from("mandate_alerts")
          .update({ sent_at: new Date().toISOString() })
          .eq("mandate_id", mandate.id)
          .eq("source", item.source)
          .eq("listing_id", item.listing_id)
          .eq("alert_type", alertType);
      }
    }
  }

  return codeRedCount;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const runStartedAt = new Date().toISOString();

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const SLACK_WEBHOOK = Deno.env.get("SLACK_WEBHOOK_URL");

    // 1. Create mandate_runs row
    const { data: runRow } = await sb
      .from("mandate_runs")
      .insert({ started_at: runStartedAt })
      .select("id")
      .single();

    const runId = runRow?.id;

    // 2. Fetch due mandates
    const { data: dueMandates, error: fetchErr } = await sb
      .from("active_mandates")
      .select("*")
      .eq("is_active", true)
      .lte("next_run_at", new Date().toISOString());

    if (fetchErr) throw new Error(`Failed to fetch mandates: ${fetchErr.message}`);

    const mandates = (dueMandates || []) as Mandate[];
    console.log(`[run-mandates] ${mandates.length} mandates due`);

    let totalFetched = 0;
    let totalUpserted = 0;
    let totalCodeRed = 0;
    const runErrors: any[] = [];
    let mandatesExecuted = 0;

    // 3. Execute each mandate
    for (const mandate of mandates) {
      console.log(`[run-mandates] Executing: ${mandate.name} (sources: ${mandate.source_mask.join(",")})`);

      let mandateFetched = 0;
      let mandateUpserted = 0;

      for (const source of mandate.source_mask) {
        const adapter = ADAPTERS[source];
        if (!adapter) {
          console.warn(`[run-mandates] No adapter for source: ${source}`);
          continue;
        }

        try {
          const listings = await adapter(mandate);
          mandateFetched += listings.length;
          console.log(`[run-mandates] ${source} returned ${listings.length} listings for "${mandate.name}"`);

          if (listings.length > 0) {
            const { upserted, errors } = await upsertFeedItems(sb, mandate.id, listings);
            mandateUpserted += upserted;
            if (errors > 0) {
              runErrors.push({ mandate: mandate.name, source, errors });
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[run-mandates] Adapter ${source} failed for "${mandate.name}": ${msg}`);
          runErrors.push({ mandate: mandate.name, source, error: msg });
        }
      }

      totalFetched += mandateFetched;
      totalUpserted += mandateUpserted;
      mandatesExecuted++;

      // 4. Evaluate Code Red alerts for this mandate
      try {
        const codeReds = await evaluateCodeRedAlerts(sb, mandate, runStartedAt, SLACK_WEBHOOK);
        totalCodeRed += codeReds;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[run-mandates] Code Red eval failed for "${mandate.name}": ${msg}`);
      }

      // 5. Update mandate schedule
      const nextRunAt = new Date(Date.now() + mandate.run_frequency_minutes * 60 * 1000).toISOString();
      await sb
        .from("active_mandates")
        .update({
          last_run_at: new Date().toISOString(),
          next_run_at: nextRunAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", mandate.id);
    }

    // 6. Close out mandate_runs
    if (runId) {
      await sb
        .from("mandate_runs")
        .update({
          finished_at: new Date().toISOString(),
          mandates_due: mandates.length,
          mandates_executed: mandatesExecuted,
          listings_fetched: totalFetched,
          listings_upserted: totalUpserted,
          errors: runErrors.length > 0 ? runErrors : null,
        })
        .eq("id", runId);
    }

    // Heartbeat
    await sb.from("cron_heartbeat").upsert({
      cron_name: CRON_NAME,
      last_seen_at: new Date().toISOString(),
      last_ok: true,
      note: `due=${mandates.length} exec=${mandatesExecuted} fetched=${totalFetched} upserted=${totalUpserted} code_red=${totalCodeRed} errors=${runErrors.length}`,
    }, { onConflict: "cron_name" });

    const result = {
      mandates_due: mandates.length,
      mandates_executed: mandatesExecuted,
      listings_fetched: totalFetched,
      listings_upserted: totalUpserted,
      code_red_count: totalCodeRed,
      errors: runErrors,
      runtime_ms: Date.now() - startTime,
    };

    console.log(`[run-mandates] Done:`, JSON.stringify(result));

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[run-mandates] Fatal:`, msg);

    try {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      await sb.from("cron_heartbeat").upsert({
        cron_name: CRON_NAME,
        last_seen_at: new Date().toISOString(),
        last_ok: false,
        note: `FATAL: ${msg.slice(0, 100)}`,
      }, { onConflict: "cron_name" });
    } catch (_) {}

    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
