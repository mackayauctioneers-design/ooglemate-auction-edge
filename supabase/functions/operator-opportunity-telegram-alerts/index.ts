// operator-opportunity-telegram-alerts
// Polls operator_opportunities and pushes new actionable matches to a Telegram chat
// via the Telegram Bot API. Stamps telegram_sent_at to prevent re-sends.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TIERS = ["CODE_RED", "HIGH", "BUY"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  // Hardcoded "Carbitrage Alerts" group chat. The secret slot keeps getting
  // confused with the bot token, so we pin the known-good chat id here.
  const chatId: number = -5169206415;

  if (!botToken) {
    return json({ error: "missing TELEGRAM_BOT_TOKEN" }, 500);
  }

  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: rows, error } = await sb
    .from("operator_opportunities")
    .select("id, listing_id, listing_source, source_url, make, model, variant, year, km, asking_price, best_account_name, best_expected_margin, best_under_buy, anchor_sale_buy_price, anchor_sale_sell_price, anchor_sale_sold_at, retail_median, tier, created_at")
    .in("tier", TIERS)
    .eq("status", "new")
    .is("telegram_sent_at", null)
    .gte("created_at", since)
    .order("best_expected_margin", { ascending: false })
    .limit(25);

  if (error) return json({ error: error.message }, 500);
  if (!rows?.length) return json({ ok: true, sent: 0 });

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const r of rows) {
    const text = formatMessage(r);
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: false,
        }),
      });
      const j = await res.json().catch(() => ({}));
      const ok = res.ok && j?.ok;
      if (ok) {
        await sb.from("operator_opportunities")
          .update({ telegram_sent_at: new Date().toISOString() })
          .eq("id", r.id);
        results.push({ id: r.id, ok: true });
      } else {
        results.push({ id: r.id, ok: false, error: j?.description || `HTTP ${res.status}` });
      }
    } catch (e) {
      results.push({ id: r.id, ok: false, error: String((e as Error).message ?? e) });
    }
  }

  return json({ ok: true, sent: results.filter(r => r.ok).length, total: rows.length, results });
});

function formatMessage(r: any): string {
  const tierEmoji: Record<string, string> = { CODE_RED: "🚨", HIGH: "🔥", BUY: "✅" };
  const emoji = tierEmoji[r.tier] ?? "•";
  const title = `${r.year ?? ""} ${r.make ?? ""} ${r.model ?? ""} ${r.variant ?? ""}`.trim();
  const km = r.km ? `${Math.round(r.km / 1000)}k km` : "km unknown";
  const ask = fmt(r.asking_price);
  const margin = fmt(r.best_expected_margin);
  const under = fmt(r.best_under_buy);
  const anchor = r.anchor_sale_buy_price
    ? `\nAnchor sale: bought ${fmt(r.anchor_sale_buy_price)} → sold ${fmt(r.anchor_sale_sell_price)}${r.anchor_sale_sold_at ? ` (${new Date(r.anchor_sale_sold_at).toLocaleDateString()})` : ""}`
    : "";
  const retail = r.retail_median ? `\nRetail median: ${fmt(r.retail_median)}` : "";
  const dealer = r.best_account_name ? `\nBest fit: <b>${escape(r.best_account_name)}</b>` : "";
  const src = r.source_url ? `\n${r.source_url}` : "";
  return `${emoji} <b>${escape(r.tier)}</b> · ${escape(title)} · ${km}\nAsk: <b>${ask}</b> · Margin: <b>${margin}</b> · Under buy: <b>${under}</b>${anchor}${retail}${dealer}\nSource: ${escape(r.listing_source ?? "")}${src}`;
}

function fmt(n: any): string {
  if (n == null || isNaN(Number(n))) return "—";
  return `$${Math.round(Number(n)).toLocaleString()}`;
}
function escape(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
