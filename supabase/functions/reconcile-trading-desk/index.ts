import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * RECONCILE TRADING DESK — v2
 * 
 * Sweeps 3 buckets:
 *   1. Auction expired (past auction + listing not ACTIVE)
 *   2. Dead/Sold cross-check (listing lifecycle DEAD/SOLD/STALE/INVALID)
 *   3. Aged out (>7d, status=new, not starred)
 * 
 * Rules:
 *   - NEVER touch terminal states (ignored, expired, lost, won, archived)
 *   - Only sweep status IN ('new', 'assigned', 'reviewed')
 *   - Starred items are always protected
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ACTIONABLE_STATES = ["new", "assigned", "reviewed"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = new Date();
  const results = {
    expired_auction: 0,
    expired_stale: 0,
    expired_lemon: 0,
    expired_aged: 0,
    total_swept: 0,
  };

  try {
    // ── 1. Expire auction opportunities whose auction has passed ──
    // 2h grace period. Only expire if listing is no longer ACTIVE.
    const pastAuction = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

    const { data: auctionCandidates } = await supabase
      .from("operator_opportunities")
      .select("id, listing_id")
      .in("status", ACTIONABLE_STATES)
      .eq("is_starred", false)
      .not("auction_datetime", "is", null)
      .lt("auction_datetime", pastAuction);

    const auctionExpireIds: string[] = [];
    if (auctionCandidates && auctionCandidates.length > 0) {
      // Cross-check: only expire if vehicle_listings is NOT still ACTIVE
      for (const c of auctionCandidates) {
        const { data: vl } = await supabase
          .from("vehicle_listings")
          .select("lifecycle_state")
          .eq("listing_id", c.listing_id)
          .maybeSingle();
        if (!vl || !["NEW", "ACTIVE", "WATCHING"].includes(vl.lifecycle_state)) {
          auctionExpireIds.push(c.id);
        }
      }
      if (auctionExpireIds.length > 0) {
        await supabase
          .from("operator_opportunities")
          .update({ status: "expired", updated_at: now.toISOString() })
          .in("id", auctionExpireIds);
      }
    }
    results.expired_auction = auctionExpireIds.length;

    // ── 2. Expire opportunities whose source listing is DEAD/SOLD/STALE ──
    const { data: deadListings, error: e2 } = await supabase.rpc(
      "reconcile_dead_opportunities",
    );
    if (e2) console.error("dead listing reconcile error:", e2.message);
    results.expired_stale = deadListings ?? 0;

    // ── 3. Expire opportunities whose underlying listing is lemon-flagged or has dead auction_status ──
    const { data: activeOpps } = await supabase
      .from("operator_opportunities")
      .select("id, listing_id")
      .in("status", ACTIONABLE_STATES)
      .eq("is_starred", false);

    const lemonExpireIds: string[] = [];
    if (activeOpps && activeOpps.length > 0) {
      // Batch check: find listing_ids that are lemon or dead auction_status
      const listingIds = [...new Set(activeOpps.map((o: any) => o.listing_id).filter(Boolean))];
      
      // Check in chunks of 200
      const badListingIds = new Set<string>();
      for (let i = 0; i < listingIds.length; i += 200) {
        const chunk = listingIds.slice(i, i + 200);
        
        // Lemon-flagged
        const { data: lemons } = await supabase
          .from("vehicle_listings")
          .select("listing_id")
          .in("listing_id", chunk)
          .eq("lemon_flag", true);
        for (const l of lemons || []) badListingIds.add(l.listing_id);

        // Dead auction_status
        const { data: deadAuction } = await supabase
          .from("vehicle_listings")
          .select("listing_id")
          .in("listing_id", chunk)
          .in("auction_status", ["sold", "withdrawn", "invalid"]);
        for (const d of deadAuction || []) badListingIds.add(d.listing_id);
      }

      for (const opp of activeOpps) {
        if (badListingIds.has(opp.listing_id)) {
          lemonExpireIds.push(opp.id);
        }
      }

      if (lemonExpireIds.length > 0) {
        for (let i = 0; i < lemonExpireIds.length; i += 50) {
          await supabase
            .from("operator_opportunities")
            .update({ status: "expired", updated_at: now.toISOString() })
            .in("id", lemonExpireIds.slice(i, i + 50));
        }
      }
    }
    results.expired_lemon = lemonExpireIds.length;

    // ── 4. Expire aged opportunities (>7d, still actionable, not starred) ──
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: agedOut, error: e3 } = await supabase
      .from("operator_opportunities")
      .update({ status: "expired", updated_at: now.toISOString() })
      .eq("status", "new")
      .eq("is_starred", false)
      .lt("created_at", sevenDaysAgo)
      .select("id");

    if (e3) console.error("aged expire error:", e3.message);
    results.expired_aged = agedOut?.length ?? 0;

    results.total_swept =
      results.expired_auction + results.expired_stale + results.expired_lemon + results.expired_aged;

    // ── 4. Log to cron_heartbeat ──
    await supabase
      .from("cron_heartbeat")
      .upsert(
        {
          cron_name: "reconcile-trading-desk",
          last_seen_at: now.toISOString(),
          last_ok: true,
          note: JSON.stringify(results),
        },
        { onConflict: "cron_name" },
      );

    console.log("Reconciliation complete:", results);

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Reconciliation failed:", err);

    await supabase
      .from("cron_heartbeat")
      .upsert(
        {
          cron_name: "reconcile-trading-desk",
          last_seen_at: now.toISOString(),
          last_ok: false,
          note: (err as Error).message,
        },
        { onConflict: "cron_name" },
      );

    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
