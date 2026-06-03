// Read-only mandates endpoint for OpenClaw.
// Auth: Bearer OPENCLAW_MANDATES_TOKEN (NOT service role).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const expected = Deno.env.get("OPENCLAW_MANDATES_TOKEN");
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!expected || token !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const dealerId = url.searchParams.get("dealer_id") || url.searchParams.get("account_id");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "500", 10), 2000);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let q = supabase
    .from("active_mandates")
    .select("*")
    .eq("is_active", true)
    .order("priority", { ascending: false })
    .limit(limit);

  if (dealerId) q = q.eq("account_id", dealerId);

  const { data, error } = await q;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ count: data?.length ?? 0, mandates: data ?? [] }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
