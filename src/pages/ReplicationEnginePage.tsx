import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { AccountSelector } from "@/components/carbitrage/AccountSelector";
import { Loader2, Search, ExternalLink, TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface Fingerprint {
  id: string;
  make: string;
  model: string;
  variant: string | null;
  median_km: number | null;
  median_sale_price: number | null;
  median_profit: number | null;
  target_score: number;
  sales_count: number;
  fingerprint_type: string;
  confidence_level: string;
}

interface Candidate {
  candidate_id: string;
  fingerprint_id: string;
  source: string;
  candidate_year: number | null;
  candidate_make: string | null;
  candidate_model: string | null;
  candidate_variant: string | null;
  candidate_kms: number | null;
  candidate_price: number | null;
  location: string | null;
  seller: string | null;
  url: string | null;
  match_score: number;
  upgrade_flag: boolean;
  downgrade_flag: boolean;
  score_reasons: Record<string, string>;
  scraped_at: string;
}

export default function ReplicationEnginePage() {
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [fingerprints, setFingerprints] = useState<Fingerprint[]>([]);
  const [candidates, setCandidates] = useState<Record<string, Candidate[]>>({});
  const [loading, setLoading] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);

  useEffect(() => {
    document.title = "Replication Engine | Carbitrage";
  }, []);

  useEffect(() => {
    if (selectedAccountId) loadData();
  }, [selectedAccountId]);

  async function loadData() {
    if (!selectedAccountId) return;
    setLoading(true);

    const { data: fps } = await supabase
      .from("sales_target_candidates")
      .select("id, make, model, variant, median_km, median_sale_price, median_profit, target_score, sales_count, fingerprint_type, confidence_level")
      .eq("account_id", selectedAccountId)
      .in("status", ["active", "candidate"])
      .order("target_score", { ascending: false });

    setFingerprints(fps || []);

    // Load candidates via the view
    const { data: cands } = await (supabase
      .from("fingerprint_opportunities" as any)
      .select("*") as any);

    const grouped: Record<string, Candidate[]> = {};
    for (const c of (cands || []) as any[]) {
      if (!grouped[c.fingerprint_id]) grouped[c.fingerprint_id] = [];
      grouped[c.fingerprint_id].push(c);
    }
    setCandidates(grouped);
    setLoading(false);
  }

  async function runSearch(fingerprintId?: string) {
    if (!selectedAccountId) return;
    const isAll = !fingerprintId;
    if (isAll) setRunningAll(true);
    else setRunningId(fingerprintId!);

    try {
      toast.info("Generating search URLs...");
      const { error: genErr } = await supabase.functions.invoke("generate-search-urls", {
        body: { account_id: selectedAccountId, fingerprint_id: fingerprintId },
      });
      if (genErr) throw genErr;

      toast.info("Scraping live listings...");
      const { data, error: scrapeErr } = await supabase.functions.invoke("run-firecrawl-fingerprint", {
        body: { account_id: selectedAccountId, fingerprint_id: fingerprintId },
      });
      if (scrapeErr) throw scrapeErr;

      toast.success(`Found ${data?.candidates_stored || 0} candidates`);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Search failed");
    } finally {
      setRunningId(null);
      setRunningAll(false);
    }
  }

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Replication Engine</h1>
            <p className="text-muted-foreground text-sm">
              Find live supply that matches your proven sales fingerprints
            </p>
          </div>
          <div className="flex items-center gap-3">
            <AccountSelector
              value={selectedAccountId}
              onChange={setSelectedAccountId}
            />
            <Button
              onClick={() => runSearch()}
              disabled={runningAll || fingerprints.length === 0 || !selectedAccountId}
              variant="default"
            >
              {runningAll ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Running All...</>
              ) : (
                <><RefreshCw className="h-4 w-4 mr-2" /> Run All Searches</>
              )}
            </Button>
          </div>
        </div>

        {!selectedAccountId && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Select an account to view fingerprints.
            </CardContent>
          </Card>
        )}

        {selectedAccountId && loading && (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {selectedAccountId && !loading && fingerprints.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No active fingerprints. Upload sales data first to build target candidates.
            </CardContent>
          </Card>
        )}

        {fingerprints.map((fp) => {
          const fpCandidates = candidates[fp.id] || [];
          const targetBuy = fp.median_sale_price && fp.median_profit
            ? fp.median_sale_price - fp.median_profit
            : null;

          return (
            <Card key={fp.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-lg">
                      {fp.make} {fp.model} {fp.variant || ""}
                    </CardTitle>
                    <Badge variant={fp.fingerprint_type === "core" ? "default" : "secondary"}>
                      {fp.fingerprint_type === "core" ? "Repeatable" : "Outcome"}
                    </Badge>
                    <Badge variant="outline">{fp.sales_count} sales</Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => runSearch(fp.id)}
                    disabled={runningId === fp.id || runningAll}
                  >
                    {runningId === fp.id ? (
                      <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Searching...</>
                    ) : (
                      <><Search className="h-3 w-3 mr-1" /> Run Search</>
                    )}
                  </Button>
                </div>
                <div className="flex gap-4 text-sm text-muted-foreground mt-1">
                  {fp.median_km && <span>Median KM: {fp.median_km.toLocaleString()}</span>}
                  {fp.median_sale_price && <span>Sold: ${fp.median_sale_price.toLocaleString()}</span>}
                  {fp.median_profit != null && <span>Profit: ${fp.median_profit.toLocaleString()}</span>}
                  {targetBuy && <span className="font-medium text-primary">Target Buy: ${targetBuy.toLocaleString()}</span>}
                </div>
              </CardHeader>

              <CardContent>
                {fpCandidates.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No candidates yet. Click "Run Search" to find live supply.
                  </p>
                ) : (
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Score</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Year</TableHead>
                          <TableHead>Variant</TableHead>
                          <TableHead>KMs</TableHead>
                          <TableHead>Price</TableHead>
                          <TableHead>Location</TableHead>
                          <TableHead>Source</TableHead>
                          <TableHead>Link</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {fpCandidates.map((c) => (
                          <TableRow key={c.candidate_id}>
                            <TableCell>
                              <Badge variant={c.match_score >= 8 ? "default" : c.match_score >= 6 ? "secondary" : "outline"}>
                                {c.match_score}/10
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {c.upgrade_flag && (
                                <span className="flex items-center gap-1 text-xs font-medium text-primary">
                                  <TrendingUp className="h-3 w-3" /> Upgrade
                                </span>
                              )}
                              {c.downgrade_flag && (
                                <span className="flex items-center gap-1 text-xs font-medium text-destructive">
                                  <TrendingDown className="h-3 w-3" /> Downgrade
                                </span>
                              )}
                              {!c.upgrade_flag && !c.downgrade_flag && (
                                <span className="text-xs text-muted-foreground">Exact</span>
                              )}
                            </TableCell>
                            <TableCell>{c.candidate_year || "—"}</TableCell>
                            <TableCell>{c.candidate_variant || "—"}</TableCell>
                            <TableCell>{c.candidate_kms?.toLocaleString() || "—"}</TableCell>
                            <TableCell>
                              {c.candidate_price ? `$${c.candidate_price.toLocaleString()}` : "—"}
                            </TableCell>
                            <TableCell className="text-xs">{c.location || "—"}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">{c.source}</Badge>
                            </TableCell>
                            <TableCell>
                              {c.url && (
                                <a href={c.url} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="h-4 w-4 text-primary hover:text-primary/80" />
                                </a>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </AppLayout>
  );
}
