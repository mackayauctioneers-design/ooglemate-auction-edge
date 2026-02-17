import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const slackWebhook = Deno.env.get("SLACK_WEBHOOK_URL") || "";

    const body = await req.json().catch(() => ({}));
    const accountId = body.account_id || "mackay-traders";
    const topN = body.top_n || 20;

    // Pull all sales with profit data
    const { data: sales, error } = await sb
      .from("vehicle_sales_truth")
      .select("make, model, variant, year, sale_price, buy_price, profit_pct, sold_at, km")
      .eq("account_id", accountId)
      .gt("sale_price", 0)
      .gt("buy_price", 0);

    if (error) throw error;
    if (!sales || sales.length === 0) {
      return new Response(JSON.stringify({ error: "No sales data found", account_id: accountId }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    console.log(`[WINNERS] ${sales.length} sales records for ${accountId}`);

    // Extract drivetrain from description/variant
    function extractDrivetrain(text: string | null): string | null {
      if (!text) return null;
      const m = text.match(/\b(4x4|4WD|AWD|2WD|FWD|4x2|RWD)\b/i);
      if (!m) return null;
      const v = m[1].toUpperCase();
      if (v === "4X4" || v === "4WD") return "4WD";
      if (v === "AWD") return "AWD";
      if (v === "4X2" || v === "2WD" || v === "FWD" || v === "RWD") return "2WD";
      return v;
    }

    // Group by make + model + variant + drivetrain (normalised)
    const groups = new Map<string, {
      make: string; model: string; variant: string | null; drivetrain: string | null;
      profits: number[]; sale_prices: number[]; years: number[];
      sale_dates: string[]; kms: number[];
    }>();

    for (const s of sales) {
      if (!s.make || !s.model) continue;
      const profit = Number(s.sale_price) - Number(s.buy_price);
      if (isNaN(profit)) continue;

      const make = String(s.make).toUpperCase().trim();
      const model = String(s.model).toUpperCase().trim();
      const variant = s.variant ? String(s.variant).toUpperCase().trim() : null;
      const drivetrain = extractDrivetrain(s.variant) || extractDrivetrain(s.model) || (s as any).drive_type?.toUpperCase() || null;
      const key = `${make}|${model}|${variant || ""}|${drivetrain || ""}`;

      if (!groups.has(key)) {
        groups.set(key, { make, model, variant, drivetrain, profits: [], sale_prices: [], years: [], sale_dates: [], kms: [] });
      }
      const g = groups.get(key)!;
      g.profits.push(profit);
      g.sale_prices.push(Number(s.sale_price));
      if (s.year) g.years.push(Number(s.year));
      if (s.sold_at) g.sale_dates.push(s.sold_at);
      if (s.km && Number(s.km) > 0) g.kms.push(Number(s.km));
    }

    // Calculate stats and rank
    const ranked = Array.from(groups.values())
      .filter(g => g.profits.length >= 1) // at least 1 sale
      .map(g => {
        const totalProfit = g.profits.reduce((a, b) => a + b, 0);
        const avgProfit = totalProfit / g.profits.length;
        const years = g.years.length > 0 ? g.years : [2020];
        const lastSalePrice = g.sale_prices[g.sale_prices.length - 1];
        const lastSaleDate = g.sale_dates.length > 0
          ? g.sale_dates.sort().reverse()[0]
          : null;

        const avgKm = g.kms.length > 0 ? Math.round(g.kms.reduce((a, b) => a + b, 0) / g.kms.length) : null;
        const kmSorted = [...g.kms].sort((a, b) => a - b);
        const kmBandLow = kmSorted.length > 0 ? kmSorted[0] : null;
        const kmBandHigh = kmSorted.length > 0 ? kmSorted[kmSorted.length - 1] : null;

        return {
          make: g.make,
          model: g.model,
          variant: g.variant,
          drivetrain: g.drivetrain,
          total_profit: Math.round(totalProfit),
          avg_profit: Math.round(avgProfit),
          times_sold: g.profits.length,
          last_sale_price: Math.round(lastSalePrice),
          last_sale_date: lastSaleDate,
          year_min: Math.min(...years),
          year_max: Math.max(...years),
          avg_km: avgKm,
          km_band_low: kmBandLow,
          km_band_high: kmBandHigh,
        };
      })
      .sort((a, b) => b.total_profit - a.total_profit)
      .slice(0, topN);

    console.log(`[WINNERS] Top ${ranked.length} groups from ${groups.size} total`);

    // Upsert into winners_watchlist
    let upserted = 0;
    for (let i = 0; i < ranked.length; i++) {
      const w = ranked[i];
      const { error: uErr } = await sb.from("winners_watchlist").upsert({
        account_id: accountId,
        make: w.make,
        model: w.model,
        variant: w.variant,
        drivetrain: w.drivetrain,
        year_min: w.year_min,
        year_max: w.year_max,
        total_profit: w.total_profit,
        avg_profit: w.avg_profit,
        times_sold: w.times_sold,
        last_sale_price: w.last_sale_price,
        last_sale_date: w.last_sale_date,
        avg_km: w.avg_km,
        km_band_low: w.km_band_low,
        km_band_high: w.km_band_high,
        rank: i + 1,
        updated_at: new Date().toISOString(),
      }, { onConflict: "account_id,make,model,variant,drivetrain" });

      if (uErr) {
        console.error(`[WINNERS] Upsert error for ${w.make} ${w.model}:`, uErr.message);
      } else {
        upserted++;
      }
    }

    // Clean out old entries not in top N
    const keepKeys = ranked.map(w => `${w.make}|${w.model}|${w.variant || ""}|${w.drivetrain || ""}`);
    const { data: existing } = await sb.from("winners_watchlist")
      .select("id, make, model, variant, drivetrain")
      .eq("account_id", accountId);

    if (existing) {
      for (const e of existing) {
        const key = `${e.make}|${e.model}|${e.variant || ""}|${(e as any).drivetrain || ""}`;
        if (!keepKeys.includes(key)) {
          await sb.from("winners_watchlist").delete().eq("id", e.id);
        }
      }
    }

    // Slack notification
    if (slackWebhook && ranked.length > 0) {
      const top = ranked[0];
      const fmtMoney = (n: number) => "$" + Math.round(n).toLocaleString();
      try {
        await fetch(slackWebhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `📊 Winners Watchlist Updated\n\nTop winner: ${top.make} ${top.model} ${top.variant || ""}\nTotal profit: ${fmtMoney(top.total_profit)} from ${top.times_sold} sales\nAvg profit: ${fmtMoney(top.avg_profit)}\n\n${ranked.length} models on watchlist`,
          }),
        });
      } catch (_) { /* ignore */ }
    }

    // Audit
    await sb.from("cron_audit_log").insert({
      cron_name: "update-winners-watchlist",
      success: true,
      result: { upserted, total_groups: groups.size, top_n: ranked.length, account_id: accountId },
      run_date: new Date().toISOString().split("T")[0],
    });

    return new Response(JSON.stringify({
      success: true,
      account_id: accountId,
      upserted,
      total_groups: groups.size,
      top: ranked.slice(0, 10),
    }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[WINNERS] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
