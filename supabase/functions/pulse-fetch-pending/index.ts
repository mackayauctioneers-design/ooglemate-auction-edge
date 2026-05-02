// Pulse Agent — fetch undelivered alerts. Auth: Bearer PULSE_BEARER_TOKEN.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PULSE_TOKEN = Deno.env.get("PULSE_BEARER_TOKEN")!;

function jres(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return jres(405, { error: "method_not_allowed" });

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== PULSE_TOKEN) return jres(401, { error: "unauthorized" });

  const url = new URL(req.url);
  const band = url.searchParams.get("band");

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let q = sb.from("pulse_alerts").select("*").is("delivered_at", null);
  if (band === "HOT" || band === "WARM") q = q.eq("alert_band", band);
  const { data, error } = await q
    .order("composite_score", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return jres(500, { error: error.message });
  return jres(200, data ?? []);
});
