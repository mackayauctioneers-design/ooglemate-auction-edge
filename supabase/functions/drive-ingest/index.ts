import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// GraphQL endpoint for Drive.com.au
const DRIVE_GRAPHQL_ENDPOINT = "https://drive-carsforsale-prod.graphcdn.app/";

// Note: Drive.com.au uses a specific GraphQL schema
// The query below is a minimal working version - may need exact query from browser cURL
const DRIVE_QUERY = `query DEALER_LISTINGS {
  listings(
    where: { stockType: { in: ["used"] }, year: { gte: 2016 } }
    pageNo: 0
    sort: { order: [["createdAt", "DESC"]] }
    priceHistory: false
  ) {
    pageInfo {
      hasNextPage
      totalResults
    }
    results {
      id
      year
      makeName
      modelName
      description
      odometer
      priceDriveAway
      priceExcludingGovtCharges
      createdAt
      region {
        state
      }
      dealer {
        suburb
        postcode
      }
    }
  }
}`;

interface DriveListing {
  id: string;
  year: number;
  makeName: string;
  modelName: string;
  description?: string;
  odometer?: number;
  priceDriveAway?: number;
  priceExcludingGovtCharges?: number;
  createdAt?: string;
  stockType?: string;
  region?: { state?: string };
  dealer?: { suburb?: string; postcode?: string };
}

interface DriveResponse {
  data?: {
    listings?: {
      pageInfo?: {
        hasNextPage?: boolean;
        totalResults?: number;
      };
      results?: DriveListing[];
    };
  };
  errors?: Array<{ message: string }>;
}

function buildListingUrl(id: string): string {
  // Drive listing URLs follow pattern: /cars-for-sale/dealer-listing/{id}
  return `https://www.drive.com.au/cars-for-sale/dealer-listing/${id}`;
}

function parsePrice(listing: DriveListing): number | null {
  // Prefer drive-away price, fallback to ex-govt charges
  const price = listing.priceDriveAway ?? listing.priceExcludingGovtCharges;
  if (!price || price < 1000 || price > 500000) return null;
  return Math.round(price);
}

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

      const graphqlPayload = {
        operationName: "DEALER_LISTINGS",
        variables: {
          where: {
            stockType: { in: ["used"] },
            year: { gte: year_min },
            or: [],
          },
          pageNo,
          sort: { order: [["createdAt", "DESC"]] },
          priceHistory: false,
        },
        query: DRIVE_QUERY,
      };

      const response = await fetch(DRIVE_GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "User-Agent": "OogleMate/1.0",
        },
        body: JSON.stringify(graphqlPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Drive API error ${response.status}: ${errorText.slice(0, 200)}`);
      }

      const data: DriveResponse = await response.json();

      if (data.errors && data.errors.length > 0) {
        throw new Error(`GraphQL errors: ${data.errors.map(e => e.message).join(", ")}`);
      }

      const listings = data.data?.listings?.results || [];
      const pageInfo = data.data?.listings?.pageInfo;

      console.log(`Page ${pageNo}: ${listings.length} listings, hasNextPage: ${pageInfo?.hasNextPage}`);

      results.pages_fetched++;
      results.total_found += listings.length;

      // Process each listing
      for (const listing of listings) {
        try {
          const price = parsePrice(listing);
          if (!price) {
            results.errors++;
            continue;
          }

          const { data: upsertResult, error: upsertError } = await supabase.rpc("upsert_retail_listing", {
            p_source: "drive",
            p_source_listing_id: listing.id,
            p_listing_url: buildListingUrl(listing.id),
            p_year: listing.year,
            p_make: listing.makeName?.toUpperCase() || "UNKNOWN",
            p_model: listing.modelName?.toUpperCase() || "UNKNOWN",
            p_variant_raw: listing.description || null,
            p_variant_family: null,
            p_km: listing.odometer || null,
            p_asking_price: price,
            p_state: listing.region?.state?.toUpperCase() || null,
            p_suburb: listing.dealer?.suburb || null,
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
              results.sample_listings.push(
                `${listing.year} ${listing.makeName} ${listing.modelName} @ $${price}`
              );
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

      // Small delay between pages to be polite
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
