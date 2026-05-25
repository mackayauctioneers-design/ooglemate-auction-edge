// worker-ingest
// Secure ingest endpoint for the VPS Worker (Arby).
// Auth: Authorization: Bearer ${WORKER_INGEST_KEY}
// Writes canonical tables only. Service role stays server-side.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface IncomingListing {
  source_listing_id?: string;
  listing_id?: string;
  url?: string;
  listing_url?: string;
  title?: string;
  year?: number;
  make?: string;
  model?: string;
  variant?: string;
  variant_raw?: string;
  price?: number;
  asking_price?: number;
  km?: number;
  odometer?: number;
  vin?: string;
  rego?: string;
  colour?: string;
  transmission?: string;
  fuel?: string;
  body_type?: string;
  location?: string;
  state?: string;
  image_url?: string;
  [k: string]: unknown;
}

interface Payload {
  source: string;
  adapter?: string;
  account_id?: string;
  dealer_id?: string;
  dealer_slug?: string;
  dealer_name?: string;
  run_metadata?: Record<string, unknown>;
  listings: IncomingListing[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const startedAt = new Date();
  const t0 = Date.now();

  // ── Auth ─────────────────────────────────────────────────────────────────
  const expected = Deno.env.get("WORKER_INGEST_KEY");
  if (!expected) return json({ error: "WORKER_INGEST_KEY not configured" }, 500);
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== expected) return json({ error: "Unauthorized" }, 401);

  // ── Parse ───────────────────────────────────────────────────────────────
  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const {
    source,
    adapter = null,
    account_id,
    dealer_id,
    dealer_slug,
    dealer_name,
    run_metadata = {},
    listings,
  } = body || ({} as Payload);

