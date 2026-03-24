import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractBadge } from "../_shared/taxonomy/extractBadge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { account_id, dry_run = false } = await req.json();
    if (!account_id) {
      return new Response(
        JSON.stringify({ error: "account_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch all sales for this account that need trim_class
    const { data: rows, error } = await supabase
      .from("vehicle_sales_truth")
      .select("id, make, model, variant, badge, trim_class")
      .eq("account_id", account_id)
      .is("trim_class", null);

    if (error) throw error;
    if (!rows?.length) {
      return new Response(
        JSON.stringify({ message: "No rows need backfill", updated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const updates: { id: string; trim_class: string; badge: string | null }[] = [];
    const skipped: { id: string; make: string; model: string; variant: string | null }[] = [];

    for (const row of rows) {
      const extracted = extractBadge(
        row.make || "",
        row.model || "",
        row.variant || "",
      );

      const trimClass = extracted.badge || row.badge || null;

      if (trimClass) {
        updates.push({ id: row.id, trim_class: trimClass, badge: extracted.badge });
      } else {
        // For records with no variant text and no badge, derive from model
        // e.g. "BMW X3" → trim_class = "BASE"
        // But only if we have a variant to parse
        skipped.push({
          id: row.id,
          make: row.make,
          model: row.model,
          variant: row.variant,
        });
      }
    }

    let updatedCount = 0;
    if (!dry_run && updates.length > 0) {
      // Batch update in chunks of 50
      for (let i = 0; i < updates.length; i += 50) {
        const chunk = updates.slice(i, i + 50);
        for (const u of chunk) {
          const updateFields: Record<string, string | null> = { trim_class: u.trim_class };
          if (u.badge) updateFields.badge = u.badge;

          const { error: upErr } = await supabase
            .from("vehicle_sales_truth")
            .update(updateFields)
            .eq("id", u.id);

          if (!upErr) updatedCount++;
        }
      }
    }

    // Summary by make/model
    const summary: Record<string, { total: number; filled: number; trims: Record<string, number> }> = {};
    for (const row of rows) {
      const key = `${row.make}:${row.model}`;
      if (!summary[key]) summary[key] = { total: 0, filled: 0, trims: {} };
      summary[key].total++;
    }
    for (const u of updates) {
      const row = rows.find((r: any) => r.id === u.id);
      if (row) {
        const key = `${row.make}:${row.model}`;
        summary[key].filled++;
        summary[key].trims[u.trim_class] = (summary[key].trims[u.trim_class] || 0) + 1;
      }
    }

    return new Response(
      JSON.stringify({
        total_rows: rows.length,
        matched: updates.length,
        skipped: skipped.length,
        updated: dry_run ? 0 : updatedCount,
        dry_run,
        summary,
        sample_skipped: skipped.slice(0, 10),
        sample_updates: updates.slice(0, 10),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Backfill error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
