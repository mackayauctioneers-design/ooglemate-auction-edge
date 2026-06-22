// Hermes Bridge - authenticated proxy for VPS Hermes worker
// Bypasses RLS using service_role, gated by HERMES_API_KEY bearer token.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HERMES_API_KEY = Deno.env.get("HERMES_API_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth: shared secret
  const auth = req.headers.get("authorization") ?? req.headers.get("x-hermes-key") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!HERMES_API_KEY || token !== HERMES_API_KEY) {
    return json({ error: "unauthorized" }, 401);
  }

  const url = new URL(req.url);
  // strip the function name prefix: /hermes-bridge/<op>
  const parts = url.pathname.split("/").filter(Boolean);
  const op = parts[parts.length - 1] || "";

  try {
    // GET /dealers -> active dealer_context rows
    if (op === "dealers" && req.method === "GET") {
      const { data, error } = await admin
        .from("dealer_context")
        .select("*")
        .eq("active", true);
      if (error) throw error;
      return json({ dealers: data ?? [] });
    }

    // POST /lock { name, ttl_seconds, holder }
    if (op === "lock" && req.method === "POST") {
      const { name, ttl_seconds = 1800, holder = "hermes" } = await req.json();
      if (!name) return json({ error: "name required" }, 400);
      const now = new Date();
      const expires = new Date(now.getTime() + ttl_seconds * 1000).toISOString();

      // Try insert; if conflict, check if existing lock has expired and steal it.
      const { error: insErr } = await admin
        .from("hermes_locks")
        .insert({ lock_name: name, holder, expires_at: expires });

      if (!insErr) return json({ acquired: true, expires_at: expires });

      // Conflict path: check expiry
      const { data: existing } = await admin
        .from("hermes_locks")
        .select("*")
        .eq("lock_name", name)
        .maybeSingle();

      if (existing && new Date(existing.expires_at) < now) {
        const { error: updErr } = await admin
          .from("hermes_locks")
          .update({ holder, expires_at: expires })
          .eq("lock_name", name);
        if (updErr) throw updErr;
        return json({ acquired: true, stolen: true, expires_at: expires });
      }

      return json({ acquired: false, reason: "held", current: existing }, 200);
    }

    // POST /unlock { name, holder? }
    if (op === "unlock" && req.method === "POST") {
      const { name, holder } = await req.json();
      if (!name) return json({ error: "name required" }, 400);
      let q = admin.from("hermes_locks").delete().eq("lock_name", name);
      if (holder) q = q.eq("holder", holder);
      const { error } = await q;
      if (error) throw error;
      return json({ released: true });
    }

    // POST /evals { evaluations: [...] }
    if (op === "evals" && req.method === "POST") {
      const body = await req.json();
      const rows = Array.isArray(body?.evaluations) ? body.evaluations : [];
      if (!rows.length) return json({ inserted: 0 });
      const { data, error } = await admin
        .from("hermes_evaluations")
        .insert(rows)
        .select("id");
      if (error) throw error;
      return json({ inserted: data?.length ?? 0 });
    }

    return json({ error: "unknown op", op, method: req.method }, 404);
  } catch (e) {
    console.error("hermes-bridge error", e);
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
