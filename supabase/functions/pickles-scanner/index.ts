import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

Deno.serve(async function(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  var sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    var profilesResult = await sb.from("dealer_liquidity_profiles").select("*");
    var count = (profilesResult.data || []).length;
    return new Response(JSON.stringify({ ok: true, profiles: count }), {
      headers: { ...cors, "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" }
    });
  }
});
