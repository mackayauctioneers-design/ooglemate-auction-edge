import { useState, useEffect } from "react";
import { OperatorLayout } from "@/components/layout/OperatorLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Link, CheckCircle, XCircle, Clock, Eye, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface QueueItem {
  id: string;
  url_canonical: string;
  domain: string;
  dealer_slug: string;
  intent: string;
  method: string;
  priority: string;
  status: string;
  fail_reason: string | null;
  created_at: string;
  last_run_at: string | null;
  result_summary: unknown;
}

interface SubmissionResult {
  submission_id: string;
  urls_processed: number;
  urls_accepted: number;
  urls_duplicate: number;
  urls_queued_scrape: number;
  urls_queued_firecrawl: number;
  urls_manual_review: number;
}

export default function DealerUrlIntakePage() {
  const [rawText, setRawText] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastResult, setLastResult] = useState<SubmissionResult | null>(null);

  useEffect(() => {
    fetchQueueItems();
    const interval = setInterval(fetchQueueItems, 30000);
    return () => clearInterval(interval);
  }, []);

  async function fetchQueueItems() {
    const { data, error } = await supabase
      .from("dealer_url_queue")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("Error fetching queue:", error);
    } else {
      setQueueItems(data || []);
    }
    setLoading(false);
  }

  async function handleSubmit() {
    if (!rawText.trim()) {
      toast.error("Please paste some URLs");
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("submit-dealer-urls", {
        body: { raw_text: rawText, notes },
      });

      if (error) throw error;

      setLastResult(data);
      toast.success(`Processed ${data.urls_processed} URLs: ${data.urls_accepted} queued, ${data.urls_duplicate} duplicates`);
      setRawText("");
      setNotes("");
      fetchQueueItems();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to submit URLs";
      toast.error(errorMessage);
    } finally {
      setSubmitting(false);
    }
  }

  function getStatusIcon(status: string) {
    switch (status) {
      case "success":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "running":
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case "queued":
        return <Clock className="h-4 w-4 text-yellow-500" />;
      default:
        return <Eye className="h-4 w-4 text-muted-foreground" />;
    }
  }

  function getMethodBadge(method: string) {
    const variants: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
      scrape: "default",
      firecrawl: "secondary",
      manual_review: "destructive",
    };
    return <Badge variant={variants[method] || "outline"}>{method}</Badge>;
  }

  function getIntentBadge(intent: string) {
    const styles: Record<string, string> = {
      inventory_search: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
      inventory_detail: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
      dealer_home: "bg-green-500/10 text-green-700 dark:text-green-300",
      unknown: "bg-muted text-muted-foreground",
    };
    return <span className={`px-2 py-1 rounded text-xs ${styles[intent] || styles.unknown}`}>{intent}</span>;
  }

  const stats = {
    queued: queueItems.filter((q) => q.status === "queued").length,
    running: queueItems.filter((q) => q.status === "running").length,
    success: queueItems.filter((q) => q.status === "success").length,
    failed: queueItems.filter((q) => q.status === "failed").length,
  };

  return (
    <OperatorLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Dealer URL Intake</h1>
            <p className="text-muted-foreground">Submit dealer URLs for automated scraping and discovery</p>
          </div>
          <Button variant="outline" onClick={fetchQueueItems}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Submit Form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link className="h-5 w-5" />
              Submit URLs
            </CardTitle>
            <CardDescription>
              Paste dealer URLs (one per line or mixed with text). The system will extract, classify, and queue them.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="urls">URLs or Raw Text</Label>
              <Textarea
                id="urls"
                placeholder="https://example-dealer.com.au
https://another-dealer.com/used-cars
Or paste a block of text with URLs mixed in..."
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                rows={6}
                className="font-mono text-sm"
              />
            </div>
            <div>
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input id="notes" placeholder="e.g., Toyota dealer network discovery" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <Button onClick={handleSubmit} disabled={submitting || !rawText.trim()}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                "Submit URLs"
              )}
            </Button>

            {lastResult && (
              <div className="p-4 bg-muted rounded-lg text-sm space-y-1">
                <p className="font-medium">Last Submission Result:</p>
                <p>
                  ✓ Accepted: {lastResult.urls_accepted} | ↔ Duplicates: {lastResult.urls_duplicate}
                </p>
                <p>
                  🔧 Scrape: {lastResult.urls_queued_scrape} | 🔥 Firecrawl: {lastResult.urls_queued_firecrawl} | 👁 Manual: {lastResult.urls_manual_review}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.queued}</div>
              <div className="text-sm text-muted-foreground">Queued</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.running}</div>
              <div className="text-sm text-muted-foreground">Running</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.success}</div>
              <div className="text-sm text-muted-foreground">Success</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-destructive">{stats.failed}</div>
              <div className="text-sm text-muted-foreground">Failed</div>
            </CardContent>
          </Card>
        </div>

        {/* Queue Table */}
        <Card>
          <CardHeader>
            <CardTitle>URL Queue</CardTitle>
            <CardDescription>Recent submissions and their processing status</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead>Dealer Slug</TableHead>
                    <TableHead>Intent</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queueItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No URLs in queue yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    queueItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getStatusIcon(item.status)}
                            <span className="text-xs capitalize">{item.status}</span>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-xs truncate font-mono text-xs">
                          <a href={item.url_canonical} target="_blank" rel="noopener noreferrer" className="hover:underline text-primary">
                            {item.url_canonical.replace(/^https?:\/\//, "")}
                          </a>
                        </TableCell>
                        <TableCell className="font-medium">{item.dealer_slug}</TableCell>
                        <TableCell>{getIntentBadge(item.intent)}</TableCell>
                        <TableCell>{getMethodBadge(item.method)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}</TableCell>
                        <TableCell className="max-w-xs truncate text-xs text-destructive">{item.fail_reason || "-"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </OperatorLayout>
  );
}
