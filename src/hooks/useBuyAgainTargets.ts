import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ProfitableSale {
  id: string;
  account_id: string;
  make: string;
  model: string;
  badge: string | null;
  variant: string | null;
  description_raw: string | null;
  year: number | null;
  km: number | null;
  sale_price: number;
  buy_price: number;
  profit: number;
  sold_at: string | null;
  drive_type: string | null;
  drivetrain: string | null; // extracted from description_raw
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

export interface SaleWithMatches {
  sale: ProfitableSale;
  matches: LiveMatch[];
}

function extractDrivetrain(raw: string | null): string | null {
  if (!raw) return null;
  if (/\b4x4\b/i.test(raw)) return "4X4";
  if (/\b4wd\b/i.test(raw)) return "4WD";
  if (/\bawd\b/i.test(raw)) return "AWD";
  if (/\bfwd\b/i.test(raw)) return "FWD";
  if (/\b2wd\b/i.test(raw)) return "2WD";
  if (/\brwd\b/i.test(raw)) return "RWD";
  return null;
}

export function extractBadge(raw: string | null): string | null {
  if (!raw) return null;
  const match = raw.match(/\b(GXL|GX|VX|Sahara|GR\s*Sport|SR5|SR|XLT|XLS|XL|Wildtrak|Raptor|Sport|DX|RV|STX|Titanium|Trend|Ambiente|Laramie|N-TREK|ST-X|ST-L|ST|SL|Pro-4X|Warrior)\b/i);
  return match ? match[1] : null;
}

function scoreKm(listingKm: number | null, saleKm: number | null): { score: number; diff: number | null } {
  if (listingKm == null || saleKm == null) return { score: 0.5, diff: null };
  const diff = Math.abs(listingKm - saleKm);
  if (diff <= 10000) return { score: 1.0, diff };
  if (diff <= 15000) return { score: 0.7, diff };
  if (diff <= 20000) return { score: 0.4, diff };
  return { score: 0.0, diff };
}

export function useBuyAgainTargets(accountId: string) {
  const queryKey = ["buy-again-sales", accountId];

  const { data, isLoading, refetch } = useQuery({
    queryKey,
    queryFn: async (): Promise<SaleWithMatches[]> => {
      // 1. Pull top profitable individual sales
      const { data: sales, error: sErr } = await supabase
        .from("vehicle_sales_truth")
        .select("id, account_id, make, model, badge, variant, description_raw, year, km, sale_price, buy_price, sold_at, drive_type")
        .eq("account_id", accountId)
        .not("buy_price", "is", null)
        .not("sale_price", "is", null)
        .order("sale_price", { ascending: false })
        .limit(200);
      if (sErr) throw sErr;
      if (!sales?.length) return [];

      // Compute profit and filter to top profitable sales (profit > $5k or top 15)
      const enriched: ProfitableSale[] = sales
        .map((s) => {
          const profit = (s.sale_price || 0) - Number(s.buy_price || 0);
          return {
            id: s.id,
            account_id: s.account_id,
            make: s.make,
            model: s.model,
            badge: s.badge || extractBadge(s.description_raw),
            variant: s.variant,
            description_raw: s.description_raw,
            year: s.year,
            km: s.km,
            sale_price: s.sale_price!,
            buy_price: Number(s.buy_price!),
            profit,
            sold_at: s.sold_at,
            drive_type: s.drive_type,
            drivetrain: s.drive_type || extractDrivetrain(s.description_raw),
          };
        })
        .filter((s) => s.profit > 0)
        .sort((a, b) => b.profit - a.profit)
        .slice(0, 15);

      if (!enriched.length) return [];

      // 2. Pull active listings
      const { data: listings, error: lErr } = await supabase
        .from("vehicle_listings")
        .select("id, make, model, variant_raw, variant_family, year, km, asking_price, listing_url, source, status, first_seen_at, drivetrain")
        .in("status", ["catalogue", "listed"])
        .order("asking_price", { ascending: true, nullsFirst: false })
        .limit(1000);
      if (lErr) throw lErr;

      // 3. For each sale, find top 3 cheapest matches
      const results: SaleWithMatches[] = [];

      for (const sale of enriched) {
        const scored: LiveMatch[] = [];
        for (const l of listings || []) {
          if (!l.make || !l.model) continue;
          if (l.make.toUpperCase() !== sale.make.toUpperCase()) continue;
          if (l.model.toUpperCase() !== sale.model.toUpperCase()) continue;

          // Year filter: ±2 years of the sale
          if (sale.year && l.year) {
            if (Math.abs(l.year - sale.year) > 2) continue;
          }

          // Drivetrain hard-skip
          const ld = (l.drivetrain || "").toUpperCase();
          const sd = (sale.drivetrain || "").toUpperCase();
          if (["2WD", "FWD"].includes(ld) && ["4X4", "4WD", "AWD"].includes(sd)) continue;

          // KM scoring
          const { score: kmScore, diff: kmDiff } = scoreKm(l.km, sale.km);
          if (kmScore === 0.0) continue;

          const price = l.asking_price || 0;
          const estProfit = sale.sale_price > 0 && price > 0 ? sale.sale_price - price : null;

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
        results.push({ sale, matches: scored.slice(0, 3) });
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
