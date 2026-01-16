import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { AlertCircle, Clock, ExternalLink, Info, Trophy } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { HuntHeader } from "@/components/hunts/HuntHeader";
import { HuntKPICards } from "@/components/hunts/HuntKPICards";
import { HuntAlertCardEnhanced } from "@/components/hunts/HuntAlertCardEnhanced";
import { ProofOfHuntModal } from "@/components/hunts/ProofOfHuntModal";
import type { 
  SaleHunt, 
  HuntMatch, 
  HuntScan, 
  HuntAlert,
  HuntStatus,
  MatchDecision
} from "@/types/hunts";

// Reusable Match Table component
function MatchTable({ 
  matches, 
  getDecisionColor, 
  getLaneColor 
}: { 
  matches: (HuntMatch & { listing_url?: string | null; source?: string | null })[]; 
  getDecisionColor: (decision: MatchDecision) => string;
  getLaneColor: (lane: string | null) => string;
}) {
  return (
    <div className="rounded-lg border overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="p-3 text-left font-medium">Lane</th>
            <th className="p-3 text-left font-medium">Score</th>
            <th className="p-3 text-left font-medium">Priority</th>
            <th className="p-3 text-left font-medium">Price</th>
            <th className="p-3 text-left font-medium">Gap</th>
            <th className="p-3 text-left font-medium">Matched</th>
            <th className="p-3 text-left font-medium">Reasons</th>
            <th className="p-3 text-left font-medium">Link</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((match) => (
            <tr key={match.id} className="border-t hover:bg-muted/30">
              <td className="p-3">
                <Badge variant="outline" className={getLaneColor(match.lane)}>
                  {match.lane || '—'}
                </Badge>
              </td>
              <td className="p-3 font-medium">{match.match_score.toFixed(1)}</td>
              <td className="p-3 text-muted-foreground text-xs">
                {match.priority_score?.toFixed(0) || '—'}
              </td>
              <td className="p-3">
                ${match.asking_price?.toLocaleString() || '?'}
              </td>
              <td className="p-3">
                {match.gap_dollars !== null ? (
                  <span className={match.gap_dollars > 0 ? 'text-emerald-600' : 'text-destructive'}>
                    ${match.gap_dollars?.toLocaleString()} ({match.gap_pct?.toFixed(1)}%)
                  </span>
                ) : '—'}
              </td>
              <td className="p-3 text-muted-foreground">
                {formatDistanceToNow(new Date(match.matched_at), { addSuffix: true })}
              </td>
              <td className="p-3">
                <div className="flex flex-wrap gap-1">
                  {match.reasons?.slice(0, 3).map((r, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {r}
                    </Badge>
                  ))}
                </div>
              </td>
              <td className="p-3">
                {match.listing_url ? (
                  <a
                    href={match.listing_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    View <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


export default function HuntDetailPage() {
  const { huntId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [proofModalOpen, setProofModalOpen] = useState(false);
  const [selectedStrike, setSelectedStrike] = useState<HuntAlert | null>(null);

  const { data: hunt, isLoading: huntLoading } = useQuery({
    queryKey: ['hunt', huntId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('sale_hunts')
        .select('*')
        .eq('id', huntId)
        .single();
      if (error) throw error;
      return data as SaleHunt;
    },
    enabled: !!huntId
  });

  const { data: matches = [] } = useQuery({
    queryKey: ['hunt-matches', huntId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('hunt_matches')
        .select('*, retail_listings!inner(listing_url, source)')
        .eq('hunt_id', huntId)
        .limit(200);
      if (error) throw error;
      
      // Map and sort by priority
      const mapped = (data || []).map((m: any) => ({
        ...m,
        listing_url: m.retail_listings?.listing_url || null,
        source: m.retail_listings?.source || null
      })) as (HuntMatch & { listing_url?: string | null; source?: string | null })[];
      
      // Sort: BUY first, then WATCH, then IGNORE, each by priority_score desc
      const decisionOrder: Record<string, number> = { buy: 1, watch: 2, ignore: 3, no_evidence: 4 };
      return mapped.sort((a, b) => {
        const aOrder = decisionOrder[a.decision] || 5;
        const bOrder = decisionOrder[b.decision] || 5;
        if (aOrder !== bOrder) return aOrder - bOrder;
        // Within same decision, sort by priority_score desc
        const aScore = a.priority_score || 0;
        const bScore = b.priority_score || 0;
        return bScore - aScore;
      });
    },
    enabled: !!huntId
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['hunt-alerts', huntId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('hunt_alerts')
        .select('*')
        .eq('hunt_id', huntId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as HuntAlert[];
    },
    enabled: !!huntId
  });

  const { data: scans = [] } = useQuery({
    queryKey: ['hunt-scans', huntId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('hunt_scans')
        .select('*')
        .eq('hunt_id', huntId)
        .order('started_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as HuntScan[];
    },
    enabled: !!huntId
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (status: HuntStatus) => {
      const { error } = await (supabase as any)
        .from('sale_hunts')
        .update({ status })
        .eq('id', huntId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hunt', huntId] });
      toast.success('Hunt status updated');
    }
  });

  const runScanMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('run-hunt-scan', {
        body: { hunt_id: huntId }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['hunt-matches', huntId] });
      queryClient.invalidateQueries({ queryKey: ['hunt-alerts', huntId] });
      queryClient.invalidateQueries({ queryKey: ['hunt-scans', huntId] });
      queryClient.invalidateQueries({ queryKey: ['hunt', huntId] });
      toast.success(`Scan complete: ${data.results?.[0]?.matches || 0} matches, ${data.results?.[0]?.alerts || 0} alerts`);
    },
    onError: (error) => {
      toast.error(`Scan failed: ${error.message}`);
    }
  });

  // Outward hunt mutation
  const runOutwardMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('outward-hunt', {
        body: { hunt_id: huntId }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['hunt-alerts', huntId] });
      toast.success(`Outward search: ${data.candidates_found || 0} candidates, ${data.alerts_emitted || 0} alerts`);
    },
    onError: (error) => {
      toast.error(`Outward search failed: ${error.message}`);
    }
  });

  // Toggle outward enabled
  const toggleOutwardMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await (supabase as any)
        .from('sale_hunts')
        .update({ outward_enabled: enabled })
        .eq('id', huntId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hunt', huntId] });
      toast.success('Outward search settings updated');
    }
  });

  const acknowledgeAlertMutation = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await (supabase as any)
        .from('hunt_alerts')
        .update({ acknowledged_at: new Date().toISOString() })
        .eq('id', alertId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hunt-alerts', huntId] });
    }
  });

  if (huntLoading) {
    return (
      <AppLayout>
        <div className="space-y-6">
          <Skeleton className="h-32 w-full" />
          <div className="grid grid-cols-4 gap-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      </AppLayout>
    );
  }

  if (!hunt) {
    return (
      <AppLayout>
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold">Hunt not found</h2>
          <Button className="mt-4" onClick={() => navigate('/hunts')}>
            Back to Hunts
          </Button>
        </div>
      </AppLayout>
    );
  }

  // Separate alerts by type
  const buyAlerts = alerts.filter(a => a.alert_type === 'BUY' && !a.acknowledged_at);
  const watchAlerts = alerts.filter(a => a.alert_type === 'WATCH' && !a.acknowledged_at);
  const acknowledgedBuyAlerts = alerts.filter(a => a.alert_type === 'BUY' && a.acknowledged_at);
  const allAlerts = alerts;

  // Get the most recent acknowledged BUY alert for "proof" feature
  const latestStrike = acknowledgedBuyAlerts.length > 0 ? acknowledgedBuyAlerts[0] : null;

  const handleViewProof = (alert: HuntAlert) => {
    setSelectedStrike(alert);
    setProofModalOpen(true);
  };

  const getDecisionColor = (decision: MatchDecision) => {
    switch (decision) {
      case 'buy': return 'bg-emerald-500/10 text-emerald-600';
      case 'watch': return 'bg-amber-500/10 text-amber-600';
      case 'ignore': return 'bg-muted text-muted-foreground';
      default: return 'bg-muted';
    }
  };

  const getLaneColor = (lane: string | null) => {
    switch (lane) {
      case 'AUCTION': return 'bg-violet-500/10 text-violet-600 border-violet-200';
      case 'RETAIL': return 'bg-blue-500/10 text-blue-600 border-blue-200';
      case 'DEALER_SITE': return 'bg-cyan-500/10 text-cyan-600 border-cyan-200';
      case 'CLASSIFIED': return 'bg-slate-500/10 text-slate-600 border-slate-200';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  // Bucket matches for display
  const buyNowMatches = matches.filter(m => m.decision === 'buy');
  const auctionEdgeMatches = matches.filter(m => m.lane === 'AUCTION' && m.decision === 'watch');
  const otherWatchMatches = matches.filter(m => m.decision === 'watch' && m.lane !== 'AUCTION');
  const ignoreMatches = matches.filter(m => m.decision === 'ignore');

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <HuntHeader
          hunt={hunt as any}
          onUpdateStatus={(status) => updateStatusMutation.mutate(status)}
          onRunScan={() => runScanMutation.mutate()}
          onRunOutwardScan={() => runOutwardMutation.mutate()}
          isRunningScans={runScanMutation.isPending}
          isUpdatingStatus={updateStatusMutation.isPending}
          isRunningOutward={runOutwardMutation.isPending}
          lastAlertAt={alerts[0]?.created_at}
          lastMatchAt={matches[0]?.matched_at}
        />

        {/* Strike Success Banner (when there's an acknowledged BUY) */}
        {latestStrike && (
          <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-200 dark:border-emerald-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <Trophy className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                    Kiting Mode Strike!
                  </div>
                  <div className="text-sm text-muted-foreground">
                    This hunt found a successful match
                  </div>
                </div>
              </div>
              <Button 
                variant="outline" 
                className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                onClick={() => handleViewProof(latestStrike)}
              >
                <Trophy className="h-4 w-4 mr-2" />
                View Proof
              </Button>
            </div>
          </div>
        )}

        {/* Guardrails Banner */}
        <div className="p-4 rounded-lg bg-muted/50 border">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-medium mb-1">How to read these alerts</div>
              <div className="text-muted-foreground space-y-1">
                <div><span className="font-medium text-emerald-600">BUY</span> = High-confidence strike opportunity. Always verify photos, condition, and spec before bidding.</div>
                <div><span className="font-medium text-amber-600">WATCH</span> = Worth monitoring. May need price movement or more evidence to become a BUY.</div>
              </div>
            </div>
          </div>
        </div>

        {/* KPI Cards */}
        <HuntKPICards 
          alerts={alerts} 
          matches={matches}
        />

        {/* Hunt Configuration (collapsible summary) */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium">Hunt Configuration</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">KM Target:</span>
                <span className="ml-2 font-medium">{hunt.km ? `${(hunt.km / 1000).toFixed(0)}k (±${hunt.km_tolerance_pct}%)` : 'Any'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">BUY Gap:</span>
                <span className="ml-2 font-medium">${hunt.min_gap_abs_buy} / {hunt.min_gap_pct_buy}%</span>
              </div>
              <div>
                <span className="text-muted-foreground">WATCH Gap:</span>
                <span className="ml-2 font-medium">${hunt.min_gap_abs_watch} / {hunt.min_gap_pct_watch}%</span>
              </div>
              <div>
                <span className="text-muted-foreground">Max Age (BUY):</span>
                <span className="ml-2 font-medium">≤{hunt.max_listing_age_days_buy} days</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Alert Tabs */}
        <Tabs defaultValue="buy">
          <TabsList>
            <TabsTrigger value="buy" className="data-[state=active]:text-emerald-600">
              BUY ({buyAlerts.length})
            </TabsTrigger>
            <TabsTrigger value="watch" className="data-[state=active]:text-amber-600">
              WATCH ({watchAlerts.length})
            </TabsTrigger>
            <TabsTrigger value="all">
              All ({allAlerts.length})
            </TabsTrigger>
            <TabsTrigger value="matches">
              Matches ({matches.length})
            </TabsTrigger>
            <TabsTrigger value="scans">
              Scans ({scans.length})
            </TabsTrigger>
          </TabsList>

          {/* BUY Alerts */}
          <TabsContent value="buy" className="space-y-3 mt-4">
            {buyAlerts.length === 0 ? (
              <Card className="py-8">
                <CardContent className="text-center text-muted-foreground">
                  No BUY alerts yet. Run a scan to find opportunities.
                </CardContent>
              </Card>
            ) : (
              buyAlerts.map((alert) => (
                <HuntAlertCardEnhanced
                  key={alert.id}
                  alert={alert}
                  hunt={hunt}
                  onAcknowledge={(id) => acknowledgeAlertMutation.mutate(id)}
                  isAcknowledging={acknowledgeAlertMutation.isPending}
                />
              ))
            )}
          </TabsContent>

          {/* WATCH Alerts */}
          <TabsContent value="watch" className="space-y-3 mt-4">
            {watchAlerts.length === 0 ? (
              <Card className="py-8">
                <CardContent className="text-center text-muted-foreground">
                  No WATCH alerts yet.
                </CardContent>
              </Card>
            ) : (
              watchAlerts.map((alert) => (
                <HuntAlertCardEnhanced
                  key={alert.id}
                  alert={alert}
                  hunt={hunt}
                  onAcknowledge={(id) => acknowledgeAlertMutation.mutate(id)}
                  isAcknowledging={acknowledgeAlertMutation.isPending}
                />
              ))
            )}
          </TabsContent>

          {/* All Alerts */}
          <TabsContent value="all" className="space-y-3 mt-4">
            {allAlerts.length === 0 ? (
              <Card className="py-8">
                <CardContent className="text-center text-muted-foreground">
                  No alerts yet. Run a scan to find matches.
                </CardContent>
              </Card>
            ) : (
              allAlerts.map((alert) => (
                <HuntAlertCardEnhanced
                  key={alert.id}
                  alert={alert}
                  hunt={hunt}
                  onAcknowledge={(id) => acknowledgeAlertMutation.mutate(id)}
                  isAcknowledging={acknowledgeAlertMutation.isPending}
                />
              ))
            )}
          </TabsContent>

          {/* Matches - Bucketed Display */}
          <TabsContent value="matches" className="mt-4 space-y-6">
            {matches.length === 0 ? (
              <Card className="py-8">
                <CardContent className="text-center text-muted-foreground">
                  No matches found yet. Run a scan to find opportunities.
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Buy Now (Strike) Section */}
                {buyNowMatches.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-emerald-600 mb-3 flex items-center gap-2">
                      <Trophy className="h-4 w-4" />
                      Buy Now (Strike) ({buyNowMatches.length})
                    </h3>
                    <MatchTable matches={buyNowMatches} getDecisionColor={getDecisionColor} getLaneColor={getLaneColor} />
                  </div>
                )}

                {/* Auction Edge Section */}
                {auctionEdgeMatches.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-violet-600 mb-3 flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      Auction Edge ({auctionEdgeMatches.length})
                    </h3>
                    <MatchTable matches={auctionEdgeMatches} getDecisionColor={getDecisionColor} getLaneColor={getLaneColor} />
                  </div>
                )}

                {/* Other Replicas Section */}
                {otherWatchMatches.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-amber-600 mb-3 flex items-center gap-2">
                      <Info className="h-4 w-4" />
                      Other Replicas ({otherWatchMatches.length})
                    </h3>
                    <MatchTable matches={otherWatchMatches} getDecisionColor={getDecisionColor} getLaneColor={getLaneColor} />
                  </div>
                )}

                {/* Ignored/Rejected (collapsed by default) */}
                {ignoreMatches.length > 0 && (
                  <details className="group">
                    <summary className="text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground mb-3">
                      Show Rejected ({ignoreMatches.length})
                    </summary>
                    <MatchTable matches={ignoreMatches} getDecisionColor={getDecisionColor} getLaneColor={getLaneColor} />
                  </details>
                )}
              </>
            )}
          </TabsContent>

          {/* Scan History */}
          <TabsContent value="scans" className="mt-4">
            <div className="space-y-2">
              {scans.length === 0 ? (
                <Card className="py-8">
                  <CardContent className="text-center text-muted-foreground">
                    No scans run yet
                  </CardContent>
                </Card>
              ) : (
                scans.map((scan) => (
                  <Card key={scan.id}>
                    <CardContent className="p-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Badge className={
                          scan.status === 'ok' ? 'bg-emerald-500/10 text-emerald-600' :
                          scan.status === 'error' ? 'bg-destructive/10 text-destructive' :
                          'bg-amber-500/10 text-amber-600'
                        }>
                          {scan.status}
                        </Badge>
                        <div className="text-sm">
                          <span className="font-medium">{scan.candidates_checked ?? 0}</span> checked • 
                          <span className="font-medium ml-1">{scan.matches_found ?? 0}</span> matches • 
                          <span className="font-medium ml-1">{scan.alerts_emitted ?? 0}</span> alerts
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {formatDistanceToNow(new Date(scan.started_at), { addSuffix: true })}
                        </div>
                        {scan.error && (
                          <div className="flex items-center gap-1 text-destructive">
                            <AlertCircle className="h-4 w-4" />
                            <span className="text-xs truncate max-w-[200px]">{scan.error}</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Proof of Hunt Modal */}
      {selectedStrike && hunt && (
        <ProofOfHuntModal
          open={proofModalOpen}
          onOpenChange={setProofModalOpen}
          hunt={hunt}
          strikeAlert={selectedStrike}
          scans={scans}
        />
      )}
    </AppLayout>
  );
}
