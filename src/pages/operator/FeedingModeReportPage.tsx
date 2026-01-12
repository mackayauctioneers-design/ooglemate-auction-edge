import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, AlertTriangle, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type SourceMixRow = { source: string; count: number; pct: number };

type RelistRates = {
  auction_relist_rate?: { total: number; relisted: number; rate_pct: number; sources?: string[] };
  trap_relist_proxy_rate?: { total: number; relisted: number; rate_pct: number; sources?: string[]; note?: string };
};

type BenchmarkCoverageRow = {
  region_id: string;
  total_deals: number;
  benchmarked: number;
  coverage_pct: number;
};

type TopFingerprintRow = {
  make: string;
  model: string;
  variant_family: string | null;
  year_range: string;
  region_id: string;
  sample_size: number;
  cleared: number;
  clearance_rate: number;
  avg_days_to_clear: number | null;
  relist_rate: number;
  passed_in_rate: number;
};

type HealthSummary = {
  total_vehicles_found: number;
  total_vehicles_ingested: number;
  total_vehicles_dropped: number;
  ingestion_rate: number;
  snapshots_created: number;
  clearances_recorded: number;
  crawl_runs: number;
};

type IngestionBySource = Record<string, { found: number; created: number; updated: number; runs: number }>;
type DropReason = { reason: string; count: number };

type FeedingModeReport = {
  generated_at: string;
  period: { start: string; end: string; days: number };
  top_fingerprints: TopFingerprintRow[];
  source_mix_14d: SourceMixRow[];
  relist_rates_by_source?: RelistRates;
  benchmark_coverage?: {
    total_deals: number;
    total_benchmarked: number;
    coverage_pct: number;
    by_region: BenchmarkCoverageRow[];
  };
  health_summary: HealthSummary;
  ingestion_by_source: IngestionBySource;
  top_drop_reasons: DropReason[];
};

type CronAuditRow = {
  cron_name: string;
  run_date: string;
  run_at?: string | null;
  success: boolean;
  result?: unknown;
  error?: string | null;
  created_at?: string;
};

function fmtNum(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString();
}

function fmtPct(n: number | null | undefined, digits = 0) {
  if (n === null || n === undefined) return "—";
  return `${n.toFixed(digits)}%`;
}

function pctClass(p: number) {
  if (p >= 60) return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (p >= 25) return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  return "bg-red-500/15 text-red-400 border-red-500/30";
}

function scoreColor(score: number) {
  if (score >= 80) return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (score >= 55) return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  return "bg-red-500/15 text-red-400 border-red-500/30";
}

function isAuctionSource(source: string) {
  const s = (source || "").toLowerCase();
  return (
    s.includes("pickles") ||
    s.includes("manheim") ||
    s.includes("nsw-regional") ||
    s.includes("f3") ||
    s.includes("auto_auctions") ||
    s.includes("autoauctions") ||
    s.includes("aav") ||
    s.includes("auction")
  );
}

function computeFeedScore(report: FeedingModeReport, cronRows: CronAuditRow[]) {
  const h = report.health_summary;
  const bench = report.benchmark_coverage?.coverage_pct ?? 0;

  const ingestionRate = h.ingestion_rate ?? 0;
  const sIngest =
    ingestionRate >= 90 ? 30 :
    ingestionRate >= 75 ? 22 :
    ingestionRate >= 60 ? 15 :
    ingestionRate >= 40 ? 8 : 3;

  const sBench =
    bench >= 50 ? 35 :
    bench >= 30 ? 26 :
    bench >= 15 ? 18 :
    bench >= 5 ? 10 : 2;

  const clears = h.clearances_recorded ?? 0;
  const sClears =
    clears >= 200 ? 15 :
    clears >= 100 ? 11 :
    clears >= 50 ? 7 :
    clears >= 10 ? 3 : 1;

  const expected = [
    "dealer-site-crawl",
    "fingerprint-materialize",
    "geo-pipeline",
    "manheim-crawl",
    "trap-health-alerts",
    "feeding-mode-report",
  ];
  const last24 = cronRows;

  const failures = last24.filter(r => r.success === false);
  const seen = new Set(last24.map(r => r.cron_name));
  const missing = expected.filter(n => !seen.has(n));

  let sCron = 20;
  if (failures.length > 0) sCron -= Math.min(12, failures.length * 4);
  if (missing.length > 0) sCron -= Math.min(12, missing.length * 3);
  if (sCron < 0) sCron = 0;

  const score = Math.max(0, Math.min(100, sIngest + sBench + sClears + sCron));

  const notes: string[] = [];
  notes.push(`Ingestion rate: ${ingestionRate.toFixed(0)}% (+${sIngest})`);
  notes.push(`Benchmark coverage: ${bench.toFixed(1)}% (+${sBench})`);
  notes.push(`Clearances: ${clears} (+${sClears})`);
  notes.push(`Cron health: ${sCron}/20 (failures=${failures.length}, missing=${missing.length})`);

  return { score, breakdown: { sIngest, sBench, sClears, sCron }, failures, missing, notes };
}

