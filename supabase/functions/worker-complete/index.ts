// Worker: mark a queue row completed with EasyCars stock id + ppsr flag.
// Auth: Authorization: Bearer <WORKER_TOKEN>
// Body: { id: string, easycars_stock_id: string, ppsr_purchased: boolean }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expected = Deno.env.get("WORKER_TOKEN");
  if (!expected) return json({ error: "Server misconfigured" }, 500);
  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${expected}`) return json({ error: "Unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const id = String(body?.id ?? "").trim();
  const easycars_stock_id = body?.easycars_stock_id == null ? null : String(body.easycars_stock_id);
  const ppsr_purchased = body?.ppsr_purchased == null ? null : Boolean(body.ppsr_purchased);

  if (!id) return json({ error: "id is required" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await supabase
    .from("pending_stock_entry")
    .update({
      status: "completed",
      easycars_stock_id,
      ppsr_purchased,
      locked_at: null,
      error_message: null,
      last_error: null,
    })
    .eq("id", id)
    .select("id, status, easycars_stock_id, ppsr_purchased, attempts")
    .single();

  if (error) {
    console.error("[worker-complete] update error", error);
    return json({ error: error.message }, 500);
  }

  return json({ ok: true, row: data });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
