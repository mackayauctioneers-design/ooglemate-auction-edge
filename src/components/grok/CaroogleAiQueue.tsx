import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ExternalLink, MapPin, Car, RefreshCw, Sparkles, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface QueueCandidate {
  id: string;
  detail_url: string;
  year: number | null;
  make: string | null;
  model: string | null;
  variant_raw: string | null;
  km: number | null;
  asking_price: number | null;
  location: string | null;
  crawl_status: string;
  first_seen_at: string;
  search_url: string | null;
}

export function CaroogleAiQueue() {
  const [candidates, setCandidates] = useState<QueueCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    fetchCandidates();
  }, []);

  async function fetchCandidates() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("pickles_detail_queue")
        .select("id, detail_url, year, make, model, variant_raw, km, asking_price, location, crawl_status, first_seen_at, search_url")
        .eq("source", "grok_search")
        .order("first_seen_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      setCandidates(data || []);
    } catch (e) {
      console.error("Failed to fetch CaroogleAi queue:", e);
      toast.error("Failed to load AI candidates");
    } finally {
      setLoading(false);
    }
  }

  async function markAsReviewed(id: string) {
    setActionLoading(id);
    try {
      const { error } = await supabase
        .from("pickles_detail_queue")
        .update({ crawl_status: "completed" })
        .eq("id", id);

      if (error) throw error;
      toast.success("Marked as reviewed");
      fetchCandidates();
    } catch (e) {
      console.error("Failed to update status:", e);
      toast.error("Failed to update");
    } finally {
      setActionLoading(null);
    }
  }

  async function dismissCandidate(id: string) {
    setActionLoading(id);
    try {
      const { error } = await supabase
        .from("pickles_detail_queue")
        .update({ crawl_status: "failed" })
        .eq("id", id);

      if (error) throw error;
      toast.success("Candidate dismissed");
      fetchCandidates();
    } catch (e) {
      console.error("Failed to dismiss:", e);
      toast.error("Failed to dismiss");
    } finally {
      setActionLoading(null);
    }
  }

  const pendingCount = candidates.filter(c => c.crawl_status === "pending").length;

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">Loading AI candidates...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (candidates.length === 0) {
    return null; // Don't show section if no candidates
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">CaroogleAi Queue</h2>
          {pendingCount > 0 && (
            <Badge variant="secondary">{pendingCount} pending review</Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={fetchCandidates} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {candidates.filter(c => c.crawl_status === "pending").map((candidate) => (
          <Card key={candidate.id} className="hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Car className="h-5 w-5 text-muted-foreground shrink-0" />
                  <CardTitle className="text-base leading-tight truncate">
                    {candidate.year} {candidate.make} {candidate.model}
                    {candidate.variant_raw && ` ${candidate.variant_raw}`}
                  </CardTitle>
                </div>
                <Badge variant="outline" className="shrink-0">
                  {candidate.crawl_status}
                </Badge>
              </div>
              {candidate.search_url && (
                <CardDescription className="text-xs truncate">
                  Mission: {candidate.search_url}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Key Stats */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                {candidate.km && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">KM:</span>
                    <span className="font-medium">{candidate.km.toLocaleString()}</span>
                  </div>
                )}
                {candidate.asking_price && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">Price:</span>
                    <span className="font-medium">${candidate.asking_price.toLocaleString()}</span>
                  </div>
                )}
              </div>

              {/* Location */}
              {candidate.location && (
                <div className="flex items-center gap-1.5 text-sm">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="truncate">{candidate.location}</span>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-1"
                  asChild
                >
                  <a href={candidate.detail_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5" />
                    View
                  </a>
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className="gap-1"
                  onClick={() => markAsReviewed(candidate.id)}
                  disabled={actionLoading === candidate.id}
                >
                  {actionLoading === candidate.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-muted-foreground hover:text-destructive"
                  onClick={() => dismissCandidate(candidate.id)}
                  disabled={actionLoading === candidate.id}
                >
                  <XCircle className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Show completed/dismissed count */}
      {candidates.filter(c => c.crawl_status !== "pending").length > 0 && (
        <p className="text-sm text-muted-foreground text-center">
          {candidates.filter(c => c.crawl_status === "completed").length} reviewed, {" "}
          {candidates.filter(c => c.crawl_status === "failed").length} dismissed
        </p>
      )}
    </div>
  );
}