  if (!source || typeof source !== "string") {
    return json({ error: "source (string) required" }, 400);
  }
  if (!Array.isArray(listings)) {
    return json({ error: "listings[] required" }, 400);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Resolve account / dealer ────────────────────────────────────────────
  let resolvedAccountId: string | null = account_id ?? null;
  let resolvedDealerId: string | null = dealer_id ?? null;
  let mapped = false;

  if (resolvedDealerId && !resolvedAccountId) {
    const { data } = await sb
      .from("dealer_profiles")
      .select("id, account_id")
      .eq("id", resolvedDealerId)
      .maybeSingle();
    if (data?.account_id) {
      resolvedAccountId = data.account_id as string;
      mapped = true;
    }
  } else if (resolvedAccountId && !resolvedDealerId) {
    const { data } = await sb
      .from("dealer_profiles")
      .select("id")
      .eq("account_id", resolvedAccountId)
      .limit(1)
      .maybeSingle();
    if (data?.id) {
      resolvedDealerId = data.id as string;
      mapped = true;
    } else {
      mapped = true; // account known, dealer profile optional
    }
  } else if (dealer_slug) {
    // 1) Try outbound source mapping (canonical scrape registry)
    const { data: src } = await sb
      .from("dealer_outbound_sources")
      .select("account_id")
      .eq("dealer_slug", dealer_slug)
      .maybeSingle();
    if (src?.account_id) {
      resolvedAccountId = src.account_id as string;
    } else {
      // 2) Fallback to direct accounts.slug match
      const { data: acc } = await sb
        .from("accounts")
        .select("id")
        .eq("slug", dealer_slug)
        .maybeSingle();
      if (acc?.id) resolvedAccountId = acc.id as string;
    }
    if (resolvedAccountId) {
      const { data: dp } = await sb
        .from("dealer_profiles")
        .select("id")
        .eq("account_id", resolvedAccountId)
        .limit(1)
        .maybeSingle();
      if (dp?.id) resolvedDealerId = dp.id as string;
      mapped = true;
    }
  } else if (resolvedAccountId && resolvedDealerId) {
    mapped = true;
  }

  // ── Unmapped: queue and exit early (no canonical writes) ────────────────
  if (!mapped || !resolvedAccountId) {
    const slug = dealer_slug || dealer_name || source;
    await sb
      .from("dealer_unmapped_sources")
      .upsert(
        {
          source,
          adapter,
          source_slug: slug,
          source_label: dealer_name ?? null,
          sample_payload: { run_metadata, sample: listings.slice(0, 3) },
          last_seen_at: new Date().toISOString(),
          occurrences: 1,
          status: "pending",
        },
        { onConflict: "source,source_slug", ignoreDuplicates: false },
      );

    return json({
      status: "unmapped",
      message:
        "Dealer identity not bound to an account. Queued in dealer_unmapped_sources for operator review.",
      source,
      source_slug: slug,
      received: listings.length,
    }, 202);
  }

  // ── Open worker_runs audit row ──────────────────────────────────────────
  const { data: runRow } = await sb
    .from("worker_runs")
    .insert({
      dealer_id: resolvedDealerId ?? resolvedAccountId, // dealer_id is NOT NULL
      action: `worker-ingest:${source}${adapter ? `:${adapter}` : ""}`,
      status: "running",
      started_at: startedAt.toISOString(),
      request_payload: {
        source,
        adapter,
        account_id: resolvedAccountId,
        dealer_id: resolvedDealerId,
        run_metadata,
        listing_count: listings.length,
      },
    })
    .select("id")
    .single();
  const runId: string | null = runRow?.id ?? null;

  // ── Active listings upsert into vehicle_listings ────────────────────────
  const now = new Date().toISOString();
  const errors: string[] = [];
  let activeWritten = 0;
  const incomingIds: string[] = [];

  for (const item of listings) {
    try {
      const listingId =
        item.source_listing_id ||
        item.listing_id ||
        (item.url || item.listing_url
          ? `worker:${source}:${(item.url || item.listing_url)!.slice(-120)}`
          : `worker:${source}:${item.make}-${item.model}-${item.year}-${item.km ?? item.odometer ?? "x"}-${item.price ?? item.asking_price ?? "x"}`);
      const cleanId = String(listingId).toLowerCase().replace(/\s+/g, "-");
      incomingIds.push(cleanId);

      const row: Record<string, unknown> = {
        source_listing_id: cleanId,
        source: source,
        source_class: "dealer_site",
        account_id: resolvedAccountId,
        dealer_id: resolvedDealerId,
        make: (item.make || "").toString().toUpperCase().trim() || null,
        model: (item.model || "").toString().toUpperCase().trim() || null,
        variant_raw: item.variant_raw || item.variant || item.title || null,
        year: item.year ?? null,
        km: item.km ?? item.odometer ?? null,
        asking_price: item.asking_price ?? item.price ?? null,
        listing_url: item.listing_url || item.url || null,
        location: item.location || null,
        state: item.state || null,
        transmission: item.transmission || null,
        fuel: item.fuel || null,
        colour: item.colour || null,
        image_url: item.image_url || null,
        vin: item.vin || null,
        lifecycle_state: "ACTIVE",
        status: "active",
        last_seen_at: now,
        updated_at: now,
      };
      // Strip null make/model rows
      if (!row.make || !row.model) {
        errors.push(`${cleanId}: missing make/model`);
        continue;
      }

      const { error } = await sb
        .from("vehicle_listings")
        .upsert(row, { onConflict: "source_listing_id", ignoreDuplicates: false });
      if (error) {
        errors.push(`${cleanId}: ${error.message}`);
      } else {
        activeWritten++;
        // History (best effort)
        await sb.from("market_listing_history").upsert(
          {
            listing_id: cleanId,
            source_site: source,
            price_at_first_seen: row.asking_price,
            first_seen_at: now,
            last_seen_at: now,
          },
          { onConflict: "listing_id,source_site", ignoreDuplicates: false },
        ).then(() => {}, () => {});
      }
    } catch (e) {
      errors.push(`item error: ${(e as Error).message}`);
    }
  }

  // ── Diff vs previous snapshot to infer disappeared/sold ─────────────────
  let disappearedInferred = 0;
  let salesTruthPromoted = 0;

  const { data: prevSnap } = await sb
    .from("dealer_inventory_snapshots")
    .select("listing_ids, snapshot_at")
    .eq("account_id", resolvedAccountId)
    .eq("source", source)
    .order("snapshot_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevIds: string[] = Array.isArray(prevSnap?.listing_ids)
    ? (prevSnap!.listing_ids as string[])
    : [];
  const incomingSet = new Set(incomingIds);
  const disappeared = prevIds.filter((id) => !incomingSet.has(id));

  if (disappeared.length > 0) {
    const { data: gone } = await sb
      .from("vehicle_listings")
      .select(
        "source_listing_id, make, model, variant_raw, year, km, asking_price, listing_url, first_seen_at",
      )
      .in("source_listing_id", disappeared);

    for (const v of gone || []) {
      // Mark listing as DEAD/SOLD
      await sb
        .from("vehicle_listings")
        .update({ lifecycle_state: "SOLD", status: "sold", updated_at: now })
        .eq("source_listing_id", v.source_listing_id);
      disappearedInferred++;

      // Promote to vehicle_sales_truth (inferred / low confidence)
      try {
        const { error: stErr } = await sb.from("vehicle_sales_truth").insert({
          account_id: resolvedAccountId,
          sold_at: new Date().toISOString().slice(0, 10),
          make: v.make,
          model: v.model,
          variant: v.variant_raw,
          year: v.year,
          km: v.km,
          sale_price: v.asking_price ? Math.round(Number(v.asking_price)) : null,
          source: `worker:${source}:disappeared`,
          confidence: "inferred",
          platform_class: "scrape",
          notes: `Inferred from worker-ingest diff. Last listing URL: ${v.listing_url ?? "n/a"}`,
        });
        if (!stErr) salesTruthPromoted++;
      } catch (_) { /* best effort */ }
    }
  }

  // ── Append new snapshot ─────────────────────────────────────────────────
  await sb.from("dealer_inventory_snapshots").insert({
    account_id: resolvedAccountId,
    dealer_id: resolvedDealerId,
    source,
    adapter,
    worker_run_id: runId,
    snapshot_at: now,
    listing_ids: incomingIds,
    listing_count: incomingIds.length,
    raw_meta: run_metadata,
  });

  // ── Trap_crawl_runs (optional, when adapter looks like a trap) ──────────
  try {
    await sb.from("trap_crawl_runs").insert({
      run_date: new Date().toISOString().slice(0, 10),
      trap_slug: dealer_slug || source,
      dealer_name: dealer_name || source,
      parser_mode: adapter || "worker-ingest",
      vehicles_found: listings.length,
      vehicles_ingested: activeWritten,
      vehicles_dropped: listings.length - activeWritten,
      drop_reasons: errors.length ? { errors: errors.slice(0, 20) } : null,
      run_started_at: startedAt.toISOString(),
      run_completed_at: new Date().toISOString(),
      account_id: resolvedAccountId,
      worker_name: "worker-ingest",
      new_listings: activeWritten,
      disappeared_listings: disappearedInferred,
    });
  } catch (_) { /* non-critical */ }

  // ── Fan-out: recompute → mandates → run-mandates (fire and forget) ──────
  const fanout: Record<string, unknown> = {};
  const baseUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const fanCall = async (name: string, payload: Record<string, unknown>) => {
    try {
      const res = await fetch(`${baseUrl}/${name}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${anon}`,
        },
        body: JSON.stringify(payload),
      });
      fanout[name] = res.status;
    } catch (e) {
      fanout[name] = `error:${(e as Error).message}`;
    }
  };

