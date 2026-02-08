import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface UnexpectedWinner {
  make: string;
  model: string;
  variant: string | null;
  year: number | null;
  km: number | null;
  salePrice: number | null;
  daysToClear: number | null;
  profitPct: number | null;
  soldAt: string | null;
  /** How this sale compares to the dealer median */
  clearanceRatio: number | null; // < 1 means faster than median
  priceRatio: number | null; // > 1 means higher than median
  reasons: string[];
}

interface RawRow {
  make: string;
  model: string;
  variant: string | null;
  year: number | null;
  km: number | null;
  sale_price: number | null;
  days_to_clear: number | null;
  profit_pct: number | null;
  sold_at: string | null;
}

function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function useUnexpectedWinners(
  accountId: string | null,
  rangeMonths: number | null // null = all time
) {
  return useQuery({
    queryKey: ["unexpected-winners", accountId, rangeMonths],
    queryFn: async () => {
      if (!accountId) return [];

      let query = supabase
        .from("vehicle_sales_truth" as any)
        .select("make, model, variant, year, km, sale_price, days_to_clear, profit_pct, sold_at")
        .eq("account_id", accountId)
        .order("sold_at", { ascending: false });

      if (rangeMonths) {
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - rangeMonths);
        query = query.gte("sold_at", cutoff.toISOString().slice(0, 10));
      }

      const { data, error } = await query.limit(1000);
      if (error) throw error;
      const rows = (data || []) as unknown as RawRow[];

      if (rows.length < 5) return []; // not enough data to define "unexpected"

      // Step 1: Compute dealer-wide medians
      const allPrices = rows.filter((r) => r.sale_price).map((r) => r.sale_price!);
      const allDays = rows.filter((r) => r.days_to_clear != null).map((r) => r.days_to_clear!);
      const medianPrice = median(allPrices);
      const medianDays = median(allDays);

      // Step 2: Group by make+model to find frequency
      const groupCounts: Record<string, number> = {};
      rows.forEach((r) => {
        const key = `${r.make}|${r.model}`;
        groupCounts[key] = (groupCounts[key] || 0) + 1;
      });

      // Step 3: Identify top sellers (top N by volume) to exclude
      const topSellers = new Set(
        Object.entries(groupCounts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([key]) => key)
      );

      // Step 4: Find low-frequency rows with strong outcomes
      const winners: UnexpectedWinner[] = [];

      rows.forEach((r) => {
        const key = `${r.make}|${r.model}`;
        const count = groupCounts[key] || 0;

        // Must be low frequency (1-2 sales)
        if (count > 2) return;

        // Must not be a top seller
        if (topSellers.has(key)) return;

        const reasons: string[] = [];
        let clearanceRatio: number | null = null;
        let priceRatio: number | null = null;

        // Check clearance speed — must be notably faster than median
        if (r.days_to_clear != null && medianDays != null && medianDays > 0) {
          clearanceRatio = r.days_to_clear / medianDays;
          if (clearanceRatio <= 0.6) {
            reasons.push("Cleared significantly faster than your median");
          }
        }

        // Check sale price — must be notably higher than median
        if (r.sale_price != null && medianPrice != null && medianPrice > 0) {
          priceRatio = r.sale_price / medianPrice;
          if (priceRatio >= 1.3) {
            reasons.push("Realised price well above your median");
          }
        }

        // Check profit margin — if available and strong
        if (r.profit_pct != null && r.profit_pct > 0.15) {
          reasons.push(`${(r.profit_pct * 100).toFixed(0)}% realised margin`);
        }

        // Must have at least one strong reason
        if (reasons.length === 0) return;

        winners.push({
          make: r.make,
          model: r.model,
          variant: r.variant,
          year: r.year,
          km: r.km,
          salePrice: r.sale_price,
          daysToClear: r.days_to_clear,
          profitPct: r.profit_pct,
          soldAt: r.sold_at,
          clearanceRatio,
          priceRatio,
          reasons,
        });
      });

      // Sort: most reasons first, then by clearance ratio (fastest first)
      winners.sort((a, b) => {
        if (b.reasons.length !== a.reasons.length) return b.reasons.length - a.reasons.length;
        return (a.clearanceRatio ?? 999) - (b.clearanceRatio ?? 999);
      });

      return winners.slice(0, 8); // cap at 8 to keep it focused
    },
    enabled: !!accountId,
  });
}
