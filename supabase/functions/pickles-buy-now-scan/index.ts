// Pickles Buy Now Scanner v2.3
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const { data, error } = await supabase
    .from("pickles_buy_now_listings")
    .select("id")
    .limit(1);

  return new Response(
    JSON.stringify({ ok: true, count: data?.length ?? 0, error: error?.message ?? null }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
