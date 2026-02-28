import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * AUCTION QUEUE CLEANUP - Resets items stuck in 'processing' status
 * 
 * Runs every 15 minutes. Resets items that have been stuck in processing
 * for longer than the threshold (default 30 minutes) back to pending.
 * 
 * Cron: every 15 minutes
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const stuckMinutes = body.stuck_minutes || 30;

  try {
    const { data, error } = await supabase.rpc("reset_stuck_auction_queue_items", {
      p_stuck_minutes: stuckMinutes,
    });

    if (error) {
      throw new Error(`RPC failed: ${error.message}`);
    }

    const resetCount = data ?? 0;
    if (resetCount > 0) {
      console.log(`[QUEUE-CLEANUP] Reset ${resetCount} stuck items (threshold: ${stuckMinutes}min)`);
    }

    return new Response(
      JSON.stringify({ success: true, reset_count: resetCount, stuck_minutes: stuckMinutes }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[QUEUE-CLEANUP] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
