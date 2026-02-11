import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type VerifyRow = {
  id: string;
  source_name: string | null;
  source_url: string;
  identity_key: string | null;
  last_lifecycle_check_at: string | null;
};

type VerifyOutcome = {
  lifecycle_status: "active" | "sold" | "expired";
  http_status: number | null;
  reason: string;
  error?: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Pickles-specific sold/expired detection
function detectPickles(html: string): VerifyOutcome | null {
  const lower = html.toLowerCase();
  const soldSignals = [
    "this item has sold",
    "vehicle has sold",
    "lot sold",
    "sold at auction",
    "sale completed",
    "this lot has been sold",
    "bidding closed",
  ];
  const expiredSignals = [
    "page not found",
    "we can't find the page",
    "not available",
    "no longer available",
    "listing has ended",
    "this lot is no longer available",
  ];

  if (soldSignals.some((s) => lower.includes(s))) {
    return { lifecycle_status: "sold", http_status: 200, reason: "pickles:sold_signal" };
  }
  if (expiredSignals.some((s) => lower.includes(s))) {
    return { lifecycle_status: "expired", http_status: 200, reason: "pickles:expired_signal" };
  }
  return null;
}

// Generic sold/expired detection for other sources
function detectGeneric(html: string): VerifyOutcome | null {
  const lower = html.toLowerCase();
  const explicitSold = [
    "this vehicle has been sold",
    "this item has sold",
    "no longer available",
    "listing has ended",
    "ad has been removed",
    "this listing has been removed",
  ];
  const expiredSignals = [
    "page not found",
    "we couldn't find",
    "doesn't exist",
    "404 - not found",
  ];

  if (explicitSold.some((s) => lower.includes(s))) {
    return { lifecycle_status: "sold", http_status: 200, reason: "generic:explicit_sold" };
  }
  if (expiredSignals.some((s) => lower.includes(s))) {
    return { lifecycle_status: "expired", http_status: 200, reason: "generic:expired_signal" };
  }
  return null;
}

// Check if a redirect indicates the listing is gone
function looksExpiredRedirect(finalUrl: string, source: string | null): boolean {
  const u = finalUrl.toLowerCase();
  if (source?.toLowerCase().includes("pickles")) {
    if (!u.includes("/item/") && !u.includes("/used/details/")) return true;
  }
  return false;
}

async function fetchWithRetry(url: string, tries = 3): Promise<Response> {
  let lastErr: unknown = null;
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await fetch(url, {
        redirect: "follow",
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; CarOogleVerifier/1.0)",
          "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      return resp;
    } catch (e) {
      lastErr = e;
      await sleep(350 * (i + 1));
    }
  }
  throw lastErr ?? new Error("fetch failed after retries");
}

async function verifyOne(row: VerifyRow): Promise<VerifyOutcome> {
  const source = row.source_name ?? "";
  const url = (row.source_url ?? "").trim();
  if (!url) {
    return { lifecycle_status: "active", http_status: null, reason: "no_url_skip" };
  }

  try {
    const resp = await fetchWithRetry(url, 3);
    const status = resp.status;

    // Hard fail
    if (status === 404 || status === 410) {
      return { lifecycle_status: "expired", http_status: status, reason: "http_not_found" };
    }
    // Server error — don't flip, might be temporary
    if (status >= 500) {
      return { lifecycle_status: "active", http_status: status, reason: "http_5xx_keep_active" };
    }
    // WAF/auth block — keep active but log
    if (!resp.ok) {
      return { lifecycle_status: "active", http_status: status, reason: "http_not_ok_keep_active" };
    }

    const finalUrl = resp.url ?? url;
    if (looksExpiredRedirect(finalUrl, source)) {
      return { lifecycle_status: "expired", http_status: 200, reason: "redirect_out_of_detail" };
    }

    const html = await resp.text();

    // Source-specific detection
    if (source.toLowerCase().includes("pickles")) {
      const outcome = detectPickles(html);
      if (outcome) return outcome;
    }

    // Generic detection
    const genericOutcome = detectGeneric(html);
    if (genericOutcome) return genericOutcome;

    return { lifecycle_status: "active", http_status: 200, reason: "no_sold_signals" };
  } catch (e) {
    return {
      lifecycle_status: "active",
      http_status: null,
      reason: "fetch_error_keep_active",
      error: String(e),
    };
  }
}

// Concurrency limiter
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (idx < items.length) {
      const myIdx = idx++;
      results[myIdx] = await fn(items[myIdx]);
    }
  });
  await Promise.all(workers);
  return results;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const started = Date.now();

  try {
    const { limit = 50, concurrency = 6 } = await req.json().catch(() => ({}));
    const batchLimit = Math.min(Math.max(limit, 1), 200);
    const concurrencyLimit = Math.min(Math.max(concurrency, 1), 12);

    // Get batch via RPC
    const { data: batch, error: rpcErr } = await supabase.rpc("rpc_get_verify_batch", {
      p_limit: batchLimit,
    });
    if (rpcErr) throw rpcErr;

    const rows = (batch ?? []) as VerifyRow[];
    console.log(`Verify batch: ${rows.length} rows`);

    if (rows.length === 0) {
      return new Response(JSON.stringify({
        ok: true, message: "no_rows_to_verify", took_ms: Date.now() - started,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const outcomes = await runWithConcurrency(rows, concurrencyLimit, async (row) => {
      const outcome = await verifyOne(row);

      // Update the row
      const { error: updateErr } = await supabase
        .from("hunt_external_candidates")
        .update({
          lifecycle_status: outcome.lifecycle_status,
          last_lifecycle_check_at: new Date().toISOString(),
          lifecycle_http_status: outcome.http_status,
          lifecycle_reason: outcome.reason,
          lifecycle_error: outcome.error ?? null,
          ...(outcome.lifecycle_status === "expired" ? { is_stale: true, expired_at: new Date().toISOString() } : {}),
        })
        .eq("id", row.id);

      if (updateErr) {
        console.error(`Failed to update ${row.id}:`, updateErr);
      }

      return { id: row.id, source: row.source_name, ...outcome };
    });

    const counts = outcomes.reduce((acc, o) => {
      acc[o.lifecycle_status] = (acc[o.lifecycle_status] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log("Verify complete:", counts);

    return new Response(JSON.stringify({
      ok: true,
      verified: rows.length,
      counts,
      took_ms: Date.now() - started,
      sample: outcomes.slice(0, 10),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Verify listings error:", error);
    return new Response(JSON.stringify({
      ok: false, error: String(error), took_ms: Date.now() - started,
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
