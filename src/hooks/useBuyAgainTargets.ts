import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface WinnerFingerprint {
  id: string;
  account_id: string;
  make: string;
  model: string;
  variant: string | null;
  drivetrain: string | null;
  year_min: number | null;
  year_max: number | null;
  avg_profit: number | null;
  total_profit: number | null;
  avg_km: number | null;
  median_km: number | null;
  times_sold: number;
  last_sale_price: number | null;
  last_sale_date: string | null;
  rank: number | null;
}

export interface BestSale {
  id: string;
  profit: number;
  sale_price: number;
  buy_price: number;
  year: number | null;
  km: number | null;
  sold_at: string | null;
  description_raw: string | null;
  badge: string | null;
}

export interface LiveMatch {
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
  km_diff: number | null;
  km_score: number;
  est_profit: number | null;
}

export interface FingerprintWithMatches {
  fingerprint: WinnerFingerprint;
  bestSale: BestSale | null;
  matches: LiveMatch[];
}

function scoreKm(listingKm: number | null, winnerKm: number | null): { score: number; diff: number | null } {
  if (listingKm == null || winnerKm == null) return { score: 0.5, diff: null };
  const diff = Math.abs(listingKm - winnerKm);
  if (diff <= 10000) return { score: 1.0, diff };
  if (diff <= 15000) return { score: 0.7, diff };
  if (diff <= 20000) return { score: 0.4, diff };
  return { score: 0.0, diff };
}

export function useBuyAgainTargets(accountId: string) {
  const queryKey = ["buy-again-grouped", accountId];

  const { data, isLoading, refetch } = useQuery({
    queryKey,
    queryFn: async (): Promise<FingerprintWithMatches[]> => {
      // 1. Pull winners sorted by total_profit desc
      const { data: winners, error: wErr } = await supabase
        .from("winners_watchlist")
        .select("*")
        .eq("account_id", accountId)
        .order("total_profit", { ascending: false, nullsFirst: false })
        .limit(20);
      if (wErr) throw wErr;
      if (!winners?.length) return [];

      // 2. Pull active listings
      const { data: listings, error: lErr } = await supabase
        .from("vehicle_listings")
        .select("id, make, model, variant_raw, variant_family, year, km, asking_price, listing_url, source, status, first_seen_at, drivetrain")
        .in("status", ["catalogue", "listed"])
        .order("asking_price", { ascending: true, nullsFirst: false })
        .limit(1000);
      if (lErr) throw lErr;

      // 3. Pull best sale per fingerprint from vehicle_sales_truth
      const makes = [...new Set(winners.map(w => w.make.toUpperCase()))];
      const { data: sales } = await supabase
        .from("vehicle_sales_truth")
        .select("id, make, model, badge, variant, year, km, sale_price, buy_price, sold_at, description_raw")
        .eq("account_id", accountId)
        .not("buy_price", "is", null);

      // Build best-sale lookup by make+model
      const bestSaleMap = new Map<string, BestSale>();
      for (const s of (sales || [])) {
        if (!s.make || !s.model || !s.sale_price || !s.buy_price) continue;
        const key = `${s.make.toUpperCase()}|${s.model.toUpperCase()}`;
        const profit = s.sale_price - s.buy_price;
        const existing = bestSaleMap.get(key);
        if (!existing || profit > existing.profit) {
          bestSaleMap.set(key, {
            id: s.id,
            profit,
            sale_price: s.sale_price,
            buy_price: s.buy_price,
            year: s.year,
            km: s.km,
            sold_at: s.sold_at,
            description_raw: s.description_raw,
            badge: s.badge,
          });
        }
      }

      // 4. For each winner, find top 3 cheapest matches
      const results: FingerprintWithMatches[] = [];

      for (const w of winners) {
        const fp: WinnerFingerprint = {
          id: w.id,
          account_id: w.account_id,
          make: w.make,
          model: w.model,
          variant: w.variant,
          drivetrain: w.drivetrain,
          year_min: w.year_min,
          year_max: w.year_max,
          avg_profit: w.avg_profit,
          total_profit: w.total_profit,
          avg_km: w.avg_km,
          median_km: w.median_km,
          times_sold: w.times_sold,
          last_sale_price: w.last_sale_price,
          last_sale_date: w.last_sale_date,
          rank: w.rank,
        };

        const refKm = w.median_km || w.avg_km;
        const saleKey = `${w.make.toUpperCase()}|${w.model.toUpperCase()}`;
        const bestSale = bestSaleMap.get(saleKey) || null;

        const scored: LiveMatch[] = [];
        for (const l of (listings || [])) {
          if (!l.make || !l.model) continue;
          if (l.make.toUpperCase() !== w.make.toUpperCase()) continue;
          if (l.model.toUpperCase() !== w.model.toUpperCase()) continue;

          if (w.year_min && l.year && l.year < w.year_min) continue;
          if (w.year_max && l.year && l.year > w.year_max) continue;

          const ld = (l.drivetrain || "").toUpperCase();
          const wd = (w.drivetrain || "").toUpperCase();
          if (["2WD", "FWD"].includes(ld) && ["4X4", "4WD", "AWD"].includes(wd)) continue;

          const { score: kmScore, diff: kmDiff } = scoreKm(l.km, refKm);
          if (kmScore === 0.0) continue;

          const price = l.asking_price || 0;
          const lastSale = w.last_sale_price || 0;
          const estProfit = lastSale > 0 && price > 0 ? lastSale - price : null;

          scored.push({
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
            km_diff: kmDiff,
            km_score: kmScore,
            est_profit: estProfit,
          });
        }

        scored.sort((a, b) => (a.price || Infinity) - (b.price || Infinity));
        results.push({ fingerprint: fp, bestSale, matches: scored.slice(0, 3) });
      }

      return results;
    },
    enabled: !!accountId,
  });

  return {
    groups: data || [],
    isLoading,
    refetch,
  };
}
