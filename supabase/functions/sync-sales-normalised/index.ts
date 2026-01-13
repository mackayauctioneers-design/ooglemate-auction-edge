import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function safeNum(v: any): number | null {
  const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function safeInt(v: any): number | null {
  const n = parseInt(String(v ?? "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function safeText(v: any): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function safeDate(v: any): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  // Expect YYYY-MM-DD or DD/MM/YYYY in sheet
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    const yy = (m[3].length === 2 ? "20" + m[3] : m[3]);
    return `${yy}-${mm}-${dd}`;
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    console.log("[sync-sales-normalised] Starting sync from Google Sheets...");
    
    // Pull Sales_Normalised from existing google-sheets edge function
    const res = await fetch(`${SUPABASE_URL}/functions/v1/google-sheets`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "read", sheet: "Sales_Normalised" }),
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`google-sheets read failed: ${res.status} ${t}`);
    }

    const json = await res.json();
    const rows: any[] = json?.data ?? [];
    
    console.log(`[sync-sales-normalised] Fetched ${rows.length} rows from Google Sheets`);

    // Map rows → table shape
    const upserts = rows.map((r, idx) => {
      const sourceRowId =
        safeText(r.sale_id) ||
        safeText(r.id) ||
        safeText(r._rowIndex) ||
        `row_${idx}`;

      return {
        source_row_id: sourceRowId,
        dealer_name: safeText(r.dealer_name),
        sale_date: safeDate(r.sale_date),
        make: safeText(r.make)?.toUpperCase() ?? null,
        model: safeText(r.model)?.toUpperCase() ?? null,
        variant_used: safeText(r.variant_used || r.variant_normalised || r.variant_family)?.toUpperCase() ?? null,
        variant_family: safeText(r.variant_family)?.toUpperCase() ?? null,
        year: safeInt(r.year),
        km: safeInt(r.km),
        sale_price: safeNum(r.sale_price),
        gross_profit: safeNum(r.gross_profit),
        days_in_stock: safeInt(r.days_in_stock || r.days_to_sell || r.days_to_deposit),
        transmission: safeText(r.transmission)?.toUpperCase() ?? null,
        fuel: safeText(r.fuel)?.toUpperCase() ?? null,
        drivetrain: safeText(r.drivetrain)?.toUpperCase() ?? null,
        region_id: safeText(r.region_id)?.toUpperCase() ?? null,
        updated_at: new Date().toISOString(),
      };
    });

    const { error } = await supabase
      .from("sales_normalised")
      .upsert(upserts, { onConflict: "source_row_id" });

    if (error) throw error;

    console.log(`[sync-sales-normalised] Upserted ${upserts.length} rows`);

    // Audit log
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from("cron_audit_log").upsert({
      cron_name: "sync-sales-normalised",
      run_date: today,
      success: true,
      result: { rows: upserts.length },
    }, { onConflict: "cron_name,run_date" });

    return new Response(JSON.stringify({ success: true, rows: upserts.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[sync-sales-normalised] Error:", e);
    
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from("cron_audit_log").upsert({
      cron_name: "sync-sales-normalised",
      run_date: today,
      success: false,
      error: e?.message ?? String(e),
    }, { onConflict: "cron_name,run_date" });

    return new Response(JSON.stringify({ success: false, error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
