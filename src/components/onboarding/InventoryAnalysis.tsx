import { Store, TrendingDown, TrendingUp } from "lucide-react";

export interface InventoryItem {
  title: string;
  listed_price: number;
  market_avg: number;
  gap: number;
  gap_pct: number;
}

export interface InventoryAnalysisData {
  totalVehicles: number;
  avgPriceVsMarket: number;
  overpriced: number;
  underpriced: number;
  underpricedVehicles: InventoryItem[];
  status: "pending" | "scanning" | "done" | "unavailable";
}

interface InventoryAnalysisProps {
  data: InventoryAnalysisData;
}

function formatCurrency(val: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(val);
}

export function InventoryAnalysis({ data }: InventoryAnalysisProps) {
  if (data.status === "unavailable") {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center">
        <Store className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No website provided — add your dealer URL to enable inventory analysis</p>
      </div>
    );
  }

  if (data.status === "pending" || data.status === "scanning") {
    return (
      <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-8 text-center animate-pulse">
        <Store className="h-8 w-8 text-primary/40 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">Scanning dealer website…</p>
        <p className="text-xs text-muted-foreground/60 mt-1">This usually takes 30–60 seconds</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border border-border bg-card p-3 text-center">
          <p className="text-xs text-muted-foreground">Inventory</p>
          <p className="text-lg font-bold text-foreground">{data.totalVehicles}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 text-center">
          <p className="text-xs text-muted-foreground">vs Market</p>
          <p className={`text-lg font-bold ${data.avgPriceVsMarket > 0 ? "text-primary" : "text-destructive"}`}>
            {data.avgPriceVsMarket > 0 ? "+" : ""}{data.avgPriceVsMarket.toFixed(1)}%
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 text-center">
          <p className="text-xs text-muted-foreground">Overpriced</p>
          <p className="text-lg font-bold text-foreground">{data.overpriced}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 text-center">
          <p className="text-xs text-muted-foreground">Under Market</p>
          <p className="text-lg font-bold text-primary">{data.underpriced}</p>
        </div>
      </div>

      {/* Underpriced vehicles */}
      {data.underpricedVehicles.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-primary" />
            <h4 className="font-semibold text-sm text-foreground">Underpriced on Your Lot</h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Vehicle</th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium">Listed</th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium">Market Avg</th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium">Gap</th>
                </tr>
              </thead>
              <tbody>
                {data.underpricedVehicles.slice(0, 5).map((v, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-foreground">{v.title}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{formatCurrency(v.listed_price)}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{formatCurrency(v.market_avg)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-destructive">{formatCurrency(v.gap)}</td>
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
