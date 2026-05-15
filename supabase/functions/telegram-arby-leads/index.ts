// Telegram fan-out for @arbycarleads
// Posts WBM (and other high-priority) leads to the channel.
// Buy-box matches (Hilux / RAV4 / LandCruiser / Prado, year >= 2020) get a 🎯 flag.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUY_BOX_MODELS = ["hilux", "rav4", "landcruiser", "land cruiser", "prado"];
const BUY_BOX_MIN_YEAR = 2020;

interface LeadPayload {
  listing_id: string;
  make: string;
  model: string;
  variant?: string | null;
  year?: number | null;
  price?: number | null;
  km?: number | null;
  median_sell_price?: number | null;
  below_pct?: number | null;
  comp_count?: number | null;
  state?: string | null;
  location?: string | null;
  listing_url?: string | null;
  source_table?: string | null;
  reason?: string | null;
}

function isBuyBox(p: LeadPayload): boolean {
  const m = (p.model ?? "").toLowerCase();
  const yearOk = (p.year ?? 0) >= BUY_BOX_MIN_YEAR;
  return yearOk && BUY_BOX_MODELS.some((b) => m.includes(b));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const CHAT_ID = Deno.env.get("TELEGRAM_ARBY_CHAT_ID");
    if (!BOT_TOKEN || !CHAT_ID) {
      return new Response(JSON.stringify({ error: "telegram_not_configured" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const raw = await req.json();

    // Diagnostic mode: { diag: "@arbycarleads" } returns getChat info
    if (raw?.diag) {
      const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getChat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: raw.diag }),
      });
      const body = await r.text();
      // Also include what's currently configured (length only, not value)
      return new Response(JSON.stringify({
        getChat_status: r.status,
        getChat_body: body,
        configured_chat_id_length: CHAT_ID.length,
        configured_chat_id_starts_with: CHAT_ID.slice(0, 4),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const p: LeadPayload = raw;
    if (!p?.listing_id || !p?.make || !p?.model) {
      return new Response(JSON.stringify({ error: "missing_fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const buyBox = isBuyBox(p);
    const flag = buyBox ? "🎯 <b>BUY-BOX MATCH</b>\n" : "";
    const km = p.km ? `${(p.km / 1000).toFixed(0)}k km` : "km unknown";
    const price = p.price ? `$${Number(p.price).toLocaleString()}` : "price n/a";
    const median = p.median_sell_price
      ? `\n📊 Your median sell: $${Number(p.median_sell_price).toLocaleString()}` +
        (p.below_pct ? ` (${p.below_pct}% below)` : "")
      : "";
    const comps = p.comp_count != null ? `\n📦 Comps: ${p.comp_count}` : "";
    const loc = p.state || p.location ? `\n📍 ${esc(String(p.state ?? p.location))}` : "";
    const src = p.source_table ? `\n<i>src: ${esc(p.source_table)}</i>` : "";
    const url = p.listing_url ? `\n\n${p.listing_url}` : "";

    const headline = `${p.year ?? "?"} ${p.make} ${p.model} ${p.variant ?? ""}`.trim();
    const text =
      `${flag}🟢 <b>Well Below Market</b>\n` +
      `<b>${esc(headline)}</b>` +
      `\n${km} • ${price}${median}${comps}${loc}${src}${url}`;

    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: false,
      }),
    });


    const tgBody = await tgRes.text();
    if (!tgRes.ok) {
      console.error("telegram send failed", tgRes.status, tgBody);
      return new Response(JSON.stringify({ error: "telegram_failed", status: tgRes.status, body: tgBody }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, buy_box: buyBox }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("telegram-arby-leads error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
