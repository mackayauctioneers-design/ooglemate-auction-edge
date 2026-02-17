import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useCallback } from "react";

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
  drivetrain: string | null;
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
  price_delta: number | null; // historical buy - current asking (positive = cheaper than what we paid)
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

/** Normalize variant for comparison: uppercase, strip chassis codes & body noise */
function normalizeVariant(v: string | null): string {
  if (!v) return "";
  return v
    .toUpperCase()
    .replace(/\b[A-Z]{2,3}\d{2,3}[A-Z]?\b/g, "") // chassis codes like VDJ200R, PX, D23
    .replace(/\b(UTILITY|WAGON|DUAL CAB|SINGLE CAB|EXTRA CAB|DOUBLE CAB|CAB CHASSIS|HARDTOP|\d+ST)\b/gi, "")
    .replace(/\b(SPTS?\s*AUTO|AUTO|MANUAL|CVT|4WD|AWD|2WD|FWD|RWD|4X4|4X2)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getDismissedKey(accountId: string) {
  return `buy-again-dismissed-${accountId}`;
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

export function useBuyAgainTargets(accountId: string) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => getDismissedIds(accountId));

  const dismissSale = useCallback((saleId: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(saleId);
      persistDismissedIds(accountId, next);
      return next;
    });
  }, [accountId]);

  const clearDismissed = useCallback(() => {
    setDismissedIds(new Set());
    localStorage.removeItem(getDismissedKey(accountId));
  }, [accountId]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["buy-again-sales", accountId],
    queryFn: async (): Promise<SaleWithMatches[]> => {
      // 1. Pull profitable sales
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
        .slice(0, 40);

      if (!enriched.length) return [];

      // 2. Pull active listings
      const { data: listings, error: lErr } = await supabase
        .from("vehicle_listings")
        .select("id, make, model, variant_raw, variant_family, year, km, asking_price, listing_url, source, status, first_seen_at, drivetrain")
        .in("status", ["catalogue", "listed"])
        .order("asking_price", { ascending: true, nullsFirst: false })
        .limit(1000);
      if (lErr) throw lErr;

      // 3. For each sale, find matching listings
      const results: SaleWithMatches[] = [];

      for (const sale of enriched) {
        const matched: LiveMatch[] = [];

        for (const l of listings || []) {
          if (!l.make || !l.model) continue;

          // Make must match
          if (l.make.toUpperCase() !== sale.make.toUpperCase()) continue;

          // Model must match
          if (l.model.toUpperCase() !== sale.model.toUpperCase()) continue;

          // Variant: exact or normalized match
          const saleVariant = normalizeVariant(sale.variant || sale.badge || sale.description_raw);
          const listingVariant = normalizeVariant(l.variant_raw || l.variant_family);
          if (saleVariant && listingVariant && saleVariant !== listingVariant) continue;

          // Year ± 1
          if (sale.year && l.year) {
            if (Math.abs(l.year - sale.year) > 1) continue;
          }

          // KM ± 10,000
          if (sale.km != null && l.km != null) {
            if (Math.abs(l.km - sale.km) > 10000) continue;
          }

          // Drivetrain must match (hard skip mismatches)
          const sd = (sale.drivetrain || "").toUpperCase();
          const ld = (l.drivetrain || "").toUpperCase();
          if (sd && ld) {
            const is4x4Sale = ["4X4", "4WD", "AWD"].includes(sd);
            const is4x4Listing = ["4X4", "4WD", "AWD"].includes(ld);
            if (is4x4Sale !== is4x4Listing) continue;
          }

          const price = l.asking_price || 0;
          const priceDelta = sale.buy_price > 0 && price > 0 ? sale.buy_price - price : null;
          const estProfit = sale.sale_price > 0 && price > 0 ? sale.sale_price - price : null;

          matched.push({
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
            price_delta: priceDelta,
            est_profit: estProfit,
          });
        }

        // Sort: biggest price_delta first (cheapest relative to historical buy), then lowest price
        matched.sort((a, b) => {
          const da = a.price_delta ?? -Infinity;
          const db = b.price_delta ?? -Infinity;
          if (db !== da) return db - da;
          return (a.price || Infinity) - (b.price || Infinity);
        });

        if (matched.length > 0) {
          results.push({ sale, matches: matched.slice(0, 3) });
        }
      }

      // Sort results: biggest price delta of best match first
      results.sort((a, b) => {
        const da = a.matches[0]?.price_delta ?? -Infinity;
        const db = b.matches[0]?.price_delta ?? -Infinity;
        return db - da;
      });

      return results;
    },
    enabled: !!accountId,
  });

  const filtered = (data || []).filter((g) => !dismissedIds.has(g.sale.id)).slice(0, 20);

  return {
    groups: filtered,
    isLoading,
    refetch,
    dismissSale,
    clearDismissed,
    dismissedCount: dismissedIds.size,
  };
}
