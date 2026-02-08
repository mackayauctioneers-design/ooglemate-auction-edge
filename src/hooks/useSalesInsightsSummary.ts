import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ClearanceVelocity } from "@/hooks/useSalesInsights";
import type { UnexpectedWinner } from "@/hooks/useUnexpectedWinners";

export interface SummaryBullet {
  key: string;
  text: string;
}

interface YearBandAgg {
  yearBand: string;
  min: number;
  max: number;
  count: number;
  medianDays: number | null;
  medianProfit: number | null;
}

function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function buildYearBand(year: number): { label: string; min: number; max: number } {
  const bandStart = year - ((year - 2000) % 3);
  return { label: `${bandStart}–${bandStart + 2}`, min: bandStart, max: bandStart + 2 };
}

/**
 * Derives deterministic summary bullets from existing Sales Insights data.
 * Each bullet only appears when its conditions are met.
 * Minimum 2 bullets required to show the box; maximum 5.
 */
export function useSalesInsightsSummary(
  accountId: string | null,
  clearanceData: ClearanceVelocity[],
  unexpectedWinners: UnexpectedWinner[]
) {
  // Aggregate clearance data by make+model for core seller detection
  const modelAgg = useMemo(() => {
    const map: Record<string, { make: string; model: string; totalSales: number; totalProfit: number[]; totalDays: number[] }> = {};
    clearanceData.forEach((r) => {
      const key = `${r.make}|${r.model}`;
      if (!map[key]) map[key] = { make: r.make, model: r.model, totalSales: 0, totalProfit: [], totalDays: [] };
      map[key].totalSales += r.sales_count;
      if (r.median_profit_dollars != null) map[key].totalProfit.push(r.median_profit_dollars);
      if (r.median_days_to_clear != null) map[key].totalDays.push(r.median_days_to_clear);
    });
    return Object.values(map).sort((a, b) => b.totalSales - a.totalSales);
  }, [clearanceData]);

  const topModel = modelAgg[0] ?? null;

  // Fetch year-band data for the top model to detect generational differences
  const yearBandQuery = useQuery({
    queryKey: ["summary-year-bands", accountId, topModel?.make, topModel?.model],
    queryFn: async () => {
      if (!accountId || !topModel) return [] as YearBandAgg[];
      const { data, error } = await supabase
        .from("vehicle_sales_truth" as any)
        .select("year, days_to_clear, sale_price, buy_price")
        .eq("account_id", accountId)
        .eq("make", topModel.make)
        .eq("model", topModel.model)
        .order("year", { ascending: false })
        .limit(500);
      if (error) throw error;
      const rows = (data || []) as unknown as { year: number; days_to_clear: number | null; sale_price: number | null; buy_price: number | null }[];

      // Group into 3-year bands
      const bandMap: Record<string, { min: number; max: number; days: number[]; profits: number[]; count: number }> = {};
      rows.forEach((r) => {
        if (!r.year) return;
        const band = buildYearBand(r.year);
        if (!bandMap[band.label]) bandMap[band.label] = { min: band.min, max: band.max, days: [], profits: [], count: 0 };
        const b = bandMap[band.label];
        b.count++;
        if (r.days_to_clear != null) b.days.push(r.days_to_clear);
        if (r.sale_price != null && r.buy_price != null) b.profits.push(r.sale_price - r.buy_price);
      });

      return Object.entries(bandMap)
        .map(([label, b]) => ({
          yearBand: label,
          min: b.min,
          max: b.max,
          count: b.count,
          medianDays: median(b.days),
          medianProfit: median(b.profits),
        }))
        .filter((b) => b.count >= 2) // need at least 2 sales to be meaningful
        .sort((a, b) => a.min - b.min);
    },
    enabled: !!accountId && !!topModel,
  });

  // Generate bullets
  const bullets = useMemo(() => {
    const result: SummaryBullet[] = [];
    const totalSales = clearanceData.reduce((sum, r) => sum + r.sales_count, 0);
    if (totalSales < 5) return result; // not enough data

    // ── Bullet A: Core Sellers ──
    const topTwo = modelAgg.slice(0, 2);
    if (topTwo.length > 0) {
      const topSalesSum = topTwo.reduce((s, m) => s + m.totalSales, 0);
      const pct = Math.round((topSalesSum / totalSales) * 100);
      if (pct >= 20) {
        const names = topTwo.map((m) => `${m.make} ${m.model}`);
        const joined = names.length === 2 ? `${names[0]}s and ${names[1]}s` : `${names[0]}s`;
        result.push({
          key: "core-sellers",
          text: `You most consistently sell ${joined}`,
        });
      }
    }

    // ── Bullet B: Year/Series Differentiation ──
    const bands = yearBandQuery.data;
    if (bands && bands.length >= 2 && topModel) {
      // Compare earliest vs latest band
      const earliest = bands[0];
      const latest = bands[bands.length - 1];

      const hasClearanceDiff =
        earliest.medianDays != null &&
        latest.medianDays != null &&
        earliest.medianDays < latest.medianDays * 0.7;

      const hasProfitDiff =
        earliest.medianProfit != null &&
        latest.medianProfit != null &&
        latest.medianProfit < earliest.medianProfit * 0.7;

      if (hasClearanceDiff) {
        result.push({
          key: "year-faster",
          text: `${earliest.yearBand} ${topModel.model}s have shown faster clearance than later models`,
        });
      }
      if (hasProfitDiff) {
        result.push({
          key: "year-margin",
          text: `Later-model ${topModel.model}s have shown longer clearance times and lower realised margins`,
        });
      }
    }

    // ── Bullet C: Unexpected Winners ──
    if (unexpectedWinners.length >= 1) {
      result.push({
        key: "unexpected-winners",
        text: "A small number of low-frequency vehicles delivered strong outcomes, despite not being core stock",
      });
    }

    // ── Bullet D: Capital Efficiency ──
    // Check if fast-clearing vehicles with decent margin outperform slower, higher-dollar deals
    const withBoth = clearanceData.filter(
      (r) => r.median_days_to_clear != null && r.median_profit_dollars != null
    );
    if (withBoth.length >= 4) {
      const sortedByEfficiency = [...withBoth].sort((a, b) => {
        const effA = (a.median_profit_dollars ?? 0) / Math.max(a.median_days_to_clear ?? 1, 1);
        const effB = (b.median_profit_dollars ?? 0) / Math.max(b.median_days_to_clear ?? 1, 1);
        return effB - effA;
      });
      const topQuarter = sortedByEfficiency.slice(0, Math.ceil(sortedByEfficiency.length / 4));
      const avgDaysTop = topQuarter.reduce((s, r) => s + (r.median_days_to_clear ?? 0), 0) / topQuarter.length;
      const overallAvgDays = withBoth.reduce((s, r) => s + (r.median_days_to_clear ?? 0), 0) / withBoth.length;

      if (avgDaysTop < overallAvgDays * 0.8) {
        result.push({
          key: "capital-efficiency",
          text: "Your strongest outcomes combine reasonable margin with fast capital turnover",
        });
      }
    }

    return result.slice(0, 5);
  }, [clearanceData, modelAgg, yearBandQuery.data, topModel, unexpectedWinners]);

  return {
    bullets,
    isLoading: yearBandQuery.isLoading,
    showSummary: bullets.length >= 2,
  };
}
