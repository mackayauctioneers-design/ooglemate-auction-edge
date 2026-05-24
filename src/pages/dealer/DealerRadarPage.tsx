import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

interface ActivationStats {
  sales_count: number;
  fingerprint_count: number;
  active_mandate_count: number;
  last_run_at: string | null;
  feed_24h: number;
  alerts_7d: number;
}

interface FeedItem {
  id: string;
  make: string | null;
  model: string | null;
  variant: string | null;
  year: number | null;
  km: number | null;
  asking_price: number | null;
  source: string | null;
  source_url: string | null;
  location: string | null;
  final_score: number | null;
  score: number | null;
  alert_tier: string | null;
  lane: string | null;
  expected_margin: number | null;
  recommendation: string | null;
  rejection_reason: string | null;
  created_at: string;
}

interface AlertRow {
  id: string;
  created_at: string;
  alert_type: string | null;
  severity: string | null;
  reason: string | null;
}

const tierColor = (tier: string | null) => {
  switch (tier) {
    case "A+": return "bg-green-600 text-white";
    case "A":  return "bg-emerald-500 text-white";
    case "Watch": return "bg-amber-500 text-white";
    default: return "bg-muted text-muted-foreground";
  }
};

export default function DealerRadarPage() {
  const { dealerId } = useParams<{ dealerId: string }>();
  const [loading, setLoading] = useState(true);
  const [dealerName, setDealerName] = useState<string>("");
  const [stats, setStats] = useState<ActivationStats | null>(null);
  const [topToday, setTopToday] = useState<FeedItem[]>([]);
  const [byModel, setByModel] = useState<Record<string, FeedItem[]>>({});
  const [rejected, setRejected] = useState<FeedItem[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);

  const load = async () => {
    if (!dealerId) return;
    setLoading(true);

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since7d  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000).toISOString();

    // 1. Dealer profile
    const profileRes: any = await supabase
      .from("dealer_profiles")
      .select("dealer_name")
      .eq("id", dealerId)
      .maybeSingle();
    setDealerName(profileRes.data?.dealer_name ?? "Dealer");

    // 2. Counters
    const [salesRes, fpRes, mandRes, lastRunRes, feed24Res] = await Promise.all([
      (supabase.from("vehicle_sales_truth") as any).select("id", { count: "exact", head: true }).eq("dealer_id", dealerId),
      (supabase.from("dealer_fingerprints") as any).select("id", { count: "exact", head: true }).eq("dealer_profile_id", dealerId).eq("is_active", true),
      (supabase.from("active_mandates") as any).select("id", { count: "exact", head: true }).eq("dealer_id", dealerId).eq("is_active", true),
      (supabase.from("active_mandates") as any).select("last_run_at").eq("dealer_id", dealerId).order("last_run_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
      (supabase.from("mandate_feed_items") as any).select("id", { count: "exact", head: true }).eq("dealer_id", dealerId).gte("created_at", since24h),
    ]);

    // 3. Feed items + rejected
    const feedRes: any = await (supabase.from("mandate_feed_items") as any)
      .select("*")
      .eq("dealer_id", dealerId)
      .gte("created_at", since24h)
      .order("final_score", { ascending: false, nullsFirst: false })
      .limit(60);
    const feed = (feedRes.data ?? []) as FeedItem[];

    const rejRes: any = await (supabase.from("mandate_feed_items") as any)
      .select("*")
      .eq("dealer_id", dealerId)
      .eq("alert_tier", "Reject")
      .gte("created_at", since24h)
      .order("created_at", { ascending: false })
      .limit(25);

    // 4. Alerts — join via active_mandates (mandate_alerts has no dealer_id)
    const mandateIdRes: any = await (supabase.from("active_mandates") as any)
      .select("id")
      .eq("dealer_id", dealerId);
    const mandateIds = (mandateIdRes.data ?? []).map((m: any) => m.id);

    let alertRows: AlertRow[] = [];
    let alertCount = 0;
    if (mandateIds.length > 0) {
      const alertsRes: any = await (supabase.from("mandate_alerts") as any)
        .select("id, created_at, alert_type, severity, reason")
        .in("mandate_id", mandateIds)
        .gte("created_at", since7d)
        .order("created_at", { ascending: false })
        .limit(50);
      alertRows = (alertsRes.data ?? []) as AlertRow[];
      const alert7Res: any = await (supabase.from("mandate_alerts") as any)
        .select("id", { count: "exact", head: true })
        .in("mandate_id", mandateIds)
        .gte("created_at", since7d);
      alertCount = alert7Res.count ?? 0;
    }

    setStats({
      sales_count: salesRes.count ?? 0,
      fingerprint_count: fpRes.count ?? 0,
      active_mandate_count: mandRes.count ?? 0,
      last_run_at: lastRunRes.data?.last_run_at ?? null,
      feed_24h: feed24Res.count ?? 0,
      alerts_7d: alertCount,
    });

    setTopToday(feed.slice(0, 10));

    const groups: Record<string, FeedItem[]> = {};
    for (const item of feed) {
      const key = `${item.make ?? "?"} ${item.model ?? "?"}`.trim();
      (groups[key] ||= []).push(item);
    }
    setByModel(groups);

    setRejected((rejRes.data ?? []) as FeedItem[]);
    setAlerts(alertRows);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dealerId]);

  if (!dealerId) return <div className="p-6">Missing dealer id.</div>;

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{dealerName} — Radar</h1>
          <p className="text-sm text-muted-foreground">
            Live acquisition opportunities matched against this dealer's sales-truth fingerprints.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Activation status</CardTitle></CardHeader>
        <CardContent>
          {loading || !stats ? <Skeleton className="h-16 w-full" /> : (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-sm">
              <Stat label="Sales rows" value={stats.sales_count} />
              <Stat label="Active fingerprints" value={stats.fingerprint_count} />
              <Stat label="Active mandates" value={stats.active_mandate_count} />
              <Stat label="Feed items (24h)" value={stats.feed_24h} />
              <Stat label="Alerts (7d)" value={stats.alerts_7d} />
              <Stat label="Last mandate run" value={stats.last_run_at ? new Date(stats.last_run_at).toLocaleString() : "never"} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Top 10 today</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-40 w-full" /> :
            topToday.length === 0 ? <Empty msg="No matches in the last 24h." /> :
            <div className="space-y-2">{topToday.map(item => <Row key={item.id} item={item} />)}</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>By model</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-40 w-full" /> :
            Object.keys(byModel).length === 0 ? <Empty msg="Nothing grouped yet." /> :
            <div className="space-y-6">
              {Object.entries(byModel).map(([key, items]) => (
                <div key={key}>
                  <h3 className="text-sm font-semibold mb-2">{key} <span className="text-muted-foreground">({items.length})</span></h3>
                  <div className="space-y-2">{items.slice(0, 5).map(i => <Row key={i.id} item={i} />)}</div>
                </div>
              ))}
            </div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Rejected (last 24h)</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-32 w-full" /> :
            rejected.length === 0 ? <Empty msg="Nothing tagged as rejected yet." /> :
            <div className="space-y-2">
              {rejected.map(r => (
                <div key={r.id} className="text-sm flex justify-between border-b py-1">
                  <span>{r.year} {r.make} {r.model} {r.variant ?? ""}</span>
                  <span className="text-muted-foreground">{r.rejection_reason ?? "—"}</span>
                </div>
              ))}
            </div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Alert history (7d)</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-32 w-full" /> :
            alerts.length === 0 ? <Empty msg="No alerts dispatched in the last 7 days." /> :
            <div className="space-y-1 text-sm">
              {alerts.map(a => (
                <div key={a.id} className="flex justify-between border-b py-1">
                  <span>{new Date(a.created_at).toLocaleString()} — {a.alert_type ?? "—"} {a.severity ? `(${a.severity})` : ""}</span>
                  <span className="text-muted-foreground truncate max-w-[60%]">{a.reason ?? ""}</span>
                </div>
              ))}
            </div>}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="text-sm text-muted-foreground py-4">{msg}</div>;
}

function Row({ item }: { item: FeedItem }) {
  const score = item.final_score ?? item.score ?? 0;
  return (
    <div className="flex items-center justify-between gap-3 border-b py-2 text-sm">
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">
          {item.year} {item.make} {item.model} {item.variant ?? ""}
        </div>
        <div className="text-xs text-muted-foreground">
          {item.km != null ? `${item.km.toLocaleString()} km · ` : ""}
          {item.location ?? "—"} · {item.source ?? "—"}
        </div>
      </div>
      <div className="text-right">
        <div className="font-semibold">${item.asking_price?.toLocaleString() ?? "—"}</div>
        {item.expected_margin != null && (
          <div className="text-xs text-muted-foreground">
            est GP ${Math.round(item.expected_margin).toLocaleString()}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 w-24">
        {item.alert_tier && <Badge className={tierColor(item.alert_tier)}>{item.alert_tier}</Badge>}
        <div className="text-xs text-muted-foreground">score {Math.round(Number(score))}</div>
      </div>
      {item.source_url && (
        <Link to={item.source_url} target="_blank" rel="noreferrer" className="text-xs underline text-primary">view</Link>
      )}
    </div>
  );
}
