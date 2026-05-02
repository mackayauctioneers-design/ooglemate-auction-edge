import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PULSE_TOKEN = Deno.env.get("PULSE_BEARER_TOKEN")!;

const BUYABLE = new Set(["active","listed","inprep","catalogue","relisted","prepcompleted"]);

function jres(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
  const sinceMs = Date.now() - 60*86_400_000;
  const sinceIso = new Date(sinceMs).toISOString();

  // Single fetch: pull all candidate rows (case variants) with the columns we need,
  // then compute every count in-memory. Avoids slow exact-count plans on multi-OR queries.
  try {
    const all: any[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await sb.from("market_listings")
        .select("status,exclude_from_alerts,price,asking_price,year,km,kilometres,first_seen_at")
        .eq("make", make.toUpperCase())
        .eq("model", model.toUpperCase())
        .range(from, from + PAGE - 1);
      if (error) return jres(500, { error: error.message, stage: "fetch" });
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
      if (from > 50000) break;
    }

    let total = all.length;
    let withStatus = 0, withStatusNotExcluded = 0, withPrice = 0, withYearKm = 0, with60d = 0, withNullOr60d = 0;
    const statusSet = new Set<string>();
    const ageSamples: (number|null)[] = [];

    for (const r of all) {
      if (statusSet.size < 20) statusSet.add(String(r.status ?? "<null>"));
      if (ageSamples.length < 5) {
        ageSamples.push(r.first_seen_at ? Math.round((Date.now() - new Date(r.first_seen_at).getTime())/86_400_000) : null);
      }
      const status = String(r.status ?? "").toLowerCase();
      if (!BUYABLE.has(status)) continue;
      withStatus++;
      if (r.exclude_from_alerts === true) continue;
      withStatusNotExcluded++;
      const price = r.price ?? r.asking_price;
      if (price == null || price <= 1000) continue;
      withPrice++;
      const km = r.km ?? r.kilometres;
      if (r.year == null || km == null) continue;
      withYearKm++;
      const fsMs = r.first_seen_at ? new Date(r.first_seen_at).getTime() : null;
      if (fsMs != null && fsMs >= sinceMs) with60d++;
      if (fsMs == null || fsMs >= sinceMs) withNullOr60d++;
    }

    return jres(200, {
      total,
      with_status_buyable: withStatus,
      with_status_buyable_not_excluded: withStatusNotExcluded,
      with_price_gt_1000: withPrice,
      with_year_and_km: withYearKm,
      with_first_seen_60d: with60d,
      with_first_seen_null_or_60d: withNullOr60d,
      sample_status_values: [...statusSet],
      sample_first_seen_ages_days: ageSamples,
    });
  } catch (e) {
    return jres(500, { error: (e as Error).message });
  }
});
