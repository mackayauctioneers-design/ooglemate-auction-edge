import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Well Below Market Alert v1.1
 *
 * Called by pg_net from a DB trigger on retail_listings when price_badge = 'well below market'.
 * Cross-checks dealer_sales for make+model+variant median sell price.
 * Sends WhatsApp alert via existing Twilio setup if listing is 15%+ below median.
 *
 * v1.1 changes:
 *   - Added MIN_YEAR guard (2015) — old cars are irrelevant to wholesale arbitrage
 *   - Zero-comparable listings no longer auto-alert (was generating pure noise)
 *   - Require at least 1 comparable sale to trigger an alert
 */

// Cars older than this are not worth alerting on — noise filter
const MIN_YEAR = 2015;
// Require at least this many comparable sales to send an alert
const MIN_COMPS = 1;

interface ListingPayload {
  listing_id: string;
  make: string;
  model: string;
  variant: string | null;
  year: number | null;
  price: number;
  km: number | null;
  listing_url: string | null;
  state: string | null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const payload: ListingPayload = await req.json();
    const { listing_id, make, model, variant, year, price, km, listing_url, state } = payload;

    if (!listing_id || !make || !model || !price) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Year guard — skip old cars that shouldn't trigger alerts ──
    if (year != null && year < MIN_YEAR) {
      console.log(`Skipping listing ${listing_id}: year ${year} < ${MIN_YEAR}`);
      await supabase.from("well_below_market_alerts_sent").insert({
        listing_id,
        alerted: false,
        reason: `Year ${year} below minimum ${MIN_YEAR}`,
      });
      return new Response(
        JSON.stringify({ success: true, alerted: false, reason: `year_too_old: ${year}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Dedup check ──────────────────────────────────────────────
    const { data: existing } = await supabase
      .from("well_below_market_alerts_sent")
      .select("id")
      .eq("listing_id", listing_id)
      .maybeSingle();

    if (existing) {
      console.log(`Already alerted for listing ${listing_id}, skipping`);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "already_alerted" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Query dealer_sales for comparables ───────────────────────
    let query = supabase
      .from("dealer_sales")
      .select("sell_price, variant_raw, year")
      .ilike("make", make)
      .ilike("model", model)
      .not("sell_price", "is", null);

    // If variant is available, try to match on it
    if (variant) {
      query = query.ilike("variant_raw", `%${variant}%`);
    }

    const { data: sales, error: salesErr } = await query.limit(500);

    if (salesErr) {
      console.error("dealer_sales query error:", salesErr.message);
      throw new Error(`dealer_sales query failed: ${salesErr.message}`);
    }

    const sellPrices = (sales || [])
      .map((s: any) => s.sell_price)
      .filter((p: number | null): p is number => p != null && p > 0);

    const compCount = sellPrices.length;
    const thinData = compCount < 3;

    // If zero comparables, still alert but flag it
    let medianSell = 0;
    let belowPct = 0;
    let passesThreshold = false;

    if (compCount > 0) {
      medianSell = median(sellPrices);
      belowPct = parseFloat((((medianSell - price) / medianSell) * 100).toFixed(1));
      passesThreshold = price < medianSell * 0.85; // 15% below
    }

    // If no comparables at all, do NOT alert — zero-comp alerts are pure noise
    if (compCount < MIN_COMPS) {
      console.log(`Listing ${listing_id}: only ${compCount} comps (need ${MIN_COMPS}) — suppressing alert`);
      await supabase.from("well_below_market_alerts_sent").insert({
        listing_id,
        alerted: false,
        reason: `Insufficient comps: ${compCount} (need ${MIN_COMPS})`,
        comp_count: compCount,
        thin_data: true,
      });
      return new Response(
        JSON.stringify({ success: true, alerted: false, reason: "insufficient_comps", comp_count: compCount }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!passesThreshold) {
      console.log(`Listing ${listing_id}: $${price} vs median $${medianSell} (${belowPct}% below) — does not meet 15% threshold`);
      // Record it anyway so we don't re-check
      await supabase.from("well_below_market_alerts_sent").insert({
        listing_id,
        alerted: false,
        reason: `Below threshold: ${belowPct}% (need 15%)`,
      });
      return new Response(
        JSON.stringify({ success: true, alerted: false, below_pct: belowPct }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Build WhatsApp message ───────────────────────────────────
    const kmStr = km ? `${(km / 1000).toFixed(0)}k` : "Unknown";
    const variantStr = variant || "";

    const lines = [
      `🟢 WELL BELOW MARKET — ${year || "?"} ${make} ${model} ${variantStr}`.trim(),
      `${kmStr} km`,
      ``,
      `Listed: $${Number(price).toLocaleString()}`,
    ];

    if (compCount > 0) {
      lines.push(`Your median sell: $${Number(medianSell).toLocaleString()} (${belowPct}% below)`);
    }

    lines.push(`Comparables: ${compCount} sales on record`);

    if (state) lines.push(`Location: ${state}`);
    if (listing_url) lines.push(`\n${listing_url}`);

    if (thinData) {
      lines.push(`\n⚠️ Only ${compCount} comparable sale${compCount !== 1 ? "s" : ""} — verify manually`);
    }

    const message = lines.join("\n");

    // ── Send WhatsApp via Twilio ─────────────────────────────────
    const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const TWILIO_FROM = Deno.env.get("TWILIO_WHATSAPP_FROM");
    const DAVE_WHATSAPP = Deno.env.get("DAVE_WHATSAPP_NUMBER");

    let whatsappSent = false;

    if (TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM && DAVE_WHATSAPP) {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
      const twilioBody = new URLSearchParams({
        From: `whatsapp:${TWILIO_FROM}`,
        To: `whatsapp:${DAVE_WHATSAPP}`,
        Body: message,
      });

      const twilioRes = await fetch(twilioUrl, {
        method: "POST",
        headers: {
          "Authorization": "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: twilioBody.toString(),
      });

      if (!twilioRes.ok) {
        console.error("WhatsApp send failed:", await twilioRes.text());
      } else {
        console.log("WhatsApp well-below-market alert sent to Dave");
        whatsappSent = true;
      }
    } else {
      console.warn("Twilio WhatsApp not configured — skipping WhatsApp alert");
    }

    // ── Also try Slack ───────────────────────────────────────────
    const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL");
    if (SLACK_WEBHOOK_URL) {
      try {
        await fetch(SLACK_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            blocks: [
              { type: "section", text: { type: "mrkdwn", text: message.replace(/\n/g, "\n") } },
            ],
          }),
        });
      } catch (e) {
        console.error("Slack alert error:", e);
      }
    }

    // ── Record dedup ─────────────────────────────────────────────
    await supabase.from("well_below_market_alerts_sent").insert({
      listing_id,
      alerted: true,
      median_sell_price: medianSell || null,
      below_pct: belowPct || null,
      comp_count: compCount,
      thin_data: thinData,
      whatsapp_sent: whatsappSent,
    });

    console.log(`Alert sent for ${listing_id}: $${price} vs median $${medianSell} (${belowPct}% below, ${compCount} comps)`);

    return new Response(
      JSON.stringify({ success: true, alerted: true, below_pct: belowPct, comp_count: compCount, thin_data: thinData }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("well-below-market-alert error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
