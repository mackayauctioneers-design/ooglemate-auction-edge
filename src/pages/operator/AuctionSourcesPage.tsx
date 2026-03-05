import { useEffect, useState, useMemo } from "react";
import { OperatorLayout } from "@/components/layout/OperatorLayout";
import { useIsNestedLayout } from "@/components/layout/LayoutContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Search, Radio, Globe, FlaskConical, ExternalLink } from "lucide-react";
import { toast } from "sonner";

type Source = {
  id: string;
  dealer_name: string;
  dealer_slug: string;
  dealer_domain: string;
  inventory_path: string;
  adapter_type: string;
  enabled: boolean;
  priority: string;
  consecutive_failures: number;
  last_crawl_at: string | null;
  last_crawl_count: number | null;
  last_crawl_error: string | null;
  notes: string | null;
};

const ADAPTER_OPTIONS = ["all", "firecrawl", "generic_scrape", "none"];
const PRIORITY_OPTIONS = ["all", "critical", "high", "normal", "low"];

export default function AuctionSourcesPage() {
  const isNested = useIsNestedLayout();
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [adapterFilter, setAdapterFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [enabledFilter, setEnabledFilter] = useState("all");
  const [toggling, setToggling] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("dealer_outbound_sources")
      .select("*")
      .order("dealer_name");
    if (!error) setSources((data as Source[]) || []);
    setLoading(false);
  }

  async function toggleEnabled(id: string, current: boolean) {
    setToggling(id);
    const { error } = await supabase
      .from("dealer_outbound_sources")
      .update({ enabled: !current })
      .eq("id", id);
    if (error) {
      toast.error("Failed to update");
    } else {
      toast.success(!current ? "Source enabled" : "Source disabled");
      setSources(prev => prev.map(s => s.id === id ? { ...s, enabled: !current } : s));
    }
    setToggling(null);
  }

  async function testScrape(source: Source) {
    toast.info(`Testing ${source.dealer_name}…`);
    toast.success("Test scrape not available — Manus adapter removed");
  }

  const filtered = useMemo(() => {
    return sources.filter(s => {
      if (search && !s.dealer_name.toLowerCase().includes(search.toLowerCase()) &&
          !s.dealer_domain.toLowerCase().includes(search.toLowerCase()) &&
          !s.dealer_slug.toLowerCase().includes(search.toLowerCase())) return false;
      if (adapterFilter !== "all" && s.adapter_type !== adapterFilter) return false;
      if (priorityFilter !== "all" && s.priority !== priorityFilter) return false;
      if (enabledFilter === "active" && !s.enabled) return false;
      if (enabledFilter === "inactive" && s.enabled) return false;
      return true;
    });
  }, [sources, search, adapterFilter, priorityFilter, enabledFilter]);

  const stats = useMemo(() => ({
    total: sources.length,
    active: sources.filter(s => s.enabled).length,
    manus: sources.filter(s => s.adapter_type === "manus").length,
    recentCrawl: sources.filter(s => s.last_crawl_at && new Date(s.last_crawl_at) > new Date(Date.now() - 7 * 86400000)).length,
  }), [sources]);

  useEffect(() => {
    document.title = "Auction Sources | Operator";
    load();
  }, []);

  const content = (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Radio className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Auction Sources</h1>
          <p className="text-sm text-muted-foreground">
            {stats.total} sources · {stats.active} active · {stats.manus} Manus-driven · {stats.recentCrawl} crawled this week
          </p>
        </div>
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, domain, slug…"
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={adapterFilter} onValueChange={setAdapterFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ADAPTER_OPTIONS.map(o => <SelectItem key={o} value={o}>{o === "all" ? "All Adapters" : o}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PRIORITY_OPTIONS.map(o => <SelectItem key={o} value={o}>{o === "all" ? "All Priority" : o}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={enabledFilter} onValueChange={setEnabledFilter}>
          <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Results count */}
      <div className="text-sm text-muted-foreground">
        Showing {filtered.length} of {sources.length} sources
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">Source</th>
                <th className="text-left p-3 font-medium">Domain</th>
                <th className="text-left p-3 font-medium">Adapter</th>
                <th className="text-left p-3 font-medium">Priority</th>
                <th className="text-left p-3 font-medium">Last Crawl</th>
                <th className="text-left p-3 font-medium">Lots</th>
                <th className="text-center p-3 font-medium">Active</th>
                <th className="text-right p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="p-3">
                    <div className="font-medium">{s.dealer_name}</div>
                    <div className="text-xs text-muted-foreground">{s.dealer_slug}</div>
                  </td>
                  <td className="p-3">
                    <a
                      href={`https://${s.dealer_domain}${s.inventory_path || ""}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-1"
                    >
                      {s.dealer_domain}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                  <td className="p-3">
                    <Badge variant={s.adapter_type === "manus" ? "default" : s.adapter_type === "firecrawl" ? "secondary" : "outline"}>
                      {s.adapter_type}
                    </Badge>
                  </td>
                  <td className="p-3">
                    <Badge variant={s.priority === "critical" ? "destructive" : s.priority === "high" ? "secondary" : "outline"}>
                      {s.priority}
                    </Badge>
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {s.last_crawl_at ? new Date(s.last_crawl_at).toLocaleDateString() : "—"}
                    {s.consecutive_failures > 0 && (
                      <span className="text-destructive ml-1">({s.consecutive_failures}×fail)</span>
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground">{s.last_crawl_count ?? "—"}</td>
                  <td className="p-3 text-center">
                    <Switch
                      checked={s.enabled}
                      disabled={toggling === s.id}
                      onCheckedChange={() => toggleEnabled(s.id, s.enabled)}
                    />
                  </td>
                  <td className="p-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => testScrape(s)}
                    >
                      <FlaskConical className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-muted-foreground">
                    No sources match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  if (isNested) return <div className="p-4">{content}</div>;

  return (
    <OperatorLayout>
      <div className="p-6 max-w-7xl mx-auto">{content}</div>
    </OperatorLayout>
  );
}
