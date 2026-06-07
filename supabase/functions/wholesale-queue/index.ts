// supabase/functions/wholesale-queue/index.ts
// Serves the wholesale buy queue to dashboards / Telegram bots.
//
// GET /functions/v1/wholesale-queue
//   ?dealer_slug=patrick-auto   (required — matches wholesale_manager_queue.dealer_id)
//   &limit=20                   (optional, max 100, default 20)
//   &status=pending             (optional, default 'pending')
//   &tier=1                     (optional)
//
// Returns: { dealer_slug, status, count, limit, items: [...], fingerprint_context: [...] }
// Sorted by tier asc then confidence_score desc.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const dealerSlug = url.searchParams.get("dealer_slug");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 100);
    const status = url.searchParams.get("status") || "pending";
    const tierParam = url.searchParams.get("tier");

    if (!dealerSlug) {
      return new Response(
        JSON.stringify({ error: "dealer_slug required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    let query = supabase
      .from("wholesale_manager_queue")
      .select(
        "id, listing_id, dealer_id, account_id, tier, status, max_bid, est_gp, est_hold_days, confidence_score, historical_proof, pattern_flags, make, model, variant, year, km, asking_price, listing_url, source_searched, auction_close_at, created_at",
      )
      .eq("dealer_id", dealerSlug)
      .eq("status", status)
      .order("tier", { ascending: true })
      .order("confidence_score", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (tierParam) query = query.eq("tier", parseInt(tierParam, 10));

    const { data, error } = await query;
    if (error) {
      console.error("queue fetch error", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Enrich: pull a handful of this dealer's fingerprints for human context.
    // Queue stores account_id; fingerprints are keyed by dealer_profile_id.
    // Resolve via dealer_profiles.account_id -> dealer_profiles.id.
    let fingerprintContext: any[] = [];
    const accountId = data?.[0]?.account_id;
    if (accountId) {
      const { data: profiles } = await supabase
        .from("dealer_profiles")
        .select("id")
        .eq("account_id", accountId);
      const profileIds = (profiles ?? []).map((p: any) => p.id);
      if (profileIds.length > 0) {
        const { data: fpData } = await supabase
          .from("dealer_fingerprints")
          .select(
            "make, model, variant_family, year_min, year_max, min_km, max_km, sales_count, avg_profit, avg_days_to_sell, fingerprint_priority",
          )
          .in("dealer_profile_id", profileIds)
          .eq("is_active", true)
          .order("avg_profit", { ascending: false, nullsFirst: false })
          .limit(5);
        fingerprintContext = fpData ?? [];
      }
    }

    return new Response(
      JSON.stringify({
        dealer_slug: dealerSlug,
        status,
        count: data?.length ?? 0,
        limit,
        items: data ?? [],
        fingerprint_context: fingerprintContext,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("wholesale-queue error", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
