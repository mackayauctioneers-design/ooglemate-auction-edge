import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── Thresholds ─────────────────────────────────────────────────────────────
const STALE_HOURS = 72;        // 3 days unseen → STALE
const DELISTED_DAYS = 7;       // 7 days unseen → DELISTED
const HISTORICAL_AUCTION_H = 24; // auction_datetime > 24h ago → historical
const BATCH_SIZE = 500;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = new Date();
  const staleCutoff = new Date(now.getTime() - STALE_HOURS * 60 * 60 * 1000).toISOString();
  const delistCutoff = new Date(now.getTime() - DELISTED_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const histCutoff = new Date(now.getTime() - HISTORICAL_AUCTION_H * 60 * 60 * 1000).toISOString();

  const stats = {
    vl_stale: 0,
    vl_dead: 0,
    vl_sold_by_price: 0,
    vl_revived: 0,
    vl_historical: 0,
    rl_stale: 0,
    rl_delisted: 0,
    rl_sold_badge: 0,
    rl_revived: 0,
  };

  try {
    // ════════════════════════════════════════════════════════════════════════
    // 1. VEHICLE_LISTINGS (auctions / wholesale)
    // ════════════════════════════════════════════════════════════════════════

    // 1a. ACTIVE/NEW → STALE (not seen in 3 days)
    const { data: vlStale } = await sb
      .from("vehicle_listings")
      .update({ lifecycle_state: "STALE", updated_at: now.toISOString() })
      .in("lifecycle_state", ["NEW"])
      .lt("last_seen_at", staleCutoff)
      .select("id");
    stats.vl_stale = vlStale?.length ?? 0;

    // 1b. STALE → DEAD (not seen in 7 days)
    const { data: vlDead } = await sb
      .from("vehicle_listings")
      .update({ lifecycle_state: "DEAD", status: "inactive", updated_at: now.toISOString() })
      .in("lifecycle_state", ["NEW", "STALE"])
      .lt("last_seen_at", delistCutoff)
      .select("id");
    stats.vl_dead = vlDead?.length ?? 0;

    // 1c. Mark SOLD if sold_price present and still active
    const { data: vlSold } = await sb
      .from("vehicle_listings")
      .update({ lifecycle_state: "DEAD", status: "sold", updated_at: now.toISOString() })
      .in("lifecycle_state", ["NEW", "STALE", "WATCH"])
      .not("sold_price", "is", null)
      .select("id");
    stats.vl_sold_by_price = vlSold?.length ?? 0;

    // 1d. Revive: STALE/DEAD → NEW if freshly seen again
    const { data: vlRevived } = await sb
      .from("vehicle_listings")
      .update({ lifecycle_state: "NEW", updated_at: now.toISOString() })
      .in("lifecycle_state", ["STALE", "DEAD"])
      .gte("last_seen_at", staleCutoff)
      .select("id");
    stats.vl_revived = vlRevived?.length ?? 0;

    // 1e. Mark historical auction results (auction_datetime in the past)
    const { data: vlHist } = await sb
      .from("vehicle_listings")
      .update({ is_historical_result: true })
      .in("lifecycle_state", ["NEW", "STALE"])
      .not("auction_datetime", "is", null)
      .lt("auction_datetime", histCutoff)
      .eq("is_historical_result", false)
      .select("id");
    stats.vl_historical = vlHist?.length ?? 0;

    // ════════════════════════════════════════════════════════════════════════
    // 2. RETAIL_LISTINGS
    // ════════════════════════════════════════════════════════════════════════

    // 2a. ACTIVE → STALE (not seen in 3 days)
    const { data: rlStale } = await sb
      .from("retail_listings")
      .update({ lifecycle_status: "STALE", updated_at: now.toISOString() })
      .eq("lifecycle_status", "ACTIVE")
      .lt("last_seen_at", staleCutoff)
      .select("id");
    stats.rl_stale = rlStale?.length ?? 0;

    // 2b. ACTIVE/STALE → DELISTED (not seen in 7 days)
    const { data: rlDelisted } = await sb
      .from("retail_listings")
      .update({ lifecycle_status: "DELISTED", updated_at: now.toISOString() })
      .in("lifecycle_status", ["ACTIVE", "STALE"])
      .lt("last_seen_at", delistCutoff)
      .select("id");
    stats.rl_delisted = rlDelisted?.length ?? 0;

    // 2c. Mark SOLD if price_badge contains 'sold'
    const { data: rlSold } = await sb
      .from("retail_listings")
      .update({ lifecycle_status: "SOLD", updated_at: now.toISOString() })
      .in("lifecycle_status", ["ACTIVE", "STALE", "RELISTED"])
      .ilike("price_badge", "%sold%")
      .select("id");
    stats.rl_sold_badge = rlSold?.length ?? 0;

    // 2d. Revive: STALE/DELISTED → ACTIVE if freshly seen again
    const { data: rlRevived } = await sb
      .from("retail_listings")
      .update({ lifecycle_status: "ACTIVE", updated_at: now.toISOString() })
      .in("lifecycle_status", ["STALE", "DELISTED"])
      .gte("last_seen_at", staleCutoff)
      .select("id");
    stats.rl_revived = rlRevived?.length ?? 0;

    // ════════════════════════════════════════════════════════════════════════
    // 3. Audit log
    // ════════════════════════════════════════════════════════════════════════
    await sb.from("cron_audit_log").insert({
      cron_name: "lifecycle-sweep",
      run_date: now.toISOString().slice(0, 10),
      success: true,
      result: stats,
    });

    console.log("[lifecycle-sweep] Done:", JSON.stringify(stats));
    return new Response(JSON.stringify({ status: "ok", ...stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[lifecycle-sweep] Error:", err);
    await sb.from("cron_audit_log").insert({
      cron_name: "lifecycle-sweep",
      run_date: now.toISOString().slice(0, 10),
      success: false,
      error: String(err),
    });
    return new Response(JSON.stringify({ status: "error", error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
