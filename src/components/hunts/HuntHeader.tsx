import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { 
  ArrowLeft, 
  Target, 
  Play, 
  Pause, 
  CheckCircle, 
  Clock,
  Zap,
  Globe,
  Loader2
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";
import type { SaleHunt, HuntStatus } from "@/types/hunts";

interface HuntHeaderProps {
  hunt: SaleHunt & { outward_enabled?: boolean; outward_sources?: string[] };
  onUpdateStatus: (status: HuntStatus) => void;
  onRunScan: () => void;
  onRunOutwardScan?: () => void;
  onToggleOutward?: (enabled: boolean) => void;
  isRunningScans: boolean;
  isUpdatingStatus: boolean;
  isRunningOutward?: boolean;
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

export function HuntHeader({ 
  hunt, 
  onUpdateStatus, 
  onRunScan,
  onRunOutwardScan,
  onToggleOutward,
  isRunningScans,
  isUpdatingStatus,
  isRunningOutward
}: HuntHeaderProps) {
  const navigate = useNavigate();

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
          {/* Title with icon */}
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Target className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Kiting Mode — Active Hunt
              </div>
              <h1 className="text-2xl font-bold">
                {hunt.year} {hunt.make} {hunt.model}
              </h1>
            </div>
            <Badge variant="outline" className={`ml-2 ${getStatusColor(hunt.status)}`}>
              {hunt.status}
            </Badge>
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
            
            {/* Outward Hunt indicator */}
            {hunt.outward_enabled && (
              <Badge variant="secondary" className="text-xs bg-purple-500/10 text-purple-600">
                <Globe className="h-3 w-3 mr-1" />
                Outward Search
              </Badge>
            )}
          </div>
          
          {/* Outward Hunt Toggle */}
          {onToggleOutward && (
            <div className="flex items-center gap-3 pl-[52px] pt-2">
              <Switch
                id="outward-enabled"
                checked={hunt.outward_enabled || false}
                onCheckedChange={onToggleOutward}
              />
              <Label htmlFor="outward-enabled" className="text-sm cursor-pointer">
                <span className="font-medium">Outward Hunt</span>
                <span className="text-muted-foreground ml-1">— Search Lloyds, Grays, and other auction sites</span>
              </Label>
            </div>
          )}
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
              {hunt.outward_enabled && onRunOutwardScan && (
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
