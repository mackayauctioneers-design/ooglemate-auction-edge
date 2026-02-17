import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useCallback } from "react";

/* ── Types ── */

export interface ProfitPattern {
  id: string;
  account_id: string;
  make: string;
  model: string;
  trim_class: string;
  year_min: number;
  year_max: number;
  km_min: number;
  km_max: number;
  total_flips: number;
  median_buy_price: number;
  median_sell_price: number;
  median_profit: number;
  median_km: number | null;
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
  est_profit: number | null;
  under_median_buy: number | null;
  match_type: "exact" | "upgrade";
}

export interface PatternWithMatches {
  pattern: ProfitPattern;
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

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function yearBand(year: number): [number, number] {
  const base = Math.floor((year - 1) / 3) * 3 + 1; // e.g. 2022 → 2022, 2024 → 2022
  // Simpler: 3-year windows aligned to decades
  const lo = year - ((year - 2000) % 3);
  return [lo, lo + 2];
}

function kmBand(km: number): [number, number] {
  if (km < 50000) return [0, 50000];
  if (km < 100000) return [50000, 100000];
  if (km < 150000) return [100000, 150000];
  return [150000, 999999];
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

  const dismissPattern = useCallback((patternKey: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(patternKey);
      persistDismissedIds(accountId, next);
      return next;
    });
  }, [accountId]);

  const clearDismissed = useCallback(() => {
    setDismissedIds(new Set());
    localStorage.removeItem(getDismissedKey(accountId));
  }, [accountId]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["buy-again-patterns", accountId],
    queryFn: async (): Promise<PatternWithMatches[]> => {
      // ─── STEP 1: Build profit patterns from sales ───
      const { data: sales, error: sErr } = await supabase
        .from("vehicle_sales_truth")
        .select("id, account_id, make, model, badge, variant, description_raw, year, km, sale_price, buy_price, sold_at, drive_type")
        .eq("account_id", accountId)
        .not("buy_price", "is", null)
        .not("sale_price", "is", null)
        .limit(1000);
      if (sErr) throw sErr;
      if (!sales?.length) return [];

      // Group sales into pattern bands
      const patternMap = new Map<string, {
        make: string; model: string; trim_class: string;
        year_min: number; year_max: number;
        km_min: number; km_max: number;
        buy_prices: number[]; sell_prices: number[]; profits: number[]; kms: number[];
        drivetrains: Set<string>;
      }>();

      for (const s of sales) {
        if (!s.make || !s.model) continue;
        const buyPrice = Number(s.buy_price || 0);
        const sellPrice = s.sale_price || 0;
        const profit = sellPrice - buyPrice;
        if (profit <= 0) continue; // only profitable sales

        const trim = deriveTrimClass(s.make, s.model, s.variant || s.badge || s.description_raw);
        const [yMin, yMax] = s.year ? yearBand(s.year) : [0, 0];
        const [kMin, kMax] = s.km != null ? kmBand(s.km) : [0, 999999];

        if (!s.year) continue;

        const key = `${s.make}|${s.model}|${trim}|${yMin}-${yMax}|${kMin}-${kMax}`;

        if (!patternMap.has(key)) {
          patternMap.set(key, {
            make: s.make, model: s.model, trim_class: trim,
            year_min: yMin, year_max: yMax,
            km_min: kMin, km_max: kMax,
            buy_prices: [], sell_prices: [], profits: [], kms: [],
            drivetrains: new Set(),
          });
        }
        const p = patternMap.get(key)!;
        p.buy_prices.push(buyPrice);
        p.sell_prices.push(sellPrice);
        p.profits.push(profit);
        if (s.km != null) p.kms.push(s.km);

        const dt = s.drive_type || extractDrivetrain(s.description_raw);
        if (dt) p.drivetrains.add(dt.toUpperCase());
      }

      // Filter: need ≥ 2 flips and ≥ $2000 median profit (relaxed slightly for more patterns)
      const patterns: (ProfitPattern & { drivetrains: Set<string> })[] = [];
      for (const [, p] of patternMap) {
        if (p.profits.length < 2) continue;
        const medProfit = median(p.profits);
        if (medProfit < 2000) continue;

        patterns.push({
          id: `${p.make}|${p.model}|${p.trim_class}|${p.year_min}-${p.year_max}|${p.km_min}-${p.km_max}`,
          account_id: accountId,
          make: p.make,
          model: p.model,
          trim_class: p.trim_class,
          year_min: p.year_min,
          year_max: p.year_max,
          km_min: p.km_min,
          km_max: p.km_max,
          total_flips: p.profits.length,
          median_buy_price: Math.round(median(p.buy_prices)),
          median_sell_price: Math.round(median(p.sell_prices)),
          median_profit: Math.round(medProfit),
          median_km: p.kms.length ? Math.round(median(p.kms)) : null,
          drivetrains: p.drivetrains,
        });
      }

      if (!patterns.length) return [];

      // ─── STEP 2: Load trim ladder for upgrade matching ───
      const { data: trimLadder } = await supabase
        .from("trim_ladder")
        .select("make, model, trim_class, trim_rank");
      const trimRankMap = new Map<string, number>();
      for (const row of trimLadder || []) {
        trimRankMap.set(`${row.make}|${row.model}|${row.trim_class}`, row.trim_rank);
      }

      // ─── STEP 3: Pull active listings (fresh only — last 7 days) ───
      const freshCutoff = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data: listings, error: lErr } = await supabase
        .from("vehicle_listings")
        .select("id, make, model, variant_raw, variant_family, year, km, asking_price, listing_url, source, status, first_seen_at, drivetrain")
        .in("status", ["catalogue", "listed"])
        .gte("last_seen_at", freshCutoff)
        .order("asking_price", { ascending: true, nullsFirst: false })
        .limit(1000);
      if (lErr) throw lErr;

      // ─── STEP 3: Match listings against patterns ───
      const results: PatternWithMatches[] = [];

      for (const pattern of patterns) {
        const matched: LiveMatch[] = [];

        for (const l of listings || []) {
          if (!l.make || !l.model) continue;

          // Make exact
          if (l.make.toUpperCase() !== pattern.make.toUpperCase()) continue;
          // Model exact
          if (l.model.toUpperCase() !== pattern.model.toUpperCase()) continue;
          // Trim class: exact or one-step upgrade (never downgrade)
          const listingTrim = deriveTrimClass(l.make, l.model, l.variant_raw || l.variant_family);
          let matchType: "exact" | "upgrade" | null = null;

          if (listingTrim === pattern.trim_class) {
            matchType = "exact";
          } else {
            // Check trim ladder for one-step upgrade
            const makeUp = l.make.toUpperCase();
            const modelUp = l.model.toUpperCase();
            const patternRank = trimRankMap.get(`${makeUp}|${modelUp}|${pattern.trim_class}`);
            const listingRank = trimRankMap.get(`${makeUp}|${modelUp}|${listingTrim}`);
            if (patternRank != null && listingRank != null && listingRank === patternRank + 1) {
              matchType = "upgrade";
            }
          }
          if (!matchType) continue;

          // Year within band
          if (l.year && (l.year < pattern.year_min || l.year > pattern.year_max)) continue;
          // KM within band
          if (l.km != null && (l.km < pattern.km_min || l.km > pattern.km_max)) continue;

          // Drivetrain hard filter
          if (pattern.drivetrains.size > 0 && l.drivetrain) {
            const ld = l.drivetrain.toUpperCase();
            const patternIs4x4 = [...pattern.drivetrains].some(d => ["4X4", "4WD", "AWD"].includes(d));
            const listingIs4x4 = ["4X4", "4WD", "AWD"].includes(ld);
            if (patternIs4x4 !== listingIs4x4) continue;
          }

          const price = l.asking_price || 0;
          const estProfit = pattern.median_sell_price > 0 && price > 0
            ? pattern.median_sell_price - price : null;
          const underMedianBuy = pattern.median_buy_price > 0 && price > 0
            ? pattern.median_buy_price - price : null;

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
            est_profit: estProfit,
            under_median_buy: underMedianBuy,
            match_type: matchType,
          });
        }

        // Sort by asking price ASC (cheapest first)
        matched.sort((a, b) => (a.price || Infinity) - (b.price || Infinity));

        if (matched.length > 0) {
          results.push({ pattern, matches: matched.slice(0, 5) });
        }
      }

      // Sort: highest median_profit DESC, then most flips DESC
      results.sort((a, b) => {
        if (b.pattern.median_profit !== a.pattern.median_profit)
          return b.pattern.median_profit - a.pattern.median_profit;
        return b.pattern.total_flips - a.pattern.total_flips;
      });

      return results;
    },
    enabled: !!accountId,
  });

  const filtered = (data || []).filter((g) => !dismissedIds.has(g.pattern.id)).slice(0, 30);

  return {
    groups: filtered,
    isLoading,
    refetch,
    dismissPattern,
    clearDismissed,
    dismissedCount: dismissedIds.size,
  };
}
