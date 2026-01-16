import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Eye, Target, Gauge } from "lucide-react";
import type { HuntAlert, HuntMatch } from "@/types/hunts";

interface HuntKPICardsProps {
  alerts: HuntAlert[];
  matches: HuntMatch[];
  confidenceLabel?: "high" | "medium" | "low";
}

export function HuntKPICards({ alerts, matches, confidenceLabel }: HuntKPICardsProps) {
  // Filter for last 24h
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const recentAlerts = alerts.filter(a => new Date(a.created_at) >= dayAgo);
  const buyAlerts24h = recentAlerts.filter(a => a.alert_type === "BUY").length;
  const watchAlerts24h = recentAlerts.filter(a => a.alert_type === "WATCH").length;
  const matches24h = matches.filter(m => new Date(m.matched_at) >= dayAgo).length;

  const confidence = confidenceLabel || (
    matches.length >= 5 ? "high" : matches.length >= 2 ? "medium" : "low"
  );

  const confidenceColors = {
    high: "bg-emerald-500/10 text-emerald-600 border-emerald-200",
    medium: "bg-amber-500/10 text-amber-600 border-amber-200",
    low: "bg-muted text-muted-foreground",
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-2xl font-bold text-emerald-500">{buyAlerts24h}</div>
              <div className="text-sm text-muted-foreground">BUY Alerts (24h)</div>
            </div>
            <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-emerald-500" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-2xl font-bold text-amber-500">{watchAlerts24h}</div>
              <div className="text-sm text-muted-foreground">WATCH Alerts (24h)</div>
            </div>
            <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center">
              <Eye className="h-5 w-5 text-amber-500" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-2xl font-bold">{matches24h}</div>
              <div className="text-sm text-muted-foreground">Matches (24h)</div>
            </div>
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Target className="h-5 w-5 text-primary" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <Badge variant="outline" className={`text-sm font-medium ${confidenceColors[confidence]}`}>
                {confidence.charAt(0).toUpperCase() + confidence.slice(1)}
              </Badge>
              <div className="text-sm text-muted-foreground mt-1">Confidence</div>
            </div>
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
              <Gauge className="h-5 w-5 text-muted-foreground" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
