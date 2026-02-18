import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useCallback } from "react";

/* ── Types ── */

export interface FlipPattern {
  key: string;
  make: string;
  model: string;
  trim_class: string;
  drive_type: string | null;
  total_flips: number;
  median_buy_price: number;
  median_sell_price: number;
  median_profit: number;
  median_days_to_sell: number | null;
  median_year: number;
  median_km: number | null;
}

export interface RankedMatch {
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
  margin_score: number;
  speed_score: number;
  liquidity_score: number;
  balanced_score: number;
  match_type: "exact" | "upgrade";
}

export interface PatternWithMatches {
  pattern: FlipPattern;
  matches: RankedMatch[];
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

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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

function normDrive(d: string | null): string | null {
  if (!d) return null;
  const u = d.toUpperCase();
  if (["4X4", "4WD", "AWD"].includes(u)) return "4X4";
  if (["2WD", "FWD", "RWD"].includes(u)) return "2WD";
  return u;
}

/* ── Dismiss helpers ── */

const DISMISS_KEY = "buy-again-dismissed-patterns";
function getDismissedKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}
function persistDismissedKeys(keys: Set<string>) {
  localStorage.setItem(DISMISS_KEY, JSON.stringify([...keys]));
}

/* ── Hook ── */

export function useBuyAgainTargets(_accountId?: string) {
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(getDismissedKeys);

  const dismissPattern = useCallback((key: string) => {
    setDismissedKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      persistDismissedKeys(next);
      return next;
    });
  }, []);

  const clearDismissed = useCallback(() => {
    setDismissedKeys(new Set());
    localStorage.removeItem(DISMISS_KEY);
  }, []);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["buy-again-flip-patterns"],
    queryFn: async (): Promise<PatternWithMatches[]> => {
      // ─── STEP 1: All profitable sales across ALL dealers ───
      const { data: sales, error: sErr } = await supabase
        .from("vehicle_sales_truth")
        .select("id, make, model, badge, variant, description_raw, year, km, sale_price, buy_price, sold_at, acquired_at, drive_type, days_to_clear")
        .not("buy_price", "is", null)
        .not("sale_price", "is", null)
        .order("sale_price", { ascending: false })
        .limit(1000);
      if (sErr) throw sErr;
      if (!sales?.length) return [];

      // ─── STEP 2: Group into flip patterns ───
      type SaleRow = typeof sales[number];
      const groups = new Map<string, { sales: SaleRow[]; trimClass: string; make: string; model: string; driveType: string | null }>();

      for (const s of sales) {
        if (!s.make || !s.model || !s.year) continue;
        const buyPrice = Number(s.buy_price || 0);
        const salePrice = Number(s.sale_price || 0);
        if (salePrice - buyPrice <= 0) continue;

        const variant = s.variant || s.badge || s.description_raw || null;
        const trimClass = deriveTrimClass(s.make, s.model, variant);
        const driveType = s.drive_type || extractDrivetrain(s.description_raw);
        const key = `${s.make.toUpperCase()}|${s.model.toUpperCase()}|${trimClass}`;

        if (!groups.has(key)) {
          groups.set(key, { sales: [], trimClass, make: s.make, model: s.model, driveType: driveType });
        }
        groups.get(key)!.sales.push(s);
      }

      // ─── STEP 3: Compute aggregates, filter ───
      const patterns: FlipPattern[] = [];

      for (const [key, g] of groups) {
        if (g.sales.length < 2) continue;

        const profits = g.sales.map((s) => Number(s.sale_price!) - Number(s.buy_price!));
        const medProfit = median(profits);
        if (medProfit < 1500) continue;

        const buyPrices = g.sales.map((s) => Number(s.buy_price!));
        const sellPrices = g.sales.map((s) => Number(s.sale_price!));
        const years = g.sales.filter((s) => s.year).map((s) => s.year!);
        const kms = g.sales.filter((s) => s.km != null).map((s) => s.km!);

        const daysArr: number[] = [];
        for (const s of g.sales) {
          if (s.days_to_clear != null) {
            daysArr.push(s.days_to_clear);
          } else if (s.acquired_at && s.sold_at) {
            const d = Math.floor((new Date(s.sold_at).getTime() - new Date(s.acquired_at).getTime()) / 86400000);
            if (d > 0 && d < 365) daysArr.push(d);
          }
        }

        patterns.push({
          key,
          make: g.make,
          model: g.model,
          trim_class: g.trimClass,
          drive_type: g.driveType,
          total_flips: g.sales.length,
          median_buy_price: Math.round(median(buyPrices)),
          median_sell_price: Math.round(median(sellPrices)),
          median_profit: Math.round(medProfit),
          median_days_to_sell: daysArr.length ? Math.round(median(daysArr)) : null,
          median_year: Math.round(median(years)),
          median_km: kms.length ? Math.round(median(kms)) : null,
        });
      }

      // Sort patterns by median_profit DESC
      patterns.sort((a, b) => b.median_profit - a.median_profit);

      // ─── STEP 4: Load trim ladder ───
      const { data: trimLadder } = await supabase
        .from("trim_ladder")
        .select("make, model, trim_class, trim_rank");
      const trimRankMap = new Map<string, number>();
      for (const row of trimLadder || []) {
        trimRankMap.set(`${row.make}|${row.model}|${row.trim_class}`, row.trim_rank);
      }

      // ─── STEP 5: Pull fresh listings ───
      const freshCutoff = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data: listings, error: lErr } = await supabase
        .from("vehicle_listings")
        .select("id, make, model, variant_raw, variant_family, year, km, asking_price, listing_url, source, status, first_seen_at, drivetrain")
        .in("status", ["catalogue", "listed"])
        .gte("last_seen_at", freshCutoff)
        .order("asking_price", { ascending: true, nullsFirst: false })
        .limit(1000);
      if (lErr) throw lErr;

      // ─── STEP 6: Match each pattern against listings ───
      const results: PatternWithMatches[] = [];

      for (const p of patterns) {
        const matched: RankedMatch[] = [];

        for (const l of listings || []) {
          if (!l.make || !l.model) continue;
          if (l.make.toUpperCase() !== p.make.toUpperCase()) continue;
          if (l.model.toUpperCase() !== p.model.toUpperCase()) continue;

          // Year within ±1 of pattern median
          if (l.year && Math.abs(l.year - p.median_year) > 1) continue;

          // KM within ±7500 of pattern median
          if (l.km != null && p.median_km != null && Math.abs(l.km - p.median_km) > 7500) continue;

          // Price must be below median sell
          if (!l.asking_price || l.asking_price >= p.median_sell_price) continue;

          // Drivetrain hard filter
          if (p.drive_type && l.drivetrain) {
            if (normDrive(p.drive_type) !== normDrive(l.drivetrain)) continue;
          }

          // Trim class: exact or one-step upgrade
          const listingTrim = deriveTrimClass(l.make, l.model, l.variant_raw || l.variant_family);
          let matchType: "exact" | "upgrade" | null = null;

          if (listingTrim === p.trim_class) {
            matchType = "exact";
          } else {
            const makeUp = l.make.toUpperCase();
            const modelUp = l.model.toUpperCase();
            const patternRank = trimRankMap.get(`${makeUp}|${modelUp}|${p.trim_class}`);
            const listingRank = trimRankMap.get(`${makeUp}|${modelUp}|${listingTrim}`);
            if (patternRank != null && listingRank != null && listingRank === patternRank + 1) {
              matchType = "upgrade";
            }
          }
          if (!matchType) continue;

          // Scoring
          const margin_score = p.median_sell_price - l.asking_price;
          const speed_score = p.median_days_to_sell != null ? 30 - p.median_days_to_sell : 0;
          const liquidity_score = Math.log(p.total_flips);
          const balanced_score =
            (margin_score * 0.6) +
            (speed_score * 120) +
            (liquidity_score * 400);

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
            est_profit: margin_score,
            margin_score,
            speed_score,
            liquidity_score: Math.round(liquidity_score * 100) / 100,
            balanced_score: Math.round(balanced_score),
            match_type: matchType,
          });
        }

        // Sort by balanced_score DESC, take top 3
        matched.sort((a, b) => b.balanced_score - a.balanced_score);

        results.push({
          pattern: p,
          matches: matched.slice(0, 3),
        });
      }

      return results;
    },
  });

  const filtered = (data || []).filter((g) => !dismissedKeys.has(g.pattern.key));

  return {
    groups: filtered,
    isLoading,
    refetch,
    dismissPattern,
    clearDismissed,
    dismissedCount: dismissedKeys.size,
  };
}
