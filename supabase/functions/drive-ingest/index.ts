import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DRIVE_GRAPHQL_ENDPOINT = "https://drive-carsforsale-prod.graphcdn.app/";

// Exact working query - removed unused priceHistory variable
const DRIVE_QUERY = `query DEALER_LISTINGS($where: WhereOptionsDealerListing = {}, $pageNo: Int! = 0, $sort: SortInput = {order: [["recommended","DESC"]]}) {
  listings: DealerListings(where: $where, paginate: {page: $pageNo, pageSize: 30}, sort: $sort) {
    pageInfo { hasNextPage pageCount currentPage pageItemCount itemCount }
    results {
      id
      stockType
      year
      makeDescription
      familyDescription
      description
      odometer
      priceIgc
      priceEgc
      createdAt
      Region { state name }
      Dealer { suburb state postcode }
    }
  }
}`;

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
    const {
      year_min = 2016,
      max_pages = 10,
      page_start = 0,
    } = body;

    console.log(`Starting Drive ingest: year >= ${year_min}, pages ${page_start} to ${page_start + max_pages - 1}`);

    // Create ingestion run for lifecycle tracking
    const { data: runData, error: runError } = await supabase
      .from("ingestion_runs")
      .insert({
        source: "drive",
        status: "running",
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (runError) {
      console.error("Failed to create ingestion run:", runError.message);
    }
    const run_id = runData?.id || null;

    const results = {
      run_id,
      total_found: 0,
      new_listings: 0,
      updated_listings: 0,
      price_changes: 0,
      errors: 0,
      pages_fetched: 0,
      sample_listings: [] as string[],
    };

    let hasNextPage = true;
    let pageNo = page_start;

    while (hasNextPage && pageNo < page_start + max_pages) {
      console.log(`Fetching page ${pageNo}...`);

      const payload = {
        operationName: "DEALER_LISTINGS",
        variables: {
          where: {
            stockType: { in: ["used"] },
            year: { gte: year_min },
            or: [],
          },
          pageNo,
          sort: { order: [["createdAt", "DESC"]] },
        },
        query: DRIVE_QUERY,
      };

      const response = await fetch(DRIVE_GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "*/*",
          "origin": "https://www.drive.com.au",
          "referer": "https://www.drive.com.au/cars-for-sale/search/used/",
          "user-agent": "Mozilla/5.0",
        },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      
      if (!response.ok) {
        console.error(`Drive API error ${response.status}: ${responseText.slice(0, 300)}`);
        throw new Error(`Drive API error ${response.status}: ${responseText.slice(0, 200)}`);
      }

      let data: any;
      try {
        data = JSON.parse(responseText);
      } catch {
        console.error(`Failed to parse response: ${responseText.slice(0, 300)}`);
        throw new Error("Invalid JSON response from Drive API");
      }

      if (data.errors && data.errors.length > 0) {
        console.error(`GraphQL errors: ${JSON.stringify(data.errors).slice(0, 300)}`);
        throw new Error(`GraphQL errors: ${data.errors.map((e: any) => e.message).join(", ")}`);
      }

      // Response uses aliased field "listings" from "DealerListings"
      const listings = data.data?.listings?.results || [];
      const pageInfo = data.data?.listings?.pageInfo;

      console.log(`Page ${pageNo}: ${listings.length} listings, hasNextPage: ${pageInfo?.hasNextPage}, total: ${pageInfo?.itemCount}`);

      results.pages_fetched++;
      results.total_found += listings.length;

      // Process each listing
      for (const listing of listings) {
        try {
          // Prefer priceIgc (inc govt charges), fallback to priceEgc
          const price = listing.priceIgc ?? listing.priceEgc;
          if (!price || price < 1000 || price > 500000) {
            results.errors++;
            continue;
          }

          const make = (listing.makeDescription || "UNKNOWN").toUpperCase();
          const model = (listing.familyDescription || "UNKNOWN").toUpperCase();
          const state = listing.Region?.state?.toUpperCase() || listing.Dealer?.state?.toUpperCase() || null;
          const suburb = listing.Dealer?.suburb || null;

          const { data: upsertResult, error: upsertError } = await supabase.rpc("upsert_retail_listing", {
            p_source: "drive",
            p_source_listing_id: String(listing.id),
            p_listing_url: listing.id ? `https://www.drive.com.au/cars-for-sale/dealer-listing/${listing.id}` : null,
            p_year: listing.year,
            p_make: make,
            p_model: model,
            p_variant_raw: listing.description || null,
            p_variant_family: null,
            p_km: listing.odometer || null,
            p_asking_price: Math.round(price),
            p_state: state,
            p_suburb: suburb,
            p_run_id: run_id,
          });

          if (upsertError) {
            console.error(`Upsert error for ${listing.id}:`, upsertError.message);
            results.errors++;
            continue;
          }

          const result = upsertResult?.[0] || upsertResult;
          if (result?.is_new) {
            results.new_listings++;
            if (results.sample_listings.length < 5) {
              results.sample_listings.push(`${listing.year} ${make} ${model} @ $${Math.round(price)}`);
            }
          } else {
            results.updated_listings++;
          }
          if (result?.price_changed) results.price_changes++;
        } catch (err) {
          console.error(`Error processing listing ${listing.id}:`, err);
          results.errors++;
        }
      }

      hasNextPage = pageInfo?.hasNextPage ?? false;
      pageNo++;

      // Small delay between pages
      if (hasNextPage && pageNo < page_start + max_pages) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Update ingestion run status
    if (run_id) {
      await supabase
        .from("ingestion_runs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          lots_found: results.total_found,
          lots_created: results.new_listings,
          lots_updated: results.updated_listings,
          metadata: { pages_fetched: results.pages_fetched, price_changes: results.price_changes },
        })
        .eq("id", run_id);
    }

    // Log to cron_audit_log
    await supabase.from("cron_audit_log").insert({
      cron_name: "drive-ingest",
      success: true,
      result: results,
      run_date: new Date().toISOString().split("T")[0],
    });

    console.log("Drive ingest complete:", results);

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Drive ingest error:", errorMsg);

    await supabase.from("cron_audit_log").insert({
      cron_name: "drive-ingest",
      success: false,
      error: errorMsg,
      run_date: new Date().toISOString().split("T")[0],
    });

    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
