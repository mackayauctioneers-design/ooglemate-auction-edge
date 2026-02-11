import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// build-sales-targets v2
// Now creates TWO fingerprint types:
//   - "core"    → 3+ profitable sales, high confidence
//   - "outcome" → 1-2 profitable sales, low confidence, still eligible
// Profit is the eligibility signal. Frequency is the confidence signal.
// ============================================================================

interface SaleRow {
  make: string;
  model: string;
  variant: string | null;
  body_type: string | null;
  fuel_type: string | null;
  transmission: string | null;
  drive_type: string | null;
  sale_price: number | null;
  buy_price: number | null;
  profit_pct: number | null;
  days_to_clear: number | null;
  km: number | null;
  sold_at: string | null;
}

interface ShapeKey {
  make: string;
  model: string;
  variant: string | null;
  body_type: string | null;
  fuel_type: string | null;
  transmission: string | null;
  drive_type: string | null;
  engine_code: string | null;
}

// ── Engine code extractor (deterministic, not AI) ──
function extractEngineCode(variant: string | null): string | null {
  if (!variant) return null;
  const v = variant.toLowerCase();

  // Diesel engine codes (VW Amarok, etc.)
  const tdiMatch = v.match(/tdi\s*(\d{3})/i);
  if (tdiMatch) return `TDI${tdiMatch[1]}`;

  // Turbo diesel generic
  if (/\btdi\b/i.test(v)) return "TDI";

  // Common engine displacement patterns
  const enginePatterns: [RegExp, string][] = [
    [/\bv6\b/i, "V6"],
    [/\bv8\b/i, "V8"],
    [/\bi4\b/i, "I4"],
    [/\bi6\b/i, "I6"],
    [/\b2\.0[lt]?\b/i, "2.0L"],
    [/\b2\.4[lt]?\b/i, "2.4L"],
    [/\b2\.5[lt]?\b/i, "2.5L"],
    [/\b2\.8[lt]?\b/i, "2.8L"],
    [/\b3\.0[lt]?\b/i, "3.0L"],
    [/\b3\.5[lt]?\b/i, "3.5L"],
    [/\b4\.0[lt]?\b/i, "4.0L"],
    [/\b5\.0[lt]?\b/i, "5.0L"],
    [/\bbiturbo\b/i, "BITURBO"],
    [/\btwin.?turbo\b/i, "TWINTURBO"],
    [/\bturbo\b/i, "TURBO"],
    [/\bhybrid\b/i, "HYBRID"],
    [/\bev\b/i, "EV"],
    [/\bphev\b/i, "PHEV"],
  ];

  for (const [pattern, code] of enginePatterns) {
    if (pattern.test(v)) return code;
  }

  return null;
}

function shapeKeyStr(s: ShapeKey): string {
  return [
    s.make, s.model,
    s.engine_code ?? "", s.variant ?? "", s.body_type ?? "",
    s.fuel_type ?? "", s.transmission ?? "", s.drive_type ?? "",
  ].join("|").toLowerCase();
}

function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function medianDecimal(arr: number[]): number | null {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const val = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(val * 10000) / 10000;
}

