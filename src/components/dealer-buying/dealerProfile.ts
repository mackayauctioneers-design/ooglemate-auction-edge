export interface SaleRow { make: string | null; model: string | null; year: number | null; km: number | null; sale_price: number | null; days_to_clear: number | null; transmission: string | null }
export interface OppRow { id: string; make: string | null; model: string | null; year: number | null; km: number | null; best_under_buy: number | null; [k: string]: unknown }

const norm = (v: string | null | undefined) => (v ?? '').trim().toUpperCase();
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const range = (xs: number[]) => (xs.length ? { min: Math.min(...xs), max: Math.max(...xs) } : null);

/** Summarises recorded sales only; no pricing is derived. */
export function summariseSales(rows: SaleRow[]) {
  const models = new Map<string, { make: string; model: string; count: number }>();
  const makes = new Map<string, number>();
  for (const r of rows) {
    if (!r.make) continue;
    makes.set(norm(r.make), (makes.get(norm(r.make)) ?? 0) + 1);
    if (!r.model) continue;
    const key = `${norm(r.make)}|${norm(r.model)}`;
    const m = models.get(key) ?? { make: r.make, model: r.model, count: 0 };
    m.count++; models.set(key, m);
  }
  const num = (k: keyof SaleRow) => rows.map((r) => r[k]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  const gearboxes = new Set(rows.map((r) => norm(r.transmission)).filter(Boolean));
  return {
    count: rows.length,
    topMakes: [...makes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([make, count]) => ({ make, count })),
    topModels: [...models.values()].sort((a, b) => b.count - a.count),
    years: range(num('year')), km: range(num('km')), price: range(num('sale_price')),
    medianDays: median(num('days_to_clear')),
    gearboxes,
  };
}

export type SalesSummary = ReturnType<typeof summariseSales>;

/** Fit = sold make/model, year and km inside the sold range, gearbox when both sides know it. */
export function matchingCars<T extends OppRow>(opps: T[], s: SalesSummary, limit = 50): T[] {
  if (!s.count) return [];
  const allModels = new Set<string>();
  for (const m of s.topModels) allModels.add(`${norm(m.make)}|${norm(m.model)}`);
  return opps.filter((o) => {
    if (!allModels.has(`${norm(o.make)}|${norm(o.model)}`)) return false;
    if (s.years && (o.year == null || o.year < s.years.min || o.year > s.years.max)) return false;
    if (s.km && o.km != null && (o.km < s.km.min || o.km > s.km.max)) return false;
    const gb = norm(o.transmission as string | null);
    if (gb && s.gearboxes.size && !s.gearboxes.has(gb)) return false;
    return true;
  }).sort((a, b) => (b.best_under_buy ?? -Infinity) - (a.best_under_buy ?? -Infinity)).slice(0, limit);
}
