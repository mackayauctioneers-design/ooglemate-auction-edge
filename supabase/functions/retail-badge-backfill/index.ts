
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractBadge } from "../_shared/taxonomy/extractBadge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * retail-badge-backfill: One-shot backfill of badge/fuel/drivetrain
 * on existing retail_listings where variant_raw exists but badge is NULL.
 * 
 * Processes in batches of 500. Call repeatedly until done.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const body = await req.json().catch(() => ({}));
    const batchSize = body.batch_size || 500;

    // Fetch listings needing badge extraction
    const { data: listings, error: fetchErr } = await supabase
      .from("retail_listings")
      .select("id, make, model, variant_raw, title, description")
      .is("badge", null)
      .not("variant_raw", "is", null)
      .order("last_seen_at", { ascending: false })
      .limit(batchSize);

    if (fetchErr) throw new Error(fetchErr.message);
    if (!listings || listings.length === 0) {
      return new Response(JSON.stringify({ done: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let updated = 0;
    let noMatch = 0;

    for (const listing of listings) {
      const extracted = extractBadge(
        listing.make || '',
        listing.model || '',
        listing.variant_raw,
        listing.title || listing.description,
      );

      if (extracted.badge || extracted.fuel_type || extracted.drivetrain || extracted.body_type) {
        const fields: Record<string, unknown> = {};
        if (extracted.badge) fields.badge = extracted.badge;
        if (extracted.fuel_type) fields.fuel_type = extracted.fuel_type;
        if (extracted.drivetrain) fields.drivetrain = extracted.drivetrain;
        if (extracted.body_type) fields.body_type = extracted.body_type;
        fields.classified_at = new Date().toISOString();
        fields.variant_source = 'extractBadge_v1_backfill';

        const { error } = await supabase
          .from("retail_listings")
          .update(fields)
          .eq("id", listing.id);

        if (!error) updated++;
      } else {
        noMatch++;
      }
    }

    const remaining = await supabase
      .from("retail_listings")
      .select("id", { count: "exact", head: true })
      .is("badge", null)
      .not("variant_raw", "is", null);

    console.log(`Badge backfill: ${updated} updated, ${noMatch} no match, ~${remaining.count} remaining`);

    return new Response(JSON.stringify({
      done: (remaining.count || 0) === 0,
      processed: listings.length,
      updated,
      no_match: noMatch,
      remaining: remaining.count,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Badge backfill error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
