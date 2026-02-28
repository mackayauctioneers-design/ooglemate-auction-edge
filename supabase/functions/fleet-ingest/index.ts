/**
 * fleet-ingest
 * ─────────────────────────────────────────────────────────────────────────────
 * Secure endpoint for receiving DMS sales and inventory data from fleet clients.
 *
 * Supports two modes:
 *   POST /fleet-ingest?type=sales      — ingest sold vehicle records
 *   POST /fleet-ingest?type=inventory  — ingest current inventory snapshot
 *
 * Authentication: X-Fleet-API-Key header (matches fleet_clients.ingest_api_key)
 *
 * Payload format (sales):
 *   { records: [ { stock_number, vin, make, model, year, trim, odometer,
 *                  acquisition_date, acquisition_cost, reconditioning_cost,
 *                  sale_date, sale_price, source_channel, ... } ] }
 *
 * Payload format (inventory):
 *   { records: [ { stock_number, vin, make, model, year, trim, odometer,
 *                  asking_price, acquisition_cost, days_on_lot, status, ... } ] }
 *
 * After ingestion, triggers the Velocity Engine to recompute metrics.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-fleet-api-key",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Authentication ──────────────────────────────────────────────────────────
  const apiKey = req.headers.get("x-fleet-api-key");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing X-Fleet-API-Key header" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: client, error: clientError } = await sb
    .from("fleet_clients")
    .select("id, slug, display_name, is_active")
    .eq("ingest_api_key", apiKey)
    .single();

  if (clientError || !client) {
    return new Response(JSON.stringify({ error: "Invalid API key" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!client.is_active) {
    return new Response(JSON.stringify({ error: "Fleet client account is inactive" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Parse request ───────────────────────────────────────────────────────────
  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "sales"; // 'sales' | 'inventory'

  let body: { records: Record<string, unknown>[] };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!Array.isArray(body.records) || body.records.length === 0) {
    return new Response(JSON.stringify({ error: "body.records must be a non-empty array" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const batchId = crypto.randomUUID();
  const fleetClientId = client.id;
  const results = { inserted: 0, updated: 0, errors: 0, error_details: [] as string[] };

  // ── Sales ingestion ─────────────────────────────────────────────────────────
  if (type === "sales") {
    for (const raw of body.records) {
      // Validate required fields
      if (!raw.make || !raw.model || !raw.sale_date || !raw.sale_price) {
        results.errors++;
        results.error_details.push(`Record missing required fields: ${JSON.stringify({ make: raw.make, model: raw.model, sale_date: raw.sale_date })}`);
        continue;
      }

      const record = {
        fleet_client_id: fleetClientId,
        stock_number: raw.stock_number as string || null,
        vin: raw.vin as string || null,
        make: String(raw.make).toUpperCase().trim(),
        model: String(raw.model).trim(),
        year: raw.year ? parseInt(String(raw.year)) : null,
        trim: raw.trim as string || null,
        engine_type: raw.engine_type as string || null,
        transmission: raw.transmission as string || null,
        drivetrain: raw.drivetrain as string || null,
        odometer: raw.odometer ? parseInt(String(raw.odometer)) : null,
        colour: raw.colour as string || null,
        acquisition_date: raw.acquisition_date as string || null,
        acquisition_cost: raw.acquisition_cost ? parseFloat(String(raw.acquisition_cost)) : null,
        reconditioning_cost: raw.reconditioning_cost ? parseFloat(String(raw.reconditioning_cost)) : 0,
        sale_date: raw.sale_date as string,
        sale_price: parseFloat(String(raw.sale_price)),
        source_channel: raw.source_channel as string || null,
        raw_payload: raw,
        ingest_batch_id: batchId,
      };

      const { error } = await sb
        .from("dms_sales_feed")
        .upsert(record, { onConflict: "fleet_client_id,stock_number,sale_date", ignoreDuplicates: false });

      if (error) {
        results.errors++;
        results.error_details.push(error.message);
      } else {
        results.inserted++;
      }
    }

    console.log(`[FLEET-INGEST] ${client.slug} sales batch ${batchId}: ${results.inserted} inserted, ${results.errors} errors`);

    // Trigger velocity engine recompute asynchronously
    if (results.inserted > 0) {
      sb.functions.invoke("fleet-velocity-engine", {
        body: { fleet_client_id: fleetClientId, trigger: "sales_ingest" },
      }).catch((e) => console.error("[FLEET-INGEST] Failed to trigger velocity engine:", e));
    }
  }

  // ── Inventory ingestion ─────────────────────────────────────────────────────
  else if (type === "inventory") {
    for (const raw of body.records) {
      if (!raw.make || !raw.model || !raw.stock_number) {
        results.errors++;
        results.error_details.push(`Inventory record missing required fields: ${JSON.stringify({ make: raw.make, model: raw.model, stock_number: raw.stock_number })}`);
        continue;
      }

      const record = {
        fleet_client_id: fleetClientId,
        stock_number: String(raw.stock_number),
        vin: raw.vin as string || null,
        make: String(raw.make).toUpperCase().trim(),
        model: String(raw.model).trim(),
        year: raw.year ? parseInt(String(raw.year)) : null,
        trim: raw.trim as string || null,
        engine_type: raw.engine_type as string || null,
        transmission: raw.transmission as string || null,
        drivetrain: raw.drivetrain as string || null,
        odometer: raw.odometer ? parseInt(String(raw.odometer)) : null,
        colour: raw.colour as string || null,
        asking_price: raw.asking_price ? parseFloat(String(raw.asking_price)) : null,
        acquisition_cost: raw.acquisition_cost ? parseFloat(String(raw.acquisition_cost)) : null,
        days_on_lot: raw.days_on_lot ? parseInt(String(raw.days_on_lot)) : null,
        location: raw.location as string || null,
        status: (raw.status as string) || "available",
        last_seen_at: new Date().toISOString(),
      };

      const { error } = await sb
        .from("fleet_inventory_feed")
        .upsert(record, { onConflict: "fleet_client_id,stock_number" });

      if (error) {
        results.errors++;
        results.error_details.push(error.message);
      } else {
        results.inserted++;
      }
    }

    console.log(`[FLEET-INGEST] ${client.slug} inventory batch ${batchId}: ${results.inserted} upserted, ${results.errors} errors`);
  } else {
    return new Response(JSON.stringify({ error: "Invalid type parameter. Use 'sales' or 'inventory'" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({
    success: true,
    batch_id: batchId,
    fleet_client: client.slug,
    type,
    ...results,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
