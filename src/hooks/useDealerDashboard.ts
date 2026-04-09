import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface DealerPulse {
  activeHunts: number;
  openOpportunities: number;
  dealsInProgress: number;
  closedDeals30d: number;
  lastScanAt: string | null;
  lastScanOk: boolean;
}

export interface DealerOpp {
  id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  km: number | null;
  asking_price: number | null;
  match_score: number;
  status: string;
  source_searched: string | null;
  url_canonical: string;
  created_at: string;
  dealer_action: string | null;
  fingerprint_make: string;
  fingerprint_model: string;
  reasons: Record<string, string> | null;
}

export interface RecentActivity {
  id: string;
  type: "opportunity" | "deal" | "alert";
  title: string;
  subtitle: string;
  timestamp: string;
  status: string;
}

const DEFAULT_PULSE: DealerPulse = {
  activeHunts: 0,
  openOpportunities: 0,
  dealsInProgress: 0,
  closedDeals30d: 0,
  lastScanAt: null,
  lastScanOk: false,
};

export function useDealerDashboard() {
  const { dealerProfile, currentUser } = useAuth();
  const accountId = dealerProfile?.account_id || null;
  const dealerProfileId = dealerProfile?.dealer_profile_id || null;
  const dealerName = currentUser?.dealer_name || null;

  const [pulse, setPulse] = useState<DealerPulse>(DEFAULT_PULSE);
  const [opportunities, setOpportunities] = useState<DealerOpp[]>([]);
  const [activity, setActivity] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const hasProfile = !!accountId;

    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      // Always fetch heartbeat + platform-wide market activity
      const heartbeatPromise = supabase
        .from("cron_heartbeat")
        .select("last_seen_at, last_ok")
        .eq("cron_name", "run-hunt-scan")
        .maybeSingle();

      if (hasProfile) {
        // ── Full dealer-specific fetch ──
        const [
          huntsRes,
          oppsRes,
          activeDealsRes,
          closedDealsRes,
          heartbeatRes,
          alertsRes,
        ] = await Promise.all([
          supabase
            .from("dealer_fingerprints")
            .select("id", { count: "exact", head: true })
            .eq("dealer_name", dealerName || "")
            .eq("is_active", true),
          supabase
            .from("matched_opportunities_v1")
            .select("id, make, model, year, km, asking_price, match_score, status, source_searched, url_canonical, created_at, dealer_action, fingerprint_make, fingerprint_model, reasons")
            .eq("account_id", accountId)
            .in("status", ["open", "interested", "bidding"])
            .order("match_score", { ascending: false })
            .limit(20),
          supabase
            .from("deal_truth_ledger")
            .select("id, make, model, year, status, created_at, source, url_canonical")
            .eq("account_id", accountId)
            .in("status", ["identified", "approved", "purchased", "delivered"])
            .order("created_at", { ascending: false })
            .limit(10),
          supabase
            .from("deal_truth_ledger")
            .select("id", { count: "exact", head: true })
            .eq("account_id", accountId)
            .eq("status", "closed")
            .gte("created_at", thirtyDaysAgo),
          heartbeatPromise,
          supabase
            .from("alert_logs")
            .select("id, alert_type, message_text, created_at, status")
            .eq("dealer_profile_id", accountId)
            .order("created_at", { ascending: false })
            .limit(5),
        ]);

        const opp = oppsRes.data || [];
        setPulse({
          activeHunts: huntsRes.count || 0,
          openOpportunities: opp.length,
          dealsInProgress: activeDealsRes.data?.length || 0,
          closedDeals30d: closedDealsRes.count || 0,
          lastScanAt: heartbeatRes.data?.last_seen_at || null,
          lastScanOk: heartbeatRes.data?.last_ok || false,
        });
        setOpportunities(opp as DealerOpp[]);

        // Build activity feed
        const activityItems: RecentActivity[] = [];
        for (const o of opp.slice(0, 5)) {
          activityItems.push({
            id: o.id, type: "opportunity",
            title: `${o.year || ""} ${o.make || ""} ${o.model || ""}`.trim(),
            subtitle: o.asking_price ? `$${o.asking_price.toLocaleString()}` : "Price TBC",
            timestamp: o.created_at, status: o.status,
          });
        }
        for (const d of (activeDealsRes.data || []).slice(0, 3)) {
          activityItems.push({
            id: d.id, type: "deal",
            title: `${d.year || ""} ${d.make || ""} ${d.model || ""}`.trim(),
            subtitle: `Deal: ${d.status}`,
            timestamp: d.created_at, status: d.status,
          });
        }
        for (const a of (alertsRes.data || []).slice(0, 3)) {
          activityItems.push({
            id: a.id, type: "alert",
            title: a.alert_type,
            subtitle: a.message_text?.substring(0, 80) || "",
            timestamp: a.created_at, status: a.status,
          });
        }
        activityItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setActivity(activityItems.slice(0, 10));
      } else {
        // ── New dealer (no profile yet): show platform market pulse ──
        const [heartbeatRes, marketOppsRes] = await Promise.all([
          heartbeatPromise,
          // Show recent high-scoring matches across the platform so the desk looks alive
          supabase
            .from("matched_opportunities_v1")
            .select("id, make, model, year, km, asking_price, match_score, status, source_searched, url_canonical, created_at, dealer_action, fingerprint_make, fingerprint_model, reasons")
            .in("status", ["open", "interested", "bidding"])
            .gte("match_score", 70)
            .order("created_at", { ascending: false })
            .limit(12),
        ]);

        const marketOpps = marketOppsRes.data || [];
        setPulse({
          activeHunts: 0,
          openOpportunities: marketOpps.length,
          dealsInProgress: 0,
          closedDeals30d: 0,
          lastScanAt: heartbeatRes.data?.last_seen_at || null,
          lastScanOk: heartbeatRes.data?.last_ok || false,
        });
        setOpportunities(marketOpps as DealerOpp[]);

        // Activity from market opps
        const activityItems: RecentActivity[] = marketOpps.slice(0, 8).map((o: any) => ({
          id: o.id, type: "opportunity" as const,
          title: `${o.year || ""} ${o.make || ""} ${o.model || ""}`.trim(),
          subtitle: o.asking_price ? `$${o.asking_price.toLocaleString()}` : "Price TBC",
          timestamp: o.created_at, status: o.status,
        }));
        setActivity(activityItems);
      }
    } catch (err) {
      console.error("[DealerDashboard] Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [accountId, dealerName]);

  useEffect(() => { fetch(); }, [fetch]);

  // Poll every 3 min
  useEffect(() => {
    const interval = setInterval(fetch, 3 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetch]);

  return { pulse, opportunities, activity, loading, refetch: fetch };
}
