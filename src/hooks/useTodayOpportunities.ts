import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

// ============================================================================
// TODAY'S OPPORTUNITIES HOOK
// Fetches dealer-relevant data for the default landing page:
// 1. Open matched opportunities (truth-backed)
// 2. Deals in progress (approved/purchased/delivered)
// 3. Recently closed deals (proof of outcomes)
// ============================================================================

export interface TodayOpportunity {
  id: string;
  account_id: string;
  listing_norm_id: string;
  url_canonical: string;
  make: string | null;
  model: string | null;
  year: number | null;
  km: number | null;
  asking_price: number | null;
  fingerprint_make: string;
  fingerprint_model: string;
  sales_count: number;
  km_band: string;
  price_band: string;
  match_score: number;
  reasons: Record<string, string>;
  status: string;
  created_at: string;
  source_searched: string | null;
}

export interface TodayDeal {
  id: string;
  account_id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  status: string;
  created_at: string;
  source: string;
  url_canonical: string;
}

export function useTodayOpportunities(accountId: string) {
  const [opportunities, setOpportunities] = useState<TodayOpportunity[]>([]);
  const [dealsInProgress, setDealsInProgress] = useState<TodayDeal[]>([]);
  const [recentlyClosed, setRecentlyClosed] = useState<TodayDeal[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [oppsRes, activeDealsRes, closedDealsRes] = await Promise.all([
        // Section A: Open matched opportunities
        supabase
          .from("matched_opportunities_v1")
          .select("id, account_id, listing_norm_id, url_canonical, make, model, year, km, asking_price, fingerprint_make, fingerprint_model, sales_count, km_band, price_band, match_score, reasons, status, created_at, source_searched")
          .eq("account_id", accountId)
          .eq("status", "open")
          .order("match_score", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(10),

        // Section B: Deals in progress
        supabase
          .from("deal_truth_ledger")
          .select("id, account_id, make, model, year, status, created_at, source, url_canonical")
          .eq("account_id", accountId)
          .in("status", ["identified", "approved", "purchased", "delivered"])
          .order("created_at", { ascending: false })
          .limit(5),

        // Section C: Recently closed deals
        supabase
          .from("deal_truth_ledger")
          .select("id, account_id, make, model, year, status, created_at, source, url_canonical")
          .eq("account_id", accountId)
          .eq("status", "closed")
          .order("created_at", { ascending: false })
          .limit(5),
      ]);

      if (oppsRes.error) throw oppsRes.error;
      if (activeDealsRes.error) throw activeDealsRes.error;
      if (closedDealsRes.error) throw closedDealsRes.error;

      setOpportunities((oppsRes.data as TodayOpportunity[]) || []);
      setDealsInProgress((activeDealsRes.data as TodayDeal[]) || []);
      setRecentlyClosed((closedDealsRes.data as TodayDeal[]) || []);
    } catch (err) {
      console.error("Failed to load today's opportunities:", err);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { opportunities, dealsInProgress, recentlyClosed, loading, refetch: fetch };
}
