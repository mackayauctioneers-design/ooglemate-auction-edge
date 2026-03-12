/**
 * Dealer Intelligence Analysis Engine
 * Computes insights from merged sales data for the onboarding report.
 */

export interface VehiclePerformance {
  make: string;
  model: string;
  variant: string;
  count: number;
  avgProfit: number;
  avgDaysToSell: number;
  avgSalePrice: number;
  avgBuyPrice: number;
  totalRevenue: number;
}

export interface KmBandProfit {
  model: string;
  make: string;
  bands: Record<string, { avgProfit: number; count: number }>;
}

export interface DealerSummary {
  totalSales: number;
  totalRevenue: number;
  avgProfit: number;
  avgDaysToSell: number;
  profitablePercentage: number;
  topMakes: { make: string; count: number }[];
  dateRange: { earliest: string; latest: string };
}

export interface DealerIntelligenceData {
  summary: DealerSummary;
  topPerformers: VehiclePerformance[];
  topProfitVehicles: VehiclePerformance[];
  worstProfitVehicles: VehiclePerformance[];
  slowestMovers: VehiclePerformance[];
  fastestMovers: VehiclePerformance[];
  kmHeatmap: KmBandProfit[];
}

interface SalesRow {
  make?: string;
  model?: string;
  variant?: string;
  year?: number;
  km?: number;
  sale_price?: number;
  buy_price?: number;
  gross_profit?: number;
  days_to_clear?: number;
  sold_at?: string;
}

const KM_BANDS = [
  { label: "0–20k", min: 0, max: 20000 },
  { label: "20–40k", min: 20000, max: 40000 },
  { label: "40–60k", min: 40000, max: 60000 },
  { label: "60–80k", min: 60000, max: 80000 },
  { label: "80–100k", min: 80000, max: 100000 },
  { label: "100k+", min: 100000, max: Infinity },
];

function parseCurrency(val: any): number | null {
  if (val == null || val === "") return null;
  let s = String(val).trim();
  const isNeg = s.startsWith("(") && s.endsWith(")");
  s = s.replace(/[($,)]/g, "");
  const num = parseFloat(s);
  if (isNaN(num)) return null;
  return isNeg ? -num : num;
}

function normalizeRows(rawRows: Record<string, string>[]): SalesRow[] {
  return rawRows.map((r) => {
    const salePrice = parseCurrency(r.sale_price);
    const buyPrice = parseCurrency(r.buy_price);
    const grossProfit = parseCurrency(r.gross_profit) ??
      (salePrice != null && buyPrice != null ? salePrice - buyPrice : null);

    return {
      make: r.make?.trim() || undefined,
      model: r.model?.trim() || undefined,
      variant: r.variant?.trim() || undefined,
      year: r.year ? parseInt(r.year) : undefined,
      km: r.km ? parseInt(String(r.km).replace(/[^0-9]/g, "")) || undefined : undefined,
      sale_price: salePrice ?? undefined,
      buy_price: buyPrice ?? undefined,
      gross_profit: grossProfit ?? undefined,
      days_to_clear: r.days_to_clear ? parseInt(r.days_to_clear) || undefined : undefined,
      sold_at: r.sold_at || undefined,
    };
  });
}

