// Dealer Daily Report — morning Telegram digest of replacement alerts from last 24h, grouped by dealer.
// Schedule: 21:30 UTC = 07:30 AEST.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TELEGRAM_BOT_TOKEN = "8703630521:AAGSYZi99e9FwN_fx213Sf0C8vqZN5G1XiU";
const TELEGRAM_CHAT_ID = "8540945384";

const fmt$ = (n: number | null | undefined) =>
  n == null ? "?" : "$" + Math.round(n).toLocaleString("en-AU");
const fmtKm = (n: number | null | undefined) =>
  n == null ? "?" : Math.round(n / 1000) + "k";

async function sendTelegram(text: string) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data?.ok === true, error: data?.description ?? null };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  try {
    const { data, error } = await supabase
      .from("dealer_replacement_alerts")
      .select("dealer_name, make, model, variant, year, km, price, est_margin, est_margin_pct, listing_url, listing_source")
      .gte("created_at", since)
      .order("dealer_name")
      .order("est_margin", { ascending: false });
    if (error) throw error;

    const rows = data ?? [];
    if (rows.length === 0) {
      const tg = await sendTelegram(
        `🌅 <b>Dealer Replacement — Daily Report</b>\nNo new matches in the last 24h.`,
      );
      await supabase.from("cron_audit_log").upsert(
        { cron_name: "dealer-daily-report", run_date: today, success: true, result: { sent: tg.ok, count: 0 } },
        { onConflict: "cron_name,run_date" },
      );
      return new Response(JSON.stringify({ success: true, count: 0, telegram_sent: tg.ok }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const byDealer: Record<string, typeof rows> = {};
    for (const r of rows) (byDealer[r.dealer_name] ??= []).push(r);

    const lines: string[] = [`🌅 <b>Dealer Replacement — Daily Report</b>`, `${rows.length} match${rows.length === 1 ? "" : "es"} in last 24h\n`];
    for (const [dealer, drows] of Object.entries(byDealer)) {
      lines.push(`<b>— ${dealer} (${drows.length})</b>`);
      for (const r of drows.slice(0, 5)) {
        const title = `${r.year ?? ""} ${r.make ?? ""} ${r.model ?? ""}${r.variant ? " " + r.variant : ""}`.trim();
        const urlBit = r.listing_url ? ` · <a href="${r.listing_url}">link</a>` : "";
        lines.push(
          `• ${title} — ${fmt$(r.price)} / ${fmtKm(r.km)}km · margin <b>${fmt$(r.est_margin)}</b> (${Number(r.est_margin_pct ?? 0).toFixed(1)}%)${urlBit}`,
        );
      }
      if (drows.length > 5) lines.push(`  …and ${drows.length - 5} more`);
      lines.push("");
    }

    const tg = await sendTelegram(lines.join("\n"));
    await supabase.from("cron_audit_log").upsert(
      { cron_name: "dealer-daily-report", run_date: today, success: true, result: { sent: tg.ok, count: rows.length, error: tg.error } },
      { onConflict: "cron_name,run_date" },
    );

    return new Response(JSON.stringify({ success: true, count: rows.length, telegram_sent: tg.ok, error: tg.error }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    await supabase.from("cron_audit_log").upsert(
      { cron_name: "dealer-daily-report", run_date: today, success: false, error: msg },
      { onConflict: "cron_name,run_date" },
    );
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
