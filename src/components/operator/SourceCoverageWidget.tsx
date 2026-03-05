import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Globe } from "lucide-react";

type Stats = {
  total: number;
  active: number;
  firecrawl: number;
  none: number;
  recentActivity: number;
  stale: number;
};

export function SourceCoverageWidget() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("dealer_outbound_sources")
        .select("enabled, adapter_type, last_crawl_at");

      if (!data) return;
      const now = Date.now();
      const week = 7 * 86400000;

      setStats({
        total: data.length,
        active: data.filter(d => d.enabled).length,
        firecrawl: data.filter(d => d.adapter_type === "firecrawl").length,
        none: data.filter(d => d.adapter_type === "none").length,
        recentActivity: data.filter(d => d.last_crawl_at && new Date(d.last_crawl_at).getTime() > now - week).length,
        stale: data.filter(d => d.enabled && (!d.last_crawl_at || new Date(d.last_crawl_at).getTime() < now - 14 * 86400000)).length,
      });
    })();
  }, []);

  if (!stats) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Globe className="h-4 w-4" />
          Source Coverage
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-muted-foreground">Total Sources</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-primary">{stats.active}</div>
            <div className="text-muted-foreground">Active</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{stats.recentActivity}</div>
            <div className="text-muted-foreground">Crawled 7d</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-destructive">{stats.stale}</div>
            <div className="text-muted-foreground">Stale / No Data</div>
          </div>
        </div>
        <div className="flex gap-2 mt-3 flex-wrap">
          <Badge variant="default">{stats.manus} Manus</Badge>
          <Badge variant="secondary">{stats.firecrawl} Firecrawl</Badge>
          <Badge variant="outline">{stats.none} Blocked</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
