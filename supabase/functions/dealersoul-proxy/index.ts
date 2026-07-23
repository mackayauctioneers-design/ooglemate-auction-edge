// dealersoul-proxy: server-side proxy to the VPS DealerSoul API.
// The DEALERSOUL_API_KEY (master) never reaches the browser. Multi-tenant
// scoping is done by resolving the caller's dealer from their Supabase JWT
// and injecting X-Dealer-Id server-side.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const BASE = Deno.env.get("DEALERSOUL_BASE_URL")!;   // e.g. https://srv1422435.hstgr.cloud/ds-api
const KEY = Deno.env.get("DEALERSOUL_API_KEY")!;      // master key

// Allowlist of upstream paths we're willing to proxy.
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

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const token = auth.replace("Bearer ", "");
  const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
  if (claimsErr || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
  const userId = claimsData.claims.sub;

  // Resolve dealer slug from JWT → dealer_profiles.dealer_name (slugified).
  // Allows ?dealer_id= override for admins/testing.
  const url = new URL(req.url);
  let dealerId = url.searchParams.get("dealer_id") ?? "";
  if (!dealerId) {
    const { data: prof } = await supabase.rpc("get_dealer_profile_by_user", { _user_id: userId });
    const name = Array.isArray(prof) ? prof[0]?.dealer_name : (prof as { dealer_name?: string } | null)?.dealer_name;
    if (name) dealerId = slugify(String(name));
  }
  if (!dealerId) return json({ error: "No dealer profile linked to this user" }, 403);

  const marker = "/dealersoul-proxy";
  const idx = url.pathname.indexOf(marker);
  const upstreamPath = idx >= 0 ? url.pathname.slice(idx + marker.length) || "/health" : "/health";
  if (!ALLOWED.some((re) => re.test(upstreamPath))) {
    return json({ error: "Path not allowed", path: upstreamPath }, 404);
  }

  // Strip dealer_id from forwarded query — it's sent as a header.
  const forwardParams = new URLSearchParams(url.search);
  forwardParams.delete("dealer_id");
  const qs = forwardParams.toString();
  const upstream = `${BASE}${upstreamPath}${qs ? `?${qs}` : ""}`;

  try {
    const resp = await fetch(upstream, {
      headers: {
        "X-API-Key": KEY,
        "X-Dealer-Id": dealerId,
        Accept: "application/json",
      },
    });
    const text = await resp.text();
    return new Response(text, {
      status: resp.status,
      headers: { ...corsHeaders, "Content-Type": resp.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (e) {
    return json({ error: "Upstream fetch failed", detail: String(e) }, 502);
  }
});
