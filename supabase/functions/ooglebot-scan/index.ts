import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const AUCTION_PREMIUM_FLAT = 500; // placeholder buyer's premium
const FREIGHT_FLAT = 800; // placeholder national freight estimate

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // 1. Get all ACTIVE jobs (also auto-expire overdue ones)
    await sb.rpc("query", undefined); // noop – we'll handle expiry inline
    const now = new Date().toISOString();

    // Auto-expire overdue jobs
    await sb
      .from("ooglebot_jobs")
      .update({ status: "expired" })
      .eq("status", "active")
      .lt("expiry_date", now);

    // Fetch active jobs
    const { data: jobs, error: jobsErr } = await sb
      .from("ooglebot_jobs")
      .select("*")
      .eq("status", "active");

    if (jobsErr) throw jobsErr;
    if (!jobs || jobs.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, message: "No active jobs", matched: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let totalMatched = 0;

    for (const job of jobs) {
      // 2. Query vehicle_listings for spec match
      let query = sb
        .from("vehicle_listings")
        .select(
          "id, listing_id, source, make, model, variant, year, km, asking_price, location, listing_url, first_seen"
        )
        .ilike("make", job.make)
        .ilike("model", job.model)
        .gte("year", job.year_min)
        .lte("year", job.year_max)
        .lte("km", job.km_max)
        .not("asking_price", "is", null)
        .gt("asking_price", 0)
        .eq("status", "active");

      if (job.variant) {
        query = query.ilike("variant", `%${job.variant}%`);
      }

      const { data: vlListings } = await query.limit(500);

      // 3. Query retail_listings for spec match
      let rlQuery = sb
        .from("retail_listings")
        .select(
          "id, listing_id, source, make, model, variant, year, km, price, location, listing_url, first_seen_at"
        )
        .ilike("make", job.make)
        .ilike("model", job.model)
        .gte("year", job.year_min)
        .lte("year", job.year_max)
        .lte("km", job.km_max)
        .not("price", "is", null)
        .gt("price", 0);

      if (job.variant) {
        rlQuery = rlQuery.ilike("variant", `%${job.variant}%`);
      }

      const { data: rlListings } = await rlQuery.limit(500);

      // 4. Combine and calculate effective cost
      const auctionSources = new Set([
        "pickles",
        "grays",
        "manheim",
        "slattery",
        "f3",
        "auto_auctions",
        "vma",
        "bidsonline",
      ]);

      interface Candidate {
        listing_id: string;
        source: string;
        effective_cost: number;
        ask_price: number;
        make: string;
        model: string;
        variant: string | null;
        year: number;
        km: number;
        location: string | null;
        listing_url: string | null;
        days_listed: number | null;
      }

      const candidates: Candidate[] = [];

      // Process vehicle_listings
      for (const l of vlListings || []) {
        const askPrice = Number(l.asking_price);
        const isAuction = auctionSources.has((l.source || "").toLowerCase());
        const premium = isAuction ? AUCTION_PREMIUM_FLAT : 0;
        const effectiveCost = askPrice + premium + FREIGHT_FLAT;

        if (effectiveCost <= Number(job.budget_ceiling)) {
          const daysListed = l.first_seen
            ? Math.floor(
                (Date.now() - new Date(l.first_seen).getTime()) /
                  (1000 * 60 * 60 * 24)
              )
            : null;
          candidates.push({
            listing_id: l.listing_id,
            source: l.source || "auction",
            effective_cost: effectiveCost,
            ask_price: askPrice,
            make: l.make,
            model: l.model,
            variant: l.variant,
            year: l.year,
            km: l.km,
            location: l.location,
            listing_url: l.listing_url,
            days_listed: daysListed,
          });
        }
      }

      // Process retail_listings
      for (const l of rlListings || []) {
        const askPrice = Number(l.price);
        const effectiveCost = askPrice + FREIGHT_FLAT;

        if (effectiveCost <= Number(job.budget_ceiling)) {
          const daysListed = l.first_seen_at
            ? Math.floor(
                (Date.now() - new Date(l.first_seen_at).getTime()) /
                  (1000 * 60 * 60 * 24)
              )
            : null;
          candidates.push({
            listing_id: l.listing_id,
            source: l.source || "retail",
            effective_cost: effectiveCost,
            ask_price: askPrice,
            make: l.make,
            model: l.model,
            variant: l.variant,
            year: l.year,
            km: l.km,
            location: l.location,
            listing_url: l.listing_url,
            days_listed: daysListed,
          });
        }
      }

      // 5. Sort ascending by effective cost, keep top 3
      candidates.sort((a, b) => a.effective_cost - b.effective_cost);
      const top3 = candidates.slice(0, 3);

      if (top3.length === 0) continue;

      // 6. Delete old matches and insert new top 3
      await sb
        .from("ooglebot_matches")
        .delete()
        .eq("ooglebot_job_id", job.id);

      const matchRows = top3.map((c, i) => ({
        ooglebot_job_id: job.id,
        listing_id: c.listing_id,
        source: c.source,
        effective_cost: c.effective_cost,
        ask_price: c.ask_price,
        make: c.make,
        model: c.model,
        variant: c.variant,
        year: c.year,
        km: c.km,
        location: c.location,
        listing_url: c.listing_url,
        days_listed: c.days_listed,
        rank_position: i + 1,
      }));

      const { error: insertErr } = await sb
        .from("ooglebot_matches")
        .insert(matchRows);

      if (insertErr) {
        console.error(`Insert error for job ${job.id}:`, insertErr);
        continue;
      }

      // 7. Update last_match_at
      await sb
        .from("ooglebot_jobs")
        .update({ last_match_at: new Date().toISOString() })
        .eq("id", job.id);

      totalMatched += top3.length;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        jobs_scanned: jobs.length,
        matches_stored: totalMatched,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("OogleBot scan error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
