import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useCallback } from "react";

export interface PlatformCluster {
  id: string;
  account_id: string;
  make: string;
  model: string;
  generation: string;
  engine_type: string;
  drivetrain: string;
  year_min: number;
  year_max: number;
  total_flips: number;
  median_buy_price: number | null;
  median_sell_price: number | null;
  median_profit: number | null;
  median_km: number | null;
  avg_days_to_sell: number | null;
  last_sale_date: string | null;
}

export interface ClusterMatch {
  id: string;
  make: string | null;
  model: string | null;
  variant: string | null;
  year: number | null;
  km: number | null;
  price: number | null;
  url: string | null;
  source: string | null;
  status: string | null;
  first_seen_at: string | null;
  drivetrain: string | null;
  est_profit: number | null;
  alert_tier: "CODE_RED" | "HIGH" | "NORMAL";
}

export interface ClusterWithMatches {
  cluster: PlatformCluster;
  matches: ClusterMatch[];
}

function getDismissedKey(accountId: string) {
  return `cluster-dismissed-${accountId}`;
}
function getDismissedIds(accountId: string): Set<string> {
  try {
    const raw = localStorage.getItem(getDismissedKey(accountId));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}
function persistDismissedIds(accountId: string, ids: Set<string>) {
  localStorage.setItem(getDismissedKey(accountId), JSON.stringify([...ids]));
}

export function usePlatformClusters(accountId: string) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => getDismissedIds(accountId));

  const dismissCluster = useCallback((clusterId: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(clusterId);
      persistDismissedIds(accountId, next);
      return next;
    });
  }, [accountId]);

  const clearDismissed = useCallback(() => {
    setDismissedIds(new Set());
    localStorage.removeItem(getDismissedKey(accountId));
  }, [accountId]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["platform-clusters", accountId],
    queryFn: async (): Promise<ClusterWithMatches[]> => {
      // 1. Fetch clusters sorted by total_flips desc
      const { data: clusters, error: cErr } = await supabase
        .from("dealer_platform_clusters")
        .select("*")
        .eq("account_id", accountId)
        .order("total_flips", { ascending: false })
        .limit(50);
      if (cErr) throw cErr;
      if (!clusters?.length) return [];

      // 2. Pull active listings
      const { data: listings, error: lErr } = await supabase
        .from("vehicle_listings")
        .select("id, make, model, variant_raw, variant_family, year, km, asking_price, listing_url, source, status, first_seen_at, drivetrain")
        .in("status", ["catalogue", "listed"])
        .order("asking_price", { ascending: true, nullsFirst: false })
        .limit(1000);
      if (lErr) throw lErr;

      // 3. Match listings to clusters
      const results: ClusterWithMatches[] = [];

      for (const c of clusters as PlatformCluster[]) {
        const matches: ClusterMatch[] = [];

        for (const l of listings || []) {
          if (!l.make || !l.model) continue;
          if (l.make.toUpperCase() !== c.make.toUpperCase()) continue;
          if (l.model.toUpperCase() !== c.model.toUpperCase()) continue;

          // Year within cluster range (±1 buffer on edges)
          if (l.year) {
            if (l.year < c.year_min - 1 || l.year > c.year_max + 1) continue;
          }

          // Drivetrain: hard skip 2WD listing for 4X4 cluster
          if (c.drivetrain === "4X4") {
            const ld = (l.drivetrain || "").toUpperCase();
            if (["2WD", "FWD", "RWD"].includes(ld)) continue;
          }

          const price = l.asking_price || 0;
          const medianBuy = c.median_buy_price || 0;
          const medianSell = c.median_sell_price || 0;
          const estProfit = medianSell > 0 && price > 0 ? medianSell - price : null;

          // Alert tier
          let alertTier: "CODE_RED" | "HIGH" | "NORMAL" = "NORMAL";
          if (medianBuy > 0 && price > 0) {
            if (price <= medianBuy - 5000) alertTier = "CODE_RED";
            else if (price <= medianBuy - 3000) alertTier = "HIGH";
          }

          matches.push({
            id: l.id,
            make: l.make,
            model: l.model,
            variant: l.variant_raw || l.variant_family,
            year: l.year,
            km: l.km,
            price: l.asking_price,
            url: l.listing_url,
            source: l.source,
            status: l.status,
            first_seen_at: l.first_seen_at,
            drivetrain: l.drivetrain,
            est_profit: estProfit,
            alert_tier: alertTier,
          });
        }

        // Sort by price ascending, take top 3
        matches.sort((a, b) => (a.price || Infinity) - (b.price || Infinity));
        results.push({ cluster: c, matches: matches.slice(0, 3) });
      }

      return results;
    },
    enabled: !!accountId,
  });

  const filtered = (data || []).filter((g) => !dismissedIds.has(g.cluster.id));

  return {
    groups: filtered,
    isLoading,
    refetch,
    dismissCluster,
    clearDismissed,
    dismissedCount: dismissedIds.size,
  };
}
