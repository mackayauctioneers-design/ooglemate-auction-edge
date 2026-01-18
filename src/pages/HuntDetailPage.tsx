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
import { AlertCircle, AlertTriangle, Clock, ExternalLink, Globe, Info, Pencil, Trophy, TrendingDown, Zap } from "lucide-react";
import { EditHuntDrawer } from "@/components/hunts/EditHuntDrawer";
import { CarsalesIdKitModal } from "@/components/hunts/CarsalesIdKitModal";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { HuntHeader } from "@/components/hunts/HuntHeader";
import { HuntKPICards } from "@/components/hunts/HuntKPICards";
import { HuntAlertCardEnhanced } from "@/components/hunts/HuntAlertCardEnhanced";
import { ProofOfHuntModal } from "@/components/hunts/ProofOfHuntModal";
import { useUnifiedCandidates } from "@/hooks/useUnifiedCandidates";
import type { 
  SaleHunt, 
  HuntMatch, 
  HuntScan, 
  HuntAlert,
  HuntStatus,
  MatchDecision,
  UnifiedCandidate
} from "@/types/hunts";

export default function HuntDetailPage() {
  const { huntId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [proofModalOpen, setProofModalOpen] = useState(false);
  const [selectedStrike, setSelectedStrike] = useState<HuntAlert | null>(null);
  const [editDrawerOpen, setEditDrawerOpen] = useState(false);

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

  // Outward Web candidates - "Verified Cheapest" ranking (verified price from scrape)
  const { data: outwardData, isLoading: outwardLoading } = useUnifiedCandidates({
    huntId: huntId || '',
    limit: 50,
    sourceFilter: 'outward',
    enabled: !!huntId,
    staleTime: 0,
    refetchOnMount: true
  });

  // Internal Feed candidates (Autotrader, Drive, Gumtree ingest)
  const { data: internalData, isLoading: internalLoading } = useUnifiedCandidates({
    huntId: huntId || '',
    limit: 50,
    sourceFilter: 'internal',
    enabled: !!huntId,
    staleTime: 0,
    refetchOnMount: true
  });

  // All unified candidates (for backward compatibility)
  const { data: unifiedData, isLoading: unifiedLoading, refetch: refetchUnified } = useUnifiedCandidates({
    huntId: huntId || '',
    limit: 100,
    enabled: !!huntId,
    staleTime: 0,
    refetchOnMount: true
  });

  // Also keep legacy matches for rejection tab - filtered by current criteria_version
  const { data: matches = [] } = useQuery({
    queryKey: ['hunt-matches', huntId, hunt?.criteria_version],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('hunt_matches')
        .select('*, retail_listings!inner(listing_url, source)')
        .eq('hunt_id', huntId)
        .eq('criteria_version', hunt?.criteria_version || 1)
        .eq('is_stale', false)
        .order('priority_score', { ascending: false, nullsFirst: false })
        .limit(100);
      if (error) throw error;
      
      return (data || []).map((m: any) => ({
        ...m,
        listing_url: m.retail_listings?.listing_url || null,
        source: m.retail_listings?.source || null
      })) as (HuntMatch & { listing_url?: string | null; source?: string | null })[];
    },
    enabled: !!huntId && !!hunt
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['hunt-alerts', huntId, hunt?.criteria_version],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('hunt_alerts')
        .select('*')
        .eq('hunt_id', huntId)
        .eq('criteria_version', hunt?.criteria_version || 1)
        .eq('is_stale', false)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as HuntAlert[];
    },
    enabled: !!huntId && !!hunt,
    staleTime: 0,
    refetchOnMount: 'always'
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
      queryClient.invalidateQueries({ queryKey: ['unified-candidates', huntId] });
      toast.success(`Scan complete: ${data.results?.[0]?.matches || 0} matches, ${data.results?.[0]?.alerts || 0} alerts`);
    },
    onError: (error) => {
      toast.error(`Scan failed: ${error.message}`);
    }
  });

  // Outward hunt mutation - now triggers immediate verification
  const runOutwardMutation = useMutation({
    mutationFn: async () => {
      // Step 1: Run outward discovery
      const { data: discoveryData, error: discoveryError } = await supabase.functions.invoke('outward-hunt', {
        body: { hunt_id: huntId }
      });
      if (discoveryError) throw discoveryError;
      
      // Step 2: Immediately trigger scrape worker to verify prices
      // This ensures user sees verified results faster
      toast.info('Verifying listings...');
      try {
        await supabase.functions.invoke('outward-scrape-worker', {
          body: { batch_size: 20 }
        });
      } catch (verifyErr) {
        console.warn('Scrape worker failed:', verifyErr);
        // Don't fail the whole operation if verification fails
      }
      
      return discoveryData;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['hunt-alerts', huntId] });
      queryClient.invalidateQueries({ queryKey: ['unified-candidates', huntId] });
      queryClient.invalidateQueries({ queryKey: ['outward-candidates', huntId] });
      queryClient.invalidateQueries({ queryKey: ['internal-candidates', huntId] });
      toast.success(`Web search: ${data.candidates_found || 0} candidates, ${data.alerts_emitted || 0} alerts`);
    },
    onError: (error) => {
      toast.error(`Web search failed: ${error.message}`);
    }
  });

  // Kiting Mode is always active - no toggle needed

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

        {/* Match Criteria Status - Trust Builder */}
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-primary" />
              Match Criteria
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {/* Status indicators */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${hunt.engine_code && hunt.engine_code !== 'UNKNOWN' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                <span className="text-muted-foreground">Engine:</span>
                <span className="font-medium">
                  {hunt.engine_code && hunt.engine_code !== 'UNKNOWN' 
                    ? <span className="text-emerald-600">✓ {hunt.engine_code}</span>
                    : <span className="text-amber-600">⚠ unknown</span>
                  }
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${hunt.body_type || hunt.cab_type ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                <span className="text-muted-foreground">Body:</span>
                <span className="font-medium">
                  {(hunt.body_type || hunt.cab_type) 
                    ? <span className="text-emerald-600">✓ {hunt.body_type || hunt.cab_type}</span>
                    : <span className="text-amber-600">⚠ unknown</span>
                  }
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${hunt.badge ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`} />
                <span className="text-muted-foreground">Badge:</span>
                <span className="font-medium">
                  {hunt.badge 
                    ? <span className="text-emerald-600">✓ {hunt.badge}</span>
                    : <span className="text-muted-foreground">— not set</span>
                  }
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${hunt.series_family ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`} />
                <span className="text-muted-foreground">Series:</span>
                <span className="font-medium">
                  {hunt.series_family 
                    ? <span className="text-emerald-600">✓ {hunt.series_family}</span>
                    : <span className="text-muted-foreground">— auto</span>
                  }
                </span>
              </div>
            </div>
            
            {/* Warning if missing critical data */}
            {(!hunt.engine_code || hunt.engine_code === 'UNKNOWN') && (!hunt.body_type && !hunt.cab_type) && (
              <div className="p-2 rounded bg-amber-500/10 border border-amber-200 text-xs text-amber-700 dark:text-amber-400 mb-3">
                ⚠ Engine and body not specified — BUY alerts blocked, only WATCH allowed.
              </div>
            )}
            
            {/* Badge not set warning */}
            {!hunt.badge && (
              <div className="p-2 rounded bg-muted text-xs text-muted-foreground mb-3">
                Badge not specified — matches are broader. Add a badge for precision matching.
              </div>
            )}
            
            {/* Must-have tokens */}
            {hunt.must_have_tokens && hunt.must_have_tokens.length > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Must-Have:</span>
                <div className="flex flex-wrap gap-1">
                  {hunt.must_have_tokens.map((token) => (
                    <Badge 
                      key={token} 
                      variant="outline" 
                      className={`font-mono text-xs ${hunt.must_have_mode === 'strict' ? 'border-amber-500 text-amber-600' : ''}`}
                    >
                      {token.toLowerCase()}
                    </Badge>
                  ))}
                </div>
                {hunt.must_have_mode === 'strict' && (
                  <Badge className="bg-amber-500/10 text-amber-600 border-amber-200 text-xs">Strict</Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Hunt Configuration (collapsible summary) */}
        <Card>
          <CardHeader className="py-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">Hunt Configuration</CardTitle>
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => setEditDrawerOpen(true)}
              className="h-8 gap-1"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
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

        {/* Kiting Mode Status - Web Discovery */}
        <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <svg className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 2a10 10 0 0 1 7.07 17.07"/>
                <path d="M2 12h4m12 0h4"/>
              </svg>
              Kiting Mode Active
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Scanning auctions, dealer networks, and the wider web for replicas.
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-200">
                ✓ Web Discovery
              </Badge>
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-200">
                ✓ Auctions
              </Badge>
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-200">
                ✓ Dealer Networks
              </Badge>
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-200">
                ✓ Autotrader
              </Badge>
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-200">
                ✓ Drive
              </Badge>
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-200">
                ✓ Gumtree
              </Badge>
            </div>
            {hunt.last_outward_scan_at && (
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Last web scan: {formatDistanceToNow(new Date(hunt.last_outward_scan_at), { addSuffix: true })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Alert Tabs */}
        <Tabs defaultValue="buy">
          <TabsList className="flex-wrap">
            <TabsTrigger value="buy" className="data-[state=active]:text-emerald-600">
              BUY ({buyAlerts.length})
            </TabsTrigger>
            <TabsTrigger value="watch" className="data-[state=active]:text-amber-600">
              WATCH ({watchAlerts.length})
            </TabsTrigger>
            <TabsTrigger value="all">
              All Alerts ({allAlerts.length})
            </TabsTrigger>
            <TabsTrigger value="matches">
              Listings ({(outwardData?.totalCount || 0) + (internalData?.totalCount || 0)})
            </TabsTrigger>
            <TabsTrigger value="rejections" className="text-muted-foreground">
              Rejected ({matches.filter(m => m.decision === 'ignore').length})
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

          {/* Unified Candidates - Two Section Layout */}
          <TabsContent value="matches" className="mt-4 space-y-6">
            
            {/* Section A: Web Verified Cheapest (TOP) */}
            <Card className="border-amber-200 dark:border-amber-900/50">
              <CardHeader className="py-3 bg-gradient-to-r from-amber-500/10 to-transparent">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Globe className="h-4 w-4 text-amber-600" />
                  Web Verified Cheapest
                  <Badge variant="outline" className="ml-2 bg-amber-500/10 text-amber-600 border-amber-200">
                    {outwardData?.candidates?.filter(c => c.is_verified).length || 0} verified
                  </Badge>
                  {outwardData?.cheapestPrice && (
                    <Badge variant="outline" className="ml-auto bg-emerald-500/10 text-emerald-600">
                      <TrendingDown className="h-3 w-3 mr-1" />
                      From ${outwardData.cheapestPrice.toLocaleString()}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-3 text-left font-medium">#</th>
                        <th className="p-3 text-left font-medium">Rank</th>
                        <th className="p-3 text-left font-medium">Source</th>
                        <th className="p-3 text-left font-medium">Price</th>
                        <th className="p-3 text-left font-medium">Decision</th>
                        <th className="p-3 text-left font-medium">Details</th>
                        <th className="p-3 text-left font-medium">Why</th>
                        <th className="p-3 text-left font-medium">Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outwardLoading ? (
                        <tr>
                          <td colSpan={8} className="p-8 text-center text-muted-foreground">
                            Loading web candidates...
                          </td>
                        </tr>
                      ) : (outwardData?.candidates || []).length === 0 ? (
                        <tr>
                          <td colSpan={8} className="p-8 text-center text-muted-foreground">
                            <div className="flex flex-col items-center gap-2">
                              <Globe className="h-8 w-8 text-muted-foreground/50" />
                              <span>No verified web listings yet — click "Search Web" to scan</span>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        (outwardData?.candidates || []).map((candidate, idx) => (
                          <tr key={candidate.id} className={`border-t hover:bg-muted/30 ${candidate.is_cheapest ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : ''}`}>
                            <td className="p-3 font-mono text-xs text-muted-foreground">
                              {idx + 1}
                            </td>
                            <td className="p-3">
                              <div className="flex flex-col gap-0.5">
                                <span className={`font-mono text-xs px-1.5 py-0.5 rounded inline-block w-fit ${
                                  (candidate.rank_score || candidate.dna_score || 0) >= 10 ? 'bg-emerald-500/20 text-emerald-700' :
                                  (candidate.rank_score || candidate.dna_score || 0) >= 7 ? 'bg-amber-500/20 text-amber-700' :
                                  'bg-muted text-muted-foreground'
                                }`}>
                                  {candidate.rank_score?.toFixed(1) || candidate.dna_score?.toFixed(1) || '—'}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  DNA: {candidate.dna_score?.toFixed(1) || '—'}
                                </span>
                              </div>
                            </td>
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                <Badge 
                                  variant="outline" 
                                  className={candidate.is_verified 
                                    ? 'bg-emerald-500/10 text-emerald-600 border-emerald-200' 
                                    : 'bg-amber-500/10 text-amber-600 border-amber-200'}
                                >
                                  {candidate.is_verified ? '✓ Verified' : 'Pending'}
                                </Badge>
                                {/* Source Tier Badge: Tier 1 = auction (gold), Tier 2 = marketplace (blue), Tier 3 = dealer (gray) */}
                                <Badge 
                                  variant="secondary" 
                                  className={`text-xs ${
                                    candidate.source_tier === 1 
                                      ? 'bg-amber-500/20 text-amber-700 border-amber-300' 
                                      : candidate.source_tier === 2 
                                        ? 'bg-blue-500/20 text-blue-700 border-blue-300'
                                        : 'bg-muted text-muted-foreground'
                                  }`}
                                >
                                  {candidate.source_tier === 1 ? '🔨 Auction' : 
                                   candidate.source_tier === 2 ? '🛒 Marketplace' : 
                                   candidate.source_class || 'dealer'}
                                </Badge>
                              </div>
                            </td>
                            <td className="p-3">
                              <div className="flex items-center gap-1">
                                {candidate.is_cheapest && <Zap className="h-4 w-4 text-amber-500" />}
                                <span className={candidate.is_cheapest ? 'font-bold text-emerald-600' : ''}>
                                  {candidate.price ? `$${candidate.price.toLocaleString()}` : '—'}
                                </span>
                              </div>
                            </td>
                            <td className="p-3">
                              <Badge className={getDecisionColor(candidate.decision.toLowerCase() as MatchDecision)}>
                                {candidate.decision}
                              </Badge>
                            </td>
                            <td className="p-3">
                              <div className="text-xs">
                                <div>{candidate.year} {candidate.make} {candidate.model}</div>
                                {candidate.km && <div className="text-muted-foreground">{candidate.km.toLocaleString()} km</div>}
                              </div>
                            </td>
                            {/* Why matched - sort_reason audit trail */}
                            <td className="p-3">
                              <div className="flex flex-wrap gap-1">
                                {(candidate.sort_reason || []).slice(0, 3).map((reason, i) => (
                                  <Badge 
                                    key={i} 
                                    variant="outline" 
                                    className="text-[10px] font-mono bg-muted/50"
                                  >
                                    {reason}
                                  </Badge>
                                ))}
                                {(!candidate.sort_reason || candidate.sort_reason.length === 0) && (
                                  <span className="text-muted-foreground text-xs">—</span>
                                )}
                              </div>
                            </td>
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                {candidate.requires_manual_check && (
                                  <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 border-amber-200">
                                    <AlertTriangle className="h-3 w-3 mr-1" />
                                    Manual
                                  </Badge>
                                )}
                                {candidate.requires_manual_check ? (
                                  <CarsalesIdKitModal
                                    title={candidate.title || `${candidate.year} ${candidate.make} ${candidate.model}`}
                                    domain={candidate.domain || ''}
                                    idKit={candidate.id_kit}
                                    year={candidate.year}
                                    make={candidate.make}
                                    model={candidate.model}
                                    variant={candidate.variant_raw}
                                    km={candidate.km}
                                    price={candidate.price}
                                    location={candidate.location}
                                  />
                                ) : candidate.url && !candidate.url.startsWith('internal://') ? (
                                  <a
                                    href={candidate.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-primary hover:underline"
                                  >
                                    View <ExternalLink className="h-3 w-3" />
                                  </a>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Section B: Internal Feed (SECOND) */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Zap className="h-4 w-4 text-blue-600" />
                  Internal Feed
                  <Badge variant="outline" className="ml-2 text-muted-foreground">
                    {internalData?.totalCount || 0} listings
                  </Badge>
                  <span className="text-xs text-muted-foreground font-normal ml-2">
                    Autotrader • Drive • Gumtree
                  </span>
                  {internalData?.cheapestPrice && (
                    <Badge variant="outline" className="ml-auto bg-blue-500/10 text-blue-600">
                      <TrendingDown className="h-3 w-3 mr-1" />
                      From ${internalData.cheapestPrice.toLocaleString()}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-3 text-left font-medium">#</th>
                        <th className="p-3 text-left font-medium">Rank</th>
                        <th className="p-3 text-left font-medium">Source</th>
                        <th className="p-3 text-left font-medium">Price</th>
                        <th className="p-3 text-left font-medium">Decision</th>
                        <th className="p-3 text-left font-medium">Details</th>
                        <th className="p-3 text-left font-medium">Why</th>
                        <th className="p-3 text-left font-medium">Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {internalLoading ? (
                        <tr>
                          <td colSpan={8} className="p-8 text-center text-muted-foreground">
                            Loading internal feed...
                          </td>
                        </tr>
                      ) : (internalData?.candidates || []).length === 0 ? (
                        <tr>
                          <td colSpan={8} className="p-8 text-center text-muted-foreground">
                            No internal matches. Run "Scan Now" to check Autotrader/Drive/Gumtree.
                          </td>
                        </tr>
                      ) : (
                        (internalData?.candidates || []).map((candidate, idx) => (
                          <tr key={candidate.id} className={`border-t hover:bg-muted/30 ${candidate.is_cheapest ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : ''}`}>
                            <td className="p-3 font-mono text-xs text-muted-foreground">
                              {idx + 1}
                            </td>
                            <td className="p-3">
                              <div className="flex flex-col gap-0.5">
                                <span className={`font-mono text-xs px-1.5 py-0.5 rounded inline-block w-fit ${
                                  (candidate.rank_score || candidate.dna_score || 0) >= 10 ? 'bg-emerald-500/20 text-emerald-700' :
                                  (candidate.rank_score || candidate.dna_score || 0) >= 7 ? 'bg-amber-500/20 text-amber-700' :
                                  'bg-muted text-muted-foreground'
                                }`}>
                                  {candidate.rank_score?.toFixed(1) || candidate.dna_score?.toFixed(1) || '—'}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  DNA: {candidate.dna_score?.toFixed(1) || '—'}
                                </span>
                              </div>
                            </td>
                            <td className="p-3">
                              {/* Source Tier Badge for internal listings too */}
                              <Badge 
                                variant="secondary" 
                                className={`text-xs ${
                                  candidate.source_tier === 1 
                                    ? 'bg-amber-500/20 text-amber-700 border-amber-300' 
                                    : candidate.source_tier === 2 
                                      ? 'bg-blue-500/20 text-blue-700 border-blue-300'
                                      : 'bg-muted text-muted-foreground'
                                }`}
                              >
                                {candidate.source_tier === 1 ? '🔨 Auction' : 
                                 candidate.source_tier === 2 ? '🛒 Marketplace' : 
                                 candidate.source_class || candidate.source?.replace('_', ' ') || 'internal'}
                              </Badge>
                            </td>
                            <td className="p-3">
                              <div className="flex items-center gap-1">
                                {candidate.is_cheapest && <Zap className="h-4 w-4 text-amber-500" />}
                                <span className={candidate.is_cheapest ? 'font-bold text-emerald-600' : ''}>
                                  {candidate.price ? `$${candidate.price.toLocaleString()}` : '—'}
                                </span>
                              </div>
                            </td>
                            <td className="p-3">
                              <Badge className={getDecisionColor(candidate.decision.toLowerCase() as MatchDecision)}>
                                {candidate.decision}
                              </Badge>
                            </td>
                            <td className="p-3">
                              <div className="text-xs">
                                <div>{candidate.year} {candidate.make} {candidate.model}</div>
                                {candidate.km && <div className="text-muted-foreground">{candidate.km.toLocaleString()} km</div>}
                              </div>
                            </td>
                            {/* Why matched - sort_reason audit trail */}
                            <td className="p-3">
                              <div className="flex flex-wrap gap-1">
                                {(candidate.sort_reason || []).slice(0, 3).map((reason, i) => (
                                  <Badge key={i} variant="outline" className="text-[10px] font-mono bg-muted/50">
                                    {reason}
                                  </Badge>
                                ))}
                                {(!candidate.sort_reason || candidate.sort_reason.length === 0) && (
                                  <span className="text-muted-foreground text-xs">—</span>
                                )}
                              </div>
                            </td>
                            <td className="p-3">
                              {candidate.url && !candidate.url.startsWith('internal://') ? (
                                <a
                                  href={candidate.url}
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
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

          </TabsContent>

          {/* Rejected Matches (Audit Trail) */}
          <TabsContent value="rejections" className="mt-4">
            <div className="mb-3 p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
              These listings were evaluated but rejected by hard gates (series/body/engine mismatch) or missing required keywords.
            </div>
            <div className="rounded-lg border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-3 text-left font-medium">Rejection Reason</th>
                    <th className="p-3 text-left font-medium">Price</th>
                    <th className="p-3 text-left font-medium">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.filter(m => m.decision === 'ignore').length === 0 ? (
                    <tr>
                      <td colSpan={3} className="p-8 text-center text-muted-foreground">
                        No rejected matches. Gates are being applied correctly.
                      </td>
                    </tr>
                  ) : (
                    matches.filter(m => m.decision === 'ignore').map((match) => {
                      const rejectionReason = (match.reasons || []).filter(Boolean)[0] || 'Unknown';
                      
                      return (
                        <tr key={match.id} className="border-t hover:bg-muted/30 opacity-60">
                          <td className="p-3">
                            <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                              {rejectionReason}
                            </Badge>
                          </td>
                          <td className="p-3">
                            ${match.asking_price?.toLocaleString() || '?'}
                          </td>
                          <td className="p-3">
                            {(match as any).listing_url ? (
                              <a
                                href={(match as any).listing_url}
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
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* Scan History */}
          <TabsContent value="scans" className="mt-4">
            <div className="space-y-3">
              {scans.length === 0 ? (
                <Card className="py-8">
                  <CardContent className="text-center text-muted-foreground">
                    No scans run yet
                  </CardContent>
                </Card>
              ) : (
                scans.map((scan) => {
                  const metadata = (scan as any).metadata as { 
                    sources_scanned?: string[]; 
                    rejected_by_gates?: number;
                    rejection_reasons?: Record<string, number>;
                  } | null;
                  
                  return (
                    <Card key={scan.id}>
                      <CardContent className="p-4 space-y-3">
                        {/* Top row - status and time */}
                        <div className="flex items-center justify-between">
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
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Clock className="h-4 w-4" />
                            {formatDistanceToNow(new Date(scan.started_at), { addSuffix: true })}
                          </div>
                        </div>
                        
                        {/* Sources scanned row */}
                        {metadata?.sources_scanned && metadata.sources_scanned.length > 0 && (
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-muted-foreground">Sources:</span>
                            {metadata.sources_scanned.map(src => (
                              <Badge key={src} variant="secondary" className="text-xs capitalize">
                                {src.replace('_', ' ')}
                              </Badge>
                            ))}
                          </div>
                        )}
                        
                        {/* Near-misses / rejections row */}
                        {metadata?.rejected_by_gates && metadata.rejected_by_gates > 0 && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded p-2">
                            <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                            <span>
                              <span className="font-medium text-foreground">{metadata.rejected_by_gates}</span> near-misses rejected
                              {metadata.rejection_reasons && Object.keys(metadata.rejection_reasons).length > 0 && (
                                <span className="ml-1">
                                  ({Object.entries(metadata.rejection_reasons).map(([reason, count], i) => (
                                    <span key={reason}>
                                      {i > 0 && ', '}
                                      {count} {reason.toLowerCase().replace(/_/g, ' ')}
                                    </span>
                                  ))})
                                </span>
                              )}
                            </span>
                          </div>
                        )}
                        
                        {/* Error row */}
                        {scan.error && (
                          <div className="flex items-center gap-2 text-xs text-destructive">
                            <AlertCircle className="h-3.5 w-3.5" />
                            <span className="truncate">{scan.error}</span>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })
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

      {/* Edit Hunt Drawer */}
      {hunt && (
        <EditHuntDrawer
          open={editDrawerOpen}
          onOpenChange={setEditDrawerOpen}
          hunt={hunt}
        />
      )}
    </AppLayout>
  );
}
