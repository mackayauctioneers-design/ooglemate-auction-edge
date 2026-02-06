import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify user is admin
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (!roleData || !["admin", "internal"].includes(roleData.role)) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { account_id, batch_size = 50, dry_run = false } = await req.json();

    if (!account_id) {
      return new Response(JSON.stringify({ error: "Missing account_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Count hold items available
    const { count: holdCount, error: countErr } = await supabase
      .from("dealer_url_queue")
      .select("id", { count: "exact", head: true })
      .eq("account_id", account_id)
      .eq("status", "hold")
      .eq("domain", "pickles.com.au");

    if (countErr) {
      console.error("[release-pickles-batch] Count error:", countErr);
      throw countErr;
    }

    // Count currently pending (so Josh isn't overwhelmed)
    const { count: pendingCount, error: pendingErr } = await supabase
      .from("dealer_url_queue")
      .select("id", { count: "exact", head: true })
      .eq("account_id", account_id)
      .eq("status", "pending")
      .eq("domain", "pickles.com.au");

    if (pendingErr) {
      console.error("[release-pickles-batch] Pending count error:", pendingErr);
      throw pendingErr;
    }

    const toRelease = Math.min(batch_size, holdCount ?? 0);

    console.log(`[release-pickles-batch] Hold: ${holdCount}, Pending: ${pendingCount}, Will release: ${toRelease}`);

    if (dry_run) {
      return new Response(JSON.stringify({
        success: true,
        dry_run: true,
        hold_remaining: holdCount ?? 0,
        currently_pending: pendingCount ?? 0,
        would_release: toRelease,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (toRelease === 0) {
      return new Response(JSON.stringify({
        success: true,
        released: 0,
        hold_remaining: 0,
        currently_pending: pendingCount ?? 0,
        message: "No hold items to release",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get the IDs to release (oldest first)
    const { data: holdItems, error: fetchErr } = await supabase
      .from("dealer_url_queue")
      .select("id")
      .eq("account_id", account_id)
      .eq("status", "hold")
      .eq("domain", "pickles.com.au")
      .order("created_at", { ascending: true })
      .limit(toRelease);

    if (fetchErr || !holdItems) {
      console.error("[release-pickles-batch] Fetch error:", fetchErr);
      throw fetchErr || new Error("No items returned");
    }

    const ids = holdItems.map((item) => item.id);

    // Promote hold → pending
    const { error: updateErr } = await supabase
      .from("dealer_url_queue")
      .update({ status: "pending" })
      .in("id", ids);

    if (updateErr) {
      console.error("[release-pickles-batch] Update error:", updateErr);
      throw updateErr;
    }

    const newPending = (pendingCount ?? 0) + ids.length;
    const newHold = (holdCount ?? 0) - ids.length;

    console.log(`[release-pickles-batch] Released ${ids.length} items. Pending: ${newPending}, Hold: ${newHold}`);

    return new Response(JSON.stringify({
      success: true,
      released: ids.length,
      currently_pending: newPending,
      hold_remaining: newHold,
      message: `Released ${ids.length} Pickles items to Josh Inbox`,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[release-pickles-batch] Error:", msg);
    return new Response(JSON.stringify({ error: "Internal server error", details: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
