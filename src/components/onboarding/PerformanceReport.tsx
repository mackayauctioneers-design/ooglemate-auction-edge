import { TrendingUp, TrendingDown, Award, Zap, AlertTriangle, Clock } from "lucide-react";
import type { DealerIntelligenceData } from "@/utils/dealerIntelligence";

interface PerformanceReportProps {
  data: DealerIntelligenceData;
}

function formatCurrency(val: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(val);
}

export function PerformanceReport({ data }: PerformanceReportProps) {
  const { summary, topProfitVehicles, worstProfitVehicles, slowestMovers, fastestMovers, kmHeatmap } = data;
  const kmBandLabels = ["0–20k", "20–40k", "40–60k", "60–80k", "80–100k", "100k+"];

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Total Sales" value={String(summary.totalSales)} />
        <SummaryCard label="Avg Profit" value={formatCurrency(summary.avgProfit)} highlight />
        <SummaryCard label="Avg Days to Sell" value={`${summary.avgDaysToSell}d`} />
        <SummaryCard label="Profitable" value={`${summary.profitablePercentage}%`} />
      </div>

      {/* Top Profit Vehicles */}
      {topProfitVehicles.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Award className="h-4 w-4 text-primary" />
            <h4 className="font-semibold text-sm text-foreground">Top Profit Vehicles</h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Vehicle</th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium">Avg Profit</th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium">Days to Sell</th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium">Count</th>
                </tr>
              </thead>
              <tbody>
                {topProfitVehicles.slice(0, 6).map((v, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-foreground">
                      {v.make} {v.model} {v.variant && <span className="text-muted-foreground">{v.variant}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-primary">{formatCurrency(v.avgProfit)}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{v.avgDaysToSell}d</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{v.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Fastest Movers */}
      {fastestMovers.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            <h4 className="font-semibold text-sm text-foreground">Fastest Movers</h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Vehicle</th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium">Avg Days</th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium">Avg Profit</th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium">Count</th>
                </tr>
              </thead>
              <tbody>
                {fastestMovers.slice(0, 5).map((v, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-foreground">
                      {v.make} {v.model} {v.variant && <span className="text-muted-foreground">{v.variant}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-primary">{v.avgDaysToSell}d</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{formatCurrency(v.avgProfit)}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{v.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Profit Heatmap by KM Band */}
      {kmHeatmap.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h4 className="font-semibold text-sm text-foreground">Profit by KM Band</h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Model</th>
                  {kmBandLabels.map((b) => (
                    <th key={b} className="text-right px-3 py-2 text-muted-foreground font-medium text-xs">{b}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {kmHeatmap.slice(0, 6).map((row, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-foreground whitespace-nowrap">
                      {row.make} {row.model}
                    </td>
                    {kmBandLabels.map((band) => {
                      const cell = row.bands[band];
                      if (!cell) return <td key={band} className="px-3 py-2.5 text-right text-muted-foreground/30">—</td>;
                      const intensity = Math.min(Math.abs(cell.avgProfit) / 8000, 1);
                      const isPositive = cell.avgProfit > 0;
                      return (
                        <td
                          key={band}
                          className="px-3 py-2.5 text-right font-medium text-xs"
                          style={{
                            backgroundColor: isPositive
                              ? `hsl(var(--primary) / ${0.08 + intensity * 0.25})`
                              : `hsl(var(--destructive) / ${0.08 + intensity * 0.2})`,
                            color: isPositive ? "hsl(var(--primary))" : "hsl(var(--destructive))",
                          }}
                        >
                          {formatCurrency(cell.avgProfit)}
                          <span className="text-[10px] opacity-60 ml-0.5">({cell.count})</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${highlight ? "text-primary" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
