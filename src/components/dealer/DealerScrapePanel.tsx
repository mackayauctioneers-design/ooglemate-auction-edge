import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useActivateDealer, useRunDealerScoring } from "@/hooks/useDealerWorker";

interface Props {
  accountId: string;
  dealerName?: string;
}

interface ScrapeHealth {
  account_id: string;
  display_name: string | null;
  dealer_domain: string | null;
  scrape_enabled: boolean | null;
  last_scraped_at: string | null;
  last_successful_scrape_at: string | null;
  scrape_health_status: string | null;
  consecutive_failures: number | null;
  current_inventory_count: number | null;
  observed_sold_30d: number | null;
  fingerprint_count: number | null;
  active_mandates_count: number | null;
}

interface SoldRow {
  id: string;
  make: string | null;
  model: string | null;
  variant: string | null;
  year: number | null;
  km: number | null;
  listed_price: number | null;
  sold_date: string | null;
  last_seen: string | null;
}

interface FeedRow {
  id: string;
  created_at: string;
  vehicle_label: string | null;
  expected_margin: number | null;
}

export function DealerScrapePanel({ accountId, dealerName }: Props) {
  const [health, setHealth] = useState<ScrapeHealth | null>(null);
  const [recentSold, setRecentSold] = useState<SoldRow[]>([]);
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  const activate = useActivateDealer();
  const score = useRunDealerScoring();

  const load = async () => {
    setLoading(true);
    const [h, s, f] = await Promise.all([
      supabase
        .from("dealer_scrape_health" as any)
        .select("*")
        .eq("account_id", accountId)
        .maybeSingle(),
      supabase
        .from("sold_vehicles")
        .select("id, make, model, variant, year, km, listed_price, sold_date, last_seen")
        .eq("dealer_id", accountId)
        .not("sold_date", "is", null)
        .order("sold_date", { ascending: false })
        .limit(10),
      supabase
        .from("mandate_feed_items")
        .select("id, created_at, vehicle_label, expected_margin")
        .eq("dealer_id", accountId)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);
    setHealth((h.data as ScrapeHealth) ?? null);
    setRecentSold((s.data as SoldRow[]) ?? []);
    setFeed((f.data as FeedRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (accountId) load();
  }, [accountId]);

  const toggleScrape = async (enabled: boolean) => {
    setToggling(true);
    const { error } = await supabase
      .from("dealer_outbound_sources")
      .update({ scrape_enabled: enabled } as any)
      .eq("account_id", accountId);
    setToggling(false);
    if (error) {
      toast.error(`Failed to update scrape state: ${error.message}`);
      return;
    }
    toast.success(enabled ? "Scraping enabled" : "Scraping paused");
    load();
  };

  const runScrapeNow = async () => {
    const { error } = await supabase.functions.invoke("enqueue-dealer-crawl", {
      body: { account_id: accountId },
    });
    if (error) toast.error(`Scrape enqueue failed: ${error.message}`);
    else toast.success("Scrape queued");
  };

  const healthBadge = (status: string | null | undefined) => {
    if (!status) return <Badge variant="secondary">unknown</Badge>;
    const variant =
      status === "ok" ? "default" : status === "failing" ? "destructive" : "secondary";
    return <Badge variant={variant as any}>{status}</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Scrape &amp; Identity — {health?.display_name ?? dealerName ?? "Dealer"}</span>
          {healthBadge(health?.scrape_health_status)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !health ? (
          <p className="text-sm text-muted-foreground">
            No dealer record found for this account.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <Metric label="Website" value={health.dealer_domain ?? "—"} />
              <Metric
                label="Last scrape"
                value={health.last_scraped_at ? new Date(health.last_scraped_at).toLocaleString() : "Never"}
              />
              <Metric
                label="Current inventory"
                value={String(health.current_inventory_count ?? 0)}
              />
              <Metric
                label="Sold/disappeared 30d"
                value={String(health.observed_sold_30d ?? 0)}
              />
              <Metric label="Fingerprints" value={String(health.fingerprint_count ?? 0)} />
              <Metric label="Active mandates" value={String(health.active_mandates_count ?? 0)} />
              <Metric
                label="Consecutive failures"
                value={String(health.consecutive_failures ?? 0)}
              />
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Scrape enabled</span>
                <Switch
                  checked={!!health.scrape_enabled}
                  disabled={toggling}
                  onCheckedChange={toggleScrape}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={runScrapeNow}>Run scrape now</Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => activate.mutate(accountId)}
                disabled={activate.isPending}
              >
                Refresh fingerprints &amp; mandates
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => score.mutate(accountId)}
                disabled={score.isPending}
              >
                Run dealer scoring
              </Button>
              <Button size="sm" variant="outline" onClick={load}>Reload</Button>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-sm font-semibold mb-2">
                  Recent sold / disappeared
                </h4>
                {recentSold.length === 0 ? (
                  <p className="text-xs text-muted-foreground">None yet.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {recentSold.map((r) => (
                      <li key={r.id} className="flex justify-between gap-2">
                        <span className="truncate">
                          {r.year ?? ""} {r.make} {r.model} {r.variant ?? ""}
                        </span>
                        <span className="text-muted-foreground whitespace-nowrap">
                          {r.sold_date ?? r.last_seen?.slice(0, 10)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h4 className="text-sm font-semibold mb-2">Latest radar opportunities</h4>
                {feed.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No matches yet.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {feed.map((f) => (
                      <li key={f.id} className="flex justify-between gap-2">
                        <span className="truncate">{f.vehicle_label ?? f.id}</span>
                        <span className="text-muted-foreground whitespace-nowrap">
                          {f.expected_margin ? `$${f.expected_margin}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium truncate">{value}</span>
    </div>
  );
}

export default DealerScrapePanel;
