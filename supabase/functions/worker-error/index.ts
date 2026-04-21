// Worker: report an error on a queue row.
// Auth: Authorization: Bearer <WORKER_TOKEN>
// Body: { id: string, error_message: string, retry?: boolean }
// If retry=true and attempts < 3 -> status='approved', locked_at=null (re-queue).
// Otherwise -> status='error' with the message.
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

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const id = String(body?.id ?? "").trim();
  const error_message = String(body?.error_message ?? "").slice(0, 4000);
  const retry = Boolean(body?.retry);

  if (!id) return json({ error: "id is required" }, 400);
  if (!error_message) return json({ error: "error_message is required" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Need current attempts to decide retry vs final-error
  const { data: current, error: readErr } = await supabase
    .from("pending_stock_entry")
    .select("id, attempts")
    .eq("id", id)
    .single();

  if (readErr) {
    console.error("[worker-error] read error", readErr);
    return json({ error: readErr.message }, 500);
  }

  const willRetry = retry && (current?.attempts ?? 0) < 3;

  const update = willRetry
    ? {
        status: "approved",
        locked_at: null,
        last_error: error_message,
        error_message: error_message,
      }
    : {
        status: "error",
        locked_at: null,
        last_error: error_message,
        error_message: error_message,
      };

  const { data, error } = await supabase
    .from("pending_stock_entry")
    .update(update)
    .eq("id", id)
    .select("id, status, attempts, error_message")
    .single();

  if (error) {
    console.error("[worker-error] update error", error);
    return json({ error: error.message }, 500);
  }

  return json({ ok: true, retried: willRetry, row: data });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
