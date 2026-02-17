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
  avg_km: number | null;
  median_km: number | null;
  times_sold: number;
  last_sale_price: number | null;
  last_sale_date: string | null;
  rank: number | null;
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

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async (): Promise<FingerprintWithMatches[]> => {
      // 1. Pull winners for this account
      const { data: winners, error: wErr } = await supabase
        .from("winners_watchlist")
        .select("*")
        .eq("account_id", accountId)
        .order("rank", { ascending: true })
        .limit(20);
      if (wErr) throw wErr;
      if (!winners?.length) return [];

      // 2. Pull active listings (catalogue/listed)
      const { data: listings, error: lErr } = await supabase
        .from("vehicle_listings")
        .select("id, make, model, variant_raw, variant_family, year, km, asking_price, listing_url, source, status, first_seen_at, drivetrain")
        .in("status", ["catalogue", "listed"])
        .order("asking_price", { ascending: true, nullsFirst: false })
        .limit(1000);
      if (lErr) throw lErr;

      // 3. For each winner, find top 3 cheapest matches
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
          avg_km: w.avg_km,
          median_km: w.median_km,
          times_sold: w.times_sold,
          last_sale_price: w.last_sale_price,
          last_sale_date: w.last_sale_date,
          rank: w.rank,
        };

        const refKm = w.median_km || w.avg_km;

        const scored: LiveMatch[] = [];
        for (const l of (listings || [])) {
          // Make/model must match
          if (!l.make || !l.model) continue;
          if (l.make.toUpperCase() !== w.make.toUpperCase()) continue;
          if (l.model.toUpperCase() !== w.model.toUpperCase()) continue;

          // Year range check
          if (w.year_min && l.year && l.year < w.year_min) continue;
          if (w.year_max && l.year && l.year > w.year_max) continue;

          // Drivetrain hard skip: listing 2WD/FWD against winner 4x4/AWD/4WD
          const ld = (l.drivetrain || "").toUpperCase();
          const wd = (w.drivetrain || "").toUpperCase();
          if (["2WD", "FWD"].includes(ld) && ["4X4", "4WD", "AWD"].includes(wd)) continue;

          // KM scoring
          const { score: kmScore, diff: kmDiff } = scoreKm(l.km, refKm);
          if (kmScore === 0.0) continue; // hard skip >20k diff

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

        // Sort by price ascending, take top 3
        scored.sort((a, b) => (a.price || Infinity) - (b.price || Infinity));
        results.push({ fingerprint: fp, matches: scored.slice(0, 3) });
      }

      return results;
    },
    enabled: !!accountId,
  });

  return {
    groups: data || [],
    isLoading,
  };
}
