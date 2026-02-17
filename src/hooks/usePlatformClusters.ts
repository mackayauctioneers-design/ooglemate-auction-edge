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

/** Derive generation bucket — must mirror DB derive_generation() */
function deriveGeneration(make: string, model: string, year: number): string {
  const m = make.toUpperCase();
  const mod = model.toUpperCase();
  if (m === "TOYOTA") {
    if (mod === "LANDCRUISER") {
      if (year >= 1990 && year <= 1997) return "LC80";
      if (year >= 1998 && year <= 2007) return "LC100";
      if (year >= 2008 && year <= 2021) return "LC200";
      if (year >= 2022) return "LC300";
    }
    if (mod === "LANDCRUISER PRADO" || mod === "PRADO") {
      if (year >= 2002 && year <= 2009) return "Prado120";
      if (year >= 2009 && year <= 2023) return "Prado150";
      if (year >= 2024) return "Prado250";
    }
    if (mod.includes("70 SERIES") || mod === "LANDCRUISER 70") {
      return "LC70";
    }
    if (mod === "HILUX") {
      if (year >= 2005 && year <= 2015) return "HiluxN70";
      if (year >= 2015 && year <= 2023) return "HiluxAN120";
      if (year >= 2024) return "HiluxAN130";
    }
    if (mod === "RAV4") {
      if (year >= 2019) return "RAV4-5";
      if (year >= 2013) return "RAV4-4";
    }
    if (mod === "FORTUNER") return "Fortuner";
  }
  if (m === "FORD") {
    if (mod === "RANGER") {
      if (year >= 2011 && year <= 2022) return "RangerPX";
      if (year >= 2022) return "RangerV2";
    }
    if (mod === "EVEREST") {
      if (year >= 2015 && year <= 2022) return "EverestUA";
      if (year >= 2022) return "EverestV2";
    }
  }
  if (m === "MAZDA" && mod === "BT-50") {
    if (year >= 2011 && year <= 2020) return "BT50-UR";
    if (year >= 2020) return "BT50-TF";
  }
  if (m === "MITSUBISHI" && mod === "TRITON") {
    if (year >= 2015 && year <= 2024) return "TritonMQ";
    if (year >= 2024) return "TritonMR2";
  }
  if (m === "NISSAN") {
    if (mod === "NAVARA") {
      if (year >= 2015) return "NavaraNP300";
    }
    if (mod === "PATROL") {
      if (year >= 2010) return "PatrolY62";
    }
  }
  if (m === "ISUZU") {
    if (mod === "D-MAX" || mod === "DMAX") {
      if (year >= 2012 && year <= 2020) return "DMax-RT";
      if (year >= 2020) return "DMax-RG";
    }
    if (mod === "MU-X" || mod === "MUX") {
      if (year >= 2013 && year <= 2021) return "MUX-1";
      if (year >= 2021) return "MUX-2";
    }
  }
  if (m === "VOLKSWAGEN" && mod === "AMAROK") {
    if (year >= 2011 && year <= 2022) return "AmarokV1";
    if (year >= 2023) return "AmarokV2";
  }
  if (m === "HYUNDAI" && (mod === "TUCSON" || mod === "SANTA FE" || mod === "PALISADE")) {
    return mod.replace(/ /g, "") + "Gen";
  }
  if (m === "KIA" && (mod === "SORENTO" || mod === "SPORTAGE")) {
    return mod + "Gen";
  }
  return "GEN_UNKNOWN";
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
          if (!l.make || !l.model || !l.year) continue;
          if (l.make.toUpperCase() !== c.make.toUpperCase()) continue;

          // Derive generation for listing — must EXACTLY match cluster generation
          const listingGen = deriveGeneration(l.make, l.model, l.year);
          if (listingGen !== c.generation) continue;

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
