// operator-opportunity-telegram-alerts
// Polls operator_opportunities and pushes new actionable matches to a Telegram chat
// via the Lovable connector gateway. Stamps telegram_sent_at to prevent re-sends.
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
  const chatId = Deno.env.get("OPERATOR_TELEGRAM_CHAT_ID");

  if (!botToken || !chatId) {
    return json({ error: "missing TELEGRAM_BOT_TOKEN / OPERATOR_TELEGRAM_CHAT_ID" }, 500);
  }
...
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
