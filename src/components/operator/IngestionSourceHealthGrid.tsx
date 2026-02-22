import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, XCircle, Clock, Wifi, WifiOff } from "lucide-react";

interface SourceHealth {
  source_key: string;
  display_name: string;
  enabled: boolean;
  expected_interval_minutes: number;
  min_listings_24h: number | null;
  cron_schedule: string | null;
  last_run_at: string | null;
  last_ok: boolean | null;
  last_note: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
  runs_24h: number;
  successes_24h: number;
  new_24h: number;
  updated_24h: number;
  health_status: string;
}

const statusConfig: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  healthy: { icon: CheckCircle2, color: "text-emerald-500", label: "Healthy" },
  stale: { icon: Clock, color: "text-amber-500", label: "Stale" },
  erroring: { icon: XCircle, color: "text-red-500", label: "Erroring" },
  never_run: { icon: WifiOff, color: "text-muted-foreground", label: "Never Run" },
  disabled: { icon: Wifi, color: "text-muted-foreground", label: "Disabled" },
};

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function IngestionSourceHealthGrid() {
  const [sources, setSources] = useState<SourceHealth[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSources = async () => {
    const { data, error } = await supabase
      .from("ingestion_source_health" as any)
      .select("*")
      .order("enabled", { ascending: false });

    if (!error && data) {
      setSources(data as unknown as SourceHealth[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchSources();
    const interval = setInterval(fetchSources, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return null;

  const enabled = sources.filter((s) => s.enabled);
  const disabled = sources.filter((s) => !s.enabled);
  const healthyCount = enabled.filter((s) => s.health_status === "healthy").length;
  const alertCount = enabled.filter((s) => ["stale", "erroring"].includes(s.health_status)).length;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-semibold">Ingestion Sources</h2>
        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
          {healthyCount} healthy
        </Badge>
        {alertCount > 0 && (
          <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30">
            {alertCount} alert{alertCount > 1 ? "s" : ""}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {disabled.length} disabled
        </span>
      </div>

      {/* Source cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {enabled.map((s) => {
          const cfg = statusConfig[s.health_status] || statusConfig.healthy;
          const Icon = cfg.icon;
          const belowMin = s.min_listings_24h && s.new_24h < s.min_listings_24h;

          return (
            <Card key={s.source_key} className={s.health_status === "erroring" ? "border-red-500/50" : s.health_status === "stale" ? "border-amber-500/50" : ""}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">{s.display_name}</CardTitle>
                  <div className="flex items-center gap-1">
                    <Icon className={`h-4 w-4 ${cfg.color}`} />
                    <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <div className="text-muted-foreground">Last run</div>
                  <div className="text-right font-mono text-xs">{timeAgo(s.last_run_at)}</div>
                  <div className="text-muted-foreground">Runs 24h</div>
                  <div className="text-right font-mono">{s.runs_24h}</div>
                  <div className="text-muted-foreground">New 24h</div>
                  <div className={`text-right font-mono ${belowMin ? "text-red-500 font-bold" : ""}`}>
                    {s.new_24h}
                    {belowMin && <AlertTriangle className="inline h-3 w-3 ml-1" />}
                  </div>
                  <div className="text-muted-foreground">Updated 24h</div>
                  <div className="text-right font-mono">{s.updated_24h}</div>
                </div>

                {s.last_error_message && (
                  <div className="text-xs text-red-500 truncate mt-1" title={s.last_error_message}>
                    ⚠ {s.last_error_message.slice(0, 80)}
                  </div>
                )}

                {s.cron_schedule && (
                  <div className="text-xs text-muted-foreground">
                    Schedule: <code className="text-[10px]">{s.cron_schedule}</code>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Disabled sources (collapsed) */}
      {disabled.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2">
          {disabled.map((s) => (
            <Badge key={s.source_key} variant="secondary" className="text-xs opacity-60">
              {s.display_name} (disabled)
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
