export interface FingerprintTarget {
  id: string;
  account_id: string;
  make: string;
  model: string;
  variant: string | null;
  year_from: number | null;
  year_to: number | null;
  transmission: string | null;
  fuel_type: string | null;
  drive_type: string | null;
  body_type: string | null;
  median_profit: number | null;
  median_profit_pct: number | null;
  median_days_to_clear: number | null;
  median_sale_price: number | null;
  median_km: number | null;
  total_sales: number;
  confidence_level: string;
  spec_completeness: number;
  target_score: number;
  origin: string;
  status: string;
  source_candidate_id: string | null;
  last_promoted_at: string | null;
  created_at: string;
  updated_at: string;
}
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

// Clean noisy variant strings: strip chassis codes, body types, trans, drivetrain
function cleanVariant(v: string | null): string | null {
  if (!v) return null;
  const NOISE_RE = /\b(cab\s*chassis|double\s*cab|dual\s*cab|crew\s*cab|single\s*cab|super\s*cab|extra\s*cab|king\s*cab|wagon|utility|ute|sedan|hatch(?:back)?|coupe|van|bus|troopcarrier|wellside|wellbody|tray|flatbed|suv|pick-?up)\b/gi;
  const CHASSIS_RE = /\b[A-Z]{2,5}\d{2,4}[A-Z]?\b/g;
  const MY_RE = /\bMY\d{2,4}\b/gi;
  const SPEED_RE = /\b\d{1,2}sp\b/gi;
  const DRIVETRAIN_RE = /\b(4x4|4x2|4wd|2wd|awd|rwd|fwd)\b/gi;
  const DOOR_RE = /\b\d+dr\b/gi;
  const SEAT_RE = /\b\d+st\b/gi;
  const AUTO_RE = /\b(auto|manual|spts\s*auto|cvt|dsg|amt)\b/gi;
  let cleaned = v
    .replace(CHASSIS_RE, "")
    .replace(MY_RE, "")
    .replace(NOISE_RE, "")
    .replace(SPEED_RE, "")
    .replace(DRIVETRAIN_RE, "")
    .replace(DOOR_RE, "")
    .replace(SEAT_RE, "")
    .replace(AUTO_RE, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
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
  const cleanedVariant = cleanVariant(t.variant);
  const driveLabel = t.drive_type?.toUpperCase();
  const showDrivetrain = driveLabel && ["4WD", "AWD", "4X4"].includes(driveLabel);
  const dnaLabel = [
    t.year_from && t.year_to
      ? `${t.year_from}–${t.year_to}`
      : t.year_from || t.year_to || null,
    t.make,
    t.model,
    cleanedVariant,
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
            {showDrivetrain && (
              <Badge variant="outline" className="text-xs bg-sky-500/10 text-sky-700 border-sky-300">
                {driveLabel}
              </Badge>
            )}
            {driveLabel && ["2WD", "FWD", "RWD"].includes(driveLabel) && (
              <Badge variant="outline" className="text-xs bg-muted text-muted-foreground border-border">
                {driveLabel}
              </Badge>
            )}
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
          {t.median_km != null && (
            <span>
              KM{" "}
              <strong className="text-foreground">
                {Math.round(t.median_km / 1000)}k
              </strong>
              <span className="text-xs ml-0.5">(±10k)</span>
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
