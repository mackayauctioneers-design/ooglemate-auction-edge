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
  price_delta: number | null;
  est_profit: number | null;
  variant_match: boolean;
}

export interface SaleWithMatches {
  sale: ProfitableSale;
  matches: LiveMatch[];
}

function kmMatchesSmart(saleKm: number, listingKm: number): boolean {
  if (!listingKm) return false;
  if (saleKm <= 5000) return listingKm <= 25000;
  if (saleKm <= 40000) return listingKm <= 60000;
  if (saleKm <= 120000) return Math.abs(listingKm - saleKm) <= 30000;
  return Math.abs(listingKm - saleKm) <= 40000;
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

/** Derive trim class — mirrors DB derive_trim_class() */
function deriveTrimClass(make: string, model: string, variant: string | null): string {
  const m = make.toUpperCase().trim();
  const mo = model.toUpperCase().trim();
  const v = (variant || "").toUpperCase();

  if (m === "TOYOTA") {
    if (mo === "LANDCRUISER") {
      if (v.includes("WORKMATE")) return "LC70_BASE";
      if (v.includes("GXL")) return "LC70_GXL";
      if (v.includes("GX")) return "LC70_GX";
      if (v.includes("VX")) return "LC70_VX";
      if (v.includes("SAHARA")) return "LC70_SAHARA";
      if (v.includes("70TH")) return "LC70_SPECIAL";
    }
    if (mo === "LANDCRUISER 200") {
      if (v.includes("GXL")) return "LC200_GXL";
      if (v.includes("GX")) return "LC200_GX";
      if (v.includes("VX")) return "LC200_VX";
      if (v.includes("SAHARA")) return "LC200_SAHARA";
    }
    if (mo === "LANDCRUISER 300") {
      if (v.includes("GXL")) return "LC300_GXL";
      if (v.includes("GX")) return "LC300_GX";
      if (v.includes("VX")) return "LC300_VX";
      if (v.includes("SAHARA")) return "LC300_SAHARA";
    }
    if (mo.includes("PRADO")) {
      if (v.includes("GXL")) return "PRADO_GXL";
      if (v.includes("GX")) return "PRADO_GX";
      if (v.includes("VX")) return "PRADO_VX";
      if (v.includes("KAKADU")) return "PRADO_KAKADU";
    }
    if (mo === "HILUX") {
      if (v.includes("SR5")) return "HILUX_SR5";
      if (v.includes("SR")) return "HILUX_SR";
      if (v.includes("ROGUE")) return "HILUX_ROGUE";
      if (v.includes("RUGGED")) return "HILUX_RUGGED";
      if (v.includes("WORKMATE")) return "HILUX_BASE";
    }
  }
  if (m === "FORD") {
    if (mo === "RANGER") {
      if (v.includes("RAPTOR")) return "RANGER_RAPTOR";
      if (v.includes("WILDTRAK")) return "RANGER_WILDTRAK";
      if (v.includes("XLT")) return "RANGER_XLT";
      if (v.includes("XLS")) return "RANGER_XLS";
      if (v.includes("XL")) return "RANGER_XL";
    }
    if (mo === "EVEREST") {
      if (v.includes("TITANIUM")) return "EVEREST_TITANIUM";
      if (v.includes("TREND")) return "EVEREST_TREND";
      if (v.includes("AMBIENTE")) return "EVEREST_AMBIENTE";
    }
  }
  if (m === "ISUZU") {
    if (mo === "D-MAX" || mo === "DMAX") {
      if (v.includes("X-TERRAIN") || v.includes("XTERRAIN")) return "DMAX_XTERRAIN";
      if (v.includes("LS-U") || v.includes("LSU")) return "DMAX_LSU";
      if (v.includes("LS-M") || v.includes("LSM")) return "DMAX_LSM";
      if (v.includes("SX")) return "DMAX_SX";
    }
    if (mo === "MU-X" || mo === "MUX") {
      if (v.includes("LS-T") || v.includes("LST")) return "MUX_LST";
      if (v.includes("LS-U") || v.includes("LSU")) return "MUX_LSU";
      if (v.includes("LS-M") || v.includes("LSM")) return "MUX_LSM";
    }
  }
  if (m === "MITSUBISHI" && mo === "TRITON") {
    if (v.includes("GLS")) return "TRITON_GLS";
    if (v.includes("GLX+") || v.includes("GLX PLUS")) return "TRITON_GLXPLUS";
    if (v.includes("GLX")) return "TRITON_GLX";
  }
  if (m === "NISSAN") {
    if (mo === "NAVARA") {
      if (v.includes("PRO-4X") || v.includes("PRO4X")) return "NAVARA_PRO4X";
      if (v.includes("ST-X") || v.includes("STX")) return "NAVARA_STX";
      if (v.includes("ST-L") || v.includes("STL")) return "NAVARA_STL";
      if (v.includes("ST")) return "NAVARA_ST";
      if (v.includes("SL")) return "NAVARA_SL";
    }
    if (mo === "PATROL") {
      if (v.includes("TI-L") || v.includes("TIL")) return "PATROL_TIL";
      if (v.includes("TI")) return "PATROL_TI";
    }
  }
  return mo + "_STANDARD";
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
        .slice(0, 20);

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

          // TRIM CLASS — HARD BOUNDARY
          const saleTrim = deriveTrimClass(sale.make, sale.model, sale.variant || sale.badge || sale.description_raw);
          const listingTrim = deriveTrimClass(l.make, l.model, l.variant_raw || l.variant_family);
          if (saleTrim !== listingTrim) continue;

          // Year ± 1
          if (sale.year && l.year) {
            if (Math.abs(l.year - sale.year) > 1) continue;
          }

          // Smart KM replication bands
          if (sale.km != null && l.km != null) {
            if (!kmMatchesSmart(sale.km, l.km)) continue;
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
            variant_match: saleTrim === listingTrim,
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
