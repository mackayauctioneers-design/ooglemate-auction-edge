import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SalesScope {
  totalUploaded: number;
  totalUsable: number;
}

/**
 * Returns the total number of uploaded sales rows vs. "usable" rows
 * (those with a sold_at date and identifiable make+model).
 */
export function useSalesScope(accountId: string | null) {
  return useQuery({
    queryKey: ["sales-scope", accountId],
    queryFn: async (): Promise<SalesScope> => {
      if (!accountId) return { totalUploaded: 0, totalUsable: 0 };

      // Total uploaded — every row in vehicle_sales_truth for this account
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

      return {
        totalUploaded: totalUploaded ?? 0,
        totalUsable: totalUsable ?? 0,
      };
    },
    enabled: !!accountId,
  });
}
