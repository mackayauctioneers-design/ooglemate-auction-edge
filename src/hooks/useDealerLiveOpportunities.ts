import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// ============================================================================
// useDealerLiveOpportunities
// Live (realtime) feed of dealer_live_opportunities scoped to a single account.
// Rows are pushed by OpenClaw with the shape documented in why_json.
// ============================================================================

export interface LiveOpportunityWhy {
  reasons?: string[];
  proven_exit_value?: number;
  gap_dollars?: number;
  gap_pct?: number;
  sales_count?: number;
  fingerprint_label?: string;
  [key: string]: unknown;
}

export interface DealerLiveOpportunity {
  id: string;
  account_id: string | null;
  dealer_id: string | null;
  source: string;
  listing_id: string;
  make: string | null;
  model: string | null;
  variant: string | null;
  year: number | null;
  km: number | null;
  price: number | null;
  estimated_margin: number | null;
  freight_cost: number | null;
  fingerprint_id: string | null;
  fingerprint_match_score: number | null;
  confidence: string | null;
  auction_date: string | null;
  listing_url: string | null;
  status: string;
  why_json: LiveOpportunityWhy | null;
  created_at: string;
  updated_at: string;
}

export function useDealerLiveOpportunities(accountId: string | null | undefined) {
  const [opportunities, setOpportunities] = useState<DealerLiveOpportunity[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!accountId) {
      setOpportunities([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("dealer_live_opportunities")
      .select("*")
      .eq("account_id", accountId)
      .neq("status", "dismissed")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      console.error("Failed to load live opportunities:", error);
    }
    setOpportunities((data as DealerLiveOpportunity[]) || []);
    setLoading(false);
  }, [accountId]);

  useEffect(() => { fetch(); }, [fetch]);

  // Realtime: refetch on any change scoped to this account
  useEffect(() => {
    if (!accountId) return;
    const channel = supabase
      .channel(`dealer_live_opps_${accountId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "dealer_live_opportunities",
          filter: `account_id=eq.${accountId}`,
        },
        () => { fetch(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [accountId, fetch]);

  const updateStatus = useCallback(async (id: string, status: string) => {
    const { error } = await supabase
      .from("dealer_live_opportunities")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  }, []);

  return { opportunities, loading, refetch: fetch, updateStatus };
}