function groupByVehicle(rows: SalesRow[]): Map<string, SalesRow[]> {
  const groups = new Map<string, SalesRow[]>();
  for (const row of rows) {
    if (!row.make || !row.model) continue;
    const key = `${row.make.toUpperCase()}|${row.model.toUpperCase()}|${(row.variant || "").toUpperCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return groups;
}

function computePerformance(key: string, rows: SalesRow[]): VehiclePerformance {
  const [make, model, variant] = key.split("|");
  const profits = rows.filter((r) => r.gross_profit != null).map((r) => r.gross_profit!);
  const days = rows.filter((r) => r.days_to_clear != null).map((r) => r.days_to_clear!);
  const sales = rows.filter((r) => r.sale_price != null).map((r) => r.sale_price!);
  const buys = rows.filter((r) => r.buy_price != null).map((r) => r.buy_price!);

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  return {
    make,
    model,
    variant: variant || "",
    count: rows.length,
    avgProfit: Math.round(avg(profits)),
    avgDaysToSell: Math.round(avg(days)),
    avgSalePrice: Math.round(avg(sales)),
    avgBuyPrice: Math.round(avg(buys)),
    totalRevenue: sales.reduce((a, b) => a + b, 0),
  };
}

export function analyzeDealerSales(rawRows: Record<string, string>[]): DealerIntelligenceData {
  const rows = normalizeRows(rawRows);
  const groups = groupByVehicle(rows);

  // Build vehicle performance list
  const performances: VehiclePerformance[] = [];
  groups.forEach((groupRows, key) => {
    performances.push(computePerformance(key, groupRows));
  });

  // Top performers by volume
  const topPerformers = [...performances]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Top profit vehicles
  const topProfitVehicles = [...performances]
    .filter((p) => p.count >= 2 && p.avgProfit > 0)
    .sort((a, b) => b.avgProfit - a.avgProfit)
    .slice(0, 10);

  // Fastest movers
  const fastestMovers = [...performances]
    .filter((p) => p.count >= 2 && p.avgDaysToSell > 0)
    .sort((a, b) => a.avgDaysToSell - b.avgDaysToSell)
    .slice(0, 10);

  // KM heatmap — group by make|model (without variant) then by KM band
  const modelGroups = new Map<string, SalesRow[]>();
  for (const row of rows) {
    if (!row.make || !row.model || row.km == null || row.gross_profit == null) continue;
    const key = `${row.make.toUpperCase()}|${row.model.toUpperCase()}`;
    if (!modelGroups.has(key)) modelGroups.set(key, []);
    modelGroups.get(key)!.push(row);
  }

  const kmHeatmap: KmBandProfit[] = [];
  modelGroups.forEach((modelRows, key) => {
    if (modelRows.length < 2) return;
    const [make, model] = key.split("|");
    const bands: Record<string, { avgProfit: number; count: number }> = {};
    for (const band of KM_BANDS) {
      const inBand = modelRows.filter((r) => r.km! >= band.min && r.km! < band.max);
      if (inBand.length > 0) {
        const profits = inBand.map((r) => r.gross_profit!);
        bands[band.label] = {
          avgProfit: Math.round(profits.reduce((a, b) => a + b, 0) / profits.length),
          count: inBand.length,
        };
      }
    }
    if (Object.keys(bands).length > 0) {
      kmHeatmap.push({ make, model, bands });
    }
  });

  // Sort heatmap by total count
  kmHeatmap.sort((a, b) => {
    const totalA = Object.values(a.bands).reduce((s, v) => s + v.count, 0);
    const totalB = Object.values(b.bands).reduce((s, v) => s + v.count, 0);
    return totalB - totalA;
  });

  // Summary stats
  const allProfits = rows.filter((r) => r.gross_profit != null).map((r) => r.gross_profit!);
  const allDays = rows.filter((r) => r.days_to_clear != null).map((r) => r.days_to_clear!);
  const allSales = rows.filter((r) => r.sale_price != null).map((r) => r.sale_price!);
  const dates = rows.filter((r) => r.sold_at).map((r) => r.sold_at!).sort();

  const makeCount = new Map<string, number>();
  for (const r of rows) {
    if (!r.make) continue;
    makeCount.set(r.make, (makeCount.get(r.make) || 0) + 1);
  }

  const summary: DealerSummary = {
    totalSales: rows.length,
    totalRevenue: allSales.reduce((a, b) => a + b, 0),
    avgProfit: allProfits.length ? Math.round(allProfits.reduce((a, b) => a + b, 0) / allProfits.length) : 0,
    avgDaysToSell: allDays.length ? Math.round(allDays.reduce((a, b) => a + b, 0) / allDays.length) : 0,
    profitablePercentage: allProfits.length
      ? Math.round((allProfits.filter((p) => p > 0).length / allProfits.length) * 100)
      : 0,
    topMakes: [...makeCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([make, count]) => ({ make, count })),
    dateRange: {
      earliest: dates[0] || "",
      latest: dates[dates.length - 1] || "",
    },
  };

  return {
    summary,
    topPerformers,
    topProfitVehicles,
    fastestMovers,
    kmHeatmap: kmHeatmap.slice(0, 8),
  };
}
