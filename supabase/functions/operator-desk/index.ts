// operator-desk: Trading Desk gateway for Ooglecars (portal) sign-ins, scoped per yard. See scope.ts.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders as baseCors } from "npm:@supabase/supabase-js@2/cors";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";
import { DeskError, handleDesk, type DeskStore, type Opp } from "./scope.ts";

// Public Ooglecars values (the same project URL and anon key the portal ships to every browser). No Ooglecars secret.
const OOGLECARS_URL = "https://esyinwxhcpexncgqcnwi.supabase.co";
const OOGLECARS_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzeWlud3hoY3BleG5jZ3FjbndpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNTQ0NTcsImV4cCI6MjA5NTgzMDQ1N30.web-fk71f-hm0fJ-OPY6SB9sNbMaDpIxKTtaxWNp_fg";
const JWKS = createRemoteJWKSet(new URL(`${OOGLECARS_URL}/auth/v1/.well-known/jwks.json`));
const verify = (token: string) => jwtVerify(token, JWKS, { issuer: `${OOGLECARS_URL}/auth/v1`, audience: "authenticated", algorithms: ["ES256"] });

async function memberships(token: string, sub: string) {
  const url = `${OOGLECARS_URL}/rest/v1/dealership_members?select=dealership_id,role&user_id=eq.${encodeURIComponent(sub)}`;
  const res = await fetch(url, { headers: { apikey: OOGLECARS_ANON, Authorization: `Bearer ${token}` } });
  if (!res.ok) { await res.text(); throw new DeskError(502, "membership lookup failed"); }
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

const corsHeaders = { ...baseCors, "Access-Control-Allow-Headers": `${baseCors["Access-Control-Allow-Headers"]}, x-portal-token` };

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const ACTIONABLE = ["new", "assigned", "reviewed"];

function yardFilter(q: any, ids: string[]) {
  const list = ids.join(",");
  return q.or(`best_account_id.in.(${list}),assigned_to_account.in.(${list})`);
}

const store: DeskStore = {
  async isOwner(id) {
    const { data, error } = await db.from("owner_access").select("ooglecars_user_id").eq("ooglecars_user_id", id).eq("active", true).maybeSingle();
    if (error) throw error; return !!data;
  },
  async yardAccounts(dealershipIds) {
    const { data, error } = await db.from("yard_links").select("account_id").in("ooglecars_dealership_id", dealershipIds);
    if (error) throw error; return (data ?? []).map((r: any) => r.account_id);
  },
  async accounts(ids) {
    if (ids !== null && !ids.length) return [];
    let q = db.from("accounts").select("id, display_name");
    if (ids !== null) q = q.in("id", ids);
    const { data, error } = await q; if (error) throw error; return data ?? [];
  },
  async listOpps({ accountIds, focus, freshFloor, activeLimit, starredLimit }) {
    let a: any = db.from("operator_opportunities").select("*").in("status", ACTIONABLE).gte("created_at", freshFloor).order("created_at", { ascending: false }).limit(activeLimit);
    let s: any = db.from("operator_opportunities").select("*").eq("is_starred", true).not("status", "in", '("new","assigned","reviewed")').limit(starredLimit);
    if (accountIds !== null) { a = yardFilter(a, accountIds); s = yardFilter(s, accountIds); }
    if (focus) { a = a.eq("best_account_id", focus); s = s.eq("best_account_id", focus); }
    const [ar, sr] = await Promise.all([a, s]);
    if (ar.error) throw ar.error; if (sr.error) throw sr.error;
    return { active: (ar.data ?? []) as Opp[], starred: (sr.data ?? []) as Opp[] };
  },
  async getOpp(id) {
    const { data, error } = await db.from("operator_opportunities").select("id, best_account_id, assigned_to_account").eq("id", id).maybeSingle();
    if (error) throw error; return data as Opp | null;
  },
  async updateOpp(id, patch) {
    const { error } = await db.from("operator_opportunities").update(patch).eq("id", id); if (error) throw error;
  },
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  // The Ooglecars token travels in its own header; Authorization carries this project's public key for the gateway.
  const token = (req.headers.get("x-portal-token") ?? "").trim();
  let body: unknown = null;
  try { body = await req.json(); } catch { return json(400, { error: "invalid json" }); }
  try {
    return json(200, await handleDesk(token, body, { verify, memberships, store }));
  } catch (err) {
    if (err instanceof DeskError) return json(err.status, { error: err.message });
    console.error("operator-desk failed", err instanceof Error ? err.message : "unknown");
    return json(500, { error: "internal error" });
  }
});
