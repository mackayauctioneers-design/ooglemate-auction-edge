// Pulse Agent — mark alerts delivered. Auth: Bearer PULSE_BEARER_TOKEN.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
  if (req.method !== "POST") return jres(405, { error: "method_not_allowed" });

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== PULSE_TOKEN) return jres(401, { error: "unauthorized" });

  let body: any;
  try { body = await req.json(); } catch { return jres(400, { error: "invalid_json" }); }

  const ids: string[] = Array.isArray(body?.alert_ids) ? body.alert_ids.map(String) : [];
  const via: string = body?.delivered_via === "telegram" || body?.delivered_via === "digest" ? body.delivered_via : "telegram";
  if (ids.length === 0) return jres(400, { error: "alert_ids_required" });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.from("pulse_alerts")
    .update({ delivered_at: new Date().toISOString(), delivered_via: via })
    .in("id", ids)
    .is("delivered_at", null)
    .select("id");
  if (error) return jres(500, { error: error.message });
  return jres(200, { updated: data?.length ?? 0 });
});
