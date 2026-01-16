import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Retail Ingest Cron - Gumtree (Dealer + Private lanes)
 * 
 * Runs both seller types with weighted coverage:
 * - gumtree_dealer (forsaleby=delr) - 70% of batches
 * - gumtree_private (forsaleby=ownr) - 30% of batches
 */

// Top makes to crawl systematically
const MAKES_TO_CRAWL = [
  "Toyota",
  "Mazda",
  "Hyundai",
  "Kia",
  "Ford",
  "Holden",
  "Mitsubishi",
  "Nissan",
  "Honda",
  "Subaru",
  "Volkswagen",
  "Mercedes-Benz",
  "BMW",
  "Audi",
];

const STATES = ["NSW", "VIC", "QLD", "SA", "WA"];

type SellerType = 'dealer' | 'private';

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const results = {
      batches_run: 0,
      dealer_batches: 0,
      private_batches: 0,
      total_new: 0,
      total_updated: 0,
      total_evaluations: 0,
      errors: [] as string[],
    };

    // Pick random make/state/page combinations per run
    const shuffledMakes = [...MAKES_TO_CRAWL].sort(() => Math.random() - 0.5);
    const shuffledStates = [...STATES].sort(() => Math.random() - 0.5);
    const pages = [1, 1, 1, 2, 2]; // Weight page 1 more heavily
    
    // 7 batches total: 5 dealer, 2 private (70/30 split)
    const batchesToRun: Array<{ make: string; state: string; page: number; seller_type: SellerType }> = [
      // Dealer batches (primary)
      { make: shuffledMakes[0], state: shuffledStates[0], page: pages[0], seller_type: 'dealer' },
      { make: shuffledMakes[1], state: shuffledStates[1], page: pages[1], seller_type: 'dealer' },
      { make: shuffledMakes[2], state: shuffledStates[2], page: pages[2], seller_type: 'dealer' },
      { make: shuffledMakes[3], state: shuffledStates[3 % STATES.length], page: pages[3], seller_type: 'dealer' },
      { make: shuffledMakes[4], state: shuffledStates[4 % STATES.length], page: pages[4], seller_type: 'dealer' },
      // Private batches (secondary)
      { make: shuffledMakes[5], state: shuffledStates[0], page: 1, seller_type: 'private' },
      { make: shuffledMakes[6], state: shuffledStates[1], page: 1, seller_type: 'private' },
    ];

    for (const batch of batchesToRun) {
      try {
        console.log(`Running ingest for ${batch.make} in ${batch.state} [${batch.seller_type}]`);
        
        const response = await fetch(`${supabaseUrl}/functions/v1/gumtree-ingest`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            seller_type: batch.seller_type,
            make: batch.make,
            state: batch.state,
            page: batch.page || 1,
            year_min: 2016,
            limit: 40,
            prefer_firecrawl: true, // Firecrawl primary
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          results.errors.push(`${batch.seller_type}/${batch.make}/${batch.state}: ${errorText}`);
          continue;
        }

        const data = await response.json();
        results.batches_run++;
        if (batch.seller_type === 'dealer') results.dealer_batches++;
        if (batch.seller_type === 'private') results.private_batches++;
        results.total_new += data.new_listings || 0;
        results.total_updated += data.updated_listings || 0;
        results.total_evaluations += data.evaluations_triggered || 0;

        // Rate limit: wait 2 seconds between batches
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.errors.push(`${batch.seller_type}/${batch.make}/${batch.state}: ${msg}`);
      }
    }

    // Mark stale listings as delisted for both sources (3 days)
    const { data: delistedDealerCount } = await supabase.rpc("mark_stale_listings_delisted", {
      p_source: "gumtree_dealer",
      p_stale_days: 3,
    });
    
    const { data: delistedPrivateCount } = await supabase.rpc("mark_stale_listings_delisted", {
      p_source: "gumtree_private", 
      p_stale_days: 3,
    });

    // Log results
    await supabase.from("cron_audit_log").insert({
      cron_name: "retail-ingest-cron",
      success: results.errors.length === 0,
      result: { 
        ...results, 
        delisted_dealer: delistedDealerCount || 0,
        delisted_private: delistedPrivateCount || 0,
      },
      run_date: new Date().toISOString().split("T")[0],
    });

    // Update heartbeat
    await supabase.from("cron_heartbeat").upsert({
      cron_name: "retail-ingest-cron",
      last_seen_at: new Date().toISOString(),
      last_ok: results.errors.length === 0,
      note: `dealer=${results.dealer_batches} private=${results.private_batches} new=${results.total_new}`,
    }, { onConflict: "cron_name" });

    console.log("Retail ingest cron complete:", results);

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Retail ingest cron error:", errorMsg);

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
