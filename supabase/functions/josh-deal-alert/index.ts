import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { year, make, model, variant, price, market_price, discount_pct, km, location, seller_type, score, listing_url } = body;

    const scoreLabel = score >= 5 ? "🔥 CALL NOW" : score >= 4 ? "HIGH" : "MEDIUM";
    const kmStr = km ? `${(km / 1000).toFixed(0)}k` : "Unknown";
    const discountStr = discount_pct ? `${Math.abs(discount_pct).toFixed(0)}%` : "?%";

    const message = [
      `🔥 *Carbitrage Deal Verified*`,
      ``,
      `*${year} ${make} ${model}${variant ? ` ${variant}` : ""}*`,
      `Price: $${Number(price).toLocaleString()}`,
      `Market: $${Number(market_price).toLocaleString()}`,
      `Discount: -${discountStr}`,
      ``,
      `KM: ${kmStr}`,
      `Location: ${location || "Unknown"}`,
      `Seller: ${seller_type || "Unknown"}`,
      ``,
      `Verified by Josh`,
      `Confidence: ${scoreLabel}`,
      ``,
      listing_url ? `<${listing_url}|View Listing>` : "",
    ].filter(Boolean).join("\n");

    // Try Slack first (most reliable)
    const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL");
    if (SLACK_WEBHOOK_URL) {
      const slackRes = await fetch(SLACK_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blocks: [
            { type: "section", text: { type: "mrkdwn", text: message } },
          ],
        }),
      });
      if (!slackRes.ok) {
        console.error("Slack send failed:", await slackRes.text());
      } else {
        console.log("Slack alert sent for verified deal");
      }
    }

    // WhatsApp via Twilio (if configured)
    const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const TWILIO_FROM = Deno.env.get("TWILIO_WHATSAPP_FROM");
    const DAVE_WHATSAPP = Deno.env.get("DAVE_WHATSAPP_NUMBER");

    if (TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM && DAVE_WHATSAPP) {
      const plainMessage = message.replace(/\*/g, "").replace(/<([^|]+)\|([^>]+)>/g, "$2: $1");
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
      const twilioBody = new URLSearchParams({
        From: `whatsapp:${TWILIO_FROM}`,
        To: `whatsapp:${DAVE_WHATSAPP}`,
        Body: plainMessage,
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
        console.log("WhatsApp alert sent to Dave");
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("josh-deal-alert error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
