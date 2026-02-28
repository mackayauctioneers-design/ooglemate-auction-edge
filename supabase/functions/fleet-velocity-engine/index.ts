/**
 * fleet-velocity-engine
 * ─────────────────────────────────────────────────────────────────────────────
 * The analytical core of CarBitrage Fleet.
 *
 * For a given fleet client, this function:
 *   1. Reads all sales from dms_sales_feed (last 90 days)
 *   2. Groups by vehicle fingerprint (make/model/year_band/trim/engine_type)
 *   3. Computes 30-day and 90-day metrics per fingerprint:
 *      - Units sold, avg days to sell, avg gross profit, avg sale price
 *   4. Joins with fleet_inventory_feed to get current stock counts
 *   5. Computes stock_gap_units and opportunity_value_monthly
 *   6. Upserts results into fleet_velocity_metrics
 *
 * Triggered by:
 *   - fleet-ingest (after sales data arrives)
 *   - pg_cron (nightly at 2am AEST)
 *   - Manual invocation from the operator dashboard
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── Helpers ──────────────────────────────────────────────────────────────────

function yearBand(year: number | null): string {
  if (!year) return "unknown";
  // Group into 3-year bands: 2019-2021, 2022-2024, etc.
  const base = Math.floor(year / 3) * 3;
  return `${base}-${base + 2}`;
}

function avg(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function velocityScore(units30d: number, avgGross30d: number | null, avgDays: number | null): number {
  // Higher score = faster moving + higher margin + faster sell
  const unitWeight = units30d * 10;
  const marginWeight = avgGross30d ? Math.min(avgGross30d / 500, 30) : 0;
  const speedWeight = avgDays ? Math.max(0, 30 - avgDays) : 0;
  return Math.round(unitWeight + marginWeight + speedWeight);
}

// ── Main ─────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let fleetClientId: string | null = null;

  // Accept both authenticated operator calls and internal service calls
  try {
    const body = await req.json();
    fleetClientId = body.fleet_client_id || null;
  } catch {
    // no body — will process all active clients
  }

  // Determine which clients to process
  let clientIds: string[] = [];
  if (fleetClientId) {
    clientIds = [fleetClientId];
  } else {
    const { data: clients } = await sb
      .from("fleet_clients")
      .select("id")
      .eq("is_active", true);
    clientIds = (clients || []).map((c: { id: string }) => c.id);
  }

  if (clientIds.length === 0) {
    return new Response(JSON.stringify({ message: "No active fleet clients to process" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const summary: Record<string, { fingerprints: number; gaps_identified: number }> = {};

  for (const clientId of clientIds) {
    const now = new Date();
    const cutoff90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const cutoff30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    // Fetch all sales in the last 90 days
    const { data: sales, error: salesError } = await sb
      .from("dms_sales_feed")
      .select("make, model, year, trim, engine_type, odometer, acquisition_cost, reconditioning_cost, sale_date, sale_price, gross_profit, days_to_sell")
      .eq("fleet_client_id", clientId)
      .gte("sale_date", cutoff90);

    if (salesError || !sales) {
      console.error(`[VELOCITY] Error fetching sales for client ${clientId}:`, salesError);
      continue;
    }

    // Fetch current inventory
    const { data: inventory } = await sb
      .from("fleet_inventory_feed")
      .select("make, model, year, trim, engine_type, days_on_lot")
      .eq("fleet_client_id", clientId)
      .eq("status", "available");

    // ── Group sales by fingerprint ──────────────────────────────────────────
    type FingerprintKey = string;
    type SaleRecord = {
      make: string; model: string; year: number | null; trim: string | null;
      engine_type: string | null; sale_date: string; gross_profit: number | null;
      days_to_sell: number | null; sale_price: number; acquisition_cost: number | null;
    };

    const fingerprintMap = new Map<FingerprintKey, SaleRecord[]>();

    for (const sale of sales as SaleRecord[]) {
      const key = `${sale.make}||${sale.model}||${yearBand(sale.year)}||${sale.trim || ""}||${sale.engine_type || ""}`;
      if (!fingerprintMap.has(key)) fingerprintMap.set(key, []);
      fingerprintMap.get(key)!.push(sale);
    }

    // ── Group inventory by fingerprint ──────────────────────────────────────
    type InvRecord = { make: string; model: string; year: number | null; trim: string | null; engine_type: string | null; days_on_lot: number | null };
    const inventoryMap = new Map<FingerprintKey, InvRecord[]>();

    for (const inv of (inventory || []) as InvRecord[]) {
      const key = `${inv.make}||${inv.model}||${yearBand(inv.year)}||${inv.trim || ""}||${inv.engine_type || ""}`;
      if (!inventoryMap.has(key)) inventoryMap.set(key, []);
      inventoryMap.get(key)!.push(inv);
    }

    // ── Compute metrics per fingerprint ─────────────────────────────────────
    const metricsToUpsert = [];
    let gapsIdentified = 0;

    for (const [key, allSales] of fingerprintMap.entries()) {
      const [make, model, year_band, trim, engine_type] = key.split("||");

      const sales90 = allSales;
      const sales30 = allSales.filter((s) => s.sale_date >= cutoff30);

      const grossProfits90 = sales90.map((s) => s.gross_profit).filter((g): g is number => g !== null);
      const grossProfits30 = sales30.map((s) => s.gross_profit).filter((g): g is number => g !== null);
      const days90 = sales90.map((s) => s.days_to_sell).filter((d): d is number => d !== null);
      const days30 = sales30.map((s) => s.days_to_sell).filter((d): d is number => d !== null);
      const salePrices90 = sales90.map((s) => s.sale_price);
      const salePrices30 = sales30.map((s) => s.sale_price);
      const acqCosts90 = sales90.map((s) => s.acquisition_cost).filter((c): c is number => c !== null);
      const acqCosts30 = sales30.map((s) => s.acquisition_cost).filter((c): c is number => c !== null);

      const inStock = inventoryMap.get(key) || [];
      const avgDaysOnLot = avg(inStock.map((i) => i.days_on_lot).filter((d): d is number => d !== null));

      // Stock gap: how many more should we have?
      // If we're selling 4/month and have 2 in stock, gap = 2
      const monthlyVelocity = sales30.length; // units sold in last 30 days
      const currentStock = inStock.length;
      const targetStock = Math.ceil(monthlyVelocity * 1.5); // 1.5x monthly velocity as target
      const stockGapUnits = Math.max(0, targetStock - currentStock);

      const avgGross30d = avg(grossProfits30);
      const opportunityValueMonthly = stockGapUnits > 0 && avgGross30d
        ? stockGapUnits * avgGross30d
        : 0;

      if (stockGapUnits > 0) gapsIdentified++;

      metricsToUpsert.push({
        fleet_client_id: clientId,
        make,
        model,
        year_band,
        trim: trim || null,
        engine_type: engine_type || null,
        // 30-day
        units_sold_30d: sales30.length,
        avg_days_to_sell_30d: avg(days30),
        avg_gross_profit_30d: avgGross30d,
        avg_acquisition_cost_30d: avg(acqCosts30),
        avg_sale_price_30d: avg(salePrices30),
        // 90-day
        units_sold_90d: sales90.length,
        avg_days_to_sell_90d: avg(days90),
        avg_gross_profit_90d: avg(grossProfits90),
        avg_acquisition_cost_90d: avg(acqCosts90),
        avg_sale_price_90d: avg(salePrices90),
        // Inventory
        units_in_stock: currentStock,
        avg_days_on_lot: avgDaysOnLot,
        // Derived
        velocity_score: velocityScore(sales30.length, avgGross30d, avg(days30)),
        stock_gap_units: stockGapUnits,
        opportunity_value_monthly: opportunityValueMonthly,
        computed_at: new Date().toISOString(),
      });
    }

    // Upsert in batches of 100
    for (let i = 0; i < metricsToUpsert.length; i += 100) {
      const batch = metricsToUpsert.slice(i, i + 100);
      const { error } = await sb
        .from("fleet_velocity_metrics")
        .upsert(batch, { onConflict: "fleet_client_id,make,model,year_band,trim,engine_type" });
      if (error) console.error(`[VELOCITY] Upsert error for client ${clientId}:`, error);
    }

    summary[clientId] = { fingerprints: metricsToUpsert.length, gaps_identified: gapsIdentified };
    console.log(`[VELOCITY] Client ${clientId}: ${metricsToUpsert.length} fingerprints, ${gapsIdentified} gaps identified`);

    // Log to cron_audit_log
    await sb.from("cron_audit_log").insert({
      cron_name: "fleet-velocity-engine",
      status: "success",
      detail: `Client ${clientId}: ${metricsToUpsert.length} fingerprints, ${gapsIdentified} gaps`,
    }).catch(() => {});
  }

  return new Response(JSON.stringify({ success: true, summary }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
