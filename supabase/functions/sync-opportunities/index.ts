// sync-opportunities: proxy to VPS Worker /sync-opportunities
import { corsHeaders, dispatchToWorker, json } from "../_shared/worker-proxy.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const dealerId = String(body.dealer_id ?? "").trim();
  if (!dealerId) return json({ error: "dealer_id is required" }, 400);

  return dispatchToWorker({
    req,
    action: "sync-opportunities",
    method: "POST",
    workerPath: "/sync-opportunities",
    body,
    dealerId,
  });
});