function avg(arr: number[]): number | null {
  if (!arr.length) return null;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

function computeScore(shape: {
  sales_count: number;
  median_days_to_clear: number | null;
  median_profit_pct: number | null;
  loss_rate: number | null;
  days_to_clear_values: number[];
  dealer_median_profit_pct: number | null;
  fingerprint_type: "core" | "outcome";
}): { score: number; reasons: Record<string, any> } {
  let score = 0;
  const reasons: Record<string, any> = {};

  if (shape.fingerprint_type === "outcome") {
    // Outcome fingerprints: simplified scoring
    // Base: profitable outcome exists (+20)
    if (shape.median_profit_pct !== null && shape.median_profit_pct > 0) {
      score += 20;
      reasons.outcome_signal = { pts: 20, note: `Profitable outcome (${(shape.median_profit_pct * 100).toFixed(1)}% margin)` };
    }

    // Velocity bonus for outcomes
    if (shape.median_days_to_clear !== null) {
      if (shape.median_days_to_clear <= 21) {
        score += 15; reasons.velocity = { pts: 15, note: "≤21d clear" };
      } else if (shape.median_days_to_clear <= 45) {
        score += 10; reasons.velocity = { pts: 10, note: "≤45d clear" };
      } else {
        score += 3; reasons.velocity = { pts: 3, note: ">45d clear" };
      }
    }

    // Margin quality for outcomes
    if (shape.median_profit_pct !== null) {
      if (shape.median_profit_pct > 0.15) {
        score += 10; reasons.margin_quality = { pts: 10, note: "Strong margin" };
      } else if (shape.median_profit_pct > 0.05) {
        score += 5; reasons.margin_quality = { pts: 5, note: "Decent margin" };
      }
    }

    return { score: Math.max(0, Math.min(score, 50)), reasons };
  }

  // Core fingerprints: full scoring (unchanged)
  // Repeatability (0–40)
  if (shape.sales_count >= 10) {
    score += 40; reasons.repeatability = { pts: 40, note: "10+ sales" };
  } else if (shape.sales_count >= 5) {
    score += 25; reasons.repeatability = { pts: 25, note: "5+ sales" };
  } else if (shape.sales_count >= 3) {
    score += 15; reasons.repeatability = { pts: 15, note: "3+ sales" };
  }

  // Velocity (0–25)
  if (shape.median_days_to_clear !== null) {
    if (shape.median_days_to_clear <= 21) {
      score += 25; reasons.velocity = { pts: 25, note: "≤21d median clear" };
    } else if (shape.median_days_to_clear <= 45) {
      score += 15; reasons.velocity = { pts: 15, note: "≤45d median clear" };
    } else {
      score += 5; reasons.velocity = { pts: 5, note: ">45d median clear" };
    }
  }

  // Profitability via profit_pct (0–20)
  if (shape.median_profit_pct !== null) {
    if (shape.median_profit_pct > 0.15) {
      score += 20; reasons.profitability = { pts: 20, note: `${(shape.median_profit_pct * 100).toFixed(1)}% median margin` };
    } else if (shape.median_profit_pct > 0.05) {
      score += 12; reasons.profitability = { pts: 12, note: `${(shape.median_profit_pct * 100).toFixed(1)}% median margin` };
    } else if (shape.median_profit_pct > 0) {
      score += 5; reasons.profitability = { pts: 5, note: `${(shape.median_profit_pct * 100).toFixed(1)}% median margin — thin` };
    }
  }

  // Consistency (0–15)
  if (shape.days_to_clear_values.length >= 3) {
    const m = avg(shape.days_to_clear_values)!;
    const variance = avg(shape.days_to_clear_values.map(v => Math.abs(v - m)))!;
    if (variance <= 10) {
      score += 15; reasons.consistency = { pts: 15, note: "low variance" };
    } else if (variance <= 25) {
      score += 8; reasons.consistency = { pts: 8, note: "medium variance" };
    }
  }

  // Profit % bonus — above dealer median (0–10)
  if (
    shape.sales_count >= 3 &&
    shape.median_profit_pct !== null &&
    shape.dealer_median_profit_pct !== null &&
    shape.median_profit_pct > shape.dealer_median_profit_pct &&
    shape.median_days_to_clear !== null &&
    shape.median_days_to_clear <= 60
  ) {
    score += 10;
    reasons.profit_bonus = { pts: 10, note: "margin above dealer median with reasonable clearance" };
  }

  // Loss protection
  if (
    shape.loss_rate !== null &&
    shape.loss_rate > 50 &&
    shape.median_days_to_clear !== null &&
    shape.median_days_to_clear > 45
  ) {
    const penalty = -15;
    score += penalty;
    reasons.loss_protection = { pts: penalty, note: `${shape.loss_rate.toFixed(0)}% loss rate with ${shape.median_days_to_clear}d clearance` };
  }

  return { score: Math.max(0, Math.min(score, 110)), reasons };
}

function countSpecFields(key: ShapeKey): number {
  let count = 0;
  if (key.engine_code) count++;
  if (key.variant) count++;
  if (key.body_type) count++;
  if (key.fuel_type) count++;
  if (key.transmission) count++;
  if (key.drive_type) count++;
  return count;
}

function determineConfidence(salesCount: number, fingerType: "core" | "outcome", specCompleteness: number): "low" | "medium" | "high" {
  if (fingerType === "outcome") return "low";
  if (salesCount <= 2) return "low";
  // HIGH requires both volume AND spec richness
  if (salesCount >= 5 && specCompleteness >= 4) return "high";
  if (specCompleteness < 3) return "medium"; // hard cap: incomplete specs = max MEDIUM
  if (salesCount >= 3) return "medium";
  return "low";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { account_id } = await req.json();
    if (!account_id) {
      return new Response(JSON.stringify({ error: "account_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[build-sales-targets] v2 starting for account ${account_id}`);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Fetch all sales truth
    const { data: sales, error: salesErr } = await supabase
      .from("vehicle_sales_truth")
      .select("make, model, variant, body_type, fuel_type, transmission, drive_type, sale_price, buy_price, profit_pct, days_to_clear, km, sold_at")
      .eq("account_id", account_id);

    if (salesErr) throw salesErr;
    if (!sales?.length) {
      return new Response(JSON.stringify({ candidates_built: 0, outcome_candidates_built: 0, message: "No sales truth data found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[build-sales-targets] Found ${sales.length} sales records`);

    // Dealer-wide median profit %
    const allProfitPcts = (sales as SaleRow[])
      .map(r => r.profit_pct)
      .filter((v): v is number => v !== null);
    const dealerMedianProfitPct = medianDecimal(allProfitPcts);

    // 2. Group into shapes
    const shapes = new Map<string, { key: ShapeKey; rows: SaleRow[] }>();
    for (const row of sales as SaleRow[]) {
      if (!row.make || !row.model) continue;
      const engineCode = extractEngineCode(row.variant);
      const key: ShapeKey = {
        make: row.make.trim().toUpperCase(),
        model: row.model.trim().toUpperCase(),
        variant: row.variant?.trim() || null,
        body_type: row.body_type?.trim() || null,
        fuel_type: row.fuel_type?.trim() || null,
        transmission: row.transmission?.trim() || null,
        drive_type: row.drive_type?.trim() || null,
        engine_code: engineCode,
      };
      const k = shapeKeyStr(key);
      if (!shapes.has(k)) shapes.set(k, { key, rows: [] });
      shapes.get(k)!.rows.push(row);
    }

    // 3. Build candidates for ALL shapes (core >= 3 sales, outcome = 1-2 profitable sales)
    const candidates: any[] = [];
    let coreCount = 0;
    let outcomeCount = 0;

    for (const [, shape] of shapes) {
      const profitableRows = shape.rows.filter(r =>
        r.profit_pct !== null && r.profit_pct > 0
      );

      // Determine fingerprint type
      const isCore = shape.rows.length >= 3;
      const isOutcome = !isCore && profitableRows.length > 0;

      if (!isCore && !isOutcome) continue; // No profitable sales & < 3 total = skip

      const fingerType = isCore ? "core" : "outcome";
      const dtcValues = shape.rows.map(r => r.days_to_clear).filter((v): v is number => v !== null);
      const priceValues = shape.rows.map(r => r.sale_price).filter((v): v is number => v !== null);
      const kmValues = shape.rows.map(r => r.km).filter((v): v is number => v !== null);
      const profitPctValues = shape.rows.map(r => r.profit_pct).filter((v): v is number => v !== null);

      const medianDtc = median(dtcValues);
      const avgDtc = avg(dtcValues);
      const medianProfitPct = medianDecimal(profitPctValues);
      const pctUnder30 = dtcValues.length ? Math.round(dtcValues.filter(v => v <= 30).length / dtcValues.length * 100) : null;
      const pctUnder60 = dtcValues.length ? Math.round(dtcValues.filter(v => v <= 60).length / dtcValues.length * 100) : null;

      const lossRate = profitPctValues.length
        ? Math.round(profitPctValues.filter(v => v < 0).length / profitPctValues.length * 100)
        : null;
      const worstCaseProfitPct = profitPctValues.length
        ? Math.min(...profitPctValues)
        : null;

      const profitPerDayValues = shape.rows
        .filter(r => r.profit_pct !== null && r.sale_price !== null && r.days_to_clear !== null && r.days_to_clear > 0)
        .map(r => ((r.sale_price! - (r.buy_price ?? 0)) / r.days_to_clear!));
      const medianProfitPerDay = median(profitPerDayValues);

      const profitDollarValues = shape.rows
        .filter(r => r.buy_price !== null && r.sale_price !== null)
        .map(r => r.sale_price! - r.buy_price!);
      const medianProfit = median(profitDollarValues);

      const soldDates = shape.rows.map(r => r.sold_at).filter(Boolean).sort().reverse();

      const { score, reasons } = computeScore({
        sales_count: shape.rows.length,
        median_days_to_clear: medianDtc,
        median_profit_pct: medianProfitPct,
        loss_rate: lossRate,
        days_to_clear_values: dtcValues,
        dealer_median_profit_pct: dealerMedianProfitPct,
        fingerprint_type: fingerType,
      });

      const specCompleteness = countSpecFields(shape.key);
      let confidenceLevel = determineConfidence(shape.rows.length, fingerType, specCompleteness);

      // Profit plausibility guard: median_profit > 35% of median_sale_price → downgrade
      const medianSalePrice = median(priceValues);
      if (medianProfit !== null && medianSalePrice !== null && medianSalePrice > 0) {
        if (medianProfit > medianSalePrice * 0.35) {
          if (confidenceLevel === "high") confidenceLevel = "medium";
        }
      }

      if (fingerType === "core") coreCount++;
      else outcomeCount++;

      candidates.push({
        account_id,
        make: shape.key.make,
        model: shape.key.model,
        variant: shape.key.variant,
        body_type: shape.key.body_type,
        fuel_type: shape.key.fuel_type,
        transmission: shape.key.transmission,
        drive_type: shape.key.drive_type,
        engine_code: shape.key.engine_code,
        sales_count: shape.rows.length,
        median_days_to_clear: medianDtc,
        avg_days_to_clear: avgDtc,
        pct_under_30: pctUnder30,
        pct_under_60: pctUnder60,
        median_sale_price: medianSalePrice,
        median_profit: medianProfit,
        median_profit_pct: medianProfitPct,
        loss_rate: lossRate,
        worst_case_profit_pct: worstCaseProfitPct !== null ? Math.round(worstCaseProfitPct * 10000) / 10000 : null,
        median_profit_per_day: medianProfitPerDay,
        median_km: median(kmValues),
        target_score: score,
        score_reasons: reasons,
        last_sold_at: soldDates[0] || null,
        status: "candidate",
        fingerprint_type: fingerType,
        confidence_level: confidenceLevel,
        outcome_verified: profitableRows.length > 0,
        spec_completeness: specCompleteness,
      });
    }

    console.log(`[build-sales-targets] ${coreCount} core, ${outcomeCount} outcome candidates`);

    // 4. Merge into sales_target_candidates (preserve manual statuses)
    if (candidates.length) {
      const { data: existing } = await supabase
        .from("sales_target_candidates")
        .select("id, make, model, variant, transmission, fuel_type, body_type, drive_type, engine_code, status, fingerprint_type")
        .eq("account_id", account_id);

      const shapeKey = (r: any) =>
        [r.make, r.model, r.engine_code ?? "", r.variant ?? "", r.transmission ?? "",
         r.fuel_type ?? "", r.body_type ?? "", r.drive_type ?? ""]
          .join("|").toLowerCase();

      const existingMap = new Map<string, { id: string; status: string }>();
      for (const e of existing || []) {
        existingMap.set(shapeKey(e), { id: e.id, status: e.status });
      }

      const toInsert: any[] = [];
      const toUpdate: { id: string; metrics: any }[] = [];

      for (const c of candidates) {
        const k = shapeKey(c);
        const match = existingMap.get(k);

        if (match) {
          // Preserve manual operator statuses
          const preserveStatuses = ["active", "paused", "retired"];
          const newStatus = preserveStatuses.includes(match.status) ? undefined : c.status;

          toUpdate.push({
            id: match.id,
            metrics: {
              sales_count: c.sales_count,
              median_days_to_clear: c.median_days_to_clear,
              avg_days_to_clear: c.avg_days_to_clear,
              pct_under_30: c.pct_under_30,
              pct_under_60: c.pct_under_60,
              median_sale_price: c.median_sale_price,
              median_profit: c.median_profit,
              median_profit_pct: c.median_profit_pct,
              loss_rate: c.loss_rate,
              worst_case_profit_pct: c.worst_case_profit_pct,
              median_profit_per_day: c.median_profit_per_day,
              median_km: c.median_km,
              target_score: c.target_score,
              score_reasons: c.score_reasons,
              last_sold_at: c.last_sold_at,
              fingerprint_type: c.fingerprint_type,
              confidence_level: c.confidence_level,
              outcome_verified: c.outcome_verified,
              engine_code: c.engine_code,
              ...(newStatus ? { status: newStatus } : {}),
            },
          });
        } else {
          toInsert.push(c);
        }
      }

      if (toInsert.length) {
        // Insert new candidates; handle any remaining duplicates gracefully
        for (const record of toInsert) {
          const { error: insErr } = await supabase
            .from("sales_target_candidates")
            .insert(record);
          if (insErr) {
            if (insErr.code === "23505") {
              // Duplicate shape — update metrics instead
              console.log(`[build-sales-targets] Duplicate detected for ${record.make} ${record.model} ${record.variant ?? ""} — updating instead`);
              const sk = shapeKey(record);
              const match = existingMap.get(sk);
              if (match) {
                const { status: _s, account_id: _a, ...metrics } = record;
                await supabase.from("sales_target_candidates").update(metrics).eq("id", match.id);
              }
            } else {
              console.error("[build-sales-targets] Insert error:", insErr);
              throw insErr;
            }
          }
        }
      }

      for (const u of toUpdate) {
        await supabase
          .from("sales_target_candidates")
          .update(u.metrics)
          .eq("id", u.id);
      }

      console.log(`[build-sales-targets] Inserted ${toInsert.length} new, updated ${toUpdate.length} existing`);
    }

    // 5. Return summary
    const top10 = candidates
      .sort((a, b) => b.target_score - a.target_score)
      .slice(0, 10)
      .map(c => ({
        make: c.make,
        model: c.model,
        variant: c.variant,
        sales_count: c.sales_count,
        target_score: c.target_score,
        fingerprint_type: c.fingerprint_type,
        confidence_level: c.confidence_level,
        median_days_to_clear: c.median_days_to_clear,
        median_profit_pct: c.median_profit_pct,
        loss_rate: c.loss_rate,
      }));

    console.log(`[build-sales-targets] Done. ${coreCount} core + ${outcomeCount} outcome = ${candidates.length} total.`);

    return new Response(JSON.stringify({
      candidates_built: coreCount,
      outcome_candidates_built: outcomeCount,
      total_candidates: candidates.length,
      total_sales_analysed: sales.length,
      dealer_median_profit_pct: dealerMedianProfitPct,
      top_10: top10,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[build-sales-targets] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
