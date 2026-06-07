import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { DealerLayout } from "@/components/layout/DealerLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ChevronDown, ChevronUp, ExternalLink, Loader2, RefreshCw, Tag, Check, X,
} from "lucide-react";
import { toast } from "sonner";

const DEALER_SLUG = "patrick-auto";

interface QueueItem {
  id: string;
  listing_id: string | null;
  dealer_id: string;
  account_id: string | null;
  tier: number | null;
  status: string;
  max_bid: number | null;
  est_gp: number | null;
  est_hold_days: number | null;
  confidence_score: number | null;
  historical_proof: any;
  pattern_flags: any;
  make: string | null;
  model: string | null;
  variant: string | null;
  year: number | null;
  km: number | null;
  asking_price: number | null;
  listing_url: string | null;
  source_searched: string | null;
  auction_close_at: string | null;
  created_at: string;
}

interface FingerprintCtx {
  make: string;
  model: string;
  variant_family: string | null;
  year_min: number | null;
  year_max: number | null;
  min_km: number | null;
  max_km: number | null;
  sales_count: number | null;
  avg_profit: number | null;
  avg_days_to_sell: number | null;
  fingerprint_priority: string | null;
}

const tierMeta: Record<number, { label: string; cls: string }> = {
  1: { label: "T1 · Auto-Approve", cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  2: { label: "T2 · Strong", cls: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
  3: { label: "T3 · Extension", cls: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  4: { label: "T4 · Reject", cls: "bg-red-500/15 text-red-600 border-red-500/30" },
};

const fmtMoney = (n?: number | null) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString()}`;
const fmtNum = (n?: number | null) =>
  n == null ? "—" : Math.round(n).toLocaleString();

function TierBadge({ tier }: { tier: number | null }) {
  if (tier == null) return <Badge variant="outline">—</Badge>;
  const m = tierMeta[tier];
  return (
    <Badge variant="outline" className={m?.cls ?? ""}>
      {m?.label ?? `T${tier}`}
    </Badge>
  );
}

function daysListed(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  const d = Math.floor(ms / 86_400_000);
  return Number.isFinite(d) ? String(d) : "N/A";
}

function ProofGrid({ proof }: { proof: any }) {
  if (!proof || typeof proof !== "object") {
    return <p className="text-xs text-muted-foreground">No historical proof.</p>;
  }
  const pick = (...keys: string[]) => {
    for (const k of keys) if (proof[k] != null) return proof[k];
    return null;
  };
  const fields: Array<[string, any]> = [
    ["Avg GP", pick("avg_gp", "avg_profit") != null ? fmtMoney(pick("avg_gp", "avg_profit")) : null],
    ["Units Sold", pick("units_sold", "sales_count")],
    ["Peak Month", pick("peak_month")],
    ["Retail %", pick("retail_pct") != null ? `${pick("retail_pct")}%` : null],
    ["Median Hold", pick("median_hold", "median_hold_days") != null ? `${pick("median_hold", "median_hold_days")} d` : null],
    ["Velocity", pick("velocity_label", "velocity")],
    ["Margin Trend", pick("margin_trend")],
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {fields.map(([label, val]) => (
        <div key={label} className="rounded bg-muted/40 p-2">
          <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
          <div className="text-xs font-medium">{val ?? "—"}</div>
        </div>
      ))}
    </div>
  );
}

function FingerprintTable({ rows }: { rows: FingerprintCtx[] }) {
  if (!rows?.length) return null;
  return (
    <div className="rounded border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Pattern</TableHead>
            <TableHead>Year Range</TableHead>
            <TableHead>KM Range</TableHead>
            <TableHead>Sample</TableHead>
            <TableHead>Avg GP</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              <TableCell className="text-xs">
                {r.make} {r.model} {r.variant_family ? `· ${r.variant_family}` : ""}
              </TableCell>
              <TableCell className="text-xs">
                {r.year_min ?? "—"}–{r.year_max ?? "—"}
              </TableCell>
              <TableCell className="text-xs">
                {fmtNum(r.min_km)}–{fmtNum(r.max_km)}
              </TableCell>
              <TableCell className="text-xs">{r.sales_count ?? "—"}</TableCell>
              <TableCell className="text-xs">{fmtMoney(r.avg_profit)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function WholesaleQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [fpCtx, setFpCtx] = useState<FingerprintCtx[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("pending");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("wholesale-queue", {
        method: "GET" as any,
        // Pass via query string by appending to functionName isn't supported; use fetch fallback
      });
      // Fallback: use direct fetch since invoke can't send query params reliably
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wholesale-queue?dealer_slug=${DEALER_SLUG}&limit=50&status=${encodeURIComponent(status)}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setItems(json.items ?? []);
      setFpCtx(json.fingerprint_context ?? []);
      void data; void error;
    } catch (e) {
      console.error(e);
      toast.error("Failed to load wholesale queue");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 60s
  useEffect(() => {
    const id = setInterval(fetchData, 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const sources = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => i.source_searched && s.add(i.source_searched));
    return Array.from(s).sort();
  }, [items]);

  const filtered = useMemo(() => {
    if (sourceFilter === "all") return items;
    return items.filter((i) => i.source_searched === sourceFilter);
  }, [items, sourceFilter]);

  const decide = async (id: string, decision: "approved" | "rejected") => {
    setDeciding(id);
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wholesale-decide`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ queue_id: id, decision, dealer_slug: DEALER_SLUG }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setItems((prev) => prev.filter((i) => i.id !== id));
      toast.success(decision === "approved" ? "Approved" : "Rejected");
    } catch (e) {
      console.error(e);
      toast.error("Decision failed");
    } finally {
      setDeciding(null);
    }
  };

  return (
    <DealerLayout>
      <div className="p-4 sm:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
              <Tag className="h-6 w-6 text-primary" />
              Wholesale Queue — Patrick Auto Group
            </h1>
            <p className="text-sm text-muted-foreground">
              {filtered.length} {status} item{filtered.length === 1 ? "" : "s"}
              {sourceFilter !== "all" ? ` · ${sourceFilter}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {sources.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
            No items in this view.
          </CardContent></Card>
        ) : (
          <div className="rounded-lg border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead className="hidden md:table-cell">KM</TableHead>
                  <TableHead className="hidden md:table-cell">Listed</TableHead>
                  <TableHead>Max Bid</TableHead>
                  <TableHead className="hidden sm:table-cell">Est GP</TableHead>
                  <TableHead className="hidden lg:table-cell">Score</TableHead>
                  <TableHead className="hidden lg:table-cell">Days</TableHead>
                  <TableHead className="hidden md:table-cell">Source</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((it) => {
                  const open = expanded === it.id;
                  return (
                    <>
                      <TableRow key={it.id}>
                        <TableCell>
                          <button
                            onClick={() => setExpanded(open ? null : it.id)}
                            className="text-muted-foreground"
                            aria-label="Toggle details"
                          >
                            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </button>
                        </TableCell>
                        <TableCell><TierBadge tier={it.tier} /></TableCell>
                        <TableCell>
                          <div className="font-medium text-sm">
                            {it.year ?? ""} {it.make ?? ""} {it.model ?? ""}
                          </div>
                          {it.variant && (
                            <div className="text-[11px] text-muted-foreground">{it.variant}</div>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm">{fmtNum(it.km)}</TableCell>
                        <TableCell className="hidden md:table-cell text-sm">{fmtMoney(it.asking_price)}</TableCell>
                        <TableCell className="text-sm font-medium">{fmtMoney(it.max_bid)}</TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-emerald-600 font-medium">{fmtMoney(it.est_gp)}</TableCell>
                        <TableCell className="hidden lg:table-cell text-sm">
                          {it.confidence_score != null ? it.confidence_score.toFixed(1) : "—"}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-sm">{daysListed(it.created_at)}</TableCell>
                        <TableCell className="hidden md:table-cell">
                          {it.source_searched && (
                            <Badge variant="outline" className="text-[10px]">{it.source_searched}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="default"
                              disabled={deciding === it.id}
                              onClick={() => decide(it.id, "approved")}
                            >
                              {deciding === it.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={deciding === it.id}
                              onClick={() => decide(it.id, "rejected")}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {open && (
                        <TableRow key={`${it.id}-detail`}>
                          <TableCell colSpan={11} className="bg-muted/20">
                            <div className="space-y-3 p-2">
                              <div>
                                <div className="text-xs font-semibold mb-1">Historical Proof</div>
                                <ProofGrid proof={it.historical_proof} />
                              </div>
                              {fpCtx.length > 0 && (
                                <div>
                                  <div className="text-xs font-semibold mb-1">Dealer Fingerprint Context</div>
                                  <FingerprintTable rows={fpCtx} />
                                </div>
                              )}
                              {it.listing_url && (
                                <a href={it.listing_url} target="_blank" rel="noopener noreferrer">
                                  <Button variant="outline" size="sm">
                                    <ExternalLink className="h-3 w-3 mr-1" /> View Listing
                                  </Button>
                                </a>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </DealerLayout>
  );
}