  if (salesTruthPromoted > 0 || activeWritten > 0) {
    await fanCall("recompute-fingerprint-performance", { account_id: resolvedAccountId });
    await fanCall("generate-dealer-mandates", { account_id: resolvedAccountId });
    await fanCall("run-mandates", { account_id: resolvedAccountId });
  }

  // ── Close worker_runs row ───────────────────────────────────────────────
  const finishedAt = new Date();
  const result = {
    status: "ok",
    source,
    adapter,
    account_id: resolvedAccountId,
    dealer_id: resolvedDealerId,
    worker_run_id: runId,
    counts: {
      listings_received: listings.length,
      active_written: activeWritten,
      disappeared_inferred: disappearedInferred,
      sales_truth_promoted: salesTruthPromoted,
      errors: errors.length,
    },
    fanout,
    errors: errors.slice(0, 25),
    duration_ms: Date.now() - t0,
  };

  if (runId) {
    await sb
      .from("worker_runs")
      .update({
        status: errors.length === listings.length && listings.length > 0 ? "error" : "success",
        http_status: 200,
        response_payload: result,
        finished_at: finishedAt.toISOString(),
        duration_ms: Date.now() - t0,
        error: errors.length ? errors.slice(0, 5).join(" | ") : null,
      })
      .eq("id", runId);
  }

  return json(result, 200);
});
