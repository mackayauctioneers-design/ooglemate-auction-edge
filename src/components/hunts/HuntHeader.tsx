import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  ArrowLeft, 
  Play, 
  Pause, 
  CheckCircle, 
  Clock,
  Zap,
  Globe,
  Loader2,
  Radio
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";
import type { SaleHunt, HuntStatus } from "@/types/hunts";
import { KitingIndicator } from "@/components/kiting";
import { deriveHuntKitingState } from "@/hooks/useKitingState";

interface HuntHeaderProps {
  hunt: SaleHunt & { outward_enabled?: boolean; outward_sources?: string[] };
  onUpdateStatus: (status: HuntStatus) => void;
  onRunScan: () => void;
  onRunOutwardScan?: () => void;
  isRunningScans: boolean;
  isUpdatingStatus: boolean;
  isRunningOutward?: boolean;
  lastAlertAt?: string | null;
  lastMatchAt?: string | null;
}

function getStatusColor(status: HuntStatus): string {
  switch (status) {
    case "active": return "bg-emerald-500/10 text-emerald-600 border-emerald-200";
    case "paused": return "bg-amber-500/10 text-amber-600 border-amber-200";
    case "done": return "bg-muted text-muted-foreground";
    case "expired": return "bg-destructive/10 text-destructive";
    default: return "bg-muted";
  }
}

// Coverage message - intentionally vague to avoid over-promising
const COVERAGE_MESSAGE = "Marketplaces + auctions + dealer sites";

export function HuntHeader({ 
  hunt, 
  onUpdateStatus, 
  onRunScan,
  onRunOutwardScan,
  isRunningScans,
  isUpdatingStatus,
  isRunningOutward,
  lastAlertAt,
  lastMatchAt
}: HuntHeaderProps) {
  const navigate = useNavigate();
  
  // Derive kiting state from real data
  const kitingState = deriveHuntKitingState(
    hunt.status,
    hunt.last_scan_at,
    lastAlertAt || null,
    lastMatchAt || null,
    isRunningScans ? 'running' : null
  );

  return (
    <div className="space-y-4">
      {/* Back button */}
      <Button variant="ghost" size="sm" onClick={() => navigate("/hunts")}>
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to Hunts
      </Button>

      {/* Title section */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="space-y-2">
          {/* Title with animated indicator */}
          <div className="flex items-center gap-3">
            <KitingIndicator 
              state={kitingState} 
              size="lg" 
              showLabel={false} 
            />
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Kiting Mode — Active Hunt
              </div>
              <h1 className="text-2xl font-bold">
                {hunt.year} {hunt.make} {hunt.model}
              </h1>
              {/* Cause → effect explanation */}
              {hunt.source_sale_id && (
                <p className="text-sm text-muted-foreground mt-1">
                  Kiting Mode is active because you logged a sale.
                </p>
              )}
            </div>
            <Badge variant="outline" className={`ml-2 ${getStatusColor(hunt.status)}`}>
              {hunt.status}
            </Badge>
            {hunt.criteria_version && hunt.criteria_version > 1 && (
              <Badge variant="secondary" className="ml-1 text-xs bg-primary/10 text-primary">
                v{hunt.criteria_version}
              </Badge>
            )}
          </div>

          {/* Subtitle */}
          {hunt.variant_family && (
            <div className="text-lg text-muted-foreground pl-[52px]">
              {hunt.variant_family}
            </div>
          )}

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground pl-[52px]">
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              Last scan: {hunt.last_scan_at 
                ? formatDistanceToNow(new Date(hunt.last_scan_at), { addSuffix: true })
                : "Never"}
            </div>
            <div className="flex items-center gap-1">
              <Zap className="h-4 w-4" />
              Interval: {hunt.scan_interval_minutes} min
            </div>
            <div className="flex flex-wrap gap-1">
              {hunt.sources_enabled.map(src => (
                <Badge key={src} variant="secondary" className="text-xs">
                  {src}
                </Badge>
              ))}
            </div>
            {hunt.expires_at && (
              <div>
                Expires: {format(new Date(hunt.expires_at), "MMM d, yyyy")}
              </div>
            )}
          </div>
          
          {/* Simplified Coverage Row - no toggles, always on */}
          <div className="flex items-center gap-2 pl-[52px] pt-3 border-t border-border mt-3">
            <Radio className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm text-foreground">
              <span className="font-medium">Coverage:</span> Auctions, dealer stock, marketplaces, and the wider web
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          {hunt.status === "active" && (
            <>
              <Button 
                onClick={onRunScan} 
                disabled={isRunningScans}
                className="bg-primary hover:bg-primary/90"
              >
                <Play className="h-4 w-4 mr-2" />
                {isRunningScans ? "Scanning..." : "Run Scan Now"}
              </Button>
              {onRunOutwardScan && (
                <Button 
                  onClick={onRunOutwardScan}
                  disabled={isRunningOutward}
                  variant="secondary"
                  className="bg-purple-500/10 text-purple-600 hover:bg-purple-500/20"
                >
                  <Globe className="h-4 w-4 mr-2" />
                  {isRunningOutward ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Searching...</> : "Search Web"}
                </Button>
              )}
              <Button 
                variant="outline" 
                onClick={() => onUpdateStatus("paused")}
                disabled={isUpdatingStatus}
              >
                <Pause className="h-4 w-4 mr-2" />
                Pause
              </Button>
            </>
          )}
          {hunt.status === "paused" && (
            <Button 
              onClick={() => onUpdateStatus("active")}
              disabled={isUpdatingStatus}
            >
              <Play className="h-4 w-4 mr-2" />
              Resume
            </Button>
          )}
          {hunt.status !== "done" && (
            <Button 
              variant="outline" 
              onClick={() => onUpdateStatus("done")}
              disabled={isUpdatingStatus}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Mark Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
