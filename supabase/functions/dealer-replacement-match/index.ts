// Dealer Replacement Match — scans live listings against dealer_replacement_fingerprints,
// inserts deduped alerts, and fires Telegram via auction-hunter-webhook.
// Runs twice daily (07:00 & 19:00 AEST = 21:00 & 09:00 UTC).
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

interface Fingerprint {
  id: string;
  account_id: string | null;
  dealer_name: string;
  make: string;
  model: string;
  variant: string | null;
  year_min: number | null;
  year_max: number | null;
  max_price: number;
  max_km: number;
  min_margin: number;
  min_margin_pct: number;
  expected_sale_price: number | null;
}

interface CandidateListing {
  source: "vehicle_listings" | "market_listings";
  id: string;
  make: string | null;
  model: string | null;
  variant: string | null;
  year: number | null;
  km: number | null;
  price: number | null;
  listing_url: string | null;
}

function pickPrice(r: any): number | null {
  const candidates = [r.sold_price, r.asking_price, r.guide_price, r.price, r.highest_bid, r.reserve];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n >= 1000) return n;
  }
  return null;
}

async function sendTelegram(html: string): Promise<{ ok: boolean; message_id?: string; error?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: html,
        parse_mode: "HTML",
        disable_web_page_preview: false,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.description || `HTTP ${res.status}` };
    }
    return { ok: true, message_id: String(data.result?.message_id ?? "") };
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
  const stats = {
    fingerprints: 0,
    candidates_scanned: 0,
    matches: 0,
    new_alerts: 0,
    telegram_sent: 0,
    telegram_failed: 0,
    errors: [] as string[],
  };

  try {
    const { data: fps, error: fpErr } = await supabase
      .from("dealer_replacement_fingerprints")
      .select("*")
      .eq("active", true);
    if (fpErr) throw fpErr;
    const fingerprints = (fps ?? []) as Fingerprint[];
    stats.fingerprints = fingerprints.length;

    for (const fp of fingerprints) {
      // Pull candidates from vehicle_listings (auction sources) AND market_listings (retail)
      const yearMin = fp.year_min ?? 2000;
      const yearMax = fp.year_max ?? 2100;

      const [vl, ml] = await Promise.all([
        supabase
          .from("vehicle_listings")
          .select("id, make, model, variant_raw, year, km, sold_price, asking_price, guide_price, reserve, highest_bid, listing_url")
          .ilike("make", fp.make)
          .ilike("model", `%${fp.model}%`)
          .gte("year", yearMin)
          .lte("year", yearMax)
          .lte("km", fp.max_km)
          .order("last_seen_at", { ascending: false })
          .limit(500),
        supabase
          .from("market_listings")
          .select("id, make, model, variant_raw, year, km, price, asking_price, listing_url, status")
          .ilike("make", fp.make)
          .ilike("model", `%${fp.model}%`)
          .gte("year", yearMin)
          .lte("year", yearMax)
          .lte("km", fp.max_km)
          .in("status", ["active", "listed", "relisted"])
          .order("last_seen_at", { ascending: false })
          .limit(500),
      ]);

      const candidates: CandidateListing[] = [];
      for (const r of vl.data ?? []) {
        const price = pickPrice(r);
        if (price == null) continue;
        candidates.push({
          source: "vehicle_listings",
          id: String(r.id),
          make: r.make, model: r.model, variant: r.variant_raw,
          year: r.year, km: r.km, price,
          listing_url: r.listing_url,
        });
      }
      for (const r of ml.data ?? []) {
        const price = pickPrice(r);
        if (price == null) continue;
        candidates.push({
          source: "market_listings",
          id: String(r.id),
          make: r.make, model: r.model, variant: r.variant_raw,
          year: r.year, km: r.km, price,
          listing_url: r.listing_url,
        });
      }
      stats.candidates_scanned += candidates.length;

      for (const c of candidates) {
        if (c.price! > fp.max_price) continue;
        if ((c.km ?? Infinity) > fp.max_km) continue;
        if (fp.variant && c.variant && !c.variant.toLowerCase().includes(fp.variant.toLowerCase())) continue;

        const expectedSale = fp.expected_sale_price ?? fp.max_price + fp.min_margin;
        const margin = expectedSale - c.price!;
        const marginPct = (margin / c.price!) * 100;

        if (margin < fp.min_margin) continue;
        if (marginPct < fp.min_margin_pct) continue;

        stats.matches++;

        // Insert (idempotent via unique constraint)
        const { data: inserted, error: insErr } = await supabase
          .from("dealer_replacement_alerts")
          .insert({
            fingerprint_id: fp.id,
            account_id: fp.account_id,
            dealer_name: fp.dealer_name,
            listing_source: c.source,
            listing_id: c.id,
            listing_url: c.listing_url,
            make: c.make, model: c.model, variant: c.variant,
            year: c.year, km: c.km, price: c.price,
            expected_sale_price: expectedSale,
            est_margin: Math.round(margin),
            est_margin_pct: Number(marginPct.toFixed(1)),
            match_reason: `≤${fmt$(fp.max_price)}, ≤${fmtKm(fp.max_km)}km, margin ${fmt$(margin)} (${marginPct.toFixed(1)}%)`,
          })
          .select("id")
          .maybeSingle();

        if (insErr) {
          // Unique violation = already alerted; skip
          if (!/duplicate key|unique/i.test(insErr.message)) {
            stats.errors.push(`insert: ${insErr.message}`);
          }
          continue;
        }
        if (!inserted) continue;
        stats.new_alerts++;

        const html =
          `🎯 <b>REPLACEMENT MATCH — ${fp.dealer_name}</b>\n` +
          `<b>${c.year ?? ""} ${c.make ?? ""} ${c.model ?? ""}${c.variant ? " " + c.variant : ""}</b>\n` +
          `Price: <b>${fmt$(c.price)}</b>  |  KM: ${fmtKm(c.km)}\n` +
          `Expected sale: ${fmt$(expectedSale)}  |  Est margin: <b>${fmt$(margin)}</b> (${marginPct.toFixed(1)}%)\n` +
          `Source: ${c.source.replace("_", " ")}\n` +
          (c.listing_url ? `<a href="${c.listing_url}">View listing</a>` : "");

        const tg = await sendTelegram(html);
        await supabase
          .from("dealer_replacement_alerts")
          .update({
            telegram_sent: tg.ok,
            telegram_message_id: tg.message_id ?? null,
            telegram_error: tg.ok ? null : tg.error ?? "unknown",
          })
          .eq("id", inserted.id);

        if (tg.ok) stats.telegram_sent++;
        else stats.telegram_failed++;
      }
    }

    await supabase.from("cron_audit_log").upsert(
      { cron_name: "dealer-replacement-match", run_date: today, success: true, result: stats },
      { onConflict: "cron_name,run_date" },
    );

    return new Response(JSON.stringify({ success: true, ...stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    await supabase.from("cron_audit_log").upsert(
      { cron_name: "dealer-replacement-match", run_date: today, success: false, error: msg, result: stats },
      { onConflict: "cron_name,run_date" },
    );
    return new Response(JSON.stringify({ success: false, error: msg, ...stats }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
