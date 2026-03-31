import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Clock, DollarSign, BarChart3, Loader2 } from "lucide-react";

export interface EnrichmentData {
  id: string;
  matched_opportunity_id: string;
  market_median_price: number | null;
  market_price_low: number | null;
  market_price_high: number | null;
  ajh_median_sell_price: number | null;
  ajh_median_gross: number | null;
  ajh_median_days_in_stock: number | null;
  ajh_sales_count: number | null;
  auction_guide_price: number | null;
  estimated_landed_cost: number | null;
  projected_gross: number | null;
  price_vs_market_pct: number | null;
  gross_vs_ajh_median_pct: number | null;
  liquidity_band: string | null;
  profit_band: string | null;
  summary_text: string | null;
  comps_sample: any[] | null;
}

interface Props {
  enrichment: EnrichmentData | null;
  loading?: boolean;
}

const profitBandStyles: Record<string, string> = {
  green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  orange: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  red: "bg-red-500/10 text-red-400 border-red-500/30",
};

const profitBandLabels: Record<string, string> = {
  green: "Strong",
  orange: "Tight",
  red: "Weak",
};

const liquidityLabels: Record<string, string> = {
  fast: "Fast mover",
  normal: "Normal",
  slow: "Slow mover",
};

export function OpportunityEnrichmentPanel({ enrichment, loading }: Props) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2 border-t border-border mt-2">
        <Loader2 className="h-3 w-3 animate-spin" />
        Analysing this opportunity…
      </div>
    );
  }

  if (!enrichment) return null;

  const band = enrichment.profit_band || "red";
  const fmt = (n: number | null) => n != null ? `$${Math.round(n).toLocaleString()}` : "—";

  return (
    <div className="space-y-2 pt-2 mt-2 border-t border-border">
      {/* Summary text */}
      {enrichment.summary_text && (
        <p className="text-xs text-muted-foreground leading-relaxed italic">
          "{enrichment.summary_text}"
        </p>
      )}

      {/* Key metrics row */}
      <div className="grid grid-cols-3 gap-2">
        {/* Projected Gross */}
        <div className="text-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Proj. Gross</div>
          <div className="text-sm font-semibold text-foreground">
            {fmt(enrichment.projected_gross)}
          </div>
        </div>

        {/* Market Median */}
        <div className="text-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Market</div>
          <div className="text-sm font-semibold text-foreground">
            {fmt(enrichment.market_median_price)}
          </div>
        </div>

        {/* Landed Cost */}
        <div className="text-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Landed</div>
          <div className="text-sm font-semibold text-foreground">
            {fmt(enrichment.estimated_landed_cost)}
          </div>
        </div>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Profit band */}
        <Badge variant="outline" className={`text-[10px] gap-1 ${profitBandStyles[band] || profitBandStyles.red}`}>
          {band === "green" ? <TrendingUp className="h-3 w-3" /> : band === "orange" ? <DollarSign className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {profitBandLabels[band] || "Unknown"}
        </Badge>

        {/* Liquidity */}
        {enrichment.liquidity_band && (
          <Badge variant="outline" className="text-[10px] gap-1">
            <Clock className="h-3 w-3" />
            {liquidityLabels[enrichment.liquidity_band] || enrichment.liquidity_band}
          </Badge>
        )}

        {/* Price vs market */}
        {enrichment.price_vs_market_pct != null && (
          <Badge variant="outline" className="text-[10px] gap-1">
            <BarChart3 className="h-3 w-3" />
            {enrichment.price_vs_market_pct > 0 ? "+" : ""}{enrichment.price_vs_market_pct}% vs market
          </Badge>
        )}

        {/* History count */}
        {enrichment.ajh_sales_count != null && enrichment.ajh_sales_count > 0 && (
          <Badge variant="outline" className="text-[10px]">
            {enrichment.ajh_sales_count} sold
          </Badge>
        )}
      </div>
    </div>
  );
}
