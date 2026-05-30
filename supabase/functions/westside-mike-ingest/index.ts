// westside-mike-ingest
// Secure ingestion endpoint for Arby's Mike @ Westside Auto snapshots.
// Auth: Bearer WESTSIDE_MIKE_INGEST_KEY (NEVER service_role from caller).
// Body: { listings: ArbyListing[], notes?: string }
// Behaviour:
//   - Creates a snapshot row
//   - Upserts each listing (price ends in 95 only)
//   - Emits history events: NEW / PRICE_DROP / PRICE_RAISE / KM_UPDATE / RELISTED
//   - Marks listings missing from this push as GONE after 2 consecutive misses
//   - Returns counts so Arby can verify

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ArbyListing {
  source_listing_id: string;
  listing_url: string;
  title?: string | null;
  make?: string | null;
  model?: string | null;
  variant?: string | null;
  year?: number | null;
  km?: number | null;
  price: number;
  body_type?: string | null;
  transmission?: string | null;
  fuel?: string | null;
  colour?: string | null;
  vin?: string | null;
  stock_no?: string | null;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
  photos?: string[] | null;
  description?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Auth: bearer token must match WESTSIDE_MIKE_INGEST_KEY
  const expected = Deno.env.get("WESTSIDE_MIKE_INGEST_KEY");
  if (!expected) {
    return new Response(JSON.stringify({ error: "Endpoint not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { listings?: ArbyListing[]; notes?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!body?.listings || !Array.isArray(body.listings)) {
    return new Response(JSON.stringify({ error: "listings[] required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Create snapshot row first so we can attribute events
  const { data: snap, error: snapErr } = await supabase
    .from("westside_mike_snapshots")
    .insert({ listings_in: body.listings.length, notes: body.notes ?? null })
    .select("id")
    .single();
  if (snapErr || !snap) {
    console.error("snapshot insert failed", snapErr);
    return new Response(JSON.stringify({ error: "snapshot_failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const snapshotId = snap.id as string;
  const now = new Date().toISOString();

  let newCount = 0;
  let priceDropCount = 0;
  let priceRaiseCount = 0;
  let relistedCount = 0;
  const seenIds: string[] = [];
  const historyRows: Record<string, unknown>[] = [];

  for (const raw of body.listings) {
    // Gate: must be Mike's pricing convention
    if (!raw?.source_listing_id || typeof raw.price !== "number") continue;
    const priceInt = Math.round(raw.price);
    if (priceInt % 100 !== 95) continue;

    seenIds.push(raw.source_listing_id);

    // Lookup existing
    const { data: existing } = await supabase
      .from("westside_mike_listings")
      .select("id, price, km, status, first_seen_at")
      .eq("source_listing_id", raw.source_listing_id)
      .maybeSingle();

    const upsertRow = {
      source_listing_id: raw.source_listing_id,
      listing_url: raw.listing_url,
      title: raw.title ?? null,
      make: raw.make ?? null,
      model: raw.model ?? null,
      variant: raw.variant ?? null,
      year: raw.year ?? null,
      km: raw.km ?? null,
      price: priceInt,
      body_type: raw.body_type ?? null,
      transmission: raw.transmission ?? null,
      fuel: raw.fuel ?? null,
      colour: raw.colour ?? null,
      vin: raw.vin ?? null,
      stock_no: raw.stock_no ?? null,
      photos: raw.photos ?? [],
      description: raw.description ?? null,
      first_seen_at: existing?.first_seen_at ?? (raw.first_seen_at ?? now),
      last_seen_at: now,
      last_snapshot_id: snapshotId,
      status: "ACTIVE",
      gone_at: null,
      missed_snapshots: 0,
      raw: raw as unknown as Record<string, unknown>,
    };

    const { error: upErr } = await supabase
      .from("westside_mike_listings")
      .upsert(upsertRow, { onConflict: "source_listing_id" });
    if (upErr) {
      console.error("upsert failed", raw.source_listing_id, upErr);
      continue;
    }

    if (!existing) {
      newCount++;
      historyRows.push({
        source_listing_id: raw.source_listing_id,
        snapshot_id: snapshotId,
        event_type: "NEW",
        new_price: priceInt,
        new_km: raw.km ?? null,
        payload: { url: raw.listing_url, title: raw.title },
      });
    } else {
      if (existing.status === "GONE") {
        relistedCount++;
        historyRows.push({
          source_listing_id: raw.source_listing_id,
          snapshot_id: snapshotId,
          event_type: "RELISTED",
          new_price: priceInt,
          new_km: raw.km ?? null,
        });
      }
      if (existing.price != null && Number(existing.price) !== priceInt) {
        const isDrop = priceInt < Number(existing.price);
        if (isDrop) priceDropCount++; else priceRaiseCount++;
        historyRows.push({
          source_listing_id: raw.source_listing_id,
          snapshot_id: snapshotId,
          event_type: isDrop ? "PRICE_DROP" : "PRICE_RAISE",
          prev_price: existing.price,
          new_price: priceInt,
        });
      }
      if (raw.km != null && existing.km != null && raw.km !== existing.km) {
        historyRows.push({
          source_listing_id: raw.source_listing_id,
          snapshot_id: snapshotId,
          event_type: "KM_UPDATE",
          prev_km: existing.km,
          new_km: raw.km,
        });
      }
    }
  }

  // Bulk insert history
  if (historyRows.length) {
    const { error: histErr } = await supabase
      .from("westside_mike_listing_history")
      .insert(historyRows);
    if (histErr) console.error("history insert failed", histErr);
  }

  // Mark missing-from-this-push listings: bump missed_snapshots; GONE after 2 misses
  const { data: actives } = await supabase
    .from("westside_mike_listings")
    .select("id, source_listing_id, missed_snapshots, status")
    .eq("status", "ACTIVE");

  let goneCount = 0;
  const goneHistory: Record<string, unknown>[] = [];
  for (const row of actives ?? []) {
    if (seenIds.includes(row.source_listing_id)) continue;
    const missed = (row.missed_snapshots ?? 0) + 1;
    if (missed >= 2) {
      goneCount++;
      await supabase
        .from("westside_mike_listings")
        .update({ status: "GONE", gone_at: now, missed_snapshots: missed })
        .eq("id", row.id);
      goneHistory.push({
        source_listing_id: row.source_listing_id,
        snapshot_id: snapshotId,
        event_type: "GONE",
      });
    } else {
      await supabase
        .from("westside_mike_listings")
        .update({ missed_snapshots: missed })
        .eq("id", row.id);
    }
  }
  if (goneHistory.length) {
    await supabase.from("westside_mike_listing_history").insert(goneHistory);
  }

  // Update snapshot summary
  await supabase
    .from("westside_mike_snapshots")
    .update({
      new_count: newCount,
      price_drop_count: priceDropCount,
      gone_count: goneCount,
      relisted_count: relistedCount,
    })
    .eq("id", snapshotId);

  return new Response(
    JSON.stringify({
      ok: true,
      snapshot_id: snapshotId,
      received: body.listings.length,
      ingested: seenIds.length,
      new: newCount,
      price_drops: priceDropCount,
      price_raises: priceRaiseCount,
      relisted: relistedCount,
      gone: goneCount,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
