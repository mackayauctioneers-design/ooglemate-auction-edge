import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const secret = Deno.env.get("MANUS_WEBHOOK_SECRET") || Deno.env.get("LINDY_WEBHOOK_SECRET");
    if (!secret || token !== secret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const unreconciledOnly = url.searchParams.get("unreconciled") !== "false";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);
    const source = url.searchParams.get("source"); // e.g. 'easycars'

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let query = supabase
      .from("trades")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (unreconciledOnly) {
      query = query.or("reconciled.is.null,reconciled.eq.false");
    }

    if (source) {
      query = query.eq("source_system", source);
    }

    const { data, error } = await query;
    if (error) throw error;

    return new Response(
      JSON.stringify({
        status: "ok",
        count: data?.length || 0,
        trades: data || [],
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("manus-trades-feed error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
