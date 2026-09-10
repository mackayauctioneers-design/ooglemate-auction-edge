// agent-checkin: the single conduit every agent uses to register itself,
// declare which dealerships/sources it is watching, and heartbeat.
//
// POST https://<project>.functions.supabase.co/agent-checkin
// Authorization: Bearer <AGENT_CHECKIN_KEY>
// {
//   "agent_key": "hermes-vps",
//   "display_name": "Hermes VPS Worker",
//   "kind": "worker",                       // worker | scraper | bot | proxy | scheduler
//   "owner": "vps",
//   "endpoint": "https://srv.../hermes",
//   "capabilities": ["ingest", "score"],
//   "expected_interval_minutes": 15,
//   "status": "ok",                          // ok | degraded | error
//   "message": "cycle complete",
//   "metrics": { "listings": 412 },
//   "watching": [
//     { "dealer_slug": "ajh-auto-traders", "watch_type": "dealer",
//       "target_ref": "sales-truth", "label": "AJH sold history",
//       "status": "active", "last_run_at": "...", "last_success_at": "...",
//       "items": 230, "result": { "new": 4 } }
//   ]
// }
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CHECKIN_KEY = Deno.env.get("AGENT_CHECKIN_KEY") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const str = (v: unknown, max = 500) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("authorization") ?? req.headers.get("x-agent-key") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!CHECKIN_KEY || token !== CHECKIN_KEY) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const agentKey = str(body.agent_key, 120);
  if (!agentKey) return json({ error: "agent_key is required" }, 400);

  const status = str(body.status, 40) ?? "ok";
  const message = str(body.message, 2000);
  const metrics = (body.metrics && typeof body.metrics === "object") ? body.metrics : {};
  const nowIso = new Date().toISOString();

  try {
    // 1. Register / refresh the agent
    const registryRow: Record<string, unknown> = {
      agent_key: agentKey,
      display_name: str(body.display_name, 200) ?? agentKey,
      kind: str(body.kind, 40) ?? "worker",
      description: str(body.description, 2000),
      owner: str(body.owner, 120),
      endpoint: str(body.endpoint, 500),
      auth_scheme: "shared_secret",
      last_seen_at: nowIso,
      last_status: status,
      last_error: status === "ok" ? null : message,
      is_active: true,
    };
    if (Array.isArray(body.capabilities)) registryRow.capabilities = body.capabilities;
    if (typeof body.expected_interval_minutes === "number") {
      registryRow.expected_interval_minutes = Math.max(1, Math.round(body.expected_interval_minutes));
    }
    if (body.meta && typeof body.meta === "object") registryRow.meta = body.meta;

    const { data: agent, error: agentErr } = await admin
      .from("agent_registry")
      .upsert(registryRow, { onConflict: "agent_key" })
      .select("id, agent_key")
      .single();
    if (agentErr) throw agentErr;

    // 2. Heartbeat
    await admin.from("agent_heartbeats").insert({
      agent_id: agent.id,
      status,
      message,
      metrics,
    });

    // 3. Watch links (which dealership / source this agent covers)
    const watching = Array.isArray(body.watching) ? body.watching : [];
    const linked: string[] = [];
    for (const raw of watching.slice(0, 200)) {
      const w = (raw ?? {}) as Record<string, unknown>;
      let accountId = str(w.account_id, 60);
      const slug = str(w.dealer_slug, 120);
      if (!accountId && slug) {
        const { data: acct } = await admin
          .from("accounts")
          .select("id")
          .eq("slug", slug)
          .maybeSingle();
        accountId = acct?.id ?? null;
      }
      const link = {
        agent_id: agent.id,
        account_id: accountId,
        dealer_slug: slug,
        watch_type: str(w.watch_type, 40) ?? "dealer",
        target_ref: str(w.target_ref, 300) ?? "",
        label: str(w.label, 300),
        status: str(w.status, 40) ?? "active",
        last_run_at: str(w.last_run_at, 60) ?? nowIso,
        last_success_at: str(w.last_success_at, 60) ??
          (status === "ok" ? nowIso : null),
        items_last_run: typeof w.items === "number" ? Math.round(w.items) : null,
        last_result: (w.result && typeof w.result === "object") ? w.result : {},
      };
      const { error: linkErr } = await admin
        .from("agent_watch_links")
        .upsert(link, { onConflict: "agent_id,watch_type,target_ref,account_id" });
      if (!linkErr) linked.push(`${link.watch_type}:${slug ?? accountId ?? link.target_ref}`);
    }

    return json({
      ok: true,
      agent_id: agent.id,
      agent_key: agent.agent_key,
      linked,
      server_time: nowIso,
    });
  } catch (e) {
    console.error("agent-checkin error", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
