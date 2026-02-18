import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useCallback } from "react";

/* ── Types ── */

export interface ProfitableSale {
  id: string;
  make: string;
  model: string;
  variant: string | null;
  year: number;
  km: number | null;
  buy_price: number;
  sale_price: number;
  profit: number;
  drive_type: string | null;
  sold_at: string | null;
  trim_class: string;
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
  est_profit: number;
  match_type: "exact" | "upgrade";
}

export interface SaleWithMatches {
  sale: ProfitableSale;
  matches: LiveMatch[];
}

/* ── Trim class (mirrors DB derive_trim_class) ── */

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
    if (mo === "HIACE" || mo.includes("HIACE")) {
      if (v.includes("COMMUTER")) return "HIACE_COMMUTER";
      if (v.includes("LWB")) return "HIACE_LWB";
      if (v.includes("SLWB")) return "HIACE_SLWB";
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

/* ── Helpers ── */

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

/* ── Dismiss helpers ── */

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

/* ── Hook ── */

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
      // ─── STEP 1: Top 20 profitable individual sales ───
      const { data: sales, error: sErr } = await supabase
        .from("vehicle_sales_truth")
        .select("id, account_id, make, model, badge, variant, description_raw, year, km, sale_price, buy_price, sold_at, drive_type")
        .eq("account_id", accountId)
        .not("buy_price", "is", null)
        .not("sale_price", "is", null)
        .order("sale_price", { ascending: false })
        .limit(500);
      if (sErr) throw sErr;
      if (!sales?.length) return [];

      // Compute profit and filter >= $4000, take top 20
      const profitableSales: ProfitableSale[] = [];
      for (const s of sales) {
        if (!s.make || !s.model || !s.year) continue;
        const buyPrice = Number(s.buy_price || 0);
        const salePrice = Number(s.sale_price || 0);
        const profit = salePrice - buyPrice;
        if (profit < 4000) continue;

        const variant = s.variant || s.badge || s.description_raw || null;
        const driveType = s.drive_type || extractDrivetrain(s.description_raw);

        profitableSales.push({
          id: s.id,
          make: s.make,
          model: s.model,
          variant,
          year: s.year,
          km: s.km,
          buy_price: buyPrice,
          sale_price: salePrice,
          profit,
          drive_type: driveType,
          sold_at: s.sold_at,
          trim_class: deriveTrimClass(s.make, s.model, variant),
        });
      }

      // Sort by profit DESC, take top 20
      profitableSales.sort((a, b) => b.profit - a.profit);
      const topSales = profitableSales.slice(0, 20);
      if (!topSales.length) return [];

      // ─── STEP 2: Load trim ladder ───
      const { data: trimLadder } = await supabase
        .from("trim_ladder")
        .select("make, model, trim_class, trim_rank");
      const trimRankMap = new Map<string, number>();
      for (const row of trimLadder || []) {
        trimRankMap.set(`${row.make}|${row.model}|${row.trim_class}`, row.trim_rank);
      }

      // ─── STEP 3: Pull fresh listings ───
      const freshCutoff = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data: listings, error: lErr } = await supabase
        .from("vehicle_listings")
        .select("id, make, model, variant_raw, variant_family, year, km, asking_price, listing_url, source, status, first_seen_at, drivetrain")
        .in("status", ["catalogue", "listed"])
        .gte("last_seen_at", freshCutoff)
        .order("asking_price", { ascending: true, nullsFirst: false })
        .limit(1000);
      if (lErr) throw lErr;

      // ─── STEP 4: Match each sale against listings ───
      const results: SaleWithMatches[] = [];

      for (const sale of topSales) {
        const matched: LiveMatch[] = [];

        for (const l of listings || []) {
          if (!l.make || !l.model) continue;

          // Make exact
          if (l.make.toUpperCase() !== sale.make.toUpperCase()) continue;
          // Model exact
          if (l.model.toUpperCase() !== sale.model.toUpperCase()) continue;
          // Year within ±2
          if (l.year && Math.abs(l.year - sale.year) > 2) continue;
          // KM within ±10,000 (if both known)
          if (l.km != null && sale.km != null && Math.abs(l.km - sale.km) > 10000) continue;
          // Price must be below sale price
          if (!l.asking_price || l.asking_price >= sale.sale_price) continue;

          // Drivetrain hard filter
          if (sale.drive_type && l.drivetrain) {
            const sd = sale.drive_type.toUpperCase();
            const ld = l.drivetrain.toUpperCase();
            const saleIs4x4 = ["4X4", "4WD", "AWD"].includes(sd);
            const listingIs4x4 = ["4X4", "4WD", "AWD"].includes(ld);
            if (saleIs4x4 !== listingIs4x4) continue;
          }

          // Trim class: exact or one-step upgrade
          const listingTrim = deriveTrimClass(l.make, l.model, l.variant_raw || l.variant_family);
          let matchType: "exact" | "upgrade" | null = null;

          if (listingTrim === sale.trim_class) {
            matchType = "exact";
          } else {
            const makeUp = l.make.toUpperCase();
            const modelUp = l.model.toUpperCase();
            const saleRank = trimRankMap.get(`${makeUp}|${modelUp}|${sale.trim_class}`);
            const listingRank = trimRankMap.get(`${makeUp}|${modelUp}|${listingTrim}`);
            if (saleRank != null && listingRank != null && listingRank === saleRank + 1) {
              matchType = "upgrade";
            }
          }
          if (!matchType) continue;

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
            est_profit: sale.sale_price - l.asking_price,
            match_type: matchType,
          });
        }

        // Sort by price ASC, take top 3
        matched.sort((a, b) => (a.price || Infinity) - (b.price || Infinity));

        results.push({
          sale,
          matches: matched.slice(0, 3),
        });
      }

      return results;
    },
    enabled: !!accountId,
  });

  const filtered = (data || []).filter((g) => !dismissedIds.has(g.sale.id));

  return {
    groups: filtered,
    isLoading,
    refetch,
    dismissSale,
    clearDismissed,
    dismissedCount: dismissedIds.size,
  };
}
