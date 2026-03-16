import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const AUCTION_PREMIUM_FLAT = 500;
const FREIGHT_FLAT = 800;

// Urgency-based scan thresholds (ms since last_match_at)
const URGENCY_COOLDOWN: Record<string, number> = {
  urgent: 0,            // always scan
  high: 0,              // always scan
  normal: 2 * 60 * 60 * 1000, // skip if scanned < 2h ago
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
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
    let jobsScanned = 0;
    let jobsSkipped = 0;

    for (const job of jobs) {
      // Urgency-based skip logic
      const cooldown = URGENCY_COOLDOWN[job.urgency] ?? URGENCY_COOLDOWN.normal;
      if (cooldown > 0 && job.last_match_at) {
        const elapsed = Date.now() - new Date(job.last_match_at).getTime();
        if (elapsed < cooldown) {
          jobsSkipped++;
          continue;
        }
      }

      jobsScanned++;

      // Query unified market_listings view (per Unified Market Surface architecture)
      let query = sb
        .from("market_listings")
        .select(
          "id, source_listing_id, source, make, model, variant_raw, year, km, asking_price, price, location, listing_url, first_seen_at, source_class"
        )
        .ilike("make", job.make)
        .ilike("model", job.model)
        .gte("year", job.year_min)
        .lte("year", job.year_max)
        .lte("km", job.km_max);

      if (job.variant) {
        query = query.or(
          `variant_raw.ilike.%${job.variant}%,variant_resolved.ilike.%${job.variant}%`
        );
      }

      const { data: listings, error: listErr } = await query.limit(500);

      if (listErr) {
        console.error(`Query error for job ${job.id}:`, listErr);
        continue;
      }

      // Determine auction sources for buyer's premium calculation
      const auctionClasses = new Set(["auction", "wholesale"]);

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

      for (const l of listings || []) {
        const askPrice = Number(l.asking_price || l.price || 0);
        if (askPrice <= 0) continue;

        const isAuction = auctionClasses.has((l.source_class || "").toLowerCase());
        const premium = isAuction ? AUCTION_PREMIUM_FLAT : 0;
        const effectiveCost = askPrice + premium + FREIGHT_FLAT;

        if (effectiveCost <= Number(job.budget_ceiling)) {
          const daysListed = l.first_seen_at
            ? Math.floor(
                (Date.now() - new Date(l.first_seen_at).getTime()) /
                  (1000 * 60 * 60 * 24)
              )
            : null;
          candidates.push({
            listing_id: l.source_listing_id || l.id || "",
            source: l.source || "unknown",
            effective_cost: effectiveCost,
            ask_price: askPrice,
            make: l.make || job.make,
            model: l.model || job.model,
            variant: l.variant_raw || null,
            year: l.year || job.year_min,
            km: l.km || 0,
            location: l.location || null,
            listing_url: l.listing_url || null,
            days_listed: daysListed,
          });
        }
      }

      // Sort ascending by effective cost, keep top 3
      candidates.sort((a, b) => a.effective_cost - b.effective_cost);
      const top3 = candidates.slice(0, 3);

      if (top3.length === 0) continue;

      // Delete old matches and insert new top 3
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

      // Update last_match_at
      await sb
        .from("ooglebot_jobs")
        .update({ last_match_at: new Date().toISOString() })
        .eq("id", job.id);

      totalMatched += top3.length;
    }

    const durationMs = Date.now() - startTime;

    // Log telemetry
    console.log(
      JSON.stringify({
        event: "ooglebot_scan_complete",
        jobs_total: jobs.length,
        jobs_scanned: jobsScanned,
        jobs_skipped: jobsSkipped,
        matches_stored: totalMatched,
        duration_ms: durationMs,
      })
    );

    return new Response(
      JSON.stringify({
        ok: true,
        jobs_scanned: jobsScanned,
        jobs_skipped: jobsSkipped,
        matches_stored: totalMatched,
        duration_ms: durationMs,
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
