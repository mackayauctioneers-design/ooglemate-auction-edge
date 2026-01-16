import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { 
  CheckCircle, 
  ExternalLink, 
  TrendingDown, 
  MapPin,
  HelpCircle
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { 
  HuntAlert, 
  parseHuntAlertPayload,
  SaleHunt
} from "@/types/hunts";
import { WhyMatchedDrawer } from "./WhyMatchedDrawer";

interface HuntAlertCardEnhancedProps {
  alert: HuntAlert;
  hunt?: SaleHunt | null;
  onAcknowledge: (alertId: string) => void;
  isAcknowledging?: boolean;
}

function getSourceColor(source: string): string {
  const s = source.toLowerCase();
  if (s.includes("autotrader")) return "bg-blue-500/10 text-blue-600 border-blue-200";
  if (s.includes("drive")) return "bg-purple-500/10 text-purple-600 border-purple-200";
  if (s.includes("gumtree") && s.includes("dealer")) return "bg-orange-500/10 text-orange-600 border-orange-200";
  if (s.includes("gumtree") && s.includes("private")) return "bg-rose-500/10 text-rose-600 border-rose-200";
  return "bg-muted text-muted-foreground";
}

export function HuntAlertCardEnhanced({ 
  alert, 
  hunt,
  onAcknowledge, 
  isAcknowledging 
}: HuntAlertCardEnhancedProps) {
  const [whyOpen, setWhyOpen] = useState(false);
  const payloadResult = parseHuntAlertPayload(alert.payload);

  if (!payloadResult.success) {
    return (
      <Card className="border-destructive/50 bg-destructive/5">
        <CardContent className="p-4">
          <div className="text-sm text-destructive">Invalid alert data</div>
        </CardContent>
      </Card>
    );
  }

  const p = payloadResult.data;
  const hasLocation = p.state || p.suburb;

  return (
    <>
      <Card className={`transition-all ${alert.acknowledged_at ? "opacity-60" : ""} hover:shadow-md`}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4">
            {/* Left side - main info */}
            <div className="flex items-start gap-4 flex-1 min-w-0">
              {/* Big badge */}
              <Badge className={`shrink-0 text-base px-3 py-1.5 font-bold ${
                alert.alert_type === "BUY" 
                  ? "bg-emerald-500 text-white" 
                  : "bg-amber-500 text-white"
              }`}>
                {alert.alert_type}
              </Badge>

              <div className="flex-1 min-w-0 space-y-2">
                {/* Vehicle title */}
                <div>
                  <div className="font-semibold text-lg truncate">
                    {p.year ?? ""} {p.make ?? ""} {p.model ?? ""}
                  </div>
                  {p.variant && (
                    <div className="text-sm text-muted-foreground truncate">
                      {p.variant}
                    </div>
                  )}
                </div>

                {/* Meta row */}
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {p.source && (
                    <Badge variant="outline" className={`text-xs ${getSourceColor(p.source)}`}>
                      {p.source}
                    </Badge>
                  )}
                  {hasLocation && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {[p.state, p.suburb].filter(Boolean).join(" • ")}
                    </span>
                  )}
                  {p.km != null && (
                    <span className="text-muted-foreground">
                      {Math.round(p.km / 1000)}k km
                    </span>
                  )}
                </div>

                {/* Prices row */}
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Asking: </span>
                    <span className="font-semibold">
                      ${(p.asking_price ?? 0).toLocaleString()}
                    </span>
                  </div>
                  {p.proven_exit_value != null && (
                    <div>
                      <span className="text-muted-foreground">Proven exit: </span>
                      <span className="font-semibold">
                        ${p.proven_exit_value.toLocaleString()}
                      </span>
                    </div>
                  )}
                  {p.gap_dollars != null && p.gap_dollars > 0 && (
                    <div className="flex items-center text-emerald-600 font-semibold">
                      <TrendingDown className="h-4 w-4 mr-1" />
                      +${p.gap_dollars.toLocaleString()} ({(p.gap_pct ?? 0).toFixed(1)}%)
                    </div>
                  )}
                </div>

                {/* Score */}
                <div className="text-sm text-muted-foreground">
                  Match score: <span className="font-medium text-foreground">{(p.match_score ?? 0).toFixed(1)}/10</span>
                </div>
              </div>
            </div>

            {/* Right side - actions */}
            <div className="flex flex-col items-end gap-2 shrink-0">
              <div className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setWhyOpen(true)}
                >
                  <HelpCircle className="h-4 w-4 mr-1" />
                  Why matched
                </Button>

                {p.listing_url && (
                  <Button
                    size="sm"
                    onClick={() => window.open(p.listing_url!, "_blank")}
                  >
                    <ExternalLink className="h-4 w-4 mr-1" />
                    View
                  </Button>
                )}

                {!alert.acknowledged_at && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => onAcknowledge(alert.id)}
                    disabled={isAcknowledging}
                    title="Acknowledge"
                  >
                    <CheckCircle className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <WhyMatchedDrawer
        open={whyOpen}
        onOpenChange={setWhyOpen}
        payload={payloadResult.data}
        alertType={alert.alert_type}
        hunt={hunt}
      />
    </>
  );
}
