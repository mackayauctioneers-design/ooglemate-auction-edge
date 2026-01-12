import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw } from "lucide-react";

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

function pctColor(p: number) {
  if (p >= 60) return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (p >= 25) return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  return "bg-red-500/15 text-red-400 border-red-500/30";
}

function fmtNum(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString();
}

function fmtPct(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `${n.toFixed(0)}%`;
}

export default function FeedingModeReportPage() {
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<FeedingModeReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchReport() {
    setLoading(true);
    setError(null);

    try {
      // Preferred: use latest stored report from DB (fast + stable)
      const dbRes = await supabase
        .from("feeding_mode_reports")
        .select("report_date, report_json, created_at")
        .order("report_date", { ascending: false })
        .limit(1);

      if (!dbRes.error && dbRes.data && dbRes.data.length > 0) {
        const row = dbRes.data[0];
        setReport(row.report_json as unknown as FeedingModeReport);
        setLoading(false);
        return;
      }

      // Fallback: hit edge function directly
      const { data, error: fnErr } = await supabase.functions.invoke("feeding-mode-report", {
        body: { days: 14 },
      });

      if (fnErr) throw new Error(fnErr.message);
      setReport(data as FeedingModeReport);
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : "Failed to load feeding mode report";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchReport();
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

  const benchmarkOverall = report?.benchmark_coverage
    ? {
        pct: report.benchmark_coverage.coverage_pct,
        total: report.benchmark_coverage.total_deals,
        bench: report.benchmark_coverage.total_benchmarked,
      }
    : null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Feeding Mode Report</h1>
          <p className="text-sm text-muted-foreground">
            Daily snapshot of ingestion health, fingerprint maturity, and benchmark coverage.
          </p>
          {report?.period && (
            <p className="text-xs text-muted-foreground mt-1">
              Window: {report.period.start} → {report.period.end} ({report.period.days} days) • Generated:{" "}
              {new Date(report.generated_at).toLocaleString()}
            </p>
          )}
        </div>

        <Button onClick={fetchReport} disabled={loading} variant="secondary" className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-[110px] rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive">Failed to load report</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{error}</CardContent>
        </Card>
      ) : !report || !headline ? (
        <Card>
          <CardHeader>
            <CardTitle>No report yet</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            No feeding-mode report data found. Run the `feeding-mode-report` function or wait for cron.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Vehicles Found</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{fmtNum(headline.found)}</div>
                <div className="text-xs text-muted-foreground">All sources</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Ingested</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{fmtNum(headline.ingested)}</div>
                <div className="text-xs text-muted-foreground">Ingestion rate: {fmtPct(headline.ingestRate)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Clearances</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{fmtNum(headline.clears)}</div>
                <div className="text-xs text-muted-foreground">Events recorded</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Benchmark Coverage</CardTitle>
              </CardHeader>
              <CardContent>
                {benchmarkOverall ? (
                  <>
                    <div className="text-2xl font-semibold">{fmtPct(benchmarkOverall.pct)}</div>
                    <div className="text-xs text-muted-foreground">
                      Benchmarked {fmtNum(benchmarkOverall.bench)} / {fmtNum(benchmarkOverall.total)} trap deals
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-2xl font-semibold">—</div>
                    <div className="text-xs text-muted-foreground">No benchmark coverage data</div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Benchmark Coverage by Region */}
          {report.benchmark_coverage?.by_region?.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Benchmark Coverage by Region</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {report.benchmark_coverage.by_region.map((r) => (
                    <div key={r.region_id} className="rounded-xl border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">{r.region_id.replace(/_/g, " ")}</div>
                        <Badge variant="outline" className={pctColor(r.coverage_pct)}>
                          {fmtPct(r.coverage_pct)}
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
              {report.source_mix_14d?.length ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {report.source_mix_14d.map((s) => (
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
              {report.top_fingerprints?.length ? (
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
                      {report.top_fingerprints.map((fp, idx) => (
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
