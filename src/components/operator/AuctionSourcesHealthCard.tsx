import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

type Row = {
  source_key: string;
  display_name: string;
  platform: string;
  enabled: boolean;
  preflight_status: string | null;
  last_crawl_success_at: string | null;
  last_crawl_fail_at: string | null;
  consecutive_crawl_failures: number;
  last_lots_found: number | null;
  last_crawl_error: string | null;
  auto_disabled_at: string | null;
  auto_disabled_reason: string | null;
};

function statusBadge(r: Row) {
  if (!r.enabled) return <Badge variant="destructive">Disabled</Badge>;
  if (r.consecutive_crawl_failures >= 1) return <Badge variant="secondary">Flaky</Badge>;
  return <Badge className="bg-green-600">Healthy</Badge>;
}

export function AuctionSourcesHealthCard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_auction_sources_health" as never);
    if (!error) setRows((data as Row[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Auction Sources Health</CardTitle>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">No auction sources configured.</div>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.source_key} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="font-medium">
                    {r.display_name}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({r.source_key})
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {statusBadge(r)}
                    <Badge variant="outline">{r.platform}</Badge>
                    {r.preflight_status && (
                      <Badge variant="outline">{r.preflight_status}</Badge>
                    )}
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    Last success:{" "}
                    <span className="text-muted-foreground">
                      {r.last_crawl_success_at
                        ? new Date(r.last_crawl_success_at).toLocaleString()
                        : "—"}
                    </span>
                  </div>
                  <div>
                    Last lots:{" "}
                    <span className="text-muted-foreground">
                      {r.last_lots_found ?? "—"}
                    </span>
                  </div>
                  <div>
                    Fail streak:{" "}
                    <span className="text-muted-foreground">
                      {r.consecutive_crawl_failures}
                    </span>
                  </div>
                  <div>
                    Last fail:{" "}
                    <span className="text-muted-foreground">
                      {r.last_crawl_fail_at
                        ? new Date(r.last_crawl_fail_at).toLocaleString()
                        : "—"}
                    </span>
                  </div>
                </div>

                {(r.last_crawl_error || r.auto_disabled_reason) && (
                  <div className="mt-2 text-xs text-muted-foreground truncate">
                    {r.auto_disabled_reason ? (
                      <span className="text-destructive">Auto-disabled: {r.auto_disabled_reason}</span>
                    ) : (
                      <>Last error: {r.last_crawl_error}</>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
