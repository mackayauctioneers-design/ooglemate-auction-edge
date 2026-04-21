// Lindy → durable EasyCars queue intake
// Auth: Authorization: Bearer <LINDY_WEBHOOK_TOKEN>
// Inserts payload into public.pending_stock_entry with status='approved'.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Bearer auth
  const expected = Deno.env.get("LINDY_WEBHOOK_TOKEN");
  if (!expected) return json({ error: "Server misconfigured" }, 500);
  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // Heartbeat short-circuit
  if (body?.kind === "heartbeat") {
    return json({ ok: true, kind: "heartbeat", received_at: new Date().toISOString() });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await supabase
    .from("pending_stock_entry")
    .insert({
      source: "lindy",
      status: "approved",
      payload: body,
    })
    .select("id, created_at")
    .single();

  if (error) {
    console.error("[lindy-stock-intake] insert error", error);
    return json({ error: error.message }, 500);
  }

  return json({ ok: true, id: data.id, created_at: data.created_at }, 201);
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
