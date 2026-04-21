// Worker: atomically claim next approved row from pending_stock_entry.
// Auth: Authorization: Bearer <WORKER_TOKEN>
// Uses SQL function claim_next_pending_stock_entry which performs
// SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1 inside a transaction.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-worker-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expected = Deno.env.get("WORKER_TOKEN");
  if (!expected) return json({ error: "Server misconfigured" }, 500);
  const auth = req.headers.get("Authorization") ?? "";
  const headerToken = req.headers.get("x-worker-token") ?? "";
  const bearerToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const provided = headerToken || bearerToken;
  if (provided !== expected) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await supabase.rpc("claim_next_pending_stock_entry", {
    _locked_by: "perplexity-worker",
  });

  if (error) {
    console.error("[worker-claim-next] rpc error", error);
    return json({ error: error.message }, 500);
  }

  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  return json({ row });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
