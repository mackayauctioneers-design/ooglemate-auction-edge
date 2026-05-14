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
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  // API key check
  const expected = Deno.env.get("API_KEY");
  if (!expected) {
    console.error("[receive-listings] API_KEY secret not configured");
    return json({ success: false, error: "Server misconfigured" }, 500);
  }
  const provided = req.headers.get("x-api-key") ?? "";
  if (provided !== expected) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const { make, model, year, price, mileage, location, listing_url } = body ?? {};

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase
    .from("external_listings")
    .insert({
      make: make ?? null,
      model: model ?? null,
      year: year ?? null,
      price: price ?? null,
      mileage: mileage ?? null,
      location: location ?? null,
      listing_url: listing_url ?? null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[receive-listings] insert error:", error);
    return json({ success: false, error: error.message }, 500);
  }

  return json({ success: true, id: data.id });
});
