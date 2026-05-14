import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("cf-connecting-ip") ??
    null;

  const log = async (status_code: number, error: string | null, payload: unknown) => {
    try {
      await supabase.from("scanner_logs").insert({
        endpoint: "/receive-deals",
        method: req.method,
        status_code,
        ip,
        error,
        payload: payload ?? null,
      });
    } catch (e) {
      console.error("[receive-deals] log error:", e);
    }
  };

  if (req.method !== "POST") {
    await log(405, "Method not allowed", null);
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  // API key check
  const expected = Deno.env.get("SCANNER_API_KEY");
  if (!expected) {
    await log(500, "SCANNER_API_KEY not configured", null);
    return json({ success: false, error: "Server misconfigured" }, 500);
  }
  const provided = req.headers.get("x-api-key") ?? "";
  if (provided !== expected) {
    await log(401, "Invalid or missing API key", null);
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    await log(400, "Invalid JSON", null);
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const { make, model, year, price, mileage, location, listing_url, source } = body ?? {};

  // Required fields
  const missing: string[] = [];
  if (!make) missing.push("make");
  if (!model) missing.push("model");
  if (year === undefined || year === null) missing.push("year");
  if (price === undefined || price === null) missing.push("price");
  if (!listing_url) missing.push("listing_url");
  if (missing.length) {
    await log(400, `Missing fields: ${missing.join(", ")}`, body);
    return json({ success: false, error: `Missing required fields: ${missing.join(", ")}` }, 400);
  }

  // Dedupe within last 24h
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: existing, error: dupErr } = await supabase
    .from("scanned_deals")
    .select("id")
    .eq("listing_url", listing_url)
    .gte("created_at", since)
    .maybeSingle();

  if (dupErr) {
    console.error("[receive-deals] dedupe error:", dupErr);
    await log(500, `Dedupe error: ${dupErr.message}`, body);
    return json({ success: false, error: "Database error" }, 500);
  }
  if (existing) {
    await log(200, "Duplicate ignored", body);
    return json({ success: true, id: existing.id, duplicate: true });
  }

  const { data, error } = await supabase
    .from("scanned_deals")
    .insert({
      make,
      model,
      year,
      price,
      mileage: mileage ?? null,
      location: location ?? null,
      listing_url,
      source: source ?? "VPS_Scanner",
      status: "pending",
    })
    .select("id")
    .single();

  if (error) {
    console.error("[receive-deals] insert error:", error);
    await log(500, error.message, body);
    return json({ success: false, error: "Database error" }, 500);
  }

  await log(201, null, body);
  return json({ success: true, id: data.id }, 201);
});
