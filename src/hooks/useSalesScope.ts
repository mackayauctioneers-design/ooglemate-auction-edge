import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SalesScope {
  totalUploaded: number;
  totalUsable: number;
  totalFullOutcome: number;
  totalWithClearance: number;
  totalMissingBuyPrice: number;
}

/**
 * Returns tiered counts of sales data for trust-building presentation:
 * - totalUploaded: every row in vehicle_sales_truth
 * - totalUsable: rows with sold_at + make + model
 * - totalFullOutcome: rows with buy_price + sale_price + days_to_clear
 */
export function useSalesScope(accountId: string | null) {
  return useQuery({
    queryKey: ["sales-scope", accountId],
    queryFn: async (): Promise<SalesScope> => {
      if (!accountId) return { totalUploaded: 0, totalUsable: 0, totalFullOutcome: 0, totalWithClearance: 0, totalMissingBuyPrice: 0 };

      // Total uploaded — every row for this account
      const { count: totalUploaded, error: err1 } = await supabase
        .from("vehicle_sales_truth" as any)
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId);

      if (err1) throw err1;

      // Total usable — rows with sold_at, make, and model present
      const { count: totalUsable, error: err2 } = await supabase
        .from("vehicle_sales_truth" as any)
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId)
        .not("sold_at", "is", null)
        .not("make", "is", null)
        .not("model", "is", null);

      if (err2) throw err2;

      // Full outcome — rows with buy_price + sale_price (profit analysis)
      const { count: totalFullOutcome, error: err3 } = await supabase
        .from("vehicle_sales_truth" as any)
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId)
        .not("buy_price", "is", null)
        .not("sale_price", "is", null);

      if (err3) throw err3;

      // With clearance — rows that also have days_to_clear
      const { count: totalWithClearance, error: err4 } = await supabase
        .from("vehicle_sales_truth" as any)
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId)
        .not("days_to_clear", "is", null);

      if (err4) throw err4;

      // Missing buy price — usable rows without buy_price
      const missingBuy = (totalUsable ?? 0) - (totalFullOutcome ?? 0);

      return {
        totalUploaded: totalUploaded ?? 0,
        totalUsable: totalUsable ?? 0,
        totalFullOutcome: totalFullOutcome ?? 0,
        totalWithClearance: totalWithClearance ?? 0,
        totalMissingBuyPrice: missingBuy > 0 ? missingBuy : 0,
      };
    },
    enabled: !!accountId,
  });
}
