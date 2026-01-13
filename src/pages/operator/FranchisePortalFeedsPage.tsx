import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, Play, Car, Building2, ArrowRight, CheckCircle2, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { OperatorLayout } from "@/components/layout/OperatorLayout";
import { useEffect } from "react";
interface IngestionRun {
  id: string;
  source: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  lots_found: number | null;
  lots_created: number | null;
  lots_updated: number | null;
  metadata: any;
}

interface DealerCandidate {
  id: string;
  brand: string;
  dealer_name: string;
  dealer_location: string | null;
  dealer_url: string | null;
  status: string;
  listing_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

export default function FranchisePortalFeedsPage() {
  useEffect(() => { document.title = "Franchise Portal Feeds | OogleMate"; }, []);
  const queryClient = useQueryClient();
  const [isRunning, setIsRunning] = useState(false);

  // Fetch recent Toyota portal runs
  const { data: recentRuns, isLoading: runsLoading } = useQuery({
    queryKey: ["toyota-portal-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ingestion_runs")
        .select("*")
        .ilike("source", "toyota%")
        .order("started_at", { ascending: false })
        .limit(20);
      
      if (error) throw error;
      return data as IngestionRun[];
    },
  });

  // Fetch dealer candidates
  const { data: candidates, isLoading: candidatesLoading } = useQuery({
    queryKey: ["franchise-dealer-candidates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("franchise_dealer_candidates")
        .select("*")
        .eq("brand", "TOYOTA")
        .order("last_seen_at", { ascending: false })
        .limit(50);
      
      if (error) throw error;
      return data as DealerCandidate[];
    },
  });

  // Run crawl mutation
  const runCrawl = useMutation({
    mutationFn: async () => {
      setIsRunning(true);
      const { data, error } = await supabase.functions.invoke("toyota-used-portal-crawl", {
        body: { state: "NSW", maxPages: 3 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Crawl complete: ${data.listings_found} listings, ${data.dealers_found} dealers`);
      queryClient.invalidateQueries({ queryKey: ["toyota-portal-runs"] });
      queryClient.invalidateQueries({ queryKey: ["franchise-dealer-candidates"] });
    },
    onError: (error: any) => {
      toast.error(`Crawl failed: ${error.message}`);
    },
    onSettled: () => {
      setIsRunning(false);
    },
  });

  // Run mapper mutation
  const runMapper = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("toyota-dealer-trap-mapper", {
        body: { brand: "TOYOTA", limit: 20 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Mapper complete: ${data.mapped} mapped, ${data.skipped} skipped, ${data.failed} failed`);
      queryClient.invalidateQueries({ queryKey: ["franchise-dealer-candidates"] });
    },
    onError: (error: any) => {
      toast.error(`Mapper failed: ${error.message}`);
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge variant="default" className="bg-green-500"><CheckCircle2 className="w-3 h-3 mr-1" />Complete</Badge>;
      case "completed_with_errors":
        return <Badge variant="secondary" className="bg-yellow-500"><XCircle className="w-3 h-3 mr-1" />With Errors</Badge>;
      case "running":
        return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" />Running</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getCandidateStatusBadge = (status: string) => {
    switch (status) {
      case "candidate":
        return <Badge variant="outline">Pending</Badge>;
      case "mapped":
        return <Badge variant="default" className="bg-green-500">Mapped</Badge>;
      case "ignored":
        return <Badge variant="secondary">Ignored</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // Stats
  const todayRuns = recentRuns?.filter(r => 
    new Date(r.started_at).toDateString() === new Date().toDateString()
  ) || [];
  const totalListingsToday = todayRuns.reduce((sum, r) => sum + (r.lots_found || 0), 0);
  const candidatePending = candidates?.filter(c => c.status === "candidate").length || 0;
  const candidateMapped = candidates?.filter(c => c.status === "mapped").length || 0;

  return (
    <OperatorLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Franchise Portal Feeds</h1>
            <p className="text-muted-foreground">Toyota Used Portal ingestion and dealer discovery</p>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={() => runMapper.mutate()}
              disabled={runMapper.isPending}
            >
              <Building2 className="w-4 h-4 mr-2" />
              Run Mapper
            </Button>
            <Button 
              onClick={() => runCrawl.mutate()} 
              disabled={isRunning || runCrawl.isPending}
            >
              {isRunning ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              Run Toyota Crawl
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Today's Runs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{todayRuns.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Listings Found Today</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalListingsToday}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Pending Dealers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{candidatePending}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Mapped to Traps</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{candidateMapped}</div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="runs">
          <TabsList>
            <TabsTrigger value="runs">
              <Car className="w-4 h-4 mr-2" />
              Ingestion Runs
            </TabsTrigger>
            <TabsTrigger value="candidates">
              <Building2 className="w-4 h-4 mr-2" />
              Dealer Candidates ({candidates?.length || 0})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="runs" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Recent Toyota Portal Runs</CardTitle>
                <CardDescription>Ingestion history from Toyota Used Vehicle Portal</CardDescription>
              </CardHeader>
              <CardContent>
                {runsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="w-6 h-6 animate-spin" />
                  </div>
                ) : !recentRuns?.length ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No runs yet. Click "Run Toyota Crawl" to start.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Started</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Found</TableHead>
                        <TableHead className="text-right">Created</TableHead>
                        <TableHead className="text-right">Updated</TableHead>
                        <TableHead className="text-right">Dealers</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentRuns.map((run) => (
                        <TableRow key={run.id}>
                          <TableCell>
                            {format(new Date(run.started_at), "MMM d, HH:mm")}
                          </TableCell>
                          <TableCell>{getStatusBadge(run.status)}</TableCell>
                          <TableCell className="text-right">{run.lots_found ?? "-"}</TableCell>
                          <TableCell className="text-right">{run.lots_created ?? "-"}</TableCell>
                          <TableCell className="text-right">{run.lots_updated ?? "-"}</TableCell>
                          <TableCell className="text-right">
                            {run.metadata?.dealer_candidates_upserted ?? run.metadata?.dealer_count ?? "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="candidates" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Toyota Dealer Candidates</CardTitle>
                <CardDescription>Dealers discovered from Toyota portal listings</CardDescription>
              </CardHeader>
              <CardContent>
                {candidatesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="w-6 h-6 animate-spin" />
                  </div>
                ) : !candidates?.length ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No dealer candidates yet. Run a crawl to discover dealers.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Dealer Name</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Listings</TableHead>
                        <TableHead>Last Seen</TableHead>
                        <TableHead>URL</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {candidates.map((candidate) => (
                        <TableRow key={candidate.id}>
                          <TableCell className="font-medium">{candidate.dealer_name}</TableCell>
                          <TableCell>{candidate.dealer_location || "-"}</TableCell>
                          <TableCell>{getCandidateStatusBadge(candidate.status)}</TableCell>
                          <TableCell className="text-right">{candidate.listing_count}</TableCell>
                          <TableCell>
                            {format(new Date(candidate.last_seen_at), "MMM d")}
                          </TableCell>
                          <TableCell>
                            {candidate.dealer_url ? (
                              <a 
                                href={candidate.dealer_url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-primary hover:underline flex items-center gap-1"
                              >
                                View <ArrowRight className="w-3 h-3" />
                              </a>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
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
