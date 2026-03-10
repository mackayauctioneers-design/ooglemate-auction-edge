
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type OpRow = {
  id: string;
  listing_id: string;
  listing_source: string | null;
  source_url: string | null;
};

type CheckResult = {
  id: string;
  listing_id: string;
  status: "active" | "sold" | "expired";
  reason: string;
  http_status: number | null;
};

const SOLD_SIGNALS = [
  "this item has sold",
  "vehicle has sold",
  "lot sold",
  "sold at auction",
  "sale completed",
  "this lot has been sold",
  "bidding closed",
  "this vehicle has been sold",
  "this listing has been sold",
  "listing has ended",
  "ad has been removed",
  "this listing has been removed",
];

const EXPIRED_SIGNALS = [
  "page not found",
  "we can't find the page",
  "not available",
  "no longer available",
  "this lot is no longer available",
  "we couldn't find",
  "doesn't exist",
  "404 - not found",
];

async function fetchWithRetry(url: string, tries = 2): Promise<Response> {
  let lastErr: unknown = null;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetch(url, {
        redirect: "follow",
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; CarOogleVerifier/1.0)",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
    } catch (e) {
      lastErr = e;
      await sleep(300 * (i + 1));
    }
  }
  throw lastErr ?? new Error("fetch failed");
}

async function checkOne(row: OpRow): Promise<CheckResult> {
  const url = (row.source_url ?? "").trim();
  if (!url) {
    return { id: row.id, listing_id: row.listing_id, status: "active", http_status: null, reason: "no_url_skip" };
  }

  try {
    const resp = await fetchWithRetry(url);
    const status = resp.status;

    if (status === 404 || status === 410) {
      await resp.text(); // consume body
      return { id: row.id, listing_id: row.listing_id, status: "expired", http_status: status, reason: "http_gone" };
    }
    if (status >= 500) {
      await resp.text();
      return { id: row.id, listing_id: row.listing_id, status: "active", http_status: status, reason: "http_5xx_skip" };
    }
    if (!resp.ok) {
      await resp.text();
      return { id: row.id, listing_id: row.listing_id, status: "active", http_status: status, reason: "http_not_ok_skip" };
    }

    // Check for redirect away from detail page (multi-source)
    const finalUrl = (resp.url ?? url).toLowerCase();
    const originalUrl = url.toLowerCase();
    const source = (row.listing_source ?? "").toLowerCase();

    // Pickles: redirects away from /lot/ or /used/details/
    if (source.includes("pickles") && !finalUrl.includes("/lot/") && !finalUrl.includes("/used/details/")) {
      await resp.text();
      return { id: row.id, listing_id: row.listing_id, status: "expired", http_status: 200, reason: "redirect_away" };
    }

    // Auto Auctions: JS-rendered pages, can't scrape — rely on 48h DB purge
    if (originalUrl.includes("auto-auctions.com.au")) {
      await resp.text();
      return { id: row.id, listing_id: row.listing_id, status: "active", http_status: 200, reason: "js_rendered_skip" };
    }

    // Manheim: session-gated — skip (can't verify without login)
    if (originalUrl.includes("manheim.com")) {
      await resp.text();
      return { id: row.id, listing_id: row.listing_id, status: "active", http_status: 200, reason: "session_gated_skip" };
    }

    const html = (await resp.text()).toLowerCase();

    if (SOLD_SIGNALS.some((s) => html.includes(s))) {
      return { id: row.id, listing_id: row.listing_id, status: "sold", http_status: 200, reason: "sold_signal" };
    }
    if (EXPIRED_SIGNALS.some((s) => html.includes(s))) {
      return { id: row.id, listing_id: row.listing_id, status: "expired", http_status: 200, reason: "expired_signal" };
    }

    return { id: row.id, listing_id: row.listing_id, status: "active", http_status: 200, reason: "still_live" };
  } catch (e) {
    return { id: row.id, listing_id: row.listing_id, status: "active", http_status: null, reason: "fetch_error" };
  }
}

