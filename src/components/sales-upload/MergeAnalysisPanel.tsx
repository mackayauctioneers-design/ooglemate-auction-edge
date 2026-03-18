import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { TrendingUp, Zap, BarChart3 } from "lucide-react";

interface MergeAnalysisPanelProps {
  rows: Record<string, string>[];
  mapping: Record<string, string>;
}

function num(val: any): number | null {
  if (val == null || val === "") return null;
  const s = String(val).replace(/[$,()]/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function fmt(n: number | null): string {
  if (n == null) return "—";
  return n < 0 ? `-$${Math.abs(Math.round(n)).toLocaleString()}` : `$${Math.round(n).toLocaleString()}`;
}

export function MergeAnalysisPanel({ rows, mapping }: MergeAnalysisPanelProps) {
  const canonicalToSource = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [src, canon] of Object.entries(mapping)) {
      if (canon) map[canon] = src;
    }
    return map;
  }, [mapping]);

  const get = (row: Record<string, string>, field: string) => {
    const src = canonicalToSource[field];
    return src ? row[src] ?? "" : "";
  };

  // KM vs Profit Bands
  const kmBands = useMemo(() => {
    const bands: Record<string, { profits: number[]; count: number }> = {
      "0–40k": { profits: [], count: 0 },
      "40–80k": { profits: [], count: 0 },
      "80–120k": { profits: [], count: 0 },
      "120k+": { profits: [], count: 0 },
    };

    for (const row of rows) {
      const km = num(get(row, "km"));
      const profit = num(get(row, "gross_profit"));
      if (km == null) continue;

      const band = km < 40000 ? "0–40k" : km < 80000 ? "40–80k" : km < 120000 ? "80–120k" : "120k+";
      bands[band].count++;
      if (profit != null) bands[band].profits.push(profit);
    }

    return Object.entries(bands).map(([label, data]) => ({
      label,
      count: data.count,
      avgProfit: data.profits.length > 0
        ? data.profits.reduce((a, b) => a + b, 0) / data.profits.length
        : null,
    }));
  }, [rows, canonicalToSource]);

  // Top Performers by make + model + year
  const topPerformers = useMemo(() => {
    const groups: Record<string, { profits: number[]; days: number[]; kms: number[] }> = {};

    for (const row of rows) {
      const make = get(row, "make");
      const model = get(row, "model");
      const year = get(row, "year");
      if (!make || !model) continue;

      const key = [make, model, year].filter(Boolean).join(" ");
      if (!groups[key]) groups[key] = { profits: [], days: [], kms: [] };

      const profit = num(get(row, "gross_profit"));
      const days = num(get(row, "days_to_clear"));
      const km = num(get(row, "km"));

      if (profit != null) groups[key].profits.push(profit);
      if (days != null) groups[key].days.push(days);
      if (km != null) groups[key].kms.push(km);
    }

    return Object.entries(groups)
      .filter(([, d]) => d.profits.length >= 2)
      .map(([vehicle, d]) => ({
        vehicle,
        count: d.profits.length,
        avgProfit: d.profits.reduce((a, b) => a + b, 0) / d.profits.length,
        avgDays: d.days.length > 0 ? Math.round(d.days.reduce((a, b) => a + b, 0) / d.days.length) : null,
        avgKm: d.kms.length > 0 ? Math.round(d.kms.reduce((a, b) => a + b, 0) / d.kms.length) : null,
      }))
      .sort((a, b) => b.avgProfit - a.avgProfit)
      .slice(0, 10);
  }, [rows, canonicalToSource]);

  // Fast Movers
  const fastMovers = useMemo(() => {
    const groups: Record<string, { days: number[]; profits: number[]; count: number }> = {};

    for (const row of rows) {
      const make = get(row, "make");
      const model = get(row, "model");
      if (!make || !model) continue;

      const key = `${make} ${model}`;
      if (!groups[key]) groups[key] = { days: [], profits: [], count: 0 };

      const days = num(get(row, "days_to_clear"));
      const profit = num(get(row, "gross_profit"));

      groups[key].count++;
      if (days != null) groups[key].days.push(days);
      if (profit != null) groups[key].profits.push(profit);
    }

    return Object.entries(groups)
      .filter(([, d]) => d.days.length >= 2)
      .map(([vehicle, d]) => ({
        vehicle,
        count: d.count,
        avgDays: Math.round(d.days.reduce((a, b) => a + b, 0) / d.days.length),
        avgProfit: d.profits.length > 0
          ? d.profits.reduce((a, b) => a + b, 0) / d.profits.length
          : null,
      }))
      .sort((a, b) => a.avgDays - b.avgDays)
      .slice(0, 10);
  }, [rows, canonicalToSource]);

  if (rows.length === 0) return null;

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-primary" />
        Pre-Import Analysis
      </h3>

      {/* KM vs Profit Bands */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          KM vs Profit Bands
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {kmBands.map((band) => (
            <div key={band.label} className="text-center p-3 rounded-md bg-muted/30">
              <p className="text-xs text-muted-foreground">{band.label}</p>
              <p className="text-base font-bold">{fmt(band.avgProfit)}</p>
              <p className="text-[10px] text-muted-foreground">{band.count} vehicles</p>
            </div>
          ))}
        </div>
      </div>

      {/* Top Performers */}
      {topPerformers.length > 0 && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <TrendingUp className="h-3.5 w-3.5" /> Top Performers
          </h4>
          <div className="overflow-auto max-h-[250px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Vehicle</TableHead>
                  <TableHead className="text-xs text-right">Count</TableHead>
                  <TableHead className="text-xs text-right">Avg Profit</TableHead>
                  <TableHead className="text-xs text-right">Avg Days</TableHead>
                  <TableHead className="text-xs text-right">Avg KM</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topPerformers.map((v, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs py-1.5 font-medium">{v.vehicle}</TableCell>
                    <TableCell className="text-xs py-1.5 text-right">
                      <Badge variant="secondary" className="text-[10px]">{v.count}</Badge>
                    </TableCell>
                    <TableCell className="text-xs py-1.5 text-right font-medium text-primary">
                      {fmt(v.avgProfit)}
                    </TableCell>
                    <TableCell className="text-xs py-1.5 text-right">
                      {v.avgDays != null ? `${v.avgDays}d` : "—"}
                    </TableCell>
                    <TableCell className="text-xs py-1.5 text-right">
                      {v.avgKm != null ? `${v.avgKm.toLocaleString()} km` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Fast Movers */}
      {fastMovers.length > 0 && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <Zap className="h-3.5 w-3.5" /> Fast Movers
          </h4>
          <div className="overflow-auto max-h-[250px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Vehicle</TableHead>
                  <TableHead className="text-xs text-right">Count</TableHead>
                  <TableHead className="text-xs text-right">Avg Days</TableHead>
                  <TableHead className="text-xs text-right">Avg Profit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fastMovers.map((v, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs py-1.5 font-medium">{v.vehicle}</TableCell>
                    <TableCell className="text-xs py-1.5 text-right">
                      <Badge variant="secondary" className="text-[10px]">{v.count}</Badge>
                    </TableCell>
                    <TableCell className="text-xs py-1.5 text-right font-bold text-primary">
                      {v.avgDays}d
                    </TableCell>
                    <TableCell className="text-xs py-1.5 text-right">
                      {fmt(v.avgProfit)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
