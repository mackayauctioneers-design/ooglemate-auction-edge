import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Radio, ExternalLink } from "lucide-react";
import { useDealerSoulStats, useDealerSoulDeals, type DealerSoulDeal } from "@/hooks/useDealerSoul";

function fmt$(n?: number | null) {
  if (n == null) return "—";
  return "$" + Number(n).toLocaleString("en-AU", { maximumFractionDigits: 0 });
}

export function DealerSoulStatsCard() {
  const { data, loading, error } = useDealerSoulStats();

  return (
    <Card className="border-emerald-500/30 bg-emerald-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Radio className="h-3.5 w-3.5 text-emerald-400 animate-pulse" />
          DealerSoul Live
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Connecting…
          </div>
        ) : error ? (
          <p className="text-xs text-destructive">Offline: {error}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Sales" value={data?.total_sales} />
            <Stat label="Fingerprints" value={data?.total_fingerprints} />
            <Stat label="Active Deals" value={data?.active_deals} />
            <Stat label="Avg Margin" value={data?.avg_margin_pct != null ? `${Number(data.avg_margin_pct).toFixed(1)}%` : "—"} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number | string | undefined | null }) {
  return (
    <div>
      <p className="text-xl font-bold text-foreground leading-none">{value ?? "—"}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

export function DealerSoulDealsStrip({ limit = 20 }: { limit?: number }) {
  const { data, loading, error } = useDealerSoulDeals(limit);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading DealerSoul deals…
      </div>
    );
  }
  if (error) return <p className="text-xs text-destructive py-2">DealerSoul offline: {error}</p>;
  if (data.length === 0) return null;

  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Radio className="h-3.5 w-3.5 text-emerald-400 animate-pulse" />
        <span className="text-xs font-medium text-muted-foreground">DealerSoul · Top scored deals</span>
        <Badge variant="outline" className="text-[10px] ml-auto">{data.length} live</Badge>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {data.map((d: DealerSoulDeal, i) => (
          <a
            key={String(d.id ?? i)}
            href={d.url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 min-w-[220px] px-3 py-2 rounded-md bg-card border border-border hover:border-foreground/30 transition-all"
          >
            <div className="flex items-center gap-2 text-xs font-medium text-foreground">
              <span className="truncate">{d.year} {d.make} {d.model}</span>
              {d.url && <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />}
            </div>
            <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
              <span>{fmt$(d.price)}</span>
              {d.buy_ceiling != null && <span>· ceil {fmt$(d.buy_ceiling)}</span>}
              {d.margin_pct != null && (
                <span className={Number(d.margin_pct) >= 10 ? "text-emerald-500 font-semibold" : ""}>
                  · {Number(d.margin_pct).toFixed(1)}%
                </span>
              )}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