// Concurrency limiter
async function runPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const started = Date.now();
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { limit = 100, concurrency = 8 } = await req.json().catch(() => ({}));
    const batchLimit = Math.min(Math.max(limit, 1), 300);
    const concurrencyLimit = Math.min(Math.max(concurrency, 1), 12);

    // Get active opportunities with source URLs, oldest-checked first
    const { data: rows, error: fetchErr } = await sb
      .from("operator_opportunities")
      .select("id, listing_id, listing_source, source_url")
      .in("status", ["new", "reviewed", "assigned"])
      .not("source_url", "is", null)
      .order("updated_at", { ascending: true })
      .limit(batchLimit);

    if (fetchErr) throw fetchErr;
    const batch = (rows ?? []) as OpRow[];
    console.log(`[STALE-SWEEP] Checking ${batch.length} trading desk opportunities`);

    if (batch.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "nothing_to_check", took_ms: Date.now() - started }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = await runPool(batch, concurrencyLimit, checkOne);

    // Separate sold from expired from alive
    const soldResults = results.filter((r) => r.status === "sold");
    const expiredResults = results.filter((r) => r.status === "expired");
    const deadIds = [...soldResults, ...expiredResults].map((r) => r.id);
    let expired = 0;

    // Mark dead opportunities as expired
    for (let i = 0; i < deadIds.length; i += 50) {
      const chunk = deadIds.slice(i, i + 50);
      const { error: upErr } = await sb
        .from("operator_opportunities")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .in("id", chunk)
        .eq("is_starred", false); // never expire starred
      if (upErr) console.error("[STALE-SWEEP] expire error:", upErr.message);
      else expired += chunk.length;
    }

    // Also mark underlying vehicle_listings as SOLD with timestamp
    const soldListingIds = soldResults.map((r) => r.listing_id);
    if (soldListingIds.length > 0) {
      for (let i = 0; i < soldListingIds.length; i += 50) {
        const chunk = soldListingIds.slice(i, i + 50);
        await sb
          .from("vehicle_listings")
          .update({ lifecycle_state: "SOLD", sold_detected_at: new Date().toISOString() })
          .in("listing_id", chunk);
      }
    }

    // Mark expired listings as DEAD
    const expiredListingIds = expiredResults.map((r) => r.listing_id);
    if (expiredListingIds.length > 0) {
      for (let i = 0; i < expiredListingIds.length; i += 50) {
        const chunk = expiredListingIds.slice(i, i + 50);
        await sb
          .from("vehicle_listings")
          .update({ lifecycle_state: "DEAD" })
          .in("listing_id", chunk);
      }
    }

    const counts = results.reduce((acc, r) => {
      acc[r.reason] = (acc[r.reason] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log(`[STALE-SWEEP] Done: checked=${batch.length}, expired=${expired}`, counts);

    // Audit + heartbeat
    await sb.from("cron_audit_log").insert({
      cron_name: "trading-desk-stale-sweep",
      run_date: new Date().toISOString().split("T")[0],
      success: true,
      result: { checked: batch.length, expired, counts },
    });
    await sb.from("cron_heartbeat").upsert({
      cron_name: "trading-desk-stale-sweep",
      last_seen_at: new Date().toISOString(),
      last_ok: true,
      note: `checked=${batch.length} expired=${expired}`,
    });

    return new Response(JSON.stringify({
      ok: true, checked: batch.length, expired, counts, took_ms: Date.now() - started,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[STALE-SWEEP] Error:", msg);

    try {
      await sb.from("cron_heartbeat").upsert({
        cron_name: "trading-desk-stale-sweep",
        last_seen_at: new Date().toISOString(),
        last_ok: false,
        note: `error: ${msg.slice(0, 100)}`,
      });
    } catch { /* ignore */ }

    return new Response(JSON.stringify({ ok: false, error: msg, took_ms: Date.now() - started }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
