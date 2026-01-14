import { useState, useEffect } from "react";
import { OperatorLayout } from "@/components/layout/OperatorLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Eye, AlertTriangle, CheckCircle2, XCircle, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface TriggerQARecord {
  evaluation_id: string;
  evaluated_at: string;
  source: string;
  year: number | null;
  make: string | null;
  model: string | null;
  variant_family: string | null;
  km: number | null;
  asking_price: number | null;
  proven_exit_value: number | null;
  gap_dollars: number | null;
  gap_pct: number | null;
  sample_size: number | null;
  sale_recency_days: number | null;
  confidence_label: string | null;
  result: string;
  reasons: string[] | null;
  gate_failures: string[] | null;
  first_seen_at: string | null;
  listing_age_days: number | null;
  listing_url: string | null;
  listing_id: string | null;
  snapshot: Record<string, unknown> | null;
}

const TriggerQAPage = () => {
  const [records, setRecords] = useState<TriggerQARecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [resultFilter, setResultFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [confidenceFilter, setConfidenceFilter] = useState<string>("all");
  const [missingKmFilter, setMissingKmFilter] = useState<boolean>(false);
  const [selectedRecord, setSelectedRecord] = useState<TriggerQARecord | null>(null);

  useEffect(() => {
    loadRecords();
  }, []);

  const loadRecords = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("trigger_qa_recent")
      .select("*")
      .limit(500);

    if (error) {
      console.error("Error loading QA records:", error);
    } else {
      setRecords((data || []) as TriggerQARecord[]);
    }
    setLoading(false);
  };

  const filteredRecords = records.filter((r) => {
    if (resultFilter !== "all" && r.result !== resultFilter) return false;
    if (sourceFilter !== "all" && r.source !== sourceFilter) return false;
    if (confidenceFilter !== "all" && r.confidence_label !== confidenceFilter) return false;
    if (missingKmFilter && r.km !== null) return false;
    return true;
  });

  const sources = [...new Set(records.map((r) => r.source).filter(Boolean))];

  const stats = {
    total: records.length,
    buy: records.filter((r) => r.result === "BUY").length,
    watch: records.filter((r) => r.result === "WATCH").length,
    ignore: records.filter((r) => r.result === "IGNORE").length,
    missingKm: records.filter((r) => r.km === null).length,
  };

  const getResultBadge = (result: string) => {
    switch (result) {
      case "BUY":
        return <Badge className="bg-green-600 text-white"><CheckCircle2 className="h-3 w-3 mr-1" />BUY</Badge>;
      case "WATCH":
        return <Badge className="bg-yellow-600 text-white"><Clock className="h-3 w-3 mr-1" />WATCH</Badge>;
      case "IGNORE":
        return <Badge variant="secondary"><XCircle className="h-3 w-3 mr-1" />IGNORE</Badge>;
      default:
        return <Badge variant="outline">{result}</Badge>;
    }
  };

  const getConfidenceBadge = (confidence: string | null) => {
    if (!confidence) return null;
    switch (confidence) {
      case "high":
        return <Badge className="bg-green-100 text-green-800">HIGH</Badge>;
      case "medium":
        return <Badge className="bg-yellow-100 text-yellow-800">MED</Badge>;
      case "low":
        return <Badge className="bg-red-100 text-red-800">LOW</Badge>;
      default:
        return <Badge variant="outline">{confidence}</Badge>;
    }
  };

  const formatCurrency = (value: number | null) => {
    if (value === null) return "-";
    return `$${value.toLocaleString()}`;
  };

  const formatKm = (km: number | null) => {
    if (km === null) return <span className="text-destructive font-medium">MISSING</span>;
    return `${(km / 1000).toFixed(0)}k`;
  };

  return (
    <OperatorLayout>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Trigger QA Dashboard</h1>
            <p className="text-muted-foreground">Last 500 evaluations • Tune thresholds using evidence</p>
          </div>
          <Button onClick={loadRecords} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Refresh
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{stats.total}</div>
              <p className="text-sm text-muted-foreground">Total Evals</p>
            </CardContent>
          </Card>
          <Card className="border-green-200 bg-green-50 dark:bg-green-950/20">
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-green-700">{stats.buy}</div>
              <p className="text-sm text-green-600">BUY</p>
            </CardContent>
          </Card>
          <Card className="border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20">
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-yellow-700">{stats.watch}</div>
              <p className="text-sm text-yellow-600">WATCH</p>
            </CardContent>
          </Card>
          <Card className="border-muted">
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-muted-foreground">{stats.ignore}</div>
              <p className="text-sm text-muted-foreground">IGNORE</p>
            </CardContent>
          </Card>
          <Card className="border-red-200 bg-red-50 dark:bg-red-950/20">
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-red-700">{stats.missingKm}</div>
              <p className="text-sm text-red-600">Missing KM</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 flex-wrap">
              <Select value={resultFilter} onValueChange={setResultFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Result" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Results</SelectItem>
                  <SelectItem value="BUY">BUY</SelectItem>
                  <SelectItem value="WATCH">WATCH</SelectItem>
                  <SelectItem value="IGNORE">IGNORE</SelectItem>
                </SelectContent>
              </Select>

              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  {sources.map((s) => (
                    <SelectItem key={s} value={s || "unknown"}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={confidenceFilter} onValueChange={setConfidenceFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Confidence" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Confidence</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant={missingKmFilter ? "default" : "outline"}
                onClick={() => setMissingKmFilter(!missingKmFilter)}
                className="gap-2"
              >
                <AlertTriangle className="h-4 w-4" />
                Missing KM Only
              </Button>

              <div className="ml-auto text-sm text-muted-foreground">
                Showing {filteredRecords.length} of {records.length}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results Table */}
        <Card>
          <CardContent className="p-0">
            <ScrollArea className="h-[600px]">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="w-28">Result</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead className="text-right">Ask</TableHead>
                    <TableHead className="text-right">Exit</TableHead>
                    <TableHead className="text-right">Gap</TableHead>
                    <TableHead>KM</TableHead>
                    <TableHead>Age</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Reasons</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                      </TableCell>
                    </TableRow>
                  ) : filteredRecords.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                        No evaluations found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRecords.map((record) => (
                      <TableRow key={record.evaluation_id} className="hover:bg-muted/50">
                        <TableCell>{getResultBadge(record.result)}</TableCell>
                        <TableCell>
                          <div className="space-y-0.5">
                            <div className="font-medium">
                              {record.year} {record.make} {record.model}
                            </div>
                            <div className="text-xs text-muted-foreground flex items-center gap-2">
                              <span className="capitalize">{record.source}</span>
                              {record.evaluated_at && (
                                <span>• {formatDistanceToNow(new Date(record.evaluated_at), { addSuffix: true })}</span>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(record.asking_price)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(record.proven_exit_value)}
                        </TableCell>
                        <TableCell className="text-right">
                          {record.gap_dollars !== null && record.gap_pct !== null ? (
                            <div>
                              <div className={`font-mono ${record.gap_dollars > 0 ? "text-green-600" : "text-red-600"}`}>
                                {record.gap_dollars > 0 ? "+" : ""}{formatCurrency(record.gap_dollars)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {record.gap_pct > 0 ? "+" : ""}{record.gap_pct?.toFixed(1)}%
                              </div>
                            </div>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell>{formatKm(record.km)}</TableCell>
                        <TableCell>
                          {record.listing_age_days !== null ? (
                            <span className={record.listing_age_days > 7 ? "text-yellow-600" : ""}>
                              {record.listing_age_days}d
                            </span>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell>{getConfidenceBadge(record.confidence_label)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {record.gate_failures?.map((f) => (
                              <Badge key={f} variant="destructive" className="text-xs">{f}</Badge>
                            ))}
                            {record.reasons?.slice(0, 2).map((r) => (
                              <Badge key={r} variant="outline" className="text-xs">{r}</Badge>
                            ))}
                            {(record.reasons?.length || 0) > 2 && (
                              <Badge variant="outline" className="text-xs">+{(record.reasons?.length || 0) - 2}</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSelectedRecord(record)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Detail Sheet */}
        <Sheet open={!!selectedRecord} onOpenChange={() => setSelectedRecord(null)}>
          <SheetContent className="w-[600px] sm:max-w-[600px]">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                Evaluation Details
                {selectedRecord && getResultBadge(selectedRecord.result)}
              </SheetTitle>
            </SheetHeader>
            {selectedRecord && (
              <ScrollArea className="h-[calc(100vh-100px)] mt-4">
                <div className="space-y-6 pr-4">
                  {/* Vehicle Summary */}
                  <div>
                    <h3 className="font-semibold mb-2">Vehicle</h3>
                    <div className="bg-muted rounded-lg p-4 space-y-2">
                      <div className="text-lg font-medium">
                        {selectedRecord.year} {selectedRecord.make} {selectedRecord.model}
                      </div>
                      {selectedRecord.variant_family && (
                        <div className="text-sm text-muted-foreground">{selectedRecord.variant_family}</div>
                      )}
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">KM:</span>{" "}
                          {selectedRecord.km ? `${selectedRecord.km.toLocaleString()} km` : "MISSING"}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Source:</span>{" "}
                          <span className="capitalize">{selectedRecord.source}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Age:</span>{" "}
                          {selectedRecord.listing_age_days} days
                        </div>
                        <div>
                          <span className="text-muted-foreground">First Seen:</span>{" "}
                          {selectedRecord.first_seen_at ? new Date(selectedRecord.first_seen_at).toLocaleDateString() : "-"}
                        </div>
                      </div>
                      {selectedRecord.listing_url && (
                        <a
                          href={selectedRecord.listing_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary hover:underline"
                        >
                          View Listing →
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Pricing */}
                  <div>
                    <h3 className="font-semibold mb-2">Pricing Analysis</h3>
                    <div className="bg-muted rounded-lg p-4 space-y-3">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-sm text-muted-foreground">Asking Price</div>
                          <div className="text-xl font-mono">{formatCurrency(selectedRecord.asking_price)}</div>
                        </div>
                        <div>
                          <div className="text-sm text-muted-foreground">Proven Exit</div>
                          <div className="text-xl font-mono">{formatCurrency(selectedRecord.proven_exit_value)}</div>
                        </div>
                      </div>
                      <div className="border-t pt-3">
                        <div className="text-sm text-muted-foreground">Gap</div>
                        <div className={`text-xl font-mono ${(selectedRecord.gap_dollars || 0) > 0 ? "text-green-600" : "text-red-600"}`}>
                          {formatCurrency(selectedRecord.gap_dollars)} ({selectedRecord.gap_pct?.toFixed(2)}%)
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Evidence */}
                  <div>
                    <h3 className="font-semibold mb-2">Evidence Quality</h3>
                    <div className="bg-muted rounded-lg p-4 grid grid-cols-3 gap-4">
                      <div>
                        <div className="text-sm text-muted-foreground">Sample Size</div>
                        <div className="text-lg font-medium">{selectedRecord.sample_size || "-"}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Recency</div>
                        <div className="text-lg font-medium">
                          {selectedRecord.sale_recency_days ? `${selectedRecord.sale_recency_days}d` : "-"}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Confidence</div>
                        <div>{getConfidenceBadge(selectedRecord.confidence_label) || "-"}</div>
                      </div>
                    </div>
                  </div>

                  {/* Reasons & Gate Failures */}
                  <div>
                    <h3 className="font-semibold mb-2">Decision Factors</h3>
                    <div className="space-y-2">
                      {selectedRecord.gate_failures && selectedRecord.gate_failures.length > 0 && (
                        <div>
                          <div className="text-sm text-muted-foreground mb-1">Gate Failures</div>
                          <div className="flex flex-wrap gap-1">
                            {selectedRecord.gate_failures.map((f) => (
                              <Badge key={f} variant="destructive">{f}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {selectedRecord.reasons && selectedRecord.reasons.length > 0 && (
                        <div>
                          <div className="text-sm text-muted-foreground mb-1">Reasons</div>
                          <div className="flex flex-wrap gap-1">
                            {selectedRecord.reasons.map((r) => (
                              <Badge key={r} variant="outline">{r}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Raw Snapshot */}
                  <div>
                    <h3 className="font-semibold mb-2">Raw Snapshot</h3>
                    <pre className="bg-muted rounded-lg p-4 text-xs overflow-x-auto max-h-96">
                      {JSON.stringify(selectedRecord.snapshot, null, 2)}
                    </pre>
                  </div>
                </div>
              </ScrollArea>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </OperatorLayout>
  );
};

export default TriggerQAPage;
