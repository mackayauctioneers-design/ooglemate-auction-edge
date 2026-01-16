import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { 
  CheckCircle, 
  ExternalLink, 
  TrendingDown, 
  Target,
  AlertTriangle
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";
import { 
  HuntAlert, 
  parseHuntAlertPayload, 
  HuntAlertPayload 
} from "@/types/hunts";

interface HuntAlertCardProps {
  alert: HuntAlert & { 
    hunt?: { year: number; make: string; model: string } 
  };
  onAcknowledge: (alertId: string) => void;
  isAcknowledging?: boolean;
  showHuntLink?: boolean;
}

/**
 * Renders a single hunt alert card with validated payload data.
 * Shows an error state if payload validation fails.
 */
export function HuntAlertCard({ 
  alert, 
  onAcknowledge, 
  isAcknowledging,
  showHuntLink = true 
}: HuntAlertCardProps) {
  const navigate = useNavigate();
  const payloadResult = parseHuntAlertPayload(alert.payload);

  // Invalid payload - show error state
  if (!payloadResult.success) {
    return (
      <Card className="border-destructive/50 bg-destructive/5">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <div>
              <div className="font-medium text-destructive">Invalid Alert Data</div>
              <div className="text-sm text-muted-foreground">
                {(payloadResult as { success: false; error: string }).error}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Alert ID: {alert.id}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const p = payloadResult.data;

  return (
    <Card 
      className={`transition-all ${
        alert.acknowledged_at ? 'opacity-60' : ''
      } hover:bg-accent/50`}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Badge className={
              alert.alert_type === 'BUY' 
                ? 'bg-emerald-500 text-white text-lg px-3 py-1' 
                : 'bg-amber-500 text-white text-lg px-3 py-1'
            }>
              {alert.alert_type}
            </Badge>
            
            <div>
              <div className="font-semibold text-lg">
                {p.year ?? ''} {p.make ?? ''} {p.model ?? ''}
                {p.variant && (
                  <span className="text-muted-foreground ml-2">
                    {p.variant}
                  </span>
                )}
              </div>
              
              <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                {p.km != null && (
                  <span>{Math.round(p.km / 1000)}k km</span>
                )}
                <span className="font-medium text-foreground">
                  ${(p.asking_price ?? 0).toLocaleString()}
                </span>
                {p.gap_dollars != null && p.gap_dollars > 0 && (
                  <span className="flex items-center text-emerald-500">
                    <TrendingDown className="h-4 w-4 mr-1" />
                    ${p.gap_dollars.toLocaleString()} below 
                    ({(p.gap_pct ?? 0).toFixed(1)}%)
                  </span>
                )}
                <span>Score: {(p.match_score ?? 0).toFixed(1)}/10</span>
                {p.source && (
                  <Badge variant="outline" className="text-xs">
                    {p.source}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              {showHuntLink && alert.hunt && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs text-muted-foreground"
                  onClick={() => navigate(`/hunts/${alert.hunt_id}`)}
                >
                  <Target className="h-3 w-3 mr-1" />
                  {alert.hunt.year} {alert.hunt.make} {alert.hunt.model}
                </Button>
              )}
              <div className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
              </div>
            </div>

            <div className="flex gap-2">
              {p.listing_url && (
                <Button
                  size="sm"
                  onClick={() => window.open(p.listing_url!, '_blank')}
                >
                  <ExternalLink className="h-4 w-4 mr-1" />
                  View
                </Button>
              )}

              {!alert.acknowledged_at && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onAcknowledge(alert.id)}
                  disabled={isAcknowledging}
                >
                  <CheckCircle className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Compact version for use in hunt detail page
 */
export function HuntAlertCardCompact({ 
  alert, 
  onAcknowledge, 
  isAcknowledging 
}: Omit<HuntAlertCardProps, 'showHuntLink'>) {
  const payloadResult = parseHuntAlertPayload(alert.payload);

  if (!payloadResult.success) {
    return (
      <Card className="border-destructive/50 bg-destructive/5">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm">Invalid payload</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const p = payloadResult.data;

  return (
    <Card className={alert.acknowledged_at ? 'opacity-60' : ''}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge className={
              alert.alert_type === 'BUY' 
                ? 'bg-emerald-500 text-white' 
                : 'bg-amber-500 text-white'
            }>
              {alert.alert_type}
            </Badge>
            <div>
              <div className="font-medium">
                {p.year ?? ''} {p.make ?? ''} {p.model ?? ''}
                {p.variant && ` ${p.variant}`}
              </div>
              <div className="text-sm text-muted-foreground">
                {p.km != null && `${Math.round(p.km / 1000)}k km • `}
                ${(p.asking_price ?? 0).toLocaleString()}
                {p.gap_dollars != null && p.gap_dollars > 0 && (
                  <span className="text-emerald-500 ml-2">
                    <TrendingDown className="h-3 w-3 inline" />
                    ${p.gap_dollars.toLocaleString()} below ({(p.gap_pct ?? 0).toFixed(1)}%)
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right text-sm">
              <div className="text-muted-foreground">
                Score: {(p.match_score ?? 0).toFixed(1)}/10
              </div>
              <div className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
              </div>
            </div>

            {p.listing_url && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.open(p.listing_url!, '_blank')}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            )}

            {!alert.acknowledged_at && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onAcknowledge(alert.id)}
                disabled={isAcknowledging}
              >
                <CheckCircle className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
