import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, TrendingDown, Gauge, Calendar, Truck, ShieldCheck, AlertTriangle, X } from "lucide-react";
import { format } from "date-fns";
import type { DealerLiveOpportunity } from "@/hooks/useDealerLiveOpportunities";

interface Props {
  opportunity: DealerLiveOpportunity;
  onDismiss?: (id: string) => void;
  onWatch?: (id: string) => void;
}

const fmt$ = (v: number | null | undefined) =>
  v != null ? `$${Math.round(v).toLocaleString()}` : "—";

export function LiveOpportunityCard({ opportunity: opp, onDismiss, onWatch }: Props) {
  const why = opp.why_json || {};
  const vehicle = [opp.year, opp.make, opp.model, opp.variant].filter(Boolean).join(" ");
  const score = opp.fingerprint_match_score != null ? Math.round(Number(opp.fingerprint_match_score)) : null;
  const confidence = (opp.confidence || "").toLowerCase();
  const positiveMargin = (opp.estimated_margin ?? 0) > 0;

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm text-foreground truncate">
              {vehicle || "Unknown vehicle"}
            </h3>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
              {opp.km != null && (
                <span className="inline-flex items-center gap-1">
                  <Gauge className="h-3 w-3" /> {opp.km.toLocaleString()} km
                </span>
              )}
              <span>· via {opp.source}</span>
            </div>
          </div>
          {score != null && (
            <Badge variant="outline" className="font-mono shrink-0">
              {score}/100
            </Badge>
          )}
        </div>

        {/* Pricing strip */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-muted/30 rounded p-2">
            <p className="text-[10px] text-muted-foreground uppercase">Asking</p>
            <p className="font-semibold text-sm mono">{fmt$(opp.price)}</p>
          </div>
          <div className="bg-muted/30 rounded p-2">
            <p className="text-[10px] text-muted-foreground uppercase">Proven Exit</p>
            <p className="font-semibold text-sm mono">{fmt$(why.proven_exit_value)}</p>
          </div>
          <div className={`rounded p-2 ${positiveMargin ? "bg-emerald-500/15" : "bg-muted/30"}`}>
            <p className="text-[10px] text-muted-foreground uppercase">Est. Margin</p>
            <p className={`font-bold text-sm mono ${positiveMargin ? "text-emerald-500" : "text-foreground"}`}>
              {fmt$(opp.estimated_margin)}
            </p>
          </div>
        </div>

        {/* Gap highlight */}
        {why.gap_dollars != null && why.gap_dollars > 0 && (
          <div className="flex items-center gap-1 text-xs text-emerald-500">
            <TrendingDown className="h-3 w-3" />
            <span className="font-medium">
              {fmt$(why.gap_dollars)}
              {why.gap_pct != null && ` (${why.gap_pct.toFixed(1)}%)`} below proven exit
            </span>
          </div>
        )}

        {/* Fingerprint label + sales evidence */}
        {(why.fingerprint_label || why.sales_count != null) && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {why.fingerprint_label && (
              <span className="font-medium text-foreground">{why.fingerprint_label}</span>
            )}
            {why.sales_count != null && (
              <span> · {why.sales_count} prior {why.sales_count === 1 ? "sale" : "sales"}</span>
            )}
          </p>
        )}

        {/* Reason chips */}
        {Array.isArray(why.reasons) && why.reasons.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {why.reasons.map((r) => (
              <Badge key={r} variant="secondary" className="text-[10px]">
                {r.replace(/_/g, " ")}
              </Badge>
            ))}
          </div>
        )}

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          {confidence === "high" ? (
            <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500 gap-1">
              <ShieldCheck className="h-3 w-3" /> High confidence
            </Badge>
          ) : confidence ? (
            <Badge variant="outline" className="text-[10px] gap-1">
              <AlertTriangle className="h-3 w-3" /> {confidence} confidence
            </Badge>
          ) : null}
          {opp.auction_date && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" /> {format(new Date(opp.auction_date), "dd MMM, HH:mm")}
            </span>
          )}
          {opp.freight_cost != null && opp.freight_cost > 0 && (
            <span className="inline-flex items-center gap-1">
              <Truck className="h-3 w-3" /> {fmt$(opp.freight_cost)} freight
            </span>
          )}
          {opp.status && opp.status !== "new" && (
            <Badge variant="outline" className="text-[10px]">{opp.status}</Badge>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          {opp.listing_url ? (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs gap-1"
              onClick={() => window.open(opp.listing_url!, "_blank")}
            >
              <ExternalLink className="h-3 w-3" /> Open listing
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="flex-1 text-xs" disabled>
              No link
            </Button>
          )}
          {onWatch && opp.status === "new" && (
            <Button variant="secondary" size="sm" className="text-xs" onClick={() => onWatch(opp.id)}>
              Watch
            </Button>
          )}
          {onDismiss && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => onDismiss(opp.id)}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
