import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isBusinessHours(force: boolean): boolean {
  if (force) return true;
  const now = new Date();
  const aestHour = (now.getUTCHours() + 10) % 24;
  return aestHour >= 8 && aestHour < 18;
}

function fmtMoney(n: any): string {
  if (!n) return "--";
  return "$" + Math.round(n).toLocaleString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const force = new URL(req.url).searchParams.get("force") === "true";
  if (!isBusinessHours(force)) {
    return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { ...cors, "Content-Type": "application/json" } });
  }
  const h = await sha256("test");
  const { data: profiles } = await sb.from("dealer_liquidity_profiles").select("id").limit(3);
  return new Response(JSON.stringify({ ok: true, step: "no-regex", hash: h.substring(0, 16), profiles: (profiles || []).length, money: fmtMoney(12345) }), { headers: { ...cors, "Content-Type": "application/json" } });
});
