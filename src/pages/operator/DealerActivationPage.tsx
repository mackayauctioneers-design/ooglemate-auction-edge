import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, AlertCircle, Loader2, RefreshCw, ChevronDown, ChevronUp, Activity } from "lucide-react";

interface WorkerRunRow {
  id: string;
  action: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  attempt_n: number | null;
  error: string | null;
}

interface OnboardingAlert {
  id: string;
  dealer_id: string;
  gate: string;
  severity: string;
  message: string;
  attempt_n: number;
  created_at: string;
}


type GateKey =
  | "profile"
  | "dealer_id"
  | "sales"
  | "fingerprints"
  | "strategic"
  | "mandates"
  | "sourcing"
  | "radar"
  | "health";

interface Gate {
  key: GateKey;
  label: string;
  passed: boolean;
  detail: string;
  owner: string;
  remediation: string;
}

interface DealerRow {
  id: string;
  name: string;
  account_id: string | null;
  website: string | null;
  sales_count: number;
  last_sale: string | null;
  fp_count: number;
  mandate_count: number;
  strategic_count: number;
  strategic_updated_at: string | null;
  last_worker_run: string | null;
  last_mandate_run: string | null;
  recent_feed_count: number;
  gates: Gate[];
  status: "ACTIVE" | "IN_PROGRESS" | "NOT_STARTED" | "ERROR";
  passedCount: number;
}

const GATE_DEFS: Array<{ key: GateKey; label: string; owner: string; remediation: string }> = [
  { key: "profile",      label: "1. Profile exists",          owner: "Operator",  remediation: "Create dealer_profiles row" },
  { key: "dealer_id",    label: "2. Dealer ID + Account",     owner: "Operator",  remediation: "Link dealer_profile.account_id to an accounts row" },
  { key: "sales",        label: "3. Sales imported",          owner: "VA / Aaron",remediation: "Upload sales report via Operator → Dealer Upload" },
  { key: "fingerprints", label: "4. Fingerprints generated",  owner: "OpenCore",  remediation: "Run recompute-fingerprint-performance or crawl dealer website" },
  { key: "strategic",    label: "5. Strategic profile",       owner: "OpenCore",  remediation: "Invoke build-dealer-intelligence-profile" },
  { key: "mandates",     label: "6. Mandates generated",      owner: "OpenCore",  remediation: "Invoke generate-dealer-mandates (requires fingerprints)" },
  { key: "sourcing",     label: "7. Sourcing active",         owner: "OpenCore",  remediation: "Mandate has not run in 7d — check run-mandate cron" },
  { key: "radar",        label: "8. Radar / feed items",      owner: "OpenCore",  remediation: "No mandate_feed_items in 7d — check worker callbacks" },
  { key: "health",       label: "9. Health monitor",          owner: "OpenCore",  remediation: "No worker_runs in 24h — check dealer-health cron" },
];

function computeGates(d: Omit<DealerRow, "gates" | "status" | "passedCount">): Gate[] {
  const now = Date.now();
  const within = (iso: string | null, hours: number) =>
    !!iso && now - new Date(iso).getTime() < hours * 3600_000;

  const results: Record<GateKey, { passed: boolean; detail: string }> = {
    profile:      { passed: !!d.id, detail: d.id ? "OK" : "no profile" },
    dealer_id:    { passed: !!d.account_id, detail: d.account_id ? d.account_id.slice(0, 8) : "no account_id" },
    sales:        { passed: d.sales_count > 0, detail: `${d.sales_count} rows${d.last_sale ? ` · last ${d.last_sale.slice(0, 10)}` : ""}` },
    fingerprints: { passed: d.fp_count > 0, detail: `${d.fp_count} active` },
    strategic:    { passed: d.strategic_count > 0 || !!d.strategic_updated_at, detail: d.strategic_updated_at ? `updated ${d.strategic_updated_at.slice(0, 10)}` : d.strategic_count > 0 ? "exists" : "missing" },
    mandates:     { passed: d.mandate_count > 0, detail: `${d.mandate_count} active` },
    sourcing:     { passed: within(d.last_mandate_run, 24 * 7), detail: d.last_mandate_run ? `last run ${d.last_mandate_run.slice(0, 16).replace("T", " ")}` : "never" },
    radar:        { passed: d.recent_feed_count > 0, detail: `${d.recent_feed_count} feed items in 7d` },
    health:       { passed: within(d.last_worker_run, 24), detail: d.last_worker_run ? `last ${d.last_worker_run.slice(0, 16).replace("T", " ")}` : "never" },
  };

  return GATE_DEFS.map((g) => ({
    ...g,
    passed: results[g.key].passed,
    detail: results[g.key].detail,
  }));
}

function deriveStatus(gates: Gate[]): { status: DealerRow["status"]; passedCount: number } {
  const passedCount = gates.filter((g) => g.passed).length;
  if (passedCount === gates.length) return { status: "ACTIVE", passedCount };
  if (passedCount === 0) return { status: "NOT_STARTED", passedCount };
  if (passedCount >= 6) return { status: "IN_PROGRESS", passedCount };
  // many missing but partially started → ERROR signal for review
  return passedCount >= 3 ? { status: "IN_PROGRESS", passedCount } : { status: "ERROR", passedCount };
}

