import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface YearBandRow {
  yearBand: string;
  yearMin: number;
  yearMax: number;
  salesCount: number;
  medianSalePrice: number | null;
  medianDaysToClear: number | null;
  medianProfitDollars: number | null;
  medianKm: number | null;
}

export interface SpecRow {
  variant: string | null;
  transmission: string | null;
  fuelType: string | null;
  salesCount: number;
  medianSalePrice: number | null;
  medianDaysToClear: number | null;
  medianProfitDollars: number | null;
  medianKm: number | null;
}

function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function medianDecimal(arr: number[]): number | null {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const val = s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return Math.round(val * 10000) / 10000;
}

function buildYearBand(year: number): { label: string; min: number; max: number } {
  // 3-year bands: 2023-2025, 2020-2022, 2017-2019, etc.
  const bandStart = year - ((year - 2000) % 3);
  const bandEnd = bandStart + 2;
  return { label: `${bandStart}–${bandEnd}`, min: bandStart, max: bandEnd };
}

interface RawRow {
  year: number;
  variant: string | null;
  transmission: string | null;
  fuel_type: string | null;
  sale_price: number | null;
  buy_price: number | null;
  profit_pct: number | null;
  days_to_clear: number | null;
  km: number | null;
  sold_at: string;
}

export function useSalesDrillDown(
  accountId: string | null,
  make: string | null,
  model: string | null,
  rangeMonths: number | null // null = all time
) {
  return useQuery({
    queryKey: ["sales-drill-down", accountId, make, model, rangeMonths],
    queryFn: async () => {
      if (!accountId || !make || !model) return { yearBands: [], rawRows: [] };

      let query = supabase
        .from("vehicle_sales_truth" as any)
        .select("year, variant, transmission, fuel_type, sale_price, buy_price, profit_pct, days_to_clear, km, sold_at")
        .eq("account_id", accountId)
        .eq("make", make)
        .eq("model", model)
        .order("year", { ascending: false });

      if (rangeMonths) {
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - rangeMonths);
        query = query.gte("sold_at", cutoff.toISOString().slice(0, 10));
      }

      const { data, error } = await query.limit(500);
      if (error) throw error;
      const rows = (data || []) as unknown as RawRow[];

      // Build year bands
      const bandMap: Record<string, { min: number; max: number; prices: number[]; days: number[]; profitDollars: number[]; kms: number[]; count: number }> = {};
      rows.forEach((r) => {
        if (!r.year) return;
        const band = buildYearBand(r.year);
        if (!bandMap[band.label]) {
          bandMap[band.label] = { min: band.min, max: band.max, prices: [], days: [], profitDollars: [], kms: [], count: 0 };
        }
        const b = bandMap[band.label];
        b.count++;
        if (r.sale_price) b.prices.push(r.sale_price);
        if (r.days_to_clear != null) b.days.push(r.days_to_clear);
        if (r.sale_price != null && r.buy_price != null) b.profitDollars.push(r.sale_price - r.buy_price);
        if (r.km) b.kms.push(r.km);
      });

      const yearBands: YearBandRow[] = Object.entries(bandMap)
        .map(([label, b]) => ({
          yearBand: label,
          yearMin: b.min,
          yearMax: b.max,
          salesCount: b.count,
          medianSalePrice: median(b.prices),
          medianDaysToClear: median(b.days),
          medianProfitDollars: median(b.profitDollars),
          medianKm: median(b.kms),
        }))
        .sort((a, b) => b.yearMax - a.yearMax);

      return { yearBands, rawRows: rows };
    },
    enabled: !!accountId && !!make && !!model,
  });
}

export function buildSpecBreakdown(
  rows: RawRow[],
  yearMin: number,
  yearMax: number
): SpecRow[] {
  const filtered = rows.filter((r) => r.year >= yearMin && r.year <= yearMax);

  const specMap: Record<string, { prices: number[]; days: number[]; profitDollars: number[]; kms: number[]; count: number; variant: string | null; transmission: string | null; fuelType: string | null }> = {};

  filtered.forEach((r) => {
    const v = r.variant?.trim() || null;
    const t = r.transmission?.trim() || null;
    const f = r.fuel_type?.trim() || null;
    const key = `${v || "—"}|${t || "—"}|${f || "—"}`;
    if (!specMap[key]) {
      specMap[key] = { prices: [], days: [], profitDollars: [], kms: [], count: 0, variant: v, transmission: t, fuelType: f };
    }
    const s = specMap[key];
    s.count++;
    if (r.sale_price) s.prices.push(r.sale_price);
    if (r.days_to_clear != null) s.days.push(r.days_to_clear);
    if (r.sale_price != null && r.buy_price != null) s.profitDollars.push(r.sale_price - r.buy_price);
    if (r.km) s.kms.push(r.km);
  });

  return Object.values(specMap)
    .map((s) => ({
      variant: s.variant,
      transmission: s.transmission,
      fuelType: s.fuelType,
      salesCount: s.count,
      medianSalePrice: median(s.prices),
      medianDaysToClear: median(s.days),
      medianProfitDollars: s.profitDollars.length >= 3 ? median(s.profitDollars) : null,
      medianKm: median(s.kms),
    }))
    .sort((a, b) => b.salesCount - a.salesCount);
}
