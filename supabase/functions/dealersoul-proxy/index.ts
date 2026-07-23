// dealersoul-proxy: server-side proxy to the VPS DealerSoul API.
// The DEALERSOUL_API_KEY never reaches the browser. Requires a valid
// Supabase session (JWT) — dealer scoping will layer on top later.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const BASE = Deno.env.get("DEALERSOUL_BASE_URL")!;
const KEY = Deno.env.get("DEALERSOUL_API_KEY")!;

// Allowlist of upstream paths we're willing to proxy. Anything else = 404.
const ALLOWED = [
  /^\/api\/v2\/stats$/,
  /^\/api\/v2\/deals$/,
  /^\/api\/v2\/vehicle\/[^/]+\/[^/]+$/,
  /^\/api\/v2\/market-floor$/,
  /^\/api\/v2\/fingerprint$/,
  /^\/health$/,
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  // Require a signed-in user.
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data: claims, error: claimsErr } = await supabase.auth.getClaims(auth.replace("Bearer ", ""));
  if (claimsErr || !claims?.claims) return json({ error: "Unauthorized" }, 401);

  const url = new URL(req.url);
  // Everything after `/dealersoul-proxy` is the upstream path.
  const marker = "/dealersoul-proxy";
  const idx = url.pathname.indexOf(marker);
  const upstreamPath = idx >= 0 ? url.pathname.slice(idx + marker.length) || "/health" : "/health";
  if (!ALLOWED.some((re) => re.test(upstreamPath))) {
    return json({ error: "Path not allowed", path: upstreamPath }, 404);
  }

  const upstream = `${BASE}${upstreamPath}${url.search}`;
  try {
    const resp = await fetch(upstream, { headers: { "X-API-Key": KEY, Accept: "application/json" } });
    const text = await resp.text();
    return new Response(text, {
      status: resp.status,
      headers: { ...corsHeaders, "Content-Type": resp.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (e) {
    return json({ error: "Upstream fetch failed", detail: String(e) }, 502);
  }
});