const STATUS_STYLES: Record<DealerRow["status"], string> = {
  ACTIVE:       "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  IN_PROGRESS:  "bg-amber-500/15 text-amber-700 border-amber-500/30",
  NOT_STARTED:  "bg-muted text-muted-foreground border-border",
  ERROR:        "bg-destructive/15 text-destructive border-destructive/30",
};

export default function DealerActivationPage() {
  useEffect(() => { document.title = "Dealer Activation Engine"; }, []);
  const [rows, setRows] = useState<DealerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<OnboardingAlert[]>([]);
  const [runsByDealer, setRunsByDealer] = useState<Record<string, WorkerRunRow[]>>({});

  async function loadRunsFor(dealerId: string) {
    if (runsByDealer[dealerId]) return;
    const { data } = await supabase
      .from("worker_runs")
      .select("id, action, status, started_at, finished_at, attempt_n, error")
      .eq("dealer_id", dealerId)
      .order("started_at", { ascending: false })
      .limit(20);
    setRunsByDealer((s) => ({ ...s, [dealerId]: (data ?? []) as WorkerRunRow[] }));
  }

  async function triggerWatchdog() {
    await supabase.functions.invoke("dealer-onboarding-watchdog", { body: { source: "manual" } });
    await load();
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data: dealers, error: dErr } = await supabase
        .from("dealer_profiles")
        .select("id, dealer_name, account_id, dealer_website, strategic_profile_updated_at")
        .order("dealer_name");
      if (dErr) throw dErr;

      const since7d = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

      const results = await Promise.all(
        (dealers ?? []).map(async (d: any) => {
          const [salesRes, fpRes, mandatesRes, stratRes, workerRes, mandateRunMaxRes, feedRes] = await Promise.all([
            d.account_id
              ? supabase.from("vehicle_sales_truth").select("sold_at", { count: "exact" }).eq("account_id", d.account_id).order("sold_at", { ascending: false }).limit(1)
              : Promise.resolve({ data: [], count: 0 } as any),
            supabase.from("dealer_fingerprints").select("id", { count: "exact", head: true }).eq("dealer_profile_id", d.id).eq("is_active", true),
            supabase.from("active_mandates").select("id, last_run_at", { count: "exact" }).eq("dealer_id", d.id).eq("is_active", true).order("last_run_at", { ascending: false, nullsFirst: false }).limit(1),
            d.account_id
              ? supabase.from("dealer_intelligence_profiles").select("id", { count: "exact", head: true }).eq("account_id", d.account_id)
              : Promise.resolve({ count: 0 } as any),
            supabase.from("worker_runs").select("started_at").eq("dealer_id", d.id).order("started_at", { ascending: false }).limit(1),
            supabase.from("active_mandates").select("last_run_at").eq("dealer_id", d.id).not("last_run_at", "is", null).order("last_run_at", { ascending: false }).limit(1),
            supabase.from("mandate_feed_items").select("id", { count: "exact", head: true }).eq("dealer_id", d.id).gte("created_at", since7d),
          ]);

          const base = {
            id: d.id,
            name: d.dealer_name,
            account_id: d.account_id,
            website: d.dealer_website,
            sales_count: salesRes.count ?? 0,
            last_sale: (salesRes.data?.[0]?.sold_at as string | undefined) ?? null,
            fp_count: fpRes.count ?? 0,
            mandate_count: mandatesRes.count ?? 0,
            strategic_count: stratRes.count ?? 0,
            strategic_updated_at: d.strategic_profile_updated_at,
            last_worker_run: (workerRes.data?.[0]?.started_at as string | undefined) ?? null,
            last_mandate_run: (mandateRunMaxRes.data?.[0]?.last_run_at as string | undefined) ?? null,
            recent_feed_count: feedRes.count ?? 0,
          };
          const gates = computeGates(base);
          const { status, passedCount } = deriveStatus(gates);
          return { ...base, gates, status, passedCount } as DealerRow;
        })
      );

      // Sort: ERROR → IN_PROGRESS → NOT_STARTED → ACTIVE
      const order: Record<DealerRow["status"], number> = { ERROR: 0, IN_PROGRESS: 1, NOT_STARTED: 2, ACTIVE: 3 };
      results.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
      setRows(results);
    } catch (e: any) {
      setError(e.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    (async () => {
      const { data } = await supabase
        .from("onboarding_alerts")
        .select("id, dealer_id, gate, severity, message, attempt_n, created_at")
        .is("resolved_at", null)
        .order("created_at", { ascending: false });
      setAlerts((data ?? []) as OnboardingAlert[]);
    })();
  }, []);

  const summary = useMemo(() => {
    const s = { ACTIVE: 0, IN_PROGRESS: 0, NOT_STARTED: 0, ERROR: 0 };
    rows.forEach((r) => (s[r.status] += 1));
    return s;
  }, [rows]);

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-7xl">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dealer Activation Engine</h1>
          <p className="text-muted-foreground mt-1">
            Automatic status across 9 gates. A dealer is <span className="font-medium text-emerald-700">ACTIVE</span> only when all 9 pass.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={triggerWatchdog} disabled={loading}>
            <Activity className="h-4 w-4 mr-2" /> Run watchdog now
          </Button>
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh
          </Button>
        </div>
      </header>

      {alerts.length > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" /> {alerts.length} onboarding alert{alerts.length === 1 ? "" : "s"} — watchdog gave up
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-1 text-sm">
            {alerts.slice(0, 5).map((a) => {
              const dealer = rows.find((r) => r.id === a.dealer_id);
              return (
                <div key={a.id} className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">{a.gate}</Badge>
                  <span className="font-medium">{dealer?.name ?? a.dealer_id.slice(0, 8)}</span>
                  <span className="text-muted-foreground">— {a.message}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(["ACTIVE", "IN_PROGRESS", "NOT_STARTED", "ERROR"] as const).map((k) => (
          <Card key={k}>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{k.replace("_", " ")}</div>
              <div className="text-3xl font-bold mt-1">{summary[k]}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4 text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> {error}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Dealers ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading && rows.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Computing activation gates…
            </div>
          ) : (
            <div className="divide-y">
              {rows.map((r) => {
                const isOpen = expanded === r.id;
                const pct = (r.passedCount / r.gates.length) * 100;
                return (
                  <div key={r.id}>
                    <button
                      onClick={() => {
                        const next = isOpen ? null : r.id;
                        setExpanded(next);
                        if (next) loadRunsFor(r.id);
                      }}
                      className="w-full p-4 hover:bg-muted/40 transition text-left"
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold">{r.name}</span>
                            <Badge variant="outline" className={STATUS_STYLES[r.status]}>{r.status}</Badge>
                            <span className="text-xs text-muted-foreground">{r.passedCount}/{r.gates.length} gates</span>
                          </div>
                          <div className="mt-2 flex items-center gap-3">
                            <Progress value={pct} className="h-2 flex-1 max-w-md" />
                            <div className="flex gap-1">
                              {r.gates.map((g) => (
                                <span
                                  key={g.key}
                                  title={`${g.label}: ${g.detail}`}
                                  className={`h-2.5 w-2.5 rounded-sm ${g.passed ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-5 bg-muted/20">
                        <div className="text-xs text-muted-foreground mb-3 font-mono">
                          id: {r.id} · account: {r.account_id ?? "—"} · site: {r.website ?? "—"}
                        </div>
                        <div className="grid md:grid-cols-2 gap-2">
                          {r.gates.map((g) => (
                            <div key={g.key} className={`p-3 rounded-md border ${g.passed ? "border-emerald-500/20 bg-emerald-500/5" : "border-destructive/20 bg-destructive/5"}`}>
                              <div className="flex items-start gap-2">
                                {g.passed ? <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" /> : <XCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />}
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm">{g.label}</div>
                                  <div className="text-xs text-muted-foreground mt-0.5">{g.detail}</div>
                                  {!g.passed && (
                                    <div className="mt-2 text-xs space-y-0.5">
                                      <div><span className="text-muted-foreground">Owner:</span> <span className="font-medium">{g.owner}</span></div>
                                      <div><span className="text-muted-foreground">Fix:</span> {g.remediation}</div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        </div>

                        <div className="mt-5">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-2">
                            <Activity className="h-3.5 w-3.5" /> Pipeline activity (last 20)
                          </div>
                          {!runsByDealer[r.id] ? (
                            <div className="text-xs text-muted-foreground flex items-center gap-2">
                              <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                            </div>
                          ) : runsByDealer[r.id].length === 0 ? (
                            <div className="text-xs text-muted-foreground italic">
                              No worker runs yet — watchdog will dispatch within 15 min.
                            </div>
                          ) : (
                            <div className="space-y-1 text-xs font-mono">
                              {runsByDealer[r.id].map((run) => {
                                const tone =
                                  run.status === "completed" ? "text-emerald-700" :
                                  run.status === "failed"    ? "text-destructive" :
                                                                "text-amber-700";
                                return (
                                  <div key={run.id} className="flex items-center gap-2 flex-wrap">
                                    <span className="text-muted-foreground">{run.started_at.slice(0, 16).replace("T", " ")}</span>
                                    <span className="font-medium">{run.action}</span>
                                    <span className={tone}>{run.status}</span>
                                    {run.attempt_n && run.attempt_n > 1 && (
                                      <span className="text-muted-foreground">· attempt {run.attempt_n}</span>
                                    )}
                                    {run.error && <span className="text-destructive">· {run.error.slice(0, 80)}</span>}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Status is derived in real time from <code>dealer_profiles</code>, <code>vehicle_sales_truth</code>, <code>dealer_fingerprints</code>,
        <code> active_mandates</code>, <code>dealer_intelligence_profiles</code>, <code>worker_runs</code>, and <code>mandate_feed_items</code>.
        No manual flagging — fix the underlying gate and the dealer turns green automatically.
      </p>
    </div>
  );
}