export default function FeedingModeReportPage() {
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<FeedingModeReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [cronLoading, setCronLoading] = useState(true);
  const [cronRows, setCronRows] = useState<CronAuditRow[]>([]);

  const [regionScope, setRegionScope] = useState<"NSW" | "ALL">("NSW");
  const [sourceScope, setSourceScope] = useState<"ALL" | "AUCTIONS" | "TRAPS">("ALL");
  const [onlyBenchmarked, setOnlyBenchmarked] = useState(false);

  async function fetchReport() {
    setLoading(true);
    setError(null);

    try {
      const dbRes = await supabase
        .from("feeding_mode_reports")
        .select("report_date, report_json, created_at")
        .order("report_date", { ascending: false })
        .limit(1);

      if (!dbRes.error && dbRes.data && dbRes.data.length > 0) {
        const row = dbRes.data[0];
        setReport(row.report_json as unknown as FeedingModeReport);
        return;
      }

      const { data, error: fnErr } = await supabase.functions.invoke("feeding-mode-report", { body: { days: 14 } });
      if (fnErr) throw new Error(fnErr.message);
      setReport(data as FeedingModeReport);
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : "Failed to load feeding mode report";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  async function fetchCronAudit() {
    setCronLoading(true);
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const res = await supabase
        .from("cron_audit_log")
        .select("cron_name, run_date, run_at, success, result, error")
        .gte("run_at", since)
        .order("run_at", { ascending: false })
        .limit(50);

      if (res.error) throw res.error;
      setCronRows((res.data as CronAuditRow[]) || []);
    } catch {
      setCronRows([]);
    } finally {
      setCronLoading(false);
    }
  }

  async function refreshAll() {
    await Promise.all([fetchReport(), fetchCronAudit()]);
  }

  useEffect(() => {
    refreshAll();
  }, []);

  const headline = useMemo(() => {
    if (!report) return null;
    const h = report.health_summary;
    return {
      found: h.total_vehicles_found,
      ingested: h.total_vehicles_ingested,
      dropped: h.total_vehicles_dropped,
      ingestRate: h.ingestion_rate,
      clears: h.clearances_recorded,
      snaps: h.snapshots_created,
      runs: h.crawl_runs,
    };
  }, [report]);

  const filteredBenchByRegion = useMemo(() => {
    const rows = report?.benchmark_coverage?.by_region || [];
    const scoped = regionScope === "NSW" ? rows.filter(r => (r.region_id || "").startsWith("NSW_")) : rows;
    return scoped.sort((a, b) => (b.total_deals || 0) - (a.total_deals || 0));
  }, [report, regionScope]);

  const filteredTopFingerprints = useMemo(() => {
    const rows = report?.top_fingerprints || [];
    const scoped = regionScope === "NSW" ? rows.filter(r => (r.region_id || "").startsWith("NSW_")) : rows;
    return scoped;
  }, [report, regionScope]);

  const filteredSourceMix = useMemo(() => {
    const rows = report?.source_mix_14d || [];
    if (sourceScope === "ALL") return rows;
    if (sourceScope === "AUCTIONS") return rows.filter(r => isAuctionSource(r.source));
    return rows.filter(r => !isAuctionSource(r.source));
  }, [report, sourceScope]);

  const sourceTotals = useMemo(() => {
    const by = report?.ingestion_by_source || {};
    const entries = Object.entries(by);
    const auctions = entries.filter(([k]) => isAuctionSource(k));
    const traps = entries.filter(([k]) => !isAuctionSource(k));

    const sum = (arr: [string, { found: number; created: number; updated: number; runs: number }][]) =>
      arr.reduce(
        (acc, [, v]) => {
          acc.found += v.found || 0;
          acc.created += v.created || 0;
          acc.updated += v.updated || 0;
          acc.runs += v.runs || 0;
          return acc;
        },
        { found: 0, created: 0, updated: 0, runs: 0 }
      );

    return { auctions: sum(auctions), traps: sum(traps) };
  }, [report]);

  const feedScore = useMemo(() => {
    if (!report) return null;
    return computeFeedScore(report, cronRows);
  }, [report, cronRows]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Feeding Mode Report</h1>
          <p className="text-sm text-muted-foreground">
            Health snapshot + benchmark maturity + cron confidence.
          </p>
          {report?.period && (
            <p className="text-xs text-muted-foreground mt-1">
              Window: {report.period.start} → {report.period.end} ({report.period.days} days) • Generated:{" "}
              {new Date(report.generated_at).toLocaleString()}
            </p>
          )}
        </div>

        <Button onClick={refreshAll} disabled={loading || cronLoading} variant="secondary" className="gap-2">
          <RefreshCw className={`h-4 w-4 ${(loading || cronLoading) ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col md:flex-row gap-4 md:items-center">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground w-[90px]">Region</Label>
            <Select value={regionScope} onValueChange={(v) => setRegionScope(v as "NSW" | "ALL")}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Region scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NSW">NSW only</SelectItem>
                <SelectItem value="ALL">National</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground w-[90px]">Sources</Label>
            <Select value={sourceScope} onValueChange={(v) => setSourceScope(v as "ALL" | "AUCTIONS" | "TRAPS")}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Source scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="AUCTIONS">Auctions</SelectItem>
                <SelectItem value="TRAPS">Traps</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Switch checked={onlyBenchmarked} onCheckedChange={setOnlyBenchmarked} />
            <Label className="text-xs text-muted-foreground">Only benchmarked</Label>
          </div>
        </CardContent>
      </Card>

      {(loading || cronLoading) ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-[110px] rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive">Failed to load</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{error}</CardContent>
        </Card>
      ) : !report || !headline ? (
        <Card>
          <CardHeader>
            <CardTitle>No report yet</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            No feeding-mode report data found. Run `feeding-mode-report` once or wait for cron.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Feed Score */}
          {feedScore ? (
            <Card className="border-primary/30">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Feed Score</span>
                  <Badge variant="outline" className={scoreColor(feedScore.score)}>
                    {feedScore.score}/100
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${feedScore.score}%` }} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                  <div className="rounded-xl border p-3">
                    <div className="text-xs text-muted-foreground">Ingestion</div>
                    <div className="text-lg font-semibold">{feedScore.breakdown.sIngest}/30</div>
                  </div>
                  <div className="rounded-xl border p-3">
                    <div className="text-xs text-muted-foreground">Benchmark coverage</div>
                    <div className="text-lg font-semibold">{feedScore.breakdown.sBench}/35</div>
                  </div>
                  <div className="rounded-xl border p-3">
                    <div className="text-xs text-muted-foreground">Clearances volume</div>
                    <div className="text-lg font-semibold">{feedScore.breakdown.sClears}/15</div>
                  </div>
                  <div className="rounded-xl border p-3">
                    <div className="text-xs text-muted-foreground">Cron health</div>
                    <div className="text-lg font-semibold">{feedScore.breakdown.sCron}/20</div>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground space-y-1">
                  {feedScore.notes.map((n, i) => (
                    <div key={i}>• {n}</div>
                  ))}
                </div>

                {(feedScore.failures.length > 0 || feedScore.missing.length > 0) && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                    <div className="text-sm font-medium flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-400" />
                      Action required
                    </div>
                    {feedScore.failures.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-2">
                        Failed crons (24h):{" "}
                        <span className="text-amber-300">
                          {feedScore.failures.map(f => f.cron_name).join(", ")}
                        </span>
                      </div>
                    )}
                    {feedScore.missing.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Missing expected runs (24h):{" "}
                        <span className="text-amber-300">{feedScore.missing.join(", ")}</span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {/* KPI cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Vehicles Found</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{fmtNum(headline.found)}</div>
                <div className="text-xs text-muted-foreground">All sources</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Ingested</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{fmtNum(headline.ingested)}</div>
                <div className="text-xs text-muted-foreground">Ingestion rate: {fmtPct(headline.ingestRate)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Clearances</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{fmtNum(headline.clears)}</div>
                <div className="text-xs text-muted-foreground">Events recorded</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Snapshots</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{fmtNum(headline.snaps)}</div>
                <div className="text-xs text-muted-foreground">Price / status snapshots</div>
              </CardContent>
            </Card>
          </div>

          {/* Source Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Source Breakdown (14d)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border p-4">
                  <div className="text-sm font-medium mb-2">Auctions</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>Found: <span className="font-semibold">{fmtNum(sourceTotals.auctions.found)}</span></div>
                    <div>Created: <span className="font-semibold">{fmtNum(sourceTotals.auctions.created)}</span></div>
                    <div>Updated: <span className="font-semibold">{fmtNum(sourceTotals.auctions.updated)}</span></div>
                    <div>Runs: <span className="font-semibold">{fmtNum(sourceTotals.auctions.runs)}</span></div>
                  </div>
                </div>
                <div className="rounded-xl border p-4">
                  <div className="text-sm font-medium mb-2">Traps</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>Found: <span className="font-semibold">{fmtNum(sourceTotals.traps.found)}</span></div>
                    <div>Created: <span className="font-semibold">{fmtNum(sourceTotals.traps.created)}</span></div>
                    <div>Updated: <span className="font-semibold">{fmtNum(sourceTotals.traps.updated)}</span></div>
                    <div>Runs: <span className="font-semibold">{fmtNum(sourceTotals.traps.runs)}</span></div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Cron Audit Panel */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Cron Audit (last 24h)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {cronRows.length === 0 ? (
                <div className="text-sm text-muted-foreground">No cron audit data found.</div>
              ) : (
                <div className="space-y-2">
                  {cronRows.slice(0, 12).map((r, idx) => (
                    <div key={`${r.cron_name}-${idx}`} className="flex items-start justify-between gap-3 rounded-xl border p-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{r.cron_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.run_at ? new Date(r.run_at).toLocaleString() : (r.created_at ? new Date(r.created_at).toLocaleString() : r.run_date)}
                        </div>
                        {r.error ? (
                          <div className="text-xs text-destructive mt-1 break-words">Error: {r.error}</div>
                        ) : null}
                      </div>
                      <div className="shrink-0">
                        {r.success ? (
                          <Badge variant="outline" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                            <CheckCircle2 className="h-3 w-3 inline mr-1" />
                            success
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-red-500/15 text-red-400 border-red-500/30">
                            <XCircle className="h-3 w-3 inline mr-1" />
                            fail
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Benchmark Coverage by Region */}
          {report.benchmark_coverage?.by_region?.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Benchmark Coverage by Region</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs text-muted-foreground">
                  Shows how much of Trap Inventory has a benchmark price (enables deal logic).
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filteredBenchByRegion.map((r) => (
                    <div key={r.region_id} className="rounded-xl border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">{r.region_id.replace(/_/g, " ")}</div>
                        <Badge variant="outline" className={pctClass(r.coverage_pct)}>
                          {fmtPct(r.coverage_pct, 1)}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {fmtNum(r.benchmarked)} / {fmtNum(r.total_deals)} benchmarked
                      </div>
                      <div className="h-2 rounded-full bg-muted mt-2 overflow-hidden">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${Math.min(100, r.coverage_pct)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Source Mix */}
          <Card>
            <CardHeader>
              <CardTitle>Source Mix (14d)</CardTitle>
            </CardHeader>
            <CardContent>
              {filteredSourceMix?.length ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filteredSourceMix.map((s) => (
                    <div key={s.source} className="flex items-center justify-between rounded-xl border p-3">
                      <div className="text-sm font-medium">{s.source}</div>
                      <div className="text-xs text-muted-foreground">
                        {fmtNum(s.count)} ({s.pct}%)
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No source mix data.</div>
              )}
            </CardContent>
          </Card>

          {/* Relist Rates */}
          {report.relist_rates_by_source ? (
            <Card>
              <CardHeader>
                <CardTitle>Relist Rates</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">Auction relist rate</div>
                    <Badge variant="outline">
                      {fmtPct(report.relist_rates_by_source.auction_relist_rate?.rate_pct ?? 0)}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Relisted {fmtNum(report.relist_rates_by_source.auction_relist_rate?.relisted ?? 0)} /{" "}
                    {fmtNum(report.relist_rates_by_source.auction_relist_rate?.total ?? 0)}
                  </div>
                </div>

                <div className="rounded-xl border p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">Trap relist proxy rate</div>
                    <Badge variant="outline">
                      {fmtPct(report.relist_rates_by_source.trap_relist_proxy_rate?.rate_pct ?? 0)}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Proxy relisted {fmtNum(report.relist_rates_by_source.trap_relist_proxy_rate?.relisted ?? 0)} /{" "}
                    {fmtNum(report.relist_rates_by_source.trap_relist_proxy_rate?.total ?? 0)}
                  </div>
                  {report.relist_rates_by_source.trap_relist_proxy_rate?.note ? (
                    <div className="text-xs text-muted-foreground mt-2">
                      Note: {report.relist_rates_by_source.trap_relist_proxy_rate.note}
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Top Drop Reasons */}
          <Card>
            <CardHeader>
              <CardTitle>Top Drop Reasons (14d)</CardTitle>
            </CardHeader>
            <CardContent>
              {report.top_drop_reasons?.length ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {report.top_drop_reasons.slice(0, 12).map((d) => (
                    <div key={d.reason} className="flex items-center justify-between rounded-xl border p-3">
                      <div className="text-sm">{d.reason.replace(/_/g, " ")}</div>
                      <div className="text-xs text-muted-foreground">{fmtNum(d.count)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No drop reason data.</div>
              )}
            </CardContent>
          </Card>

          {/* Top Fingerprints */}
          <Card>
            <CardHeader>
              <CardTitle>Top Fingerprints (14d window)</CardTitle>
            </CardHeader>
            <CardContent>
              {filteredTopFingerprints?.length ? (
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr className="border-b">
                        <th className="text-left py-2">Region</th>
                        <th className="text-left py-2">Make</th>
                        <th className="text-left py-2">Model</th>
                        <th className="text-left py-2">Variant</th>
                        <th className="text-left py-2">Years</th>
                        <th className="text-right py-2">Sample</th>
                        <th className="text-right py-2">Cleared</th>
                        <th className="text-right py-2">Clear %</th>
                        <th className="text-right py-2">TTD</th>
                        <th className="text-right py-2">Relist %</th>
                        <th className="text-right py-2">Passed %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTopFingerprints.map((fp, idx) => (
                        <tr key={`${fp.make}-${fp.model}-${idx}`} className="border-b last:border-0">
                          <td className="py-2">{fp.region_id}</td>
                          <td className="py-2">{fp.make}</td>
                          <td className="py-2">{fp.model}</td>
                          <td className="py-2">{fp.variant_family || "ALL"}</td>
                          <td className="py-2">{fp.year_range}</td>
                          <td className="py-2 text-right">{fmtNum(fp.sample_size)}</td>
                          <td className="py-2 text-right">{fmtNum(fp.cleared)}</td>
                          <td className="py-2 text-right">{fmtPct(fp.clearance_rate)}</td>
                          <td className="py-2 text-right">{fp.avg_days_to_clear ? `${fp.avg_days_to_clear}d` : "—"}</td>
                          <td className="py-2 text-right">{fmtPct(fp.relist_rate)}</td>
                          <td className="py-2 text-right">{fmtPct(fp.passed_in_rate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No fingerprint data in report.</div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
