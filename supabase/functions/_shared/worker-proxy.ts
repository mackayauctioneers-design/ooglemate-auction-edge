// Shared helper for Lovable -> VPS Worker API proxy edge functions.
// Validates caller JWT, scopes by dealer_id, dispatches to the VPS Worker
// using WORKER_TOKEN, and persists every dispatch into worker_runs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface DispatchOpts {
  req: Request;
  action: string;
  /** HTTP method to use against the VPS worker. */
  method: "GET" | "POST";
  /**
   * Path on the worker, e.g. "/activate-dealer".
   * `:dealer_id` will be substituted with the provided dealer_id.
   */
  workerPath: string;
  /** Body forwarded to the worker (for POST endpoints). */
  body?: Record<string, unknown>;
  /** Caller-provided dealer_id (required). */
  dealerId: string;
  /** Require admin role to invoke (operator-only actions). */
  requireAdmin?: boolean;
}

export async function dispatchToWorker(opts: DispatchOpts) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const workerUrl = Deno.env.get("WORKER_API_URL");
  const workerToken = Deno.env.get("WORKER_TOKEN");

  if (!workerUrl || !workerToken) {
    return json({ error: "Worker API not configured" }, 500);
  }
  if (!opts.dealerId) {
    return json({ error: "dealer_id is required" }, 400);
  }

  // --- AuthN: verify caller JWT
  const authHeader = opts.req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }
  const userClient = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) {
    return json({ error: "Unauthorized" }, 401);
  }
  const userId = claimsData.claims.sub as string;

  // --- AuthZ: admin OR dealer owns this dealer_id
  const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
  const { data: isAdmin } = await admin.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (opts.requireAdmin && !isAdmin) {
    return json({ error: "Forbidden - admin required" }, 403);
  }
  if (!isAdmin) {
    const { data: profile } = await admin
      .from("dealer_profiles")
      .select("account_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!profile || profile.account_id !== opts.dealerId) {
      return json({ error: "Forbidden - dealer scope mismatch" }, 403);
    }
  }

  // --- Log the dispatch
  const startedAt = new Date();
  const { data: runRow } = await admin
    .from("worker_runs")
    .insert({
      dealer_id: opts.dealerId,
      action: opts.action,
      status: "pending",
      request_payload: opts.body ?? {},
      invoked_by: userId,
      started_at: startedAt.toISOString(),
    })
    .select("id")
    .single();
  const runId = runRow?.id as string | undefined;

  // --- Call the VPS worker
  const path = opts.workerPath.replace(":dealer_id", encodeURIComponent(opts.dealerId));
  const url = `${workerUrl.replace(/\/$/, "")}${path}`;
  const fetchInit: RequestInit = {
    method: opts.method,
    headers: {
      Authorization: `Bearer ${workerToken}`,
      "Content-Type": "application/json",
    },
  };
  if (opts.method === "POST") {
    fetchInit.body = JSON.stringify({ ...(opts.body ?? {}), dealer_id: opts.dealerId });
  }

  let httpStatus = 0;
  let responseJson: unknown = null;
  let errorText: string | null = null;
  try {
    const resp = await fetch(url, fetchInit);
    httpStatus = resp.status;
    const text = await resp.text();
    try { responseJson = text ? JSON.parse(text) : null; }
    catch { responseJson = { raw: text }; }
    if (!resp.ok) errorText = `Worker returned ${resp.status}`;
  } catch (e) {
    errorText = e instanceof Error ? e.message : String(e);
  }

  const finishedAt = new Date();
  if (runId) {
    await admin
      .from("worker_runs")
      .update({
        status: errorText ? "failed" : "ok",
        http_status: httpStatus || null,
        response_payload: responseJson as never,
        error: errorText,
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
      })
      .eq("id", runId);
  }

  if (errorText) {
    return json({ error: errorText, worker_response: responseJson, run_id: runId }, 502);
  }
  return json({ ok: true, run_id: runId, worker_response: responseJson }, 200);
}
