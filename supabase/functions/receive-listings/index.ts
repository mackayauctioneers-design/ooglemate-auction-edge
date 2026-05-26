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

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey =
  Deno.env.get("SUPABASE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Module-scope client → reused across warm invocations, avoids cold-start
// connection storms that were causing the 5xx clusters Apify reported.
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 150 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

async function processListing(body: any) {
  const { make, model, year, price, mileage, location, listing_url } = body ?? {};
  const market_indicator =
    body?.market_indicator ??
    body?.marketIndicator ??
    body?.price_badge ??
    body?.priceBadge ??
    null;
  const source = body?.source ?? null;

  try {
    const { data, error } = await withRetry(() =>
      supabase
        .from("external_listings")
        .insert({
          make: make ?? null,
          model: model ?? null,
          year: year ?? null,
          price: price ?? null,
          mileage: mileage ?? null,
          location: location ?? null,
          listing_url: listing_url ?? null,
          market_indicator,
          source,
        })
        .select("id")
        .single()
    );

    if (error) throw error;

    // WBM fan-out — fire-and-forget
    const badge = market_indicator ? String(market_indicator) : "";
    const isWbm = /well\s+below\s+market/i.test(badge);
    if (isWbm && listing_url && make && model && year && price) {
      try {
        const enc = new TextEncoder().encode(String(listing_url));
        const hashBuf = await crypto.subtle.digest("SHA-256", enc);
        const listing_id =
          "el-" +
          Array.from(new Uint8Array(hashBuf))
            .slice(0, 16)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        fetch(`${supabaseUrl}/functions/v1/well-below-market-alert`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            listing_id,
            make, model, variant: null,
            year, price, km: mileage ?? null,
            listing_url, state: location ?? null,
            price_badge: badge,
            source_table: source ?? "external_listings",
          }),
        }).catch((e) => console.error("[receive-listings] WBM fan-out:", e));
      } catch (e) {
        console.error("[receive-listings] WBM hash:", e);
      }
    }

    return { id: data?.id, wbm: isWbm };
  } catch (e) {
    console.error("[receive-listings] insert failed, dead-lettering:", e);
    // Dead-letter — guarantees we never silently drop, even if DB is choked.
    try {
      await supabase.from("receive_listings_dead_letter").insert({
        payload: body,
        error_message: String((e as any)?.message ?? e),
        source,
        listing_url: listing_url ?? null,
      });
    } catch (dlErr) {
      console.error("[receive-listings] dead-letter write failed:", dlErr);
    }
    return { error: String((e as any)?.message ?? e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  // Respond IMMEDIATELY — process in background so cold-start / DB latency
  // can never produce a 5xx to the Apify actor. Apify's circuit-breaker was
  // tripping on the synchronous path; this removes that failure mode.
  // @ts-ignore - EdgeRuntime is available in Supabase Deno runtime
  EdgeRuntime.waitUntil(processListing(body));

  return json({ success: true, queued: true });
});
