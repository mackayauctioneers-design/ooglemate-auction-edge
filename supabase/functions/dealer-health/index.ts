// dealer-health: proxy to VPS Worker GET /dealer-health/:dealer_id
import { corsHeaders, dispatchToWorker, json } from "../_shared/worker-proxy.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let dealerId = "";
  if (req.method === "GET") {
    const url = new URL(req.url);
    dealerId = (url.searchParams.get("dealer_id") ?? "").trim();
  } else {
    try {
      const body = await req.json();
      dealerId = String(body.dealer_id ?? "").trim();
    } catch { /* ignore */ }
  }
  if (!dealerId) return json({ error: "dealer_id is required" }, 400);

  return dispatchToWorker({
    req,
    action: "dealer-health",
    method: "GET",
    workerPath: "/dealer-health/:dealer_id",
    dealerId,
  });
});
