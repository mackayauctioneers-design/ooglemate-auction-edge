// Shared helper: write a Mackay retail sale into `sold_vehicles` and
// cross-reference the matching buy invoice in `invoice_emails` to
// populate days_to_sell / margin_achieved / source.
//
// Used by both the live ingest path (easycars-invoice-ingest) and the
// one-shot backfill job (backfill-sales-truth).

export const MACKAY_SELLER_ABN = "42235562048"; // digits-only canonical form
export const MACKAY_DEALER_ID = "mackay_traders";

const QUALIFY_MIN_YEAR = 2020;
const QUALIFY_MAX_ODO = 120000;
const ODO_VARIANCE_KM = 5000;
const MATCH_WINDOW_DAYS = 365;

export function normaliseAbn(abn: string | null | undefined): string {
  return (abn ?? "").replace(/\D/g, "");
}

export interface SoldVehicleInput {
  seller_abn?: string | null;
  make?: string | null;
  model?: string | null;
  series?: string | null;
  variant?: string | null;
  year?: number | string | null;
  odometer?: number | string | null;
  sale_price?: number | string | null;
  sale_date?: string | null; // ISO
  vin?: string | null;
  source?: string | null;
  invoice_email_id?: string | null;
}

export interface WriteResult {
  qualified: boolean;          // passed seller + filter check
  reason?: string;             // why skipped
  sold_vehicle_id?: string;
  cross_referenced?: boolean;
}

export function qualifies(input: SoldVehicleInput): { ok: boolean; reason?: string } {
  if (normaliseAbn(input.seller_abn) !== MACKAY_SELLER_ABN) {
    return { ok: false, reason: "not_mackay_seller" };
  }
  const year = typeof input.year === "string" ? parseInt(input.year) : input.year ?? 0;
  if (!year || year < QUALIFY_MIN_YEAR) return { ok: false, reason: "year_filter" };
  const odo = typeof input.odometer === "string" ? parseInt(input.odometer) : input.odometer ?? 0;
  if (!odo || odo > QUALIFY_MAX_ODO) return { ok: false, reason: "odometer_filter" };
  if (!input.make || !input.model) return { ok: false, reason: "missing_make_model" };
  if (!input.sale_price || !input.sale_date) return { ok: false, reason: "missing_price_or_date" };
  return { ok: true };
}

/**
 * Idempotent write: upserts on (dealer_id, vin) when VIN present,
 * else (dealer_id, make, model, year, odometer, sale_date).
 * Then attempts a cross-reference to the buy invoice in invoice_emails.
 */
export async function writeSoldVehicle(
  supabase: any,
  input: SoldVehicleInput,
): Promise<WriteResult> {
  const q = qualifies(input);
  if (!q.ok) return { qualified: false, reason: q.reason };

  const make = String(input.make).toUpperCase().trim();
  const model = String(input.model).toUpperCase().trim();
  const year = typeof input.year === "string" ? parseInt(input.year) : input.year!;
  const odometer = typeof input.odometer === "string" ? parseInt(input.odometer) : input.odometer!;
  const sale_price = typeof input.sale_price === "string" ? Number(input.sale_price) : input.sale_price!;
  const vin = input.vin ? String(input.vin).toUpperCase().trim() : null;

  const row = {
    dealer_id: MACKAY_DEALER_ID,
    make,
    model,
    series: input.series ?? null,
    variant: input.variant ?? null,
    year,
    odometer,
    sale_price,
    sale_date: input.sale_date,
    vin,
    source: input.source ?? null,
    tier: "retail",
    invoice_email_id: input.invoice_email_id ?? null,
  };

  // Choose conflict target based on VIN availability
  const conflictTarget = vin
    ? "dealer_id,vin"
    : "dealer_id,make,model,year,odometer,sale_date";

  const { data: upserted, error: upsertErr } = await supabase
    .from("sold_vehicles")
    .upsert(row, { onConflict: conflictTarget, ignoreDuplicates: false })
    .select("id")
    .maybeSingle();

  if (upsertErr) {
    console.error("[writeSoldVehicle] upsert error:", upsertErr.message);
    return { qualified: true, reason: `upsert_failed: ${upsertErr.message}` };
  }

  const sold_vehicle_id = upserted?.id;
  if (!sold_vehicle_id) {
    return { qualified: true, sold_vehicle_id: undefined, cross_referenced: false };
  }

  // ── Cross-reference: find matching buy invoice ──
  const cross = await crossReference(supabase, sold_vehicle_id, {
    make,
    model,
    year,
    odometer,
    sale_date: input.sale_date!,
    sale_price,
    vin,
  });

  return { qualified: true, sold_vehicle_id, cross_referenced: cross };
}

interface XRefArgs {
  make: string;
  model: string;
  year: number;
  odometer: number;
  sale_date: string;
  sale_price: number;
  vin: string | null;
}

async function crossReference(
  supabase: any,
  sold_vehicle_id: string,
  v: XRefArgs,
): Promise<boolean> {
  try {
    const saleDate = new Date(v.sale_date);
    const windowStart = new Date(saleDate);
    windowStart.setDate(windowStart.getDate() - MATCH_WINDOW_DAYS);

    // Step 1: VIN exact match (preferred)
    let buy: any = null;
    if (v.vin) {
      const { data } = await supabase
        .from("invoice_emails")
        .select("id, invoice_date, purchase_price_inc_gst, supplier_name, odo_km")
        .eq("vin", v.vin)
        .neq("supplier_abn", MACKAY_SELLER_ABN) // it's a buy, so seller != Mackay
        .lt("invoice_date", v.sale_date)
        .gte("invoice_date", windowStart.toISOString().slice(0, 10))
        .order("invoice_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      buy = data;
    }

    // Step 2: Fuzzy match
    if (!buy) {
      const { data } = await supabase
        .from("invoice_emails")
        .select("id, invoice_date, purchase_price_inc_gst, supplier_name, odo_km")
        .eq("make", v.make)
        .eq("model", v.model)
        .eq("year", v.year)
        .gte("odo_km", Math.max(0, v.odometer - ODO_VARIANCE_KM))
        .lte("odo_km", v.odometer + ODO_VARIANCE_KM)
        .neq("supplier_abn", MACKAY_SELLER_ABN)
        .lt("invoice_date", v.sale_date)
        .gte("invoice_date", windowStart.toISOString().slice(0, 10))
        .order("invoice_date", { ascending: false })
        .limit(5);
      // Pick closest odo
      if (data && data.length) {
        data.sort((a: any, b: any) =>
          Math.abs((a.odo_km ?? 0) - v.odometer) -
          Math.abs((b.odo_km ?? 0) - v.odometer)
        );
        buy = data[0];
      }
    }

    if (!buy) return false;

    const buyDate = new Date(buy.invoice_date);
    const days_to_sell = Math.max(
      0,
      Math.round((saleDate.getTime() - buyDate.getTime()) / 86400000),
    );
    const buy_price = Number(buy.purchase_price_inc_gst ?? 0);
    const margin_achieved = buy_price > 0 ? v.sale_price - buy_price : null;
    const source = buy.supplier_name ?? null;

    const { error: updErr } = await supabase
      .from("sold_vehicles")
      .update({
        days_to_sell,
        margin_achieved,
        source,
        buy_invoice_id: buy.id,
      })
      .eq("id", sold_vehicle_id);

    if (updErr) {
      console.error("[crossReference] update error:", updErr.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error("[crossReference] error:", err.message);
    return false;
  }
}
