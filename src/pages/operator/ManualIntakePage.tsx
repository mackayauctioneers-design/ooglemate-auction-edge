import { useState, useEffect } from "react";
import { OperatorLayout } from "@/components/layout/OperatorLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Loader2, Link2, CheckCircle, XCircle, Clock, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const SOURCES = ["Autograb", "Carsales", "Slattery", "Dealer Website", "Facebook", "Other"] as const;

interface IntakeRow {
  id: string;
  url: string;
  source: string;
  submitted_at: string;
  status: string;
  notes: string | null;
  match_score: number | null;
  opportunity_id: string | null;
}

export default function ManualIntakePage() {
  const { user } = useAuth();
  const [url, setUrl] = useState("");
  const [source, setSource] = useState<string>("Carsales");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [rows, setRows] = useState<IntakeRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRows();
    const interval = setInterval(fetchRows, 15000);
    return () => clearInterval(interval);
  }, []);

  async function fetchRows() {
    const { data, error } = await supabase
      .from("manual_url_intake")
      .select("id, url, source, submitted_at, status, notes, match_score, opportunity_id")
      .order("submitted_at", { ascending: false })
      .limit(200);

    if (!error) setRows(data || []);
    setLoading(false);
  }

  async function handleSubmit() {
    const trimmed = url.trim();
    if (!trimmed) { toast.error("URL is required"); return; }
    if (!user) { toast.error("You must be logged in"); return; }

    try {
      new URL(trimmed);
    } catch {
      toast.error("Enter a valid URL");
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.from("manual_url_intake").insert({
        url: trimmed,
        source,
        submitted_by: user.id,
        notes: notes.trim() || null,
      });

      if (error) {
        if (error.code === "23505") {
          toast.error("This URL has already been submitted");
        } else {
          throw error;
        }
        return;
      }

      toast.success("URL submitted — queued for ingestion & scoring");
      setUrl("");
      setNotes("");
      fetchRows();
    } catch (err: any) {
      toast.error(err.message || "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  function statusBadge(status: string) {
    const map: Record<string, { icon: React.ReactNode; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      new: { icon: <Clock className="h-3 w-3" />, variant: "outline" },
      queued: { icon: <Clock className="h-3 w-3" />, variant: "secondary" },
      ingested: { icon: <CheckCircle className="h-3 w-3" />, variant: "default" },
      duplicate: { icon: <AlertTriangle className="h-3 w-3" />, variant: "outline" },
      failed: { icon: <XCircle className="h-3 w-3" />, variant: "destructive" },
    };
    const s = map[status] || map.new;
    return (
      <Badge variant={s.variant} className="gap-1">
        {s.icon} {status}
      </Badge>
    );
  }

  return (
    <OperatorLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Manual Intake</h1>
          <p className="text-muted-foreground">
            Submit listing URLs for ingestion, normalization, and scoring against fingerprints.
          </p>
        </div>

        <Tabs defaultValue="submit">
          <TabsList>
            <TabsTrigger value="submit">Submit URL</TabsTrigger>
            <TabsTrigger value="history">My Submitted Listings</TabsTrigger>
          </TabsList>

          <TabsContent value="submit">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Link2 className="h-5 w-5" />
                  Submit Listing
                </CardTitle>
                <CardDescription>
                  Paste a listing URL. It will be scraped, normalized, and scored automatically.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 max-w-xl">
                <div>
                  <Label htmlFor="url">URL *</Label>
                  <Input
                    id="url"
                    type="url"
                    placeholder="https://www.carsales.com.au/cars/details/..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>
                <div>
                  <Label htmlFor="source">Source</Label>
                  <Select value={source} onValueChange={setSource}>
                    <SelectTrigger id="source">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SOURCES.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="notes">Notes (optional)</Label>
                  <Textarea
                    id="notes"
                    placeholder="e.g., Found on Autograb, looks like a strong Prado candidate"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                  />
                </div>
                <Button onClick={handleSubmit} disabled={submitting || !url.trim()}>
                  {submitting ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting...</>
                  ) : (
                    "Submit Listing"
                  )}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle>My Submitted Listings</CardTitle>
                <CardDescription>Track ingestion status and match results</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : rows.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No submissions yet</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>URL</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Submitted</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Match Score</TableHead>
                        <TableHead>Opportunity</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="max-w-xs truncate font-mono text-xs">
                            <a href={row.url} target="_blank" rel="noopener noreferrer" className="hover:underline text-primary">
                              {row.url.replace(/^https?:\/\//, "").slice(0, 60)}
                            </a>
                          </TableCell>
                          <TableCell>{row.source}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(row.submitted_at), { addSuffix: true })}
                          </TableCell>
                          <TableCell>{statusBadge(row.status)}</TableCell>
                          <TableCell>
                            {row.match_score != null ? (
                              <span className={row.match_score >= 70 ? "text-green-600 font-bold" : "text-muted-foreground"}>
                                {row.match_score}
                              </span>
                            ) : "-"}
                          </TableCell>
                          <TableCell>
                            {row.opportunity_id ? (
                              <a href={`/operator/trading-desk`} className="text-primary hover:underline text-xs">
                                View →
                              </a>
                            ) : "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </OperatorLayout>
  );
}
