import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const runDate = new Date().toISOString().split("T")[0];
  const cronName = "refresh-watch-statuses";

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("Starting watch status refresh...");

    // Call the refresh function
    const { data, error } = await supabase.rpc("refresh_watch_statuses");

    if (error) {
      throw new Error(`RPC error: ${error.message}`);
    }

    const result = data?.[0] || {
      total_evaluated: 0,
      watching_count: 0,
      buy_window_count: 0,
      avoid_count: 0,
    };

    console.log("Watch status refresh complete:", result);

    // Also run auction attempt counter update
    const { data: attemptData, error: attemptError } = await supabase.rpc("update_auction_attempts");

    if (attemptError) {
      console.warn("Auction attempt update warning:", attemptError.message);
    } else {
      console.log("Auction attempts updated:", attemptData?.[0]);
    }

    // Also detect sold-returned suspects
    const { data: suspectData, error: suspectError } = await supabase.rpc("detect_sold_returned_suspects");

    if (suspectError) {
      console.warn("Sold-returned detection warning:", suspectError.message);
    } else if (suspectData && suspectData.length > 0) {
      // Flag the suspects
      const suspectIds = suspectData.map((s: any) => s.listing_uuid);
      const { error: flagError } = await supabase
        .from("vehicle_listings")
        .update({
          sold_returned_suspected: true,
          sold_returned_reason: "Cleared then reappeared within 21 days",
          watch_status: "avoid",
          avoid_reason: "SOLD_RETURNED_MECHANICAL",
        })
        .in("id", suspectIds);

      if (flagError) {
        console.warn("Flag suspects error:", flagError.message);
      } else {
        console.log(`Flagged ${suspectIds.length} sold-returned suspects`);
      }
    }

    // Log to cron_audit_log
    await supabase.from("cron_audit_log").insert({
      cron_name: cronName,
      run_date: runDate,
      success: true,
      result: {
        ...result,
        auction_attempts: attemptData?.[0] || null,
        suspects_flagged: suspectData?.length || 0,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        ...result,
        auction_attempts: attemptData?.[0] || null,
        suspects_flagged: suspectData?.length || 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error refreshing watch statuses:", error);

    // Log failure
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    await supabase.from("cron_audit_log").insert({
      cron_name: cronName,
      run_date: runDate,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });

    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
