import { FingerprintTarget } from "@/hooks/useBuyAgainTargets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  XCircle,
  Search,
  Pause,
  Play,
  Trash2,
  AlertTriangle,
} from "lucide-react";

interface TargetCardProps {
  target: FingerprintTarget;
  mode: "candidate" | "active" | "paused";
  onPromote?: () => void;
  onDismiss?: () => void;
  onSearch?: () => void;
  onPause?: () => void;
  onRetire?: () => void;
  onReactivate?: () => void;
}

export function TargetCard({
  target: t,
  mode,
  onPromote,
  onDismiss,
  onSearch,
  onPause,
  onRetire,
  onReactivate,
}: TargetCardProps) {
  const dnaLabel = [
    t.year_from && t.year_to
      ? `${t.year_from}–${t.year_to}`
      : t.year_from || t.year_to || null,
    t.make,
    t.model,
    t.variant,
    t.drive_type,
  ]
    .filter(Boolean)
    .join(" ");

  const confidenceBadge =
    t.confidence_level === "HIGH"
      ? "bg-green-500/10 text-green-700 border-green-300"
      : t.confidence_level === "MEDIUM"
      ? "bg-blue-500/10 text-blue-700 border-blue-300"
      : "bg-muted text-muted-foreground border-border";

  const suspiciousProfit =
    t.median_profit != null &&
    t.median_sale_price != null &&
    t.median_sale_price > 0 &&
    t.median_profit / t.median_sale_price > 0.3;

  return (
    <Card
      className={
        mode === "active"
          ? "border-primary/30"
          : mode === "paused"
          ? "opacity-60 border-muted"
          : ""
      }
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base leading-tight">{dnaLabel}</CardTitle>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge variant="outline" className={confidenceBadge + " text-xs"}>
              {t.confidence_level}
            </Badge>
            <div
              className={`inline-flex items-center justify-center w-7 h-7 rounded-md font-bold text-xs ${
                t.target_score >= 70
                  ? "bg-green-500/10 text-green-700"
                  : t.target_score >= 40
                  ? "bg-yellow-500/10 text-yellow-700"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {Math.round(t.target_score)}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Stats row */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>
            Sold{" "}
            <strong className="text-foreground">{t.total_sales}×</strong>
          </span>
          {t.median_profit != null && (
            <span>
              Profit{" "}
              <strong className="text-foreground">
                ${t.median_profit.toLocaleString()}
              </strong>
            </span>
          )}
          {t.median_days_to_clear != null ? (
            <span>
              Clears{" "}
              <strong className="text-foreground">
                {t.median_days_to_clear}d
              </strong>
            </span>
          ) : (
            <span className="italic text-xs">Clearance data unavailable</span>
          )}
          {t.median_sale_price != null && (
            <span>
              Median{" "}
              <strong className="text-foreground">
                ${t.median_sale_price.toLocaleString()}
              </strong>
            </span>
          )}
        </div>

        {/* Warnings */}
        {t.spec_completeness < 3 && (
          <p className="text-xs text-amber-600 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            Spec incomplete — confidence limited
          </p>
        )}
        {suspiciousProfit && (
          <p className="text-xs text-amber-600 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            Derived or low-confidence profit — verify source
          </p>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={onSearch}>
            <Search className="h-3.5 w-3.5 mr-1" />
            Search Listings
          </Button>
          {mode === "candidate" && (
            <>
              <Button
                size="sm"
                variant="default"
                onClick={onPromote}
                className="bg-green-600 hover:bg-green-700"
              >
                <CheckCircle className="h-3.5 w-3.5 mr-1" />
                Promote
              </Button>
              <Button size="sm" variant="ghost" onClick={onDismiss}>
                <XCircle className="h-3.5 w-3.5 mr-1" />
                Dismiss
              </Button>
            </>
          )}
          {mode === "active" && (
            <>
              <Button size="sm" variant="ghost" onClick={onPause}>
                <Pause className="h-3.5 w-3.5 mr-1" />
                Pause
              </Button>
              <Button size="sm" variant="ghost" onClick={onRetire}>
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Retire
              </Button>
            </>
          )}
          {mode === "paused" && (
            <>
              <Button size="sm" variant="outline" onClick={onReactivate}>
                <Play className="h-3.5 w-3.5 mr-1" />
                Reactivate
              </Button>
              <Button size="sm" variant="ghost" onClick={onRetire}>
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Retire
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
