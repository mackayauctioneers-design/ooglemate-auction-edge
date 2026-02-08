import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ClearanceVelocity {
  account_id: string;
  make: string;
  model: string;
  variant: string | null;
  sales_count: number;
  avg_days_to_clear: number | null;
  median_days_to_clear: number | null;
  pct_under_30: number | null;
  pct_under_60: number | null;
  pct_under_90: number | null;
  last_sold_at: string | null;
  median_profit_pct: number | null;
}

export interface VolumeTrend {
  account_id: string;
  make: string;
  model: string;
  month: string;
  sales_count: number;
}

export interface VariationPerformance {
  account_id: string;
  make: string;
  model: string;
  variant: string | null;
  transmission: string | null;
  fuel_type: string | null;
  body_type: string | null;
  sales_count: number;
  median_km: number | null;
  median_sale_price: number | null;
  median_days_to_clear: number | null;
  median_profit_pct: number | null;
}

export function useClearanceVelocity(accountId: string | null) {
  return useQuery({
    queryKey: ["sales-clearance-velocity", accountId],
    queryFn: async () => {
      if (!accountId) return [];
      const { data, error } = await supabase
        .from("sales_clearance_velocity" as any)
        .select("*")
        .eq("account_id", accountId)
        .order("sales_count", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as unknown as ClearanceVelocity[];
    },
    enabled: !!accountId,
  });
}

export function useVolumeTrends(accountId: string | null, months = 12) {
  return useQuery({
    queryKey: ["sales-volume-trends", accountId, months],
    queryFn: async () => {
      if (!accountId) return [];
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - months);
      const { data, error } = await supabase
        .from("sales_volume_trends" as any)
        .select("*")
        .eq("account_id", accountId)
        .gte("month", cutoff.toISOString().slice(0, 10))
        .order("month", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as VolumeTrend[];
    },
    enabled: !!accountId,
  });
}

export function useVariationPerformance(accountId: string | null) {
  return useQuery({
    queryKey: ["sales-variation-performance", accountId],
    queryFn: async () => {
      if (!accountId) return [];
      const { data, error } = await supabase
        .from("sales_variation_performance" as any)
        .select("*")
        .eq("account_id", accountId)
        .order("sales_count", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data || []) as unknown as VariationPerformance[];
    },
    enabled: !!accountId,
  });
}
