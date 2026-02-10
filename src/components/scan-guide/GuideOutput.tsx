import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TrendingUp, Package, Compass, ShieldCheck, Info } from "lucide-react";

interface SalesTruth {
  count_sold: number;
  median_sale_price: number | null;
  median_days_to_clear: number | null;
  median_margin: number | null;
  median_margin_pct: number | null;
  has_outcome_data: boolean;
  year_band: string | null;
}

interface SupplyContext {
  comps_found: number;
  cheapest_price: number | null;
  cheapest_km: number | null;
  rank_among_comps: number | null;
  total_comps: number;
  position_label: string;
}

interface GuideSummary {
  position_label: string;
  identity_label: string;
  sales_narrative: string;
  supply_narrative: string;
  guide_narrative: string;
  data_scope_footer: string;
}

interface GuideOutputProps {
  salesTruth: SalesTruth;
  supplyContext: SupplyContext;
  guideSummary: GuideSummary;
  confidence: "high" | "medium" | "low";
  identityConfidence: string;
  salesDepthConfidence: string;
  supplyCoverageConfidence: string;
}

const confColors: Record<string, string> = {
  high: "bg-green-500/20 text-green-700 border-green-500/30",
  medium: "bg-yellow-500/20 text-yellow-700 border-yellow-500/30",
  low: "bg-red-500/20 text-red-700 border-red-500/30",
};

function ConfBadge({ level, label }: { level: string; label: string }) {
  return (
    <Badge className={cn("text-xs capitalize", confColors[level] || confColors.low)}>
      {label}: {level}
    </Badge>
  );
}

export function GuideOutput({
  salesTruth,
  supplyContext,
  guideSummary,
  confidence,
  identityConfidence,
  salesDepthConfidence,
  supplyCoverageConfidence,
}: GuideOutputProps) {
  const fmt = (n: number | null) => n != null ? `$${n.toLocaleString()}` : "—";

  return (
    <div className="space-y-4">
      {/* Overall Confidence */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge className={cn("capitalize text-sm px-3 py-1", confColors[confidence])}>
          <ShieldCheck className="h-3.5 w-3.5 mr-1" />
          {confidence} Confidence
        </Badge>
        <ConfBadge level={identityConfidence} label="Identity" />
        <ConfBadge level={salesDepthConfidence} label="Sales depth" />
        <ConfBadge level={supplyCoverageConfidence} label="Supply" />
      </div>

      {/* A) Sales Truth */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Sales Truth
            <span className="text-xs text-muted-foreground font-normal">(Your reality)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {salesTruth.count_sold > 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-foreground">{guideSummary.sales_narrative}</p>
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="bg-muted/50 rounded-md p-2.5">
                  <p className="text-xs text-muted-foreground">Similar sold</p>
                  <p className="text-lg font-semibold">{salesTruth.count_sold}</p>
                </div>
                <div className="bg-muted/50 rounded-md p-2.5">
                  <p className="text-xs text-muted-foreground">Median sale price</p>
                  <p className="text-lg font-semibold">{fmt(salesTruth.median_sale_price)}</p>
                </div>
                {salesTruth.median_days_to_clear != null && (
                  <div className="bg-muted/50 rounded-md p-2.5">
                    <p className="text-xs text-muted-foreground">Median days to clear</p>
                    <p className="text-lg font-semibold">{salesTruth.median_days_to_clear}</p>
                  </div>
                )}
                {salesTruth.median_margin != null && (
                  <div className="bg-muted/50 rounded-md p-2.5">
                    <p className="text-xs text-muted-foreground">Median margin</p>
                    <p className="text-lg font-semibold">{fmt(salesTruth.median_margin)}</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">You have not sold this vehicle type before.</p>
          )}
        </CardContent>
      </Card>

      {/* B) Live Supply Context */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            Live Supply Context
            <span className="text-xs text-muted-foreground font-normal">(Market reality)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {supplyContext.comps_found > 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-foreground">{guideSummary.supply_narrative}</p>
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="bg-muted/50 rounded-md p-2.5">
                  <p className="text-xs text-muted-foreground">Cheapest seen</p>
                  <p className="text-lg font-semibold">{fmt(supplyContext.cheapest_price)}</p>
                </div>
                <div className="bg-muted/50 rounded-md p-2.5">
                  <p className="text-xs text-muted-foreground">Comparable listings</p>
                  <p className="text-lg font-semibold">{supplyContext.comps_found}</p>
                </div>
                {supplyContext.rank_among_comps && (
                  <div className="bg-muted/50 rounded-md p-2.5 col-span-2">
                    <p className="text-xs text-muted-foreground">This listing ranks</p>
                    <p className="text-lg font-semibold">#{supplyContext.rank_among_comps} of {supplyContext.total_comps}</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No comparable listings currently indexed.</p>
          )}
        </CardContent>
      </Card>

      {/* C) Carbitrage Guide */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Compass className="h-4 w-4 text-primary" />
            Carbitrage Guide
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-foreground font-medium">{guideSummary.guide_narrative}</p>
          {supplyContext.position_label && supplyContext.position_label !== "Unknown" && (
            <div className="mt-3">
              <Badge variant="outline" className="text-base px-4 py-1.5 font-semibold">
                {supplyContext.position_label}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Data scope footer */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-md p-3">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <p>{guideSummary.data_scope_footer}</p>
      </div>
    </div>
  );
}
