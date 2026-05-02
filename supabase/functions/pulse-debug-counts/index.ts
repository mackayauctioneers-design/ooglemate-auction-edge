import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PULSE_TOKEN = Deno.env.get("PULSE_BEARER_TOKEN")!;

const BUYABLE = ["active","listed","inprep","catalogue","relisted","prepcompleted"];

function jres(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function makeOrFilter(field: string, val: string) {
  return `${field}.eq.${val},${field}.eq.${val.toUpperCase()},${field}.eq.${val.toLowerCase()}`;
}

async function countOnly(qb: any): Promise<number> {
  const { count, error } = await qb;
  if (error) throw error;
  return count ?? 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jres(405, { error: "method_not_allowed" });

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== PULSE_TOKEN) return jres(401, { error: "unauthorized" });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const make = String(body?.make ?? "").trim();
  const model = String(body?.model ?? "").trim();
  if (!make || !model) return jres(400, { error: "make_and_model_required" });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const sinceIso = new Date(Date.now() - 60*86_400_000).toISOString();

  const base = () => sb.from("market_listings")
    .select("*", { count: 'exact', head: true })
    .or(makeOrFilter("make", make))
    .or(makeOrFilter("model", model));

  try {
    const [
      total,
      withStatus,
      withStatusNotExcluded,
      withPrice,
      withYearKm,
      with60d,
      withNullOr60d,
      statusSampleRes,
      ageSampleRes,
    ] = await Promise.all([
      countOnly(base()),
      countOnly(base().in("status", BUYABLE)),
      countOnly(base().in("status", BUYABLE).or("exclude_from_alerts.is.null,exclude_from_alerts.eq.false")),
      countOnly(base().in("status", BUYABLE).or("exclude_from_alerts.is.null,exclude_from_alerts.eq.false").or("price.gt.1000,asking_price.gt.1000")),
      countOnly(base().in("status", BUYABLE).or("exclude_from_alerts.is.null,exclude_from_alerts.eq.false").or("price.gt.1000,asking_price.gt.1000").not("year","is",null).or("km.not.is.null,kilometres.not.is.null")),
      countOnly(base().in("status", BUYABLE).or("exclude_from_alerts.is.null,exclude_from_alerts.eq.false").or("price.gt.1000,asking_price.gt.1000").not("year","is",null).or("km.not.is.null,kilometres.not.is.null").gte("first_seen_at", sinceIso)),
      countOnly(base().in("status", BUYABLE).or("exclude_from_alerts.is.null,exclude_from_alerts.eq.false").or("price.gt.1000,asking_price.gt.1000").not("year","is",null).or("km.not.is.null,kilometres.not.is.null").or(`first_seen_at.gte.${sinceIso},first_seen_at.is.null`)),
      sb.from("market_listings").select("status").or(makeOrFilter("make", make)).or(makeOrFilter("model", model)).limit(500),
      sb.from("market_listings").select("first_seen_at").or(makeOrFilter("make", make)).or(makeOrFilter("model", model)).limit(5),
    ]);

    const statusSet = new Set<string>();
    for (const r of (statusSampleRes.data ?? [])) {
      statusSet.add(String((r as any).status ?? "<null>"));
      if (statusSet.size >= 20) break;
    }
    const now = Date.now();
    const ages = (ageSampleRes.data ?? []).map((r: any) => {
      if (!r.first_seen_at) return null;
      return Math.round((now - new Date(r.first_seen_at).getTime()) / 86_400_000);
    });

    return jres(200, {
      total,
      with_status_buyable: withStatus,
      with_status_buyable_not_excluded: withStatusNotExcluded,
      with_price_gt_1000: withPrice,
      with_year_and_km: withYearKm,
      with_first_seen_60d: with60d,
      with_first_seen_null_or_60d: withNullOr60d,
      sample_status_values: [...statusSet],
      sample_first_seen_ages_days: ages,
    });
  } catch (e) {
    return jres(500, { error: (e as Error).message });
  }
});
