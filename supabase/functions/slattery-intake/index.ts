/**
 * slattery-intake — Secure push endpoint for the Slattery scraper.
 *
 * Auth: Bearer ${SLATTERY_INGEST_KEY}.
 * Maps generic Slattery JSON → vehicle_listings (source='slattery', source_class='auction')
 * and appends to market_listing_history.
 *
 * POST body: { listings: [{ stock_number, year, make, model, odometer, sale_type, fuel_type, url, location?, asking_price? }, ...] }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  // Auth
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const expected = Deno.env.get("SLATTERY_INGEST_KEY");
  if (!expected || token !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const listings: any[] = body?.listings;
  if (!Array.isArray(listings) || !listings.length) {
    return json({ error: "listings array required" }, 400);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = new Date().toISOString();
  let upserted = 0,
    skipped = 0;
  const errors: string[] = [];

  for (const item of listings) {
    try {
      const stock = String(item.stock_number ?? item.stock ?? "").trim();
      const make = String(item.make ?? "").trim();
      const model = String(item.model ?? "").trim();
      const year = Number(item.year);
      if (!stock || !make || !model || !Number.isFinite(year)) {
        skipped++;
        errors.push(`bad row: ${JSON.stringify({ stock, make, model, year })}`);
        continue;
      }

      const listingId = `slattery:${stock}`;
      const row: Record<string, unknown> = {
        listing_id: listingId,
        lot_id: stock,
        source: "slattery",
        source_class: "auction",
        auction_house: "Slattery",
        make: make.toUpperCase(),
        model: model.toUpperCase(),
        variant_raw: item.model || null,
        year,
        km: item.odometer != null ? Number(item.odometer) : null,
        fuel: item.fuel_type || null,
        location: item.location || null,
        listing_url: item.url || item.listing_url || null,
        asking_price: item.asking_price != null ? Number(item.asking_price) : null,
        status: "active",
        lifecycle_state: "NEW",
        seller_type: "auction",
        visible_to_dealers: true,
        first_seen_at: now,
        last_seen_at: now,
        updated_at: now,
        external_id: stock,
      };

      const { error } = await sb
        .from("vehicle_listings")
        .upsert(row, { onConflict: "listing_id", ignoreDuplicates: false });

      if (error) {
        errors.push(`${listingId}: ${error.message}`);
        skipped++;
        continue;
      }
      upserted++;

      await sb.from("market_listing_history").upsert(
        {
          listing_id: listingId,
          source_site: "slattery",
          price_at_first_seen: row.asking_price ?? null,
          first_seen_at: now,
          last_seen_at: now,
        },
        { onConflict: "listing_id,source_site", ignoreDuplicates: false },
      );
    } catch (e: any) {
      skipped++;
      errors.push(`item error: ${e?.message || e}`);
    }
  }

  console.log(
    `[slattery-intake] received=${listings.length} upserted=${upserted} skipped=${skipped}`,
  );
  return json({
    status: "ok",
    received: listings.length,
    upserted,
    skipped,
    errors: errors.slice(0, 20),
  });
});
